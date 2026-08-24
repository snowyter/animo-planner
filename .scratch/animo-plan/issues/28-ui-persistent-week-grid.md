# 28 — [ui] Keep the week grid visible while picking sections

**What to build:** The ghost preview becomes useful. Hovering a section in the picker already paints a translucent ghost on the week grid (ticket 13), but the grid sits *below* the picker — so with a course like GEARTAP's 42 sections, the grid is scrolled far off-screen at the moment the student is hovering. The preview is rendered where nobody can see it.

The fix is layout, not new preview mechanics: while the picker is open, the week grid stays on screen.

**Blocked by:** None — can start immediately

**Status:** ready-for-agent

## Already built — do not rebuild

- **The ghost preview itself.** `WeekGrid` already accepts preview sections and renders them translucent and labelled `PREVIEW`; `useSectionPicker` already tracks the hovered section. The preview logic is correct and stays as it is.
- **The week grid.** Hand-rolled CSS grid, hue-by-course, modality borders, hatched conflicts. **No external calendar library** (ADR-0011) — this ticket does not change how the grid draws, only where it lives.

This ticket moves the grid into view and nothing else.

## Decided before dispatch — a sticky grid, not a smaller one

Considered and rejected:

- **Shrink the preview into a mini-map beside the list.** A second, smaller rendering of the week is a second thing to keep correct, and it fails the exact case that motivates the ticket: judging whether a 7:30 AM section really works needs the real grid, not a thumbnail.
- **Scroll the grid into view on hover.** Yanking the page under the cursor while the student moves down a list of 42 sections is worse than not previewing at all.
- **Move the grid permanently above the picker.** One-line reorder, but it buries the picker behind a tall grid for the far more common case where the student is not previewing anything.

**Chosen: the picker and the week grid sit side by side while the picker is open, and the grid is `position: sticky` so it stays in view as the student scrolls the section list.** Nothing is removed, nothing is duplicated, and the preview lands where it was always meant to.

## Acceptance criteria

- [ ] While "Pick my own sections" is open at desktop widths, the **week grid and the section list are visible at the same time**, and hovering any section paints its ghost on a grid the student can actually see
- [ ] The grid **stays in view while the section list scrolls** — scrolling through all 42 GEARTAP sections never scrolls the grid away
- [ ] Below the breakpoint where two columns stop fitting, the layout **degrades to a single column with the grid above the picker**, so the preview is still reachable on a narrow window. The grid must never sit below the list on narrow widths
- [ ] The page **never scrolls horizontally**; the grid keeps its own horizontal overflow if it needs one
- [ ] When the picker is closed, the plan surface keeps its current single-column reading order — this layout applies while picking, not permanently
- [ ] The ghost preview's appearance, the hue-by-course encoding, modality borders, and hatched conflict display are **unchanged** (ADR-0011, ADR-0012)
- [ ] Nothing about conflicts is prevented or hidden by the new layout (ADR-0009)
- [ ] Tests cover: the grid and the picker rendering together while the picker is open, the preview still rendering on hover in the new layout, and the single-column fallback keeping the grid ahead of the list
