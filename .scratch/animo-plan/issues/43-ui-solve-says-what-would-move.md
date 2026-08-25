# 43 — [ui] A solution says which of your sections it would move

**What to build:** Once ticket 42 lets a solve replace unpinned sections, applying a solution can change choices the student already made. The solve dialog must say so before they apply, and the picker must make pinning discoverable enough to prevent it.

**Blocked by:** 42

## Why this is not optional

Before ticket 42, applying a solution could only add. After it, applying can silently swap the section a student deliberately chose for a different one of the same course. That is the single most surprising thing this app could do to the artifact the student is building, and a score alone does not warn them.

## Acceptance criteria

- [ ] **Each solution says what it would change** to the plan as it stands: how many sections stay, how many move, and which. A solution that changes nothing says that too — that is reassurance, not an empty state
- [ ] **A moved section is visible in the result, not only in a count** — the student can see it is being moved from their section to another one before applying
- [ ] **Pinned sections are visibly exempt** in the solve dialog, so the relationship between pinning and what survives is legible at the moment it matters
- [ ] The apply action makes the consequence plain at the point of clicking. No modal interrogation — one honest sentence beats a confirmation dialog nobody reads
- [ ] **Pinning is reachable from the solve dialog or clearly signposted from it.** A student who reads "this would move 3 of your sections" needs somewhere to go; sending them back to the picker to hunt for pins is the wrong answer
- [ ] Ranked results stay readable — this adds information to each result and must not turn a scannable list into a wall (ticket 33 covers the visual pass; do not pre-empt it here)
- [ ] Nothing here changes what a solve computes. Presentation only
- [ ] Tests cover: a solution that moves nothing, one that moves several, pinned sections shown as exempt, and the moved-section detail rendering

## Worth knowing before starting

The suite renders to static markup, so drive dialog and result state from props rather than effects.

Whether the "what would move" comparison is computed in the frontend from the plan and the solution, or returned by the solver, is ticket 42's call to make — check what it landed before building against a shape that does not exist.
