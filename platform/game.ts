/**
 * What a game hands the shared platform so it can host online rooms for it.
 *
 * The platform has no game server (Firebase's free plan): the phone making a move applies
 * the game's own rules, then saves the new state plus the actions it applied, and every
 * other phone replays those actions. So each game's rules must be pure functions:
 * `reducer(state, action) -> state`, with dice rolls, card draws and other randomness
 * decided *before* the action is applied (inside `resolve`), never inside the reducer.
 */

export interface SeatSetup {
  name: string;
  isBot: boolean;
}

export interface Seat extends SeatSetup {
  /** The player's account, or null for a bot. */
  uid: string | null;
}

/** One move, fully decided: replayable action by action on any phone. */
export interface Resolved<S, A> {
  state: S;
  /** Every action applied, in order, with dice etc. filled in. */
  actions: A[];
}

export interface OnlineGame<S, Settings extends Record<string, unknown>> {
  /** URL slug and storage prefix, e.g. "stock-market" (the game lives at `/stock-market`). */
  id: string;
  /** Display name, e.g. "Stock Market". */
  name: string;
  /**
   * Firestore collection for this game's rooms, e.g. "stockMarketRooms". Each game gets its
   * own collection and its own block in firestore.rules.
   */
  collection: string;
  minPlayers: number;
  maxPlayers: number;
  /** Lobby options the host can change (e.g. a target score). Stored in the room's `settings`. */
  defaultSettings: Settings;
  /** The starting state, once the host starts the game. */
  newGame(seats: SeatSetup[], settings: Settings): S;
  /**
   * The account allowed to save the next move, or null when any seated player may (a bot's
   * turn, or a phase where everyone acts at once). The security rules enforce it.
   */
  writerUid(state: S, seats: Seat[]): string | null;
}
