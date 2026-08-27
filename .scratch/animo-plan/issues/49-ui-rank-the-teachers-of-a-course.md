# 49 — [ui] Rank the teachers of a course

**What to build:** The surface where a student ranks and avoids teachers — a full-width drill-down from a course row in the Capture tab, with drag-to-reorder — plus the `Priority` control in the Solve panel and an advisory notice when a refresh lands an avoided teacher on a section already in the plan.

**Blocked by:** 47 (needs the IPC)

**Runs in parallel with:** 48 — they share no files. 49 can be built and merged before the solver honours anything; the ranking simply has no effect until 48 lands

**Status:** done — merged to main in `4398c76`

## Why

A student has two or three teachers they want for a course and one they will not take. Today the app has no way to say so, and the information is right there — the Teacher column of every captured section.

## The drill-down

**Decided: ranking does not replace the week grid.** Ticket 46 settled that the grid sits in the same place at the same size on every tab — *"the app should feel like changing a tool, not changing a screen"* — and there is a test enforcing it (`draws the week grid on every tab, in the same place`). Ranking is not a fourth tool acting on the grid; it is a place you go and come back from. So it takes the **entire workspace width**, which is more room than displacing the grid would have given it, and the rule survives.

- [ ] Entered from a **course row in the Capture tab's captured catalog** — that is where the per-course data already lives, and where the teacher names come from
- [ ] Opens across the full workspace width with an **explicit way back**. Leaving returns to the Capture tab, on the same course, scrolled where it was
- [ ] The plan header stays put. This is a drill-down within the workspace, not a different screen and not a modal
- [ ] Works at **1400×900** (the size `tauri.conf.json` opens at) and at the **1024 minimum width**

## The list

- [ ] One list per course, showing every rankable teacher of that course with the sections they are listed on. **A ranked region, and an avoided region below it** — dragging between them is how a teacher becomes avoided or stops being avoided
- [ ] The model permits **either a rank or an avoid, never both** (ticket 47 enforces it in the schema). The single-list design is what makes that legible: a teacher is somewhere in one order, and where they sit is what they mean
- [ ] **Demoting an avoided teacher back to neutral must be a drag, not a delete-and-re-add.** "Actually I don't mind them" is a common move and should cost one gesture
- [ ] Ranks are shown as **1, 2, 3** and renumber live as you drag. Contiguity is the store's invariant (ticket 47) — the UI must not be the only thing holding it
- [ ] An **inactive** entry — a teacher you ranked who no longer appears on any of that course's latest sections — stays in the list, visibly de-emphasised, labelled *"not currently listed for this course"*. It is kept, not deleted, for the same reason ADR-0008 keeps a vanished section
- [ ] **The empty state is the normal state early in a term.** `SPEC.md` §2 records `Teacher` empty in **42/42 GEARTAP rows** and 3/5 CSINTSY rows. Say so plainly and point at the fix: *"No teacher names captured yet — Archer's Hub fills these in closer to enlistment. Refresh to check."* Anything vaguer and students will report the feature as broken

## Drag and drop

- [ ] **`@dnd-kit/core` + `@dnd-kit/sortable`.** Approved for this ticket and only this ticket — **add it to `docs/agents/dependencies.md` in the same commit**, in the shape of the `motion` entry
- [ ] **Do not use `motion` here.** dnd-kit animates with its own CSS transforms, which is what makes the drag smooth *and* cheap. `motion` is approved for ticket 33 alone, and the dependency doc says a later ticket wanting it is a new question, not a precedent
- [ ] **Keyboard reordering is a first-class path, not a fallback.** dnd-kit ships a keyboard sensor; wire it, and give the list correct roles and a live region announcing each move
- [ ] Honour `prefers-reduced-motion`, as everything else does
- [ ] **Transform is a stacking-context and containing-block hazard.** The week grid's context menu is portalled to `document.body` and positioned `fixed`; tickets 41 and 45 were both this bug. A `transform` on a drag wrapper is fine inside the drill-down, but must not end up on an ancestor of the workspace

## The Priority control

- [ ] Lives in the **Solve panel**, with the other constraints: **Schedule · Teachers · Hybrid** (ADR-0021). Default `Schedule`
- [ ] A **read-only summary** beside it — *"3 courses ranked · 2 teachers avoided"* — linking back to the Capture tab. The panel is where you feel the effect; it is not where you do the setup
- [ ] **A ranking under `Priority::Schedule` is a no-op by design, and the interface must say so.** A student who spends five minutes ranking and sees nothing change will file it as broken. When preferences exist and priority is `Schedule`, say that teacher preferences are being ignored and offer the switch
- [ ] When a solve returns no solutions because avoidance emptied a course, the panel names the course and the reason (ticket 48 supplies it). "No solutions" must never be silent about why — ticket 34 set this bar

## The advisory notice

- [ ] `Teacher` populates over the term, so the common event is a section **already in your plan acquiring** an avoided teacher on a refresh. Raise an advisory notice naming the section and the teacher
- [ ] **It changes nothing.** Nothing is removed, nothing is re-solved (ADR-0009; SPEC: solve "never discards existing choices"). Model it on `MissingSectionBanner` — same family, same restraint
- [ ] Advisory never looks like an error
- [ ] It belongs with the **global notices, outside the tabs** (ticket 46) — visible from Pick, not only from Capture

## Testing

- [ ] The suite renders to static markup, so **the drill-down must be drivable from props**, the way `initialTab` and `initialToolsOpen` already are
- [ ] Cover: the list rendering ranked and avoided regions; the empty state and its copy; an inactive entry rendering as inactive; the Priority control; the no-op warning when preferences exist under `Schedule`; the advisory notice rendering regardless of selected tab
- [ ] **The ticket-46 layout tests keep passing unchanged** — in particular `draws the week grid on every tab, in the same place`. If that test needs editing, the design has drifted from what was decided here
- [ ] The ticket-40 export guard still passes

## Worth knowing before starting

The panel already collapses (`initialToolsOpen = false` in `PlanWorkspace.tsx`) and already opens on Capture (`DEFAULT_TOOL_TAB`), both from ticket 46 — build on them rather than rebuilding them. Read `src/core/toolPanel.ts` first: tab identity, ordering, and empty-catalog copy are decisions kept out of the markup on purpose, and anything this ticket adds in that family belongs there too.

## Comments

Merged in `4398c76`. The drill-down replaces the whole two-column workspace
rather than the grid, so ticket 46's rule survives and its layout tests pass
untouched. `motion` is not used anywhere in this ticket, as required.

One fix on main in `0f19021`: `TeacherRanking.tsx` imports
`@dnd-kit/utilities` directly but only `core` and `sortable` were declared —
it worked on npm hoisting alone. Now declared, and named in
`docs/agents/dependencies.md` alongside the other two.

Worth knowing for later: `teacherKey` in `src/core/teacherRanking.ts` is a
fourth normalization, unavoidably, because it is the other language. Its
tests mirror the Rust cases but nothing enforces the agreement across the
boundary. If the two ever diverge, preferences written by the UI silently
stop matching in the solver.
