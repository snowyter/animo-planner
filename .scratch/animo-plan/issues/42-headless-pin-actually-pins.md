# 42 — [headless] Pinning has no effect on the solver

**What to build:** Make the pin flag mean something. Today the solver holds **every** plan section immovable regardless of pin state, so a student with nothing pinned still gets "no solutions" when their current sections leave no room — and the pin control changes nothing at all.

**Blocked by:** None — can start immediately

**Gates:** 43

## The defect

`begin_solve` builds the solver's fixed input from the plan:

```rust
let fixed: Vec<FixedSection> = detail
    .sections
    .iter()
    .map(|section| FixedSection {
        course_id: section.course_id,
        ...
    })
    .collect();
```

`section.pinned` is never read. `FixedSection` has no `pinned` field. Every plan member is fixed forever — "never reassigned and never dropped", as `solver.rs` documents.

Reported from use: a plan with **nothing pinned** and no solutions. The unpinned sections were still immovable, so there was no room left to fill, and the solve had nothing to report. The student's only recourse is to remove sections by hand and solve again — which is the search they asked the solver to do.

## This is a spec contradiction, not just a bug

Two documents disagree, and the code follows one of them:

- **SPEC §Constraints (v1):** "The solver is always seeded from the current plan: **anything already chosen is treated as pinned**" — this is what is implemented
- **CONTEXT.md:** "**Pin**: Locking a section in a plan so a solve treats it as fixed and fills only around it" — which only says something if an *unpinned* section is treated differently

Under SPEC's rule the pin flag cannot affect a solve, so CONTEXT's definition describes a distinction the system does not make, and the pin control is decorative — a sort key in the picker and a label, nothing more.

**Decided:** CONTEXT's meaning wins, because it is the one a student can act on. SPEC's sentence is what changes.

## The semantics to build

- **Pinned** — fixed. Exactly this section, never moved, never dropped. Unchanged from today
- **Unpinned plan section** — the *course* stays required, the *section* is a starting point. The solver may keep it or swap it for another section of the same course
- **Nothing is ever dropped.** A course in the plan stays in every solution. "Unpinned" means replaceable, never removable — the student added that course on purpose

An empty plan is still the degenerate case of the same operation, and a fully pinned plan behaves exactly as it does today.

## A second defect this exposes

`Store::apply_solution` only ever adds:

```rust
for reference in sections {
    add_section_tx(&tx, plan_id, reference.course_id, reference.section_id)?;
}
```

Nothing is removed. The moment a solution can move an unpinned section, applying it would leave the old section in the plan **alongside** the new one — a self-inflicted conflict, written by the app, into the artifact the student is building. Applying must reconcile the plan to the solution: pinned members untouched, replaced members gone, new members added, in one transaction.

## Acceptance criteria

- [ ] **The solver reads `pinned`.** Pinned members are fixed; unpinned members are candidates for their own course, seeded with what the student already chose
- [ ] **Every course in the plan appears in every solution.** Unpinned means replaceable, never droppable
- [ ] **A solve with nothing pinned can return results where today it returns none** — pin nothing, add sections that leave no room, and get solutions. This is the reported case and it is the test that matters
- [ ] **A fully pinned plan behaves exactly as it does today**, including a pinned section that conflicts with another pinned section surviving the solve untouched (ADR-0009: conflicts are displayed, never prevented — the solver does not get to resolve them by force)
- [ ] **Keeping the student's existing choice is preferred** where it costs nothing. A solve that reshuffles sections it had no reason to move is worse than one that leaves them alone, even at an identical score
- [ ] **Applying a solution reconciles rather than accumulates.** Pinned untouched, replaced removed, new added, one transaction, no duplicate course membership possible
- [ ] **Pin state survives a solve.** Applying a solution does not silently pin or unpin anything; a section the student pinned is still pinned afterwards
- [ ] **`exclude_full` still cannot touch a plan section** (ticket 34): a full section the student chose is theirs. But an *unpinned* full section may now be swapped for one with seats — decide which wins, state it in the ticket's commit, and test it. This is the one place ticket 34 and this ticket genuinely interact
- [ ] The unsatisfiable reason (ticket 34) stays honest under the new semantics — "no valid section" must not be reported for a course that only failed because a pinned neighbour blocked it
- [ ] **SPEC.md is corrected** in the same commit. The "anything already chosen is treated as pinned" sentence is now false; CONTEXT.md's definition stands and does not change
- [ ] Tests cover: an unpinned section swapped to make an otherwise unsatisfiable plan solvable, a pinned section never moved, every plan course present in every solution, apply reconciling a replacement without duplication, pin state surviving apply, and the fully-pinned plan unchanged

## Worth knowing before starting

The solve is chunked and resumable — `Solver::from_token`, `continue_solve`. Whatever carries pin state into the search must survive serialization into a resume token, or a resumed chunk will silently revert to today's behaviour halfway through a solve. That failure would be invisible in a short test and obvious to a student with a large plan.

`SolutionSection` currently hardcodes `pinned: false` for placed sections. Check what that field is for and whether it is now lying.
