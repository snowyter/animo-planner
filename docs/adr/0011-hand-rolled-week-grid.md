# The week grid is hand-rolled, not a calendar library

The Mon–Sat week grid is a CSS grid with absolutely positioned blocks, written and owned in this repo — roughly 150 lines. No calendar or scheduler library.

This looks like reinvention and is not. The grid's three defining behaviours are overlap highlighting, ghost previews of a candidate section on hover, and per-block modality badges. Calendar libraries fight all three: they own the overlap layout algorithm, they have no concept of a block that is not yet committed, and they style events as opaque units. Adapting one costs more than owning 150 lines, and the escape hatch is worse than the build.

## Consequences

- The grid is Mon–**Sat**, six columns — the observed day pairs include WED/SAT, so a Mon–Fri assumption anywhere is a bug.
- Blocks position by actual start and end time rather than by lattice row index, so a section off the seven-slot lattice still renders correctly.
