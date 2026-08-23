//! Headless solver core (tickets 14 and 15): backtracking search with
//! constraint propagation that fills the unassigned courses of a plan with
//! conflict-free sections, ranked under a preset, without hanging and
//! without blocking the interface.
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
//! - Complete assignments are ranked by the selected preset (ticket 15):
//!   each is scored once — breakdown and advisory transition warnings in the
//!   same pass (`scoring::evaluate`) — and the best N are kept in a bounded
//!   heap. A warning never filters anything out.
//! - A node-count cap stops a run and returns what it found, flagged as
//!   partial, with a resume token that continues the search rather than
//!   restarting it.
//!
//! Constraints (ticket 15) filter candidates only: day blacklist, earliest
//! start / latest end bounds, and exclude-full. Fixed (plan) sections are
//! never reassigned and never dropped — a pinned section that violates a
//! constraint is user-authored and passes through untouched, exactly like a
//! user-authored conflict (ADR-0009). Section-code prefixes are never read,
//! and a blank teacher is never a mismatch: no constraint branches on either.
//!
//! Every run consumes at most one node budget before returning, so the
//! interface thread is never blocked: the Tauri command layer (ticket 20)
//! drives each budget chunk inside `tauri::async_runtime::spawn_blocking`.
//!
//! Guarantees:
//! - No emitted result has a conflict involving a solver-assigned section.
//!   Overlaps among fixed (plan) sections are user-authored (ADR-0009) and
//!   pass through untouched — the solver never reassigns them.
//! - Solving a plan with no unassigned courses returns the plan itself,
//!   scored and warned under the requested preset.
//! - An unassigned course with no valid section yields an explained
//!   `Unsatisfiable` result naming that course, never a silent empty list.

use crate::core::ipc_types::{
    Day, Preset, ScheduleBlock, ScoreComponent, SolutionSection, SolveOptions, SolveStatus,
    TransitionWarning, UnsatisfiableCourse,
};
use crate::core::scoring::{self, Evaluation};
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
const SOLVER_STATE_VERSION: u32 = 2;

/// One course the solve must fill, with every captured section as a
/// candidate. Course identity is read from the capture dropdown (the results
/// table has no course code column), so callers pass it through unchanged.
#[derive(Debug, Clone)]
pub struct SolverCourse {
    pub course_id: i64,
    pub code: String,
    pub sections: Vec<SolverSection>,
}

/// One candidate section of a course, with its schedule blocks and the live
/// numbers the exclude-full constraint needs.
///
/// `enrolled` / `enroll_cap` of `None` mean *unknown* — a candidate is never
/// treated as full on unknown data. `teacher: None` means *unknown* too, and
/// no constraint ever reads it: a blank teacher is never a mismatch
/// (professor filters are v1.1 and must not leak in here). Section-code
/// prefixes are likewise never read for eligibility (SPEC §2).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SolverSection {
    pub section_id: i64,
    pub section_code: String,
    pub blocks: Vec<ScheduleBlock>,
    pub enrolled: Option<i64>,
    pub enroll_cap: Option<i64>,
    pub teacher: Option<String>,
}

/// A section already chosen in the plan. Fixed for the whole solve: it is
/// never reassigned, never dropped by a constraint, and it constrains every
/// candidate placed afterwards.
#[derive(Debug, Clone)]
pub struct FixedSection {
    pub course_id: i64,
    pub course_code: String,
    pub section_id: i64,
    pub section_code: String,
    pub blocks: Vec<ScheduleBlock>,
}

/// One conflict-free way to fill the plan, ranked by the requested preset:
/// every section in the solved plan (including the fixed ones), its score,
/// the components that sum to that score, and the advisory transition
/// warnings found in the same pass.
#[derive(Debug, Clone, PartialEq)]
pub struct SolveSolution {
    pub score: f64,
    pub breakdown: Vec<ScoreComponent>,
    pub warnings: Vec<TransitionWarning>,
    pub sections: Vec<SolutionSection>,
}

/// The constraints a solve obeys. Everything here filters *candidates*;
/// nothing here ever drops a fixed (plan) section.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SolveConstraints {
    /// The ranking preset the results are scored and sorted under.
    pub preset: Preset,
    /// Days the student ruled out: no solver-placed block may sit on them.
    pub day_blacklist: Vec<Day>,
    /// No solver-placed block may start before this minute.
    pub earliest_start_min: Option<i64>,
    /// No solver-placed block may end after this minute.
    pub latest_end_min: Option<i64>,
    /// When set, candidates at or over capacity are dropped. Off by default.
    pub exclude_full: bool,
}

