"use client";

import { useCallback, useEffect, useReducer, useRef, useState, type ReactNode } from "react";
import { botMove } from "@/lib/bot";
import { CAREERS, START_SQUARES, TRACK, arrowFor, sideOf } from "@/lib/board";
import {
  canRoll,
  feeName,
  fmt,
  mustGoToMarket,
  netWorth,
  posName,
  reducer,
  type Action,
  type BuyOffer,
  type GameState,
  type Player,
} from "@/lib/engine";
import { playBell, playCash, playDice, playLoss, setSoundOn, useSoundOn } from "@/lib/sound";
import { STOCKS, STOCK_ORDER, lowestPrice, priceAt, type StockId } from "@/lib/stocks";
import Board from "./Board";
import ZoomableBoard from "./ZoomableBoard";
import { Die } from "./Dice";

export const SAVE_KEY = "stock-market:game:v3";

const ROLL_MS = 550;
/** Delay between each square a token steps through. */
export const STEP_MS = 200;
/** Bots "think" for a random time in this range (ms) before each decision. */
export const BOT_THINK_MS = [1000, 1900] as const;

const rollDie = () => 1 + Math.floor(Math.random() * 6);

/** Pass-and-play on one device: the rules run here, bots included, and the game autosaves. */
export default function LocalGame({ initial, onQuit }: { initial: GameState; onQuit: () => void }) {
  const [state, dispatch] = useReducer(reducer, initial);
  const [rolling, setRolling] = useState<[number, number] | null>(null);
  const rollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const current = state.players[state.current];
  const ph = state.phase;
  const botTurn = current.isBot && ph.t !== "gameOver";

  // Save after every change so a refresh doesn't lose the game.
  useEffect(() => {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(state));
    } catch {
      /* storage unavailable */
    }
  }, [state]);

  // Walk the token one square at a time.
  useEffect(() => {
    if (ph.t !== "moving") return;
    const t = setTimeout(() => dispatch({ type: "step" }), STEP_MS);
    return () => clearTimeout(t);
  }, [ph]);

  useEffect(
    () => () => {
      if (rollTimer.current) clearInterval(rollTimer.current);
    },
    [],
  );

  const roll = useCallback(() => {
    if (rolling || !canRoll(state)) return;
    rollTimer.current = animateRoll(setRolling, () => dispatch({ type: "roll", dice: [rollDie(), rollDie()] }));
  }, [rolling, state]);

  // Computer players.
  useEffect(() => {
    if (!botTurn || rolling || ph.t === "moving") return;
    const t = setTimeout(
      () => {
        const move = botMove(state);
        if (!move) return;
        if (move.type === "rollDice") roll();
        else dispatch(move);
      },
      BOT_THINK_MS[0] + Math.random() * (BOT_THINK_MS[1] - BOT_THINK_MS[0]),
    );
    return () => clearTimeout(t);
  }, [botTurn, rolling, ph, state, roll]);

  // The panel always shows a human's box (never a bot's): while occupations are chosen,
  // the next human still to pick; then the current player on a human turn, otherwise the
  // next human due to play. Only an all-bot game shows a bot.
  const choosing = ph.t === "chooseCareers";
  const viewer = choosing
    ? (state.players.find((p) => !p.isBot && p.career === null) ?? current)
    : current.isBot
      ? (nextHuman(state) ?? current)
      : current;
  const myTurn = choosing || (viewer.id === current.id && !botTurn);

  return (
    <GameView
      state={state}
      viewer={viewer}
      isTurn={myTurn}
      canAct={myTurn}
      rolling={rolling}
      dispatch={dispatch}
      roll={roll}
      onQuit={onQuit}
    />
  );
}

/**
 * Tumble the dice for at least ROLL_MS (and until `ready()` says the real roll is known),
 * then call `done`, which shows the real roll. The tumble stops in the same update, so the
 * dice never settle on stale faces first. Returns the interval so the caller can cancel it.
 */
export function animateRoll(
  setRolling: (d: [number, number] | null) => void,
  done: () => void,
  ready: () => boolean = () => true,
): ReturnType<typeof setInterval> {
  const started = Date.now();
  playDice();
  setRolling([rollDie(), rollDie()]);
  const timer = setInterval(() => {
    if (Date.now() - started < ROLL_MS || !ready()) {
      setRolling([rollDie(), rollDie()]);
      return;
    }
    clearInterval(timer);
    done();
    setRolling(null);
  }, 70);
  return timer;
}

export interface GameViewProps {
  state: GameState;
  /** The human whose box the panel shows. */
  viewer: Player;
  /** Whether it's `viewer`'s turn: show their controls (perhaps disabled) rather than "waiting". */
  isTurn: boolean;
  /** Whether `viewer` may act right now (nothing saving or animating). */
  canAct: boolean;
  /** Dice faces while tumbling, or null. */
  rolling: [number, number] | null;
  dispatch: (a: Action) => void;
  roll: () => void;
  onQuit: () => void;
  /** Extra items for the top bar (e.g. the room code). */
  headerExtra?: ReactNode;
  /** Shown in the player box instead of "Waiting for your turn…". */
  waitingNote?: string;
  /** A short status shown under the turn heading (e.g. "Saving…"). */
  statusNote?: string;
}

