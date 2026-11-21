import { describe, expect, it } from "vitest";
import { botMove } from "./bot";
import { CAREERS, TRACK, arrowFor, directionFor } from "./board";
import { newGame, reducer, netWorth, type Action, type GameState, type Pos } from "./engine";
import { lowestPrice, moveMarket, priceAt } from "./stocks";

const DOCTOR = CAREERS.findIndex((c) => c.name === "Doctor");

/** A new game with everyone already at work as a Policeman. */
function game(n = 2): GameState {
  const s = newGame(Array.from({ length: n }, (_, i) => ({ name: `P${i + 1}`, isBot: false })));
  return Array.from({ length: n }, (_, i) => i).reduce(
    (st, i) => reducer(st, { type: "chooseCareer", playerId: i, career: 0 }),
    s,
  );
}

function place(s: GameState, i: number, pos: Pos, cash = 1000): GameState {
  const players = s.players.map((p, k) => (k === i ? { ...p, status: "market" as const, pos, cash } : p));
  return { ...s, players };
}

function run(s: GameState, ...actions: Action[]): GameState {
  return actions.reduce(reducer, s);
}

/** Roll and walk every step (answers detours with `enter`). */
function rollAndMove(s: GameState, dice: [number, number], enter = false): GameState {
  s = reducer(s, { type: "roll", dice });
  for (let guard = 0; guard < 100; guard++) {
    if (s.phase.t === "moving") s = reducer(s, { type: "step" });
    else if (s.phase.t === "detour") s = reducer(s, { type: "detour", enter });
    else break;
  }
  return s;
}

describe("quotation board", () => {
  it("bounces off the top and bottom", () => {
    expect(moveMarket(45, 10)).toBe(45);
    expect(moveMarket(3, -5)).toBe(2);
    expect(moveMarket(25, 20)).toBe(45);
  });
  it("matches the printed quotation board", () => {
    // Ends and middle of each row (DOWN end, START, UP end).
    const rows: [Parameters<typeof priceAt>[0], number, number, number][] = [
      ["ALCOA", 30, 130, 230],
      ["AMMO", 10, 60, 110],
      ["CASE", 15, 45, 75],
      ["GMILLS", 18, 30, 42],
      ["WOOL", 230, 130, 30],
      ["WPUB", 110, 60, 10],
      ["MAYTAG", 75, 45, 15],
      ["ISHOE", 42, 30, 18],
    ];
    for (const [id, down, start, up] of rows) {
      expect([priceAt(id, 0), priceAt(id, 25), priceAt(id, 50)]).toEqual([down, start, up]);
    }
    // J.I. Case climbs $2 a space through the middle of the board.
    expect([20, 21, 22, 30, 31].map((l) => priceAt("CASE", l))).toEqual([35, 37, 39, 55, 56]);
    expect(lowestPrice("WPUB")).toBe(10);
    expect(lowestPrice("WOOL")).toBe(30);
  });
});

describe("choosing occupations", () => {
  it("everyone picks before the first roll, in any order", () => {
    let s = newGame([
      { name: "A", isBot: false },
      { name: "B", isBot: false },
      { name: "Bot", isBot: true },
    ]);
    expect(s.phase.t).toBe("chooseCareers");
    expect(s.players[2].career).not.toBeNull(); // bots pick automatically
    expect(reducer(s, { type: "roll", dice: [1, 1] })).toBe(s);
    s = reducer(s, { type: "chooseCareer", playerId: 1, career: 3 }); // B picks first
    expect(s.phase.t).toBe("chooseCareers");
    s = reducer(s, { type: "chooseCareer", playerId: 0, career: 2 });
    expect(s.phase).toEqual({ t: "preRoll" });
    expect(s.current).toBe(0);
  });
  it("bots can't be given an occupation, and an all-bot game starts straight away", () => {
    const s = newGame([
      { name: "A", isBot: false },
      { name: "Bot", isBot: true },
    ]);
    expect(reducer(s, { type: "chooseCareer", playerId: 1, career: 0 })).toBe(s);
    expect(
      newGame([
        { name: "X", isBot: true },
        { name: "Y", isBot: true },
      ]).phase.t,
    ).toBe("preRoll");
  });
});

