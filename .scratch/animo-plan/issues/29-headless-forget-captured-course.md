# 29 — [headless] Forget a captured course

**What to build:** A command that removes one course and its sections from the captured catalog, so a course captured by mistake can be taken back out. Today nothing in the app can do this: the only removal path in the entire codebase is undo, and undo cannot reach past the most recent capture of the current app run.

**Blocked by:** None — can start immediately

**Gates:** 30

**Status:** ready-for-agent

## Why undo does not already cover this

`Store::last_batch` is an ordinary in-memory field, set to `None` by `Store::open` and never persisted. Two consequences the student sees directly:

- **Undo does not survive a restart.** The captured rows are in SQLite and come back; the journal that could reverse them does not. `capture_summary` reports `can_undo: false` and the button greys out, with a tooltip that still reads "Undo last captured course batch" and never says why it is unavailable.
- **Undo is single-level.** After capturing five courses, one press reverses only the fifth. There is no way back to the first four.

`reverse_batch` itself is correct — it deletes the course row when `existed_before` is false, so an *available* undo does remove the course from the picker. The gap is availability, not correctness. This ticket does not change undo; it adds the explicit removal path that undo was never meant to be.

## Decided before dispatch — this is not an ADR-0008 violation

ADR-0008 says sections are never hard-deleted. That rule is about **capture-side inference**: a section that stops appearing in Archer's Hub is flagged missing, never deleted, because its absence might be a parse failure or a page change rather than a real withdrawal. `undo_last_capture` is already documented in `store.rs` as "the one deliberate row-removal path… an explicit user reversal of the batch". This command is the second one, and of the same kind: the student says remove this, and only what they named is removed.

Removal stays explicit and narrow — one course in one `(campus, session)`, never a sweep, never inferred.

## Acceptance criteria

- [ ] A command removes one captured course and its sections for a given `(campus, session)`, and returns the updated `CaptureSummary` so the counter re-renders from one source of truth
- [ ] **A section that belongs to a plan is never silently deleted.** `plan_sections.section_fk` references `sections (id)` with no `ON DELETE CASCADE` and `PRAGMA foreign_keys` is on, so a raw delete fails with a constraint error rather than doing something sensible. The command must detect this first and **fail with an identifiable error naming the plans that hold the course**, so the student removes it from the plan themselves rather than having a plan silently gutted
- [ ] Removing a course removes its sections, their schedule blocks, and their snapshots — and **nothing outside the named course**. A course in another `(campus, session)` with the same course id is untouched
- [ ] The removal is one transaction: a failure part-way leaves the catalog exactly as it was
- [ ] The sample plan's reserved scope (ticket 27) is subject to the same rules — the sample data is removable like anything else, and removing it does not disturb a real scope
- [ ] If the removed course was the subject of the pending undo batch, the journal is dropped rather than left pointing at rows that no longer exist
- [ ] `get_capture_summary` and `list_captured_courses` reflect the removal immediately
- [ ] The command is exposed through the existing IPC seam. Adding a command is a contract amendment under ticket 02's protocol: update `docs/ipc-contract.md` and `src/adapters/ipc/` in the same commit and name it in the PR description
- [ ] Tests cover: removing a course the student captured, refusing when a plan holds one of its sections and naming that plan, scope isolation across `(campus, session)`, blocks and snapshots going with the sections, and the pending undo journal not being left dangling
