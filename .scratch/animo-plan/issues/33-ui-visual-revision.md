# 33 — [ui] Visual revision: modern, consistent, and still fast

**What to build:** A deliberate visual pass across the whole app — a recorded design foundation, ambient surfaces where the student is arriving, restrained motion, real empty and loading states, and a solve dialog that reads like a ranking.

The app is functionally complete and looks like a functional prototype. This ticket is about how it feels to use, under two hard rules: **the week grid and the section list are working surfaces**, and **nothing added here may cost frame rate or battery.**

**Blocked by:** None — 44 and 45 are merged. This is the last open ticket, and it wants a clear field: it touches almost every component, so nothing else should be in flight while it runs

**Status:** ready-for-agent

## Read this first: the app changed since this ticket was written

Six tickets landed after this was drafted. The surface inventory is now:

`AboutDialog` · `AppHeader` · `CaptureBar` · `CreatePlanDialog` · `ExportMenu` · `MissingSectionBanner` · `OnboardingDialog` · `PlanList` · `PlanWorkspace` · `ReportBrokenCaptureDialog` · `SectionPicker` · `SolutionThumbnail` · `SolveDialog` · `UpdateNotice` · `WeekGrid`

New since drafting: **`UpdateNotice`** (ticket 39), the **week-grid context menu and details modal** (41, 45), the **solve dialog's "what would move" report and pin controls** (43), and the **export container's title** (44). All of them are part of this pass rather than the one un-designed corner.

**The sample-plan feature was also removed**, which reshaped two surfaces this ticket restyles. `PlanList`'s empty state now offers a single action instead of two, and `OnboardingDialog`'s first screen is a one-column path rather than the two equal-weight options it was built as — its grid is `grid-cols-1` holding one card. Do not design against a choice screen that no longer exists; the empty state and that first screen are now the clearest places where a considered layout is worth the effort, because both lost half their content and neither was redesigned around the loss.

## Three findings from the current code

**1. Dark mode is half-on and broken today.** `src/core/palette.ts` and `WeekGrid.tsx` carry `dark:` variants. Tailwind v4's default dark strategy is `prefers-color-scheme`, and no config overrides it — so for a student running Windows in dark mode, **grid blocks render dark while the rest of the app stays hardcoded light** (`body` is `#f8fafc` in `App.css`). Nobody chose this; it is a leak.

**Decided: the app commits to light, and the stray `dark:` variants come out.** A real dark mode means auditing every surface, both palettes for course hues under ADR-0012, and contrast for all of it — that is its own ticket, not a rider on this one. Removing the strays fixes a live bug and lets the eventual dark-mode ticket start from a known state.

**2. The design-token layer exists and is unused.** `App.css` declares a full shadcn variable set — `--background`, `--primary`, `--muted`, `--radius`, and the rest — and almost nothing references them. Components use raw utilities (`bg-white`, `text-slate-900`, `bg-emerald-50`). That is why spacing, radii, and type sizes drift per component. This is the ticket that fixes it.

**3. Nothing in the app checks `prefers-reduced-motion`.** Not one occurrence in `src/`. This ticket introduces the first, so it sets the pattern for everything added after it.

## Performance is an acceptance criterion, not an aspiration

This runs in WebView2 on student laptops, during enlistment, often on battery, while a solve burns CPU in Rust and a capture popup is open. Decoration that costs frames is a defect.

- [ ] **Animate only `transform` and `opacity`.** Never `width`, `height`, `top`, `left`, or `margin` (layout), and never `filter` or `box-shadow` on a large or repeated surface (paint)
- [ ] **No `backdrop-filter` on anything scrolling, repeated, or large.** Frosted glass is fine on a dialog; it is not fine on the section list, the grid, plan cards, or a full-page surface — it forces a repaint of everything behind it
- [ ] **Nothing loops forever on a large surface.** Ambient gradients are static, or move via `transform` on a small number of layers. An idle app must have **zero continuously animating elements** — check with paint flashing and the frame-rate meter, on an idle plan workspace
- [ ] **No animation runs while a solve or a refresh is in flight.** Those are the moments the student is waiting and the machine is busiest
- [ ] **Repeated elements stay cheap.** The week grid holds ~40 blocks and the section list ~42 cards. No per-item transition firing on every render, no per-item shadow or filter
- [ ] **Stagger comes from CSS `animation-delay` or `motion`'s own variant stagger — never a chain of `setTimeout`s** or per-item JS state
- [ ] **No WebGL and no canvas-driven backgrounds.** CSS gradients and transforms only
- [ ] Scrolling the section list with a full 42-section course stays smooth, and the grid does not repaint on hover of a single block

## Do not undo the structural fixes underneath you

Four recent tickets fixed defects whose causes are exactly the CSS this ticket wants to add. **Every one can be re-broken by a well-meaning visual change.**

