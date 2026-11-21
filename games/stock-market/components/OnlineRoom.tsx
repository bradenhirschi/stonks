"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PlatformOnlineRoom, { type LobbyOptions } from "@/platform/OnlineRoom";
import type { Replay, Room } from "@/platform/rooms";
import { useRoomSync, type AnimateContext, type RoomPlay } from "@/platform/useRoomSync";
import {
  BOT_LEVELS,
  BOT_LEVEL_NAMES,
  DEFAULT_TARGET,
  PLAYER_COLORS,
  fmt,
  reducer,
  type Action,
  type BotLevel,
  type GameState,
  type Player,
} from "../engine";
import { STOCK_MARKET, TARGETS, type StockMarketSettings } from "../game";
import { botDecision, isBotTurn, resolve, type Decision } from "../online";
import { rooms } from "../rooms";
import { BOT_THINK_MS, GameView, STEP_MS, animateRoll } from "./Game";

/** Pause between replayed decisions (buying, ending a turn…) so they don't blur together. */
const DECISION_MS = 350;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type SMRoom = Room<GameState, Action, StockMarketSettings>;

const LOBBY: LobbyOptions<StockMarketSettings> = {
  seatColors: PLAYER_COLORS,
  settingsControl: ({ settings, seats, disabled, onChange }) => (
    <>
      <label className="setup-target">
        <span>Winning amount</span>
        <select
          value={settings.target}
          disabled={disabled}
          onChange={(e) => onChange({ target: Number(e.target.value) })}
        >
          {TARGETS.map((t) => (
            <option key={t} value={t}>
              ${fmt(t)}
              {t === DEFAULT_TARGET ? " (standard)" : ""}
            </option>
          ))}
        </select>
      </label>
      {seats.some((s) => s.isBot) && (
        <label className="setup-target">
          <span>Bots</span>
          <select
            value={settings.botLevel}
            disabled={disabled}
            onChange={(e) => onChange({ botLevel: e.target.value as BotLevel })}
          >
            {BOT_LEVELS.map((l) => (
              <option key={l} value={l}>
                {BOT_LEVEL_NAMES[l]}
              </option>
            ))}
          </select>
        </label>
      )}
    </>
  ),
  settingsSummary: (settings) => (
    <>
      First to <b>${fmt(settings.target)}</b>.
    </>
  ),
};

export default function OnlineRoom({ code, name, onQuit }: { code: string; name: string; onQuit: () => void }) {
  return (
    <PlatformOnlineRoom
      game={STOCK_MARKET}
      rooms={rooms}
      code={code}
      name={name}
      lobby={LOBBY}
      onQuit={onQuit}
      renderGame={({ room, uid, onQuit }) => <OnlineGame room={room} uid={uid} onQuit={onQuit} />}
    />
  );
}

function OnlineGame({ room, uid, onQuit }: { room: SMRoom; uid: string; onQuit: () => void }) {
  const [rolling, setRolling] = useState<[number, number] | null>(null);
  const rollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(
    () => () => {
      if (rollTimer.current) clearInterval(rollTimer.current);
    },
    [],
  );

  /** Animate one saved move from the version currently shown. */
  const animate = useCallback(
    async (from: GameState, rep: Replay<Action>, { show, alive }: AnimateContext<GameState>) => {
      let s = from;
      for (const action of rep.actions) {
        if (!alive()) return;
        if (action.type === "roll" && rep.by !== uid) {
          // Someone else rolled: tumble the dice here too, then show the result in the same
          // update that stops the tumble.
          const rolled = reducer(s, action);
          await new Promise<void>((done) => {
            rollTimer.current = animateRoll(setRolling, () => {
              show(rolled);
              done();
            });
          });
          s = rolled;
        } else {
          s = reducer(s, action);
          show(s);
        }
        await sleep(action.type === "step" ? STEP_MS : DECISION_MS);
      }
    },
    [uid],
  );

  const play = useMemo<RoomPlay<GameState, Action, Decision>>(
    () => ({
      resolve: (state, decision) => resolve(state, decision),
      // Occupations are picked by everyone at once, so apply those to the latest state;
      // every other move must be made on the version this phone is showing.
      anyTime: (decision) => decision.type === "chooseCareer",
      isBotTurn,
      botDecision,
      botThinkMs: BOT_THINK_MS,
      animate,
    }),
    [animate],
  );

  const { display, caughtUp, pending, slowSave, error, mySeat, send } = useRoomSync({
    room,
    uid,
    rooms,
    play,
    logTag: STOCK_MARKET.id,
  });

  // Based on what the board shows, so the panel doesn't flicker to "waiting" while your
  // own move is saving and replaying.
  const choosing = display.phase.t === "chooseCareers";
  const myTurn = mySeat >= 0 && (choosing || (display.current === mySeat && display.phase.t !== "gameOver"));

  const dispatch = useCallback((action: Action) => void send(action, uid), [send, uid]);

  const roll = useCallback(() => {
    if (rolling || pending) return;
    // Save the roll straight away and keep the dice tumbling until it's saved: the dice are
    // thrown in the save, so stopping earlier would settle on the last roll's faces and then
    // jump to the real ones.
    let saved = false;
    void send({ type: "rollDice" }, uid).finally(() => (saved = true));
    rollTimer.current = animateRoll(
      setRolling,
      () => {},
      () => saved,
    );
  }, [rolling, pending, send, uid]);

  const viewer: Player =
    mySeat >= 0 ? display.players[mySeat] : (display.players.find((p) => !p.isBot) ?? display.players[display.current]);
  return (
    <>
      <GameView
        state={display}
        viewer={viewer}
        isTurn={myTurn}
        canAct={myTurn && caughtUp && !pending}
        rolling={rolling}
        dispatch={dispatch}
        roll={roll}
        onQuit={onQuit}
        headerExtra={
          <>
            {" "}
            · Room <b>{room.code}</b>
          </>
        }
        waitingNote={mySeat < 0 ? "You're watching this game." : undefined}
        statusNote={slowSave ? "Saving…" : undefined}
      />
      {error && <div className="toast bad">{error}</div>}
    </>
  );
}
