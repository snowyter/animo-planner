# 21 — [ui] Refresh, expiry recovery, and the missing-section banner

**What to build:** A student can refresh their plan's enrolment numbers and watch it happen course by course. If their session expired partway, they see exactly that, keep everything already refreshed, and continue with one click. If a section they were counting on has disappeared from the catalog, a banner says so by name and shows them what else is available.

See `SPEC.md` §4 (refresh, session expiry) and §5 (sections are never hard-deleted).

**Blocked by:** 12, 13, 16

**Status:** done — merged to main in `380648f`

- [ ] Refresh is an explicit control on the plan. There is no automatic or scheduled refresh anywhere in the interface
- [ ] Progress shows which course is being refreshed and how many remain
- [ ] Updated enrolment counts appear on the grid and in the picker as they land
- [ ] Session expiry shows **"Session expired — sign in to continue"** with a **Resume** button, and the partial result stays on screen — nothing already refreshed is rolled back or hidden
- [ ] Resume continues from where the run stopped
- [ ] A section in the plan that has gone missing raises a **persistent banner naming it**, which does not auto-dismiss
- [ ] That banner surfaces the section's alternatives — other sections of the same course — so the student can act rather than just be informed
- [ ] The missing section stays visible in the plan and on the grid, marked as missing. It is never silently removed
- [ ] Refreshing with no network says so plainly and changes nothing
