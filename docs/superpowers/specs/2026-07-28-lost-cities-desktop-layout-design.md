# Lost Cities Desktop Layout Refinement

## Goal

Make the desktop game board use its available vertical space consistently: all eight hand cards must be visible, expedition columns must not resize after a discard, and draw choices must be visually obvious.

## Scope

- Update only the Lost Cities client board markup and styles.
- Preserve existing game rules, Socket.IO events, and mobile portrait rotation notice.

## Layout

- Reserve a larger, responsive fixed-height hand area on desktop so every card image remains fully visible.
- Keep the board as the single flexible row in the game shell; header, action row, and hand area retain predictable heights.
- Give each column stable grid tracks for opponent expedition, discard pile, and viewer expedition. Cards are contained within their assigned track, so adding or removing a discard card cannot change the field height.

## Draw Affordances

- Add a visible draw prompt during the draw phase.
- Style the deck draw button as a high-contrast gold primary action.
- Style each eligible discard pile as a selectable secondary draw target with a bright outline, label, and hover/focus state.
- Ineligible discard piles keep their non-interactive appearance.

## Verification

- Build the client TypeScript/Vite bundle.
- Inspect the desktop board at the provided 2048px-wide layout and confirm: all hand cards are visible, repeated discard/play actions keep column heights fixed, and draw targets are clearly readable.
