# Map — A calm, card-based, native-feeling Animo Plan

Label: `wayfinder:map`

## Destination

A spec at `.scratch/card-ui/spec.md` and a numbered set of **implementation tickets** in `.scratch/card-ui/issues/`, ready to dispatch, that together turn Animo Plan into a calm, card-based, iOS/macOS-feeling desktop app — light and dark — with a smooth end-to-end experience. Every implementation ticket carries a `Lane: Attended` or `Lane: Detached` line on top of the usual `ui`/`headless` slug.

## Notes

**Domain.** Frontend visual and interaction design of a Tauri 2 + React 19 + Tailwind v4 desktop app running in WebView2 on Windows first. Read `CONTEXT.md`, `docs/design-system.md`, and `docs/adr/` before any ticket; use glossary terms exactly.

**Skills every session consults.** `impeccable` for design direction and critique; `grilling` + `domain-modeling` for grilling tickets; `prototype` for prototype tickets; `research` for research tickets.

**Lanes.** *Attended* — needs the human present: visual judgement, "does this feel right", anything they want to see before merge. *Detached* — an agent can take it start to merge unsupervised: mechanical token work, CSS motion behind guard tests, refactors under existing tests. The lane is chosen per implementation ticket in the final ticket; decision tickets are HITL/AFK by type.

**Settled while charting** (the human's calls, not up for relitigation inside this map):

- **The surface plan is "cards everywhere, plus a course board".** Plan list, captured catalog, section picker, and solve results become rich cards; a course board (courses as columns, sections as cards) is added as a further way to view courses. The week grid stays permanent and visible (tickets 28, 32, 46).
- **Calm workspace with a next-step card.** The workspace stays; tools appear only when relevant; one card at the top says what to do now and fades as the plan fills.
- **Desktop only.** iOS/macOS design *language*, not touch or phone layouts.
- **Dark mode is in.** System / Light / Dark, defaulting to System. Neutral graphite dark, Archer Green as the accent — never a green-tinted base under the grid. A second, dark course-hue palette under ADR-0012. A new ADR supersedes ADR-0018.
- **Type.** `-apple-system` first (real SF on macOS, zero bytes), then a bundled, Latin-subset **Inter** variable font for Windows. No web-font fetch (ADR-0004). The Inter file is an approved new dependency.
- **Motion and material rules are reopened**, as accepted by the human:
  - `motion` is allowed app-wide with springs, keeping `LazyMotion` + `m` and the single root reduced-motion pattern.
  - The 260ms cap becomes "springs are interruptible and never block input; nothing waited on exceeds ~450ms".
  - `backdrop-filter` is allowed on fixed chrome (header, a floating dock, sheets, popovers), never on scrolling or repeated surfaces.
  - Card depth is decided per surface; **week-grid blocks stay flat** because hue there is data.
  - Every performance rule stands: transform/opacity only, zero idle animation, nothing animating mid-solve.
- **Design principles adopted:**
  - Section cards carry an **enrolment fill bar** (neutral, with a "Full" label — not a hue).
  - **No ALL-CAPS micro labels.**
  - **No unlabelled icon toolbars.**
  - **At most three top-level destinations.**
  - **Every empty state says what to do next** — no giant decorative watermark text.
  - **No zoom controls** — the grid fits the window.
- **Nothing designed here may preclude a later macOS build** — e.g. a custom title bar leaves room for the traffic lights.
- Performance rules and ADRs 0001–0017, 0019–0021 are untouched.

## Decisions so far

<!-- one line per resolved ticket: [title](issues/NN-slug.md) — gist -->

- [Can Tauri 2 give us a unified title bar and Mica, and what does it cost?](issues/01-window-chrome-in-tauri-2.md) — custom Windows header via `decorations: false`, no new dependency; Snap Layouts hover flyout is lost; Mica deferred; macOS later uses the overlay style with a traffic-light inset.
- [What is the smallest type stack that reads like SF on both platforms?](issues/02-an-sf-like-type-stack.md) — official Inter 4.1 variable, roman, Latin-1 subset (72 kB), no alternates, `tabular-nums` on times/counts; stack `-apple-system, "Inter Animo", system-ui`; Inter runs ~10% wider than Segoe at 10px.
- [What does app-wide `motion` with springs cost, and are springs interruptible?](issues/03-springs-app-wide-cost.md) — keep lazy `domMax` (0 kB extra for springs/exit/layoutId/drag); physics springs only, since duration springs drop velocity; smooth/snappy presets at 0.3 s; reversible motion is JS, one-shot entrances CSS; board drag is dnd-kit.
- [Which visual direction does Animo Plan take?](issues/04-visual-direction.md) — "Glass + cards": B's macOS shell (collapsible sidebar of plans and courses, one glass toolbar, tools panel on the right) wearing C's cards (week-thumbnail plan cards, three-step empty card, chipped section cards, green next-step strip); no dock; flat grid; "clean" keeps card structure.

## Not yet specified

- **Dialogs as sheets.** Whether Create Plan, About, Report, Clear Schedule, and the section-details modal become iOS-style sheets or stay centred dialogs — hangs on the visual direction.
- **Onboarding and the sign-in moment.** A redesign of the first run and of the Archer's Hub popup's framing: "sign in once, you stay signed in"; Google sign-in is unavailable in an embedded webview (`spec.md` §2), so say so before the student reaches for it.
- **Section-card anatomy.** The rest state is set by ticket 04 (code, professor, state pill, day/time/room chips, remark, fill bar, conflict line); still open: what a section card shows on hover/expand, and how the same card reads on the board.
- **Where settings live.** The app has no settings surface; Appearance is the first setting. May fold into the dark-mode ticket or become its own.

## Out of scope

- **Login friction and keeping the Archer's Hub session alive.** The human wants a student to sign in once per app launch and never be timed out while the app is open. Archer's Hub times sessions out server-side, and holding one open would take background keep-alive requests, which ADR-0001 forbids; credential autofill is forbidden by ADR-0002. A capture-path question — its own future map.
- **Reading every course on open (bulk capture).** Changes what the capture path requests; governed by ADR-0001/0003. Its own future map.
- **Mobile, touch, and narrow-screen layouts.**
- **The macOS build itself** — only the rule that nothing here precludes it.
