# 26 — [headless] Refresh driver: drive the popup and land the results

**What to build:** The half of ticket 16 that talks to the browser. `start_refresh` and `resume_refresh` stop being stubs: for each course already in the plan, the app drives the open Archer's Hub popup to select that course, waits for the results to render, hands the rendered HTML to the ticket-16 runner, and stores what comes back — sequentially, roughly 1.5 seconds apart, and only ever for courses the plan already holds.

Ticket 16 delivered the decision-making half of this and it is merged: `core::refresh::RefreshRun` is a complete state machine, and `Store::apply_refresh` and `Store::missing_sections` are wired. What was never built is the driver that feeds it. `start_refresh` and `resume_refresh` are the only two commands in the app still returning "unimplemented" (ticket 25 left them deliberately), and `refresh:progress` is declared with a TypeScript listener already waiting on it but is emitted by nothing.

**Never on a timer, never in the background.** Refresh is always something the student asked for. See `SPEC.md` §4.

**Blocked by:** 10, 16, 25

**Gates:** 21 — ticket 21 was numbered before this gap was found, so its `Blocked by` line does not list this ticket.

**Status:** ready-for-agent

## Already built — do not rebuild

Re-implementing any of this will produce a large conflict against work already in `main`:

- **`core::refresh::RefreshRun`** — `start`, `from_token`, `next_course`, `complete(FetchResult, config)`, returning `NextStep::Fetch { course, course_index, course_total }` / `NextStep::Ended { finish }` and `StepOutcome::Refreshed { .. }` / `StepOutcome::Halted { finish }`. The stale-table check, missing-section detection, resume-token minting, and the partial-result bookkeeping all live here.
- **`Store::refresh_courses`** (the plan's courses in run order), **`Store::apply_refresh`**, and **`Store::missing_sections`**.
- **`RefreshOutcome`**, **`RefreshStatus`**, and the `refresh:progress` contract, including the frontend's `onRefreshProgress`.

This ticket writes the loop between them and nothing else.

## Decided before dispatch — how the HTML gets back

Three ways the selected page's HTML could reach Rust were considered:

- Returning it through Tauri IPC from the page — **ruled out by ADR-0003.** The remote origin is never granted IPC.
- Adding a second loopback route for refresh — **rejected.** Ticket 09's endpoint exposes exactly one write route and nothing else, deliberately; widening that surface for convenience spends a security property the app's trust story rests on.
- **Chosen: reuse the single `/capture` route.** Rust drives the selection in the popup, the existing mutation observer fires on the render exactly as it does for an ordinary search, and the payload it posts already carries the `courseId` read from the dropdown — which is precisely the identity the runner's stale-table check needs.

**The consequence this ticket must handle:** an ordinary capture POST is stored by `record_capture`, which journals an *undoable batch*. A refresh must be stored by `apply_refresh` instead. The endpoint therefore has to know a refresh run is active and route the posted batch accordingly — otherwise refreshing silently becomes undoable capture, and one Undo reverts the student's refresh instead of their last search.

## Acceptance criteria

- [ ] `start_refresh` runs the plan's courses through `RefreshRun`, **sequentially and roughly 1.5 seconds apart**, driving the already-open popup. Only courses in the plan are touched — no catalog walking
- [ ] Each rendered response reaches the runner as `FetchResult::Page`, and whatever the runner returns as `StepOutcome::Refreshed` is stored via **`Store::apply_refresh`, never `record_capture`** — a refresh must not become an undoable capture batch
- [ ] **The posted batch is routed by whether a refresh run is active**, and the run is scoped to the plan being refreshed, so an ordinary search during a run cannot be mistaken for a refresh response or vice versa
- [ ] **Validity is the runner's existing check, not the URL**: a response whose selected course does not match the requested one is discarded and stored nowhere. The driver must not reimplement this — it hands the HTML over and honours the `StepOutcome`
- [ ] **The page renders select2 over the course dropdown.** Setting the underlying `<select>` value alone does not update select2 or fire the page's own change handler; the selection must be driven so the page actually searches. A selection that does not take effect must surface as a response the runner rejects, never as a silent refresh of the previous course
- [ ] Session expiry halts the run immediately and **keeps everything already refreshed**, returning `RefreshStatus::SessionExpired` with the resume token
- [ ] `resume_refresh` rebuilds the run with `RefreshRun::from_token` and **continues from the halted course** rather than restarting. An invalid or stale token fails with an identifiable error
- [ ] With no network the run does nothing at all and says so — `RefreshStatus::Offline`, nothing stored, no partial writes
- [ ] A popup that is closed, or that never signed in, is reported as the session-expired outcome rather than hanging or panicking
- [ ] **`refresh:progress` is emitted once per course**, carrying the course being refreshed and how many remain, from the `course_index` and `course_total` the runner already supplies. Ticket 21 renders this and the listener already exists
- [ ] Sections that stop appearing are flagged missing through the existing store path and are **never deleted** (ADR-0008). `get_missing_sections` already exposes them
- [ ] **Nothing about the login is read, intercepted, or stored** (ADR-0002). Driving a course selection is the same request the student's own click makes; no other page interaction is introduced
- [ ] The driver's selection script takes its selectors from the loaded selector config (ticket 18), not from hardcoded strings
- [ ] Tests cover: a clean full run, a response for the wrong course being discarded, mid-run expiry keeping the partial result, resume continuing rather than restarting, the offline path writing nothing, and a refresh landing through `apply_refresh` rather than as an undoable capture batch