- [ ] **`opacity`, `transform`, `filter`, `backdrop-filter`, and `will-change` all create stacking contexts** — precisely what trapped the context menu behind neighbouring blocks (ticket 45). Adding any of them to a grid block, a day column, or a grid ancestor can re-break it. Verify the menu still paints above every block afterwards
- [ ] **`transform`, `filter`, and `backdrop-filter` on an ancestor make it the containing block for `position: fixed` descendants.** This is now concrete, not hypothetical: ticket 45 portals the menu to `document.body` and positions it with `position: fixed`. Any of those properties on an ancestor of wherever the menu ends up mounted silently mis-places it, and it will look like ticket 45 was never fixed
- [ ] **The PNG export container keeps ticket 40's shape**: off-screen positioning on the wrapper, captured node statically positioned. Its guard test must keep passing, and the exported image must still contain the schedule — export one and look at it
- [ ] **The exported image keeps ticket 44's restraint.** This ticket's ambient surfaces do not belong in the PNG
- [ ] **Nothing interactive or animated leaks into the export.** `ExportMenu` renders its own `WeekGrid`
- [ ] Ticket 41's keyboard access survives: blocks focusable, visible focus ring, Enter / Space / Menu key / Shift+F10, Escape to close

## The line this ticket must not cross

Animo Plan is used during enlistment, under time pressure, while comparing sections and watching enrolment counts. Two-thirds of the screen is dense, scannable data.

**Rich:** plan list, onboarding, About, empty states, dialog framing, screen transitions.

**Quiet:** the week grid, the section list, the capture bar. Flat, high-contrast, still.

**No ambient background behind the week grid.** Hue on that grid is load-bearing — it is how a student tells one course from another (ADR-0012) — and any tint behind it shifts the perceived colour of every block.

## Constraints that are not negotiable

- **ADR-0012 — hue encodes course identity only.** No decorative colour where it could be read as data: not on section cards, not on grid blocks, not on conflict, modality, or pin indicators
- **ADR-0011 — the week grid stays hand-rolled.** No calendar or grid library
- **ADR-0009 — conflicts are displayed, never prevented.** No animation may delay or soften a conflict appearing
- **Contrast holds.** Body text meets WCAG AA (4.5:1); large text and UI chrome meet 3:1. A frosted panel that fails contrast over its own background is a defect
- **`prefers-reduced-motion` is honoured on every animation**, verified by toggling it
- **`motion` is approved for this ticket**, decided by a human who asked for an app that feels modern *and* lightweight — both halves are the decision, and the conditions below are how the second half is kept. Anything else still stops and asks: `gsap`, `three`, `ogl`, and any other animation or graphics package are not approved
  - **`LazyMotion` + the `m` component, never the full `motion` component.** The full component pulls the whole feature set into the initial bundle to play a fade; `m` with a lazily loaded feature bundle is a fraction of it. Load the smallest feature set that does the job and check what the bundle actually gains — Vite reports it
  - **`MotionConfig reducedMotion="user"` is the single reduced-motion pattern**, set once near the root. That satisfies the foundation's reduced-motion requirement for everything under it; a component reaching for its own handling is a smell
  - **No per-element `motion` on repeated elements.** The week grid holds ~40 blocks and the section list ~42 cards. Animate the container, not each child
  - **No *persistent* layout animation on the grid.** A `layout` prop on every block makes all ~40 of them measure on every render, and the grid is the surface that must stay still and readable. A **one-shot `layoutId` handoff for the ghost-into-place transition is the exception and is why `motion` was approved** — it is transient, it involves two elements rather than forty, and it is the one animation here that carries meaning
  - **Components must still render assertable HTML under `renderToStaticMarkup`.** A surface that renders empty without a browser is not acceptable, and `AnimatePresence` around content the tests assert on is the likely way to break that
- **The suite renders to static markup** — no DOM, no effects, no refs, no rAF. Every component touched must still render assertable HTML with animation inert. A component that renders empty without a browser is not acceptable

## Acceptance criteria

### Foundation — land this first, before any surface work

- [ ] **One recorded set of tokens**: type scale, spacing, radii, elevation, and motion durations/easings, defined where the app already keeps them (`App.css`) and actually referenced by components. The existing unused shadcn variables are either adopted or deleted — not left as a decoy
- [ ] **The choices are written down somewhere durable** so the next ticket extends the system instead of re-inventing it
- [ ] **A single reduced-motion pattern** every animation uses, established once
- [ ] The stray `dark:` variants are removed and the app is consistently light

### Identity and icon restraint

The app currently signs itself with a green rounded tile holding a `BookOpen` glyph, the wordmark, and a subtitle. The glyph is a generic stock icon standing in for a logo, and it is the least distinctive thing on the screen.

