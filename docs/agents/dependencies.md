# Pre-approved dependencies

`AGENTS.md` says "no new dependencies without asking". The packages below are **already approved** — add them when your ticket needs them, without stopping to ask. Anything not on this list still needs a question first.

Add a dependency only in the ticket that actually uses it. Do not pre-install the whole list.

## Rust (`src-tauri/Cargo.toml`)

| Need | Crate | Ticket |
|---|---|---|
| Auto-updater, behind a Cargo feature flag | `tauri-plugin-updater` | 03 |
| HTML parsing for the section parser | `scraper` | 04 |
| Date parsing for section start/end dates | `chrono` | 04 |
| Loopback HTTP listener | `axum` (with `tokio`) | 09 |
| Per-launch bearer token generation | `rand` | 09 |
| Fetching the remote selector config | `reqwest` (rustls, not native-tls) | 18 |
| Calendar file generation | `icalendar` | 17 |

Test-only crates (`[dev-dependencies]`) are pre-approved without listing — `tempfile`, `insta`, `pretty_assertions`, and similar.

## Frontend (`package.json`)

The scaffold shipped React + Vite only. `SPEC.md` §7 calls for **Tailwind + shadcn/ui**, and neither is installed yet.

| Need | Package | Ticket |
|---|---|---|
| Styling | `tailwindcss`, `@tailwindcss/vite` | 06 |
| shadcn/ui component prerequisites | `clsx`, `tailwind-merge`, `class-variance-authority`, `lucide-react` | 06 |
| Radix primitives behind individual shadcn components | `@radix-ui/react-*`, as each copied component requires | 06+ |
| PNG export of the week grid | `html-to-image` | 22 |
| Animation for the visual revision | `motion` | 33 |
| Drag-and-drop for the professor ranking | `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities` | 49 |

**`motion` is approved for ticket 33 and only there** — decided by a human, who asked for an app that
feels modern *and* lightweight. Both halves are the decision. It must be used as `LazyMotion` plus the
`m` component rather than the full `motion` component, so the whole feature set is not shipped to load
a fade; `MotionConfig reducedMotion="user"` is the single reduced-motion pattern; and it must not put a
per-element animation on repeated elements — the week grid holds ~40 blocks and the section list ~42
cards. A later ticket wanting it elsewhere is a new question, not a precedent.

**`@dnd-kit/core` + `@dnd-kit/sortable` + `@dnd-kit/utilities` are approved for ticket 49 and only there.** The professor
ranking is one list read in three zones, and dragging between them is the whole gesture vocabulary of
the surface — including demoting an avoided professor back to neutral, which has to cost one move.
dnd-kit animates with its own CSS transforms, which is what makes the drag both smooth and cheap, so
**`motion` must not be used here**: it is approved for ticket 33 alone. Three conditions come with the
approval. The **keyboard sensor is wired and is a first-class path**, not a fallback, with correct
list roles and a live region announcing every move. **Reduced motion stays handled once at the root**
— dnd-kit's inline transition is a `transition-duration`, which `App.css` already overrides, and no
component may reach for `prefers-reduced-motion` itself. And the **drag transform stays on the row**:
a `transform` on an ancestor of the workspace becomes the containing block for the week grid's
`position: fixed` context menu, which is the bug tickets 41 and 45 both were. A later ticket wanting
dnd-kit elsewhere is a new question, not a precedent.

**shadcn components are copied into the repo, not pulled at runtime** (`SPEC.md` §7). Ticket 06 sets up Tailwind and the shadcn init; later UI tickets copy in only the components they use.

## React Bits — resolved: source-in, no dependency, CSS-only tier

[Raised in ticket 33](../../.scratch/animo-plan/issues/33-ui-visual-revision.md) as a possible source, and decided by a human:

**There is no npm package to install.** `react-bits` on npm is an unrelated, abandoned React Native
library (last published 2022; depends on `react-native` and `react-timer-mixin`). React Bits
(reactbits.dev, `DavidHDev/react-bits`) distributes through a shadcn-style **registry** — components
are copied into the repo, and the vendored files are the dependency. So "install it" is not an
available option; "copy it in" is.

**Its licence is MIT + Commons Clause, not MIT** (`LICENSE.md` in that repo). The Commons Clause
forbids redistributing the components "alone, in a bundle, or as a ported version." This repo is MIT
(ADR-0005: public source is the trust model). A human accepted that the two sit alongside each other.
In practice this constrains *use*, not distribution:

- Copy only **individual components**, never the collection — bundling the library is what the clause restricts.
- Keep each vendored file's **attribution and licence header intact**.
- Prefer **CSS-only** components. Of the 170 in the registry, 107 pull in GSAP or WebGL.

**Tiers, as measured against the registry:**

| Tier | Count | Verdict |
|---|---|---|
| WebGL / canvas (`ogl`, `three`, `OGL`) | ~60 | **Ruled out.** No canvas, no WebGL, and a looping background fails the idle-app rule on its own (ticket 33). |
| GSAP-based | ~47 | **Ruled out.** GSAP is ~70 kB on top of the `motion` bundle ticket 33 tuned to +14.5 kB gzip, for effects CSS already covers. |
| `motion`-based | ~16 | **Ruled out by the guard test.** They import `motion/react` and render `motion.span`, which `src/designSystem.test.ts` bans in favour of `m`, and would re-inflate the initial chunk. |
| CSS-only | ~11 | **Open.** No dependency, no bundle cost. |

The CSS-only shortlist, checked against this repo's guard tests: `SpotlightCard`, `Magnet`,
`ReflectiveCard`, `BorderGlow`, `GlareHover`, `Folder`, `GooeyNav`, `LineSidebar`, `GlitchText`.
Rejected from the CSS-only tier for cause: `GradualBlur` / `GlassIcons` / `ProfileCard`
(`backdrop-filter`), `StarBorder` / `GlitchText` (`infinite` loops — an idle app has zero), and
`PixelSwap` / `InfiniteSpiral` / `LogoLoop` / `MaskedHeading` / `EchoText` / `DepthText` (per-component
`prefers-reduced-motion`, which must stay handled once at the root).

Even an approved component is **not** dropped in as-is: its dark-by-default neutrals, its durations,
and its `will-change` are all rewritten to this repo's tokens before it lands.

A later ticket wanting the GSAP or WebGL tier is a new question, not a precedent.

## Two decisions that are NOT pre-approved

Stop and ask on both of these — they are architecture, not plumbing.

**SQLite access — RESOLVED in ticket 05.** `SPEC.md` §5 names `tauri-plugin-sql`, but that plugin is designed to expose SQL to the *frontend*, whereas ADR-0006 and the ticket breakdown put all storage behind Rust commands with Rust-side migrations and tests. Decided by a human in ticket 05: **`rusqlite` (bundled)**, Rust-owned storage, no SQL ever crosses IPC. See ADR-0015. Do not reintroduce the plugin without a new decision.

**Anything that touches the capture path.** No dependency may be added to the injected script or the popup webview without asking. ADR-0003 constrains that boundary deliberately.