/** The game screen: board, dice, the viewer's box, players and ticker. Holds no game logic. */
export function GameView({
  state,
  viewer,
  isTurn,
  canAct,
  rolling,
  dispatch,
  roll,
  onQuit,
  headerExtra,
  waitingNote,
  statusNote,
}: GameViewProps) {
  const [pickingStart, setPickingStart] = useState(false);
  /** Phones: the slide-up sheet showing the full ticker ("log") or one player's details. */
  const [sheet, setSheet] = useState<"log" | number | null>(null);
  const current = state.players[state.current];
  const ph = state.phase;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest("button, input, select, textarea")) return;
      if ((e.key === " " || e.key === "Enter") && canAct) {
        e.preventDefault();
        setPickingStart(false);
        roll();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [roll, canAct]);

  const dice = rolling ?? state.dice;
  const diceTotal = !rolling && state.dice ? state.dice[0] + state.dice[1] : null;
  const winner = ph.t === "gameOver" ? state.players[ph.winnerId] : null;

  // Sounds tied to new log entries (not on load): ca-ching for trades, "womp womp" for costly squares.
  const lastLogId = useRef(state.log[0]?.id ?? -1);
  const newestLogId = state.log[0]?.id ?? -1;
  useEffect(() => {
    const seen = lastLogId.current;
    if (newestLogId === seen) return;
    lastLogId.current = newestLogId;
    if (newestLogId < seen) return; // a different or reloaded game
    const fresh = state.log.filter((e) => e.id > seen);
    if (fresh.some((e) => e.sound === "loss")) playLoss();
    if (fresh.some((e) => e.sound === "cash")) playCash();
  }, [newestLogId, state.log]);

  // Ring a bell once when a turn becomes this player's.
  const rungForTurn = useRef<number | null>(null);
  const myTurnStarts = isTurn && !viewer.isBot && current.id === viewer.id && ph.t === "preRoll";
  useEffect(() => {
    if (!myTurnStarts || rungForTurn.current === state.turn) return;
    rungForTurn.current = state.turn;
    playBell();
  }, [myTurnStarts, state.turn]);
  const round = Math.floor((state.turn - 1) / state.players.length) + 1;
  const ranked = [...state.players].sort((a, b) => netWorth(b, state.market) - netWorth(a, state.market));
  const rollAndClose = () => {
    setPickingStart(false);
    roll();
  };

  return (
    <div className="game">
      <header className="topbar">
        <h1>STOCK MARKET</h1>
        <div className="topbar-info">
          {/* Phones get the short form, e.g. "$100k · R6". */}
          <span className="t-long">
            First to <b>${fmt(state.target)}</b> · Round {round}
          </span>
          <span className="t-short">
            <b>{shortMoney(state.target)}</b> · R{round}
          </span>
          {headerExtra}
        </div>
        <GameMenu onQuit={onQuit} target={state.target} round={round} extra={headerExtra} />
      </header>
      {/* Phones: every player as a compact chip (you first); tap one for the details. */}
      {/* Phones: the latest ticker line (tap for the whole log) beside the other players. */}
      {/* Phones: ☰, the other players and the ticker on top; your money and stocks below. */}
      <div className="m-top">
        <GameMenu onQuit={onQuit} target={state.target} round={round} extra={headerExtra} />
        <div className="m-players" role="list">
          {state.players
            .filter((p) => p.id !== viewer.id)
            .map((p) => (
              <button
                key={p.id}
                role="listitem"
                className={`m-chip ${p.id === current.id && !winner ? "m-chip-current" : ""}`}
                onClick={() => setSheet(p.id)}
              >
                <span className="token token-static" style={{ background: p.color }}>
                  {p.name.slice(0, 1).toUpperCase()}
                </span>
                <span className="m-chip-text">
                  <b>{p.name}</b>
                  <span>${fmt(netWorth(p, state.market))}</span>
                </span>
              </button>
            ))}
        </div>
        <button className="m-ticker" onClick={() => setSheet("log")} aria-label="Open the ticker">
          {state.log[0] ? (
            <LogText state={state} entry={state.log[0]} />
          ) : (
            <span className="muted">Nothing has happened yet.</span>
          )}
        </button>
        <button
          className={`m-me-strip ${viewer.id === current.id && !winner ? "m-chip-current" : ""}`}
          onClick={() => setSheet(viewer.id)}
          aria-label="Your money and stocks"
        >
          <span className="token token-static" style={{ background: viewer.color }}>
            {viewer.name.slice(0, 1).toUpperCase()}
          </span>
          <span className="m-stat">
            <small>Cash</small>
            <b>${fmt(viewer.cash)}</b>
          </span>
          <span className="m-stat">
            <small>Worth</small>
            <b>${fmt(netWorth(viewer, state.market))}</b>
          </span>
          <span className="m-holdings">
            {STOCK_ORDER.filter((id) => viewer.shares[id] > 0)
              .sort((a, b) => viewer.shares[b] - viewer.shares[a]) // most shares first
              .map((id) => (
                <span key={id} className="m-pill" style={{ background: STOCKS[id].color, color: STOCKS[id].ink }}>
                  {STOCK_TAGS[id]} {fmt(viewer.shares[id])}
                </span>
              ))}
            {STOCK_ORDER.every((id) => viewer.shares[id] === 0) && <span className="muted">No stock yet</span>}
          </span>
        </button>
      </div>

      <ZoomableBoard>
        <Board
          players={state.players}
          currentId={current.id}
          market={state.market}
          marketDelta={state.lastMarketDelta}
          lastLanding={ph.t === "moving" ? null : state.lastLanding}
          diceTotal={diceTotal}
          dice={dice}
          rolling={!!rolling}
          onPickStart={
            pickingStart && canAct
              ? (start) => {
                  setPickingStart(false);
                  dispatch({ type: "goToMarket", start });
                }
              : undefined
          }
        />
      </ZoomableBoard>

      {/* Between the board and the sidebar: the dice and the viewer's turn controls. */}
      <div className="action-col">
        {/* Just the two dice; nothing until the first roll. */}
        {dice && (
          <div className="dice">
            <Die value={dice[0]} rolling={!!rolling} />
            <Die value={dice[1]} rolling={!!rolling} />
          </div>
        )}

        {winner ? (
          <section className="turn turn-over">
            <div className="turn-label">
              🏆 <b style={{ color: winner.color }}>{winner.name}</b> wins!
            </div>
            <ol className="standings">
              {ranked.map((p) => (
                <li key={p.id}>
                  <span style={{ color: p.color, fontWeight: 700 }}>{p.name}</span> — ${fmt(netWorth(p, state.market))}
                </li>
              ))}
            </ol>
            <button className="btn btn-primary" onClick={onQuit}>
              New game
            </button>
          </section>
        ) : (
          <section className="turn">
            <div className="turn-heading">
              {ph.t === "chooseCareers"
                ? "Choose an occupation"
                : isTurn
                  ? "Your turn"
                  : current.isBot
                    ? `${current.name} is playing`
                    : `${current.name}'s turn`}
              {statusNote && <span className="status-note">{statusNote}</span>}
            </div>
            {ph.t === "chooseCareers" ? (
              <CareerChoice state={state} viewer={viewer} disabled={!canAct} dispatch={dispatch} />
            ) : isTurn ? (
              <TurnControls
                state={state}
                player={current}
                disabled={!!rolling || !canAct}
                dispatch={dispatch}
                roll={rollAndClose}
                pickingStart={pickingStart}
                setPickingStart={setPickingStart}
              />
            ) : viewer.isBot ? (
              <BotTurn state={state} busy={!!rolling || ph.t === "moving"} />
            ) : (
              <div className="controls">
                <p className="hint muted">{waitingNote ?? "Waiting for your turn…"}</p>
                <button className="btn btn-primary btn-big" disabled>
                  Roll dice
                </button>
              </div>
            )}
          </section>
        )}
      </div>

      {/* Sidebar: ticker on top, other players below, and this device's player at the bottom. */}
      <aside className="sidebar">
        <section className="card log">
          <h2>Ticker</h2>
          {state.log.length === 0 ? (
            <p className="muted small">Nothing has happened yet.</p>
          ) : (
            <LogList state={state} />
          )}
        </section>

        <section className="card others">
          <ul className="players">
            {state.players
              .filter((p) => p.id !== viewer.id)
              .map((p) => (
                <PlayerRow key={p.id} p={p} market={state.market} active={p.id === current.id && !winner} />
              ))}
          </ul>
        </section>

        <MeCard p={viewer} market={state.market} active={viewer.id === current.id && !winner} />
      </aside>

      {sheet !== null && (
        <div className="m-sheet-backdrop" onClick={() => setSheet(null)}>
          <div className="m-sheet" role="dialog" onClick={(e) => e.stopPropagation()}>
            <button className="m-sheet-close" onClick={() => setSheet(null)} aria-label="Close">
              ×
            </button>
            {sheet === "log" ? (
              <section className="card log">
                <h2>Ticker</h2>
                <LogList state={state} />
              </section>
            ) : sheet === viewer.id ? (
              <MeCard p={viewer} market={state.market} active={viewer.id === current.id && !winner} />
            ) : (
              <section className="card others">
                <ul className="players">
                  <PlayerRow p={state.players[sheet]} market={state.market} active={sheet === current.id && !winner} />
                </ul>
              </section>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Short tags for the holdings pills on phones. */
const STOCK_TAGS: Record<StockId, string> = {
  ALCOA: "ALC",
  WOOL: "WOOL",
  AMMO: "AMC",
  WPUB: "WPB",
  CASE: "JIC",
  MAYTAG: "MAY",
  GMILLS: "GM",
  ISHOE: "ISH",
};

/** $100,000 → "$100k", $1,500,000 → "$1.5M". */
function shortMoney(n: number): string {
  if (n >= 1_000_000) return `$${+(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${+(n / 1_000).toFixed(1)}k`;
  return `$${n}`;
}

/** The ☰ button in the top bar: a small panel to turn sound on/off or quit the game. */
function GameMenu({
  onQuit,
  target,
  round,
  extra,
}: {
  onQuit: () => void;
  target: number;
  round: number;
  /** Extra game info (e.g. the online room code). */
  extra?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const soundOn = useSoundOn();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="topbar-menu game-menu">
      <button
        className="menu-button"
        onClick={() => setOpen(!open)}
        aria-label="Menu"
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <svg viewBox="0 0 20 20" width="22" height="22" aria-hidden>
          <path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        </svg>
      </button>
      {open && (
        <>
          <div className="menu-backdrop" onClick={() => setOpen(false)} />
          <div className="menu-panel" role="menu">
            <div className="menu-info">
              <span>
                First to <b>${fmt(target)}</b>
              </span>
              <span>
                Round <b>{round}</b>
              </span>
              {extra}
            </div>
            <button
              role="menuitemcheckbox"
              aria-checked={soundOn}
              className="menu-item"
              onClick={() => setSoundOn(!soundOn)}
            >
              <span>Sound</span>
              <span className={`switch ${soundOn ? "switch-on" : ""}`} aria-hidden>
                <span />
              </span>
            </button>
            <button
              role="menuitem"
              className="menu-item menu-quit"
              onClick={() => {
                setOpen(false);
                onQuit();
              }}
            >
              Quit game
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function LogText({ state, entry }: { state: GameState; entry: GameState["log"][number] }) {
  const p = entry.playerId !== null ? state.players[entry.playerId] : null;
  return (
    <span>
      {p && <b style={{ color: p.color }}>{p.name}</b>} {entry.text}
    </span>
  );
}

function LogList({ state }: { state: GameState }) {
  return (
    <ol>
      {state.log.map((e) => (
        <li key={e.id} className={e.tone ? `log-${e.tone}` : ""}>
          <LogText state={state} entry={e} />
        </li>
      ))}
    </ol>
  );
}

/** Game start: the viewer picks an occupation; the first roll waits for everyone. */
function CareerChoice({
  state,
  viewer,
  disabled,
  dispatch,
}: {
  state: GameState;
  viewer: Player;
  disabled: boolean;
  dispatch: (a: Action) => void;
}) {
  const waitingFor = state.players.filter((p) => p.career === null && p.id !== viewer.id);
  return (
    <div className="controls">
      <p className="hint">
        {viewer.career === null ? (
          <>
            <b>Choose your occupation.</b> You&apos;re paid whenever <i>anyone</i> throws your numbers. The first roll
            waits until everyone has picked.
          </>
        ) : (
          <>
            You&apos;re a <b>{CAREERS[viewer.career].name}</b>. You can still change before the first roll.
          </>
        )}
      </p>
      <div className="career-picks">
        <CareerPicks
          selected={viewer.career}
          disabled={disabled}
          onPick={(career) => dispatch({ type: "chooseCareer", playerId: viewer.id, career })}
        />
      </div>
      {waitingFor.length > 0 && (
        <p className="hint muted">Waiting for {waitingFor.map((p) => p.name).join(", ")} to choose…</p>
      )}
    </div>
  );
}

/** Occupation indices, cheapest salary first (the index itself is what the game stores). */
const CAREERS_BY_SALARY = CAREERS.map((_, i) => i).sort((a, b) => CAREERS[a].salary - CAREERS[b].salary);

/** The occupation buttons, $100 to $400. */
function CareerPicks({
  selected,
  disabled,
  onPick,
}: {
  selected: number | null;
  disabled: boolean;
  onPick: (career: number) => void;
}) {
  return (
    <>
      {CAREERS_BY_SALARY.map((i) => {
        const c = CAREERS[i];
        return (
          <button
            key={c.name}
            className={`career-pick ${selected === i ? "career-pick-on" : ""}`}
            disabled={disabled}
            onClick={() => onPick(i)}
          >
            <span className="pick-name">
              <span className="pick-icon">{c.icon}</span>
              {c.name}
            </span>
            <small>
              {c.rolls[0]} or {c.rolls[1]} · ${c.salary}
            </small>
          </button>
        );
      })}
    </>
  );
}

function nextHuman(state: GameState): Player | null {
  const n = state.players.length;
  for (let k = 1; k <= n; k++) {
    const p = state.players[(state.current + k) % n];
    if (!p.isBot) return p;
  }
  return null;
}

/** What a computer player is doing this turn (only shown in an all-bot game), without showing it the human controls. */
function BotTurn({ state, busy }: { state: GameState; busy: boolean }) {
  const p = state.players[state.current];
  const start = state.turnLogStart ?? 0;
  const done = state.log.filter((e) => e.id >= start && e.playerId === p.id).reverse();
  return (
    <div className="bot-turn">
      {done.length > 0 && (
        <ul className="bot-actions">
          {done.slice(-5).map((e) => (
            <li key={e.id} className={e.tone ? `log-${e.tone}` : ""}>
              {e.text}
            </li>
          ))}
        </ul>
      )}
      <p className="bot-status">
        🤖 <b>{p.name}</b> {busy ? <span>is moving…</span> : <span className="thinking">is thinking</span>}
      </p>
    </div>
  );
}

const SIDE_NAME = {
  bottom: "Bottom",
  left: "Left",
  top: "Top",
  right: "Right",
} as const;

function TurnControls({
  state,
  player,
  disabled,
  dispatch,
  roll,
  pickingStart,
  setPickingStart,
}: {
  state: GameState;
  player: Player;
  disabled: boolean;
  dispatch: (a: Parameters<typeof reducer>[1]) => void;
  roll: () => void;
  pickingStart: boolean;
  setPickingStart: (v: boolean) => void;
}) {
  const ph = state.phase;
  const [confirmDialog, confirm] = useConfirm();

  if (ph.t === "moving") return <p className="hint">Moving…</p>;

  if (ph.t === "preRoll" && player.status === "work") {
    const must = mustGoToMarket(player);
    return (
      <div className="controls">
        {must && (
          <p className="hint">
            You&apos;ve earned <b>${fmt(player.cash)}</b>. Time to play the market!
          </p>
        )}
        {!must && (
          <div className="career-picks">
            <CareerPicks
              selected={player.career}
              disabled={disabled}
              onPick={(career) => dispatch({ type: "setCareer", career })}
            />
          </div>
        )}
        {pickingStart ? (
          <div className="start-picks">
            <p className="hint">Pick a START square (or click one on the board). There&apos;s no fee to start.</p>
            <div className="btn-row">
              {START_SQUARES.map((i) => (
                <button
                  key={i}
                  className="btn"
                  disabled={disabled}
                  onClick={() => {
                    setPickingStart(false);
                    dispatch({ type: "goToMarket", start: i });
                  }}
                >
                  {SIDE_NAME[sideOf(i) as keyof typeof SIDE_NAME]}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="btn-row">
            {!must && (
              <button className="btn btn-primary" disabled={disabled || player.career === null} onClick={roll}>
                Roll for salary
              </button>
            )}
            {must && (
              <button className="btn btn-primary" disabled={disabled} onClick={() => setPickingStart(true)}>
                Play the market →
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  if (ph.t === "preRoll") {
    const pos = player.pos;
    const held = STOCK_ORDER.filter((id) => player.shares[id] > 0);
    let dirHint = "";
    if (pos?.kind === "track") {
      const sq = TRACK[pos.index];
      dirHint =
        sq.kind === "start"
          ? `odd ${arrowFor(pos.index, "cw")} · even ${arrowFor(pos.index, "ccw")}`
          : `you'll move ${arrowFor(pos.index, sq.dir)}`;
    } else if (pos) dirHint = "continuing through the meeting";
    return (
      <div className="controls">
        <p className="hint">
          On <b>{posName(pos)}</b>: {dirHint}
        </p>
        <div className="turn-actions">
          {held.length > 0 && (
            <Fold label="Sell">
              <div className="sell-box">
                <div className="small muted">Sell now at the board price (only before you roll):</div>
                {held.map((id) => (
                  <SellRow
                    key={id}
                    stock={id}
                    owned={player.shares[id]}
                    price={priceAt(id, state.market)}
                    disabled={disabled}
                    onSell={(qty) => dispatch({ type: "sell", stock: id, qty })}
                  />
                ))}
              </div>
            </Fold>
          )}
          <button className="btn btn-primary btn-big" disabled={disabled} onClick={roll}>
            Roll dice
          </button>
        </div>
        {!disabled && <div className="muted small">Space / Enter also rolls</div>}
      </div>
    );
  }

  if (ph.t === "detour") {
    return (
      <div className="controls">
        <p className="hint">
          Passing the <b>{STOCKS[ph.stock].name}</b> shareholders&apos; meeting. You own {player.shares[ph.stock]}{" "}
          shares — detour in for stock dividends? ({ph.remaining} {ph.remaining === 1 ? "step" : "steps"} left)
        </p>
        <div className="btn-row">
          <button
            className="btn btn-primary"
            disabled={disabled}
            onClick={() => dispatch({ type: "detour", enter: true })}
          >
            Enter meeting
          </button>
          <button className="btn" disabled={disabled} onClick={() => dispatch({ type: "detour", enter: false })}>
            Keep going
          </button>
        </div>
      </div>
    );
  }

  if (ph.t === "afterRoll") {
    return <AfterRollBox key={state.turn} state={state} disabled={disabled} dispatch={dispatch} />;
  }

  if (ph.t === "raiseCash") {
    const held = STOCK_ORDER.filter((id) => player.shares[id] > 0);
    return (
      <div className="controls">
        <p className="hint bad">
          {feeName(ph.reason).replace(/^./, (c) => c.toUpperCase())}: ${fmt(ph.owed)}. You have ${fmt(player.cash)}, so
          you need <b>${fmt(ph.owed - player.cash)} more</b>. Sell at the lowest price or go broke.
        </p>
        <div className="sell-box">
          {held.map((id) => (
            <SellRow
              key={id}
              stock={id}
              owned={player.shares[id]}
              price={lowestPrice(id)}
              disabled={disabled}
              // Selling to cover a fee is the only way out, so no "are you sure?" here.
              onSell={(qty) => dispatch({ type: "forcedSell", stock: id, qty })}
            />
          ))}
        </div>
        <button
          className="btn btn-danger"
          disabled={disabled}
          onClick={async () => {
            const ok = await confirm(
              "Go broke? You hand back all your cash and stock and go back to work.",
              "Go broke",
            );
            if (ok) dispatch({ type: "goBroke" });
          }}
        >
          Go broke (return everything, back to work)
        </button>
        {confirmDialog}
      </div>
    );
  }

  return null;
}

/**
 * After landing: optionally buy the stock landed on, sell at the lowest board price
 * (to raise cash or otherwise), then end the turn.
 */
function AfterRollBox({
  state,
  disabled,
  dispatch,
}: {
  state: GameState;
  disabled: boolean;
  dispatch: (a: Parameters<typeof reducer>[1]) => void;
}) {
  const ph = state.phase;
  const [qty, setQty] = useState(0);
  /** Sales the player set a quantity for but hasn't made yet (asked about before ending the turn). */
  const [pendingSales, setPendingSales] = useState<Partial<Record<StockId, number>>>({});
  const [confirmDialog, confirm] = useConfirm();
  if (ph.t !== "afterRoll") return null;
  const offer = ph.buy;
  const fee = ph.fee;
  const player = state.players[state.current];
  const held = STOCK_ORDER.filter((id) => player.shares[id] > 0);
  const setPending = (id: StockId, n: number | null) =>
    setPendingSales((prev) => {
      const next = { ...prev };
      if (n === null) delete next[id];
      else next[id] = n;
      return next;
    });

  const endTurn = async () => {
    const unsold = STOCK_ORDER.filter((id) => pendingSales[id] && player.shares[id] > 0).map(
      (id) => `${fmt(Math.min(pendingSales[id]!, player.shares[id]))} ${STOCKS[id].name}`,
    );
    const unbought = offer && !offer.limited && Math.min(qty, offer.max) > 0 ? Math.min(qty, offer.max) : 0;
    const pending = [
      ...(unsold.length ? [`sell ${unsold.join(" and ")}`] : []),
      ...(unbought ? [`buy ${fmt(unbought)} ${STOCKS[offer!.stock].name}`] : []),
    ];
    if (
      pending.length &&
      !(await confirm(`You were about to ${pending.join(" and ")} but didn't. End your turn anyway?`, "End turn"))
    )
      return;
    dispatch({ type: "endTurn" });
  };

  return (
    <div className="controls">
      {/* Phones skip this line when there's an offer: the buy line already names the square. */}
      <p className={`hint ${offer ? "m-hide" : ""}`}>
        Landed on <b>{posName(player.pos)}</b>.
        {fee ? (
          fee.amount > 0 ? (
            <>
              {" "}
              You paid <b>${fmt(fee.amount)}</b> for the {feeName(fee.reason)}.
            </>
          ) : (
            " You have no stock, so there's no broker fee."
          )
        ) : offer ? (
          ""
        ) : (
          " Nothing to buy here."
        )}{" "}
        <span className="m-hide">You can still sell (at the lowest board price) before you end your turn.</span>
      </p>

      {offer && (
        <BuyControls
          offer={offer}
          qty={qty}
          setQty={setQty}
          disabled={disabled}
          onBuy={(n) => {
            dispatch({ type: "buy", qty: n });
            setQty(0);
          }}
        />
      )}

      <div className="turn-actions">
        {held.length > 0 && (
          <Fold label="Sell">
            <div className="sell-box sell-low">
              <div className="small muted">
                Sell after the throw, at the <b>lowest board price</b>:
              </div>
              {held.map((id) => (
                <SellRow
                  key={`${id}-${player.shares[id]}`}
                  stock={id}
                  owned={player.shares[id]}
                  price={lowestPrice(id)}
                  disabled={disabled}
                  onChange={(q) => setPending(id, q)}
                  onSell={async (q) => {
                    if (!(await confirmLowSale(confirm, state, id, q))) return;
                    setPending(id, null);
                    dispatch({ type: "forcedSell", stock: id, qty: q });
                  }}
                />
              ))}
            </div>
          </Fold>
        )}

        <button className="btn btn-primary btn-big" disabled={disabled} onClick={endTurn}>
          End turn
        </button>
      </div>
      {confirmDialog}
    </div>
  );
}

function BuyControls({
  offer,
  qty,
  setQty,
  disabled,
  onBuy,
}: {
  offer: BuyOffer;
  qty: number;
  setQty: (n: number) => void;
  disabled: boolean;
  onBuy: (n: number) => void;
}) {
  const stock = STOCKS[offer.stock];
  const set = (n: number) => setQty(Math.max(0, Math.min(offer.max, Math.floor(n) || 0)));
  // Limit squares buy exactly one share once it's affordable.
  const n = offer.limited ? offer.max : Math.min(qty, offer.max);
  let note: string;
  if (offer.limited && offer.bought > 0) note = " — you've bought your 1 share.";
  else if (offer.max === 0) note = " — you can't afford a share right now.";
  else if (offer.limited) note = " — limit 1 share here.";
  else note = ` — up to ${fmt(offer.max)}.`;

  return (
    <div className="buy-box">
      <p className="hint">
        Buy <b>{stock.name}</b> at <b>${offer.price}</b>/share{note}
        {offer.bought > 0 && !offer.limited && <> (bought {fmt(offer.bought)} so far)</>}
      </p>
      {!offer.limited && offer.max > 0 && (
        <div className="qty">
          <button className="btn btn-sq" disabled={disabled} onClick={() => set(qty - 1)} aria-label="One fewer">
            −
          </button>
          <input
            type="number"
            min={0}
            max={offer.max}
            value={Math.min(qty, offer.max)}
            disabled={disabled}
            onChange={(e) => set(Number(e.target.value))}
            aria-label="Shares to buy"
          />
          <button className="btn btn-sq" disabled={disabled} onClick={() => set(qty + 1)} aria-label="One more">
            +
          </button>
          <button className="link small" disabled={disabled} onClick={() => set(Math.floor(offer.max / 2))}>
            Half
          </button>
          <button className="link small" disabled={disabled} onClick={() => set(offer.max)}>
            Max
          </button>
        </div>
      )}
      {offer.max > 0 && (
        <button className="btn" disabled={disabled || n === 0} onClick={() => onBuy(n)}>
          Buy {n} for ${fmt(n * offer.price)}
        </button>
      )}
    </div>
  );
}

function SellRow({
  stock,
  owned,
  price,
  disabled,
  onSell,
  onChange,
}: {
  stock: keyof typeof STOCKS;
  owned: number;
  price: number;
  disabled: boolean;
  onSell: (qty: number) => void;
  /** The player typed a quantity: the sale it would make (null once cleared). */
  onChange?: (qty: number | null) => void;
}) {
  const [qty, setQty] = useState(owned);
  const n = Math.max(1, Math.min(owned, qty || 1));
  const s = STOCKS[stock];
  return (
    <div className="sell-row">
      <span className="chip" style={{ background: s.color, color: s.ink }}>
        {s.name}
      </span>
      <span className="small muted">
        {owned} @ ${price}
      </span>
      <input
        type="number"
        min={1}
        max={owned}
        value={Math.min(qty, owned)}
        disabled={disabled}
        onChange={(e) => {
          const v = Number(e.target.value);
          setQty(v);
          onChange?.(v > 0 ? Math.min(v, owned) : null);
        }}
        aria-label={`Shares of ${s.name} to sell`}
      />
      {/* Selling all but one share keeps the right to enter that company's shareholders' meetings. */}
      <button
        className="btn btn-small sell-keep1"
        disabled={disabled || owned < 2}
        style={owned < 2 ? { visibility: "hidden" } : undefined}
        onClick={() => {
          setQty(owned - 1);
          onChange?.(owned - 1);
        }}
        title={`Sell all but one ${s.name} share, so you can still use its shareholders' meetings`}
        aria-label={`Sell all but one ${s.name} share`}
      >
        Keep 1
      </button>
      <button className="btn btn-small" disabled={disabled} onClick={() => onSell(n)}>
        Sell ${fmt(n * price)}
      </button>
    </div>
  );
}

/** This device's player: a larger box with their money, whereabouts and holdings. */
/** On phones, tucks optional controls behind a toggle; on desktop, shows them as they are. */
/**
 * Optional controls (selling). Desktop and very tall phones show them inline; other phones
 * show a toggle that opens them in a slide-up sheet, so the turn card never overflows.
 */
function Fold({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`fold ${open ? "fold-open" : ""}`}>
      <button className="btn fold-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
        {label} {open ? "▴" : "▾"}
      </button>
      {open && <div className="fold-backdrop" onClick={() => setOpen(false)} />}
      <div className="fold-body">
        <div className="fold-head">
          <b>{label}</b>
          <button className="btn btn-small" onClick={() => setOpen(false)}>
            Done
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Ask before any optional sale at the lowest board price (selling to cover a fee doesn't ask). */
async function confirmLowSale(
  confirm: (text: string, yes: string) => Promise<boolean>,
  state: GameState,
  stock: StockId,
  qty: number,
): Promise<boolean> {
  const low = lowestPrice(stock) * qty;
  const board = priceAt(stock, state.market) * qty;
  const loss =
    board > low ? ` At the board price they're worth $${fmt(board)}, so you'd lose $${fmt(board - low)}.` : "";
  return confirm(
    `Sell ${fmt(qty)} ${STOCKS[stock].name} at the lowest price for $${fmt(low)}?${loss}`,
    `Sell for $${fmt(low)}`,
  );
}

/** A small in-app "are you sure?" dialog: returns the dialog element and an ask() that resolves to the answer. */
function useConfirm(): [ReactNode, (text: string, yes: string) => Promise<boolean>] {
  const [req, setReq] = useState<{ text: string; yes: string; resolve: (ok: boolean) => void } | null>(null);
  const ask = useCallback(
    (text: string, yes: string) => new Promise<boolean>((resolve) => setReq({ text, yes, resolve })),
    [],
  );
  const answer = (ok: boolean) => {
    req?.resolve(ok);
    setReq(null);
  };
  const dialog = req && (
    <div className="confirm-backdrop" onClick={() => answer(false)}>
      <div className="confirm" role="alertdialog" aria-modal onClick={(e) => e.stopPropagation()}>
        <p>{req.text}</p>
        <div className="confirm-buttons">
          <button className="btn" onClick={() => answer(false)}>
            Cancel
          </button>
          <button className="btn btn-danger" onClick={() => answer(true)} autoFocus>
            {req.yes}
          </button>
        </div>
      </div>
    </div>
  );
  return [dialog, ask];
}

function MeCard({ p, market, active }: { p: Player; market: number; active: boolean }) {
  const held = STOCK_ORDER.filter((id) => p.shares[id] > 0);
  const where =
    p.status === "work" ? (p.career !== null ? `At work · ${CAREERS[p.career].name}` : "At work") : posName(p.pos);
  return (
    <section className={`card me ${active ? "me-active" : ""}`}>
      <div className="me-top">
        <span className="token token-static token-big" style={{ background: p.color }}>
          {p.name.slice(0, 1).toUpperCase()}
        </span>
        <div className="me-name">
          <b>{p.name}</b>
          <span className="muted small">{where}</span>
        </div>
        {active && <span className="tag me-turn">YOUR TURN</span>}
      </div>
      <div className="me-money">
        <div>
          <span className="muted small">Cash</span>
          <b>${fmt(p.cash)}</b>
        </div>
        <div>
          <span className="muted small">Net worth</span>
          <b>${fmt(netWorth(p, market))}</b>
        </div>
      </div>
      {held.length > 0 ? (
        <table className="me-holdings">
          <tbody>
            {held.map((id) => (
              <tr key={id}>
                <td>
                  <span
                    className="chip"
                    style={{
                      background: STOCKS[id].color,
                      color: STOCKS[id].ink,
                    }}
                  >
                    {STOCKS[id].name}
                  </span>
                </td>
                <td className="num">×{fmt(p.shares[id])}</td>
                <td className="num muted">${priceAt(id, market)}</td>
                <td className="num">${fmt(p.shares[id] * priceAt(id, market))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="muted small me-empty">No stock yet.</p>
      )}
    </section>
  );
}

function PlayerRow({ p, market, active }: { p: Player; market: number; active: boolean }) {
  const held = STOCK_ORDER.filter((id) => p.shares[id] > 0);
  return (
    <li className={active ? "players-current" : ""}>
      <div className="players-top">
        <span className="token token-static" style={{ background: p.color }}>
          {p.name.slice(0, 1).toUpperCase()}
        </span>
        <span className="players-name">
          <span>
            {p.name} {p.isBot && <span className="tag">BOT</span>}
          </span>
          <span className="muted small players-where">
            {p.status === "work"
              ? p.career !== null
                ? `At work · ${CAREERS[p.career].name}`
                : "At work"
              : posName(p.pos)}
          </span>
        </span>
        <span className="players-money">
          <b>${fmt(netWorth(p, market))}</b>
          <span className="muted small">${fmt(p.cash)} cash</span>
        </span>
      </div>
      {held.length > 0 && (
        <div className="chips">
          {held.map((id) => (
            <span key={id} className="chip" style={{ background: STOCKS[id].color, color: STOCKS[id].ink }}>
              {STOCKS[id].name} ×{p.shares[id]}
            </span>
          ))}
        </div>
      )}
    </li>
  );
}
