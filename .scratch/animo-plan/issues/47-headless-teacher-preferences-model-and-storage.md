# 47 — [headless] Teacher preferences: identity, storage, IPC

**What to build:** The model and persistence behind teacher ranking — a normalized teacher identity, a table of per-course preferences, and the IPC to read and write them. **The solver does not change in this ticket** (that is 48) and nothing renders it (that is 49). This ticket makes the data exist and be correct.

**Blocked by:** None — can start immediately

**Gates:** 48, 49

**Status:** ready-for-agent

## Why

SPEC §11 parks "professor filters" under v1.1+, and `solver.rs` already carries the reservation:

```rust
/// `teacher: None` means *unknown* too, and no constraint ever reads it: a
/// blank teacher is never a mismatch (professor filters are v1.1 and must
/// not leak in here).
```

This is that feature, and it starts with a question the codebase has never had to answer: **what is a teacher, as a thing you can rank?** Today `teacher` is a free-text string on a snapshot, appended on every capture, with no identity of any kind.

## The vocabulary

`CONTEXT.md` now defines these. Use them exactly; the app's word is **teacher**, never *professor*, *prof*, *instructor*, or *faculty*, in code or in copy.

- **Teacher** — the person named on a snapshot
- **Teacher key** — the normalized name, and the only thing a preference is keyed on
- **Teacher ranking** — a student's ordered preference among one course's teachers
- **Avoided teacher** — a teacher whose sections the student refuses, for one course
- **Priority** — how heavily a ranking weighs against the preset (48 uses it; define it here if the IPC needs it, otherwise leave it to 48)

## Teacher identity

New pure module, `src-tauri/src/core/teachers.rs`, with colocated tests. No I/O, no Tauri.

- [ ] `teacher_key(name: &str) -> Option<String>` — **trim, case-fold, collapse inner whitespace runs to one space**. `"  BRYANT   lee "` and `"Bryant Lee"` must produce the same key
- [ ] **A blank or whitespace-only name has no key** — returns `None`. This is the hinge of the whole feature: unknown is not an identity, so it can never be ranked, never be avoided, and never be matched
- [ ] The **verbatim name is preserved for display** alongside the key. A student sees `"Bryant Lee"`, never `"bryant lee"`
- [ ] Deliberately *not* solved here: `"Lee, Bryant"` vs `"Bryant Lee"`, and `"B. Lee"` vs `"Bryant Lee"`. Those are the same human and will produce different keys. Do not attempt name parsing — a wrong merge is worse than two entries, and the student can rank both. Say so in the module doc so the next reader does not "fix" it

## Storage

Migration **7** (`user_version` is at 6; migration 6 is the sample-data removal).

- [ ] One row per `(campus_id, session_id, course_id, teacher_key)` carrying **either a rank or an avoid, never both**. Enforce it in the schema — a `CHECK` making the two mutually exclusive — so the contradictory state cannot be stored, not merely cannot be written by today's code
- [ ] Store the display name on the row. The snapshot it came from may later be superseded, and the student must still see the name they ranked
- [ ] **No foreign key to `courses`.** `forget_course` deletes the course row outright, and a preference must survive that (see below). A dangling scope tuple is the intended state here, not a bug
- [ ] `STRICT`, like every other table
- [ ] Ranks are **contiguous from 1 within a course** — the store owns that invariant. Whatever the caller sends, what lands is `1..n` with no gaps and no ties. Reordering a list of three must never be able to produce ranks `1, 1, 3`
- [ ] Migration is idempotent on an existing database and leaves every existing row alone — there is a test for exactly this shape already (`migration_is_idempotent_on_an_existing_database`)

## What the store exposes

- [ ] **Read the rankable teachers of a course**: the distinct teachers on the **latest snapshot of each of that course's sections**, keyed and de-duplicated, each with a display name and the sections they are listed on. Latest only — a teacher who has been replaced cannot be assigned, so ranking them is noise
- [ ] **Read a course's preferences**, including entries whose teacher no longer appears in that latest-snapshot set. Those are **inactive**: kept, returned, flagged, and scoring nothing
- [ ] **Write a course's preferences** as a whole ordered list plus an avoid set — one call replacing the course's rows in a transaction. A drag-reorder is one write, not n
- [ ] **Forgetting a course leaves its preferences alone.** They lie dormant and come back if the course is re-captured. `CONTEXT.md` already says "excluding is not forgetting"; this is the same principle one noun over, and ADR-0008's reasoning applies: silent removal of the student's own work is the worst available failure
- [ ] Preferences are **app-wide within a capture scope**, shared by every plan under that `(campus, session)`. They are not plan data and must not be copied into a plan

## IPC

- [ ] Commands to list a course's rankable teachers, read its preferences, and write them. Follow the existing naming and the `*Args` struct convention in `commands.rs`
- [ ] **Amend `docs/ipc-contract.md`** in the same commit. Ticket 46 set the standard here — a command that exists but is not in the contract is a defect
- [ ] Mirror the types in `src/adapters/ipc/types.ts` with the same doc comments, as every other command does

## Testing

- [ ] `teachers.rs` gets its own tests: casing, whitespace, blank, and the two names-that-are-one-human cases asserted as *known separate keys*, so the limitation is pinned rather than accidental
- [ ] Store tests: rank contiguity after a reorder; the mutual-exclusion CHECK actually rejecting; preferences surviving `forget_course`; preferences returning as inactive when a teacher leaves the latest snapshots; two capture scopes with the same `course_id` not seeing each other's preferences (there is a precedent test, `forgetting_in_one_scope_leaves_the_same_course_id_in_another_scope_alone`)
- [ ] A blank teacher never produces a rankable entry, at every layer

## Worth knowing before starting

Read ADR-0020 and ADR-0021 first — they were written for this work and settle the questions this ticket's shape depends on. `SPEC.md` §2 records that **`Teacher` was empty in 42/42 GEARTAP rows and 3/5 CSINTSY rows**: an empty rankable list is the *normal* case early in a term, not an error, and every layer must be comfortable with it.
