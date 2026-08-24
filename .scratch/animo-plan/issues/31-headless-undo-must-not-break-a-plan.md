# 31 — [headless] Undo must refuse rather than hit the plan foreign key

**What to build:** `undo_last_capture` gains the plan-membership guard that `Store::forget_course` already has. Today, capturing a course, adding one of its sections to a plan, and then pressing Undo surfaces a raw SQLite error to the student.

**Blocked by:** None — can start immediately

**Status:** ready-for-agent

## The defect

`undo_last_capture` calls `reverse_batch`, which deletes the sections the batch introduced:

```rust
tx.execute("DELETE FROM sections WHERE id = ?1", [record.section_fk])?;
```

`plan_sections.section_fk` references `sections (id)` with **no `ON DELETE CASCADE`**, and `PRAGMA foreign_keys` is on. If the student added one of those sections to a plan, the delete violates the constraint and the error reaches the UI as a bare SQLite message.

Ticket 29 solved exactly this for `forget_course`: it collects the section row ids, checks `plan_sections` first, and returns `StoreError::CourseHeldByPlans` naming the plans, leaving the catalog untouched. Undo never got the same treatment — it is the older path, written before plan membership could reach captured rows.

**Nothing is currently corrupted.** `undo_last_capture` restores `self.last_batch` when `reverse_batch` fails, so the journal survives and the transaction rolls back. The bug is the unhandled failure, not data loss.

## Decided before dispatch — refuse, do not cascade

Two behaviours were considered:

- **Undo also removes the sections from the plan.** Rejected: the student's plan is the artifact they are building, and a capture-level undo silently editing it is a surprise in the one place surprises are most expensive.
- **Chosen: refuse, and say which plans hold it**, exactly as `forget_course` does. The journal is already preserved on failure, so removing the section from the plan and pressing Undo again works. Ticket 30's UI already renders this refusal shape as a visible notice.

## Acceptance criteria

- [ ] `undo_last_capture` **checks plan membership before deleting anything** and refuses with an identifiable error naming the plans that hold the batch's sections. The catalog and the plan are both left untouched
- [ ] The error is the same shape ticket 30's UI already renders, so a refused undo reads like a refused course removal rather than a crash
- [ ] **The undo journal survives a refusal**, so removing the section from the plan and pressing Undo again succeeds. This already holds; a test must pin it
- [ ] An undo whose sections are in no plan behaves exactly as it does today — sections, blocks, snapshots, and newly introduced course rows all reversed
- [ ] A batch where *some* sections are plan-held and some are not is refused **whole**, never partially applied: a half-reversed capture is worse than a refused one
- [ ] Sections that existed before the batch are still restored to their prior blocks and `last_seen_at` rather than deleted, unchanged from today
- [ ] Tests cover: undo refused when a plan holds a section and naming that plan, the journal still usable afterwards, undo succeeding after the section is removed from the plan, an all-or-nothing refusal on a mixed batch, and the ordinary undo path unaffected
