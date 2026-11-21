"use client";

import type { CSSProperties, ReactNode } from "react";
import { Die } from "@/platform/Dice";
import {
  CAREERS,
  GRID,
  LANES,
  TRACK,
  TRACK_LENGTH,
  arrowFor,
  gridPos,
  laneCell,
  sideOf,
  type Career,
  type Lane,
  type Side,
} from "../board";
import type { Player, Pos } from "../engine";
import { STOCKS, lowestPrice } from "../stocks";
import PriceTracker from "./PriceTracker";

interface BoardProps {
  players: Player[];
  currentId: number;
  market: number;
  marketDelta: number;
  lastLanding: Pos | null;
  diceTotal: number | null;
  /** When set, START squares are clickable (choosing where to start). */
  onPickStart?: (index: number) => void;
  /** Phones show the dice on the board, under the price tracker. */
  dice?: [number, number] | null;
  rolling?: boolean;
}

const at = (row: number, col: number, rowSpan = 1, colSpan = 1): CSSProperties => ({
  gridRow: `${row + 1} / span ${rowSpan}`,
  gridColumn: `${col + 1} / span ${colSpan}`,
});

// Corners are a little larger than regular squares.
const TEMPLATE = `1.45fr repeat(${GRID - 2}, 1fr) 1.45fr`;

/*
 * Inner grid (spans the 11 track-square widths inside the corners). Each meeting lane is
 * two shallow strips (0.55 of a square deep, like the printed board), then a spacer, so
 * the 7 middle tracks still line up with the track squares around them.
 */
const LANE_DEPTH = 0.55;
const SPACER = 2 - 2 * LANE_DEPTH;
const INNER = `${LANE_DEPTH}fr ${LANE_DEPTH}fr ${SPACER}fr repeat(7, 1fr) ${SPACER}fr ${LANE_DEPTH}fr ${LANE_DEPTH}fr`;

/*
 * Outline of the open field inside the track, in inner-grid units (the inner grid is 11
 * track-square widths across). It follows the track's inner edge and steps around the
 * four meeting lanes, which span squares 2–9 and are 2 × LANE_DEPTH deep.
 */
const L = 2 * LANE_DEPTH;
const FIELD_LINE =
  [
    [0, 0],
    [2, 0],
    [2, L],
    [9, L],
    [9, 0],
    [11, 0],
    [11, 2],
    [11 - L, 2],
    [11 - L, 9],
    [11, 9],
    [11, 11],
    [9, 11],
    [9, 11 - L],
    [2, 11 - L],
    [2, 11],
    [0, 11],
    [0, 9],
    [L, 9],
    [L, 2],
    [0, 2],
  ]
    .map(([x, y], i) => `${i ? "L" : "M"}${x} ${y}`)
    .join(" ") + " Z";

/** Key for any cell a token can sit on. */
function posKey(pos: Pos): string {
  return pos.kind === "track" ? `t${pos.index}` : `l${pos.lane}:${laneCell(pos.from, pos.p)}`;
}

