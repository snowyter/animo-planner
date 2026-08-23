//! Headless solver core (ticket 14): backtracking search with constraint
//! propagation that fills the unassigned courses of a plan with conflict-free
//! sections, without hanging and without blocking the interface.
//!
//! The search is always seeded from the current plan (ADR-0014): every
//! section already in the plan is fixed and appears in every emitted result;
//! the solve only assigns sections to courses that have none. Starting empty
//! is the degenerate case of the same operation.
//!
//! Algorithm (ADR-0010):
//! - Courses are ordered by fewest remaining valid sections first (MRV), with
//!   ties broken by course id.
//! - A partial assignment is pruned the moment a time conflict appears:
//!   a candidate is never placed if it overlaps any fixed section or any
//!   section already placed.
//! - Complete assignments are kept in a bounded heap of the best N by result
//!   limit. Ranking lands in ticket 15 (presets, scoring, warnings): until
//!   then every assignment scores a neutral 0.0, so the heap keeps the first
//!   N complete assignments in deterministic search order.
//! - A node-count cap stops a run and returns what it found, flagged as
//!   partial, with a resume token that continues the search rather than
//!   restarting it.
//!
//! Every run consumes at most one node budget before returning, so the
//! interface thread is never blocked: the Tauri command layer (ticket 20)
//! drives each budget chunk inside `tauri::async_runtime::spawn_blocking`.
//!
//! Guarantees:
//! - No emitted result has a conflict involving a solver-assigned section.
//!   Overlaps among fixed (plan) sections are user-authored (ADR-0009) and
//!   pass through untouched — the solver never reassigns them.
//! - Solving a plan with no unassigned courses returns the plan itself.
//! - An unassigned course with no valid section yields an explained
//!   `Unsatisfiable` result naming that course, never a silent empty list.

use crate::core::ipc_types::{ScheduleBlock, SolutionSection, SolveStatus, UnsatisfiableCourse};
use serde::{Deserialize, Serialize};
use std::cmp::{Ordering, Reverse};
use std::collections::BinaryHeap;
use std::fmt;

/// Nodes consumed per [`Solver::run`]: one node is one candidate section
/// examined at the current course position. A run always stops after at most
/// this many nodes and hands back a resume token, so a pathological input
/// degrades to a partial answer instead of hanging.
pub const DEFAULT_NODE_BUDGET: u64 = 100_000;

/// Version stamped into serialized search state; bumping it invalidates
/// resume tokens minted by older builds.
const SOLVER_STATE_VERSION: u32 = 1;

/// One course the solve must fill, with every captured section as a
/// candidate. Course identity is read from the capture dropdown (the results
/// table has no course code column), so callers pass it through unchanged.
#[derive(Debug, Clone)]
pub struct SolverCourse {
    pub course_id: i64,
    pub code: String,
    pub sections: Vec<SolverSection>,
}

/// One candidate section of a course, with its schedule blocks.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SolverSection {
    pub section_id: i64,
    pub section_code: String,
    pub blocks: Vec<ScheduleBlock>,
}

/// A section already chosen in the plan. Fixed for the whole solve: it is
/// never reassigned, and it constrains every candidate placed afterwards.
#[derive(Debug, Clone)]
pub struct FixedSection {
    pub course_id: i64,
    pub course_code: String,
    pub section_id: i64,
    pub section_code: String,
    pub blocks: Vec<ScheduleBlock>,
}

/// One conflict-free way to fill the plan: every section in the solved plan,
/// including the fixed ones.
#[derive(Debug, Clone, PartialEq)]
pub struct SolveSolution {
    pub sections: Vec<SolutionSection>,
}

/// The outcome of a bounded solve run.
#[derive(Debug, Clone, PartialEq)]
pub struct SolveOutcome {
    pub status: SolveStatus,
    pub solutions: Vec<SolveSolution>,
    /// Present iff `status` is [`SolveStatus::Partial`]; passing it to
    /// [`Solver::from_token`] continues the search.
    pub resume_token: Option<String>,
    pub unsatisfiable_courses: Vec<UnsatisfiableCourse>,
}

/// Failure to resume a search from a token.
#[derive(Debug)]
pub enum SolverError {
    /// The token could not be decoded, carries another state version, or
    /// violates the search-state invariants.
    InvalidResumeToken { detail: String },
}

impl fmt::Display for SolverError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            SolverError::InvalidResumeToken { detail } => {
                write!(f, "invalid solver resume token: {detail}")
            }
        }
    }
}

