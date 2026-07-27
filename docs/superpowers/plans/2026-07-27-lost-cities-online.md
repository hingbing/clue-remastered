# Lost Cities Online Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a server-authoritative, room-code-based two-player Lost Cities game to the existing Vercel client and Render server without changing the internal behavior of Clue or Abraca What.

**Architecture:** Put shared wire types in `shared/lostCities.ts`, pure deterministic rules in `server/src/lostCitiesRules.ts`, and Socket.IO room orchestration in `server/src/lostCities.ts`. Add one isolated React game screen and prefixed CSS, touching existing files only at the client game selector and server registration seam.

**Tech Stack:** React, TypeScript, Vite, Express, Socket.IO, Node.js built-in test runner through `tsx --test`, static PNG assets.

## Global Constraints

- Exactly two players per room; one creates a room and shares its uppercase code.
- Use six fields: yellow, white, blue, green, red, and purple.
- Use cards 2 through 10 plus three X2 cards per color: 72 cards total.
- Deal 8 cards to each player and leave 56 in the central draw pile.
- The server is authoritative for turn order, legal plays, draws, game end, and scoring.
- Do not modify `client/src/ClueGame.tsx`, `client/src/AbracaWhatGame.tsx`, or `server/src/abraca.ts`.
- Keep Lost Cities events under the `lost-cities:*` prefix and CSS under the `lostCities` prefix.
- Support desktop and smartphone landscape; portrait shows a rotate-device notice.
- Use original vintage expedition-book imagery, not copied commercial game art.
- Do not add login, matchmaking, spectators, chat, persistence across Render restarts, or card enlargement.
- The discard field shows its expedition image when empty and the top discarded card image plus pile count when non-empty.

---

## File Map

- Create `shared/lostCities.ts`: wire-safe card, player, score, and room-state types plus color constants.
- Create `server/src/lostCitiesRules.ts`: deck construction, legal-play checks, draw checks, and scoring pure functions.
- Create `server/src/lostCitiesRules.test.ts`: exhaustive unit tests for card counts, legality, turn restrictions, and scoring.
- Create `server/src/lostCities.ts`: room lifecycle, private/public serialization, Socket.IO event handlers, reconnect, and disconnect behavior.
- Create `server/src/lostCities.test.ts`: socket-level integration tests with two clients.
- Modify `server/src/index.ts`: import and call `registerLostCities(io)` only.
- Modify `server/package.json`: add the test script and socket client test dependency.
- Create `client/src/LostCitiesGame.tsx`: lobby, online state, board interaction, and results.
- Modify `client/src/App.tsx`: add the Lost Cities selection and render branch only.
- Modify `client/src/style.css`: append isolated `lostCities*` styles and responsive rules.
- Create `client/public/lost-cities/cards/*.png`: 60 card-face images.
- Create `client/public/lost-cities/fields/*.png`: six expedition-field images.
- Create `client/public/lost-cities/card-back.png`: one shared card back.

### Task 1: Shared Protocol and Pure Deck Rules

**Files:**
- Create: `shared/lostCities.ts`
- Create: `server/src/lostCitiesRules.ts`
- Create: `server/src/lostCitiesRules.test.ts`
- Modify: `server/package.json`

**Interfaces:**
- Produces: `LOST_CITIES_COLORS`, `LostCitiesCard`, `LostCitiesColor`, `LostCitiesRoomState`, `createLostCitiesDeck()`, `canPlayToExpedition()`, `scoreExpedition()`, and `scorePlayer()`.
- Consumes: no feature-specific interfaces.

- [ ] **Step 1: Add the Node test command**

Add this script to `server/package.json`:

```json
"test": "tsx --test src/**/*.test.ts"
```

- [ ] **Step 2: Define shared protocol types**

Create `shared/lostCities.ts` with these public contracts:

