// The eight companies on the board. Names, colors and price ladders follow the playtest board.

export type StockId = "ALCOA" | "AMMO" | "GMILLS" | "ISHOE" | "CASE" | "MAYTAG" | "WPUB" | "WOOL";

export interface Stock {
  id: StockId;
  name: string;
  /** Short label that fits on a board square (\u00AD = optional hyphen). */
  short: string;
  color: string;
  /** Text color that reads on `color`. */
  ink: string;
  /**
   * Price at each slider position (index 0 = far "DOWN" end, 50 = far "UP" end).
   * Stocks come in four pairs that share one ladder, inverted: when the slider
   * goes up one of the pair rises and the other falls by the same steps.
   */
  ladder: readonly number[];
  /** The other stock in this stock's pair. */
  pair: StockId;
}

/*
 * Quotation board rows, copied from the playtest board.
 * Each is listed from the DOWN end of the board to the UP end; its partner uses the
 * same row reversed.
 */
// prettier-ignore
const ALCOA_WOOL = [
  30, 34, 38, 42, 46, 50, 54, 58, 62, 66, 70, 74, 78, 82, 86, 90, 94, 98, 102, 106, 110, 114, 118, 122, 126,
  130, 134, 138, 142, 146, 150, 154, 158, 162, 166, 170, 174, 178, 182, 186, 190, 194, 198, 202, 206, 210, 214, 218, 222, 226, 230,
];
// prettier-ignore
const AMMO_WPUB = [
  10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32, 34, 36, 38, 40, 42, 44, 46, 48, 50, 52, 54, 56, 58,
  60, 62, 64, 66, 68, 70, 72, 74, 76, 78, 80, 82, 84, 86, 88, 90, 92, 94, 96, 98, 100, 102, 104, 106, 108, 110,
];
// prettier-ignore
const CASE_MAYTAG = [
  15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 37, 39, 41, 43,
  45, 47, 49, 51, 53, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75,
];
// prettier-ignore
const GMILLS_ISHOE = [
  18, 18, 19, 19, 20, 20, 21, 21, 22, 22, 23, 23, 24, 24, 25, 25, 26, 26, 27, 27, 28, 28, 29, 29, 30,
  30, 30, 31, 31, 32, 32, 33, 33, 34, 34, 35, 35, 36, 36, 37, 37, 38, 38, 39, 39, 40, 40, 41, 41, 42, 42,
];
const up = (row: number[]) => row;
const down = (row: number[]) => [...row].reverse();

export const STOCKS: Record<StockId, Stock> = {
  ALCOA: { id: "ALCOA", name: "Alcoa", short: "ALCOA", color: "#e35b52", ink: "#2a1512", ladder: up(ALCOA_WOOL), pair: "WOOL" },
  WOOL: { id: "WOOL", name: "Woolworth", short: "WOOL\u00ADWORTH", color: "#e37358", ink: "#2a1512", ladder: down(ALCOA_WOOL), pair: "ALCOA" },
  AMMO: { id: "AMMO", name: "American Motors", short: "AM. MOTORS", color: "#ebbc57", ink: "#2b2210", ladder: up(AMMO_WPUB), pair: "WPUB" },
  WPUB: { id: "WPUB", name: "Western Publishing", short: "WESTERN PUBL.", color: "#90b670", ink: "#16240f", ladder: down(AMMO_WPUB), pair: "AMMO" },
  CASE: { id: "CASE", name: "J. I. Case", short: "J. I. CASE", color: "#e89c4b", ink: "#2b1a0b", ladder: up(CASE_MAYTAG), pair: "MAYTAG" },
  MAYTAG: { id: "MAYTAG", name: "Maytag", short: "MAYTAG", color: "#4faba0", ink: "#0e2522", ladder: down(CASE_MAYTAG), pair: "CASE" },
  GMILLS: { id: "GMILLS", name: "General Mills", short: "GEN. MILLS", color: "#54a6be", ink: "#0e2229", ladder: up(GMILLS_ISHOE), pair: "ISHOE" },
  ISHOE: { id: "ISHOE", name: "International Shoe", short: "INT. SHOE", color: "#d7649c", ink: "#2a0f1c", ladder: down(GMILLS_ISHOE), pair: "GMILLS" },
};

/**
 * Order of rows on the price tracker, as on the board: the four stocks that rise as the
 * slider moves UP sit above the slider row, the four that fall sit below it, mirrored so
 * each pair is the same distance from the middle.
 */
export const RISERS: StockId[] = ["ALCOA", "AMMO", "CASE", "GMILLS"];
export const FALLERS: StockId[] = ["ISHOE", "MAYTAG", "WPUB", "WOOL"];
export const STOCK_ORDER: StockId[] = [...RISERS, ...FALLERS];

export const MARKET_MIN = 0;
export const MARKET_MAX = 50;
/** The slider starts in the middle of the quotation board. */
export const MARKET_START = 25;

export function priceAt(stock: StockId, level: number): number {
  return STOCKS[stock].ladder[level - MARKET_MIN];
}

/** Price for a forced sale: the lowest price on the board for that stock. */
export function lowestPrice(stock: StockId): number {
  return Math.min(...STOCKS[stock].ladder);
}

/** 0 when the stock is at its cheapest on the board, 1 at its most expensive. */
export function pricePosition(stock: StockId, level: number): number {
  const lo = lowestPrice(stock);
  const hi = Math.max(...STOCKS[stock].ladder);
  return (priceAt(stock, level) - lo) / (hi - lo);
}

/**
 * Move the slider. If it hits the top or bottom of the board the direction of
 * counting reverses and the remaining spaces are counted the other way.
 */
export function moveMarket(level: number, delta: number): number {
  let l = level + delta;
  while (l > MARKET_MAX || l < MARKET_MIN) {
    if (l > MARKET_MAX) l = 2 * MARKET_MAX - l;
    if (l < MARKET_MIN) l = 2 * MARKET_MIN - l;
  }
  return l;
}