export default function Board({
  players,
  currentId,
  market,
  marketDelta,
  lastLanding,
  diceTotal,
  onPickStart,
  dice,
  rolling,
}: BoardProps) {
  const byCell = new Map<string, Player[]>();
  for (const p of players) {
    const key = p.status === "market" && p.pos ? posKey(p.pos) : p.career !== null ? `c${p.career}` : null;
    if (key) byCell.set(key, [...(byCell.get(key) ?? []), p]);
  }
  const tokens = (key: string) => <Tokens players={byCell.get(key) ?? []} currentId={currentId} />;
  const landed = lastLanding ? posKey(lastLanding) : null;

  return (
    <div className="board" style={{ gridTemplateColumns: TEMPLATE, gridTemplateRows: TEMPLATE }}>
      {Array.from({ length: TRACK_LENGTH }, (_, i) => {
        const [r, c] = gridPos(i);
        const pickable = !!onPickStart && TRACK[i].kind === "start";
        return (
          <TrackSquare
            key={i}
            index={i}
            style={at(r, c)}
            landing={landed === `t${i}`}
            onClick={pickable ? () => onPickStart(i) : undefined}
          >
            {tokens(`t${i}`)}
          </TrackSquare>
        );
      })}

      {/* Everything inside the track lives on its own grid, so the meeting lanes can be
          shallow (like the printed board) while still lining up with the track squares. */}
      <div
        className="board-inner"
        style={{ ...at(1, 1, GRID - 2, GRID - 2), gridTemplateColumns: INNER, gridTemplateRows: INNER }}
      >
        {LANES.map((lane, l) => (
          <MeetingLane key={lane.side} lane={lane} laneIndex={l} landed={landed} tokens={tokens} />
        ))}

        {/* The thick black line around the inside of the track, stepping in around each meeting lane. */}
        <svg className="field-line" viewBox="0 0 11 11" preserveAspectRatio="none" aria-hidden>
          <path d={FIELD_LINE} />
        </svg>

        {CAREERS.map((career, i) => (
          <CareerCorner
            key={career.name}
            career={career}
            // Only light up an occupation the throw paid: someone still at work in it.
            active={
              diceTotal !== null &&
              career.rolls.includes(diceTotal) &&
              players.some((p) => p.status === "work" && p.career === i)
            }
          >
            {tokens(`c${i}`)}
          </CareerCorner>
        ))}

        <div className="board-center" style={at(3, 2, 7, 9)}>
          <div className="logo">STOCK MARKET</div>
          <PriceTracker market={market} delta={marketDelta} />
          <div className="logo logo-flipped" aria-hidden>
            STOCK MARKET
          </div>
          {dice && (
            <div className="board-dice">
              <Die value={dice[0]} rolling={rolling} />
              <Die value={dice[1]} rolling={rolling} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function moveLabel(move: number) {
  return move > 0 ? `UP ${move}` : `DOWN ${-move}`;
}

function TrackSquare({
  index,
  style,
  landing,
  onClick,
  children,
}: {
  index: number;
  style: CSSProperties;
  landing: boolean;
  onClick?: () => void;
  children: ReactNode;
}) {
  const sq = TRACK[index];
  const side = sideOf(index);
  const entry = sq.kind === "stock" && sq.entry ? `sq-entry sq-entry-${side}` : "";
  const cls = ["sq", `sq-${side}`, entry, landing ? "sq-landing" : "", onClick ? "sq-pickable" : ""].join(" ");
  const common = {
    "data-index": index,
    onClick,
    role: onClick ? "button" : undefined,
    tabIndex: onClick ? 0 : undefined,
    onKeyDown: onClick ? (e: React.KeyboardEvent) => (e.key === "Enter" || e.key === " ") && onClick() : undefined,
  };

  if (sq.kind === "start") {
    return (
      <div className={`${cls} sq-start`} style={style} {...common} aria-label={onClick ? "Start here" : undefined}>
        <div className="sq-title start-title">START</div>
        <div className="sq-small">PAY $100 FEE</div>
        <div className="start-arrows">
          <span>
            {arrowFor(index, "cw")} <small>ODD</small>
          </span>
          <span>
            <small>EVEN</small> {arrowFor(index, "ccw")}
          </span>
        </div>
        {children}
      </div>
    );
  }

  if (sq.kind === "corner") {
    return (
      <div className={`${cls} sq-corner`} style={style} {...common}>
        <div className="corner-pay">PAY</div>
        <div className="sq-small">BROKER FEE $10 / SHARE</div>
        <div className="sq-move">
          <span className="sq-arrow">{arrowFor(index, sq.dir)}</span> {moveLabel(sq.move)}
        </div>
        {children}
      </div>
    );
  }

  const stock = STOCKS[sq.stock];
  const colors = { ...style, backgroundColor: stock.color, color: stock.ink };

  if (sq.kind === "sellAll") {
    return (
      <div className={`${cls} sq-sellall`} style={colors} {...common}>
        <div className="sq-small strong">SELL ALL</div>
        <div className="sq-title">{stock.short}</div>
        <div className="sq-small">AT ${lowestPrice(sq.stock)}/SH</div>
        <div className="sq-move">
          <span className="sq-arrow">{arrowFor(index, sq.dir)}</span> {moveLabel(sq.move)}
        </div>
        {children}
      </div>
    );
  }

  return (
    <div className={cls} style={colors} {...common}>
      {sq.entry && (
        <div className={`entry-arrow entry-arrow-${side}`} title="Shareholders' meeting entrance">
          <span>SHAREHOLDERS ENTER</span>
        </div>
      )}
      <div className="sq-small">${sq.dividend} DIV</div>
      <div className="sq-title">{stock.short}</div>
      {sq.limitOne && <div className="sq-tiny">LIMIT 1 SHARE</div>}
      <div className="sq-move">
        <span className="sq-arrow">{arrowFor(index, sq.dir)}</span> {moveLabel(sq.move)}
      </div>
      {children}
    </div>
  );
}

function Tokens({ players, currentId }: { players: Player[]; currentId: number }) {
  if (players.length === 0) return null;
  return (
    <div className={`tokens ${players.length > 3 ? "tokens-crowded" : ""}`}>
      {players.map((p) => (
        <div
          key={p.id}
          className={`token ${p.id === currentId ? "token-current" : ""}`}
          style={{ background: p.color }}
          title={p.name}
        >
          {p.name.slice(0, 1).toUpperCase()}
        </div>
      ))}
    </div>
  );
}

const LANE_BOX: Record<Side, { outer: [number, number]; inner: [number, number]; vertical: boolean }> = {
  // [row, col] of the lane's first cell, for the row nearest the track and the row nearest the center.
  // (Positions on the inner grid.)
  bottom: { outer: [12, 3], inner: [11, 3], vertical: false },
  top: { outer: [0, 3], inner: [1, 3], vertical: false },
  left: { outer: [3, 0], inner: [3, 1], vertical: true },
  right: { outer: [3, 12], inner: [3, 11], vertical: true },
};

function MeetingLane({
  lane,
  laneIndex,
  landed,
  tokens,
}: {
  lane: Lane;
  laneIndex: number;
  landed: string | null;
  tokens: (key: string) => ReactNode;
}) {
  const box = LANE_BOX[lane.side];
  const cell = (base: [number, number], offset: number, span = 1) =>
    box.vertical ? at(base[0] + offset, base[1], span, 1) : at(base[0], base[1] + offset, 1, span);
  const [a, b] = lane.entries.map((i) => {
    const sq = TRACK[i];
    return sq.kind === "stock" ? STOCKS[sq.stock].short : "";
  });
  const key = (c: string) => `l${laneIndex}:${c}`;
  const cls = (c: string, extra = "") =>
    `lane-cell ${box.vertical ? "lane-cell-v" : ""} ${extra} ${landed === key(c) ? "sq-landing" : ""}`;
  return (
    <>
      <div className={cls("end0")} style={cell(box.outer, 0)}>
        <span className="lane-text">1 FOR 1</span>
        {tokens(key("end0"))}
      </div>
      <div className={`lane-label ${box.vertical ? "lane-label-v" : ""}`} style={cell(box.outer, 1, 5)}>
        <span className="lane-sub">
          {a} <span aria-hidden>{box.vertical ? "↓" : "→"}</span>
        </span>
        <span className="lane-title">SHAREHOLDERS&apos; MEETING</span>
        <span className="lane-sub">
          <span aria-hidden>{box.vertical ? "↑" : "←"}</span> {b}
        </span>
      </div>
      <div className={cls("end1")} style={cell(box.outer, 6)}>
        <span className="lane-text">1 FOR 1</span>
        {tokens(key("end1"))}
      </div>
      {lane.splits.map((n, k) => (
        <div key={k} className={cls(`in${k}`, "lane-split")} style={cell(box.inner, k)}>
          <span className="lane-text">{n} FOR 1</span>
          {tokens(key(`in${k}`))}
        </div>
      ))}
    </>
  );
}

const CAREER_POS: Record<Career["corner"], [number, number]> = {
  tl: [0, 0],
  tr: [0, 10],
  bl: [10, 0],
  br: [10, 10],
};

function CareerCorner({ career, active, children }: { career: Career; active: boolean; children: ReactNode }) {
  const [r, c] = CAREER_POS[career.corner];
  return (
    <div className={`career ${active ? "career-active" : ""}`} style={at(r, c, 3, 3)}>
      <div className="career-icon">{career.icon}</div>
      <div className="career-name">{career.name.toUpperCase()}</div>
      <div className="career-rule">
        {career.rolls[0]} OR {career.rolls[1]} PAYS
        <br />${career.salary} SALARY
      </div>
      <div className="career-tokens">{children}</div>
    </div>
  );
}