```ts
export const LOST_CITIES_COLORS = [
  "yellow", "white", "blue", "green", "red", "purple",
] as const;

export type LostCitiesColor = (typeof LOST_CITIES_COLORS)[number];
export type LostCitiesCardKind = "number" | "investment";
export type LostCitiesStatus = "waiting" | "playing" | "finished" | "abandoned";
export type LostCitiesTurnPhase = "play" | "draw";

export interface LostCitiesCard {
  id: string;
  color: LostCitiesColor;
  kind: LostCitiesCardKind;
  value: number | null;
}

export interface LostCitiesPlayerPublic {
  id: string;
  nickname: string;
  isHost: boolean;
  connected: boolean;
  handCount: number;
  expeditions: Record<LostCitiesColor, LostCitiesCard[]>;
}

export interface LostCitiesScoreLine {
  color: LostCitiesColor;
  numberTotal: number;
  investmentCount: number;
  multiplier: number;
  longExpeditionBonus: number;
  total: number;
}

export interface LostCitiesRoomState {
  roomCode: string;
  status: LostCitiesStatus;
  players: LostCitiesPlayerPublic[];
  viewerPlayerId: string;
  viewerHand: LostCitiesCard[];
  currentTurnPlayerId: string | null;
  turnPhase: LostCitiesTurnPhase;
  drawPileCount: number;
  discardTops: Record<LostCitiesColor, LostCitiesCard | null>;
  discardCounts: Record<LostCitiesColor, number>;
  lastAction: string;
  scores: Record<string, LostCitiesScoreLine[]> | null;
  winnerIds: string[];
}
```

- [ ] **Step 3: Write failing deck and legality tests**

Create tests using `node:test` and `node:assert/strict` that assert:

```ts
test("deck has 72 unique cards and 12 cards per color", () => {
  const deck = createLostCitiesDeck();
  assert.equal(deck.length, 72);
  assert.equal(new Set(deck.map((card) => card.id)).size, 72);
  for (const color of LOST_CITIES_COLORS) {
    const cards = deck.filter((card) => card.color === color);
    assert.equal(cards.length, 12);
    assert.deepEqual(
      cards.filter((card) => card.kind === "number").map((card) => card.value),
      [2, 3, 4, 5, 6, 7, 8, 9, 10],
    );
    assert.equal(cards.filter((card) => card.kind === "investment").length, 3);
  }
});

test("investment must precede number cards and numbers must increase", () => {
  const investment = card("yellow", "investment", null);
  const five = card("yellow", "number", 5);
  const six = card("yellow", "number", 6);
  assert.equal(canPlayToExpedition([], investment), true);
  assert.equal(canPlayToExpedition([investment], five), true);
  assert.equal(canPlayToExpedition([five], investment), false);
  assert.equal(canPlayToExpedition([five], five), false);
  assert.equal(canPlayToExpedition([five], six), true);
});
```

- [ ] **Step 4: Run tests and confirm red**

Run:

```bash
npm test --prefix server
```

Expected: FAIL because `lostCitiesRules.ts` exports do not exist.

- [ ] **Step 5: Implement minimal deck and play rules**

Implement:

```ts
export function createLostCitiesDeck(): LostCitiesCard[];
export function canPlayToExpedition(
  expedition: LostCitiesCard[],
  card: LostCitiesCard,
): boolean;
export function shuffleLostCitiesDeck(
  cards: LostCitiesCard[],
  random?: () => number,
): LostCitiesCard[];
```

Use IDs in the form `${color}-number-${value}` and `${color}-investment-${copy}`.

- [ ] **Step 6: Write failing scoring tests**

Cover empty fields, negative multiplied totals, all four multipliers, the eight-card bonus, player totals, and ties. Include:

```ts
assert.equal(scoreExpedition([]).total, 0);
assert.equal(scoreExpedition([investment, number(2)]).total, -36);
assert.equal(scoreExpedition([
  investment, investment, number(2), number(3), number(4),
  number(5), number(6), number(7),
]).total, 41);
```

The last expectation is `(27 - 20) * 3 + 20 = 41`.

