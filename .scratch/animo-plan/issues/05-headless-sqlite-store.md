# 05 — [headless] SQLite schema, dedupe upsert, and snapshot append

**What to build:** Parsed sections persist to a local SQLite database and survive a restart. Capturing the same course twice updates the existing rows instead of duplicating them, and each capture appends a point-in-time snapshot so the app can later see how a section's enrolment, teacher, and remark changed over time.

The schema is specified in `SPEC.md` §5, including the reasoning for why `teacher` and `remark` are snapshot columns rather than section columns. SQLite is chosen over JSON files because fill-velocity and cross-term priors are time-series queries.

**Blocked by:** 04

**Status:** done — merged to main in `62a7e13`

- [ ] Migrations create the tables in `SPEC.md` §5 and run idempotently on a fresh database and on an existing one
- [ ] Writing a parsed result set upserts sections on `(campus, session, courseId, sectionId)`. Capturing the same course twice yields the same row count, with `last_seen_at` advanced
- [ ] Every write appends a snapshot row carrying `enrolled`, `teacher`, and `remark`. Two captures of the same section produce two snapshots, and the earlier one is still readable
- [ ] Schedule blocks are stored per day with their own modality and location, with location null when the block is online
- [ ] **Sections are never hard-deleted.** No code path removes a section row. A section that stops appearing in later captures keeps its row and its history; ticket 16 handles surfacing that
- [ ] A plan cannot be written spanning more than one `(campus, session)` — the constraint is enforced at the storage layer, not left to the UI
- [ ] Raw HTML is never written to the database, in any column, at any point
- [ ] Tests run against a temporary database and cover: fresh migration, re-migration, dedupe on repeat capture, snapshot history accumulating, and unknown-teacher round-tripping as unknown rather than as an empty string that later reads as a value
