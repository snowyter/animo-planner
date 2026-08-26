# 45 — [ui] The block context menu is painted over and clipped by the grid

**What to build:** The ticket-41 menu must render above every block and stay fully reachable near the grid's edges. Today blocks paint over it and the grid's scroll container cuts it off — on a 2:30 PM block, "Remove from schedule" cannot be clicked at all.

**Blocked by:** None — can start immediately

## Two causes, both found

### 1. Every block creates a stacking context, so `z-50` is trapped

The menu renders inside the block it belongs to, with `absolute z-50`. That should beat its siblings — except every block carries an opacity class:

```tsx
const visualClass = isGhost
  ? "opacity-75 …"
  : isMissing
  ? "… opacity-90 …"
  : isPinned
  ? "… opacity-100"
  : "opacity-95";
```

`opacity` below 1 **creates a stacking context**. The menu's `z-50` is therefore resolved *inside its own block*, and any sibling block later in the DOM — every block below it in the same day column — paints over the whole subtree, menu included. That is exactly what the screenshots show: a menu opened on an 11:00 block is overlapped by the 12:45 block beneath it.

Note `opacity-100` on pinned blocks does **not** create one, so this misbehaves differently depending on whether the section is pinned. That is a good tell if you want to confirm the cause before changing anything.

### 2. The grid clips it

The grid wrapper is `overflow-hidden`, and the scroll container inside it is `overflow-x-auto`. Per CSS, when one axis is not `visible` the other computes to `auto` — so that container clips vertically too. A menu opened on a late-afternoon block extends past the container and is cut off, with the destructive item at the bottom the first thing to go out of reach.

## The fix

Render the menu **outside the grid subtree** — a portal to the document body — positioned against the viewport rather than the block. That escapes both the stacking context and the clipping container at once, and it is the only fix that solves them together. Position it from the block's measured rectangle, and flip it when it would leave the viewport.

Do not chase this with higher `z-index` values or by removing the opacity classes: the first cannot escape a stacking context and the second changes how every block looks.

## Acceptance criteria

- [ ] **The menu paints above every block**, whatever the section's pinned, missing, or conflicting state, and whatever is below it in the column
- [ ] **The menu is never clipped by the grid.** Every item, including the destructive one at the bottom, is reachable for a block at any time of day — verify on a 2:30 PM block and on the last row
- [ ] **It flips rather than clips** at the bottom and right edges: the Saturday column and the last row of the day both stay fully on screen
- [ ] **It tracks the block if the grid scrolls**, or closes. It must never float detached from the block it belongs to
- [ ] **The hover tooltip does not appear over an open menu.** Today the block's native `title` tooltip renders on top of the menu, which is both ugly and two answers to the same question — ticket 41 flagged this and it is still open. Decide whether the tooltip survives at all now that View details exists, and say which in the commit
- [ ] Everything ticket 41 established still holds: ghost blocks inert, keyboard opening (Enter / Space / Menu key / Shift+F10) and Escape closing, close on click-outside, focus visible, nothing interactive in the PNG export
- [ ] Tests cover: the menu rendering outside the grid's clipping subtree, edge placement flipping, and the ticket-41 behaviours that must not regress

## Worth knowing before starting

The frontend suite renders to static markup — `createPortal` needs a DOM and will not mount under it. The menu must still render assertable markup in the test environment, or the ticket-41 tests that check its items will go silently vacuous. Check what those tests assert before changing where the menu mounts, and if a portal makes them meaningless, replace them with something that still fails when the menu is wrong.

This is a missed acceptance criterion from ticket 41 ("the menu must flip rather than clip at the edges"), found in use rather than in review.