- [ ] **Step 7: Implement scoring and run green**

Implement:

```ts
export function scoreExpedition(cards: LostCitiesCard[]): Omit<LostCitiesScoreLine, "color">;
export function scorePlayer(
  expeditions: Record<LostCitiesColor, LostCitiesCard[]>,
): { lines: LostCitiesScoreLine[]; total: number };
```

Run:

```bash
npm test --prefix server
npm run build --prefix server
```

Expected: all rule tests pass and TypeScript build exits 0.

- [ ] **Step 8: Commit**

```bash
git add shared/lostCities.ts server/src/lostCitiesRules.ts server/src/lostCitiesRules.test.ts server/package.json
git commit -m "feat: add lost cities rules engine"
```

### Task 2: Server Room Lifecycle and Private Serialization

**Files:**
- Create: `server/src/lostCities.ts`
- Create: `server/src/lostCities.test.ts`
- Modify: `server/src/index.ts`
- Modify: `server/package.json`

**Interfaces:**
- Consumes: all types and pure functions from Task 1.
- Produces: `registerLostCities(io: Server): void` and the complete `lost-cities:*` Socket.IO protocol.

- [ ] **Step 1: Add the test client dependency**

Run:

```bash
npm install --prefix server --save-dev socket.io-client@^4.7.5
```

Expected: `server/package.json` and `server/package-lock.json` record the dependency.

- [ ] **Step 2: Write failing room lifecycle integration tests**

Start an in-memory HTTP/Socket.IO server in `beforeEach`, call `registerLostCities(io)`, and connect two clients. Test:

```ts
test("host creates a room and second player joins by code", async () => {
  const created = await emitAndWait(host, "lost-cities:room:create", { nickname: "A" }, "lost-cities:room:created");
  const joined = await emitAndWait(guest, "lost-cities:room:join", {
    nickname: "B",
    roomCode: created.roomCode,
  }, "lost-cities:room:joined");
  assert.equal(joined.roomState.players.length, 2);
});
```

Also assert a third client receives `lost-cities:error`, only the host can start, and starting deals 8 cards to each viewer without revealing the opponent's hand.

- [ ] **Step 3: Run the integration test and confirm red**

Run:

```bash
npm test --prefix server
```

Expected: FAIL because `registerLostCities` does not exist.

- [ ] **Step 4: Implement room creation, joining, and viewer serialization**

Create internal `LostCitiesRoom` and `LostCitiesPlayer` types. Use separate maps for room code by socket and player ID by socket. Implement:

```ts
export function registerLostCities(io: Server): void;
function publicRoom(room: LostCitiesRoom, viewerId: string): LostCitiesRoomState;
function emitRoom(io: Server, room: LostCitiesRoom): void;
```

Normalize nicknames with trim and a 20-character limit. Generate six-character room codes from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`.

- [ ] **Step 5: Register the module at the server seam**

In `server/src/index.ts`, add only:

```ts
import { registerLostCities } from "./lostCities.js";
```

and immediately after `registerAbraca(io)`:

```ts
registerLostCities(io);
```

- [ ] **Step 6: Run lifecycle tests and build**

Run:

```bash
npm test --prefix server
npm run build --prefix server
```

Expected: room tests pass and build exits 0.

- [ ] **Step 7: Commit**

```bash
git add server/src/lostCities.ts server/src/lostCities.test.ts server/src/index.ts server/package.json server/package-lock.json
git commit -m "feat: add lost cities online rooms"
```

### Task 3: Server-Authoritative Turns, End Game, and Reconnect

**Files:**
- Modify: `server/src/lostCities.ts`
- Modify: `server/src/lostCities.test.ts`

**Interfaces:**
- Consumes: `canPlayToExpedition`, `scorePlayer`, and room protocol from Tasks 1–2.
- Produces: working `lost-cities:card:play`, `lost-cities:card:draw`, `lost-cities:room:rejoin`, and `lost-cities:room:leave` handlers.

- [ ] **Step 1: Write failing turn-phase tests**

Add integration cases proving:

- A player cannot draw during `play`.
- A player cannot play twice.
- An illegal expedition play leaves state unchanged.
- A legal play changes phase to `draw`.
- A legal draw restores hand size to 8 and passes the turn.
- Drawing the exact card discarded this turn is rejected.
- Empty discard piles are rejected.

Use a deterministic test-only room factory exported under:

```ts
export const lostCitiesTestApi = {
  reset,
  getRoom,
  seedRoom,
};
```

Keep it out of client-visible state.

- [ ] **Step 2: Run tests and confirm red**

Run:

```bash
npm test --prefix server
```

Expected: new turn tests fail because the handlers are missing.

- [ ] **Step 3: Implement play and draw handlers**

Accept these payloads:

```ts
type PlayPayload = {
  cardId: string;
  destination: "expedition" | "discard";
};

