# Level 4 — Domain Model & Data Architecture

> **Who this is for:** developers and analysts who need to understand *what the app
> knows* — its entities, storage schema, and business rules.
> Glossary terms match `CONTEXT.md` at the repo root.

## Domain entities

```
   Campus + Academic Session ("scope")          PLAN (the artifact)
   ─────────────────────────────────            ─────────────────────
   Every captured course and every              A named set of chosen sections,
   plan is stamped with exactly one             hard-scoped to ONE campus +
   campus id and one academic                   ONE session. Mixing terms is
   session id. It can never mix.                rejected, not warned about.

        COURSE                          PLAN_SECTION (membership)
        "CODE - TITLE", numeric id      a section added to a plan,
        e.g. CSINTSY                    with a PIN flag
        + included flag: the
        student's INTENT to take        PIN = lock this section;
        it. Capture ≠ intent — a        a solve treats it as fixed
        course can be searched,         and fills only around it.
        browsed, and counted            Excluded courses are not
        while excluded from the         offered in the picker and
        schedule math.                  not scheduled.

          │ 1..*
          ▼
       SECTION                          CONFLICT
       one scheduled offering of        two blocks overlapping in time
       a course; what a student         on the same day within a plan.
       actually enlists in              Computed & displayed,
          │                             NEVER prevented.
          │ 1..*
          ├─────────────────────────▶
          │
          ├──▶ SCHEDULE BLOCKS          MODALITY
          │    one meeting: day, start, derived per block from its
          │    end, location            location — never read as a
          │                             field. A section is F2F /
          └──▶ SNAPSHOTS (append-only)  Online / Hybrid based on
               point-in-time readings   the mix of its blocks.
               of the mutable values:
               enrolled count, teacher,
               remark. History IS data.
```

```
┌──────────┐        ┌───────────┐ 1..*  ┌──────────────────┐
│ courses  │1....*│ sections  │1....*│ schedule_blocks   │
└──────────┘        └───────────┘       └──────────────────┘
 PK(campus_id,       PK id (surrogate)     FK section_fk
    session_id,      UNIQUE natural key    day MON..SAT
    course_id)       (campus,session,      start_min / end_min
 code, title         course,section)       location NULL ⇔ online
 included 0|1        section_code, type,   modality F2F|ONLINE|NULL
 last_refreshed_at   credits, enroll_cap,
 (NULL until a       first_seen_at,
  refresh)           last_seen_at
                        │ 1..*
                        ▼
                     ┌───────────┐        ┌──────────┐        ┌────────────────┐
                     │ snapshots │        │ plans    │1....*│ plan_sections  │
                     └───────────┘        └──────────┘        └────────────────┘
                      FK section_fk        PK id (random)       PK(plan_id,section_fk)
                      captured_at          name                 pinned 0|1
                      enrolled             campus_id+session_id
                      teacher (NULL=unknown) created_at
                      remark (verbatim)
```

Storage is SQLite (`animo-plan.db` in the app-data directory), accessed by Rust via
`rusqlite` (ADR-0015 — Rust-owned behind IPC commands rather than `tauri-plugin-sql`,
so SQL never reaches the frontend). All tables are `STRICT`; every section row is written
together with its first snapshot in one transaction.

## The rules that shape everything

These are project invariants (`CONTEXT.md`, `docs/adr/`). Violating any of them is a defect.

### Scope discipline
- A plan is **hard-scoped** to `(campus_id, session_id)`. Linking a section from another
  scope fails at the storage layer with an error naming both scopes.
- Campus/session names come from one shared options table in Rust; unknown ids fail loudly.

### Time and modality
- **Modality is derived per block**: `Room - L226` → F2F; literal `Online` → ONLINE;
  anything else is kept representable and flagged, never guessed. The database enforces
  `location IS NULL` exactly when `modality = 'ONLINE'`.
- The week grid is **Mon–Sat** on a seven-slot 90-minute lattice — but the lattice is a
  layout convenience, never a parsing assumption. Block counts are never assumed either.

