import {
  CAREERS,
  LANES,
  LANE_LENGTH,
  START_SQUARES,
  TRACK,
  directionFor,
  entranceStock,
  exitDirection,
  laneAtEntrance,
  laneSplit,
  step as stepIndex,
  type Dir,
} from "./board";
import { MARKET_START, STOCKS, STOCK_ORDER, lowestPrice, moveMarket, priceAt, type StockId } from "./stocks";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export type Pos = { kind: "track"; index: number } | { kind: "lane"; lane: number; from: 0 | 1; p: number };

export type Holdings = Record<StockId, number>;

export interface Player {
  id: number;
  name: string;
  color: string;
  isBot: boolean;
  /** Index into CAREERS, or null until chosen. */
  career: number | null;
  status: "work" | "market";
  /** Board position while playing the market. */
  pos: Pos | null;
  cash: number;
  shares: Holdings;
}

export type Phase =
  /** Before the throw: pick/change occupation, go to market, or sell at board price. */
  /** Game start: every human picks an occupation (any order) before the first roll. */
  | { t: "chooseCareers" }
  | { t: "preRoll" }
  /**
   * `leftLane`: the meeting the player just walked out of this move. They can't turn straight
   * back into it from its other entrance, but may enter a different meeting further on.
   */
  | { t: "moving"; remaining: number; dir: Dir; skipDetourAt: number | null; leftLane: number | null }
  /** Passing (or leaving) an entrance for a stock the player owns. */
  | { t: "detour"; remaining: number; dir: Dir; stock: StockId; at: number }
  /**
   * After landing, until the player ends their turn. They may sell at the lowest board
   * price, and buy the stock they landed on (`buy`) if it was a stock square.
   */
  | { t: "afterRoll"; buy: BuyOffer | null; fee?: FeePaid }
  /** A fee is due and the player is short: sell at the lowest board price, or go broke. */
  | { t: "raiseCash"; owed: number; reason: string }
  | { t: "gameOver"; winnerId: number; reason: "target" };

/** A fee charged on landing this turn (amount 0: a broker fee with no shares to charge for). */
export interface FeePaid {
  amount: number;
  reason: string;
}

export interface BuyOffer {
  stock: StockId;
  price: number;
  limited: boolean;
  /** Shares the player can afford right now (0 once a limited square's share is bought). */
  max: number;
  /** Shares bought so far this turn. */
  bought: number;
}

export interface LogEntry {
  id: number;
  playerId: number | null;
  text: string;
  tone?: "up" | "down" | "money" | "bad";
  /** A sound to play when this entry appears: a trade ("cash") or a costly square ("loss"). */
  sound?: "cash" | "loss";
}

export interface GameState {
  version: 3;
  players: Player[];
  current: number;
  market: number;
  target: number;
  dice: [number, number] | null;
  phase: Phase;
  turn: number;
  lastLanding: Pos | null;
  lastMarketDelta: number;
  log: LogEntry[];
  nextLogId: number;
  /** First log id of the current turn (for showing what this turn's player did). */
  turnLogStart?: number;
  /** How well the computer players play (older saves: normal). */
  botLevel?: BotLevel;
}

export type BotLevel = "easy" | "normal";
export const BOT_LEVELS: BotLevel[] = ["easy", "normal"];
export const BOT_LEVEL_NAMES: Record<BotLevel, string> = { easy: "Easy", normal: "Normal" };

export interface PlayerSetup {
  name: string;
  isBot: boolean;
}

// Deep, slightly muted tones that sit with the cream board and the stock colors
// without matching any single stock.
export const PLAYER_COLORS = ["#1f3f6e", "#8e2f23", "#2d5a3d", "#a87412", "#5c3566", "#1e6670", "#9c4a1a", "#3a3a38"];
export const MAX_PLAYERS = 8;
export const MIN_PLAYERS = 2;
export const START_FEE = 100;
export const BROKER_FEE_PER_SHARE = 10;
/** Once a worker has this much they must start playing the market on their next turn. */
export const WORK_CAP = 1000;
export const DEFAULT_TARGET = 100_000;

