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
| Drag-and-drop for the teacher ranking | `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities` | 49 |

**`motion` is approved for ticket 33 and only there** — decided by a human, who asked for an app that
feels modern *and* lightweight. Both halves are the decision. It must be used as `LazyMotion` plus the
`m` component rather than the full `motion` component, so the whole feature set is not shipped to load
a fade; `MotionConfig reducedMotion="user"` is the single reduced-motion pattern; and it must not put a
per-element animation on repeated elements — the week grid holds ~40 blocks and the section list ~42
cards. A later ticket wanting it elsewhere is a new question, not a precedent.

**`@dnd-kit/core` + `@dnd-kit/sortable` + `@dnd-kit/utilities` are approved for ticket 49 and only there.** The teacher
ranking is one list read in three zones, and dragging between them is the whole gesture vocabulary of
the surface — including demoting an avoided teacher back to neutral, which has to cost one move.
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

## Two decisions that are NOT pre-approved

Stop and ask on both of these — they are architecture, not plumbing.

**SQLite access — RESOLVED in ticket 05.** `SPEC.md` §5 names `tauri-plugin-sql`, but that plugin is designed to expose SQL to the *frontend*, whereas ADR-0006 and the ticket breakdown put all storage behind Rust commands with Rust-side migrations and tests. Decided by a human in ticket 05: **`rusqlite` (bundled)**, Rust-owned storage, no SQL ever crosses IPC. See ADR-0015. Do not reintroduce the plugin without a new decision.

**Anything that touches the capture path.** No dependency may be added to the injected script or the popup webview without asking. ADR-0003 constrains that boundary deliberately.
