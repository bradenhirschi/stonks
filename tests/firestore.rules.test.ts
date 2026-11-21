import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";

// Run with `npm run test:rules` (starts the Firestore emulator). These cover the shared room
// rules, through Stock Market's collection.

let env: RulesTestEnvironment;

const lobby = (over: Record<string, unknown> = {}) => ({
  code: "ABCDE",
  hostUid: "host",
  status: "lobby",
  settings: { target: 100000 },
  seats: [{ uid: "host", name: "Host", isBot: false }],
  memberUids: ["host"],
  version: 0,
  stateJson: null,
  replayJson: null,
  currentUid: null,
  ...over,
});

const playing = (over: Record<string, unknown> = {}) =>
  lobby({
    status: "playing",
    seats: [
      { uid: "host", name: "Host", isBot: false },
      { uid: "amy", name: "Amy", isBot: false },
      { uid: null, name: "Bot", isBot: true },
    ],
    memberUids: ["host", "amy"],
    version: 5,
    stateJson: "{}",
    currentUid: "amy",
    ...over,
  });

const db = (uid: string) => env.authenticatedContext(uid).firestore();
const room = (uid: string) => db(uid).doc("stockMarketRooms/ABCDE");

async function seed(data: Record<string, unknown>) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc("stockMarketRooms/ABCDE").set(data);
  });
}

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-board-games",
    firestore: { rules: readFileSync("firestore.rules", "utf8"), host: "127.0.0.1", port: 8085 },
  });
});
afterAll(() => env.cleanup());
beforeEach(() => env.clearFirestore());

describe("reading", () => {
  it("needs sign-in", async () => {
    await seed(lobby());
    await assertFails(env.unauthenticatedContext().firestore().doc("stockMarketRooms/ABCDE").get());
    await assertSucceeds(room("stranger").get());
  });
});

describe("creating a room", () => {
  it("is allowed as its host", async () => {
    await assertSucceeds(room("host").set(lobby()));
  });
  it("can't name someone else as host or start mid-game", async () => {
    await assertFails(room("amy").set(lobby()));
    await assertFails(room("host").set(lobby({ status: "playing" })));
  });
  it("needs a valid code", async () => {
    await assertFails(
      db("host")
        .doc("stockMarketRooms/abc")
        .set(lobby({ code: "abc" })),
    );
  });
});

describe("the lobby", () => {
  beforeEach(() => seed(lobby()));

  it("lets a player take their own seat", async () => {
    await assertSucceeds(
      room("amy").update({
        seats: [...lobby().seats, { uid: "amy", name: "Amy", isBot: false }],
        memberUids: ["host", "amy"],
      }),
    );
  });
  it("doesn't let a player seat someone else, or remove others", async () => {
    await assertFails(room("amy").update({ memberUids: ["host", "bob"] }));
    await assertFails(room("amy").update({ memberUids: [] }));
  });
  it("doesn't let a non-host change settings or start the game", async () => {
    await assertFails(room("amy").update({ settings: { target: 5 } }));
    await assertFails(room("amy").update({ status: "playing", version: 1 }));
  });
  it("lets the host change settings", async () => {
    await assertSucceeds(room("host").update({ settings: { target: 50000 } }));
  });
  it("lets only the host choose the bot level", async () => {
    await seed(lobby({ memberUids: ["host", "amy"] }));
    await assertFails(room("amy").update({ settings: { target: 100000, botLevel: "easy" } }));
    await assertSucceeds(room("host").update({ settings: { target: 100000, botLevel: "easy" } }));
  });
  it("lets a player leave a room that has no settings saved", async () => {
    await seed(lobby({ memberUids: ["host", "amy"], settings: null }));
    await assertSucceeds(room("amy").update({ memberUids: ["host"] }));
  });
  it("lets the host start the game", async () => {
    await assertSucceeds(room("host").update({ status: "playing", version: 1, stateJson: "{}" }));
  });
});

describe("during a game", () => {
  beforeEach(() => seed(playing()));

  it("lets the player whose turn it is save the next version", async () => {
    await assertSucceeds(room("amy").update({ version: 6, stateJson: "{}", currentUid: null }));
  });
  it("blocks other players on someone else's turn", async () => {
    await seed(playing({ currentUid: "host" }));
    await assertFails(room("amy").update({ version: 6 }));
  });
  it("blocks skipped or repeated versions", async () => {
    await assertFails(room("amy").update({ version: 7 }));
    await assertFails(room("amy").update({ version: 5 }));
  });
  it("lets any seated player run a bot's turn", async () => {
    await seed(playing({ currentUid: null }));
    await assertSucceeds(room("amy").update({ version: 6 }));
    await assertFails(room("stranger").update({ version: 7 }));
  });
  it("gives the host no special right to write on someone else's turn", async () => {
    await assertFails(room("host").update({ version: 6 }));
  });
  it("never lets the bot level change mid-game", async () => {
    await assertFails(room("amy").update({ version: 6, settings: { target: 100000, botLevel: "easy" } }));
  });
  it("never lets seats or membership change", async () => {
    await assertFails(room("amy").update({ version: 6, memberUids: ["amy"] }));
    await assertFails(room("amy").update({ version: 6, seats: [] }));
    await assertFails(room("amy").update({ version: 6, settings: { target: 5 } }));
  });
});
