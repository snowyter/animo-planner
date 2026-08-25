# 37 — [headless] Refresh puts the popup on Course Finder itself

**What to build:** The refresh driver navigates the capture popup to Course Finder before driving it, instead of assuming the student left it there. Today, signing in and pressing Resume reports "Session expired" again, because signing in lands the popup on the Student Dashboard and the driver evaluates its selection script into a page that has no course dropdown.

**Blocked by:** None — can start immediately

**Status:** ready-for-agent

## The defect

`LiveRefreshSource::fetch` drives a refresh by evaluating the ticket-26 selection script into the open popup, whatever page that popup is showing. The script's first act is to find the dropdown:

```js
var dropdown = document.querySelector(task.dropdownSelector);
if (!dropdown || !dropdown.options) {
  return;
}
```

On `https://archershub.dlsu.edu.ph/StudentDashboard/index/1` there is no such element, so the script returns, no results render, nothing posts to the loopback endpoint, and `next_response` waits out `REFRESH_RESPONSE_TIMEOUT_MS` (15s) before `fetch` returns `FetchResult::SessionExpired`. The runner halts on the first course and ticket 21's banner reappears.

Observed by the student, in the order it actually happens:

1. Press Refresh while signed out. Banner: "Session expired — sign in to continue".
2. Sign in on Archer's Hub. The hub redirects to `/StudentDashboard/index/1`.
3. Press Resume. Fifteen seconds of nothing, then the same banner.

**The session is fine. The page is wrong.** `FetchResult::SessionExpired` is the only failure `fetch` can express, so "the popup cannot answer me" and "the student is signed out" arrive as the same result, and the one instruction the banner gives — sign in and press Resume — cannot fix it.

The manual workaround, which does work today, is to click Course Finder in the popup's own nav before pressing Resume. The student should not have to know that.

## Decided before dispatch

**Navigate, do not instruct.** Telling the student to visit Course Finder first (a banner change) was considered and rejected: the driver already drives the dropdown, so driving the navigation that makes the dropdown exist is the same category of action, and it removes a step the student can only get wrong. `WebviewWindow::url()` and `WebviewWindow::navigate()` both exist in Tauri v2.

**This is not an ADR-0001 concern.** Navigating to Course Finder is a GET of a page the student opens by hand every time they capture. Nothing is written, submitted, or enlisted, and the login is neither read nor touched (ADR-0002).

**The Course Finder path stays a Rust constant, not a `SelectorConfig` field.** `https://archershub.dlsu.edu.ph/CourseFinder/index/53` — the `53` is the nav item's id, identical across both captured fixtures. Putting it in `SelectorConfig` is the tempting move and is wrong right now: `selector_config.rs` rejects any document whose field set is not exactly the struct's own serialization plus `version`, so growing the struct rejects the currently published remote document and breaks capture on every installed copy until that document is republished (ADR-0013). Leave a comment saying so, so the next person does not have to rediscover it.

## Acceptance criteria

- [ ] **A refresh started or resumed while the popup sits on the Student Dashboard succeeds**, without the student navigating anything by hand. This is the ticket
- [ ] The driver checks the popup's current URL and navigates it to Course Finder **only when it is not already there**. A popup the student already has on Course Finder is not reloaded out from under them, and a mid-run navigation away recovers on the next course rather than failing the run
- [ ] **Readiness is waited for, not assumed.** A freshly navigated page is not ready the instant `navigate()` returns, so the selection is retried on an interval until the response lands or the step's overall budget is spent. A retry against a page that is not ready must stay a clean no-op — the script's guards already return before it sets `FORCE_NEXT_CAPTURE_FLAG`, and that ordering must be preserved
- [ ] The retries are **spaced and bounded**, so a dead page produces a handful of evals over the budget rather than a tight loop of searches against the hub
- [ ] **A genuinely expired session is still reported as expired, and faster.** If the popup is on the login page, the run halts as `session_expired` without burning the full 15-second timeout — that banner is correct there, and it is the case the student can actually act on
- [ ] The whole step still finishes within roughly today's budget: navigation plus retries does not make a failing refresh take noticeably longer than it does now
- [ ] Navigation reinstalls nothing by hand — the ticket-10 initialization script runs per document, so the capture observer comes back on the new page on its own. Verify this rather than assuming it, and say so in the commit
- [ ] `RefreshStatus` gains no new variant and `docs/ipc-contract.md` is unchanged. The statuses stay `complete` / `session_expired` / `offline`; this ticket makes the existing ones honest rather than adding one
- [ ] Nothing about the login is read, stored, or transmitted (ADR-0002), and no capture is journaled as an undoable batch (ticket 26's boundary is unchanged)

## Testing

The navigation itself lives in `LiveRefreshSource`, which needs a real webview and cannot be exercised by the driver's fake-source tests. So put the decisions in pure functions and test those:

- [ ] **URL classification is pure and colocated with its tests** — "is this the Course Finder page", "is this the login page" — taking a URL and returning an answer, with no Tauri types in the signature. Core logic stays free of I/O and framework imports
- [ ] Tests cover: the Student Dashboard needing navigation, Course Finder (with and without a trailing path or query) not needing it, the login page classified as expired rather than as a page to retry, and a URL on some other host classified as not-Course-Finder
- [ ] The existing driver tests still pin what they pin: a halt keeps its partial result, a resume token is spent exactly once, and trusted steps land through `Store::apply_refresh`

## Explicitly out of scope

- **A closed popup still reports `session_expired`.** `fetch` returns it when `get_webview_window` finds nothing, which is the same dishonesty in a different case — the student needs "open Archer's Hub", not "sign in". Fixing it properly means a new `RefreshStatus`, a contract amendment, and UI to render it. Worth its own ticket; do not smuggle it into this one
- **Opening the popup automatically** when a refresh is pressed and no window exists. Opening a window the student did not ask for is a decision, not a fix
- Banner copy (ticket 21's `src/core/refresh.ts`). Once refresh works from the dashboard, "Sign in to Archer's Hub and click Resume" is accurate again
