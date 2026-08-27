# Avoiding a teacher is a hard filter, not a penalty

A student can mark a teacher as avoided for one course, and the solver drops every candidate section that teacher is listed on — the same mechanism as `day_blacklist` and `exclude_full`, not a weight added to the score.

This reads as a contradiction of ADR-0009, which forbids the app from preventing anything, and the distinction is worth stating so nobody "fixes" one of the two. ADR-0009 governs a *plan the student built*: a conflict already on the grid is a fact about their choices, and hiding or blocking it takes away the comparison they need. Avoid governs *candidates the solver proposes*: it is the student describing what they want offered, before anything exists to look at. Constraints filter what gets suggested; reports never hide what got chosen. The two never meet, because a plan section the student put there by hand is not a candidate.

The rejected alternative was a large negative weight, which keeps every schedule reachable and lets an avoided teacher through when nothing better exists. That is the wrong failure: "I will not take this class from this person" is a statement about acceptability, not desirability, and a solver that quietly serves it up anyway has misread the request. The cost of hardness — a course whose every remaining teacher is avoided becomes unsatisfiable — is paid the way ticket 34 paid it for `exclude_full`: loudly, with the course named and the reason given, never as a silent empty result.

## Consequences

- A new `UnsatisfiableReason` variant is required. "No solutions" must always be able to say *which* course and *why*, or the feature becomes indistinguishable from a bug.
- A **blank teacher is never avoided.** Unknown is not a match (CONTEXT.md, SPEC §5); a filter that treated it as one would have silently deleted all 42 GEARTAP sections observed in §2.
- Pinned plan sections pass through untouched and unpinned ones may be swapped, exactly as ticket 42 settled for `exclude_full`. Two constraints in one solver may not hold two different theories of what a plan member is.
- Avoid is therefore expressible in the same place as the other constraints, and needs no new stage in the search.
