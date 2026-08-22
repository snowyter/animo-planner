# 13 — [ui] Section picker and ghost preview

**What to build:** The default way to build a plan. A course-by-course browser lists every captured section for a course with its schedule, modality, room, teacher, and enrolment. Hovering a section ghosts its blocks onto the week grid so the student sees where it would land before committing; clicking adds it to the plan and paints it in.

This is an **entry point, not a mode**. A student who picks by hand can hit "Solve the rest" later, and a student who solved can swap any section here afterwards. See `SPEC.md` §7 (plan surface).

**Blocked by:** 11

**Status:** ready-for-agent

- [ ] Sections are browsed one course at a time, listing every captured section for that course
- [ ] Each row shows the section's schedule blocks, per-block modality, room, teacher, and enrolled-over-cap
- [ ] **Blank teacher displays as unknown**, never as absent or as a dash that reads like a value. A section with no teacher listed is not filtered out or de-emphasised — 42 of 42 GEARTAP sections had a blank teacher
- [ ] `remark` displays verbatim when present, and is never parsed or branched on
- [ ] Hovering a section ghosts its blocks onto the grid; leaving the row clears the ghost
- [ ] Clicking adds the section to the plan and it paints in at full weight
- [ ] **A section that conflicts with what is already in the plan can still be added.** The grid hatches the overlap and the header conflict count increments. Adding is never blocked
- [ ] A section in the plan can be pinned from here, and can be removed
- [ ] The picker and the solver write to the same plan. There is no separate manual-plan state
