# 15 — [headless] Solver constraints, scoring, presets, and transition warnings

**What to build:** The solver becomes useful rather than merely correct. A student can rule out days, set an earliest start and latest end, skip full sections, and ask for schedules that minimise trips to campus. Results come back scored under one of three named presets with a visible breakdown of why each scored what it did, plus advisory warnings about transitions that are technically legal but miserable in practice.

Constraints filter. Warnings do not — they are advice attached to a result, never a reason to discard it. See `SPEC.md` §6.

**Blocked by:** 14

**Status:** ready-for-agent

- [ ] Day blacklist: a student can exclude one or more days and no result places a block there
- [ ] Earliest-start and latest-end bounds are respected across all blocks
- [ ] Exclude-full drops sections at or over capacity, and is off by default
- [ ] Minimise-campus-days counts days with at least one F2F block, computed per block rather than per section — a hybrid section only puts the student on campus on its F2F day
- [ ] No-lone-F2F-day penalises a day whose only campus commitment is a single 90-minute class
- [ ] The three presets — fewest campus days, no early mornings, most online — each produce a score, and each result carries a breakdown a student can read to understand its ranking. Advanced weight sliders are explicitly **out of scope for v1**
- [ ] **F2F-to-Online back-to-back** raises an advisory warning: 15 minutes, and nowhere to sit and connect
- [ ] **F2F-to-F2F back-to-back in different buildings** raises an advisory warning, derived from the room code prefix
- [ ] Warnings are attached to results and to the current plan alike, and never filter anything out
- [ ] Warnings are computed in the same pass as scoring, not by a second walk over the assignment
- [ ] **Section-code prefixes are not used for eligibility filtering.** They may encode college eligibility, and that is deliberately deferred past v1
- [ ] A blank teacher is never treated as a mismatch by any constraint — professor filters are v1.1 and must not leak in here
- [ ] Tests assert each constraint independently and in combination, and assert that a warning never removes a result
