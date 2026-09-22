# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

A Tauri 2 desktop app: React 19 + Tailwind v4 rendered in WebView2 on Windows first. macOS is a later build, and nothing designed now may preclude it. Desktop only — no touch or phone layouts.

## Users

DLSU Manila students planning their enlistment. They search courses in Archer's Hub's Course Finder, and the app quietly keeps what they looked at. The moment that matters most is **enlistment night**: a student at their own laptop, often on battery, racing for slots, watching enrolment counts fill, and needing to see conflicts and full sections at a glance. The same student also uses the app in the weeks before, exploring courses and professors at a slower pace.

## Product Purpose

A read-only enlistment planner. It captures the sections a student searched for, keeps them locally, and solves for conflict-free schedules. Success is a student walking into enlistment with a plan they trust — the sections they want, the backups if those fill, and no surprises — without ever feeling overwhelmed by the tool.

## Positioning

Calm, polished, and trustworthy under pressure. It never enlists, never writes to Archer's Hub, never stores credentials, and sends nothing anywhere else. The bet is that a smooth, uncluttered, native-feeling experience from first launch to finished plan is what makes a student choose it and keep it open on enlistment night.

## Operating Context

- The student signs in to Archer's Hub in a popup window the app opens; Google sign-in is unavailable in an embedded webview.
- Capture happens silently as a side effect of the student's own Course Finder searches; Refresh re-reads enrolment counts only when the student presses it.
- A plan is scoped to exactly one campus and one academic session. The week runs Monday to Saturday.
- The machine is often busy: a Rust solve or a refresh can be in flight while the student looks at the screen.

## Capabilities and Constraints

- Plans, a captured catalog, a section picker, a solver with presets, priority, professor rankings and avoided professors, pins, conflicts, PNG export.
- Domain terms are fixed by `CONTEXT.md`; use them exactly (Section, Schedule block, Modality, Included course, Pin, Conflict, Solve, Professor…).
- Binding decisions live in `docs/adr/`. Among them: never write to Archer's Hub (0001); no credentials (0002); no telemetry or web-font fetches (0004); modality is derived per block (0007); conflicts are displayed, never prevented (0009); a hand-rolled week grid (0011); hue encodes course identity only (0012).
- Performance is an acceptance criterion on student laptops in WebView2: transform/opacity motion only, zero idle animation, nothing animating mid-solve.

## Brand Commitments

- The name is **Animo Plan**, and the mark is the wordmark set as type — no icon or emblem.
- Archer Green is the accent.
- "Read-only • No credentials stored" is the app's trust claim, and it stays visible.
- The design language is iOS/macOS: calm, card-based, native-feeling, in light and dark.
- The app has no affiliation with De La Salle University and must never imply one.

## Evidence on Hand

- Real domain shapes in committed fixtures: course codes such as CSINTSY, GEARTAP, CSOPESY, GESTSOC, NSCOM, PETHREE; section codes like S11, S01, Z01; rooms like G207, L226, J302, V501; `ONLINE` locations; PE remarks such as `PICKLEBALL`, `SWIMMING`, `SOCDANCE`.
- The raw `docs/ArchersHub-Course-Finder-*.html` captures are private and gitignored — never quote them.
- No testimonials, usage numbers, or endorsements exist; none may be invented.

## Product Principles

1. **Calm under pressure.** The screen shows what matters now; everything else waits until it's relevant.
2. **The week is the artifact.** The week grid stays visible, and every other surface serves it.
3. **Show, never prevent.** Conflicts, full sections, and missing data are shown plainly, never blocked or softened.
4. **Trust is visible.** Read-only, local-first, and no credentials — said on screen and true in code.
5. **Every empty state says what to do next.**

## Accessibility & Inclusion

Body text meets WCAG AA (4.5:1), and large text and UI chrome meet 3:1, in both light and dark. Every surface is keyboard-operable with a visible focus ring. Reduced motion is honored through one root pattern. No information is carried by hue alone, since hue is reserved for course identity.
