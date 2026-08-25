# 34 — [headless] The solver stops offering sections that are already full

**What to build:** A section at capacity cannot be enlisted in, so the solver must not build schedules around one. `excludeFull` already exists as a constraint (ticket 15); this ticket makes it the default and makes sure the student is told when it changes the answer.

**Blocked by:** None — can start immediately

**Status:** ready-for-agent

## Why this is not just a default flip

`enrolled` and `enrollCap` come from the latest snapshot, which is only as fresh as the last capture or refresh. A section that was full an hour ago may not be now, and one that had a seat may not any more. Excluding silently on stale numbers hands the student a schedule that is wrong in the other direction — and this is the app they are looking at while enlistment is open.

So the exclusion has to be visible and reversible, never quiet.

## Acceptance criteria

- [ ] **`excludeFull` defaults to on** for a new solve. The student can still turn it off in secondary constraints
- [ ] A section counts as full when `enrolled >= enrollCap` on its latest snapshot. **A missing or unreadable count is not full** — unknown is never treated as a closed door
- [ ] When exclusion removes every section of a course, the course comes back in the **existing unsatisfiable-course result** naming that reason, so "no solutions" never appears without saying why
- [ ] The solve result reports **how many sections were excluded as full**, and the dialog surfaces it, so the student can see the constraint is doing something and turn it off if the numbers look stale
- [ ] The result carries **how old the enrolment numbers are** — the latest snapshot's timestamp for the plan's scope — near the exclusion notice. A student deciding whether to trust an exclusion needs to know if it is five minutes or five days old
- [ ] Sections **already in the plan are never excluded**, full or not. They are the student's own choices and the solver treats them as fixed (ticket 14)
- [ ] Pinned sections are likewise never excluded
- [ ] Tests cover: a full section left out of every solution, `enrolled >= enrollCap` as the boundary (equal is full), an unknown count *not* excluded, a course whose sections are all full reported as unsatisfiable with the reason, a plan section at capacity surviving, and the exclusion count reaching the result
