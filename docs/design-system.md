# Animo Plan design system

The tokens live in `src/App.css`. The motion tokens are mirrored, for code that needs them, in `src/core/motion.ts`. This file is the reasoning — read it before adding a surface, so the next ticket extends the system instead of re-inventing it.

`src/designSystem.test.ts` enforces the parts of this document that can be checked automatically.

---

## The line the app is drawn on

Animo Plan is used during enlistment, under time pressure, while comparing sections and watching enrolment counts. Two-thirds of the screen is dense, scannable data. The design splits accordingly:

| | Surfaces | Treatment |
|---|---|---|
| **Rich** | plan list, onboarding, About, empty states, dialog framing, screen transitions | Ambient wash, generous type, motion on arrival |
| **Quiet** | week grid, section list, capture bar | Flat, high-contrast, still. No ambient colour, no per-item shadow, no hover repaint |

Nothing decorative goes on a working surface. The week grid in particular gets **no ambient background**: hue there is load-bearing (ADR-0012), and any tint behind it shifts the perceived colour of every block.

---

## Colour

Light only (ADR-0018). The shadcn variable names are adopted as real Tailwind theme keys, so `bg-background`, `bg-card`, `text-foreground`, `text-muted-foreground`, `border-border`, `bg-primary`, and `ring-ring` all resolve. They used to sit in `:root` as bare HSL triplets outside the theme, which is why nothing consumed them and every component reached for `bg-white` / `text-slate-900` instead.

| Token | Value | Role |
|---|---|---|
| `--color-background` | `#f6f7f9` | The page |
| `--color-card` | `#ffffff` | Any panel content sits on |
| `--color-foreground` | `#0f172a` | Body text — 16.7:1 on card |
| `--color-muted-foreground` | `#5b6675` | Secondary text — 5.8:1 on card, 5.4:1 on background |
| `--color-border` | `#e2e8f0` | Every hairline |
| `--color-primary` | `#15803d` | Archer Green. Primary actions and focus ring |

**Contrast holds.** Body text meets WCAG AA (4.5:1); large text and UI chrome meet 3:1. `--color-muted-foreground` is the darkest of the greys the app was using before precisely so the smallest text still clears AA — the old `text-slate-400` at 11px did not.

**Course hues are not part of this palette.** They live in `src/core/palette.ts` and encode course identity only (ADR-0012). Never use a course hue as decoration, and never introduce decorative colour where it could be read as data — not on section cards, not on grid blocks, not on conflict, modality, or pin indicators.

---

## Type

Tailwind's steps cover `text-xs` upward. Three sizes are added because the app was expressing them as arbitrary values:

| Token | Size | Use |
|---|---|---|
| `text-nano` | 10px | Dense grid metadata: enrolment label, precise time range |
| `text-micro` | 11px | Labels, badges, captions |
| `text-wordmark` | 21px / 800 / `-0.035em` | The mark, and nothing else |

Below `text-nano`, stop — the app already had 9px text on the grid and it was not readable.

### The wordmark

**The mark is the wordmark.** "Animo Plan", set as type: `text-wordmark`, weight 800, tight tracking. There is no icon, no monogram, and no invented emblem. The green `BookOpen` tile that used to sign the app was a generic stock glyph standing in for a logo and the least distinctive thing on the screen.

The subtitle "Archer's Hub Enlistment Planner" survives, subordinate: `text-micro`, `--color-muted-foreground`, sitting under the mark rather than beside it as a second line of equal weight.

**"Read-only • No credentials stored" stays visible in the header.** It is the app's trust claim (ADR-0001, ADR-0002), not decoration, and it is not a candidate for the icon cull.

---

## Icons

Icon counts were `WeekGrid` 35, `SectionPicker` 33, `PlanWorkspace` 30, `AboutDialog` 26, `SolveDialog` 24. Most of them labelled something the adjacent text already said.

**Drop** an icon that sits beside a word meaning the same thing. A button reading "About" does not need an ℹ; a heading reading "Capture Sections" does not need a glyph. Prefer the word.

**Keep** — and these are not up for negotiation, because hue is already spent on course identity (ADR-0012), which makes these glyphs load-bearing information rather than chrome:

- `Building2` / `Globe` — per-block modality, wherever a schedule block is drawn (ADR-0007)
- `AlertTriangle` — the conflict indicator (ADR-0009)
- `Pin` — pin state wherever it appears without an accompanying word

**Keep** a small number of affordance glyphs that carry meaning no adjacent word does: `ArrowLeft` for back, `ExternalLink` for "this opens outside the app", `ChevronDown` for disclosure, and `X` on an icon-only dismiss control.

Any icon standing alone as a control keeps an accessible name.

The result is judged on the dense surfaces: the week grid and the section list should read as *quieter*, not emptier. Where that landed:

| | Before | After | What survived |
|---|---|---|---|
| `WeekGrid` | 35 | 6 | modality, conflict, pin |
| `SectionPicker` | 33 | 3 | modality, conflict |
| `PlanWorkspace` | 30 | 1 | conflict |
| `AboutDialog` | 26 | 1 | external link |
| `SolveDialog` | 24 | 2 | disclosure chevrons |

Every glyph left on the two dense surfaces is data. That is the test to apply to the next one.

---

## Spacing, radii, elevation

- **Spacing** stays Tailwind's 4px scale. Two rhythm tokens name the distances that were drifting per component: `--spacing-section` (1.5rem, between stacked sections of a screen) and `--spacing-panel` (1.25rem, a panel's inner padding).
- **Radii**, by role, so a control and the panel holding it never disagree: `rounded-control` (6px) · `rounded-card` (10px) · `rounded-panel` (14px).
- **Elevation**, four steps: `shadow-flat` · `shadow-raised` · `shadow-lifted` · `shadow-overlay`. Anything repeated — grid blocks, section cards, plan cards — uses `shadow-flat` or no shadow at all. A shadow on forty elements is paint the app cannot afford.

---

## Motion

`motion` is approved for ticket 33 and only there (`docs/agents/dependencies.md`). The conditions are part of the decision:

- **`LazyMotion` + the `m` component, never the full `motion` component.** Set up once in `src/App.tsx`, with `strict` so a stray `motion.*` fails loudly.
- **`MotionConfig reducedMotion="user"` is the single reduced-motion pattern for JS-driven motion**, set once near the root.
- **No per-element `motion` on repeated elements.** The week grid holds ~40 blocks and the section list ~42 cards. Animate the container, not each child.
- **No persistent layout animation on the grid.** A `layout` prop on every block makes all forty measure on every render.

### What it actually costs

Measured with `npm run build`, which is where this must be re-checked if the motion inventory grows:

| | Initial chunk | Deferred |
|---|---|---|
| Before `motion` | 418.60 kB · **124.61 kB gzip** | — |
| Naive: full barrel, features inlined | 607.78 kB · **189.36 kB gzip** | — |
| Shipped: `motion/react-m` + split features | 459.65 kB · **139.11 kB gzip** | 84.83 kB · 27.87 kB gzip |

So the whole visual pass costs **+14.5 kB gzip before first paint**, with the feature bundle fetched after it. The naive spelling cost +64.75 kB gzip, all of it up front.

Two things make the difference, and both are easy to undo by accident:

- **`import * as m from "motion/react-m"`**, not `import { m } from "motion/react"`. The barrel drags the rest of the library along.
- **The feature bundle is reached through `src/lib/motionFeatures.ts`.** Importing `domMax` from `motion/react` — the same specifier `App.tsx` statically imports `LazyMotion` from — makes Rollup give up: it prints *"dynamic import will not move module into another chunk"* and inlines all 85 kB. That warning line is the canary; if it comes back, the split is gone.

### Durations and easing

`--motion-instant` 90ms · `--motion-quick` 140ms · `--motion-base` 200ms · `--motion-slow` 260ms · `--motion-stagger` 40ms.
`--ease-quiet` for exits and fades, `--ease-enter` for arrivals.

Nothing exceeds 260ms. Motion is allowed to soften a change; it is never something the student waits for.

### Reduced motion — one pattern, two halves

1. The `@media (prefers-reduced-motion: reduce)` block at the bottom of `App.css`, which neutralises every CSS animation and transition.
2. `<MotionConfig reducedMotion="user">` in `App.tsx`, which does the same for everything `motion` drives.

