import type { StockId } from "./stocks";

/**
 * The outer track is a 13x13 ring of 48 squares, indexed clockwise starting
 * at the bottom-right corner:
 *
 *    24 25 ......... 35 36      TL = 24, TR = 36
 *    23                 37
 *    ..   (center)      ..
 *    13                 47
 *    12 11 ..........  1  0     BL = 12, BR = 0
 *
 * "cw" means index + 1, "ccw" means index - 1.
 *
 * On every turn the arrow printed on the square you START on decides which
 * way you move. START squares have two arrows: odd rolls go clockwise, even
 * rolls go counter-clockwise.
 */

export type Dir = "cw" | "ccw";
export type Side = "bottom" | "left" | "top" | "right";

export type Square =
  | { kind: "start"; side: Side }
  | { kind: "corner"; move: number; dir: Dir }
  | { kind: "stock"; stock: StockId; dividend: number; move: number; dir: Dir; entry?: boolean; limitOne?: boolean }
  | { kind: "sellAll"; stock: StockId; move: number; dir: Dir };

export const TRACK_LENGTH = 48;
export const GRID = 13;

const DIVIDEND: Record<StockId, number> = {
  ALCOA: 4,
  AMMO: 3,
  GMILLS: 1,
  ISHOE: 1,
  CASE: 2,
  MAYTAG: 2,
  WPUB: 3,
  WOOL: 4,
};

const stock = (id: StockId, move: number, dir: Dir, opts: { entry?: boolean; limitOne?: boolean } = {}): Square => ({
  kind: "stock",
  stock: id,
  dividend: DIVIDEND[id],
  move,
  dir,
  ...opts,
});
const sellAll = (id: StockId, move: number, dir: Dir): Square => ({ kind: "sellAll", stock: id, move, dir });
const corner = (move: number): Square => ({ kind: "corner", move, dir: "ccw" });

// Each side lists its 11 squares in clockwise order (START is always 6th).
const BOTTOM: Square[] = [
  sellAll("GMILLS", -5, "ccw"),
  stock("CASE", 4, "ccw"),
  stock("ISHOE", -3, "ccw", { entry: true, limitOne: true }),
  stock("WOOL", 2, "cw"),
  stock("WPUB", -1, "cw"),
  { kind: "start", side: "bottom" },
  stock("AMMO", -1, "cw"),
  stock("ALCOA", 2, "cw"),
  stock("GMILLS", -3, "cw", { entry: true, limitOne: true }),
  stock("MAYTAG", 4, "cw"),
  sellAll("ISHOE", -5, "cw"),
];

const LEFT: Square[] = [
  sellAll("AMMO", 5, "ccw"),
  stock("WOOL", -4, "ccw"),
  stock("WPUB", 3, "ccw", { entry: true, limitOne: true }),
  stock("CASE", -2, "cw"),
  stock("ISHOE", 1, "cw"),
  { kind: "start", side: "left" },
  stock("GMILLS", 1, "cw"),
  stock("MAYTAG", -2, "cw"),
  stock("AMMO", 3, "cw", { entry: true, limitOne: true }),
  stock("ALCOA", -4, "cw"),
  sellAll("WPUB", 5, "cw"),
];

const TOP: Square[] = [
  sellAll("CASE", -5, "ccw"),
  stock("ISHOE", 4, "ccw"),
  stock("MAYTAG", -3, "ccw", { entry: true, limitOne: true }),
  stock("WPUB", 2, "cw"),
  stock("WOOL", -1, "cw"),
  { kind: "start", side: "top" },
  stock("ALCOA", -1, "cw"),
  stock("AMMO", 2, "cw"),
  stock("CASE", -3, "cw", { entry: true, limitOne: true }),
  stock("GMILLS", 4, "cw"),
  sellAll("MAYTAG", -5, "cw"),
];

const RIGHT: Square[] = [
  sellAll("WOOL", 5, "ccw"),
  stock("AMMO", -4, "ccw"),
  stock("ALCOA", 3, "ccw", { entry: true, limitOne: true }),
  stock("GMILLS", -2, "cw"),
  stock("MAYTAG", 1, "cw"),
  { kind: "start", side: "right" },
  stock("CASE", 1, "cw"),
  stock("ISHOE", -2, "cw"),
  stock("WOOL", 3, "cw", { entry: true, limitOne: true }),
  stock("WPUB", -4, "cw"),
  sellAll("ALCOA", 5, "cw"),
];

export const TRACK: Square[] = [
  corner(-20), // 0  bottom-right
  ...BOTTOM, //   1-11
  corner(20), //  12 bottom-left
  ...LEFT, //     13-23
  corner(-20), // 24 top-left
  ...TOP, //      25-35
  corner(20), //  36 top-right
  ...RIGHT, //    37-47
];

export const START_SQUARES: number[] = TRACK.flatMap((sq, i) => (sq.kind === "start" ? [i] : []));

export function sideOf(index: number): Side | "corner" {
  if (index % 12 === 0) return "corner";
  if (index < 12) return "bottom";
  if (index < 24) return "left";
  if (index < 36) return "top";
  return "right";
}

