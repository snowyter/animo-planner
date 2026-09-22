# 04 — Which visual direction does Animo Plan take?

Type: prototype
Lane: HITL
Status: resolved
Blocked by: 01, 02
Map: [map.md](../map.md)

## Question

What does calm, card-based, iOS/macOS-feeling Animo Plan look like — concretely enough that every later ticket builds on one picture?

Make **two or three** throwaway static comps (use `prototype` and `impeccable`) of the same two screens, each in **light and dark**:

1. The **plan list** with three plans, and its empty state.
2. The **plan workspace** at 1400×900: title bar/header (per ticket 01's answer), the next-step card, the tool panel with a few section cards (fill bar, modality, conflict), and the week grid with a realistic ~40-block week.

Candidate directions to differentiate the comps: *iOS Settings-calm* (grouped inset lists, large titles, lots of air), *macOS glass* (translucent chrome, sidebar, vibrancy), *bold cards* (a board of rich cards with depth). Use Inter per ticket 02, real-looking DLSU data (course codes, sections, `Building2`/`Globe` modality), Archer Green as the accent, and the map's adopted principles.

The human picks one (or a blend) and reacts to it. Record the chosen direction, the rejected ones and why, and the specific traits to carry forward (radii, depth, material, density, type scale). Link the comps as assets; do not paste them in.

## Answer

**Direction D, "Glass + cards": B's macOS shell wearing C's cards.** Comps: branch `prototype/visual-direction`, file `docs/prototypes/visual-direction.html` (open with `?variant=d`; commit `fc36eda`, local only). All four directions (A–D) stay switchable there, in light and dark, on the plan list, its empty state, and the workspace.

- **The shell (from B).** A 236px source-list sidebar holds the plans and, inside a plan, its courses: hue dot, code, and section, plus a conflict glyph. It **collapses** with a macOS-style toggle beside the wordmark. Collapsed, the toggle moves to the start of the toolbar, "Read-only • No credentials stored" moves into the toolbar, and the grid gains the sidebar's width. A 52px unified toolbar is the one glass surface (`backdrop-filter` on fixed chrome, per the map's Notes). It carries the plan name, campus, term, and freshness, then Refresh · Export · Archer's Hub, then the Windows caption buttons (ticket 01). Capture / Solve / Pick live in a 344px tools panel on the right.
- **The cards (from C).**
  - **Plan list:** cards with a large week-shape thumbnail, the plan name, and stat chips (courses, conflicts, campus days).
  - **Empty state:** one card with three numbered steps and Create Plan.
  - **Section cards:** code and professor, an In plan / Choose / Full pill, chips for day, time, and room, a remark, the neutral fill bar, and a bold conflict line. The section being previewed gets an outline.
  - **Workspace:** the week sits on one raised card whose header carries stat chips and Clear. The next-step card is a compact green strip above it: title, body, a "Then:" line, and one white action.
- **No dock.** The sidebar already moves between plans, so C's floating dock would be a second way to do the same thing.
- **Rejected.**
  - **A (iOS Settings-calm):** the least dense of the four, which is wrong for enlistment night.
  - **B alone:** plain list rows lack card structure, and the glass is invisible with nothing scrolling under it.
  - **C alone:** the dock duplicates navigation, and the big hero card eats the grid's height. Its plan list and empty state were kept.
  - **The "cleaner D" pass (commit `99d6eb4`):** it turned chips and pills into plain text and the next-step strip into a white card. The human found it *more* overwhelming, so it was reverted except for the sidebar toggle. **"Clean" in this app keeps card structure. Chips and pills are what make a card scannable, and implementation tickets must not strip them in the name of calm.**
- **Traits to carry forward.**
  - **Material:** a neutral grey ground (light `#eceef1`; dark graphite `#141416`) with white cards (dark `#1f1f22`). The sidebar and tools panel are a half-step off the ground. Glass only on the toolbar. No green tint on any base.
  - **Radii:** plan and empty cards 18 · week card 16 · next-step strip 14 · section cards 12 · buttons 9–10 · chips 8 · grid blocks 7 · sidebar rows 6 · pills fully round.
  - **Depth:** one lift shadow on top-level cards (week, plan, empty, next-step). Repeated section cards get a 1px hairline ring, and only the previewed one gets a shadow. **Grid blocks stay flat.**
  - **Density:** macOS-scale type, 13px base. Headings at weight 750–800 with tight tracking: Plans 30 · plan name 19 · This week 18 · section code 15. Sentence-case 11px/600 group headings, no ALL CAPS. Tabular numerals on times and counts.
  - **Accent:** Archer Green `#15803d` in light; in dark, `#1f8a48` for fills and `#5fcf8a` for text. It marks the selected sidebar row, the primary action, the In plan state, and the next-step strip (`#15803d` / `#17693a`). Red is kept for conflict and Clear.
- **Surfaced for later tickets.**
  - The sidebar's default state (open or closed when a plan opens), and what folds at the 1024 minimum width: sidebar, tools panel, or both. **→ 05.**
  - The collapse motion. **→ 08.**
  - The dark course hues in the comps are a first draft. **→ 07.**
  - The two blocks of a conflict pair truncate their labels at 1400px with the sidebar open. The implementing ticket must check them at 1024.
- **Not met.** The ticket asked for a ~40-block week. The comps carry 17 blocks — a realistic full term — because 40 fills nearly every lattice slot.