impl std::error::Error for SolverError {}

/// Internal candidate list of one course, in solve (MRV) order.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct CourseVar {
    course_id: i64,
    code: String,
    candidates: Vec<SolverSection>,
}

/// A complete assignment as ranked by the bounded heap. Until ticket 15
/// attaches real scores, every assignment scores a neutral `0.0`, and ties
/// (equal score) keep the earliest-found assignment first.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct Ranked {
    score: f64,
    seq: u64,
    sections: Vec<SolutionSection>,
}

impl PartialEq for Ranked {
    fn eq(&self, other: &Self) -> bool {
        self.cmp(other) == Ordering::Equal
    }
}

impl Eq for Ranked {}

impl PartialOrd for Ranked {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for Ranked {
    fn cmp(&self, other: &Self) -> Ordering {
        self.score
            .total_cmp(&other.score)
            .then_with(|| other.seq.cmp(&self.seq))
    }
}

/// Keeps at most `cap` records, always the best ones: higher score wins,
/// and among equal scores the earliest-found record wins. `Reverse` makes
/// the heap top the *worst* record, which is what eviction needs.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct BoundedBest {
    cap: usize,
    heap: BinaryHeap<Reverse<Ranked>>,
}

impl BoundedBest {
    fn new(cap: usize) -> Self {
        Self {
            cap: cap.max(1),
            heap: BinaryHeap::new(),
        }
    }

    fn cap(&self) -> usize {
        self.cap
    }

    fn push(&mut self, record: Ranked) {
        let wrapped = Reverse(record);
        if self.heap.len() < self.cap {
            self.heap.push(wrapped);
        } else if let Some(Reverse(worst)) = self.heap.peek() {
            if wrapped.0 > *worst {
                self.heap.pop();
                self.heap.push(wrapped);
            }
        }
    }

    /// The kept records, best first.
    fn sorted(&self) -> Vec<Ranked> {
        let mut records: Vec<Ranked> = self.heap.iter().map(|Reverse(record)| record.clone()).collect();
        records.sort_by(|a, b| b.cmp(a));
        records
    }
}

/// Everything needed to continue an interrupted search, in serializable form
/// so it can cross the IPC seam as the opaque `resume_token` string.
#[derive(Serialize, Deserialize)]
struct SearchState {
    version: u32,
    /// Unassigned courses in solve (MRV) order.
    courses: Vec<CourseVar>,
    /// Plan sections, sorted by `(course_id, section_id)`; fixed forever.
    fixed: Vec<SolutionSection>,
    /// `assignment[i]` is the chosen candidate index of `courses[i]`, and is
    /// `Some` exactly when `i < depth`.
    assignment: Vec<Option<u32>>,
    /// Scan position per course: the next candidate index to examine.
    next_candidate: Vec<u32>,
    depth: usize,
    nodes: u64,
    seq: u64,
    results: BoundedBest,
    /// Set once the search space is exhausted, so a completed solver never
    /// re-runs its search.
    done: bool,
}

/// The solver: an interrupted search can be serialized to a resume token and
/// continued later from exactly where it stopped.
pub struct Solver {
    state: SearchState,
    /// Unassigned courses with no section valid against the fixed plan,
    /// detected before any node is spent. Non-empty means the solve cannot
    /// even start; the result names these courses.
    unsatisfiable: Vec<UnsatisfiableCourse>,
}

