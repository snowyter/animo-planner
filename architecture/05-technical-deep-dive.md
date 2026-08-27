# Level 5 — Technical Deep Dive

> **Who this is for:** engineers working in this codebase. Every claim below is grounded
> in the source: `src/` (TypeScript) and `src-tauri/src/` (Rust).

## Module map

### TypeScript (`src/`)

| Path | Responsibility |
|---|---|
| `main.tsx`, `App.tsx` | Entry + composition root; screen switching (PlanList ⇄ PlanWorkspace), dialogs, update notice |
| `components/*.tsx` | Views: `WeekGrid` (permanent, hand-rolled CSS grid; also hosts the solve-preview paint), `SectionPicker`, `SolvePanel` + `SolutionCard` (Solve tab), `CapturedCatalog` (Capture tab: list, freshness, include/exclude, forget), `CaptureBar`, `ExportMenu`, banners/dialogs, `ui/*` (shadcn incl. `tabs`) |
| `components/use*.ts` | Per-feature state machines: `usePlans`, `usePlanDetail`, `useSectionPicker`, `useSolvePlan`, `usePlanRefresh`, `useCapture`, `useOptions` |
| `core/*.ts` | Pure domain utilities, each with a colocated `.test.ts`: `conflicts` (client-side preview), `grid` (layout math), `palette` (hue per course — ADR-0012), `toolPanel` (tab identities/order), `motion` + `lib/motionFeatures.ts` (reduced-motion-aware animation), `solver` (preset tables, `solutionToSectionRefs`, exclusion notices), `capture` (catalog freshness formatting), `scrub`, `export` (PNG via html-to-image), `onboarding`, `options`, `refresh` |
| `adapters/ipc/client.ts` | The only module importing `@tauri-apps/api`; one typed function per command, `{ args }` envelope |
| `adapters/ipc/types.ts` | TS mirrors of Rust serde wire types (camelCase) |
| `capture/*` | Tests for the injected script's logic |

### Rust (`src-tauri/src/`)

| Path | Responsibility |
|---|---|
| `lib.rs` | Builder setup: store open, managed state, listener bind+serve, async remote-config fetch, update gateway behind feature flag, command registry (30 commands) |
| `interface/commands.rs` | Thin command adapters: lock `StoreHandle` → call core/store → map errors to strings → emit events. Owns `RefreshContext`, `SolveCancellation` |
| `interface/update.rs`, `version.rs` | Update-check/install commands, app version command |
| `core/parser.rs` | DOM → typed sections via `SelectorConfig` (all selectors/rules injected — ADR-0013). `ParsedLocation::{Room,Online,Unrecognized}`; unrecognized locations kept representable + diagnostic |
| `core/solver.rs` | Backtracking search (below); `DEFAULT_NODE_BUDGET = 100_000` nodes/chunk; `SOLVER_STATE_VERSION = 3` stamped into resume tokens |
| `core/scoring.rs` | Preset scoring + advisory transition warnings in one `evaluate()` pass |
| `core/conflicts.rs` | Pairwise block overlap over planned sections |
| `core/refresh.rs` | Refresh run state machine: course queue, step interval (`DEFAULT_REFRESH_STEP_INTERVAL_MS` ≈ 1.5 s), halt/resume tokens |
| `core/ics.rs` | RFC 5545 export; fails if section start/end dates are missing rather than dropping classes silently |
| `core/ipc_types.rs` | Shared wire vocabulary (serde camelCase): `Day`, `Preset`, `SolveOptions/Result/Status`, `CaptureSummary`, `Conflict`, … |
| `core/options.rs` | Campus/session option tables (single source for names), reserved sample-scope ids |
| `core/capture_report.rs` | Assembles scrubbed pre-filled GitHub issue payload |
| `adapters/store.rs` | rusqlite persistence (~4.6k lines incl. tests): STRICT tables, migrations, `StoreError` taxonomy, live capture vs trusted refresh writes, course inclusion |
| `adapters/capture.rs` | axum loopback listener (below) |
| `adapters/capture_window.rs` | Popup lifecycle: create/refocus, wipe persisted WebView profile |
| `adapters/capture_script.rs` + `.js` | Interpolates endpoint/token/scope into the static watcher script |
| `adapters/refresh_driver.rs` | Drives the popup course-by-course through eval (same channel as init script — no IPC), routes `/capture` posts into the active run |
| `adapters/remote_config.rs` | Bundled fallback + async validated remote swap |
| `adapters/update_service.rs` | `PluginGateway` (feature `updater`) / `DisabledGateway` stub |

## IPC contract (the 30 commands)

Full contract lives in `docs/ipc-contract.md`; frontend mirror in `src/adapters/ipc/client.ts`.
Payloads cross wrapped as `{ args }` because Tauri routes by Rust parameter name.