- [ ] **The mark is the wordmark.** "Animo Plan", set as type — bold, tight tracking, confident. The `BookOpen` tile goes. No icon, no monogram, no invented emblem
- [ ] The wordmark is **the app's most deliberate piece of typography** and should look chosen rather than defaulted: it is the one place a display weight, tighter tracking, or optical size earns its keep
- [ ] Decide whether the "Archer's Hub Enlistment Planner" subtitle survives. If it does, it is subordinate to the wordmark, not a second line of equal weight
- [ ] **"Read-only • No credentials stored" stays visible.** It is the app's trust claim (ADR-0001, ADR-0002), not decoration, and it is not a candidate for the icon cull

**Then thin the icons everywhere they are decoration.** Icon counts today: `WeekGrid` 35, `SectionPicker` 33, `PlanWorkspace` 30, `AboutDialog` 26, `SolveDialog` 24. Most of them label something the adjacent text already says.

- [ ] **An icon beside a word that already says the same thing is noise.** Prefer the word. A button reading "About" does not need an ℹ; a heading reading "Capture Sections" does not need a glyph
- [ ] **Icons that carry meaning stay, and are not up for negotiation.** Specifically: the grid's `Building2`/`Globe` modality marks (modality is derived per-block and displayed — ADR-0007), the conflict indicator (ADR-0009), and pin state. Hue is already spent on course identity (ADR-0012), so those glyphs are load-bearing information, not chrome. **Removing them destroys data the student is reading**
- [ ] An icon standing alone as a control — no visible label — keeps an accessible name
- [ ] The result is judged on the dense surfaces, not the calm ones: the week grid and the section list should read as *quieter*, not emptier

### Ambient surfaces

- [ ] **Plan list**, **onboarding**, and **About** gain a slow, low-contrast CSS gradient. Content sits on an opaque or frosted surface above it so text contrast is unaffected
- [ ] **The plan workspace keeps a plain background.** No ambient colour behind the grid, the section list, or the capture bar

### Motion

- [ ] Screen and dialog transitions animate rather than cut. Short, never blocking input
- [ ] Solve results appear with a **brief stagger** so the ranking reads as an ordering
- [ ] **Adding a section animates the ghost into place** on the grid — the preview the student is hovering becomes the committed block. This is the one piece of motion that carries meaning rather than polish, and the one case where a shared-element (`layoutId`) transition is worth it. It must not leave measurement running on the other blocks once it settles
- [ ] Every animation is disabled under `prefers-reduced-motion`, verified

### States that currently say nothing

- [ ] **Skeletons replace spinners** where the shape of the incoming content is known — the section list and the week grid
- [ ] **Empty states earn their space**: no captured courses, no plans yet, a plan with no sections, and a solve with no results each say what to do next
- [ ] The **capture counter animates its number** when a capture lands, so a silent background capture is visible without being loud

### Solve dialog

- [ ] Ranked solutions read as **ranked** — the top result is visually first among equals, not one of twenty identical cards
- [ ] The score and its breakdown are **legible at a glance** — a bar or similar, not only a number
- [ ] **Ticket 43's "what would move" report is designed, not bolted on**, and pinned exemption reads clearly
- [ ] Advisory warnings stay clearly advisory and never look like errors

### The newer surfaces

- [ ] **`UpdateNotice`** is quiet and dismissible — it must not compete with the plan for attention
- [ ] **The context menu and details modal** match the system rather than carrying their own look
- [ ] **`MissingSectionBanner`** and the capture-failure notices read as informative, not alarming

### Throughout

- [ ] Focus states are visible on every interactive element, on every new surface
- [ ] **Nothing added here changes what any control does.** No behaviour, no data, no IPC changes
- [ ] Tests cover: ambient surfaces rendering, the plan workspace *not* carrying one, reduced-motion disabling animation, skeletons rendering while loading, each empty state rendering its guidance, and the ticket-40 export guard still passing

## Worth knowing before starting

**This is the largest ticket in the project and it touches almost every component.** Land the foundation first and commit it before restyling surfaces — a token change after twelve components have been restyled means restyling them twice. If it proves too large to land as one change, say so and propose a split rather than shipping half a design system.

**React Bits** (reactbits.dev) was raised as a source. Its model is copy-the-source-in, like shadcn, which this project already uses, so it fits. Its components split roughly into CSS-only, `motion`-based, and WebGL-based:

- **CSS-only and `motion`-based are both open now** that `motion` is approved
- **The WebGL tier is ruled out entirely** — it is the tier React Bits is best known for (the animated background family built on `ogl`), and none of it is usable here. No canvas, no WebGL, and a looping background fails the idle-app rule on its own

Take individual components rather than adopting a look wholesale, and hold each one to this ticket's performance rules rather than assuming a published component respects them — several are written for landing pages, where a permanently animating hero is the point. The app has a visual language; this ticket refines it rather than replacing it.
