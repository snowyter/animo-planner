# Level 3 — Application Architecture

> **Who this is for:** software developers. Assumes familiarity with web and systems
> vocabulary. Code-level specifics live in Level 5.

## Platform shape

Animo Plan is a **Tauri v2** application: a native Windows process hosting a WebView2
window for the UI (React + TypeScript), with application logic in Rust. There are **two
webviews**: the main window (app UI) and the capture popup (Archer's Hub). The Rust
process is the single authority for state, storage, parsing, solving, and export.

```
┌───────────────────────────── Windows process ─────────────────────────────┐
│                                                                            │
│  ┌── Webview 1: main window ───────────────────────────────────────────┐  │
│  │ React 19 · TypeScript · Vite · Tailwind v4 · shadcn/ui (copied in)   │  │
│  └──────────────┬───────────────────────────────────────────────────────┘  │
│                 │ Tauri IPC (invoke / events)                               │
│                 ▼                                                           │
│  ┌── Rust process ─────────────────────────────────────────────────────┐  │
│  │  interface → core → adapters          (axum HTTP listener on loopback)│  │
│  └──────────────▲────────────────────────────────────────────────────────┘  │
│                 │ POST http://127.0.0.1:<random port>/capture                │
│                 │ Authorization: Bearer <per-launch token> (or form field)   │
│  ┌── Webview 2: capture popup ─────────────────────────────────────────┐  │
│  │ https://archershub.dlsu.edu.ph + injected watcher script             │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

**The remote origin never gets Tauri IPC** (ADR-0003). The popup's only channel to Rust is
the loopback endpoint, which exposes exactly one write route and no reads.

## Layering

Both sides follow the same three-layer discipline. Dependencies point downward only;
the middle layer is pure logic with no I/O and no framework imports.

### Frontend (`src/`)

```
components/   React views + hooks (state machines per feature)
    usePlans · usePlanDetail · useSectionPicker · useSolvePlan ·
    useCapture · usePlanRefresh · useOptions
    WeekGrid · SectionPicker · SolvePanel · SolutionCard ·
    CapturedCatalog · PlanWorkspace · CaptureBar …
     │ calls
     ▼
core/         pure TS domain utilities — unit-testable without a DOM
    conflicts preview · grid layout math · palette (hue per course) ·
    toolPanel (tab identities/order) · motion · solver (preset tables,
    preview refs) · capture (catalog freshness) · scrub · onboarding ·
    options tables · export helpers
     │ marshals through
     ▼
adapters/ipc/ the ONLY module allowed to touch @tauri-apps/api
    client.ts  — one typed function per command
    types.ts   — mirrors of the Rust serde wire types
```

### Backend (`src-tauri/src/`)

```
interface/    Tauri command handlers — thin adapters only
    commands.rs : lock store → call core/store → map errors to strings → emit events
                  update.rs · version.rs
     │ delegates to
     ▼
core/         pure Rust domain logic — no I/O, no Tauri
    parser.rs (DOM → typed sections)      solver.rs (backtracking search)
    scoring.rs (presets, warnings)        conflicts.rs (overlap detection)
    refresh.rs (refresh run state)        ics.rs (calendar export)
    ipc_types.rs (shared wire vocabulary) options.rs · selector_config.rs …
     │ used by
     ▼
adapters/     everything that touches the world
    store.rs          SQLite via rusqlite, STRICT tables, migrations
    capture.rs        axum loopback listener (one write route)
    capture_window.rs popup creation, session wipe
    capture_script.rs/.js   injected watcher script (token interpolated)
    refresh_driver.rs drives the popup course-by-course during Refresh
    remote_config.rs  selector config: bundled fallback + validated remote swap
    selection_script.rs · update_service.rs
```

Every module on both sides has a colocated test file; `npm run verify` enforces
typecheck + Vitest + ESLint + Clippy + Cargo tests in both updater-feature configs.

## Communication channels

There are exactly three channels between the webviews and Rust:

| Channel | Direction | Guard | Used for |
|---|---|---|---|
| **Tauri IPC invoke** | main window → Rust | app-owned UI only | 30 commands (CRUD, inclusion, solve, refresh, export, updates) |
| **Tauri events** | Rust → main window | — | `capture:updated`, `capture:failed`, `refresh:progress` |
| **Loopback HTTP POST** | popup → Rust | random port + per-launch bearer token (constant-time compare); origin echoed for CORS | `/capture` — the one write route |

The popup's injected script posts captures either as `fetch` JSON or as a form submission
(Archer's Hub's CSP blocks fetch-to-loopback but permits forms; every form reply is 204 so
the page is never navigated away).

## Key flows

### Capture (student searches a course)

```
Student searches in popup            Rust engine                     Main window
─────────────────────────           ────────────                    ───────────
results table renders  ─┐
                        │ MutationObserver fires
watcher script reads    │
course identity from    │
dropdown + table rows   │
                        ├──POST /capture (HTML)──▶ authenticate (token)
                        │                          parse via SelectorConfig
                        │                          derive modality per block
                        │                          upsert section + append snapshot
                        │                          ◀── 204 ────────────────
                        │                          emit capture:updated ───▶ counter
                        │
```

Raw HTML exists only inside the request body; the store accepts typed parsed sections,
so HTML can never be persisted.

### Refresh (explicit user action)

```
Main window            Rust interface                Refresh driver            Popup
───────────           ───────────────               ───────────────          ──────
"Refresh" ────────▶ start_refresh:
                      read plan's courses
                      register active run ─────▶ drive_refresh (blocking thread)
                                                  for each captured course:
                                                    navigate/select ─────────▶ Course Finder
                                                    wait ~1.5 s apart
                                                    verify selected course ==
                                                      requested (not URL!)
                                                    popup auto-posts ──────▶ routed into run
                                                    trusted steps land via apply_refresh
                                                  session expired? HALT: keep partial,
                                                  stash resume token per plan
                      progress event per course ◀─────────────────────────────────────▶ UI bar
"Resume" ─────────▶ resume_refresh: rebuild run from stashed token, continue
```

Never on a timer; never in the background. Refresh covers everything captured under the
plan's scope, not just plan members (ADR-0019), but is still only what the student already
searched — never a catalog walk. Each course that completes a refresh gets a
`last_refreshed_at` stamp, so the UI can say how old the numbers are.

### Solve (find clash-free schedules)

```
Main window            Rust interface                     Solver core
───────────           ───────────────                     ───────────
"Solve" (Solve tab) ▶ solve_plan:
                      load plan + solver catalog
                      (only courses marked included)
                      pinned sections = fixed;
                      unpinned = seeded starting points
                      spawn_blocking chunk ──────────▶ backtracking search
                                                       (MRV ordering, prune on
                                                        conflict, node budget
                                                        100k per chunk)
                      ◀── SolveResult ───────────────  status: Complete / Partial
                      Partial carries resume token      (+ unsatisfiable courses,
                      "Keep searching" ─────▶ continue_solve: rebuild from token,
                                               another budgeted chunk
                      Cancel ───────────────▶ cancel_solve sets shared flag;
                                                current chunk finishes, then stops
"Apply" ─────────▶ apply_solution writes chosen set into plan_sections
```

Selecting a result paints it on the **permanent week grid** as a preview (the preview
selection is held by the workspace, not the panel — leaving the Solve tab restores the
real plan). The solver only ever emits conflict-free assignments among its own
placements; overlaps between student-pinned sections pass through untouched as
user-authored (ADR-0009). Store locks are always taken before the async boundary and
never held across `.await`.

## Workspace layout: one grid, three tools

Since ticket 46 the plan workspace is **two regions**, not a set of screens:

```
┌─ PlanWorkspace ──────────────────────────────────────────────┐
│                                                              │
│  WEEK GRID (permanent — never hidden)                        │
│  The artifact the app exists to produce. All three tools     │
│  act on it: picked sections paint it, solve previews paint   │
│  it, capture feeds it.                                       │
│                                                              │
│  TOOL PANEL (tabbed, foldable)                               │
│  ┌──────────┬──────────┬──────────┐                          │
│  │ Capture  │  Solve   │  Pick    │  ← the order work        │
│  ├──────────┴──────────┴──────────┤    happens in, not a     │
│  │ one tool at a time acts here   │    locked workflow       │
│  └────────────────────────────────┘                          │
│                                                              │
│  Capture = the arrival surface: catalog list, freshness,     │
│            include/exclude, forget, Open Archer's Hub        │
│  Solve   = ranked conflict-free combinations, previewed      │
│            on the grid (SolutionCard list + Apply)           │
│  Pick    = course-by-course section browser                  │
└──────────────────────────────────────────────────────────────┘
```

Tab identities and their order live in `src/core/toolPanel.ts` as data, so triggers and
panels read one copy. The grid is deliberately **not** a tab: picking and solving both
write to the same plan, and the grid is where the student sees the result of either.

## Startup wiring (`src-tauri/src/lib.rs`)

1. Open/create the SQLite store in the OS app-data directory; manage as shared state.
2. Load the bundled selector config immediately; spawn an async fetch of the remote
   config that swaps in **only if it validates** (startup never blocks on network — ADR-0013).
3. Bind the loopback capture listener (random port, fresh bearer token) and serve it on
   the async runtime.
4. Manage refresh routing state, cancellation flag, capture-window scope.
5. Register the update service behind the `updater` cargo feature: real gateway when
   compiled in, an explicit "unavailable" stub otherwise — identical command signatures
   in both builds.
6. Register all IPC commands.