describe("working", () => {
  it("pays every worker whose number is thrown, no matter who throws", () => {
    let s = game(2);
    s = run(s, { type: "setCareer", career: DOCTOR }, { type: "roll", dice: [1, 1] });
    s = run(s, { type: "setCareer", career: 0 }, { type: "roll", dice: [2, 2] }); // P2 throws a 4
    expect(s.players[0].cash).toBe(200);
    expect(s.players[1].cash).toBe(0);
  });
  it("can't play the market before earning $1,000", () => {
    let s = game(2);
    s = { ...s, players: s.players.map((p, i) => (i === 0 ? { ...p, career: DOCTOR, cash: 999 } : p)) };
    expect(reducer(s, { type: "goToMarket", start: 6 })).toBe(s);
  });
  it("must go to the market once they have $1,000", () => {
    let s = game(2);
    s = { ...s, players: s.players.map((p, i) => (i === 0 ? { ...p, career: DOCTOR, cash: 1000 } : p)) };
    expect(reducer(s, { type: "roll", dice: [2, 2] })).toBe(s);
    s = run(s, { type: "goToMarket", start: 6 }, { type: "roll", dice: [1, 2] });
    expect(s.phase.t).not.toBe("preRoll");
  });
});

describe("paired stocks", () => {
  it("each pair shares one ladder, inverted", () => {
    for (const [a, b] of [
      ["ALCOA", "WOOL"],
      ["AMMO", "WPUB"],
      ["CASE", "MAYTAG"],
      ["GMILLS", "ISHOE"],
    ] as const) {
      for (let l = 0; l <= 50; l++) expect(priceAt(b, l)).toBe(priceAt(a, 50 - l));
      expect(priceAt(a, 50)).toBeGreaterThan(priceAt(a, 0));
      expect(priceAt(b, 50)).toBeLessThan(priceAt(b, 0));
    }
  });
});

describe("board arrows", () => {
  it("match the original board on every square", () => {
    // Read square by square off the playtest board, in track order (0 = bottom-right corner,
    // then clockwise). "S" = START (checked separately).
    // prettier-ignore
    const expected = [
      "↑", "→", "→", "→", "←", "←", "S", "←", "←", "←", "←", "←", // bottom row, right to left
      "→", "↓", "↓", "↓", "↑", "↑", "S", "↑", "↑", "↑", "↑", "↑", // left side, bottom to top
      "↓", "←", "←", "←", "→", "→", "S", "→", "→", "→", "→", "→", // top row, left to right
      "←", "↑", "↑", "↑", "↓", "↓", "S", "↓", "↓", "↓", "↓", "↓", // right side, top to bottom
    ];
    TRACK.forEach((sq, i) => {
      if (sq.kind === "start") return;
      expect([i, arrowFor(i, sq.dir)]).toEqual([i, expected[i]]);
    });
    // START: odd / even arrows on each side.
    const starts: Record<number, [string, string]> = { 6: ["←", "→"], 18: ["↑", "↓"], 30: ["→", "←"], 42: ["↓", "↑"] };
    for (const [i, [odd, even]] of Object.entries(starts)) {
      expect([
        arrowFor(Number(i), directionFor(Number(i), 3)),
        arrowFor(Number(i), directionFor(Number(i), 4)),
      ]).toEqual([odd, even]);
    }
  });
});

