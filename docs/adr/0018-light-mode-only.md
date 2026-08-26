# The app commits to light mode only

Animo Plan renders one theme. There is no dark mode, no theme toggle, and no `dark:` variant anywhere in `src/`.

Dark mode was never chosen; it leaked. `src/core/palette.ts` and `WeekGrid.tsx` carried `dark:` variants, Tailwind v4's default dark strategy is `prefers-color-scheme`, and no config overrode it — so a student running Windows in dark mode got dark grid blocks sitting inside an app whose `body` was hardcoded light. That is a live bug, not a half-finished feature.

Deciding light-only fixes the bug now and leaves the eventual dark-mode ticket a known state to start from. A real dark mode is its own piece of work: every surface audited, a second course-hue palette designed under ADR-0012, and contrast re-checked for all of it. It is not a rider on a visual pass.

## Consequences

- The course palette in `src/core/palette.ts` defines one set of classes. `src/core/palette.test.ts` asserts no `dark:` variant is present.
- `src/designSystem.test.ts` fails if a `dark:` variant reappears anywhere under `src/`.
- Contrast is verified against one background stack only: `--color-background` for the page, `--color-card` for panels.
- A future dark mode adds a second palette and re-audits every surface. It does not simply re-add the variants removed here.
