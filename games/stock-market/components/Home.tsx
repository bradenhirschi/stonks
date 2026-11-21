"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { onlineAvailable } from "@/platform/firebase";
import OnlineStart, { roomFromUrl, setRoomInUrl } from "@/platform/OnlineStart";
import { readName, readStorage, writeName, writeStorage } from "@/platform/storage";
import {
  BOT_LEVELS,
  BOT_LEVEL_NAMES,
  DEFAULT_TARGET,
  MAX_PLAYERS,
  MIN_PLAYERS,
  PLAYER_COLORS,
  fmt,
  newGame,
  type BotLevel,
  type GameState,
  type PlayerSetup,
} from "../engine";
import { TARGETS } from "../game";
import { rooms } from "../rooms";
import LocalGame, { SAVE_KEY } from "./Game";
import OnlineRoom from "./OnlineRoom";

const LAST_ROOM_KEY = "stock-market:last-room";
const TAB_KEY = "stock-market:home-tab";

function loadSaved(): GameState | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    const s = raw ? (JSON.parse(raw) as GameState) : null;
    return s && s.version === 3 && s.phase.t !== "gameOver" ? s : null;
  } catch {
    return null;
  }
}

/** Stock Market's start screen: play online, or on this device. */
export default function Home() {
  const [players, setPlayers] = useState<PlayerSetup[]>([
    { name: "Player 1", isBot: false },
    { name: "Bot 1", isBot: true },
  ]);
  const [target, setTarget] = useState(DEFAULT_TARGET);
  const [botLevel, setBotLevel] = useState<BotLevel>("normal");
  const [game, setGame] = useState<{ key: number; state: GameState } | null>(null);
  const [saved, setSaved] = useState<GameState | null>(null);
  const [room, setRoom] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [lastRoom, setLastRoom] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>(onlineAvailable ? "online" : "local");

  useEffect(() => {
    // Reading storage and the URL must wait until we're in the browser.
    /* eslint-disable react-hooks/set-state-in-effect */
    setSaved(loadSaved());
    setName(readName());
    setLastRoom(readStorage(LAST_ROOM_KEY));
    const savedTab = readStorage(TAB_KEY);
    if (savedTab === "local" || (savedTab === "online" && onlineAvailable)) setTab(savedTab);
    const fromUrl = roomFromUrl();
    if (fromUrl && onlineAvailable) setRoom(fromUrl);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [game]);

  const openRoom = (code: string) => {
    writeStorage(LAST_ROOM_KEY, code);
    setLastRoom(code);
    setRoomInUrl(code);
    setRoom(code);
  };

  if (room) {
    return (
      <OnlineRoom
        key={room}
        code={room}
        name={name.trim() || "Player"}
        onQuit={() => {
          setRoomInUrl(null);
          setRoom(null);
        }}
      />
    );
  }

  if (game) {
    return <LocalGame key={game.key} initial={game.state} onQuit={() => setGame(null)} />;
  }

  const update = (i: number, patch: Partial<PlayerSetup>) =>
    setPlayers(players.map((p, j) => (j === i ? { ...p, ...patch } : p)));

  const start = () => {
    const clean = players.map((p, i) => ({ ...p, name: p.name.trim() || `Player ${i + 1}` }));
    setGame({ key: Date.now(), state: newGame(clean, target, botLevel) });
  };

  return (
    <main className="setup">
      <div className="setup-card">
        <h1 className="setup-logo">Stock Market</h1>
        <p className="muted">Buy low, sell high, and be first to ${fmt(target)}. For 2–8 players.</p>

        {onlineAvailable && (
          <div className="home-tabs" role="tablist" aria-label="How to play">
            {(
              [
                ["online", "Online"],
                ["local", "On this device"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                role="tab"
                aria-selected={tab === id}
                className={tab === id ? "on" : ""}
                onClick={() => {
                  setTab(id);
                  writeStorage(TAB_KEY, id);
                }}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {tab === "online" && onlineAvailable && (
          <OnlineStart
            createRoom={rooms.createRoom}
            name={name}
            setName={(n) => {
              setName(n);
              writeName(n);
            }}
            lastRoom={lastRoom}
            onOpenRoom={openRoom}
          />
        )}

        {tab === "local" && (
          <section className="local-start">
            {saved && (
              <div className="saved">
                <span>Game in progress · {saved.players.map((p) => p.name).join(", ")}</span>
                <button className="btn btn-primary" onClick={() => setGame({ key: Date.now(), state: saved })}>
                  Continue
                </button>
              </div>
            )}

            <form
              onSubmit={(e) => {
                e.preventDefault();
                start();
              }}
            >
              {players.map((p, i) => (
                <div key={i} className="setup-row">
                  <span className="token token-static" style={{ background: PLAYER_COLORS[i] }}>
                    {(p.name.trim() || "P").slice(0, 1).toUpperCase()}
                  </span>
                  <input
                    value={p.name}
                    maxLength={16}
                    aria-label={`Player ${i + 1} name`}
                    onChange={(e) => update(i, { name: e.target.value })}
                  />
                  <div className="seg" role="group" aria-label={`Player ${i + 1} type`}>
                    <button type="button" className={!p.isBot ? "on" : ""} onClick={() => update(i, { isBot: false })}>
                      Human
                    </button>
                    <button type="button" className={p.isBot ? "on" : ""} onClick={() => update(i, { isBot: true })}>
                      Bot
                    </button>
                  </div>
                  <button
                    type="button"
                    className="link small"
                    disabled={players.length <= MIN_PLAYERS}
                    onClick={() => setPlayers(players.filter((_, j) => j !== i))}
                    aria-label={`Remove player ${i + 1}`}
                  >
                    ✕
                  </button>
                </div>
              ))}
              {players.length < MAX_PLAYERS && (
                <div className="btn-row">
                  <button
                    type="button"
                    className="link"
                    onClick={() => setPlayers([...players, { name: `Player ${players.length + 1}`, isBot: false }])}
                  >
                    + Add player
                  </button>
                  <button
                    type="button"
                    className="link"
                    onClick={() =>
                      setPlayers([
                        ...players,
                        { name: `Bot ${players.filter((p) => p.isBot).length + 1}`, isBot: true },
                      ])
                    }
                  >
                    + Add bot
                  </button>
                </div>
              )}

              <label className="setup-target">
                <span>Winning amount</span>
                <select value={target} onChange={(e) => setTarget(Number(e.target.value))}>
                  {TARGETS.map((t) => (
                    <option key={t} value={t}>
                      ${fmt(t)}
                      {t === DEFAULT_TARGET ? " (standard)" : ""}
                    </option>
                  ))}
                </select>
              </label>
              {players.some((p) => p.isBot) && (
                <label className="setup-target">
                  <span>Bots</span>
                  <select value={botLevel} onChange={(e) => setBotLevel(e.target.value as BotLevel)}>
                    {BOT_LEVELS.map((l) => (
                      <option key={l} value={l}>
                        {BOT_LEVEL_NAMES[l]}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              <button type="submit" className="btn btn-primary btn-big">
                New game
              </button>
            </form>
          </section>
        )}

        <details className="rules">
          <summary>How to play</summary>
          <ul>
            <li>
              <b>Go to work.</b> Pick an occupation. Whenever <i>anyone</i> throws your numbers you&apos;re paid. Once
              you have $1,000 you start playing the market at your next turn.
            </li>
            <li>
              <b>Play the market.</b> Start on any START square (no fee). Each throw, move the way the arrow on the
              square you&apos;re leaving points. START: odd one way, even the other.
            </li>
            <li>
              <b>Land</b> and the market slider moves up or down. Then buy as many shares of that stock as you like at
              the new price (1 on limit squares). Own it already? Collect the dividend first.
            </li>
            <li>
              <b>Paired stocks.</b> The eight stocks come in four pairs that share one price ladder, flipped: when the
              market moves, one of each pair goes up and the other goes down.
            </li>
            <li>
              <b>Sell</b> at the board price just before your throw. After the throw you can still sell (for example to
              afford the stock you landed on), but only at the lowest price on the board, as with fees and SELL ALL
              squares. Your turn lasts until you press <b>End turn</b>.
            </li>
            <li>
              <b>Fees:</b> $100 for landing on START, $10 per share you own on a broker fee corner.
            </li>
            <li>
              <b>Shareholders&apos; meetings:</b> own the stock and you may detour in as you pass its entrance. Land on
              a space to get that many new shares for each share you own. Walk through and out the far end.
            </li>
            <li>
              <b>Win</b> by being worth the target (cash + stock at board price) at your turn to roll.
            </li>
          </ul>
        </details>

        <p className="small">
          <Link href="/" className="link small">
            ← All games
          </Link>
        </p>
      </div>
    </main>
  );
}

type Tab = "online" | "local";
