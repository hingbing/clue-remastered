# Lost Cities Desktop Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Lost Cities desktop board keep stable field dimensions, show all hand cards, and clearly communicate available draw actions.

**Architecture:** Keep all game state and Socket.IO behavior unchanged. Add semantic draw-state classes and helper text in `LostCitiesGame.tsx`, then use the existing CSS grid layout in `style.css` to reserve stable tracks and apply high-contrast action styles.

**Tech Stack:** React, TypeScript, Vite, CSS Grid

## Global Constraints

- Modify only the Lost Cities client board markup and styles.
- Preserve existing game rules, Socket.IO events, and mobile portrait rotation notice.
- Desktop hand cards must remain fully visible; small landscape layouts may use the existing compact override.

---

### Task 1: Add draw-phase UI semantics

**Files:**
- Modify: `client/src/LostCitiesGame.tsx:253-299`
- Test: client TypeScript/Vite build

**Interfaces:**
- Consumes: existing `isViewerTurn`, `room.turnPhase`, `discardAvailable`, and `room.drawPileCount`.
- Produces: `lostCitiesDiscardAvailable`, `lostCitiesDiscardHint`, and `lostCitiesDrawPrompt` DOM elements.

- [ ] **Step 1: Establish the visual test case**

At draw phase, an eligible discard pile must receive `lostCitiesDiscardAvailable`; the deck area must render `lostCitiesDrawPrompt` with the text `카드를 뽑으세요`.

- [ ] **Step 2: Verify baseline build**

Run: `npm.cmd run build --prefix client`

Expected: PASS before the markup change.

- [ ] **Step 3: Add the minimal JSX semantics**

```tsx
className={`lostCitiesDiscard ${discardAvailable ? "lostCitiesDiscardAvailable" : ""}`}
{discardAvailable && <span className="lostCitiesDiscardHint">이 카드 가져오기</span>}
<p className="lostCitiesDrawPrompt">카드를 뽑으세요</p>
```

- [ ] **Step 4: Verify build**

Run: `npm.cmd run build --prefix client`

Expected: PASS with no TypeScript errors.

### Task 2: Stabilize the desktop board layout

**Files:**
- Modify: `client/src/style.css:1381-1583`
- Test: production client build and visual inspection

**Interfaces:**
- Consumes: `lostCitiesDiscardAvailable`, `lostCitiesDiscardHint`, and `lostCitiesDrawPrompt` from Task 1.
- Produces: a fixed desktop hand height, stable column tracks, and visible draw targets.

- [ ] **Step 1: Confirm the failing visual baseline**

At 2048px desktop width, the existing UI clips the hand, resizes columns after a discard, and makes the deck action too dark.

- [ ] **Step 2: Reserve non-board rows and stable column tracks**

```css
.lostCitiesGameShell {
  grid-template-rows: auto auto minmax(0, 1fr) auto clamp(116px, 15dvh, 148px);
}

.lostCitiesColumn {
  grid-template-rows: auto minmax(0, 1fr) minmax(72px, 0.9fr) minmax(0, 1fr) auto;
}
```

- [ ] **Step 3: Make draw actions legible**

Apply gold primary styling to `.lostCitiesDeck`, a persistent `.lostCitiesDrawPrompt`, and high-contrast hover/focus styling to `.lostCitiesDiscardAvailable`. Keep disabled discard piles passive.

- [ ] **Step 4: Verify build**

Run: `npm.cmd run build --prefix client`

Expected: PASS with no TypeScript or Vite errors.

- [ ] **Step 5: Perform visual regression inspection**

Open the board at the supplied desktop viewport. Verify all eight hand cards are fully shown, repeated play/discard actions keep field boundaries unchanged, and both available draw options are clear.

### Task 3: Verify and commit

**Files:**
- Modify: `client/src/LostCitiesGame.tsx`
- Modify: `client/src/style.css`
- Modify: `docs/superpowers/plans/2026-07-28-lost-cities-desktop-layout.md`

- [ ] **Step 1: Run the full project build**

Run: `npm.cmd run build`

Expected: PASS for server and client.

- [ ] **Step 2: Inspect final changes**

Run: `git diff --check` and `git diff -- client/src/LostCitiesGame.tsx client/src/style.css`

Expected: no whitespace errors and only requested Lost Cities changes.

- [ ] **Step 3: Commit**

Run: `git add client/src/LostCitiesGame.tsx client/src/style.css docs/superpowers/plans/2026-07-28-lost-cities-desktop-layout.md` then `git commit -m "fix: refine lost cities desktop board layout"`.

### Task 4: Prevent action-row overlap and enlarge discarded cards

**Files:**
- Modify: `client/src/style.css:1522-1680`
- Test: client TypeScript/Vite build

**Interfaces:**
- Consumes: the existing `.lostCitiesControlRow`, `.lostCitiesHand`, `.lostCitiesDiscard`, and `.lostCitiesDiscardCard` elements.
- Produces: a non-overlapping action row and readable discarded-card artwork.

- [ ] **Step 1: Establish the visual regression case**

At desktop width, selecting a hand card or entering the draw phase must not let its action button overlap the hand. A non-empty discard pile must show a recognizable card image.

- [ ] **Step 2: Reserve an action-row track above the hand**

Give the game-shell action row a `clamp(58px, 8dvh, 76px)` track and give `.lostCitiesControlRow` a matching minimum height, `position: relative`, and a positive `z-index`.

- [ ] **Step 3: Reserve space for discard-card artwork**

Increase the desktop discard row minimum to `128px` and size `.lostCitiesDiscardCard` with `height: calc(100% - 12px)` and `max-height: 132px`, preserving its aspect ratio.

- [ ] **Step 4: Preserve compact landscape behavior**

Override the action row and discard row minima in the existing `max-height: 470px` landscape query so short screens remain usable.

- [ ] **Step 5: Verify the client build**

Run: `npm.cmd run build --prefix client`

Expected: PASS with no TypeScript or Vite errors.
