# 39 — [ui] Tell the student an update exists, and let them take it

**What to build:** The surface for ticket 38's commands — a check the student can run, a quiet notice when an update is waiting, and an install action. The About dialog already shows the running version and is the natural home.

**Blocked by:** 38

**Status:** ready-for-agent

## Already built — do not rebuild

- **`AboutDialog`** renders "App Version" and the selector-config version from `get_app_info` (SPEC §9, ADR-0013). This ticket adds to that block; it does not restructure it
- **Alert / Dialog / Button** are already in `src/components/ui/`. Nothing new needs copying in

## Decided before dispatch — when the check runs

**Once on startup, off the critical path, plus a manual check in About.** The startup check follows the pattern the selector-config fetch already set: fired without blocking, and if it fails the app never mentions it. The student sees a notice only when there is genuinely something to take.

A check on every dialog open was considered and rejected — it turns opening About into a network wait for a fact that changes a few times a year. Never checking automatically was also rejected: the whole reason an update matters here is that this app breaks when DLSU changes a page, and a student who never opens About is exactly the one who needs the fix.

## Acceptance criteria

- [ ] **A waiting update is visible without opening a dialog** — a quiet, dismissible indicator, not a modal that interrupts what the student is doing. It names the version offered
- [ ] **About gains a Check for updates action** and shows the result inline: up to date, an update offered with its version, or a check that could not complete. All three are ordinary states and none of them look like an error
- [ ] **Installing is one explicit action**, and the student is told the app will restart before it does
- [ ] **While a check or install is running the control says so** and cannot be fired twice
- [ ] **A failed check is quiet.** Offline is the common case on campus wifi and must not produce anything alarming; the app keeps working and the notice simply does not appear
- [ ] **The startup check never delays the first paint** and never blocks a plan from opening
- [ ] **When the updater is compiled out** (`--no-default-features`, the Store-shaped build ticket 03 protects) the UI shows no update controls at all, rather than controls that always fail
- [ ] The running version stays visible in About whether or not a check has run — reports are undiagnosable without it (ADR-0004's consequence)
- [ ] Tests cover: the notice rendering when an update is available and absent when it is not, all three About states, the in-progress control, and the compiled-out build rendering no update controls

## Worth knowing before starting

The frontend suite renders to static markup — no DOM, no effects, no refs. A startup check driven by `useEffect` will not run under test, so the components must render meaningful, assertable HTML from props/state alone, with the check's result passed in rather than fetched inside the component being asserted.
