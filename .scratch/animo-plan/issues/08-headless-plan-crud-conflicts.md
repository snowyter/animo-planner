# 08 — [headless] Plan membership and conflict computation

**What to build:** A student can add a section to a plan, remove it, and pin it, and can ask the plan which of its sections overlap in time. Conflict is something the plan reports, never something it refuses.

The plan is the single artifact that both the manual picker and the solver write to. There are not two schedule-building data paths.

See `SPEC.md` §5 (rules) and §7 (conflicts are displayed, never prevented).

**Blocked by:** 05

**Status:** done — merged to main in `9e90ab4`

- [ ] Sections can be added to and removed from a plan, and the membership survives a restart
- [ ] A section in a plan can be pinned and unpinned, and pinned state persists
- [ ] **A plan may legally hold conflicting sections.** Plan membership carries no validity constraint — adding an overlapping section succeeds. The common move is placing a must-have section first and then seeing what it costs
- [ ] A query returns the overlapping block pairs in a plan, identifying which two sections clash and on which day and time range
- [ ] Conflict detection works on schedule blocks, not on sections, so a hybrid section conflicts only on the day that actually overlaps
- [ ] Adding a section from a different `(campus, session)` than the plan is rejected
- [ ] Tests cover: no conflict, two sections overlapping on one day of two, back-to-back blocks that touch but do not overlap being reported as clear, and a section conflicting with itself being impossible
