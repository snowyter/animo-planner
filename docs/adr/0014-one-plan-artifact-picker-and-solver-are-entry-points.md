# One plan artifact; the picker and the solver are entry points, not modes

There is one plan object, edited two ways. The course-by-course section picker and the solver both write to the same plan membership. Choosing "pick my own sections" or "let the solver build it" on starting a plan selects an **entry point**, and nothing about that choice persists.

A student who picked by hand can hit "solve the rest" at any point and get the remaining courses filled around their choices. A student who solved can swap any section by hand afterwards. Making the fork a mode would recreate the two divergent schedule-building UIs this design exists to avoid — and pinning is already manual picking under another name, so the two paths were never actually separate.

## Consequences

- The solver is always seeded from the current plan: anything already chosen is treated as pinned, and the solve fills only unassigned courses.
- There is no "solve from scratch" that discards existing work. Starting empty is the degenerate case of the same operation.
