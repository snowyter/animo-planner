# 48 — [headless] The solver honours teacher preferences

**What to build:** Teach the solver to filter on avoided teachers and to score on ranked ones, under a new `Priority` axis that sits alongside `Preset`. This is where ticket 47's data starts changing results.

**Blocked by:** 47

**Runs in parallel with:** 49 — they share no files

**Status:** done — merged to main in `4c18983`

## Why

Two ADRs were written for this ticket and they are the specification:

- **ADR-0020** — avoiding a teacher is a **hard filter**, in the `exclude_full` / `day_blacklist` family, not a penalty
- **ADR-0021** — **`Priority` is a second axis**, not more presets, and `Teachers` sorts lexicographically

Read both before writing code. The reasoning in them is load-bearing, especially ADR-0020's account of why filtering here does not contradict ADR-0009.

## The avoid filter

- [ ] A candidate whose latest-snapshot teacher key is avoided **for that course** is dropped, exactly where `exclude_full` drops a full one. `SolverSection` already carries `teacher` — the field reserved for this and never read
- [ ] **A blank teacher is never avoided.** Unknown is not a match (`CONTEXT.md`, `SPEC.md` §5). A filter that treated blank as a mismatch would silently delete all 42 GEARTAP sections observed in §2 and return an empty solve with no explanation. There is already a test guarding the old version of this rule — `a_blank_teacher_is_never_treated_as_a_mismatch` — and it must keep passing in spirit as well as in letter
- [ ] **A new `UnsatisfiableReason` variant.** When avoidance is what emptied a course, say so by name: *"CSINTSY: every remaining section is taught by a teacher you avoid."* Follow ticket 34's split precisely — `candidate_allowed_except_full` exists so attribution can tell *which* constraint did the removing, and this needs the same treatment or the reason will be misattributed
- [ ] Report how many sections avoidance removed, the way exclude-full reports its own count. The exclusion is never quiet
- [ ] **Pinned plan sections pass through untouched**, at capacity or avoided or both — user-authored, exactly as ADR-0009 and ticket 42 have it. **Unpinned plan sections are candidates** and may be swapped out for an avoided teacher, exactly as exclude-full swaps a full one. Two constraints in one solver may not hold two theories of what a plan member is

## Rank scoring

- [ ] A ranked teacher contributes on a **`1/rank` curve**: rank 1 = 1.0, rank 2 = 0.5, rank 3 = 0.33…
- [ ] **Capped at 1.0 per course.** A course contributes at most one teacher's points, because a student takes one section of it. This is what stops a course where you ranked five teachers from outweighing one where you ranked two — ranking more people must never cost you anything
- [ ] **Unranked scores 0. Blank scores 0.** Neutral, never worst — the invariant in `CONTEXT.md` now states this explicitly for rankings, not just filters
- [ ] The teacher term appears as a **labelled component in the breakdown**, like every other. `scoring.rs` guarantees the components sum to the score; that must stay true

## The Priority axis

- [ ] `Priority::{Schedule, Teachers, Hybrid}` on `SolveOptions`, orthogonal to `Preset`. **`Schedule` is bit-for-bit today's behaviour** — serde-default it so an older caller and an untouched student get an identical solve
- [ ] **`Teachers` sorts lexicographically**: teacher score first, preset score as tiebreak. The presets have no shared scale (`FewestCampusDays` spans about −6…0; `NoEarlyMornings` returns minutes over sixty, spanning 7.5…18), so no single weight means the same thing against all three — see ADR-0021
- [ ] **`Hybrid` is a weighted sum** with one named, documented constant. Put it next to `LONE_F2F_DAY_WEIGHT` in `scoring.rs` with a comment saying what it is calibrated against, and pick a value where one course's rank-1 is worth roughly one campus day
- [ ] The bounded result heap is keyed on a **`(teacher_score, preset_score)` tuple** rather than one `f64`. `SolveSolution`'s `Ord` and the `Reverse`-wrapped `BinaryHeap` both need it
- [ ] **Bump `SOLVER_STATE_VERSION`** (currently 3). Constraints are serialized into the resume token, and a token minted before this ticket would resume a chunked solve under the wrong objective — silently, halfway through. The version comment already records why version 3 exists; add the same note for 4

## Where the preferences come from

- [ ] `solve_plan` / `continue_solve` read them in the command layer and pass them into the solver, the way the plan is read today. The solver core stays pure — no store, no I/O
- [ ] Preferences are keyed by course, and the solve knows its courses. An **inactive** entry (ticket 47 — a teacher no longer on any latest snapshot) matches nothing and therefore scores nothing, which needs no special case if the matching is done on the candidate's own teacher key

## Testing

- [ ] Avoidance removes a candidate; avoidance never removes a blank-teacher candidate; avoidance emptying a course names it with the new reason and the right count
- [ ] A pinned avoided section survives; an unpinned avoided section is swapped when a sibling exists — mirror ticket 42's pair, `an_unpinned_plan_section_is_swapped_when_it_leaves_no_room` and `an_unpinned_full_plan_section_is_swapped_when_exclude_full_is_on`
- [ ] `Priority::Schedule` produces results **identical** to a solve with no preferences at all, on a plan that has preferences. This is the regression test that matters most: the feature must be invisible until asked for
- [ ] Under `Priority::Teachers`, a worse schedule with a rank-1 teacher outranks a better schedule without one; the preset still orders two results that tie on teachers
- [ ] The per-course cap: a course with five ranked teachers cannot outscore two courses with one each
- [ ] The breakdown still sums to the score, with the teacher component present
- [ ] A resume token from version 3 is rejected rather than honoured

## Worth knowing before starting

`solver.rs` opens with a module doc that states the current guarantees precisely, including the sentence about blank teachers and v1.1 that this ticket makes obsolete. **Update it.** It is the first thing anyone reads about this file, and a stale guarantee there is worse than none.

## Comments

Merged in `4c18983`. Two defects fixed on main in `0f19021`:

- **Three `teacher_key` implementations.** This ticket wrote its own in both
  `scoring.rs` and `solver.rs` rather than using `core::teachers::teacher_key`
  from ticket 47. All three agreed, but the drift they invite fails silently:
  a solver key that stops matching the store's key makes ranks and avoids
  quietly do nothing, with no error. Both now call the one implementation.
  `is_only_avoided` was byte-identical to `is_avoided` and is gone.
- **The breakdown stopped summing to the score under Hybrid.** The "Teacher
  preference" component carried the unweighted score while `score` added the
  weighted one, so `scoring.rs`'s documented invariant held only because
  `HYBRID_TEACHER_WEIGHT` is 1.0 — and this ticket explicitly invites tuning
  it. The existing sums-to-score test only ran under `Priority::Schedule`,
  which is why it passed. Coverage now spans Hybrid under all three presets,
  the deliberate Teachers exception, and a whitespace-only teacher.

Everything else matched the ticket: the lexicographic sort key, the version 4
bump with its reasoning, the attribution split for the new unsatisfiable
reason, and the `Priority::Schedule` regression test.
