# 35 — [headless] Removing a captured course takes its sections out of plans

**What to build:** `forget_course` stops refusing when a plan holds one of the course's sections, and removes those sections from the plans instead — with the student told exactly what that will do before it happens.

**Blocked by:** None — can start immediately

**Gates:** 36

**Status:** ready-for-agent

## What changes and why

Ticket 29 made the removal refuse and name the holding plans, on the reasoning that silently editing a plan is a surprise in the most expensive place. That reasoning was right about the *silently* and wrong about the *refusing*: the student now has to hunt down each section in each plan and remove it by hand before the course will go, which is busywork the app can do for them.

**The surprise is what has to be designed out, not the capability.** The refusal is replaced by a confirmation that states the consequence in advance.

## Acceptance criteria

- [ ] `forget_course` **removes the course's sections from every plan holding them**, then removes the course, its sections, blocks, and snapshots, in one transaction. A failure part-way leaves everything as it was
- [ ] `StoreError::CourseHeldByPlans` and its refusal path are **removed**, along with the UI notice that renders it (ticket 30). Nothing should still be telling the student to go and do this by hand
- [ ] The command **reports which plans were affected and how many sections each lost**, so the UI can say so afterwards rather than leaving the student to discover it
- [ ] A **pinned** section is removed like any other, since the course it belongs to is going. Pinning protects a section from the solver, not from a removal the student asked for
- [ ] **Only the named course's sections leave a plan.** Everything else in that plan is untouched, including its other sections, its name, and its scope
- [ ] Removing a course no plan holds behaves exactly as it does today
- [ ] Plans left with no sections are **still plans** — never deleted as a side effect (ADR-0008's spirit; deleting a plan is its own explicit act)
- [ ] Tests cover: a course held by two plans removed from both, other sections in those plans surviving, a pinned section going with the rest, the affected-plan report being accurate, a plan emptied but not deleted, and the whole thing rolling back on failure
