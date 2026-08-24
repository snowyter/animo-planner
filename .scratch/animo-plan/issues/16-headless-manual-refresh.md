# 16 — [headless] Manual refresh, stale-table detection, and missing-section detection

**What to build:** On an explicit request, the app re-runs the searches for the courses already in the plan and updates their enrolment counts, teachers, and remarks. If the session dies partway through, it stops immediately and keeps what it already got. If a section that used to exist has disappeared, that fact is recorded rather than acted on silently.

**Never on a timer, never in the background.** Refresh is always something the student asked for. See `SPEC.md` §4.

The failure mode this ticket exists to prevent: a stale-but-present results table, which would silently write course 5's enrolment counts onto course 6.

**Blocked by:** 08, 10

**Status:** done — merged to main in `27b25a9`

- [ ] Refresh re-selects each course already in the plan, sequentially, roughly 1.5 seconds apart. Only courses in the plan — no catalog walking
- [ ] Each refreshed course appends new snapshots. Previous snapshots remain readable
- [ ] **Validity is asserted by checking that the results table exists AND that the selected course matches the course that was requested.** Never by inspecting the URL. A response failing that check is discarded, not stored
- [ ] Session expiry halts the run immediately and **keeps the partial result** — everything successfully refreshed before the failure stays
- [ ] A halted run exposes enough state to resume from where it stopped rather than starting over
- [ ] A section that was in the plan and no longer appears in its course's results is flagged as missing. **It is not deleted** — silent removal during enlistment week is the worst available failure mode
- [ ] A query returns alternatives for a missing section: other sections of the same course, so ticket 21 can surface them in the banner
- [ ] Refresh does nothing at all when there is no network, and says so, rather than partially failing
- [ ] Tests cover: clean full refresh, a stale table matching a different course being rejected, mid-run expiry keeping the partial result, and a section vanishing being flagged rather than removed
