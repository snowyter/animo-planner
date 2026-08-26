# 46 — [ui] One tabbed tool panel, one permanent week grid

**What to build:** Restructure the plan workspace into two regions: a **tabbed tool panel** on the left holding Capture, Solve, and Pick, and the **week grid on the right, always visible**. The solver stops being a modal and previews its solutions on that grid.

**Blocked by:** None — can start immediately

**Status:** ready-for-agent

## Why

The workspace is four cards stacked vertically: a plan header, a capture banner, a solver banner, then the picker with the grid beside it. On the app's own 1400×900 window the grid sits below the fold until you scroll, and two permanent banners spend a hundred pixels each on controls a student touches a few times a session.

```
┌─────────────────────────────────────────────────────┐
│  My Plan · Manila · AY2026-27 T1        0 sections  │
├──────────────────────────┬──────────────────────────┤
│ [Capture][Solve][Pick]   │                          │
│ ┌──────────────────────┐ │      Weekly Schedule     │
│ │                      │ │      (always here)       │
│ │   active tool panel  │ │                          │
│ │                      │ │                          │
│ └──────────────────────┘ │                          │
└──────────────────────────┴──────────────────────────┘
```

## Decided before dispatch

**The grid is not a tab.** It is the artifact the whole app exists to produce, and the other three are tools that act on it. Putting it behind a tab would break the interaction ticket 28 was written for and ticket 32 sharpened: the ghost preview must land on a *visible* grid while the student hovers a section. Tabs switch the tool; the workspace stays.

**The solver leaves the modal.** It becomes the Solve tab, and a highlighted solution previews on the real week grid instead of a thumbnail. That is the upgrade this restructure buys — comparing twenty candidate schedules at full size rather than squinting at cards.

**Three tabs, in the order the work happens:** Capture → Solve → Pick. A student can use them in any order; the ordering is a hint, not a workflow.

## Acceptance criteria

### Layout

- [ ] **The week grid is visible on every tab**, in the same place at the same size. Switching tabs must not move or resize it — the app should feel like changing a tool, not changing a screen
- [ ] The grid keeps the larger share of the row (ticket 32) and stays legible at the default window size. Verify at **1400×900**, the size `tauri.conf.json` opens at, and at the 1024 minimum width
- [ ] **The page does not scroll vertically to reach the grid.** The tool panel scrolls inside its own bounded height; the page does not grow
- [ ] Below the width where two columns stop fitting, the layout falls back to a single column with **the grid above the panel**, as ticket 28 required
- [ ] The plan header — name, scope, section count, conflict status, Export — stays above both regions and is not tabbed

### The tabs

- [ ] **Capture** holds what the capture bar holds today (counter, Refresh, Open Archer's Hub) and shows **what has been captured** beneath it. This is the arrival surface: what landed, when, how fresh
- [ ] **Solve** holds the constraints, the ranked results, and the apply action — everything `SolveDialog` does now, as a panel rather than a modal
- [ ] **Pick** holds the course dropdown and section list exactly as the picker does now, including the bounded scrolling list and the section count
- [ ] Tabs are **keyboard navigable with correct roles** (arrow keys between tabs, the panel labelled by its tab). Use the Radix tabs primitive behind a copied shadcn component — `@radix-ui/react-*` is pre-approved for exactly this (`docs/agents/dependencies.md`)
- [ ] **The selected tab survives a plan reload.** Every mutation reloads the plan; landing back on Capture after adding a section would be maddening

### The solver as a panel

- [ ] **Selecting a solution previews it on the week grid** — the full set of sections, at full size, in place
- [ ] The preview is clearly a **preview**: it must not be mistakable for the applied plan, and leaving the Solve tab or clearing the selection restores the real plan on the grid
- [ ] **Ticket 43's report survives the move**: what stays, what moves, which sections, pinned shown as exempt — and applying still says so before it happens
- [ ] The chunked solve's controls have a home in the panel: **progress, Continue, and Cancel** (the solve is resumable and can report `partial`)
- [ ] Unsatisfiable courses and the exclude-full notice (ticket 34) stay visible in the panel — "no solutions" must still say why
- [ ] Advisory warnings stay advisory and never look like errors (ADR-0009)
- [ ] `SolveDialog`'s modal is removed rather than left behind as a second way in. `useSolvePlan` should not need rewriting — this is a change of container, not of logic

### Two things that must not collide

- [ ] **One source for the captured catalog.** The Capture tab showing what landed and the Pick tab showing what is browsable must read from the same loaded list. Ticket 32 fixed exactly this bug once — a fetch on mount in one place and a local patch in another, disagreeing about the same data. Do not reintroduce it
- [ ] **One preview mechanism on the grid.** `WeekGrid` takes a single `ghostSection` today; a solution preview is a whole set. Whatever replaces it, the picker's hover preview and the solver's solution preview are one concept with one code path — never two systems racing for the same surface. They are on different tabs, so only one is ever active

### Nothing gets hidden that must be seen

- [ ] **Global notices live outside the tabs**: session expired, refresh progress, missing sections, capture failures. A refresh dying while the student is on Pick must be visible from Pick
- [ ] **An empty state points at the tab that fixes it.** A student on Pick with nothing captured must be told where to go, and the Capture tab should carry a signal when the catalog is empty. Tabs hide state — this is the cost, and it has to be paid deliberately

### Nothing regresses

- [ ] **The ghost preview still lands on a visible grid while hovering** (tickets 28, 32) — the reason the grid is not a tab
- [ ] **The context menu still works from every tab** and still paints above every block, unclipped (tickets 41, 45). It is portalled to `document.body` and positioned `fixed`: a `transform`, `filter`, or `backdrop-filter` on any new layout wrapper will silently mis-place it
- [ ] **The PNG export keeps ticket 40's container shape and ticket 44's title.** Its guard test must pass, and an exported image must still contain the schedule — export one and look at it
- [ ] **The design system is extended, not bypassed** (ticket 33): tokens from `App.css` and `docs/design-system.md`, no new per-component scale. Tab switching may animate, under the same rules — `LazyMotion` + `m`, `transform`/`opacity` only, honoured `prefers-reduced-motion`, and no per-element motion on the ~40 grid blocks or ~42 section cards
- [ ] Light mode only (ADR-0018). Hue still encodes course identity only (ADR-0012); a selected tab is chrome and must not read as data
- [ ] **No behaviour, no data, no IPC changes.** Every command called today is called the same way; this moves surfaces, it does not change what they do

## Testing

- [ ] The suite renders to static markup, so **the selected tab must be drivable from props** — the way `initialConfirmingClear` already lets `PlanWorkspace` render a dialog open under test
- [ ] Tests cover: each tab rendering its own content, the grid rendering on every tab, a solution preview rendering on the grid and clearing back to the plan, global notices rendering regardless of selected tab, the empty-catalog signal, and the ticket-40 export guard still passing
- [ ] The existing picker, solver, grid, and export tests keep passing. Where a test asserted the solve *dialog*, it should assert the solve *panel* — do not delete coverage to make a move easier

## Worth knowing before starting

This is a restructure of `PlanWorkspace`, which is also the file every recent ticket touched. Read what is already there before moving it: the plan reload path that every mutating handler calls, the capture event wiring, and the refresh-recovery states all live in that component and none of them are in scope to change.
