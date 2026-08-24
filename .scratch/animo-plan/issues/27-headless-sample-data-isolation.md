# 27 — [headless] Isolate the sample data from real captures

**What to build:** The bundled sample data stops sharing a captured catalog with the student's real work. Today a genuine plan scoped to Manila / AY2026-27 T1 lists the fabricated CSINTSY and GEARTAP sections as if they had been captured from Archer's Hub, and the capture counter reports them in its running total.

`SAMPLE_CAMPUS_ID` is `7` (Manila) and `SAMPLE_SESSION_ID` is `155` (AY2026-27 T1) — the real scope. Captured courses and sections are keyed by `(campus_id, session_id)`, so every real plan in that scope reads the sample rows out of the same catalog. Observed on a freshly created plan: `0 sections` in the plan, `47 sections from 2 courses` in the capture bar, and the section picker offering `S01`–`S40B` with invented teachers and enrolment.

**This is a correctness problem, not a cosmetic one.** A student can add a fabricated section to a real plan, solve around it, and export it — carrying a section number that does not exist into enlistment. Sample data must be impossible to mistake for captured data.

**Blocked by:** None — can start immediately

**Status:** ready-for-agent

## Decided before dispatch — isolate by scope, not by filtering

Two approaches were considered.

**Rejected: mark sample rows and filter them.** Add `is_sample` to `sections`, then exclude sample rows everywhere the catalog is read. `Store::capture_summary`, `Store::captured_courses`, and `Store::captured_sections` all take only a `CaptureScope` and have no idea which plan is asking, so all three IPC commands would need a new argument to say whether sample rows count — three contract amendments under ticket 02's protocol, plus a migration, plus a `WHERE` clause that every future catalog query has to remember. Isolation that depends on remembering a filter is isolation that eventually leaks.

**Chosen: give the sample data its own reserved scope.** The sample plan is seeded under campus and session ids that are not real Archer's Hub ids and are not offered by `get_campus_options` / `get_session_options`. Nothing captured from the live site can ever land in that scope, and nothing in the sample scope can ever surface in a real plan — **structurally, with no filter to forget**. No migration, no contract change, no new argument on any query.

The cost is that the sample plan's scope badges no longer read "Manila · AY2026-27 T1". That is an improvement in honesty: the plan is already badged **Sample Data**, and labelling fabricated sections with a real campus and term is precisely the confusion this ticket removes.

## Acceptance criteria

- [ ] The sample plan is seeded under **reserved campus and session ids that are not real** and are absent from `CAMPUS_OPTIONS` and `SESSION_OPTIONS`, so `create_plan` can never produce a plan in the sample scope
- [ ] `options::campus_name` and `options::session_name` resolve the reserved ids to explicitly sample-flavoured names (for example `Sample Campus` and `Sample Term`) so the sample plan renders its scope without special-casing in the UI, and **still return `None` for genuinely unknown ids**
- [ ] A plan created in Manila / AY2026-27 T1 reports **zero captured sections and zero captured courses** when nothing has actually been captured, with the sample plan seeded
- [ ] The section picker in a real plan offers **no sample sections**; `list_captured_courses` and `list_captured_sections` in a real scope return nothing sourced from the seed
- [ ] `get_capture_summary` for a real scope **excludes sample rows from its counts** — the running counter reads what the student actually captured
- [ ] The sample plan itself still works end to end: its sections, blocks, per-block modality, conflicts, solve, and `.ics` export are unchanged from today
- [ ] **No IPC signature changes.** `docs/ipc-contract.md` and `src/adapters/ipc/` are untouched; if that turns out to be impossible, stop and say so rather than amending the contract silently
- [ ] **No migration is needed.** Existing databases that already seeded sample rows into the real scope are handled: the stale rows are moved to the sample scope or the seed is re-pointed, and the old sample plan does not become a plan the student cannot explain. Name the chosen approach in the PR description
- [ ] Sections are **never hard-deleted** in the process (ADR-0008)
- [ ] Tests cover: a real plan seeing an empty catalog while the sample plan is seeded, the capture counter excluding sample rows, `create_plan` refusing or being unable to target the reserved scope, and the sample plan still solving and exporting
