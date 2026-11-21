import type { OnlineGame, Seat } from "@/platform/game";
import { DEFAULT_TARGET, MAX_PLAYERS, MIN_PLAYERS, newGame, type BotLevel, type GameState } from "./engine";

export type StockMarketSettings = {
  /** Net worth that wins. */
  target: number;
  /** How well the room's bots play. */
  botLevel: BotLevel;
};

/** Winning amounts the start screen and lobby offer. */
export const TARGETS = [25_000, 50_000, 100_000, 250_000];

/** Who may save the next move: the current player, or anyone seated (null) while occupations are chosen. */
export function seatUid(state: GameState, seats: Seat[]): string | null {
  if (state.phase.t === "chooseCareers") return null;
  return seats[state.current]?.uid ?? null;
}

/** Stock Market as the platform sees it (online rooms). */
export const STOCK_MARKET: OnlineGame<GameState, StockMarketSettings> = {
  id: "stock-market",
  name: "Stock Market",
  collection: "stockMarketRooms",
  minPlayers: MIN_PLAYERS,
  maxPlayers: MAX_PLAYERS,
  defaultSettings: { target: DEFAULT_TARGET, botLevel: "normal" },
  newGame: (seats, settings) => newGame(seats, settings.target, settings.botLevel === "easy" ? "easy" : "normal"),
  writerUid: seatUid,
};
