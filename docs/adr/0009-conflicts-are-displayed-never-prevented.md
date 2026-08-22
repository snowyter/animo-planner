# Conflicts are computed and displayed, never prevented

Plan membership carries no validity constraint. A student can add a section that overlaps something already in their plan, and the app will let them — rendering the overlap hatched with a persistent conflict count in the plan header.

Blocking the add would be the obvious guardrail and it is wrong. The common move is placing a must-have section first and then seeing what it costs; a student needs to look at the collision to decide which side gives. Enforcing conflict-freedom at write time turns that into a fight with the tool.

## Consequences

- Conflict is a query over a plan, not a constraint on the table.
- The solver only ever emits conflict-free sets, so any conflict present in a plan is user-authored and never a surprise from the tool.