type DrawPayload =
  | { source: "deck" }
  | { source: "discard"; color: LostCitiesColor };
```

On every request, verify room, player, status, current player, phase, card ownership, destination, and rule legality before mutation. Clear `discardedCardIdThisTurn` after a successful draw.

- [ ] **Step 4: Write and implement end-game tests**

Seed a room with one card in the central pile. Draw it and assert:

```ts
assert.equal(state.status, "finished");
assert.equal(state.drawPileCount, 0);
assert.ok(state.scores);
assert.ok(state.winnerIds.length >= 1);
```

Verify tied totals yield both player IDs.

- [ ] **Step 5: Write and implement reconnect/leave tests**

Assert `lost-cities:room:rejoin` replaces the socket ID for the saved player, sets `connected: true`, and returns private hand state. Assert disconnect marks the player disconnected without deleting the room. Assert explicit leave changes an active game to `abandoned` and informs the remaining player.

- [ ] **Step 6: Run full server verification**

Run:

```bash
npm test --prefix server
npm run build --prefix server
```

Expected: all unit and integration tests pass; build exits 0.

- [ ] **Step 7: Commit**

```bash
git add server/src/lostCities.ts server/src/lostCities.test.ts
git commit -m "feat: enforce lost cities turns and scoring"
```

### Task 4: Client Lobby and Game Selection

**Files:**
- Create: `client/src/LostCitiesGame.tsx`
- Modify: `client/src/App.tsx`
- Modify: `client/src/style.css`

**Interfaces:**
- Consumes: `LostCitiesRoomState` and the Socket.IO events from Tasks 1–3.
- Produces: room create/join/rejoin/leave UI and a waiting-room state.

- [ ] **Step 1: Add the isolated game selection branch**

Change only the selection seam in `App.tsx`:

```ts
import LostCitiesGame from "./LostCitiesGame";
type GameType = "home" | "clue" | "abraca" | "lost-cities";
```

Add:

```tsx
if (game === "lost-cities") return <LostCitiesGame />;
```

and a third selection button.

- [ ] **Step 2: Create the lobby and socket lifecycle**

In `LostCitiesGame.tsx`, initialize one Socket.IO client with `VITE_SERVER_URL`. Use these session keys:

```ts
const ROOM_KEY = "lost_cities_room_code";
const PLAYER_KEY = "lost_cities_player_id";
```

Register and clean up listeners for created, joined, state, left, and error events. Emit rejoin once on mount when both keys exist.

- [ ] **Step 3: Render waiting-room actions**

Render nickname input, create button, uppercase room-code input, join button, room code, two player connection states, host-only start button, and leave button. Disable start until exactly two connected players exist.

- [ ] **Step 4: Add isolated lobby styles**

Append only `.lostCities*` selectors. Reuse the project's existing typography and button tokens without changing generic `.landing`, `.hero`, `.gameSelect`, Clue, or Abraca selectors.

- [ ] **Step 5: Build and manually smoke-test the seam**

Run:

```bash
npm run build --prefix client
npm run build --prefix server
```

Expected: both builds exit 0. In local dev, confirm all three main-menu buttons still open their respective screens.

- [ ] **Step 6: Commit**

```bash
git add client/src/App.tsx client/src/LostCitiesGame.tsx client/src/style.css
git commit -m "feat: add lost cities lobby"
```

### Task 5: Original Card and Expedition Assets

**Files:**
- Create: `client/public/lost-cities/cards/` containing the 54 numbered faces and six X2 faces enumerated by `asset-manifest.json`
- Create: `client/public/lost-cities/fields/` containing `yellow.png`, `white.png`, `blue.png`, `green.png`, `red.png`, and `purple.png`
- Create: `client/public/lost-cities/card-back.png`
- Create: `client/public/lost-cities/asset-manifest.json`

**Interfaces:**
- Produces: deterministic asset paths consumed by `LostCitiesGame.tsx`.
- Consumes: colors and expedition names from the approved design.

- [ ] **Step 1: Define the manifest before generating**

Create a manifest containing 60 face paths, six field paths, and one back path. Use:

```json
{
  "cardPattern": "/lost-cities/cards/{color}-{value}.png",
  "investmentPattern": "/lost-cities/cards/{color}-x2.png",
  "fieldPattern": "/lost-cities/fields/{color}.png",
  "cardBack": "/lost-cities/card-back.png"
}
```

- [ ] **Step 2: Generate six coherent expedition master images**

Use the `imagegen` skill at execution time. Generate original vintage expedition-book illustrations for:

```text
yellow = golden temple
white = snowy ruins
blue = sunken city
green = jungle shrine
red = volcanic fortress
purple = moonlit necropolis
```

Prompt constraints: aged parchment, hand-painted exploration journal, no logos, no existing board-game composition, no text, strong color identity, readable at small size.

- [ ] **Step 3: Derive the six field images and 60 card faces**

Crop field images to a wide ratio. Crop card faces to a consistent 2:3 ratio. Add large programmatic `2`–`10` or `X2` labels, a consistent parchment frame, and the color identity. The three same-color X2 cards reuse one file.

- [ ] **Step 4: Create and validate the card back**

Create one 2:3 vintage-map back with no readable face value. Verify all manifest files exist, use the same dimensions within each category, and remain legible at the in-game card size.

- [ ] **Step 5: Commit**

```bash
git add client/public/lost-cities
git commit -m "feat: add original lost cities artwork"
```

### Task 6: Interactive Landscape Game Board

**Files:**
- Modify: `client/src/LostCitiesGame.tsx`
- Modify: `client/src/style.css`

**Interfaces:**
- Consumes: room state from Task 3 and image paths from Task 5.
- Produces: the complete play/draw interaction and responsive landscape board.

- [ ] **Step 1: Add deterministic image helpers**

Implement:

```ts
function cardImage(card: LostCitiesCard) {
  return card.kind === "investment"
    ? `/lost-cities/cards/${card.color}-x2.png`
    : `/lost-cities/cards/${card.color}-${card.value}.png`;
}