| Group | Commands |
|---|---|
| Options/info | `get_campus_options`, `get_session_options`, `get_app_info`, `get_app_version` |
| Plans | `list_plans`, `create_plan`, `delete_plan`, `get_plan` |
| Captured catalog | `list_captured_courses`, `list_captured_sections`, `forget_captured_course`, `set_course_included` |
| Membership | `add_section_to_plan`, `remove_section_from_plan`, `set_section_pinned`, `apply_solution` |
| Conflicts/missing | `get_plan_conflicts`, `get_missing_sections` |
| Capture window | `open_capture_window`*, `clear_browser_session`*, `get_capture_summary` |
| Solve | `solve_plan`, `continue_solve`, `cancel_solve` |
| Refresh | `start_refresh`, `resume_refresh` |
| Export/report | `export_plan_ics`, `build_capture_report` |
| Updates | `check_for_update`, `install_update` |

\* Declared `#[tauri::command(async)]`: creating/destroying a webview from the main
(event-loop) thread deadlocks Tauri.

`set_course_included` toggles a course's intent flag and **returns the updated catalog**
(`Vec<CapturedCourse>`), so the toggling tab and the browsing tab read one loaded list.
`CapturedCourse` gained `included: bool` and `lastRefreshedAt: string | null` (only a
refresh stamps the latter; captures advance `lastSeenAt` alone).

Events Rust → UI: `capture:updated` (summary), `capture:failed` (error),
`refresh:progress` ({courseIndex, courseTotal, courseCode}).

## Capture pipeline internals

1. **Injection** — popup created with an `initialization_script` interpolated from
   `capture_script.js`: endpoint URL, per-launch token, plan scope, hub host allowlist,
   selector config values.
2. **Watching** — a `MutationObserver` on the results table body fires on every render.
   Course identity comes from the selected `#ddlSelectCourse` option at capture time
   (the table has no course-code column).
