# Board Games

A website of board games to play with friends: online from your own phones, or passing one device
around. Built with Next.js, with online play on Firebase (project `braden-board-games`).

| Game | Route | Status |
| --- | --- | --- |
| Stock Market | `/stock-market` | Playable |
| Plunder (pirate ship combat and exploration) | `/plunder` | In development |

```bash
npm install
npm run dev   # http://localhost:3000
npm test      # every game's rules tests
```

## How the site is organized

All games share one site, one Firebase project and one set of player accounts. Shared code lives in
`platform/`; everything specific to a game lives in `games/<game-id>/`.

| Path | What it holds |
| --- | --- |
| `app/page.tsx` | The home page: the list of games (from `games/index.ts`) |
| `app/<game-id>/page.tsx` | Each game's route, a thin wrapper around the game's start screen |
| `platform/firebase.ts` | Firebase setup, guest sign-in, Google sign-in |
| `platform/game.ts` | `OnlineGame`, what a game gives the platform so it can host online rooms for it |
| `platform/rooms.ts` | Online rooms: create, join, lobby edits, start, save a move, watch |
| `platform/useRoomSync.ts` | Keeps an online game screen in step with its room: replays moves, saves yours, plays bots |
| `platform/OnlineRoom.tsx` | The shared lobby (seats, invite link, bots, start) for any game |
| `platform/OnlineStart.tsx` | The "Online" panel on a game's start screen: name, create/join a room, account |
| `platform/sound.ts`, `Dice.tsx`, `ZoomableBoard.tsx`, `storage.ts` | Sound setting and dice sound, a die, a pinch-zoom board, safe localStorage |
| `games/<game-id>/` | The game's rules engine, bot, board data, screens and sounds |
| `firestore.rules` | Who may read and write rooms: shared room rules, one block per game |
| `app/globals.css` | Site-wide styles only: palette tokens, base elements, buttons, the shared start screen, lobby and game list |
| `games/<game-id>/<game-id>.css` | The game's own look, loaded by its route and scoped under its wrapper class (`:where(.<game-id>)`) |

### Online play

It runs on Firebase's free Spark plan with no game server:

- **Accounts:** everyone gets a guest account automatically (Firebase anonymous sign-in), and can link it to
  Google to keep the same account across devices. The account works for every game on the site.
- **Rooms** are Firestore documents in each game's own collection (e.g. `stockMarketRooms/{code}`). The player
  whose turn it is applies their move with the game's rules code, then saves the new state together with the
  actions it applied; every other phone replays those actions so moves animate the same everywhere. Bot turns
  are played by whichever seated player's phone is open (if two try at once, the first save wins).
- **`firestore.rules`** limits who may write: only seated players, one version at a time, and only the player
  the last save named (`currentUid`), or anyone seated on a bot's turn. Players' phones roll the dice, so a
  determined player could cheat; fine among friends.
- The Firebase web config lives in `platform/firebase.ts` (public values).

So that this works, a game's rules must be pure functions (`reducer(state, action) -> state`) and all
randomness (dice, card draws) must be decided before an action is applied, in the game's `resolve`.

```bash
npm run test:rules   # security rules tests against the Firestore emulator
# Run the app against local emulators:
npx firebase emulators:start --project demo-board-games --only auth,firestore
NEXT_PUBLIC_FIREBASE_EMULATORS=1 npm run dev
```

Old Stock Market invite links (`/?room=CODE`) redirect to `/stock-market?room=CODE` (see `next.config.ts`).

### Adding a game

1. Write the rules in `games/<id>/` as a pure reducer, with tests next to it.
2. Describe it for online play: an `OnlineGame` (see `games/stock-market/game.ts`) and its rooms with
   `roomsFor(...)` (see `games/stock-market/rooms.ts`).
3. Build its screens, using `platform/OnlineRoom.tsx`, `useRoomSync` and `OnlineStart` for online play.
4. Add `app/<id>/page.tsx` and list the game in `games/index.ts`.
5. Add a `match /<collection>/{code}` block to `firestore.rules` that uses the shared room functions, and
   rules tests for anything game-specific.
