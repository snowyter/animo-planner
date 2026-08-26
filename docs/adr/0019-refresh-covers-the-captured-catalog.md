# Refresh covers every captured course in scope, not only the plan's

A refresh re-runs **every course captured under the plan's `(campus, session)`**, with the courses already in the plan going first. It previously re-ran only the courses that had a section in the plan.

Refreshing the plan alone refreshed the numbers a student had already decided about and left stale exactly the ones they were still deciding with. The picker shows `enrolled/cap` on every candidate section; `exclude-full` solves against those same numbers and reports how old they are. With a plan holding one section, "Refresh" touched one course out of six captured, and the other five kept whatever count they happened to be captured with — while looking equally live.

Plan courses go first because a run can halt part-way on an expired session and keep its partial result (SPEC §4). Ordering that way means a halt takes the candidates, not the commitments.

This is not a catalog walk. The dropdown holds 2,300 courses and none of them are touched; a refresh re-runs only what the student already searched for, and only inside the one scope the plan is hard-scoped to. The cost is one sequential selection per captured course at ~1.5 s apart — a student with six captured courses waits about nine seconds instead of about two.

## Consequences

- `Store::refresh_courses` returns every course in the plan's scope. Courses with no plan membership carry an empty `plan_section_ids`, so nothing of theirs can be flagged missing (ADR-0008).
- A plan with no sections still refreshes — that is the case where candidate numbers matter most.
- Refresh time grows with the captured catalog rather than with the plan. If that becomes uncomfortable, the answer is a way to forget captured courses (which already exists) or a scope control on the refresh itself — not narrowing it back to the plan.
- Still explicit, still read-only, still never on a timer (ADR-0001, SPEC §4).