### History, not state
- Captures **append snapshots**; they never overwrite history. Seat-count change over time
  is itself information (fill velocity is planned v1.1 analysis).
- `teacher` and `remark` live on snapshots, not sections, for the same reason.
- **Blank teacher means unknown**, stored as SQL `NULL`. No filter may treat it as
  "not this professor" — that would silently discard valid sections.
- `remark` is stored and displayed verbatim. Never parsed, never branched on.

### Deletion is deliberate and visible
- **Sections are never hard-deleted** by the system (ADR-0008). If a saved section stops
  appearing during refresh it is *flagged missing*, with its remaining siblings surfaced
  as alternatives — silent removal during enlistment week is the worst failure mode.
- The only removal paths are user-initiated: remove-from-plan, delete-plan, or
  "forget this captured course" (which reports exactly which plans lost sections).

### Intent is separate from capture
- Searching a course and intending to take it are different acts. Each captured course
  carries an **`included` flag** for the student's intent; it defaults to included.
- **Excluding is not forgetting** (and not deleting): an excluded course stays captured,
  stays counted, and stays browsable. It simply drops out of the schedule math — the
  solver does not have to satisfy it and the picker does not offer it.
- The toggle is reversible at any time; there is no destructive edge.
- The catalog records **when each course was last refreshed** (`last_refreshed_at`),
  separate from `last_seen_at`, because a capture and a refresh both advance the latter —
  only the refresh stamp says which act produced the numbers on screen.

### Plans are free; solves are clean
- **A plan may legally hold conflicting sections** (ADR-0009). Conflicts are computed and
  rendered hatched; enlistment decisions belong to the student.
- **The solver only ever emits conflict-free sets.** Any conflict in a plan is therefore
  user-authored, never a surprise.
- Solving is always **seeded from the current plan**: pinned sections are fixed; unpinned
  members lead their course's search and are kept when possible. There is no mode that
  discards your work.

### Privacy as schema design
- Raw HTML can never reach a row: the store API accepts only typed parsed sections, and
  identity fields from the page (`hdnStudId`, `userID`, IP/MAC addresses) are never read.
- Plans get random opaque ids; nothing is keyed on user identity.

## Where each rule lives in code

| Rule | Enforcement point |
|---|---|
| Scope mismatch rejection | `store.rs` — `StoreError::ScopeMismatch` |
| Modality derivation | `parser.rs` — block classification; DB `CHECK` constraint |
| Missing-section flagging | `apply_refresh` → `missing_sections()` query → UI banner |
| Conflict computation | `conflicts.rs` (Rust + TS twin for previews) |
| Pinned-fixed solve semantics | `solver.rs` — `FixedSection.pinned`; store rejects solutions that override pinned membership |
| Snapshot append-only | `record_capture` / `apply_refresh` insert-only snapshot writes |
| Capture ≠ intent | `set_course_included` (migration 7 columns); `solver_courses` filters `included = 1` |
| Refresh freshness stamp | `apply_refresh` writes `courses.last_refreshed_at`; catalog rows expose it |
| Loud failures | `StoreError` taxonomy — every anomaly has a named error variant; no plausible-looking defaults |

## Data lifecycle

```
 capture ─▶ course row (included=1) + section row + snapshot #1
   │
   ├─ every later sighting ─▶ upsert fields + append another snapshot
   │
   ├─ include/exclude toggle ─▶ UPDATE courses.included (0|1); nothing else moves —
   │                             excluded courses stay browsable and counted, but
   │                             drop out of the solver catalog and the picker
   │
   ├─ refresh ─▶ trusted updates via apply_refresh (NOT the live capture path);
   │             vanished member ─▶ flagged missing (+alternatives), row kept;
   │             course stamped courses.last_refreshed_at
   │
   ├─ plan edits ─▶ plan_sections rows (add/remove/pin); solver may rewrite unpinned
   │                memberships atomically via apply_solution
   │
   └─ forget course (user action) ─▶ sections/blocks/snapshots removed for that scope,
                                     holding plans released, affected plans reported back
```
