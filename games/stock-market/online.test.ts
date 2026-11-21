import { describe, expect, it } from "vitest";
import { newGame, type GameState } from "./engine";
import { botDecision, resolve, replay } from "./online";

function market(): GameState {
  const s = newGame([
    { name: "A", isBot: false },
    { name: "B", isBot: true },
  ]);
  s.players[0] = { ...s.players[0], status: "market", career: 2, pos: { kind: "track", index: 6 }, cash: 1000 };
  s.phase = { t: "preRoll" };
  return s;
}

describe("resolve", () => {
  it("rolls and walks the whole move, recording every action", () => {
    const start = market();
    const r = resolve(start, { type: "rollDice" }, () => 1)!; // 1 + 1 = 2
    expect(r.actions[0]).toEqual({ type: "roll", dice: [1, 1] });
    expect(r.actions.slice(1)).toEqual([{ type: "step" }, { type: "step" }]);
    expect(r.state.phase.t).toBe("afterRoll");
    expect(r.state.players[0].pos).toEqual({ kind: "track", index: 4 });
  });

  it("replaying the recorded actions gives the same state", () => {
    const start = market();
    const r = resolve(start, { type: "rollDice" })!;
    expect(replay(start, r.actions)).toEqual(r.state);
  });

  it("rejects moves that aren't allowed", () => {
    expect(resolve(market(), { type: "endTurn" })).toBeNull();
  });

  it("stops mid-move for a meeting detour decision", () => {
    const start = market();
    start.players[0].shares.ISHOE = 5;
    const r = resolve(start, { type: "rollDice" }, () => 3)!; // 6, even: 5, 4, 3 = Int. Shoe entrance
    expect(r.state.phase.t).toBe("detour");
    const after = resolve(r.state, { type: "detour", enter: true })!;
    expect(after.state.players[0].pos?.kind).toBe("lane");
  });
});

describe("bots", () => {
  it("decide only on their own turn", () => {
    const s = market();
    expect(botDecision(s)).toBeNull();
    const ended = resolve(resolve(s, { type: "rollDice" })!.state, { type: "endTurn" })!.state;
    expect(botDecision(ended)).not.toBeNull();
  });
});