describe("moving", () => {
  it("START sends odd rolls one way and even rolls the other", () => {
    const s = place(game(), 0, { kind: "track", index: 6 });
    const odd = rollAndMove(s, [1, 2]);
    expect(odd.players[0].pos).toEqual({ kind: "track", index: 9 });
    const even = rollAndMove(s, [1, 1]);
    expect(even.players[0].pos).toEqual({ kind: "track", index: 4 });
  });

  it("follows the arrow on the square being left", () => {
    // Square 2 (J.I. Case, bottom row) points toward the bottom-right corner.
    const s = rollAndMove(place(game(), 0, { kind: "track", index: 2 }), [1, 1]);
    expect(s.players[0].pos).toEqual({ kind: "track", index: 0 });
  });

  it("moves the slider and offers stock at the new price", () => {
    const s = rollAndMove(place(game(), 0, { kind: "track", index: 6 }), [1, 2]); // lands on General Mills, DOWN 3
    expect(s.market).toBe(22);
    expect(s.phase).toMatchObject({
      t: "afterRoll",
      buy: { stock: "GMILLS", price: priceAt("GMILLS", 22), limited: true, max: 1 },
    });
  });

  it("pays dividends on shares already owned", () => {
    let s = place(game(), 0, { kind: "track", index: 6 });
    s.players[0].shares.WOOL = 10;
    s = rollAndMove(s, [1, 1]); // even → back to square 4, Woolworth $4 DIV
    expect(s.players[0].cash).toBe(1040);
  });
});

describe("ending the turn", () => {
  it("waits for the player to end their turn after landing", () => {
    let s = place(game(), 0, { kind: "track", index: 11 }); // → broker fee corner
    s = rollAndMove(s, [1, 0] as unknown as [number, number]);
    expect(s.phase).toEqual({ t: "afterRoll", buy: null, fee: { amount: 0, reason: "broker fee" } });
    expect(s.current).toBe(0);
    s = reducer(s, { type: "endTurn" });
    expect(s.current).toBe(1);
    expect(s.phase.t).toBe("preRoll");
  });

  it("buying doesn't end the turn, and can be repeated up to what the player can afford", () => {
    let s = place(game(), 0, { kind: "track", index: 6 }, 1000);
    s = rollAndMove(s, [1, 1]); // Woolworth, no limit
    const price = (s.phase as Extract<typeof s.phase, { t: "afterRoll" }>).buy!.price;
    s = reducer(s, { type: "buy", qty: 2 });
    expect(s.phase).toMatchObject({ t: "afterRoll", buy: { bought: 2, max: Math.floor((1000 - 2 * price) / price) } });
    s = reducer(s, { type: "buy", qty: 1 });
    expect(s.players[0].shares.WOOL).toBe(3);
    expect(s.current).toBe(0);
  });

  it("limit squares allow only one share in total", () => {
    let s = place(game(), 0, { kind: "track", index: 6 }, 1000);
    s = rollAndMove(s, [1, 2]); // General Mills entrance, limit 1
    s = reducer(s, { type: "buy", qty: 1 });
    expect(s.phase).toMatchObject({ t: "afterRoll", buy: { bought: 1, max: 0 } });
    expect(reducer(s, { type: "buy", qty: 1 })).toBe(s);
  });
});

describe("selling after the throw", () => {
  it("can sell at the lowest price to raise cash for what you landed on", () => {
    let s = place(game(), 0, { kind: "track", index: 6 }, 0);
    s.players[0].shares.WPUB = 20;
    s = rollAndMove(s, [1, 1]); // even: back to square 4, Woolworth (no share limit)
    expect(s.phase).toMatchObject({ t: "afterRoll", buy: { stock: "WOOL", max: 0 } });
    s = reducer(s, { type: "forcedSell", stock: "WPUB", qty: 20 });
    expect(s.players[0].cash).toBe(20 * lowestPrice("WPUB"));
    expect(s.players[0].shares.WPUB).toBe(0);
    expect(s.phase.t).toBe("afterRoll");
    const ph = s.phase as Extract<typeof s.phase, { t: "afterRoll" }>;
    expect(ph.buy!.max).toBe(Math.floor(s.players[0].cash / ph.buy!.price));
  });

  it("can't sell at the board price after the throw", () => {
    let s = place(game(), 0, { kind: "track", index: 6 }, 0);
    s.players[0].shares.WPUB = 20;
    s = rollAndMove(s, [1, 1]);
    expect(reducer(s, { type: "sell", stock: "WPUB", qty: 1 })).toBe(s);
  });
});