A component reaching for its own `prefers-reduced-motion` handling is a smell, and the guard test fails on it.

### The whole motion inventory

Keeping this list short is the point. Anything added to it should be added here too.

| Where | What | Driven by |
|---|---|---|
| Plan list ↔ plan workspace | Fade and 6px rise on the container, once | CSS `.screen-enter` |
| Dialogs | Overlay fade, panel fade + 8px rise + 0.98 scale | CSS on `[data-state]` |
| Grid context menu | 4px drop, 90ms | CSS `.menu-enter` |
| Solve results | 40ms stagger, capped at 8 steps | CSS `.stagger-rise` + `--stagger-delay` |
| Ambient surfaces | One-shot 520ms fade on arrival, then still | CSS `.ambient-wash` |
| Skeletons | Opacity breathe, only while loading | CSS `.skeleton` |
| Capture counter | The number rises in when a capture lands | `m.span`, one element |
| **Ghost → committed block** | Shared-element handoff on the week grid | `m.div` + `layoutId`, **two elements, transient** |

The ghost handoff is the one animation here that carries meaning rather than polish, and the reason `motion` was approved at all. It is armed only for the section that just landed, for one `--motion-slow`, and then disarmed — so the other blocks are never measuring.

---

## Performance is an acceptance criterion, not an aspiration

This runs in WebView2 on student laptops, during enlistment, often on battery, while a solve burns CPU in Rust and a capture popup is open. Decoration that costs frames is a defect.

- **Animate `transform` and `opacity` only.** Never `width`, `height`, `top`, `left`, or `margin` (layout). Never `filter` or `box-shadow` on a large or repeated surface (paint).
- **No `backdrop-filter` on anything scrolling, repeated, or large.** Frosted glass is fine on a dialog overlay; it is not fine on the section list, the grid, plan cards, the header, or any full-page surface. The guard test allows it in `ui/dialog.tsx` and nowhere else.
- **Nothing loops forever on a large surface.** An idle app has **zero** continuously animating elements. `animate-spin` and `animate-pulse` are banned outright by the guard test — skeletons replace spinners, and the conflict indicator never pulses (ADR-0009: a conflict is shown, not softened).
- **No animation while a solve or a refresh is in flight.** Those are the moments the student is waiting and the machine is busiest, which is exactly why the spinners went.
- **Repeated elements stay cheap.** No per-item transition, no per-item shadow, no per-item filter.
- **Stagger comes from CSS `animation-delay`** — never a chain of `setTimeout`s or per-item JS state.
- **No WebGL and no canvas-driven backgrounds.** CSS gradients and transforms only.

---

## Four structural fixes it is easy to re-break

Every one of these was a real defect, and every one can return via a well-meaning visual change.

1. **`opacity`, `transform`, `filter`, `backdrop-filter`, and `will-change` all create stacking contexts.** That is precisely what trapped the week-grid context menu behind neighbouring blocks (ticket 45). Adding any of them to a grid block, a day column, or a grid ancestor can re-break it. `.ambient-host` deliberately uses `position: relative` with `z-index: auto` for this reason.
2. **`transform`, `filter`, and `backdrop-filter` on an ancestor make it the containing block for `position: fixed` descendants.** The context menu is portalled to `document.body` and positioned `fixed`. Any of those properties on an ancestor of where it mounts silently mis-places it.
3. **The PNG export container keeps ticket 40's shape**: off-screen positioning on the wrapper, the captured node statically positioned. Its guard test must keep passing.
4. **The exported image keeps ticket 44's restraint.** Ambient surfaces do not belong in the PNG, and nothing interactive or animated leaks into it — `ExportMenu` renders its own non-interactive `WeekGrid`.

Ticket 41's keyboard access on grid blocks — focusable, visible focus ring, Enter / Space / Menu / Shift+F10, Escape to close — survives all of it.

---

## Rendering constraint

The suite renders to static markup: no DOM, no effects, no refs, no rAF. **Every component must still render assertable HTML with animation inert.** A surface that renders empty without a browser is not acceptable — `AnimatePresence` wrapped around content the tests assert on is the likely way to break that, so it is not used around asserted content.
