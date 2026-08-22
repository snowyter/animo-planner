# 14 — [headless] Solver core

**What to build:** Given a plan with some courses chosen and some not, produce conflict-free ways to fill the rest, ranked, without hanging and without blocking the interface. The search is always seeded from the current plan: anything already chosen counts as pinned and the solve fills only the unassigned courses. There is no "solve from scratch" that discards the student's work — starting empty is just the degenerate case of the same operation.

**Full enumeration is not viable** — GEARTAP alone has 42 sections, and seven courses at that scale is roughly 2×10¹¹ combinations. See `SPEC.md` §6.

**Blocked by:** 08

**Status:** ready-for-agent

- [ ] Backtracking search with constraint propagation, in Rust, running off the interface thread so the window never freezes
- [ ] Courses are ordered by fewest remaining valid sections first
- [ ] A partial assignment is pruned the moment a time conflict appears, rather than being completed and then rejected
- [ ] Pinned sections are fixed and never reassigned; the solve fills only unassigned courses
- [ ] The best N results are kept in a bounded heap, so memory does not grow with the search
- [ ] **A node-count cap stops the search and returns what it found**, flagged as partial, with enough state to resume. A pathological input degrades to a partial answer instead of hanging
- [ ] Resuming continues the search rather than restarting it
- [ ] **Every result the solver emits is conflict-free.** Any conflict a plan ends up holding is user-authored via the picker and never a surprise from here
- [ ] Solving a plan with no unassigned courses returns the plan itself, not an error
- [ ] A course with no valid sections yields an explained empty result naming that course, not a silent empty list
- [ ] Tests cover the sample-data plan, a fully pinned plan, a plan with an unsatisfiable course, and a synthetic input large enough to trip the node cap