describe("fees and forced sales", () => {
  it("charges $10 per share on broker fee corners", () => {
    let s = place(game(), 0, { kind: "track", index: 11 });
    s.players[0].shares.ALCOA = 7;
    s = rollAndMove(s, [1, 0] as unknown as [number, number]);
    expect(s.players[0].pos).toEqual({ kind: "track", index: 12 });
    expect(s.players[0].cash).toBe(1000 - 70);
  });

  it("sell-all squares sell at the lowest board price", () => {
    let s = place(game(), 0, { kind: "track", index: 2 });
    s.players[0].shares.GMILLS = 10;
    s = rollAndMove(s, [1, 0] as unknown as [number, number]); // square 1: Sell All General Mills
    expect(s.players[0].shares.GMILLS).toBe(0);
    expect(s.players[0].cash).toBe(1000 + 10 * lowestPrice("GMILLS"));
  });

  it("makes a short player sell at the lowest price, or go broke", () => {
    let s = place(game(), 0, { kind: "track", index: 11 }, 5);
    s.players[0].shares.WPUB = 20;
    s = rollAndMove(s, [1, 0] as unknown as [number, number]); // broker fee $200
    expect(s.phase).toMatchObject({ t: "raiseCash", owed: 200 });
    const sold = reducer(s, { type: "forcedSell", stock: "WPUB", qty: 20 });
    expect(sold.players[0].cash).toBe(5 + 20 * lowestPrice("WPUB") - 200);
    expect(sold.phase).toEqual({ t: "afterRoll", buy: null, fee: { amount: 200, reason: "broker fee" } }); // fee paid; player still ends their own turn
    const broke = reducer(s, { type: "goBroke" });
    expect(broke.players[0]).toMatchObject({ status: "work", cash: 0, pos: null });
  });
});

describe("shareholders' meetings", () => {
  it("detours owners into the meeting and pays a stock dividend", () => {
    let s = place(game(), 0, { kind: "track", index: 6 });
    s.players[0].shares.ISHOE = 5;
    s = rollAndMove(s, [3, 3], true); // 5, 4, 3 (entrance) → lane p0, p1, p2
    expect(s.players[0].pos).toEqual({ kind: "lane", lane: 0, from: 1, p: 2 });
    expect(s.players[0].shares.ISHOE).toBe(15); // landed on 2 FOR 1
    expect(s.market).toBe(25); // the slider doesn't move in a meeting
  });

  it("lets non-owners walk past", () => {
    const s = rollAndMove(place(game(), 0, { kind: "track", index: 6 }), [3, 3], true);
    expect(s.players[0].pos).toEqual({ kind: "track", index: 0 });
  });

  it("can't re-enter a meeting straight after leaving one", () => {
    let s = place(game(), 0, { kind: "lane", lane: 0, from: 1, p: 7 });
    s.players[0].shares.ISHOE = 1;
    s.players[0].shares.GMILLS = 1; // owns the stock at the far entrance too
    s = reducer(s, { type: "roll", dice: [1, 2] });
    const phases: string[] = [];
    while (s.phase.t === "moving") {
      s = reducer(s, { type: "step" });
      phases.push(s.phase.t);
    }
    expect(phases).not.toContain("detour");
    expect(s.players[0].pos).toEqual({ kind: "track", index: 10 });
  });

  it("can enter from the far entrance on a later turn after landing there", () => {
    let s = place(game(), 0, { kind: "lane", lane: 0, from: 1, p: 7 });
    s.players[0].shares.ISHOE = 1;
    s.players[0].shares.GMILLS = 1;
    s = rollAndMove(s, [1, 1]); // p8, then out onto the General Mills entrance
    expect(s.players[0].pos).toEqual({ kind: "track", index: 9 });
    s = { ...s, current: 0, phase: { t: "preRoll" } };
    s = reducer(s, { type: "roll", dice: [1, 2] });
    s = reducer(s, { type: "step" });
    expect(s.phase.t).toBe("detour");
  });

  it("can go round the corner into a different meeting on the same roll", () => {
    let s = place(game(), 0, { kind: "lane", lane: 0, from: 1, p: 7 });
    s.players[0].shares.ISHOE = 1;
    s.players[0].shares.GMILLS = 1; // the bottom meeting's far entrance: no turning straight back in
    s.players[0].shares.WPUB = 1; // the left meeting's entrance, round the corner
    s = reducer(s, { type: "roll", dice: [4, 5] }); // p8, out at 9, then 10 … 15
    const offers: string[] = [];
    while (s.phase.t === "moving") {
      s = reducer(s, { type: "step" });
      if (s.phase.t === "detour") {
        offers.push(s.phase.stock);
        break;
      }
    }
    expect(offers).toEqual(["WPUB"]);
    s = reducer(s, { type: "detour", enter: true });
    expect(s.players[0].pos).toMatchObject({ kind: "lane", lane: 1 });
  });

  it("exits by the far entrance and keeps going", () => {
    let s = place(game(), 0, { kind: "lane", lane: 0, from: 1, p: 7 });
    s.players[0].shares.ISHOE = 1;
    s = rollAndMove(s, [1, 2]);
    expect(s.players[0].pos).toEqual({ kind: "track", index: 10 });
  });
});