export const emptyHoldings = (): Holdings => Object.fromEntries(STOCK_ORDER.map((id) => [id, 0])) as Holdings;

const BOT_CAREERS = [2, 3];
/** Policeman (5/9) and Prospector (2/12): the occupations that pay least per throw. */
const EASY_BOT_CAREERS = [0, 1];

export function newGame(setup: PlayerSetup[], target = DEFAULT_TARGET, botLevel: BotLevel = "normal"): GameState {
  // Easy bots take the lower-paying occupations; the others the best-paying ones.
  const botCareers = botLevel === "easy" ? EASY_BOT_CAREERS : BOT_CAREERS;
  return {
    version: 3,
    players: setup.map((p, i) => ({
      id: i,
      name: p.name,
      color: PLAYER_COLORS[i % PLAYER_COLORS.length],
      isBot: p.isBot,
      // Bots go straight to work in the best-paying occupations (Doctor, Deep Sea Diver).
      career: p.isBot ? botCareers[i % botCareers.length] : null,
      status: "work",
      pos: null,
      cash: 0,
      shares: emptyHoldings(),
    })),
    current: 0,
    market: MARKET_START,
    target,
    dice: null,
    phase: setup.some((p) => !p.isBot) ? { t: "chooseCareers" } : { t: "preRoll" },
    turn: 1,
    lastLanding: null,
    lastMarketDelta: 0,
    log: [],
    nextLogId: 1,
    turnLogStart: 1,
    botLevel,
  };
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export const totalShares = (p: Player) => STOCK_ORDER.reduce((n, id) => n + p.shares[id], 0);

export const stockValue = (p: Player, market: number) =>
  STOCK_ORDER.reduce((v, id) => v + p.shares[id] * priceAt(id, market), 0);

export const netWorth = (p: Player, market: number) => p.cash + stockValue(p, market);

/** A worker with $1,000 or more must go to the market at their turn. */
export const mustGoToMarket = (p: Player) => p.status === "work" && p.cash >= WORK_CAP;

export function canRoll(state: GameState): boolean {
  if (state.phase.t !== "preRoll") return false;
  const p = state.players[state.current];
  if (p.status === "work") return p.career !== null && !mustGoToMarket(p);
  return p.pos !== null;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export type Action =
  | { type: "setCareer"; career: number }
  /** During `chooseCareers`: any human (not just the current player) picks their occupation. */
  | { type: "chooseCareer"; playerId: number; career: number }
  | { type: "goToMarket"; start: number }
  | { type: "sell"; stock: StockId; qty: number }
  | { type: "roll"; dice: [number, number] }
  | { type: "step" }
  | { type: "detour"; enter: boolean }
  | { type: "buy"; qty: number }
  | { type: "endTurn" }
  | { type: "forcedSell"; stock: StockId; qty: number }
  | { type: "goBroke" };

export function reducer(state: GameState, action: Action): GameState {
  const s: GameState = structuredClone(state);
  const changed = apply(s, action);
  return changed ? s : state;
}

/** Mutates `s`; returns false when the action isn't allowed right now. */
function apply(s: GameState, a: Action): boolean {
  const ph = s.phase;
  const p = s.players[s.current];
  if (ph.t === "gameOver") return false;

  switch (a.type) {
    case "chooseCareer": {
      if (ph.t !== "chooseCareers") return false;
      const chooser = s.players[a.playerId];
      if (!chooser || chooser.isBot || !CAREERS[a.career] || chooser.career === a.career) return false;
      chooser.career = a.career;
      log(s, chooser.id, `goes to work as a ${CAREERS[a.career].name}`);
      if (s.players.every((pl) => pl.career !== null)) {
        s.phase = { t: "preRoll" };
        log(s, null, `Everyone has a job. ${s.players[s.current].name} rolls first.`);
      }
      return true;
    }

    case "setCareer": {
      if (ph.t !== "preRoll" || p.status !== "work" || !CAREERS[a.career]) return false;
      if (p.career === a.career) return false;
      p.career = a.career;
      log(s, p.id, `goes to work as a ${CAREERS[a.career].name}`);
      return true;
    }

    case "goToMarket": {
      if (ph.t !== "preRoll" || p.status !== "work" || !START_SQUARES.includes(a.start)) return false;
      // Nobody plays the market until they've earned $1,000 at work.
      if (p.cash < WORK_CAP) return false;
      p.status = "market";
      p.pos = { kind: "track", index: a.start };
      log(s, p.id, `starts playing the market with $${fmt(p.cash)}`, "money");
      return true;
    }

    case "sell": {
      if (ph.t !== "preRoll" || p.status !== "market") return false;
      const qty = Math.min(Math.floor(a.qty), p.shares[a.stock]);
      if (qty <= 0) return false;
      const price = priceAt(a.stock, s.market);
      p.shares[a.stock] -= qty;
      p.cash += qty * price;
      log(s, p.id, `sells ${qty} ${STOCKS[a.stock].name} at $${price} for $${fmt(qty * price)}`, "money", "cash");
      return true;
    }

    case "roll": {
      if (!canRoll(s)) return false;
      const [d1, d2] = a.dice;
      const total = d1 + d2;
      s.dice = [d1, d2];
      s.lastLanding = null;
      s.lastMarketDelta = 0;
      log(s, p.id, `rolls ${d1} + ${d2} = ${total}`);
      paySalaries(s, total);
      if (p.status === "work") {
        endTurn(s);
        return true;
      }
      const pos = p.pos!;
      const dir: Dir = pos.kind === "track" ? directionFor(pos.index, total) : "cw";
      s.phase = { t: "moving", remaining: total, dir, skipDetourAt: null, leftLane: null };
      return true;
    }

    case "step": {
      if (ph.t !== "moving") return false;
      const pos = p.pos!;
      if (pos.kind === "track") {
        const stock = entranceStock(pos.index);
        const lane = laneAtEntrance(pos.index)?.lane ?? null;
        if (stock && p.shares[stock] > 0 && lane !== (ph.leftLane ?? null) && ph.skipDetourAt !== pos.index) {
          s.phase = { t: "detour", remaining: ph.remaining, dir: ph.dir, stock, at: pos.index };
          return true;
        }
        p.pos = { kind: "track", index: stepIndex(pos.index, ph.dir) };
      } else if (pos.p < LANE_LENGTH - 1) {
        p.pos = { ...pos, p: pos.p + 1 };
      } else {
        // Leave the meeting by the far entrance and keep going the same way.
        // No turning straight back into this meeting; another one further on is fine.
        ph.dir = exitDirection(pos.lane, pos.from);
        ph.leftLane = pos.lane;
        p.pos = { kind: "track", index: LANES[pos.lane].entries[1 - pos.from] };
      }
      ph.skipDetourAt = null;
      ph.remaining -= 1;
      if (ph.remaining === 0) land(s);
      return true;
    }

    case "detour": {
      if (ph.t !== "detour") return false;
      if (!a.enter) {
        s.phase = { t: "moving", remaining: ph.remaining, dir: ph.dir, skipDetourAt: ph.at, leftLane: null };
        return true;
      }
      const entry = laneAtEntrance(ph.at)!;
      p.pos = { kind: "lane", lane: entry.lane, from: entry.from, p: 0 };
      log(s, p.id, `detours into the ${STOCKS[ph.stock].name} shareholders' meeting`);
      s.phase = { t: "moving", remaining: ph.remaining - 1, dir: ph.dir, skipDetourAt: null, leftLane: null };
      if (ph.remaining - 1 === 0) land(s);
      return true;
    }

    case "buy": {
      if (ph.t !== "afterRoll" || !ph.buy) return false;
      const offer = ph.buy;
      const qty = Math.floor(a.qty);
      if (qty <= 0 || qty > offer.max) return false;
      p.shares[offer.stock] += qty;
      p.cash -= qty * offer.price;
      offer.bought += qty;
      offer.max = buyable(p.cash, offer);
      log(
        s,
        p.id,
        `buys ${qty} ${STOCKS[offer.stock].name} at $${offer.price} for $${fmt(qty * offer.price)}`,
        "money",
        "cash",
      );
      return true;
    }

    case "endTurn": {
      if (ph.t !== "afterRoll") return false;
      endTurn(s);
      return true;
    }

    case "forcedSell": {
      // Any sale after the throw is at the lowest price on the board: to cover a fee,
      // or by choice while buying (e.g. to raise cash for the stock just landed on).
      if (ph.t !== "raiseCash" && ph.t !== "afterRoll") return false;
      const qty = Math.min(Math.floor(a.qty), p.shares[a.stock]);
      if (qty <= 0) return false;
      const price = lowestPrice(a.stock);
      p.shares[a.stock] -= qty;
      p.cash += qty * price;
      if (ph.t === "afterRoll") {
        log(
          s,
          p.id,
          `sells ${qty} ${STOCKS[a.stock].name} after the throw, at the lowest price ($${price})`,
          "bad",
          "cash",
        );
        if (ph.buy) ph.buy.max = buyable(p.cash, ph.buy);
        return true;
      }
      log(s, p.id, `must sell ${qty} ${STOCKS[a.stock].name} at the lowest price, $${price}`, "bad", "cash");
      if (p.cash >= ph.owed) payFee(s, ph.owed, ph.reason);
      return true;
    }

    case "goBroke": {
      if (ph.t !== "raiseCash") return false;
      p.cash = 0;
      p.shares = emptyHoldings();
      p.status = "work";
      p.pos = null;
      log(s, p.id, `can't pay the ${ph.reason} and goes back to work`, "bad");
      endTurn(s);
      return true;
    }
  }
}

function paySalaries(s: GameState, total: number) {
  for (const w of s.players) {
    if (w.status !== "work" || w.career === null) continue;
    const career = CAREERS[w.career];
    if (!career.rolls.includes(total)) continue;
    w.cash += career.salary;
    log(s, w.id, `earns a $${career.salary} ${career.name} salary`, "money");
  }
}

function land(s: GameState) {
  const p = s.players[s.current];
  const pos = p.pos!;
  s.lastLanding = { ...pos };

  if (pos.kind === "lane") {
    // In a meeting: the slider doesn't move; collect a stock dividend.
    const stock = TRACK[LANES[pos.lane].entries[pos.from]];
    const id = stock.kind === "stock" ? stock.stock : null;
    const n = laneSplit(pos.lane, pos.from, pos.p);
    if (id && p.shares[id] > 0) {
      const gained = p.shares[id] * n;
      p.shares[id] += gained;
      log(s, p.id, `lands on ${n} FOR 1 and receives ${gained} ${STOCKS[id].name} shares (now ${p.shares[id]})`, "up");
    }
    afterRoll(s, null);
    return;
  }

  const sq = TRACK[pos.index];
  const before = s.market;
  if (sq.kind !== "start") s.market = moveMarket(s.market, sq.move);
  s.lastMarketDelta = s.market - before;
  if (sq.kind !== "start") {
    const word = sq.move > 0 ? "UP" : "DOWN";
    log(
      s,
      p.id,
      `lands on ${squareName(pos.index)}: market ${word} ${Math.abs(sq.move)} (${before} → ${s.market})`,
      sq.move > 0 ? "up" : "down",
      sq.kind === "corner" || sq.kind === "sellAll" ? "loss" : undefined,
    );
  } else {
    log(s, p.id, `lands on START`, undefined, "loss");
  }

  switch (sq.kind) {
    case "start":
      return charge(s, START_FEE, "$100 START fee");
    case "corner":
      return charge(s, BROKER_FEE_PER_SHARE * totalShares(p), "broker fee");
    case "sellAll": {
      const qty = p.shares[sq.stock];
      if (qty > 0) {
        const price = lowestPrice(sq.stock);
        p.shares[sq.stock] = 0;
        p.cash += qty * price;
        log(s, p.id, `must sell all ${qty} ${STOCKS[sq.stock].name} at the lowest price, $${price}`, "bad");
      }
      return afterRoll(s, null);
    }
    case "stock": {
      const owned = p.shares[sq.stock];
      if (owned > 0) {
        p.cash += owned * sq.dividend;
        log(s, p.id, `collects a $${fmt(owned * sq.dividend)} dividend on ${owned} ${STOCKS[sq.stock].name}`, "money");
      }
      const offer: BuyOffer = {
        stock: sq.stock,
        price: priceAt(sq.stock, s.market),
        limited: !!sq.limitOne,
        max: 0,
        bought: 0,
      };
      offer.max = buyable(p.cash, offer);
      return afterRoll(s, offer);
    }
  }
}

/** Shares of the offered stock the player can buy right now. */
function buyable(cash: number, offer: BuyOffer): number {
  const affordable = Math.floor(cash / offer.price);
  return offer.limited ? Math.min(1 - offer.bought, affordable) : affordable;
}

/** The player has landed; they act (sell low, maybe buy) until they end their turn. */
function afterRoll(s: GameState, buy: BuyOffer | null, fee?: FeePaid) {
  // No `fee: undefined` key: Firestore rejects undefined fields.
  s.phase = fee ? { t: "afterRoll", buy, fee } : { t: "afterRoll", buy };
}

function charge(s: GameState, amount: number, reason: string) {
  const p = s.players[s.current];
  if (amount <= 0) return afterRoll(s, null, { amount: 0, reason });
  if (p.cash >= amount) return payFee(s, amount, reason);
  s.phase = { t: "raiseCash", owed: amount, reason };
}

function payFee(s: GameState, amount: number, reason: string) {
  const p = s.players[s.current];
  p.cash -= amount;
  log(s, p.id, `pays a $${fmt(amount)} ${feeName(reason)}`, "bad");
  afterRoll(s, null, { amount, reason });
}

/** "$100 START fee" → "START fee". */
export function feeName(reason: string): string {
  return reason.replace(/^\$100 /, "");
}

function endTurn(s: GameState) {
  s.current = (s.current + 1) % s.players.length;
  s.turn += 1;
  s.turnLogStart = s.nextLogId;
  s.phase = { t: "preRoll" };
  // A player wins if they're worth the target at their turn to roll.
  const next = s.players[s.current];
  if (netWorth(next, s.market) >= s.target) {
    s.phase = { t: "gameOver", winnerId: next.id, reason: "target" };
    log(s, next.id, `reaches $${fmt(netWorth(next, s.market))} and wins!`, "money");
  }
}

function log(s: GameState, playerId: number | null, text: string, tone?: LogEntry["tone"], sound?: LogEntry["sound"]) {
  s.log.unshift({ id: s.nextLogId++, playerId, text, tone, ...(sound ? { sound } : {}) });
  if (s.log.length > 200) s.log.length = 200;
}

export function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

export function squareName(index: number): string {
  const sq = TRACK[index];
  switch (sq.kind) {
    case "start":
      return "START";
    case "corner":
      return "Broker Fee";
    case "stock":
      return STOCKS[sq.stock].name;
    case "sellAll":
      return `Sell All ${STOCKS[sq.stock].name}`;
  }
}

export function posName(pos: Pos | null): string {
  if (!pos) return "—";
  if (pos.kind === "track") return squareName(pos.index);
  const entry = TRACK[LANES[pos.lane].entries[pos.from]];
  return entry.kind === "stock" ? `${STOCKS[entry.stock].name} meeting` : "Meeting";
}