/** Zero-based [row, col] of a track square on the 13x13 grid. */
export function gridPos(index: number): [number, number] {
  const last = GRID - 1;
  if (index === 0) return [last, last];
  if (index < 12) return [last, last - index];
  if (index === 12) return [last, 0];
  if (index < 24) return [last - (index - 12), 0];
  if (index === 24) return [0, 0];
  if (index < 36) return [0, index - 24];
  if (index === 36) return [0, last];
  return [index - 36, last];
}

export function step(index: number, dir: Dir): number {
  return (index + (dir === "cw" ? 1 : -1) + TRACK_LENGTH) % TRACK_LENGTH;
}

/** Direction a player standing on `index` moves for a given dice total. */
export function directionFor(index: number, total: number): Dir {
  const sq = TRACK[index];
  if (sq.kind === "start") return total % 2 === 1 ? "cw" : "ccw";
  return sq.dir;
}

/** Squares visited (excluding the origin), ending on the landing square. */
export function pathFor(index: number, total: number): { dir: Dir; path: number[] } {
  const dir = directionFor(index, total);
  const path: number[] = [];
  let at = index;
  for (let i = 0; i < total; i++) {
    at = step(at, dir);
    path.push(at);
  }
  return { dir, path };
}

export type Arrow = "←" | "→" | "↑" | "↓";

/** The on-screen arrow for moving `dir` from square `index`. */
export function arrowFor(index: number, dir: Dir): Arrow {
  const [r0, c0] = gridPos(index);
  const [r1, c1] = gridPos(step(index, dir));
  if (r1 < r0) return "↑";
  if (r1 > r0) return "↓";
  return c1 < c0 ? "←" : "→";
}

export function marketMove(index: number): number {
  const sq = TRACK[index];
  return sq.kind === "start" ? 0 : sq.move;
}

// ---- Inner board decoration: shareholders' meeting lanes & salary corners ----

export interface Lane {
  side: Side;
  /** The two outer-track squares that act as entrances, in screen order (left→right / top→bottom). */
  entries: [number, number];
  /** Split multipliers along the inner row, in screen order. */
  splits: number[];
}

export const LANES: Lane[] = [
  { side: "bottom", entries: [9, 3], splits: [3, 2, 3, 2, 3, 2, 3] },
  { side: "left", entries: [21, 15], splits: [2, 3, 2, 1, 2, 3, 2] },
  { side: "top", entries: [27, 33], splits: [3, 2, 3, 2, 3, 2, 3] },
  { side: "right", entries: [39, 45], splits: [2, 3, 2, 1, 2, 3, 2] },
];

/**
 * A meeting is walked "through and out": from the entrance you came in by,
 * across the 1 FOR 1 square at that end, along the row of split squares, to
 * the 1 FOR 1 at the far end, then out onto the far entrance.
 */
export const LANE_LENGTH = 9;

/** Screen cell id within a lane: "end0", "end1" or "in0".."in6". */
export type LaneCell = "end0" | "end1" | `in${number}`;

export function laneCell(from: 0 | 1, p: number): LaneCell {
  const k = from === 0 ? p : LANE_LENGTH - 1 - p;
  if (k === 0) return "end0";
  if (k === LANE_LENGTH - 1) return "end1";
  return `in${k - 1}`;
}

/** Shares received per share owned when landing on lane position `p`. */
export function laneSplit(laneIndex: number, from: 0 | 1, p: number): number {
  const cell = laneCell(from, p);
  if (cell === "end0" || cell === "end1") return 1;
  return LANES[laneIndex].splits[Number(cell.slice(2))];
}

/** The lane (and which end) whose entrance is track square `index`. */
export function laneAtEntrance(index: number): { lane: number; from: 0 | 1 } | null {
  for (let l = 0; l < LANES.length; l++) {
    const k = LANES[l].entries.indexOf(index);
    if (k !== -1) return { lane: l, from: k as 0 | 1 };
  }
  return null;
}

/** Direction to keep moving after leaving a lane by its far entrance. */
export function exitDirection(laneIndex: number, from: 0 | 1): Dir {
  const lane = LANES[laneIndex];
  const entry = lane.entries[from];
  const exit = lane.entries[1 - from];
  // Keep travelling away from the entrance we came in by.
  return (exit - entry + TRACK_LENGTH) % TRACK_LENGTH < TRACK_LENGTH / 2 ? "cw" : "ccw";
}

/** The stock whose shareholders' meeting starts at this entrance square. */
export function entranceStock(index: number): StockId | null {
  const sq = TRACK[index];
  return sq.kind === "stock" && sq.entry ? sq.stock : null;
}

export interface Career {
  name: string;
  rolls: [number, number];
  salary: number;
  corner: "tl" | "tr" | "bl" | "br";
  icon: string;
}

export const CAREERS: Career[] = [
  { name: "Policeman", rolls: [5, 9], salary: 100, corner: "tl", icon: "★" },
  { name: "Prospector", rolls: [2, 12], salary: 400, corner: "tr", icon: "⛏" },
  { name: "Doctor", rolls: [4, 10], salary: 200, corner: "bl", icon: "✚" },
  { name: "Deep Sea Diver", rolls: [3, 11], salary: 300, corner: "br", icon: "⚓" },
];
