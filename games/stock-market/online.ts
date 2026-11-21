import type { Resolved as GenericResolved } from "@/platform/game";
import { botMove } from "./bot";
import { reducer, type Action, type GameState } from "./engine";

/**
 * Stock Market's side of online play (see platform/game.ts): the phone whose turn it is
 * applies the move with these rules, then saves the new state plus the list of actions it
 * applied. Every other phone replays those actions to animate the move.
 */

/** A player's choice. "rollDice" becomes a "roll" with the dice filled in. */
export type Decision = Action | { type: "rollDice" };

export type Resolved = GenericResolved<GameState, Action>;

const d6 = () => 1 + Math.floor(Math.random() * 6);

/**
 * Apply one decision, then keep stepping the token until the move needs another
 * decision or is over. Returns null if the decision isn't allowed right now.
 */
export function resolve(state: GameState, decision: Decision, rollDie: () => number = d6): Resolved | null {
  const first: Action = decision.type === "rollDice" ? { type: "roll", dice: [rollDie(), rollDie()] } : decision;
  let next = reducer(state, first);
  if (next === state) return null;
  const actions: Action[] = [first];
  // Movement is automatic; it pauses only for a decision (e.g. a meeting detour).
  for (let guard = 0; next.phase.t === "moving" && guard < 100; guard++) {
    next = reducer(next, { type: "step" });
    actions.push({ type: "step" });
  }
  return { state: next, actions };
}

/** Replays `actions` on `state` (used to check a saved move, and in tests). */
export function replay(state: GameState, actions: Action[]): GameState {
  return actions.reduce(reducer, state);
}

export function isBotTurn(state: GameState): boolean {
  const t = state.phase.t;
  return t !== "gameOver" && t !== "chooseCareers" && state.players[state.current].isBot;
}

/** The bot whose turn it is decides; null when it isn't a bot's turn. */
export function botDecision(state: GameState): Decision | null {
  return isBotTurn(state) ? botMove(state) : null;
}
