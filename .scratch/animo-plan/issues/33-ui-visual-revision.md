# 33 — [ui] Visual revision: make it feel modern without making it harder to read

**What to build:** A deliberate visual pass across the app — ambient gradient backgrounds, frosted surfaces, motion on transitions, better empty and loading states, and a solve dialog that reads like a ranked result rather than a list of boxes.

The app is functionally complete and looks like a functional prototype. This ticket is about how it feels to use, with one hard rule running through it: **the week grid and the section list are working surfaces, and nothing here may make them harder to read.**

**Blocked by:** None — can start immediately

**Status:** ready-for-agent

## The line this ticket must not cross

Animo Plan is used during enlistment, under time pressure, while the student is comparing sections and watching enrolment counts. Two-thirds of the screen is dense, scannable data. Decoration belongs on the surfaces where the student is *arriving*, not the ones where they are *working*.

**Rich:** the plan list, empty states, onboarding, About, the solve dialog's framing, transitions between screens.

**Quiet:** the week grid, the section list, the capture bar. These stay flat, high-contrast, and still.

Specifically: **no ambient background behind the week grid.** Hue on that grid is load-bearing — it is how a student tells one course from another (ADR-0012) — and any tint behind it shifts the perceived colour of every block. A gradient there would actively degrade the one view the app exists to produce.

## Constraints that are not negotiable

- **ADR-0012 — hue encodes course identity only.** No decorative colour may appear where it could be read as data: not on section cards, not on grid blocks, not on conflict or modality indicators. Ambient colour lives behind content surfaces, never on them.
- **ADR-0011 — the week grid stays hand-rolled.** No calendar or grid library.
- **ADR-0009 — conflicts are displayed, never prevented.** No animation may delay or soften a conflict appearing.
- **Contrast holds everywhere.** Body text on any new surface meets WCAG AA (4.5:1); large text and UI chrome meet 3:1. A frosted panel that fails contrast over its own background is a defect, not a style.
- **`prefers-reduced-motion` is honoured** on every animation added. Nothing currently in the app checks it; this ticket introduces the first ones, so it establishes the pattern.
- **No WebGL and no canvas-driven ambient backgrounds.** This is a desktop app that must stay responsive while a solve runs and must not burn battery to render decoration. CSS gradients and transforms only.
- **New dependencies need a decision.** `docs/agents/dependencies.md` pre-approves a specific set and no animation library is on it. Anything CSS-only can proceed; anything needing `motion`, `gsap`, `three`, or similar stops and asks first, naming the component that needs it.
- **The test suite renders to static markup.** All ~290 frontend tests use `renderToStaticMarkup` — no DOM, no effects, no refs, no rAF. Every component this ticket touches must still render meaningful, assertable HTML with animation inert. A component that renders empty without a browser is not acceptable here.

## Acceptance criteria

### Ambient surfaces

- [ ] The **plan list** gains an ambient gradient background — a slow, low-contrast blend, CSS only. Plan cards sit on an opaque or frosted surface above it so their text contrast is unaffected by whatever is behind
- [ ] **Onboarding and About** get the same treatment, since both are arrival surfaces with little data on them
- [ ] The gradient is **static or very slow**; nothing that draws the eye while the student is reading
- [ ] **The plan workspace keeps a plain background.** No ambient colour behind the week grid, the section list, or the capture bar

### Motion

- [ ] Screen transitions — opening a plan, opening and closing the picker, dialogs — animate rather than cut. Short, and never blocking input
- [ ] Solve results appear with a **brief stagger** so the ranking reads as an ordering rather than a wall
- [ ] **Adding a section animates the ghost into place** on the week grid: the preview the student is already hovering becomes the committed block. This is the one piece of motion that carries meaning rather than polish, and it is worth doing well
- [ ] Every animation is disabled under `prefers-reduced-motion`, verified

### States that currently say nothing

- [ ] **Skeletons replace spinners** where the shape of the incoming content is known — the section list and the week grid
- [ ] **Empty states earn their space**: no captured courses, no plans yet, a plan with no sections, and a solve with no results each get a considered layout that says what to do next, not just what is absent
- [ ] The **capture counter animates its number** when a capture lands, so a silent background capture is visible without being loud

### Solve dialog

- [ ] Ranked solutions read as **ranked**: the top result is visually first among equals, not one of twenty identical cards
- [ ] The score and its breakdown are **legible at a glance** — a bar or similar, not only a number
- [ ] Advisory warnings stay clearly advisory and never look like errors (they are not: ADR-0009's spirit)

### Throughout

- [ ] Type scale, spacing, and border radii are **consistent across the app** rather than per-component. Record the choices somewhere durable so the next ticket does not re-invent them
- [ ] Focus states are visible on every interactive element, on every new surface
- [ ] Nothing added here changes what any control does. This is a visual pass: no behaviour, no data, no IPC changes
- [ ] Tests cover: the ambient surfaces rendering, the plan workspace *not* carrying one, reduced-motion disabling animation, skeletons rendering while loading, and each empty state rendering its guidance

## Worth knowing before starting

**React Bits** (reactbits.dev) was raised as a source for these components. Its model is copy-the-source-in, the same as shadcn, which this project already uses — so it fits. Its components split roughly into CSS-only, `motion`-based, and WebGL-based. **Only the first tier is usable here without a decision**, and the WebGL tier is ruled out entirely by the no-canvas constraint above. Take individual components rather than adopting a look wholesale; the app already has a visual language and this ticket is refining it, not replacing it.
