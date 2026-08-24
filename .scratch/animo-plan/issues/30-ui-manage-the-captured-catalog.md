# 30 — [ui] Remove a captured course, and make Undo honest

**What to build:** The picker gains a way to take a course back out of the captured catalog, and the Undo button stops being silently unexplainable when it is greyed out.

Observed: after capturing five courses, the counter reads "19 sections from 5 courses", Undo is disabled with no indication why, and nothing anywhere offers to remove a course from the list. The student's only options are to keep a mistaken capture forever or delete the database.

**Blocked by:** 29

**Status:** ready-for-agent

## Already built — do not rebuild

- **`SectionPicker`** and its course dropdown, section cards, and add/remove/pin controls for *plan membership*. This ticket adds a control for the *captured catalog*, which is a different thing: removing a course from the catalog is not the same as removing a section from a plan, and the UI must not blur them.
- **The Undo button** in `CaptureBar`, wired to `canUndo` from `CaptureSummary`. Its behaviour stays; only its explanation changes.

## Decided before dispatch — why Undo is not simply made better

`Store::last_batch` is in-memory and single-level: it does not survive a restart, and it only ever reaches the most recent capture. Persisting a full undo journal was considered and rejected for now — an explicit "remove this course" (ticket 29) is what the student actually wants, is easier to reason about, and does not require inventing a durable multi-level history. Undo stays a short-range convenience for the capture you just made, and the UI says so.

## Acceptance criteria

- [ ] Each captured course in the picker offers a **remove** action that calls the ticket-29 command and updates the course list and the capture counter from the returned summary
- [ ] **Removal asks for confirmation first**, naming the course and how many sections go with it. It is destructive and unlike every other control on the surface
- [ ] The control is visibly distinct from "remove from plan" and cannot be mistaken for it. Removing a captured course is a catalog action; removing a section is a plan action
- [ ] When ticket 29 refuses because a plan holds one of the course's sections, **the error names those plans** and the student is told to remove it from the plan first. It surfaces as a visible, non-blocking notice, never a silent no-op
- [ ] **A disabled Undo explains itself** — that undo covers only the most recent capture and is not available after a restart. Today the tooltip reads "Undo last captured course batch" whether or not anything can be undone
- [ ] Undo's existing behaviour is unchanged when it *is* available
- [ ] Removing the last course of a scope leaves the picker in its ordinary empty state, not an error
- [ ] Nothing here can delete a plan or a plan's membership (ADR-0008 boundaries stay where ticket 29 put them)
- [ ] Tests cover: the remove control appearing per course, the confirmation step, the refusal path naming the blocking plan, the counter updating from the returned summary, and the disabled Undo carrying its explanation
