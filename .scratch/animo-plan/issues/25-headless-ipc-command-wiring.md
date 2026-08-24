# 25 — [headless] Wire the IPC command seam

**What to build:** The Tauri commands declared in ticket 02 stop being stubs and start calling the storage and core logic that already exists behind them. After this ticket the app runs end to end: a student can create a plan, see it listed, browse captured courses, add and pin sections, read the plan's conflicts, and run a solve — against real data rather than a thrown "unimplemented".

Ticket 02 deliberately declared every v1 command up front so the UI lane could build against a fixed seam, with bodies that fail loudly. The headless tickets since then filled in the layer *underneath* those commands — `Store` for tickets 05, 08, 16, and 17; `core::solver` and `core::scoring` for tickets 14 and 15 — but no ticket ever owned connecting the two. The result is that 17 of 27 commands still throw, roughly 2,400 lines of tested solver and scoring logic have no caller anywhere in the binary, and the finished UI tickets (06, 12, 13) are wired to commands that cannot answer them.

**This ticket adds no new command and changes no signature.** The contract in `docs/ipc-contract.md` and `src/adapters/ipc/` is already correct; this is the implementation catching up to it. If a signature genuinely must change, ticket 02's amendment protocol applies — Rust command and TypeScript client in the same commit, named in the PR description.

Everything here is additive over existing, tested logic. Where a store method is missing it is named below; where one exists it is used rather than reimplemented.

**Blocked by:** 05, 08, 14, 15, 16, 17

**Gates:** 20, 21, 23, 24 — these were numbered before this gap was found, so their `Blocked by` lines do not list this ticket.

**Status:** done — merged to main in `ed0ad28`

### Plan lifecycle

- [ ] `list_plans` returns every saved plan, each carrying its campus and session **names** rather than only ids, so the scope is readable on every screen that shows it
- [ ] `create_plan` creates a plan scoped to exactly one `(campus, session)` and returns it. A blank name is rejected with an identifiable error rather than silently accepted
- [ ] `delete_plan` removes the plan and its membership rows **and nothing else**. Captured section rows survive — deleting a plan is not a section delete (ADR-0008). The sample plan deletes like any other plan
- [ ] `get_plan` returns the plan with its sections, each carrying its schedule blocks, per-block modality, and the values from its latest snapshot
- [ ] New store methods are added for `list_plans`, `get_plan`, and `delete_plan`, which the storage layer does not yet expose. `plan_summary_row` and `section_view` already exist and are reused rather than duplicated

### Captured data

- [ ] `list_captured_courses` returns the distinct courses captured under a `(campus, session)`, each with how many sections it has and when it was first and last seen
- [ ] `list_captured_sections` returns every captured section for one course, with blocks, derived modality, room, and the latest snapshot's teacher, enrolment, and remark
- [ ] **A blank teacher crosses the seam as unknown**, never as an empty string that later reads as a value. `remark` crosses verbatim and is never parsed
- [ ] Both queries are scoped to the requested `(campus, session)` and never leak another term's rows

### Plan membership

- [ ] `add_section_to_plan`, `remove_section_from_plan`, and `set_section_pinned` each return the **updated plan**, so the UI re-renders from one source of truth instead of stitching together its own optimistic state
- [ ] **Adding a section that conflicts with the plan succeeds** (ADR-0009). Conflict is reported by `get_plan_conflicts`, never enforced here
- [ ] Adding a section from a different `(campus, session)` than the plan is rejected with an error naming the mismatch, not a generic failure
- [ ] `get_plan_conflicts` exposes the existing `Store::conflicts_in_plan`

### Solver

- [ ] `solve_plan` runs the ticket-14 solver **off the interface thread** so the window never freezes, seeded from the current plan: sections already chosen are fixed and only unassigned courses are filled
- [ ] Constraints and the chosen preset from ticket 15 are applied, and each returned solution carries its score breakdown and any advisory warnings
- [ ] A solve stopped by the node cap comes back flagged as partial with a resume token, and `continue_solve` **continues from that token rather than restarting**
- [ ] `cancel_solve` stops an in-flight solve, and is safe to call when nothing is running
- [ ] A course with no valid sections comes back named in the result, never as a bare empty list
- [ ] `apply_solution` writes the chosen sections into the same plan the student was editing, and every applied section stays individually removable and unpinnable afterwards

### Options, app info, and missing sections

- [ ] `get_campus_options` and `get_session_options` return the `SPEC.md` §2 values from Rust. **Rust becomes the single source of these names** — `src/core/options.ts` currently holds a second copy, and `sample_data.rs` hardcodes `"Manila"` / `"AY2026-27 T1"`; both stop being independent sources of truth
- [ ] `get_app_info` returns the app version. The selector-config version and source are supplied by ticket 18; until it lands they report the bundled config honestly rather than a placeholder that reads as real
- [ ] `get_missing_sections` exposes the existing `Store::missing_sections`

### Cross-cutting

- [ ] **Every command goes through the shared `StoreHandle`.** No command opens its own connection to the database file — a second connection writes outside the mutex the capture listener holds
- [ ] Every failure surfaces as an identifiable error string. No command returns empty or plausible-looking data on failure, for the same reason ticket 02's stubs threw
- [ ] The `every_command_fails_loudly_and_identifiably` test in `commands.rs` is narrowed to the commands that are still stubs, so it keeps protecting them without asserting against the ones this ticket implements
- [ ] Commands that are still stubs after this ticket — `start_refresh`, `resume_refresh`, and `build_capture_report` — remain stubs and keep failing loudly

### Out of scope

- **`start_refresh` / `resume_refresh`.** `core::refresh::RefreshRun` is a pure driver-shaped API with no driver: nothing yet re-selects each course in the popup roughly 1.5 seconds apart, asserts the rendered table matches the requested course, or detects mid-run session expiry. That is ticket 16's own unmet acceptance criteria, not wiring, and belongs back with ticket 16.
- **`build_capture_report`** — ticket 19.
- **The selector-config half of `get_app_info`** — ticket 18.
