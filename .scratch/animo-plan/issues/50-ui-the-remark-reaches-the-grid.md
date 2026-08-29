# 50 — [ui] The remark reaches the grid, the tooltip, and the export

**What to build:** Show a section's `remark` on the week grid block, in the block's hover tooltip, and in the PNG export. For at least one whole course family the remark is the only thing that tells two sections apart, and all three of those surfaces currently drop it.

**Blocked by:** None — can start immediately

**Status:** ready-for-agent

## Why

`SPEC.md` §2 recorded `Remark` as empty in all 47 rows first observed, contents unknown. A PETHREE capture on **2026-08-28** returned this:

| Section | Type | Credits | Schedule | Cap | Remark |
|---|---|---|---|---|---|
| Y16H | Lecture | 2 | SAT 01:00–03:00 PM · R7B | 45 | **PICKLEBALL** |
| Y14H | Lecture | 2 | SAT 08:00–10:00 AM · R7B | 45 | **PICKLEBALL** |
| Y07K | Lecture | 2 | SAT 03:30–05:30 PM · ERPOOL | 45 | **SWIMMING** |
| Y09J | Lecture | 2 | SAT 08:00–10:00 AM · R804 | 45 | **SOCDANCE** |

Course code, section code, credits and course type are identical down the column. **For a PE course the remark is the activity**, and a student choosing between these sections is choosing between swimming and social dance — a fact the grid never shows them.

Today the remark reaches three surfaces (`SectionPicker.tsx:408`, the grid's details modal at `WeekGrid.tsx:1156`, and the copied text from `gridMenu.ts:39`) and is missing from three more. So a student who solves a PE course sees two indistinguishable `PETHREE` blocks and has to right-click each one to find out which is which.

## Decided before dispatch

**The remark is still never parsed.** `CONTEXT.md`: *"`remark` is stored and displayed verbatim. Never parsed, never branched on."* `PICKLEBALL` and `SWIMMING` are a small open vocabulary the university can extend whenever it likes — there is no allowlist, no icon map, no colour per activity, and no "if remark contains…" anywhere. **Hue still encodes course identity only** (ADR-0012); the remark is text.

**Blank stays invisible and costs nothing.** Most courses still have no remark at all. A section without one must render exactly as it does today — no empty row, no placeholder, no dash, and above all no change in block height. This is the constraint that makes the feature safe to add to a surface holding ~40 blocks.

## Acceptance criteria

### The block

- [ ] A section with a remark shows it on its grid block, legibly, at the app's default window size (1400×900) and at the 1024 minimum width
- [ ] **A section without a remark is unchanged** — same height, same rows, same spacing as today. Verify by rendering a grid with and without and diffing
- [ ] The block does not grow. It is `minHeight: 56px` with three rows already (code + section + badges, location + enrolment, time range); a 90-minute block is not tall, and a fourth full row is not free. Prefer putting the remark where it can share a row, and **truncate rather than wrap**
- [ ] A long remark truncates with the full value available on hover — the values seen are single words, but nothing guarantees that and an unbounded string must not break the block
- [ ] Ghost/preview blocks, missing-flagged blocks, and conflicting blocks keep their existing badges and treatment. The remark is one more piece of content, not a new state
- [ ] No new per-element animation (ticket 33): this renders on every block on the grid

### The tooltip

- [ ] `blockTooltip` (`WeekGrid.tsx:153`) includes the remark when there is one, and omits the line entirely when there is not — the same shape it already uses for `Enrolled`
- [ ] It is a pure function with colocated tests. Add cases for present, blank, and whitespace-only

### The export

- [ ] **The PNG export shows the remark**, because it renders the same blocks (ticket 40's container, ticket 44's title). An exported PE schedule that cannot say which section is swimming is the same defect one layer out
- [ ] Ticket 40's export guard still passes, and the export still contains the schedule — **export one and look at it**

### Everywhere else a section is named

- [ ] Audit the surfaces that name a section and either carry the remark or deliberately do not, with the reason written down. Known: `SectionPicker` and the details modal already do; the solve panel's `SolutionCard` should be checked, because a solver that proposes a PE section the student cannot identify has not finished the job
- [ ] The `.ics` export already carries it (`ics.rs`) — leave it alone, but confirm

## Testing

- [ ] The suite renders to static markup, so drive this from props as everything else does
- [ ] Cover: a block with a remark renders it; a block without one renders identically to today; a long remark truncates; the tooltip includes and omits the line correctly; the export contains the remark
- [ ] **A guard that nothing branches on the remark's value.** A source-level check in the spirit of the ticket-40 export guard: no comparison of a remark against a literal, no lookup keyed on it. This is the rule most likely to be broken by a well-meaning later change that wants a swimming icon

## Worth knowing before starting

`WeekGrid` is the file tickets 28, 32, 33, 41, 45 and 46 all touched. Two hazards live in it and neither is in scope to change: the context menu is portalled to `document.body` and positioned `fixed`, so no `transform`, `filter`, or `backdrop-filter` may land on an ancestor; and the lattice fades when the grid is empty, which is an `opacity` that creates a stacking context. Read the module doc before moving anything.
