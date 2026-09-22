# 07 — How does dark mode work, and where does Appearance live?

Type: grilling
Lane: HITL
Status: open
Blocked by: 04
Map: [map.md](../map.md)

## Question

Dark mode is in (map Notes): System / Light / Dark, default System, neutral graphite with Archer Green accent. Pin down what the implementation tickets need:

- **Tokens.** The dark values for every token in `src/App.css` (`background`, `card`, `foreground`, `muted-foreground`, `border`, `primary`, elevation, the ambient wash), with contrast checked to the same bar `docs/design-system.md` sets for light. Whether Archer Green `#15803d` needs a lighter dark-mode variant to hold 3:1 / 4.5:1.
- **Course hues.** A second palette for `src/core/palette.ts` under ADR-0012: same number of hues, still distinguishable from each other, still legible text on each, conflict hatch and ghost still readable.
- **Mechanism.** Tailwind v4 dark variant by class/attribute rather than `prefers-color-scheme` alone, so the manual override works; how System follows the OS live; where the preference persists (local only, ADR-0004); no flash of the wrong theme at startup in Tauri.
- **Guards.** How `src/designSystem.test.ts` and `src/core/palette.test.ts` change — today they fail on any `dark:` variant.
- **The export.** Whether PNG export always renders light (ticket 44's restraint) regardless of theme.
- **Appearance's home.** The app has no settings surface; decide where the control lives (About, a settings sheet, the header) consistent with ticket 05's destinations.
- **The ADR.** Draft the ADR superseding ADR-0018.