function fieldImage(color: LostCitiesColor) {
  return `/lost-cities/fields/${color}.png`;
}
```

- [ ] **Step 2: Render the six-column table**

For each color, render opponent expedition on top, field/discard in the middle, and viewer expedition below. If `discardTops[color]` is null, show the field image. Otherwise show the top card image over the field and `discardCounts[color]` in a badge.

- [ ] **Step 3: Implement the play phase**

Track `selectedCardId`. When `turnPhase === "play"` and it is the viewer's turn, select one hand card and show only:

```tsx
<button onClick={() => play(selectedCardId, "expedition")}>탐험하기</button>
<button onClick={() => play(selectedCardId, "discard")}>버리기</button>
```

Add the exact client-side presentation helper:

```ts
function canViewerPlayToExpedition(
  expedition: LostCitiesCard[],
  card: LostCitiesCard,
): boolean {
  if (card.kind === "investment") {
    return expedition.every((placed) => placed.kind === "investment");
  }
  const lastNumber = [...expedition]
    .reverse()
    .find((placed) => placed.kind === "number")?.value;
  return lastNumber === undefined || lastNumber === null || card.value! > lastNumber;
}
```

Disable the expedition button when this helper returns false, while retaining server validation as the final authority.

- [ ] **Step 4: Implement the draw phase**

When `turnPhase === "draw"`, make the central deck and legal discard tops selectable. Never enable the just-discarded top in the same turn; rely on the server error as the final guard.

- [ ] **Step 5: Add score and result panels**

Show current estimated color totals beside the board. When status is `finished`, show both players' six score lines, totals, and every winner in `winnerIds`. When status is `abandoned`, show the reason and a leave-to-menu action.

- [ ] **Step 6: Add landscape and portrait CSS**

Use:

```css
@media (orientation: portrait) and (max-width: 900px) {
  .lostCitiesGameShell { display: none; }
  .lostCitiesRotateNotice { display: grid; }
}