3. **Transport** — Archer's Hub CSP blocks `fetch` to loopback but does not restrict form
   submissions (ADR-0016), so posts go either way:
   - JSON `fetch`: `Authorization: Bearer <token>`, constant-time token compare.
   - Form post: token as a field (forms can't set headers); **every reply is 204** — a
     form post is navigation, and any other status would render in the popup.
   CORS: request origin echoed with `Vary: Origin` (the token is the only boundary);
   Chromium Private Network Access preflight answered explicitly.
4. **Processing** — listener parses HTML with `parse_results_table` under the live
   selector config, derives modality per block, upserts sections on natural key
   `(campus_id, session_id, course_id, section_id)`, **appends** a snapshot, emits events.
   Captures are written straight through; removal is an explicit student action
   (`forget_captured_course`), never an inferred one.
5. **Failures** — last 8 failures retained in memory with optional DOM fragments;
   fragments never leave the core except scrubbed through `build_capture_report`
   (pre-filled GitHub issue URL the student reviews and opens themselves).

## Solver internals (`core/solver.rs`)

```
begin_solve (commands.rs)
  plan members ──▶ fixed[]  (pinned = truly immovable; unpinned = seed)
  solver_courses(scope) ──▶ courses[] of candidate sections
        (only courses with included = 1 — excluded courses are
         browsable, not schedulable)
  latest_snapshot_at(scope) ──▶ freshness stamp for exclude-full honesty
        │
        ▼  spawn_blocking chunk (≤ DEFAULT_NODE_BUDGET nodes)
┌─ backtracking search ────────────────────────────────────────────┐
│ order courses by fewest valid candidates first (MRV, ties by id) │
│ candidate filters (unary): day blacklist · time bounds ·         │
│                             exclude-full (default ON, counted)   │
│ prune on first overlap vs pinned ∪ placed                        │
│ complete assignment ──▶ scoring::evaluate(preset):               │
│     score + breakdown + warnings in one pass                     │
│ keep best N (result_limit, default 12) in bounded BinaryHeap     │
│ budget exhausted ──▶ status Partial + serialized resume state    │
└──────────────────────────────────────────────────────────────────┘
        │
        ▼
finish_outcome: Cancelled flag wins over chunk status;
resume_token survives ONLY on Partial, wrapped in an envelope
{planId, token} so continue_solve verifies plan binding.
Unsatisfiable courses carry reasons (excluded-as-full is attributed
separately from constraint failures).
```

Guarantees encoded here: emitted solutions never conflict among solver placements; every
included course appears in every result; nothing is dropped at course granularity; blank
professor and section-code prefixes are never read as constraints.

## Workspace layout & the solve preview (ticket 46)

- `PlanWorkspace` is two regions: the **permanent WeekGrid** plus a foldable, tabbed tool
  panel (`Capture | Solve | Pick`). Tab identities/order are data in `core/toolPanel.ts`
  (`ToolTab = "capture" | "solve" | "pick"`); invalid ids resolve to the default rather
  than rendering nothing. The grid is deliberately not a tab.
- The Solve tab's `SolvePanel` holds results and constraints; selecting a `Solution`
  paints a **preview on the grid** (`SolutionSelection { solution, rank }`). The
  selection is controlled by the workspace, not the panel: leaving the Solve tab
  restores the real plan. `SolutionCard` renders each ranked result (replacing the old
  `SolutionThumbnail`).
- The Capture tab's `CapturedCatalog` owns **no state and issues no calls** — it renders
  the same loaded `CapturedCourse[]` the Pick tab browses (a fetch-on-mount disagreement
  between tabs was a real bug, ticket 32). Include/exclude and forget are issued from
  here; excluded courses also disappear from `SectionPicker`'s offerings.
- Apply still goes through `apply_solution` — the same command the old dialog issued;
  one write path onto `plan_sections`.

## Persistence details (`adapters/store.rs`)

- `StoreHandle = Arc<Mutex<Store>>`; lock poisoning recovered via `into_inner()`;
  locks always taken before async boundaries and never held across `.await`.
- Migrations run sequentially (v1 creates the six core tables; v2 adds `plans.is_sample`);
  the latest is **v7**: `courses.included INTEGER NOT NULL DEFAULT 1` and
  `courses.last_refreshed_at TEXT`. Pre-v7 courses default to included — silently
  dropping them from the solve would have emptied existing plans.
- `set_course_included` updates the flag and errors `CourseNotFound` for unknown ids;
  `captured_courses` rows expose `included` + `last_refreshed_at`.
- Two write paths by trust level:
  - `record_capture` — live captures, written straight through.
  - `apply_refresh` — trusted refresh landings: snapshots appended, vanished sections
    flagged missing, and the course stamped `last_refreshed_at`; a vanished section is
    never deleted (ADR-0008).
- `apply_solution` validates: one section per course, never overriding pinned membership
  (`SolutionOverridesPinned`, `SolutionSplitsCourse` errors).
- `forget_course` removes a scope's rows deliberately and reports affected plans.
- Every anomaly is a named `StoreError` variant rendered as an identifiable message —
  no silent defaults anywhere.

## Refresh driver internals (`adapters/refresh_driver.rs`)

- `ActiveRefreshRun` maps plan id → channel sender; `/capture` posts are routed into the
  active run instead of the ordinary capture path. Registration begins exactly when a
  render can be awaited and ends no matter how the drive finishes.
- Navigation/classification uses page URLs (`classify_hub_page`) and `window.eval` —
  the same channel as the initialization script, never IPC.
- After selecting a course it asserts the rendered table matches the *requested* course
  (a stale-but-present table would silently write course N's counts onto N+1).
- Session expiry mid-run: halt immediately, keep everything already persisted, stash a
  resume token per plan (`HaltedRefreshTokens`, spent exactly once); `resume_refresh`
  rebuilds and continues from the halted course. Retries during selection waits are
  spaced across the response-timeout budget, not tight-looped.
- A liveness probe (`probe_online`) gates runs against the hub host.

## Update system

- Whole subsystem behind cargo feature `updater` (`--no-default-features` builds without
  any updater code; `npm run verify` compiles both configurations).
- `check_for_update` is a plain static read of GitHub Releases `latest.json`; meta-tests
  pin endpoints to https, no query parameters, no `{{placeholders}}` — template
  substitution would quietly turn the check into telemetry (ADR-0017, ADR-0004).
- Only explicit `install_update` ever installs. Signature pubkey embedded in
  `tauri.conf.json`; private key stays out of the repo.

## Security checklist → code

| Invariant | Where enforced |
|---|---|
| Remote origin gets no IPC | popup is external-URL webview; only loopback POST exists |
| Loopback auth | random port + 96-bit hex token minted per launch; constant-time compare |
| One write route | axum router exposes `POST /capture` only; no reads |
| No raw HTML persisted | store API accepts typed parsed sections only; STRICT tables |
| PII fields untouched | parser reads allowlisted cells/attrs only; report fragments scrubbed |
| No credentials code paths | popup login happens entirely on the university's own page; profile wipe is the only session control |
| No telemetry | no network calls besides hub reads, selector-config fetch, updater check; tests pin these |

## Testing & verification conventions

- Colocated test per module: `*.test.ts(x)` next to sources (Vitest), `#[cfg(test)]`
  modules in Rust — including seam tests that drive the axum router and store directly.
- `npm run verify`: `tsc --noEmit` + Vitest + ESLint + `cargo clippy -D warnings` +
  `cargo test`, in **both** feature configurations.
- Wiring meta-tests in `lib.rs` assert command registration and version sync between
  `Cargo.toml` and `tauri.conf.json`, so "registered-but-unreachable" regressions fail CI.
- Fixtures: anonymized GEARTAP/CSINTSY captures double as parser/solver test data
  (sample-data seeding was removed from the product after 0.2.0).
