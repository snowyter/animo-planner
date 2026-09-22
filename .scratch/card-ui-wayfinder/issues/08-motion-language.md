# 08 — What is Animo Plan's motion language?

Type: grilling
Lane: HITL
Status: open
Blocked by: 03, 04
Map: [map.md](../map.md)

## Question

With the rules reopened (map Notes) and the facts from ticket 03, decide the motion language the implementation tickets apply:

- **Presets.** A small named set of springs (e.g. *snappy* for controls, *smooth* for panels and sheets, *gentle* for arrivals) with their parameters, mirrored in `src/core/motion.ts` and tested there.
- **The inventory.** Rewrite `docs/design-system.md`'s motion inventory: for every surface in the ticket-04 direction — screen push/pop between plan list and workspace, the tool panel fold, tab/segment switch, sheets, popovers and menus, cards on hover/press, the next-step card's arrival and exit, the sidebar collapsing and expanding (ticket 04) without animating the grid's layout, solve results, the course board, the ghost handoff — what moves, which preset, CSS or `motion`.
- **What never moves.** Re-affirm or amend the three refusals (conflicts never animate; grid lattice/columns/root never animate; the panel slides rather than grows) and the zero-idle / nothing-mid-solve rules.
- **The paperwork.** The amendment to `docs/agents/dependencies.md` widening `motion` beyond ticket 33, with its conditions, and the matching change to `src/designSystem.test.ts`'s guards.
- **Carried from ticket 03.** (a) The rule settled at charting is "nothing waited on exceeds ~450ms"; the 0.3 s presets come fully to rest at ≈430 ms — confirm that fits, and that the old 260ms cap is formally retired. (b) Whether the grid's ghost handoff needs `layoutScroll` on the scrolling lattice — verify in the running app. (c) Whether a guard test replaces the Rollup warning as the check that the lazy feature split holds, since the warning misses a bare `import("motion/react")`.
