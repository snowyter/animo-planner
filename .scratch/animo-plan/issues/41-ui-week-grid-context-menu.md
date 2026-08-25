# 41 — [ui] Right-click a block on the week grid to act on it

**What to build:** A context menu on each schedule block in the week grid, and a details modal behind it. The grid is where the student forms opinions about their schedule — "this 7:30 is brutal", "this one stays" — and today it is the one surface where none of those opinions can be acted on.

**Blocked by:** None — can start immediately

## Already built — do not rebuild

- **`WeekGrid` already declares `onSelectSection` and already calls it on click**, guarded against ghosts and non-plan sections. **No caller anywhere passes it.** So every block renders `cursor-pointer` and does nothing — the grid already promises this feature. That prop is where this ticket starts
- **The commands exist.** `removeSectionFromPlan` and `setSectionPinned` are on the contract and used by the picker. Remove and pin need **no new IPC**
- **The data exists.** `PlanSection` carries `courseTitle`, `modality`, `blocks`, `pinned`, `missing`, and `latestSnapshot` (`teacher`, `enrolled`, `remark`, `capturedAt`)
- **Conflicts are already computed in the component** — `findConflicts` and `isBlockConflicting` run per block for the hatching

## The menu

Right-click (not left) opens it. Left-click stays free.

- [ ] **View details** — opens a modal: course code and full title, section code, every block with day, time, room, and modality, teacher, enrolment, remark verbatim, and how old the capture is
- [ ] **Pin / Unpin** — toggles `setSectionPinned`. Reads as the state it will move to, and shows the current state clearly
- [ ] **Show other sections of this course** — points the picker at that course so the existing ghost-preview flow takes over. The grid is where the problem is noticed; the picker is where it is fixed
- [ ] **Remove from schedule** — `removeSectionFromPlan`. Plan membership only; the captured catalog is untouched, and the wording must not let it be mistaken for "remove course from catalog", which is a different and more destructive action
- [ ] **Copy details** — course, section, days and times, room, teacher as plain text, for pasting into a group chat
- [ ] **Why is this conflicting?** — only on a conflicting block. Names the other section and the overlapping window. Conflicts are displayed and never prevented (ADR-0009); this explains one rather than acting on it
- [ ] **Why is this flagged?** — only on a `missing` block. Says the section stopped appearing in Archer's Hub and when it was last seen. Sections are never hard-deleted (ADR-0008), and a student has no way to ask what the flag means today

Destructive last, separated from the rest. Removal needs no confirmation — it is reversible from the picker — but it must not sit where a mis-aimed click lands.

## Acceptance criteria

- [ ] Right-clicking a plan block opens the menu; the browser's own context menu does not appear over a block, and **still behaves normally everywhere else** in the app
- [ ] **Ghost / preview blocks are inert.** They are `pointer-events-none` today and stay that way — hovering the picker must never arm a menu
- [ ] Every action reflects in the grid **without a manual refresh**: removing clears the block, pinning restyles it. Route through the same plan reload the other mutating handlers use
- [ ] The menu closes on action, on Escape, on click-outside, and on scroll; it never traps focus and never leaves an orphan open when the plan reloads underneath it
- [ ] **The menu stays on screen** for a block at any edge — the Saturday column and the last row of the day both need it to flip rather than clip
- [ ] **Keyboard reachable.** Blocks are `<div>`s with `onClick` today and are not focusable at all, so a menu that only opens on right-click is a regression. Blocks become focusable with a visible focus ring, and the menu opens from the keyboard
- [ ] **Nothing interactive leaks into the PNG export.** `ExportMenu` renders its own `WeekGrid`; a menu affordance, focus ring, or open menu appearing in the exported image is a defect (see ticket 40)
- [ ] **Blocks get as small as 56px.** Verify at a one-hour 7:30am block, not only on a three-hour one
- [ ] Hue still encodes course identity only (ADR-0012). The menu and modal introduce no colour that could be read as data
- [ ] The existing `title` tooltip and the new details modal must not be two different answers to the same question. Decide, and say which in the commit
- [ ] Tests cover: the menu rendering its items for a plan block, the conflict-only and missing-only items appearing only in those states, a ghost block offering nothing, the details modal rendering each field including a blank teacher as *unknown*, and the export container rendering no menu affordance

## Worth knowing before starting

The frontend suite renders to static markup — no DOM, no effects, no portals, no refs. A menu whose open state lives only in a ref or an effect will render as nothing under test. Drive open state from props or state that a static render can be given, the way `initialConfirmingClear` already does in `PlanWorkspace`.

A blank teacher reads as **unknown**, never as a dash and never as absent (CONTEXT.md). `remark` is opaque: shown verbatim, never parsed.