impl From<&SolveOptions> for SolveConstraints {
    fn from(options: &SolveOptions) -> Self {
        // Normalize the blacklist so a token and a fresh solve agree.
        let mut day_blacklist = options.day_blacklist.clone();
        day_blacklist.sort_by_key(|day| scoring::day_index(*day));
        day_blacklist.dedup();
        Self {
            preset: options.preset,
            day_blacklist,
            earliest_start_min: options.earliest_start_min,
            latest_end_min: options.latest_end_min,
            exclude_full: options.exclude_full,
        }
    }
}

impl SolveConstraints {
    /// Whether a candidate satisfies every constraint. Unary: the check does
    /// not depend on any other assignment.
    fn candidate_allowed(&self, candidate: &SolverSection) -> bool {
        if self.exclude_full {
            if let (Some(enrolled), Some(enroll_cap)) = (candidate.enrolled, candidate.enroll_cap)
            {
                if enrolled >= enroll_cap {
                    return false;
                }
            }
        }
        for block in &candidate.blocks {
            if self.day_blacklist.contains(&block.day) {
                return false;
            }
            if self.earliest_start_min.is_some_and(|earliest| block.start_min < earliest) {
                return false;
            }
            if self.latest_end_min.is_some_and(|latest| block.end_min > latest) {
                return false;
            }
        }
        true
    }
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

/// A complete assignment as ranked by the bounded heap: its sections plus
/// the one evaluation pass (score, breakdown, warnings) made over them.
/// Ties on score keep the earliest-found assignment first.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct Ranked {
    seq: u64,
    sections: Vec<SolutionSection>,
    evaluation: Evaluation,
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
        self.evaluation
            .score
            .total_cmp(&other.evaluation.score)
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
    /// The constraints the search was launched with; they survive a resume
    /// so every chunk scores under the same preset.
    constraints: SolveConstraints,
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
        options: SolveOptions,
    ) -> Solver {
        let fixed = fixed_sections(plan_sections);
        let constraints = SolveConstraints::from(&options);

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

        // MRV: fewest valid sections — conflict-free against the fixed plan
        // *and* allowed by the constraints — first.
        let mut ordered: Vec<(CourseVar, usize)> = unassigned
            .into_iter()
            .map(|course| {
                let valid = root_domain_size(&fixed, &course, &constraints);
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
                constraints,
                assignment: vec![None; courses.len()],
                next_candidate: vec![0; courses.len()],
                courses,
                fixed,
                depth: 0,
                nodes: 0,
                seq: 0,
                results: BoundedBest::new(options.result_limit),
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
            // No unassigned courses: the plan itself is the one result —
            // scored and warned like any other.
            let evaluation =
                scoring::evaluate(&self.state.fixed, self.state.constraints.preset);
            return SolveOutcome {
                status: SolveStatus::Complete,
                solutions: vec![SolveSolution {
                    score: evaluation.score,
                    breakdown: evaluation.breakdown,
                    warnings: evaluation.warnings,
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
                // A complete assignment: evaluate it once (score, breakdown,
                // warnings in a single pass), then backtrack from the last
                // course to keep enumerating.
                let sections = self.build_solution();
                let evaluation =
                    scoring::evaluate(&sections, self.state.constraints.preset);
                self.state.results.push(Ranked {
                    seq: self.state.seq,
                    sections,
                    evaluation,
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
                    score: ranked.evaluation.score,
                    breakdown: ranked.evaluation.breakdown,
                    warnings: ranked.evaluation.warnings,
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
    /// assigned before `depth`, or violates a constraint — the
    /// prune-as-you-go step. Constraints are unary, so they prune as cheaply
    /// as a conflict.
    fn conflicts_with_current(&self, depth: usize, candidate: &SolverSection) -> bool {
        if !self.state.constraints.candidate_allowed(candidate) {
            return true;
        }
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

/// How many of a course's candidates are valid — conflict-free against the
/// fixed plan and allowed by the constraints — the MRV ordering key and the
/// unsatisfiability check.
fn root_domain_size(
    fixed: &[SolutionSection],
    course: &CourseVar,
    constraints: &SolveConstraints,
) -> usize {
    course
        .candidates
        .iter()
        .filter(|candidate| {
            constraints.candidate_allowed(candidate)
                && !fixed
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

    fn f2f_block(day: Day, start_min: i64, end_min: i64, room: &str) -> ScheduleBlock {
        ScheduleBlock {
            day,
            start_min,
            end_min,
            location: Some(room.to_string()),
            modality: BlockModality::F2F,
        }
    }

    fn online_block(day: Day, start_min: i64, end_min: i64) -> ScheduleBlock {
        block(day, start_min, end_min)
    }

    /// Default solve options: the fewest-campus-days preset, no constraints.
    fn options(result_limit: usize) -> SolveOptions {
        SolveOptions {
            preset: Preset::FewestCampusDays,
            day_blacklist: vec![],
            earliest_start_min: None,
            latest_end_min: None,
            exclude_full: false,
            result_limit,
        }
    }

    fn section(section_id: i64, blocks: Vec<ScheduleBlock>) -> SolverSection {
        SolverSection {
            section_id,
            section_code: format!("S{section_id}"),
            blocks,
            enrolled: None,
            enroll_cap: None,
            teacher: None,
        }
    }

    /// A candidate with explicit live numbers: `enrolled` / `enroll_cap`
    /// (`None` = unknown) and a `teacher` (`None` = blank/unknown).
    fn candidate(
        section_id: i64,
        blocks: Vec<ScheduleBlock>,
        enrolled: Option<i64>,
        enroll_cap: Option<i64>,
        teacher: Option<&str>,
    ) -> SolverSection {
        SolverSection {
            section_id,
            section_code: format!("S{section_id}"),
            blocks,
            enrolled,
            enroll_cap,
            teacher: teacher.map(str::to_string),
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

    fn ranked(score: f64, seq: u64) -> Ranked {
        Ranked {
            seq,
            sections: Vec::new(),
            evaluation: Evaluation {
                score,
                breakdown: Vec::new(),
                warnings: Vec::new(),
            },
        }
    }

    /// A solution whose sections all sit on the given days, for asserting
    /// blacklist and bound outcomes.
    fn days_of(solution: &SolveSolution) -> Vec<Day> {
        let mut days: Vec<Day> = solution
            .sections
            .iter()
            .flat_map(|section| section.blocks.iter().map(|block| block.day))
            .collect();
        days.sort_by_key(|day| scoring::day_index(*day));
        days.dedup();
        days
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
                        enrolled: parsed.enrolled,
                        enroll_cap: parsed.enroll_cap,
                        teacher: parsed.teacher.clone(),
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
        let expected_ids: Vec<i64> = compatible.iter().map(|candidate| candidate.section_id).collect();

        let mut solver = Solver::new(courses.clone(), vec![pinned.clone()], options(100));
        let outcome = solver.run();
        assert_eq!(outcome.status, SolveStatus::Complete);
        assert_eq!(outcome.resume_token, None);
        assert!(
            !expected_ids.is_empty(),
            "the test fixture assumption: GEARTAP must offer sections outside the pinned CSINTSY times"
        );
        assert_eq!(outcome.solutions.len(), expected_ids.len(), "every compatible GEARTAP section yields one result");
        let mut chosen_ids: Vec<i64> = outcome
            .solutions
            .iter()
            .map(|solution| {
                solution
                    .sections
                    .iter()
                    .find(|section| !section.pinned)
                    .expect("each solution carries one GEARTAP section")
                    .section_id
            })
            .collect();
        chosen_ids.sort();
        assert_eq!(chosen_ids, expected_ids);
        for solution in &outcome.solutions {
            assert_conflict_free(solution);
            let pinned_section = solution
                .sections
                .iter()
                .find(|section| section.pinned)
                .expect("the plan section must stay in every result");
            assert_eq!(pinned_section.course_id, csintsy.course_id);
            assert_eq!(pinned_section.section_id, chosen.section_id);
            // Every result is ranked: score, readable breakdown, warnings.
            let sum: f64 = solution.breakdown.iter().map(|c| c.points).sum();
            assert!(
                (solution.score - sum).abs() < 1e-9,
                "breakdown must sum to the score"
            );
        }
        // Results arrive sorted by score, best first.
        let scores: Vec<f64> = outcome.solutions.iter().map(|s| s.score).collect();
        let mut sorted_scores = scores.clone();
        sorted_scores.sort_by(|a, b| b.total_cmp(a));
        assert_eq!(scores, sorted_scores, "results are ranked by score");

        // The solve is deterministic: identical input, identical output.
        let mut again = Solver::new(courses, vec![pinned], options(100));
        assert_eq!(again.run().solutions, outcome.solutions);
    }

    // ---------- pinned / no unassigned courses ----------

    #[test]
    fn a_fully_pinned_plan_solves_to_the_plan_itself() {
        let plan = vec![
            fixed(10, 1, vec![f2f_block(Day::Mon, 450, 540, "L226")]),
            fixed(20, 2, vec![f2f_block(Day::Tue, 450, 540, "G207")]),
        ];
        let catalog = vec![
            course(10, "C10", vec![section(9, vec![block(Day::Wed, 450, 540)])]),
            course(20, "C20", vec![section(8, vec![block(Day::Thu, 450, 540)])]),
        ];
        let mut solver = Solver::new(catalog, plan, options(12));
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
        // The plan itself is scored like any result: two lone F2F days on
        // two campus days under the fewest-campus-days preset.
        assert_eq!(solution.score, -2.2);
        let sum: f64 = solution.breakdown.iter().map(|c| c.points).sum();
        assert!((solution.score - sum).abs() < 1e-9);
        assert!(solution.warnings.is_empty());
        assert_eq!(
            solver.nodes_visited(),
            0,
            "no node is spent when nothing is unassigned"
        );
        assert_conflict_free(solution);
    }

    #[test]
    fn solving_an_empty_plan_is_the_degenerate_case_not_an_error() {
        let mut solver = Solver::new(vec![], vec![], options(12));
        let outcome = solver.run();
        assert_eq!(outcome.status, SolveStatus::Complete);
        assert_eq!(outcome.resume_token, None);
        assert_eq!(outcome.solutions.len(), 1);
        let solution = &outcome.solutions[0];
        assert!(solution.sections.is_empty());
        assert_eq!(solution.score, 0.0, "an empty plan scores a neutral zero");
        assert!(solution.warnings.is_empty());
        assert!(
            solution
                .breakdown
                .iter()
                .all(|component| component.points == 0.0),
            "every component of an empty plan is zero: {solution:?}"
        );
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
        let mut solver = Solver::new(vec![impossible, empty, fine], vec![fixed_section], options(12));
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
        let solver = Solver::new(vec![wide.clone(), narrow.clone()], vec![], options(12));
        assert_eq!(solver.course_order(), vec![20, 10]);
        let reversed = Solver::new(vec![narrow, wide], vec![], options(12));
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
        let solver = Solver::new(vec![a, b], vec![], options(12));
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
        let mut solver = Solver::new(vec![a, b], vec![], options(12));
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
        let mut unlimited = Solver::new(synthetic_problem(), vec![], options(12));
        let full = unlimited.run_with_budget(u64::MAX);
        assert_eq!(full.status, SolveStatus::Complete);
        assert_eq!(full.resume_token, None);
        assert_eq!(full.solutions.len(), 12, "bounded by the result limit");
        let expected_nodes = unlimited.nodes_visited();
        assert_eq!(expected_nodes, 1554, "6 + 36 + 216 + 1296 examined candidates");

        // Chunked runs, resuming from the token each time, must enumerate
        // exactly what the unlimited run did — continuing, not restarting.
        let mut solver = Solver::new(synthetic_problem(), vec![], options(12));
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
        let mut solver = Solver::new(synthetic_problem(), vec![], options(5));
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
        let mut solver = Solver::new(synthetic_problem(), vec![], options(12));
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
            best.push(ranked(i as f64, i));
        }
        let scores: Vec<f64> = best
            .sorted()
            .iter()
            .map(|record| record.evaluation.score)
            .collect();
        assert_eq!(scores, vec![5.0, 4.0, 3.0], "higher scores evict lower ones");
    }

    #[test]
    fn bounded_best_ties_keep_the_earliest_found() {
        let mut tied = BoundedBest::new(2);
        for i in 0..4u64 {
            tied.push(ranked(0.0, i));
        }
        let seqs: Vec<u64> = tied.sorted().iter().map(|record| record.seq).collect();
        assert_eq!(seqs, vec![0, 1], "equal scores keep the first-found records");
    }

    // ---------- day blacklist ----------

    #[test]
    fn a_blacklisted_day_never_appears_in_any_result() {
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
                section(1, vec![block(Day::Mon, 570, 660)]),
                section(2, vec![block(Day::Tue, 570, 660)]),
            ],
        );
        let mut options = options(12);
        options.day_blacklist = vec![Day::Mon];
        let mut solver = Solver::new(vec![a, b], vec![], options);
        let outcome = solver.run();

        assert_eq!(outcome.status, SolveStatus::Complete);
        assert_eq!(
            outcome.solutions.len(),
            1,
            "with Monday ruled out, only the Tuesday pairing remains"
        );
        assert_eq!(days_of(&outcome.solutions[0]), vec![Day::Tue]);
        assert_conflict_free(&outcome.solutions[0]);
    }

    #[test]
    fn blacklisting_every_day_of_a_course_names_it_unsatisfiable() {
        let a = course(1, "A", vec![
            section(1, vec![block(Day::Mon, 450, 540)]),
            section(2, vec![block(Day::Tue, 450, 540)]),
        ]);
        let mut options = options(12);
        options.day_blacklist = vec![Day::Mon, Day::Tue];
        let mut solver = Solver::new(vec![a], vec![], options);
        let outcome = solver.run();

        assert_eq!(outcome.status, SolveStatus::Unsatisfiable);
        assert!(outcome.solutions.is_empty());
        assert_eq!(
            outcome.unsatisfiable_courses,
            vec![UnsatisfiableCourse {
                course_id: 1,
                code: "A".to_string(),
            }],
            "a course every one of whose sections is blacklisted is named, not dropped"
        );
    }

    // ---------- time bounds ----------

    #[test]
    fn earliest_start_and_latest_end_bounds_filter_each_block() {
        let early = section(1, vec![block(Day::Mon, 450, 540)]);
        let late = section(2, vec![block(Day::Mon, 870, 960)]);
        // One block violates the earliest bound, the other the latest one.
        let straddling = section(3, vec![
            block(Day::Mon, 450, 540),
            block(Day::Thu, 870, 960),
        ]);
        let course_a = course(1, "A", vec![early, late, straddling]);

        let mut solve_options = options(12);
        solve_options.earliest_start_min = Some(660);
        let mut solver = Solver::new(vec![course_a.clone()], vec![], solve_options);
        let outcome = solver.run();
        assert_eq!(outcome.status, SolveStatus::Complete);
        assert_eq!(outcome.solutions.len(), 1, "only the late section starts at or after 11:00");
        assert!(outcome.solutions[0].sections[0].blocks.iter().all(|block| block.start_min >= 660));

        let mut solve_options = options(12);
        solve_options.latest_end_min = Some(900);
        let mut solver = Solver::new(vec![course_a.clone()], vec![], solve_options);
        let outcome = solver.run();
        assert_eq!(outcome.status, SolveStatus::Complete);
        assert_eq!(outcome.solutions.len(), 1, "only the early section ends by 15:00");
        assert!(outcome.solutions[0].sections[0].blocks.iter().all(|block| block.end_min <= 900));

        // In combination: nothing fits both bounds — named, not silent.
        let mut solve_options = options(12);
        solve_options.earliest_start_min = Some(660);
        solve_options.latest_end_min = Some(900);
        let mut solver = Solver::new(vec![course_a], vec![], solve_options);
        let outcome = solver.run();
        assert_eq!(outcome.status, SolveStatus::Unsatisfiable);
        assert_eq!(outcome.unsatisfiable_courses.len(), 1);
    }

    // ---------- exclude-full ----------

    #[test]
    fn exclude_full_drops_sections_at_or_over_capacity_only_when_enabled() {
        let open = candidate(1, vec![block(Day::Mon, 450, 540)], Some(30), Some(45), None);
        let exactly_full =
            candidate(2, vec![block(Day::Tue, 450, 540)], Some(45), Some(45), None);
        let over_capacity =
            candidate(3, vec![block(Day::Wed, 450, 540)], Some(50), Some(45), None);
        let unknown_fill =
            candidate(4, vec![block(Day::Thu, 450, 540)], None, Some(45), None);
        let course_a = course(1, "A", vec![
            open,
            exactly_full,
            over_capacity,
            unknown_fill,
        ]);

        // Off by default: every section is a candidate.
        let mut solver = Solver::new(vec![course_a.clone()], vec![], options(12));
        let outcome = solver.run();
        assert_eq!(outcome.status, SolveStatus::Complete);
        assert_eq!(outcome.solutions.len(), 4, "exclude-full is off by default");

        // On: sections at or over capacity drop; unknown fill is never
        // treated as full.
        let mut solve_options = options(12);
        solve_options.exclude_full = true;
        let mut solver = Solver::new(vec![course_a], vec![], solve_options);
        let outcome = solver.run();
        assert_eq!(outcome.status, SolveStatus::Complete);
        let ids: Vec<i64> = outcome
            .solutions
            .iter()
            .map(|solution| solution.sections[0].section_id)
            .collect();
        assert_eq!(ids, vec![1, 4], "open and unknown-fill survive; full and over drop");

        // In combination with another constraint: full drops before bounds
        // even apply.
        let mut solve_options = options(12);
        solve_options.exclude_full = true;
        solve_options.earliest_start_min = Some(660);
        let mut solver = Solver::new(
            vec![course(
                1,
                "A",
                vec![
                    candidate(1, vec![block(Day::Mon, 450, 540)], Some(30), Some(45), None),
                    candidate(2, vec![block(Day::Tue, 450, 540)], Some(45), Some(45), None),
                    candidate(3, vec![block(Day::Wed, 870, 960)], Some(50), Some(45), None),
                ],
            )],
            vec![],
            solve_options,
        );
        let outcome = solver.run();
        assert_eq!(outcome.status, SolveStatus::Unsatisfiable, "no section survives both filters");
    }

    // ---------- pinned sections vs constraints ----------

    #[test]
    fn pinned_sections_pass_through_constraints_untouched() {
        // The plan section sits on the very day the student blacklisted.
        // The solver never reassigns it — constraints filter placements,
        // not user-authored choices.
        let pinned = fixed(1, 1, vec![f2f_block(Day::Mon, 450, 540, "L226")]);
        let course_b = course(
            2,
            "B",
            vec![
                section(1, vec![block(Day::Mon, 570, 660)]),
                section(2, vec![block(Day::Tue, 450, 540)]),
            ],
        );
        let mut options = options(12);
        options.day_blacklist = vec![Day::Mon];
        let mut solver = Solver::new(vec![course_b], vec![pinned.clone()], options);
        let outcome = solver.run();

        assert_eq!(outcome.status, SolveStatus::Complete);
        assert_eq!(outcome.solutions.len(), 1, "only the Tuesday section fits");
        let solution = &outcome.solutions[0];
        let pinned_in_result = solution
            .sections
            .iter()
            .find(|section| section.pinned)
            .expect("the pinned section stays in every result");
        assert_eq!(pinned_in_result.section_id, pinned.section_id);
        assert_eq!(days_of(solution), vec![Day::Mon, Day::Tue]);
        assert!(
            solution
                .sections
                .iter()
                .filter(|section| !section.pinned)
                .flat_map(|section| &section.blocks)
                .all(|block| block.day != Day::Mon),
            "the solver never places a block on a blacklisted day"
        );
    }

    // ---------- preset ranking ----------

    #[test]
    fn results_are_ranked_by_the_selected_preset_with_a_readable_breakdown() {
        let a = course(
            1,
            "A",
            vec![
                section(1, vec![f2f_block(Day::Mon, 450, 540, "L226")]),
                section(2, vec![f2f_block(Day::Tue, 450, 540, "L226")]),
            ],
        );
        let b = course(
            2,
            "B",
            vec![
                section(1, vec![f2f_block(Day::Mon, 570, 660, "G207")]),
                section(2, vec![f2f_block(Day::Tue, 570, 660, "G207")]),
            ],
        );
        let mut solver = Solver::new(vec![a, b], vec![], options(12));
        let outcome = solver.run();
        assert_eq!(outcome.status, SolveStatus::Complete);
        assert_eq!(outcome.solutions.len(), 4);

        let scores: Vec<f64> = outcome.solutions.iter().map(|s| s.score).collect();
        let mut sorted = scores.clone();
        sorted.sort_by(|x, y| y.total_cmp(x));
        assert_eq!(scores, sorted, "results come back sorted by score");
        // One campus day beats two, even with the lone-F2F penalty: the
        // single-day schedules score -1.0, the split schedules -2.2.
        assert_eq!(scores, vec![-1.0, -1.0, -2.2, -2.2]);
        for solution in &outcome.solutions {
            let sum: f64 = solution.breakdown.iter().map(|c| c.points).sum();
            assert!((solution.score - sum).abs() < 1e-9);
            assert!(
                solution
                    .breakdown
                    .iter()
                    .any(|c| c.label == "Campus days"),
                "the breakdown names its components: {:?}",
                solution.breakdown
            );
            assert_conflict_free(solution);
        }
    }

    #[test]
    fn the_preset_changes_the_ranking() {
        // Course A: F2F early morning OR online at 11:00. Course B: F2F
        // morning OR online afternoon. Both presets must produce their own
        // ordering over the same four conflict-free combinations.
        let a = course(
            1,
            "A",
            vec![
                section(1, vec![f2f_block(Day::Mon, 450, 540, "L226")]),
                section(2, vec![online_block(Day::Mon, 660, 750)]),
            ],
        );
        let b = course(
            2,
            "B",
            vec![
                section(1, vec![f2f_block(Day::Tue, 450, 540, "G207")]),
                section(2, vec![online_block(Day::Tue, 870, 960)]),
            ],
        );
        let mut campus_options = options(12);
        campus_options.preset = Preset::FewestCampusDays;
        let campus: Vec<f64> = Solver::new(vec![a.clone(), b.clone()], vec![], campus_options)
            .run()
            .solutions
            .iter()
            .map(|s| s.score)
            .collect();

        let mut morning_options = options(12);
        morning_options.preset = Preset::NoEarlyMornings;
        let morning: Vec<f64> = Solver::new(vec![a, b], vec![], morning_options)
            .run()
            .solutions
            .iter()
            .map(|s| s.score)
            .collect();

        assert_ne!(campus, morning, "different presets rank differently");
        for scores in [&campus, &morning] {
            let mut sorted = scores.clone();
            sorted.sort_by(|x, y| y.total_cmp(x));
            assert_eq!(scores, &sorted, "each preset's results are sorted by score");
        }
    }

    // ---------- warnings ----------

    #[test]
    fn a_warning_never_removes_a_result() {
        // The only conflict-free fill is back-to-back F2F → Online. The
        // warning attaches to the result; the result survives.
        let a = course(1, "A", vec![
            section(1, vec![f2f_block(Day::Mon, 450, 540, "L226")]),
        ]);
        let b = course(2, "B", vec![
            section(1, vec![online_block(Day::Mon, 555, 645)]),
        ]);
        let mut solver = Solver::new(vec![a, b], vec![], options(12));
        let outcome = solver.run();

        assert_eq!(outcome.status, SolveStatus::Complete);
        assert_eq!(outcome.solutions.len(), 1, "the warned-about assignment must survive");
        let solution = &outcome.solutions[0];
        assert_eq!(solution.warnings.len(), 1);
        assert_eq!(
            solution.warnings[0].kind,
            crate::core::ipc_types::WarningKind::F2FOnlineBackToBack
        );
        assert_eq!(solution.warnings[0].from.course_id, 1, "the F2F block came first");
        assert_eq!(solution.warnings[0].to.course_id, 2, "the online block followed");
        assert_eq!((solution.warnings[0].start_min, solution.warnings[0].end_min), (540, 555));
    }

    #[test]
    fn a_fully_pinned_plan_is_warned_like_a_result() {
        // The current plan gets its warnings through the solve too: no
        // unassigned courses, but the F2F → Online transition still warns.
        let plan = vec![
            fixed(1, 1, vec![f2f_block(Day::Mon, 450, 540, "L226")]),
            fixed(2, 2, vec![online_block(Day::Mon, 555, 645)]),
        ];
        let mut solver = Solver::new(vec![], plan, options(12));
        let outcome = solver.run();
        assert_eq!(outcome.status, SolveStatus::Complete);
        assert_eq!(outcome.solutions.len(), 1);
        let solution = &outcome.solutions[0];
        assert!(solution.sections.iter().all(|section| section.pinned));
        assert_eq!(solution.warnings.len(), 1);
        assert_eq!(
            solution.warnings[0].kind,
            crate::core::ipc_types::WarningKind::F2FOnlineBackToBack
        );
    }

    // ---------- v1.1 boundaries ----------

    #[test]
    fn section_code_prefixes_never_filter_candidates() {
        // Identical catalogs; only the section codes differ (Y-prefix vs
        // S-prefix). Eligibility by prefix is deliberately deferred.
        let y = course(1, "A", vec![
            SolverSection {
                section_code: "Y31".to_string(),
                ..section(1, vec![block(Day::Mon, 450, 540)])
            },
            SolverSection {
                section_code: "Y32".to_string(),
                ..section(2, vec![block(Day::Tue, 450, 540)])
            },
        ]);
        let s = course(1, "A", vec![
            SolverSection {
                section_code: "S01".to_string(),
                ..section(1, vec![block(Day::Mon, 450, 540)])
            },
            SolverSection {
                section_code: "S02".to_string(),
                ..section(2, vec![block(Day::Tue, 450, 540)])
            },
        ]);
        let y_outcome = Solver::new(vec![y], vec![], options(12)).run();
        let s_outcome = Solver::new(vec![s], vec![], options(12)).run();
        assert_eq!(y_outcome.status, SolveStatus::Complete);
        assert_eq!(y_outcome.solutions.len(), 2);
        assert_eq!(s_outcome.solutions.len(), 2);
        assert_eq!(
            y_outcome
                .solutions
                .iter()
                .map(|solution| solution.sections[0].section_id)
                .collect::<Vec<_>>(),
            s_outcome
                .solutions
                .iter()
                .map(|solution| solution.sections[0].section_id)
                .collect::<Vec<_>>(),
            "section-code prefixes change nothing about validity or ranking"
        );
    }

    #[test]
    fn a_blank_teacher_is_never_treated_as_a_mismatch() {
        // Identical catalogs; one carries a blank (unknown) teacher, the
        // other a named one. No constraint may branch on teacher.
        let blank = course(1, "A", vec![
            candidate(1, vec![block(Day::Mon, 450, 540)], Some(10), Some(45), None),
            candidate(2, vec![block(Day::Tue, 450, 540)], Some(10), Some(45), None),
        ]);
        let named = course(1, "A", vec![
            candidate(1, vec![block(Day::Mon, 450, 540)], Some(10), Some(45), Some("Bryant Lee")),
            candidate(2, vec![block(Day::Tue, 450, 540)], Some(10), Some(45), Some("Someone Else")),
        ]);
        let blank_outcome = Solver::new(vec![blank], vec![], options(12)).run();
        let named_outcome = Solver::new(vec![named], vec![], options(12)).run();
        assert_eq!(blank_outcome.status, named_outcome.status);
        assert_eq!(blank_outcome.solutions.len(), named_outcome.solutions.len());
        assert_eq!(
            blank_outcome
                .solutions
                .iter()
                .map(|solution| solution.sections[0].section_id)
                .collect::<Vec<_>>(),
            named_outcome
                .solutions
                .iter()
                .map(|solution| solution.sections[0].section_id)
                .collect::<Vec<_>>(),
            "a blank teacher changes nothing about the solve"
        );
    }

    // ---------- resume round-trips the constraints ----------

    #[test]
    fn a_resume_token_carries_the_constraints_and_preset() {
        let a = course(1, "A", (0..4)
            .map(|i| section(i + 1, vec![f2f_block(Day::Mon, 450 + i * 90, 540 + i * 90, "L226")]))
            .collect());
        let b = course(2, "B", (0..4)
            .map(|i| section(i + 1, vec![f2f_block(Day::Tue, 450 + i * 90, 540 + i * 90, "G207")]))
            .collect());
        let mut options = options(12);
        options.day_blacklist = vec![Day::Sat];
        options.exclude_full = true;
        options.preset = Preset::MostOnline;

        let full = Solver::new(vec![a.clone(), b.clone()], vec![], options.clone())
            .run_with_budget(u64::MAX);
        assert_eq!(full.status, SolveStatus::Complete);

        let mut solver = Solver::new(vec![a, b], vec![], options);
        loop {
            let outcome = solver.run_with_budget(5);
            assert_eq!(
                outcome.solutions,
                full.solutions[..outcome.solutions.len()],
                "resumed chunks score under the same constraints and preset"
            );
            match outcome.status {
                SolveStatus::Partial => {
                    solver = Solver::from_token(
                        outcome.resume_token.as_deref().expect("partial carries a token"),
                    )
                    .expect("the token must resume");
                }
                SolveStatus::Complete => break,
                other => panic!("unexpected status {other:?}"),
            }
        }
        assert_eq!(solver.run().solutions, full.solutions);
    }
}