6. Put its styles in `games/<id>/<id>.css`, import it from `app/<id>/page.tsx`, wrap the page in
   `<div className="<id>">`, and scope every rule with `:where(.<id>)` (see `stock-market.css`).
7. Prefix its localStorage keys with `<id>:`.

### Hidden information: hidden on screen only

Decision: games hide information **on screen only**. The site is for friends, so we accept that anyone
opening the browser's developer tools could read a room's full state. A room stays one document that
every seated player can read, and no platform or security-rules changes are needed.

How a game with hidden information (Plunder first) should do it:

- **The state holds everything**, including the secrets, so every phone can still replay every move.
- **The game exports `viewFor(state, seat)`**, a pure function that returns a copy of the state with what
  that seat can't see removed or masked (other players' hands, unexplored tiles, and so on). Watchers get
  `seat = -1`. Screens draw only this view, never the raw state; that keeps hiding in one tested place.
- **Animations and the log follow the same rule.** Replayed actions and log text must not reveal a secret
  (e.g. "Anne draws a card", not which card).
- **Bots play fair**: a bot decides from `viewFor(state, botSeat)`, not the full state.
- **On one device**, show a "Pass to <name>" screen between human turns so players don't see each other's
  secrets.

If the site ever goes beyond friends, the stronger options are private per-player documents
(`<collection>/{code}/private/{uid}`, which works only when players create their own secrets) or a trusted
server (Cloud Functions, which needs Firebase's pay-as-you-go Blaze plan).

Simultaneous turns are not supported yet: the rules allow one writer per version (or everyone, in phases
like Stock Market's occupation pick, applied in whatever order they arrive).

## Stock Market

Pass-and-play for 2–8 players on one screen, with optional computer players, or online. Click **How to
play** on its start screen for a summary of the rules. Everything in the rulebook is in:

- **Going to work.** Pick one of four occupations. Whenever anyone throws your numbers you're paid. You can't
  play the market until you've earned $1,000; then you must.
- **Moving.** Start on any START square (no fee). Each throw, follow the arrow on the square you're leaving;
  START sends odd throws one way and even throws the other.
- **The quotation board.** Landing moves the single market slider. If it hits the top or bottom it bounces
  back. The eight stocks are four pairs sharing one price ladder, flipped: as the slider moves, one of each
  pair rises and the other falls.
- **Buying and selling.** Buy only right after landing (1 share on LIMIT squares). Sell at the board price
  right before your throw; after the throw you can still sell (say, to afford what you landed on), but only at
  the lowest board price. Owning the stock you land on pays its dividend first. Your turn lasts until you press
  **End turn**.
- **Fees and forced sales.** START costs $100 to land on, and broker fee corners cost $10 per share. SELL ALL
  squares, and selling to cover a fee, pay the lowest price on the board. If you can't pay, you go broke and
  back to work.
- **Shareholders' meetings.** Owners can detour in at their stock's entrance. Landing on a space pays that
  many new shares per share owned. You walk through and leave by the far entrance. The slider doesn't move in
  a meeting.
- **Winning.** Be worth the target ($100,000 by default, adjustable) at your turn to roll.

Games on one device save automatically in the browser, so a refresh doesn't lose them.

| File (in `games/stock-market/`) | What it holds |
| --- | --- |
| `stocks.ts` | The eight companies (names, colors) and their quotation board price ladders |
| `board.ts` | Every square on the track: company, dividend, market move and arrow direction. Also movement rules |
| `engine.ts` | All game rules: state, turn phases and actions |
| `bot.ts` | Computer player strategy |
| `online.ts`, `game.ts`, `rooms.ts` | Online play: resolving moves, the game's `OnlineGame` description, its rooms |
| `sounds.ts` | Bell, cash and loss sounds |
| `stock-market.css` | The game's look: board, tracker, game screen, phone layouts |
| `components/` | Start screen (`Home.tsx`), board, price tracker, the game screen, and the online game (`OnlineRoom.tsx`) |

The quotation board prices in `stocks.ts` are copied row for row from the playtest board. To rename
companies or tweak a square, edit `stocks.ts` or `board.ts`. The board redraws from that data.
