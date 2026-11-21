"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Resolved } from "./game";
import type { Replay, Room, RoomsApi } from "./rooms";

export interface AnimateContext<S> {
  /** Show an intermediate state on the board. */
  show(state: S): void;
  /** False once the game screen has closed: stop animating. */
  alive(): boolean;
}

export interface RoomPlay<S, A, D> {
  /** Work out a player's decision into a saved move (null if it isn't allowed now). */
  resolve(state: S, decision: D): Resolved<S, A> | null;
  /**
   * Decisions every player makes at the same time (e.g. picking an occupation): applied to
   * the latest saved state instead of the version this phone is showing.
   */
  anyTime?(decision: D): boolean;
  /** Whether a bot is to move (any seated player's phone then plays it). */
  isBotTurn(state: S): boolean;
  /** The bot's decision when it's a bot's turn, else null. */
  botDecision(state: S): D | null;
  /** How long a bot "thinks" before moving, [min, max] in ms. */
  botThinkMs: readonly [number, number];
  /** Play one saved move on the board, starting from `from` (the version shown). */
  animate(from: S, replay: Replay<A>, ctx: AnimateContext<S>): Promise<void>;
}

/**
 * Keeps an online game screen in step with its room: shows each saved move as it arrives
 * (replaying it with `play.animate` when it follows on from what's shown), saves this
 * player's moves, and plays bot turns (any seated player's phone may; if two try at once
 * the first save wins and the other is rejected harmlessly).
 */
export function useRoomSync<S, A, Settings, D>({
  room,
  uid,
  rooms,
  play,
  logTag,
}: {
  room: Room<S, A, Settings>;
  uid: string;
  rooms: RoomsApi<S, A, Settings>;
  play: RoomPlay<S, A, D>;
  /** Prefix for timing logs in the console, e.g. the game id. */
  logTag: string;
}) {
  // What the board shows: it trails the saved state while a move is being replayed.
  const [display, setDisplay] = useState<S>(room.state!);
  const [animating, setAnimating] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const shownVersion = useRef(room.version);
  // Mirror of shownVersion for rendering (refs can't be read during render).
  const [shownV, setShownV] = useState(room.version);
  const displayRef = useRef<S>(room.state!);
  // The newest room state this phone knows: from the live listener, or from its own save
  // (which arrives first, so the mover never waits on the listener to see their own move).
  const latest = useRef(room);
  const [known, setKnown] = useState(room);
  const savedAt = useRef<{ version: number; at: number } | null>(null);
  const [slowSave, setSlowSave] = useState(false);
  const pumping = useRef(false);
  const alive = useRef(true);
  const playRef = useRef(play);

  useEffect(() => {
    playRef.current = play;
  }, [play]);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  /** Catch the board up with the latest saved version, replaying moves where possible. */
  const pump = useCallback(async () => {
    if (pumping.current) return;
    pumping.current = true;
    setAnimating(true);
    try {
      for (;;) {
        const r = latest.current;
        if (!alive.current || !r.state || r.version <= shownVersion.current) break;
        const fromState = displayRef.current;
        if (r.replay && r.replay.from === shownVersion.current && r.version === r.replay.from + 1) {
          await playRef.current.animate(fromState, r.replay, { show: setDisplay, alive: () => alive.current });
        }
        shownVersion.current = r.version;
        displayRef.current = r.state;
        setDisplay(r.state);
        setShownV(r.version);
      }
    } finally {
      pumping.current = false;
      if (alive.current) setAnimating(false);
    }
  }, []);

  useEffect(() => {
    displayRef.current = display;
  }, [display]);

  /** Take a newer room state (never step back to an older one) and animate up to it. */
  const adopt = useCallback(
    (r: Room<S, A, Settings>) => {
      if (r.version < latest.current.version) return;
      latest.current = r;
      setKnown(r);
      void pump();
    },
    [pump],
  );

  useEffect(() => {
    const s = savedAt.current;
    if (s && room.version >= s.version) {
      console.info(
        `[${logTag}] live update for move ${s.version} arrived ${Math.round(performance.now() - s.at)}ms after it saved`,
      );
      savedAt.current = null;
    }
    adopt(room);
  }, [room, adopt, logTag]);

  // If a save takes a while, say so rather than looking frozen.
  useEffect(() => {
    if (!pending) return;
    const t = setTimeout(() => setSlowSave(true), 1000);
    return () => {
      clearTimeout(t);
      setSlowSave(false);
    };
  }, [pending]);

  const caughtUp = !animating && shownV === known.version;
  const mySeat = room.seats.findIndex((s) => s.uid === uid);

  /** Save a decision made by `by` (this player's uid, or "bot"). */
  const send = useCallback(
    async (decision: D, by: string) => {
      const base = latest.current;
      if (!base.state) return;
      setPending(true);
      setError(null);
      try {
        const anyTime = playRef.current.anyTime?.(decision) ?? false;
        const started = performance.now();
        const saved = await rooms.submitMove(base.code, anyTime ? null : base.version, by, (state) =>
          playRef.current.resolve(state, decision),
        );
        console.info(`[${logTag}] saving took ${Math.round(performance.now() - started)}ms`);
        if (saved && alive.current) {
          savedAt.current = { version: saved.version, at: performance.now() };
          adopt(saved);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't save your move.");
      } finally {
        if (alive.current) setPending(false);
      }
    },
    [adopt, rooms, logTag],
  );

  // Bot turns.
  const authoritative = known.state!;
  useEffect(() => {
    if (!caughtUp || pending || mySeat < 0 || !playRef.current.isBotTurn(authoritative)) return;
    const version = known.version;
    const [min, max] = playRef.current.botThinkMs;
    const t = setTimeout(
      () => {
        const r = latest.current;
        if (r.version !== version || !r.state) return;
        const decision = playRef.current.botDecision(r.state);
        if (decision) void send(decision, "bot");
      },
      min + Math.random() * (max - min),
    );
    return () => clearTimeout(t);
  }, [caughtUp, pending, mySeat, authoritative, known.version, send]);

  return {
    /** The state to draw (trails the saved state while moves replay). */
    display,
    /** True when the board shows the newest saved version. */
    caughtUp,
    /** A save is in flight. */
    pending,
    /** A save has been in flight for over a second. */
    slowSave,
    error,
    /** This player's seat index, or -1 when watching. */
    mySeat,
    send,
  };
}