impl Solver {
    /// Prepares a solve: sorts and deduplicates inputs, fixes the plan
    /// sections, orders the unassigned courses by fewest valid sections
    /// first, and detects courses that can never be filled. No node is
    /// spent here.
    pub fn new(
        courses: Vec<SolverCourse>,
        plan_sections: Vec<FixedSection>,
        result_limit: usize,
    ) -> Solver {
        let fixed = fixed_sections(plan_sections);

        let mut catalog: Vec<CourseVar> = courses
            .into_iter()
            .map(|course| CourseVar {
                course_id: course.course_id,
                code: course.code,
                candidates: {
                    let mut candidates = course.sections;
                    candidates.sort_by_key(|candidate| candidate.section_id);
                    candidates.dedup_by_key(|candidate| candidate.section_id);
                    candidates
                },
            })
            .collect();
        catalog.sort_by_key(|course| course.course_id);
        catalog.dedup_by_key(|course| course.course_id);

        let assigned = |course_id: i64| fixed.iter().any(|section| section.course_id == course_id);
        let unassigned = catalog
            .into_iter()
            .filter(|course| !assigned(course.course_id))
            .collect::<Vec<_>>();

        // MRV: fewest valid sections against the fixed plan first.
        let mut ordered: Vec<(CourseVar, usize)> = unassigned
            .into_iter()
            .map(|course| {
                let valid = root_domain_size(&fixed, &course);
                (course, valid)
            })
            .collect();
        ordered.sort_by(|a, b| a.1.cmp(&b.1).then(a.0.course_id.cmp(&b.0.course_id)));

        let mut unsatisfiable: Vec<UnsatisfiableCourse> = ordered
            .iter()
            .filter(|(_, valid)| *valid == 0)
            .map(|(course, _)| UnsatisfiableCourse {
                course_id: course.course_id,
                code: course.code.clone(),
            })
            .collect();
        unsatisfiable.sort_by_key(|course| course.course_id);

        let courses: Vec<CourseVar> = ordered.into_iter().map(|(course, _)| course).collect();
        Solver {
            state: SearchState {
                version: SOLVER_STATE_VERSION,
                assignment: vec![None; courses.len()],
                next_candidate: vec![0; courses.len()],
                courses,
                fixed,
                depth: 0,
                nodes: 0,
                seq: 0,
                results: BoundedBest::new(result_limit),
                done: false,
            },
            unsatisfiable,
        }
    }

    /// Rebuilds a solver from a resume token minted by [`Solver::run`] or
    /// [`Solver::run_with_budget`]. The token carries the full search state,
    /// so resuming continues the search rather than restarting it.
    pub fn from_token(token: &str) -> Result<Solver, SolverError> {
        let state: SearchState = serde_json::from_str(token)
            .map_err(|err| SolverError::InvalidResumeToken { detail: err.to_string() })?;
        if state.version != SOLVER_STATE_VERSION {
            return Err(SolverError::InvalidResumeToken {
                detail: format!("unknown state version {}", state.version),
            });
        }
        validate_state(&state)?;
        Ok(Solver {
            state,
            unsatisfiable: Vec::new(),
        })
    }

    /// The unassigned courses in solve order (fewest valid sections first).
    pub fn course_order(&self) -> Vec<i64> {
        self.state.courses.iter().map(|course| course.course_id).collect()
    }

    /// Total nodes consumed across all runs of this solver instance.
    pub fn nodes_visited(&self) -> u64 {
        self.state.nodes
    }

    /// Runs one bounded chunk of the search and returns what it found.
    pub fn run(&mut self) -> SolveOutcome {
        self.run_with_budget(DEFAULT_NODE_BUDGET)
    }

    /// Runs at most `budget` nodes, then stops: `Partial` with a resume
    /// token when the budget ran out first, `Complete` when the space was
    /// exhausted, `Unsatisfiable` when a course can never be filled.
    pub fn run_with_budget(&mut self, budget: u64) -> SolveOutcome {
        if !self.unsatisfiable.is_empty() {
            return self.outcome(SolveStatus::Unsatisfiable);
        }
        if self.state.courses.is_empty() {
            // No unassigned courses: the plan itself is the one result.
            return SolveOutcome {
                status: SolveStatus::Complete,
                solutions: vec![SolveSolution {
                    sections: self.state.fixed.clone(),
                }],
                resume_token: None,
                unsatisfiable_courses: Vec::new(),
            };
        }
        if self.state.done {
            return self.outcome(SolveStatus::Complete);
        }

        let started = self.state.nodes;
        loop {
            if self.state.nodes - started >= budget {
                return self.outcome(SolveStatus::Partial);
            }

            if self.state.depth == self.state.courses.len() {
                // A complete assignment: record it, then backtrack from the
                // last course to keep enumerating.
                let sections = self.build_solution();
                self.state.results.push(Ranked {
                    score: 0.0,
                    seq: self.state.seq,
                    sections,
                });
                self.state.seq += 1;
                self.state.depth -= 1;
                self.state.assignment[self.state.depth] = None;
                continue;
            }

            let depth = self.state.depth;
            let next = self.state.next_candidate[depth] as usize;
            if next >= self.state.courses[depth].candidates.len() {
                // This course is exhausted under the current prefix.
                if depth == 0 {
                    self.state.done = true;
                    return self.outcome(SolveStatus::Complete);
                }
                self.state.depth -= 1;
                self.state.assignment[self.state.depth] = None;
                continue;
            }

            let conflicts = {
                let candidate = &self.state.courses[depth].candidates[next];
                self.conflicts_with_current(depth, candidate)
            };
            self.state.nodes += 1;
            self.state.next_candidate[depth] += 1;
            if conflicts {
                continue;
            }
            self.state.assignment[depth] = Some(next as u32);
            self.state.depth += 1;
            // Entering a course afresh restarts its scan: the candidates
            // ahead of it were examined under a different assignment.
            if self.state.depth < self.state.courses.len() {
                self.state.next_candidate[self.state.depth] = 0;
            }
        }
    }
}

