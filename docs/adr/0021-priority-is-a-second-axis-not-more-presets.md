# Priority is a second axis, not more presets

How heavily a teacher ranking weighs against the schedule is a `Priority` — `Schedule`, `Teachers`, or `Hybrid` — carried alongside `Preset` in `SolveOptions` rather than folded into it. Every priority composes with every preset.

The obvious road was more presets, and it does not survive contact with arithmetic: three priorities against three presets is nine names for two ideas, and every future preset multiplies rather than adds. Worse, the names stop describing anything a student recognises — "fewest campus days, but teachers matter more" is not a strategy, it is two strategies wearing one label. Keeping the axes separate means a student answers two small questions they can each hold in their head, and `Schedule` is exactly today's behaviour, so a student who ignores the feature gets a bit-for-bit unchanged solve.

Which left how the two axes combine, given the presets have no shared scale — `FewestCampusDays` spans roughly −6…0 while `NoEarlyMornings` returns minutes over sixty, spanning 7.5…18. No single weight means the same thing against both. So `Teachers` sorts **lexicographically**: teacher score first, preset only as a tiebreak. That is both what the words promise and the one reading that needs no magic constant. Only `Hybrid` carries a tuned weight, and it is the mode whose whole purpose is to be a compromise.

## Consequences

- The bounded result heap is keyed on a `(teacher_score, preset_score)` tuple rather than one `f64`.
- Teacher points are capped at **1.0 per course** on a `1/rank` curve, so ranking a fifth teacher costs nothing and a course with many ranked teachers cannot outweigh one with few. Unranked and blank both score zero — neutral, never worst.
- `Priority` enters the IPC contract and the serialized solver state, so adding it bumps `SOLVER_STATE_VERSION`. Resume tokens minted by older builds must be invalidated, or a resumed solve would silently finish under the wrong objective.
- A ranking with `Priority::Schedule` is a no-op by design. The interface has to say so, or students will report the feature as broken.
