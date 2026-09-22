# 03 — What does app-wide `motion` with springs cost, and are springs interruptible?

Type: research
Lane: AFK
Status: resolved
Blocked by: None — can start immediately
Map: [map.md](../map.md)

## Question

The map reopens `motion` for app-wide use with iOS-style springs, keeping `LazyMotion` + `m` and the root `MotionConfig reducedMotion="user"`. Before a motion language is designed, establish the facts, for the installed `motion` v13 (read `package.json`, `src/App.tsx`, `src/lib/motionFeatures.ts`, and `docs/design-system.md` § Motion first):

- **Bundle.** Which feature bundle springs, `layout`, `AnimatePresence` exit animations, and drag gestures need (`domAnimation` vs `domMax`), and what each costs gzip — measured with `npm run build`, compared against the recorded baseline (initial 139.11 kB gzip; deferred 27.87 kB gzip). Does the deferred-feature split survive?
- **Springs.** How `type: "spring"` with `stiffness`/`damping`/`mass` vs `visualDuration`/`bounce` behaves; which settings approximate iOS's default UIKit/SwiftUI springs (e.g. `.smooth`, `.snappy`, `.bouncy`); settle times.
- **Interruptibility.** Whether an in-flight spring retargets smoothly from its current velocity when its target changes (e.g. a sheet dismissed mid-open), and whether CSS transitions can do the same — i.e. what must be JS-driven and what can stay CSS.
- **Runtime.** Whether `motion` animates on the compositor (WAAPI hardware acceleration) for transform/opacity in WebView2, what falls back to rAF on the main thread, and what that means while a Rust solve is busy.
- **Constraints here.** Interaction with the static-markup test renderer (`docs/design-system.md` § Rendering constraint), with `AnimatePresence` around asserted content, and with the stacking-context / `position: fixed` hazards listed in § "Four structural fixes".
- Whether dnd-kit (already approved for ticket 49) or `motion`'s own drag suits a future course board better, and why.

Recommend spring presets to start from and the bundle strategy.

## Answer

**Keep `domMax`, lazily loaded; write springs as physics, not durations; JS-drive anything reversible.** Findings: branch `research/motion-springs`, file `docs/research/motion-springs.md` (commit `a92a9ca`, local only; numbers there are marked measured vs documented).

- **Presets — stiffness/damping/mass, never `visualDuration`/`bounce`.** In the installed v13.1.1, duration-based springs drop inherited velocity, so only physics springs retarget smoothly (measured on a sheet dismissed mid-open: 1821 px/s carried vs 0). Starting points, from Apple's duration/bounce mapping at 0.3 s, mass 1: **smooth** k 438.65, c 41.89 (95% at 227 ms, rest ≈ 430 ms); **snappy** k 438.65, c 35.60 (95% at 176 ms, 0.6% overshoot); **bouncy** c 29.32 (4.6% overshoot) — held back.
- **Bundle.** `domMax` (already the lazy bundle) covers springs, exit, `layoutId`, and drag at 0 kB extra. Deferred chunk 27.88 kB gzip with `domMax` vs 14.05 with `domAnimation`; the split survives either way. Initial chunk is now 169.70 kB gzip (the app grew since ticket 33; motion's share ≈ 15.5–16.8 kB, unchanged). **Avoid `useAnimate` (+12.00 kB initial) and `useSpring` (+5.57 kB).**
- **The canary is weaker than documented.** Rollup's "will not move module" warning fires only when `m` also comes from `motion/react`; a bare `import("motion/react")` silently inflates the deferred chunk to 51.86 kB with no warning.
- **CSS vs JS.** CSS transitions keep position but not velocity on interruption. Sheets, drag release, and the `layoutId` handoff must be `motion`; one-shot entrances may stay CSS.
- **Runtime.** Only `opacity` and a whole `transform` string go to the compositor (WAAPI); `x`/`y`/`scale`, layout, and drag run on rAF. A Rust solve is another process — it competes for cores, not the JS thread.
- **Course board drag: dnd-kit, not `motion`'s drag** — `motion`'s has no keyboard sensor and no sortable-list model; dnd-kit is already bundled (0 kB marginal), though its approval is scoped to ticket 49.
- Open questions it raised were carried into ticket 08.