@media (orientation: landscape), (min-width: 901px) {
  .lostCitiesRotateNotice { display: none; }
}
```

Keep all action controls at least 44px in both dimensions. Fit opponent expeditions, six fields, viewer expeditions, and eight-card hand in one landscape viewport without page-level horizontal scrolling.

- [ ] **Step 7: Build and perform two-browser gameplay smoke test**

Run:

```bash
npm run dev
```

Open two browser sessions, create/join a room, play legal and illegal actions, draw from deck and discards, refresh one browser, and finish a seeded or full game. Confirm private hands differ and results match.

- [ ] **Step 8: Commit**

```bash
git add client/src/LostCitiesGame.tsx client/src/style.css
git commit -m "feat: add lost cities game board"
```

### Task 7: Regression, Responsive, and Deployment Verification

**Files:**
- Modify only if verification exposes a Lost Cities defect: files created or modified in Tasks 1–6.

**Interfaces:**
- Consumes: complete feature.
- Produces: verified release candidate.

- [ ] **Step 1: Run automated tests**

Run:

```bash
npm test --prefix server
```

Expected: all Lost Cities rule and Socket.IO tests pass with zero failures.

- [ ] **Step 2: Run production builds**

Run:

```bash
npm run build
```

Expected: server TypeScript and client TypeScript/Vite builds both exit 0.

- [ ] **Step 3: Verify existing game isolation**

Open the main menu and enter Clue and Abraca What. Confirm each existing lobby renders and can create a room. Check:

```bash
git diff 895fcb3 -- client/src/ClueGame.tsx client/src/AbracaWhatGame.tsx server/src/abraca.ts
```

Expected: no output.

- [ ] **Step 4: Verify responsive acceptance criteria**

Using browser device emulation, check:

- 390×844 portrait: rotate notice only.
- 844×390 landscape: full six-field board and all eight hand cards accessible.
- 1280×720: full board with no horizontal page scroll.
- Empty discard shows field art.
- Non-empty discard shows top card art and count badge.
- Every actionable touch target is at least 44px.

- [ ] **Step 5: Verify production configuration compatibility**

Confirm the client uses only `VITE_SERVER_URL`, the server uses the existing `CLIENT_URL` and `PORT`, and no new secret or persistent service is required. Start the built server:

```bash
npm start --prefix server
```

Expected: health endpoint responds and existing plus `lost-cities:*` Socket.IO handlers accept connections.

- [ ] **Step 6: Final commit if verification required fixes**

If and only if a Lost Cities defect was fixed:

```bash
git add shared/lostCities.ts server/src/lostCitiesRules.ts server/src/lostCitiesRules.test.ts server/src/lostCities.ts server/src/lostCities.test.ts server/src/index.ts client/src/App.tsx client/src/LostCitiesGame.tsx client/src/style.css
git commit -m "fix: complete lost cities release verification"
```