impl Solver {
    fn outcome(&self, status: SolveStatus) -> SolveOutcome {
        let resume_token = match status {
            SolveStatus::Partial => Some(self.to_token()),
            _ => None,
        };
        SolveOutcome {
            status,
            solutions: self
                .state
                .results
                .sorted()
                .into_iter()
                .map(|ranked| SolveSolution {
                    sections: ranked.sections,
                })
                .collect(),
            resume_token,
            unsatisfiable_courses: self.unsatisfiable.clone(),
        }
    }

    fn to_token(&self) -> String {
        // The state holds only plain serde types; serialization cannot fail.
        serde_json::to_string(&self.state).expect("solver state must always serialize")
    }

    /// Every section of the current complete assignment, plan sections
    /// first, all in deterministic `(course, section)` order.
    fn build_solution(&self) -> Vec<SolutionSection> {
        let mut sections = self.state.fixed.clone();
        for (course_index, assigned) in self.state.assignment.iter().enumerate() {
            let Some(index) = assigned else { continue };
            let course = &self.state.courses[course_index];
            let candidate = &course.candidates[*index as usize];
            sections.push(SolutionSection {
                course_id: course.course_id,
                course_code: course.code.clone(),
                section_id: candidate.section_id,
                section_code: candidate.section_code.clone(),
                pinned: false,
                blocks: candidate.blocks.clone(),
            });
        }
        sections.sort_by_key(|section| (section.course_id, section.section_id));
        sections
    }

    /// Whether a candidate conflicts with the fixed plan or with any course
    /// assigned before `depth` — the prune-as-you-go step.
    fn conflicts_with_current(&self, depth: usize, candidate: &SolverSection) -> bool {
        if self
            .state
            .fixed
            .iter()
            .any(|fixed| blocks_conflict(&fixed.blocks, &candidate.blocks))
        {
            return true;
        }
        for course_index in 0..depth {
            let Some(index) = self.state.assignment[course_index] else {
                continue;
            };
            let placed = &self.state.courses[course_index].candidates[index as usize];
            if blocks_conflict(&placed.blocks, &candidate.blocks) {
                return true;
            }
        }
        false
    }
}

/// Plan sections, deduplicated and sorted by `(course_id, section_id)`.
fn fixed_sections(plan_sections: Vec<FixedSection>) -> Vec<SolutionSection> {
    let mut sections: Vec<SolutionSection> = plan_sections
        .into_iter()
        .map(|fixed| SolutionSection {
            course_id: fixed.course_id,
            course_code: fixed.course_code,
            section_id: fixed.section_id,
            section_code: fixed.section_code,
            pinned: true,
            blocks: fixed.blocks,
        })
        .collect();
    sections.sort_by_key(|section| (section.course_id, section.section_id));
    sections.dedup_by(|a, b| (a.course_id, a.section_id) == (b.course_id, b.section_id));
    sections
}

/// How many of a course's candidates are valid against the fixed plan —
/// the MRV ordering key and the unsatisfiability check.
fn root_domain_size(fixed: &[SolutionSection], course: &CourseVar) -> usize {
    course
        .candidates
        .iter()
        .filter(|candidate| {
            !fixed
                .iter()
                .any(|fixed| blocks_conflict(&fixed.blocks, &candidate.blocks))
        })
        .count()
}