describe("winning", () => {
  it("wins when worth the target at their turn to roll", () => {
    let s = place(game(), 1, { kind: "track", index: 6 }, 100_000);
    s = run(s, { type: "setCareer", career: 0 }, { type: "roll", dice: [1, 1] });
    expect(s.phase).toMatchObject({ t: "gameOver", winnerId: 1 });
  });
});

describe("bot games", () => {
  it.each(["easy", "normal"] as const)(
    "play to completion (%s)",
    (level) => {
      const turns: number[] = [];
      for (let g = 0; g < 20; g++) {
        let s = newGame(
          Array.from({ length: 4 }, (_, i) => ({ name: `Bot ${i}`, isBot: true })),
          100_000,
          level,
        );
        for (let i = 0; i < 400_000 && s.phase.t !== "gameOver"; i++) {
          if (s.phase.t === "moving") {
            s = reducer(s, { type: "step" });
            continue;
          }
          const m = botMove(s);
          if (!m) throw new Error(`bot stuck in ${s.phase.t}`);
          const a: Action =
            m.type === "rollDice"
              ? { type: "roll", dice: [1 + Math.floor(Math.random() * 6), 1 + Math.floor(Math.random() * 6)] }
              : m;
          const next = reducer(s, a);
          if (next === s) throw new Error(`bot made an illegal move ${JSON.stringify(a)} in ${s.phase.t}`);
          s = next;
        }
        expect(s.phase.t).toBe("gameOver");
        for (const p of s.players) expect(p.cash).toBeGreaterThanOrEqual(0);
        turns.push(s.turn);
        void netWorth;
      }
      turns.sort((a, b) => a - b);
      console.log(`${level}: turns per 4-player game (min/median/max):`, turns[0], turns[10], turns[19]);
    },
    60_000,
  );
});

describe("sound cues", () => {
  const landing = (from: number) => rollAndMove(place(game(), 0, { kind: "track", index: from }), [1, 1]);
  const sounds = (s: GameState) => s.log.filter((e) => e.sound).map((e) => e.sound);

  it("marks landing on START, a PAY corner or a SELL ALL square as a loss", () => {
    expect(sounds(landing(4))).toEqual(["loss"]); // Woolworth → START (square 6)
    expect(sounds(landing(2))).toEqual(["loss"]); // J.I. Case → PAY corner (square 0)
    expect(sounds(landing(3))).toEqual(["loss"]); // Int. Shoe → SELL ALL General Mills (square 1)
  });

  it("marks trades as cash, but not the landing on an ordinary square", () => {
    let s = rollAndMove(place(game(), 0, { kind: "track", index: 6 }, 5000), [1, 2]); // General Mills (square 9)
    expect(sounds(s)).toEqual([]);
    s = run(s, { type: "buy", qty: 1 });
    expect(sounds(s)).toEqual(["cash"]);
  });
});
