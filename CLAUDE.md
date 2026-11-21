@AGENTS.md

# Board Games: notes for Claude

A Next.js site hosting several board games that share one Firebase project (`braden-board-games`),
one set of player accounts, and a shared online-play layer. The README covers the site layout, how
online play works, how to add a game, and each game's rules and file map; read it first.

- Games: **Stock Market** (`games/stock-market/`, at `/stock-market`, playable): a web version of the
  owner's 1960s-style stock-market board game. **Plunder**: a pirate ship combat and exploration game in
  development (planned at `games/plunder/`, `/plunder`).
- `platform/` holds everything shared: Firebase and sign-in, online rooms (`rooms.ts`), the game contract
  (`game.ts`), move syncing (`useRoomSync.ts`), the lobby and online start panel, sound, dice, storage.
- `games/<id>/` holds everything specific to one game. Games import from `platform/`; `platform/` never
  imports from a game, and games don't import from each other. If two games need the same thing, move it
  into `platform/`.

## Workflow (the owner relies on this)

- **Never push to `main`.** Work on `dev` (or the branch you were given) and push there.
- **Every branch you push gets a pull request into `main`, automatically.** Open it right after the first
  push, without being asked, and keep its description listing every change on the branch (plus the dev
  preview link for `dev`). The owner decides when to merge; never merge yourself.
- **After a merge:** fast-forward `dev` to `main` (`git fetch origin && git merge --ff-only
  origin/main && git push origin dev`).
- **Dev preview:** https://stonks-git-dev-bradenhirschi29s-projects.vercel.app (Vercel builds
  every push to `dev`; it's behind Vercel login). Live site: https://stonks-henna.vercel.app
  (deploys from `main`).
- **Firestore rules:** whenever `firestore.rules` changes, tell the owner to publish it in the
  Firebase console (Firestore → Rules → Publish) after merging; the live site uses the published
  copy, not the repo.
- **Look before committing UI changes.** The owner iterates on look and feel. For layout and
  visual work, render it with Playwright (Chromium is preinstalled) and send screenshots or
  mockups. When they ask for a mockup or rendering first, or the change is a big redesign,
  don't commit until they approve. They often reject a version, so make reverting easy.
- **Phones first.** Most play is on iPhones (Brave, Safari, and the installed Home Screen app).
  Check phone layouts at 390×664 (browser) and 390×800 (installed app); desktop at 1440×900.
  Nothing on a phone may need page scrolling, and the main turn button must always be visible.

## Commands

- `npm run dev` / `npm run build && npm run start`: build with `rm -rf .next` first if CSS
  changes don't show (Turbopack cache has served stale CSS before).
- `npm test`: unit tests (vitest, `platform/**/*.test.ts` and `games/**/*.test.ts`).
- `npm run test:rules`: Firestore security-rules tests against the emulator (Java and
  firebase-tools are installed; tests in `tests/`).
- `npx tsc --noEmit -p .`, `npx eslint`, `npx prettier --print-width 120`: the codebase uses
  120-column Prettier formatting (don't reformat whole files at 80).
- Online play against local emulators:
  `npx firebase emulators:start --project demo-board-games --only auth,firestore`, then
  `NEXT_PUBLIC_FIREBASE_EMULATORS=1 npm run dev`.

## Rules for game code (every game)

- Game rules are pure: `reducer(state, action) -> state`, no randomness, I/O or time inside. Dice, card
  draws and other randomness are decided in the game's `resolve` and stored in the action, so every phone
  can replay a move and get the same state. Keep state JSON-serializable.
- Each game has its own Firestore collection (`<camelCaseId>Rooms`) and its own block in `firestore.rules`
  built from the shared room functions. Lobby options live in the room's `settings` map, which only the
  host may change. Add rules tests in `tests/` for any change to the rules.
- Prefix a game's localStorage keys with `<id>:`; site-wide ones use `board-games:`.
- Don't change a saved state's shape without handling old saves (local saves and rooms in progress).
- Styles: `app/globals.css` is site-wide and small (base, palette defaults, the shared lobby and start
  screens). Each game's look lives in `games/<id>/<id>.css`, imported by its route; the route wraps the
  page in `<div className="<id>">` and every rule is scoped with `:where(.<id>)` (no added specificity),
  so games can't restyle each other. Keep new styles out of `globals.css` unless every game uses them.
- Hidden information (Plunder needs it; simultaneous turns not yet) is **hidden on screen only**, by the
  owner's decision: the site is for friends, so the room state stays one document every player can read.
  Each such game exports a pure `viewFor(state, seat)` (seat -1 = watcher) that masks what that seat can't
  see; screens, animations, log text and bots use only that view. Show a "Pass to <name>" screen between
  human turns on one device. Test `viewFor`. Details under "Hidden information" in README.md.

## Stock Market

- `engine.ts`: pure rules reducer over a serialisable `GameState` (dice come in on the `roll` action).
  Log entries can carry `sound: "cash" | "loss"`.
- `bot.ts`: computer players; levels `easy` and `normal` (`GameState.botLevel`, a room setting online).
- `online.ts`, `game.ts`, `rooms.ts`, `components/OnlineRoom.tsx`: online play on the shared platform
  (`stockMarketRooms/{code}`).
- `sounds.ts`: turn bell, ca-ching, "womp womp" (dice are in `platform/sound.ts`).
- `components/Game.tsx`: the game screen (`GameView`), local game, turn controls.
- `stock-market.css`: the game's look. It has many layered phone/desktop overrides appended over time,
  so later rules often win on specificity. Check computed styles when something doesn't apply.
- PWA (site-wide): `app/manifest.ts`, `app/apple-icon.png`, `app/icon.png`, `public/icons/`.

### Rules decisions already settled (don't change without asking)

- Market moves bounce off the ends of the ladder (0–50).
- After walking out of a shareholders' meeting you can't turn straight back into that meeting,
  but you can enter a different one on the same roll.
- After the throw you may sell, but only at the lowest board price; the player ends the turn
  manually.
- Fee shortfalls: sell at the lowest price or go broke (the owner said not to change this).

### Open to-do list (as of Nov 2026)

1. **Online moves arrive slowly (~15 s)** between two phones. Likely the Firestore real-time
   connection stalling on mobile browsers (try `initializeFirestore` with
   `experimentalAutoDetectLongPolling` / long-polling in `platform/firebase.ts`). The app logs
   `[stock-market] saving took …ms` and `live update for move N arrived …ms after it saved` to
   the console. Ask which browsers were involved.
2. **2-minute turn timer.** Skips the turn after 2 minutes; show a countdown in the top-right of
   the "Your turn" card only in the last 59 s. Not for occupation picking. Needs an engine
   "timeout" action that finishes the turn from any phase. Online: store the turn start time
   (server timestamp) on the room so others can skip an absent player (rules change + tests).
3. **CI on PRs:** GitHub Actions running eslint, tsc, `npm test` and `npm run test:rules`.
4. **Clean up `stock-market.css`:** remove overridden/dead declarations and unused selectors.
   Verify with a computed-style diff across many game states and viewports; there should be no
   visual change.
5. Ideas the owner liked but didn't schedule: "your turn" push notifications for online games,
   a game-over results screen with a rematch button, tapping squares/stocks for details, and
   floating "+$40" money-change labels.