/// Rejects tokens whose contents violate the search-state invariants, so a
/// corrupted or hand-edited token fails loudly instead of misbehaving.
fn validate_state(state: &SearchState) -> Result<(), SolverError> {
    let invalid = |detail: String| SolverError::InvalidResumeToken { detail };
    let course_count = state.courses.len();
    if state.assignment.len() != course_count || state.next_candidate.len() != course_count {
        return Err(invalid("state arrays do not match the course count".to_string()));
    }
    if state.depth > course_count {
        return Err(invalid("depth exceeds the course count".to_string()));
    }
    if state.results.cap() == 0 {
        return Err(invalid("result limit must be at least one".to_string()));
    }
    for (index, course) in state.courses.iter().enumerate() {
        let assigned = state.assignment[index].is_some();
        let expected = index < state.depth;
        if assigned != expected {
            return Err(invalid(format!(
                "assignment slot {index} is inconsistent with the depth"
            )));
        }
        if state.next_candidate[index] as usize > course.candidates.len() {
            return Err(invalid(format!(
                "scan offset {index} runs past the candidate list"
            )));
        }
        if index > state.depth && state.next_candidate[index] != 0 {
            return Err(invalid(format!("scan offset {index} must be untouched")));
        }
    }
    Ok(())
}

/// Two schedule blocks overlap when they share a day and their time ranges
/// intersect with positive length; blocks that merely touch are clear
/// (same semantics as `conflicts::find_conflicts`).
fn blocks_conflict(a: &[ScheduleBlock], b: &[ScheduleBlock]) -> bool {
    a.iter()
        .any(|first| b.iter().any(|second| first.day == second.day && first.start_min < second.end_min && second.start_min < first.end_min))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::conflicts::{self, PlannedBlock, PlannedSection};
    use crate::core::ipc_types::{BlockModality, Day};
    use crate::core::parser::{ParsedBlock, ParsedLocation, SelectorConfig};
    use crate::core::sample_data::parse_sample_captures;

    fn block(day: Day, start_min: i64, end_min: i64) -> ScheduleBlock {
        ScheduleBlock {
            day,
            start_min,
            end_min,
            location: None,
            modality: BlockModality::Online,
        }
    }

    fn section(section_id: i64, blocks: Vec<ScheduleBlock>) -> SolverSection {
        SolverSection {
            section_id,
            section_code: format!("S{section_id}"),
            blocks,
        }
    }

    fn course(course_id: i64, code: &str, sections: Vec<SolverSection>) -> SolverCourse {
        SolverCourse {
            course_id,
            code: code.to_string(),
            sections,
        }
    }

    fn fixed(course_id: i64, section_id: i64, blocks: Vec<ScheduleBlock>) -> FixedSection {
        FixedSection {
            course_id,
            course_code: format!("C{course_id}"),
            section_id,
            section_code: format!("S{section_id}"),
            blocks,
        }
    }

    fn assert_conflict_free(solution: &SolveSolution) {
        let members: Vec<PlannedSection> = solution
            .sections
            .iter()
            .map(|section| PlannedSection {
                course_id: section.course_id,
                section_id: section.section_id,
                blocks: section
                    .blocks
                    .iter()
                    .map(|b| PlannedBlock {
                        day: b.day,
                        start_min: b.start_min,
                        end_min: b.end_min,
                    })
                    .collect(),
            })
            .collect();
        assert!(
            conflicts::find_conflicts(&members).is_empty(),
            "a solver result must never hold a conflict, got: {:?}",
            conflicts::find_conflicts(&members)
        );
    }

    fn to_schedule_block(block: &ParsedBlock) -> ScheduleBlock {
        ScheduleBlock {
            day: block.day,
            start_min: block.start_min,
            end_min: block.end_min,
            location: match &block.location {
                ParsedLocation::Room(code) => Some(code.clone()),
                ParsedLocation::Online => None,
                ParsedLocation::Unrecognized(raw) => Some(raw.clone()),
            },
            modality: block
                .modality()
                .expect("sample fixture blocks are always classified"),
        }
    }

    /// The sample catalog: CSINTSY (5 sections) + GEARTAP (42 sections),
    /// parsed through the real parser exactly as the seed does.
    fn sample_courses() -> Vec<SolverCourse> {
        let captures =
            parse_sample_captures(&SelectorConfig::default()).expect("sample captures must parse");
        captures
            .iter()
            .map(|sections| SolverCourse {
                course_id: sections[0].course_id,
                code: sections[0].course_code.clone(),
                sections: sections
                    .iter()
                    .map(|parsed| SolverSection {
                        section_id: parsed.section_id,
                        section_code: parsed.section_code.clone(),
                        blocks: parsed.blocks.iter().map(to_schedule_block).collect(),
                    })
                    .collect(),
            })
            .collect()
    }

    /// 4 courses x 6 sections; each course sits on its own day, so nothing
    /// conflicts and the search space is 6^4 = 1296 complete assignments —
    /// 1554 nodes — plenty to trip a small node cap.
    fn synthetic_problem() -> Vec<SolverCourse> {
        let days = [Day::Mon, Day::Tue, Day::Wed, Day::Thu, Day::Fri, Day::Sat];
        (0..4)
            .map(|course_index| {
                let day = days[course_index];
                course(
                    course_index as i64 + 1,
                    &format!("C{}", course_index + 1),
                    (0..6)
                        .map(|section_index| {
                            section(
                                section_index + 1,
                                vec![block(
                                    day,
                                    450 + section_index * 90,
                                    540 + section_index * 90,
                                )],
                            )
                        })
                        .collect(),
                )
            })
            .collect()
    }

    // ---------- sample data ----------

    #[test]
    fn the_sample_data_solves_geartap_around_a_chosen_csintsy_section() {
        let courses = sample_courses();
        let csintsy = courses
            .iter()
            .find(|c| c.code == "CSINTSY")
            .expect("CSINTSY must be in the sample");
        let chosen = &csintsy.sections[0];
        let pinned = FixedSection {
            course_id: csintsy.course_id,
            course_code: csintsy.code.clone(),
            section_id: chosen.section_id,
            section_code: chosen.section_code.clone(),
            blocks: chosen.blocks.clone(),
        };
        let geartap = courses
            .iter()
            .find(|c| c.code == "GEARTAP")
            .expect("GEARTAP must be in the sample");

        let mut compatible: Vec<&SolverSection> = geartap
            .sections
            .iter()
            .filter(|candidate| !blocks_conflict(&candidate.blocks, &pinned.blocks))
            .collect();
        compatible.sort_by_key(|candidate| candidate.section_id);
        let mut expected: Vec<SolveSolution> = compatible
            .iter()
            .map(|candidate| {
                let mut sections = vec![
                    SolutionSection {
                        course_id: pinned.course_id,
                        course_code: pinned.course_code.clone(),
                        section_id: pinned.section_id,
                        section_code: pinned.section_code.clone(),
                        pinned: true,
                        blocks: pinned.blocks.clone(),
                    },
                    SolutionSection {
                        course_id: geartap.course_id,
                        course_code: geartap.code.clone(),
                        section_id: candidate.section_id,
                        section_code: candidate.section_code.clone(),
                        pinned: false,
                        blocks: candidate.blocks.clone(),
                    },
                ];
                sections.sort_by_key(|section| (section.course_id, section.section_id));
                SolveSolution { sections }
            })
            .collect();
        expected.sort_by_key(|solution| {
            solution
                .sections
                .iter()
                .find(|section| !section.pinned)
                .expect("each expected solution carries one GEARTAP section")
                .section_id
        });

        let mut solver = Solver::new(courses.clone(), vec![pinned.clone()], 100);
        let outcome = solver.run();
        assert_eq!(outcome.status, SolveStatus::Complete);
        assert_eq!(outcome.resume_token, None);
        assert!(
            !expected.is_empty(),
            "the test fixture assumption: GEARTAP must offer sections outside the pinned CSINTSY times"
        );
        assert_eq!(outcome.solutions, expected);
        for solution in &outcome.solutions {
            assert_conflict_free(solution);
            let pinned_section = solution
                .sections
                .iter()
                .find(|section| section.pinned)
                .expect("the plan section must stay in every result");
            assert_eq!(pinned_section.course_id, csintsy.course_id);
            assert_eq!(pinned_section.section_id, chosen.section_id);
        }

        // The solve is deterministic: identical input, identical output.
        let mut again = Solver::new(courses, vec![pinned], 100);
        assert_eq!(again.run().solutions, outcome.solutions);
    }

    // ---------- pinned / no unassigned courses ----------

    #[test]
    fn a_fully_pinned_plan_solves_to_the_plan_itself() {
        let plan = vec![
            fixed(10, 1, vec![block(Day::Mon, 450, 540)]),
            fixed(20, 2, vec![block(Day::Tue, 450, 540)]),
        ];
        let catalog = vec![
            course(10, "C10", vec![section(9, vec![block(Day::Wed, 450, 540)])]),
            course(20, "C20", vec![section(8, vec![block(Day::Thu, 450, 540)])]),
        ];
        let mut solver = Solver::new(catalog, plan, 12);
        let outcome = solver.run();

        assert_eq!(outcome.status, SolveStatus::Complete);
        assert_eq!(outcome.resume_token, None);
        assert_eq!(outcome.solutions.len(), 1, "the plan itself is the one result");
        let solution = &outcome.solutions[0];
        assert!(solution.sections.iter().all(|s| s.pinned));
        assert_eq!(
            solution
                .sections
                .iter()
                .map(|s| (s.course_id, s.section_id))
                .collect::<Vec<_>>(),
            vec![(10, 1), (20, 2)],
            "plan sections in deterministic (course, section) order"
        );
        assert_eq!(
            solver.nodes_visited(),
            0,
            "no node is spent when nothing is unassigned"
        );
        assert_conflict_free(solution);
    }

    #[test]
    fn solving_an_empty_plan_is_the_degenerate_case_not_an_error() {
        let mut solver = Solver::new(vec![], vec![], 12);
        let outcome = solver.run();
        assert_eq!(outcome.status, SolveStatus::Complete);
        assert_eq!(outcome.resume_token, None);
        assert_eq!(outcome.solutions, vec![SolveSolution { sections: vec![] }]);
    }

    // ---------- unsatisfiable ----------

    #[test]
    fn an_unsatisfiable_course_is_named_not_silently_dropped() {
        let fixed_section = fixed(1, 1, vec![block(Day::Mon, 450, 540)]);
        let impossible = course(
            2,
            "IMPOS",
            vec![
                section(1, vec![block(Day::Mon, 450, 540)]),
                section(2, vec![block(Day::Mon, 480, 570)]),
            ],
        );
        let empty = course(3, "EMPTY", vec![]);
        let fine = course(4, "FINE", vec![section(1, vec![block(Day::Tue, 450, 540)])]);
        let mut solver = Solver::new(vec![impossible, empty, fine], vec![fixed_section], 12);
        let outcome = solver.run();

        assert_eq!(outcome.status, SolveStatus::Unsatisfiable);
        assert!(outcome.solutions.is_empty());
        assert_eq!(outcome.resume_token, None);
        assert_eq!(
            outcome.unsatisfiable_courses,
            vec![
                UnsatisfiableCourse {
                    course_id: 2,
                    code: "IMPOS".to_string(),
                },
                UnsatisfiableCourse {
                    course_id: 3,
                    code: "EMPTY".to_string(),
                },
            ],
            "only courses with no valid section are named; FINE stays out"
        );
    }

    // ---------- MRV ordering ----------

    #[test]
    fn courses_are_ordered_by_fewest_valid_sections_first() {
        let wide = course(
            10,
            "WIDE",
            (0..5)
                .map(|i| section(i + 1, vec![block(Day::Mon, 450 + i * 90, 540 + i * 90)]))
                .collect(),
        );
        let narrow = course(20, "NARROW", vec![section(1, vec![block(Day::Wed, 450, 540)])]);
        let solver = Solver::new(vec![wide.clone(), narrow.clone()], vec![], 12);
        assert_eq!(solver.course_order(), vec![20, 10]);
        let reversed = Solver::new(vec![narrow, wide], vec![], 12);
        assert_eq!(
            reversed.course_order(),
            vec![20, 10],
            "input order must not matter; fewest valid sections wins"
        );
    }

    #[test]
    fn mrv_ties_break_by_course_id() {
        let a = course(40, "A40", vec![section(1, vec![block(Day::Mon, 450, 540)])]);
        let b = course(30, "B30", vec![section(1, vec![block(Day::Tue, 450, 540)])]);
        let solver = Solver::new(vec![a, b], vec![], 12);
        assert_eq!(solver.course_order(), vec![30, 40]);
    }

    // ---------- pruning and conflict freedom ----------

    #[test]
    fn conflicting_combinations_are_pruned_and_every_result_is_conflict_free() {
        let a = course(
            1,
            "A",
            vec![
                section(1, vec![block(Day::Mon, 450, 540)]),
                section(2, vec![block(Day::Tue, 450, 540)]),
            ],
        );
        let b = course(
            2,
            "B",
            vec![
                section(1, vec![block(Day::Mon, 450, 540)]),
                section(2, vec![block(Day::Tue, 450, 540)]),
            ],
        );
        let mut solver = Solver::new(vec![a, b], vec![], 12);
        let outcome = solver.run();

        assert_eq!(outcome.status, SolveStatus::Complete);
        assert_eq!(
            outcome.solutions.len(),
            2,
            "only the two conflict-free pairings survive: A1+B2 and A2+B1"
        );
        for solution in &outcome.solutions {
            assert_conflict_free(solution);
        }
        let pairings: Vec<(i64, i64)> = outcome
            .solutions
            .iter()
            .map(|solution| {
                (
                    solution.sections[0].section_id,
                    solution.sections[1].section_id,
                )
            })
            .collect();
        assert!(pairings.contains(&(1, 2)), "A1 pairs with B2");
        assert!(pairings.contains(&(2, 1)), "A2 pairs with B1");
    }

    // ---------- node cap and resume ----------

    #[test]
    fn the_node_cap_degrades_to_partial_and_resume_continues_the_search() {
        let mut unlimited = Solver::new(synthetic_problem(), vec![], 12);
        let full = unlimited.run_with_budget(u64::MAX);
        assert_eq!(full.status, SolveStatus::Complete);
        assert_eq!(full.resume_token, None);
        assert_eq!(full.solutions.len(), 12, "bounded by the result limit");
        let expected_nodes = unlimited.nodes_visited();
        assert_eq!(expected_nodes, 1554, "6 + 36 + 216 + 1296 examined candidates");

        // Chunked runs, resuming from the token each time, must enumerate
        // exactly what the unlimited run did — continuing, not restarting.
        let mut solver = Solver::new(synthetic_problem(), vec![], 12);
        let mut runs = 0;
        loop {
            let outcome = solver.run_with_budget(100);
            runs += 1;
            assert!(
                outcome.solutions.len() <= full.solutions.len(),
                "a partial run cannot hold more results than the final answer"
            );
            assert_eq!(
                outcome.solutions,
                full.solutions[..outcome.solutions.len()],
                "results accumulate as a prefix of the complete answer"
            );
            match outcome.status {
                SolveStatus::Partial => {
                    let token = outcome
                        .resume_token
                        .expect("a partial outcome must carry a resume token");
                    solver = Solver::from_token(&token).expect("the token must resume");
                }
                SolveStatus::Complete => break,
                other => panic!("unexpected status {other:?}"),
            }
        }
        assert!(runs > 1, "the node cap must have interrupted the search");
        assert_eq!(
            solver.nodes_visited(),
            expected_nodes,
            "resuming continues the search rather than restarting it"
        );
        assert_eq!(
            solver.run().solutions,
            full.solutions,
            "a completed solver returns the same answer again without re-searching"
        );
    }

    #[test]
    fn the_result_limit_bounds_the_heap_but_not_the_search() {
        let mut solver = Solver::new(synthetic_problem(), vec![], 5);
        let outcome = solver.run_with_budget(u64::MAX);
        assert_eq!(outcome.status, SolveStatus::Complete);
        assert_eq!(outcome.solutions.len(), 5);
        assert_eq!(
            solver.nodes_visited(),
            1554,
            "the search still enumerates the full space; only the heap is bounded"
        );
    }

    #[test]
    fn a_garbled_or_versioned_away_resume_token_is_rejected() {
        assert!(Solver::from_token("not json").is_err());
        assert!(Solver::from_token("{\"version\":99}").is_err());
        let mut solver = Solver::new(synthetic_problem(), vec![], 12);
        let outcome = solver.run_with_budget(1);
        assert_eq!(outcome.status, SolveStatus::Partial);
        let token = outcome.resume_token.expect("partial carries a token");
        assert!(Solver::from_token(&token).is_ok());
    }

    // ---------- bounded heap ----------

    #[test]
    fn bounded_best_keeps_only_the_best_n() {
        let mut best = BoundedBest::new(3);
        for i in 0..6u64 {
            best.push(Ranked {
                score: i as f64,
                seq: i,
                sections: Vec::new(),
            });
        }
        let scores: Vec<f64> = best.sorted().iter().map(|record| record.score).collect();
        assert_eq!(scores, vec![5.0, 4.0, 3.0], "higher scores evict lower ones");
    }

    #[test]
    fn bounded_best_ties_keep_the_earliest_found() {
        let mut tied = BoundedBest::new(2);
        for i in 0..4u64 {
            tied.push(Ranked {
                score: 0.0,
                seq: i,
                sections: Vec::new(),
            });
        }
        let seqs: Vec<u64> = tied.sorted().iter().map(|record| record.seq).collect();
        assert_eq!(seqs, vec![0, 1], "equal scores keep the first-found records");
    }
}
