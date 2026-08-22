# 20 — [ui] Solve the rest

**What to build:** From any plan — empty, half-built, or fully hand-picked — the student hits "Solve the rest" and gets ranked conflict-free ways to fill the courses they have not chosen yet. Results show as small week-grid thumbnails they can scan side by side, each with its score broken down. Applying one writes into the same plan they were already editing.

**This is an entry point, never a mode.** A student who solved can still swap sections by hand afterwards; a student who picked by hand can solve the remainder. Locking either in would recreate the two divergent schedule-building UIs the design exists to avoid. See `SPEC.md` §6 and §7.

**Blocked by:** 13, 15

**Status:** ready-for-agent

- [ ] "Solve the rest" is reachable from the plan at any point, including from a plan with nothing chosen and from a plan that is nearly complete
- [ ] Anything already in the plan is treated as pinned and comes back unchanged in every result
- [ ] The three presets are the primary control. Constraint inputs — day blacklist, earliest start, latest end, exclude full — are available but secondary
- [ ] Results render as compact week-grid thumbnails, sorted by score, using the same visual encoding as the full grid
- [ ] Each result shows its score breakdown, so the ranking is legible rather than magic
- [ ] Advisory warnings show on the results that carry them, and never remove a result from the list
- [ ] A partial answer from the node cap is labelled as partial and offers **"Keep searching"**, which extends rather than restarts
- [ ] Applying a result writes to the same plan the student was editing, and every section stays individually swappable and unpinnable afterwards
- [ ] The window stays responsive while a solve runs, with a way to cancel
- [ ] An empty result names the course that could not be satisfied rather than showing a bare "no results"
