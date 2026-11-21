"use client";

import { doc, onSnapshot, runTransaction, serverTimestamp, type DocumentData } from "firebase/firestore";
import { firebase } from "./firebase";
import type { OnlineGame, Resolved, Seat } from "./game";

/**
 * Online rooms, shared by every game. A room is one Firestore document at
 * `<game.collection>/{code}`. The game state is stored as JSON (Firestore can't hold
 * `undefined` or nested arrays), alongside the actions that produced the latest version
 * so other phones can replay them.
 */

export type { Seat } from "./game";

export interface Replay<A> {
  /** The version these actions start from. */
  from: number;
  /** Who applied them (an account, or "bot"). */
  by: string;
  actions: A[];
}

export interface Room<S, A, Settings> {
  code: string;
  hostUid: string;
  status: "lobby" | "playing";
  settings: Settings;
  seats: Seat[];
  memberUids: string[];
  version: number;
  state: S | null;
  replay: Replay<A> | null;
  /** Who may save the next move (null: any seated player). The security rules let only them write. */
  currentUid: string | null;
}

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O or 1/I
export const CODE_LENGTH = 5;

export function normalizeCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, CODE_LENGTH);
}

function randomCode(): string {
  return Array.from({ length: CODE_LENGTH }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join("");
}

export class RoomError extends Error {}

export interface RoomsApi<S, A, Settings> {
  createRoom(uid: string, name: string): Promise<string>;
  joinRoom(code: string, uid: string, name: string): Promise<void>;
  editLobby(
    code: string,
    edit: (room: Room<S, A, Settings>) => { seats?: Seat[]; settings?: Partial<Settings> },
  ): Promise<void>;
  startGame(code: string): Promise<void>;
  submitMove(
    code: string,
    fromVersion: number | null,
    by: string,
    decide: (state: S) => Resolved<S, A> | null,
  ): Promise<Room<S, A, Settings> | null>;
  watchRoom(code: string, onRoom: (room: Room<S, A, Settings> | null) => void, onError: (e: Error) => void): () => void;
}

/** The room functions for one game. */
export function roomsFor<S, A, Settings extends Record<string, unknown>>(
  game: OnlineGame<S, Settings>,
): RoomsApi<S, A, Settings> {
  type R = Room<S, A, Settings>;
  const roomRef = (code: string) => doc(firebase().db, game.collection, code);

  function parseRoom(data: DocumentData): R {
    return {
      code: data.code,
      hostUid: data.hostUid,
      status: data.status,
      settings: { ...game.defaultSettings, ...(data.settings ?? {}) },
      seats: data.seats,
      memberUids: data.memberUids,
      version: data.version,
      state: data.stateJson ? (JSON.parse(data.stateJson) as S) : null,
      replay: data.replayJson ? (JSON.parse(data.replayJson) as Replay<A>) : null,
      currentUid: data.currentUid ?? null,
    };
  }

  return {
    async createRoom(uid, name) {
      const { db } = firebase();
      for (let attempt = 0; attempt < 5; attempt++) {
        const code = randomCode();
        const created = await runTransaction(db, async (tx) => {
          const snap = await tx.get(roomRef(code));
          if (snap.exists()) return false;
          tx.set(roomRef(code), {
            code,
            hostUid: uid,
            status: "lobby",
            settings: game.defaultSettings,
            seats: [{ uid, name, isBot: false }],
            memberUids: [uid],
            version: 0,
            stateJson: null,
            replayJson: null,
            currentUid: null,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          return true;
        });
        if (created) return code;
      }
      throw new RoomError("Couldn't create a room. Try again.");
    },

    /** Take a seat in a room's lobby (or do nothing if already seated). */
    async joinRoom(code, uid, name) {
      await runTransaction(firebase().db, async (tx) => {
        const snap = await tx.get(roomRef(code));
        if (!snap.exists()) throw new RoomError(`There's no room ${code}.`);
        const room = parseRoom(snap.data());
        if (room.memberUids.includes(uid)) return;
        if (room.status !== "lobby") throw new RoomError("That game has already started.");
        if (room.seats.length >= game.maxPlayers) throw new RoomError("That room is full.");
        tx.update(roomRef(code), {
          seats: [...room.seats, { uid, name, isBot: false }],
          memberUids: [...room.memberUids, uid],
          updatedAt: serverTimestamp(),
        });
      });
    },

    /** Change the lobby's seats or settings (host), or leave it (anyone). */
    async editLobby(code, edit) {
      await runTransaction(firebase().db, async (tx) => {
        const snap = await tx.get(roomRef(code));
        if (!snap.exists()) throw new RoomError("That room no longer exists.");
        const room = parseRoom(snap.data());
        if (room.status !== "lobby") throw new RoomError("The game has already started.");
        const next = edit(room);
        const seats = next.seats ?? room.seats;
        tx.update(roomRef(code), {
          seats,
          memberUids: seats.flatMap((s) => (s.uid ? [s.uid] : [])),
          ...(next.settings ? { settings: { ...room.settings, ...next.settings } } : {}),
          updatedAt: serverTimestamp(),
        });
      });
    },

    async startGame(code) {
      await runTransaction(firebase().db, async (tx) => {
        const snap = await tx.get(roomRef(code));
        if (!snap.exists()) throw new RoomError("That room no longer exists.");
        const room = parseRoom(snap.data());
        if (room.status !== "lobby") return;
        if (room.seats.length < game.minPlayers) throw new RoomError(`You need at least ${game.minPlayers} players.`);
        const state = game.newGame(
          room.seats.map((s) => ({ name: s.name, isBot: s.isBot })),
          room.settings,
        );
        tx.update(roomRef(code), {
          status: "playing",
          version: 1,
          stateJson: JSON.stringify(state),
          replayJson: null,
          currentUid: game.writerUid(state, room.seats),
          updatedAt: serverTimestamp(),
        });
      });
    },

    /**
     * Save a move, returning the room as saved (or null if it wasn't). `decide` works it out
     * from the latest saved state, inside the transaction, so if another phone saves at the
     * same moment Firestore simply retries it.
     *
     * With `fromVersion`, the move only counts if nothing has changed since then (a turn
     * move, or two phones racing to play the same bot turn); otherwise it returns null and
     * the caller just waits for the update. Without it (a choice every player makes at the
     * same time), the move is applied to whatever the latest state is.
     */
    async submitMove(code, fromVersion, by, decide) {
      return runTransaction(firebase().db, async (tx) => {
        const snap = await tx.get(roomRef(code));
        if (!snap.exists()) return null;
        const room = parseRoom(snap.data());
        if (room.status !== "playing" || !room.state) return null;
        if (fromVersion !== null && room.version !== fromVersion) return null;
        const move = decide(room.state);
        if (!move) return null;
        const replay: Replay<A> = { from: room.version, by, actions: move.actions };
        const saved: R = {
          ...room,
          version: room.version + 1,
          state: move.state,
          replay,
          currentUid: game.writerUid(move.state, room.seats),
        };
        tx.update(roomRef(code), {
          version: saved.version,
          stateJson: JSON.stringify(saved.state),
          replayJson: JSON.stringify(replay),
          currentUid: saved.currentUid,
          updatedAt: serverTimestamp(),
        });
        return saved;
      });
    },

    watchRoom(code, onRoom, onError) {
      return onSnapshot(
        roomRef(code),
        (snap) => onRoom(snap.exists() ? parseRoom(snap.data()) : null),
        (e) => onError(e),
      );
    },
  };
}
