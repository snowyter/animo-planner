//! Headless manual-refresh core (ticket 16): the state machine that drives a
//! plan refresh, course by course, without ever touching the popup or the
//! store itself.
//!
//! A refresh re-runs the search for every course already in the plan,
//! sequentially, roughly [`DEFAULT_REFRESH_STEP_INTERVAL_MS`] apart. The
//! driver (ticket 21) owns the popup: it asks this runner for the next
//! course, re-selects it in the Course Finder, waits for the render, and
//! hands the resulting page back. This module decides what is trustworthy,
//! what must be discarded, and when the run must halt.
//!
//! Validity of a response is asserted by checking that the results table
//! exists **and** that the course selected in the dropdown is the course
//! that was requested — never by inspecting the URL (SPEC §4). A response
//! failing that check is discarded, and because a stale-but-present table is
//! exactly the failure mode that would silently write one course's counts
//! onto another, the run halts the moment a response cannot be trusted.
//!
//! Guarantees:
//! - Session expiry (or any unverifiable response) halts the run immediately
//!   and keeps the partial result: every course refreshed before the halt
//!   stays recorded. The driver persists each `Refreshed` outcome as it
//!   lands, so "keeping the partial result" is not a rollback — it is
//!   simply never touched.
//! - A halted run mints a resume token that continues from the halted
//!   course, not from the beginning.
//! - A plan section that no longer appears in its course's fresh results is
//!   reported as missing — never deleted (ADR-0008); the storage layer is
//!   what flags it.
//! - Offline before anything was refreshed changes nothing and reports
//!   [`RefreshStatus::Offline`]; offline mid-run keeps the partial result.

use crate::core::ipc_types::{RefreshOutcome, RefreshStatus};
use crate::core::parser::{self, DiagnosticSeverity, ParsedSection, SelectorConfig};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fmt;

/// How long the driver waits between re-selecting one course and the next
/// (SPEC §4: "sequentially, ~1.5 s apart"). The runner never sleeps — it is
/// driven step by step — but the pacing is part of the refresh contract,
/// so it lives here rather than as an undocumented driver detail.
pub const DEFAULT_REFRESH_STEP_INTERVAL_MS: u64 = 1500;

/// Version stamped into serialized resume state; bumping it invalidates
/// resume tokens minted by older builds.
const REFRESH_STATE_VERSION: u32 = 1;

/// One course the refresh must re-run, in plan order. `plan_section_ids` are
/// the section ids of this course currently held in the plan — the runner
/// compares them against the fresh results to detect sections that vanished.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RefreshCourse {
    pub course_id: i64,
    pub code: String,
    pub plan_section_ids: Vec<i64>,
}

/// What the driver's fetch step produced for the requested course.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FetchResult {
    /// A page rendered; the runner reads the selected course and the results
    /// table from this HTML and decides whether it can be trusted.
    Page { html: String },
    /// The session died (login page, no table): halt immediately.
    SessionExpired,
    /// No network: nothing can be fetched.
    Offline,
}

/// What the driver should do next.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum NextStep<'a> {
    /// Fetch the results page for this course, then call
    /// [`RefreshRun::complete`]. `course_index` is the zero-based position
    /// of the course in the run; `course_total` is the whole run's length —
    /// together they feed the `refresh:progress` event.
    Fetch {
        course: &'a RefreshCourse,
        course_index: usize,
        course_total: usize,
    },
    /// The run is over; `finish.outcome` is the answer for the student.
    Ended { finish: RefreshFinish },
}

/// The end state of a run: the wire-ready outcome plus the resume token a
/// halted run mints.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RefreshFinish {
    pub outcome: RefreshOutcome,
    /// Present exactly when the run halted before completing; the driver
    /// keeps it (per plan) and passes it to [`RefreshRun::from_token`].
    pub resume_token: Option<String>,
}

/// What one completed fetch step decided.
#[derive(Debug, Clone, PartialEq)]
pub enum StepOutcome {
    /// The response was valid. The driver persists `sections` (the store
    /// appends snapshots and upserts rows) and records `missing_section_ids`
    /// — plan sections of this course that the fresh results no longer
    /// carry. The run continues with the next course.
    Refreshed {
        course_id: i64,
        code: String,
        sections: Vec<ParsedSection>,
        missing_section_ids: Vec<i64>,
    },
    /// The run halted; nothing from this response may be stored. The finish
    /// carries the partial result and the resume token.
    Halted { finish: RefreshFinish },
}

/// Failure to resume a refresh run from a token.
#[derive(Debug)]
pub enum RefreshError {
    /// The token could not be decoded, carries another state version, or
    /// violates the run-state invariants.
    InvalidResumeToken { detail: String },
}

impl fmt::Display for RefreshError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            RefreshError::InvalidResumeToken { detail } => {
                write!(f, "invalid refresh resume token: {detail}")
            }
        }
    }
}

impl std::error::Error for RefreshError {}

/// Serializable run state, so a halted run can be resumed across calls.
#[derive(Debug, Serialize, Deserialize)]
struct RefreshState {
    version: u32,
    total_courses: usize,
    refreshed_codes: Vec<String>,
    remaining: Vec<CourseState>,
}

#[derive(Debug, Serialize, Deserialize)]
struct CourseState {
    course_id: i64,
    code: String,
    plan_section_ids: Vec<i64>,
}

/// The runner: one plan refresh, driven step by step by the driver.
pub struct RefreshRun {
    /// Courses not yet successfully refreshed, in run order. The halted
    /// course is pushed back to the front on halt, so a resume re-attempts
    /// it first.
    remaining: Vec<RefreshCourse>,
    /// Codes of courses refreshed so far; the last entry is the answer for
    /// `halted_after_course_code`.
    refreshed_codes: Vec<String>,
    total_courses: usize,
    /// The course currently awaiting a [`RefreshRun::complete`] call.
    current: Option<RefreshCourse>,
    /// Set once the run halts; `next_course` keeps returning it.
    halted: Option<RefreshFinish>,
}

impl RefreshRun {
    /// Starts a fresh run over the plan's courses, in the given order. An
    /// empty plan ends immediately with a complete, zero-course outcome.
    pub fn start(courses: Vec<RefreshCourse>) -> RefreshRun {
        RefreshRun {
            total_courses: courses.len(),
            remaining: courses,
            refreshed_codes: Vec::new(),
            current: None,
            halted: None,
        }
    }

    /// Rebuilds a halted run from a token minted by [`RefreshRun::halt`].
    /// The token carries the remaining courses as of the halt, so resuming
    /// continues from the halted course rather than restarting.
    pub fn from_token(token: &str) -> Result<RefreshRun, RefreshError> {
        let invalid = |detail: String| RefreshError::InvalidResumeToken { detail };
        let state: RefreshState = serde_json::from_str(token)
            .map_err(|err| invalid(format!("token is not valid state JSON: {err}")))?;
        if state.version != REFRESH_STATE_VERSION {
            return Err(invalid(format!(
                "state version {} is not supported",
                state.version
            )));
        }
        if state.total_courses == 0 {
            return Err(invalid("a token must carry a non-empty run".to_string()));
        }
        if state.refreshed_codes.len() + state.remaining.len() != state.total_courses {
            return Err(invalid(
                "refreshed and remaining courses do not add up to the total".to_string(),
            ));
        }
        for course in &state.remaining {
            if course.course_id <= 0 {
                return Err(invalid(format!(
                    "remaining course {} has a non-positive id",
                    course.code
                )));
            }
            if course.code.trim().is_empty() {
                return Err(invalid("a remaining course has no code".to_string()));
            }
        }
        Ok(RefreshRun {
            remaining: state
                .remaining
                .into_iter()
                .map(|course| RefreshCourse {
                    course_id: course.course_id,
                    code: course.code,
                    plan_section_ids: course.plan_section_ids,
                })
                .collect(),
            refreshed_codes: state.refreshed_codes,
            total_courses: state.total_courses,
            current: None,
            halted: None,
        })
    }

    /// The next action for the driver. Call [`RefreshRun::complete`] with
    /// the fetch result before asking again.
    pub fn next_course(&mut self) -> NextStep<'_> {
        if let Some(finish) = &self.halted {
            return NextStep::Ended { finish: finish.clone() };
        }
        if self.remaining.is_empty() {
            return NextStep::Ended {
                finish: RefreshFinish {
                    outcome: self.complete_outcome(),
                    resume_token: None,
                },
            };
        }
        assert!(
            self.current.is_none(),
            "complete the in-flight course before requesting the next one"
        );
        self.current = Some(self.remaining.remove(0));
        let course = self.current.as_ref().expect("the current course was just set");
        NextStep::Fetch {
            course,
            course_index: self.refreshed_codes.len(),
            course_total: self.total_courses,
        }
    }

    /// Hands one fetch result back for the in-flight course and decides
    /// whether it can be stored, discarded, or must halt the run.
    pub fn complete(&mut self, result: FetchResult, config: &SelectorConfig) -> StepOutcome {
        let current = self
            .current
            .take()
            .expect("complete requires an in-flight course from next_course");
        match result {
            FetchResult::Offline => self.halt(&current, RefreshStatus::Offline),
            FetchResult::SessionExpired => self.halt(&current, RefreshStatus::SessionExpired),
            FetchResult::Page { html } => match validate_and_parse(&current, &html, config) {
                Ok(sections) => self.record(&current, sections),
                Err(()) => self.halt(&current, RefreshStatus::SessionExpired),
            },
        }
    }

    /// The wire-ready outcome of a completed run.
    fn complete_outcome(&self) -> RefreshOutcome {
        RefreshOutcome {
            status: RefreshStatus::Complete,
            refreshed_courses: self.refreshed_codes.len() as i64,
            total_courses: self.total_courses as i64,
            halted_after_course_code: None,
        }
    }

    /// Records a trusted response and advances the run.
    fn record(&mut self, current: &RefreshCourse, sections: Vec<ParsedSection>) -> StepOutcome {
        let present: HashSet<i64> = sections.iter().map(|section| section.section_id).collect();
        let missing_section_ids: Vec<i64> = current
            .plan_section_ids
            .iter()
            .copied()
            .filter(|section_id| !present.contains(section_id))
            .collect();
        self.refreshed_codes.push(current.code.clone());
        StepOutcome::Refreshed {
            course_id: current.course_id,
            code: current.code.clone(),
            sections,
            missing_section_ids,
        }
    }

    /// Halts the run, keeping everything already refreshed, and mints the
    /// resume token. The halted course goes back to the front of the queue
    /// so a resume re-attempts it first.
    fn halt(&mut self, current: &RefreshCourse, status: RefreshStatus) -> StepOutcome {
        self.remaining.insert(0, current.clone());
        let outcome = RefreshOutcome {
            status,
            refreshed_courses: self.refreshed_codes.len() as i64,
            total_courses: self.total_courses as i64,
            halted_after_course_code: self.refreshed_codes.last().cloned(),
        };
        let finish = RefreshFinish {
            outcome,
            resume_token: Some(self.to_token()),
        };
        self.halted = Some(finish.clone());
        StepOutcome::Halted { finish }
    }

    fn to_token(&self) -> String {
        let state = RefreshState {
            version: REFRESH_STATE_VERSION,
            total_courses: self.total_courses,
            refreshed_codes: self.refreshed_codes.clone(),
            remaining: self
                .remaining
                .iter()
                .map(|course| CourseState {
                    course_id: course.course_id,
                    code: course.code.clone(),
                    plan_section_ids: course.plan_section_ids.clone(),
                })
                .collect(),
        };
        serde_json::to_string(&state).expect("refresh state must serialize")
    }
}

/// Asserts the response's validity: the results table must exist **and**
/// the dropdown's selected course must be the course that was requested
/// (SPEC §4 — never the URL). Returns the parsed sections, or `Err(())`
/// when the response cannot be trusted.
fn validate_and_parse(
    current: &RefreshCourse,
    html: &str,
    config: &SelectorConfig,
) -> Result<Vec<ParsedSection>, ()> {
    let selected = parser::course_context_from_html(html, config).map_err(|_| ())?;
    if selected.course_id != current.course_id {
        // A stale-but-present table would write this course's counts onto
        // another: discard, never store.
        return Err(());
    }
    let parsed = parser::parse_results_table(html, &selected, config).map_err(|_| ())?;
    if parsed.sections.is_empty()
        && parsed
            .diagnostics
            .iter()
            .any(|diagnostic| diagnostic.severity == DiagnosticSeverity::Error)
    {
        return Err(());
    }
    Ok(parsed.sections)
}

#[cfg(test)]
mod tests {
    use super::*;

    const CSINTSY_FIXTURE: &str =
        include_str!("../../tests/fixtures/ArchersHub-Course-Finder-CSINTSY.html");
    const GEARTAP_FIXTURE: &str =
        include_str!("../../tests/fixtures/ArchersHub-Course-Finder-GEARTAP.html");

    fn csintsy() -> RefreshCourse {
        RefreshCourse {
            course_id: 2923,
            code: "CSINTSY".into(),
            plan_section_ids: vec![384, 385],
        }
    }

    fn geartap() -> RefreshCourse {
        RefreshCourse {
            course_id: 564,
            code: "GEARTAP".into(),
            plan_section_ids: vec![737],
        }
    }

    fn third_course() -> RefreshCourse {
        RefreshCourse {
            course_id: 301,
            code: "THIRD".into(),
            plan_section_ids: vec![900],
        }
    }

    /// One synthetic results row, shaped like the real page: 12 cells, the
    /// trailing identity cells hidden.
    fn row(course_id: i64, section_id: i64, section_code: &str) -> String {
        format!(
            "<tr data-end-date=\"12/09/2026\" data-start-date=\"07/10/2026\">\
             <td>Lecture</td><td></td><td>3</td><td>{section_code}</td>\
             <td>[ MONDAY - 07:30 AM - 09:00 AM : Online ]</td>\
             <td>45</td><td>10</td><td></td>\
             <td><button type=\"button\">Add</button></td>\
             <td hidden>{course_id}</td><td hidden>{section_id}</td><td hidden></td>\
             </tr>"
        )
    }

    /// A synthetic Course Finder page whose dropdown selects `course_id`.
    fn course_page(course_id: i64, code_title: &str, rows: &str) -> String {
        format!(
            "<html><body>\
             <select id=\"ddlSelectCourse\">\
               <option value=\"{course_id}\" selected>{code_title}</option>\
             </select>\
             <table id=\"tblCourseSelection\"><thead><tr><th>a</th></tr></thead>\
             <tbody>{rows}</tbody></table>\
             </body></html>"
        )
    }

    /// A page that carries a dropdown but no results table — what the login
    /// page looks like after a session expiry.
    fn expired_page(course_id: i64, code_title: &str) -> String {
        format!(
            "<html><body>\
             <select id=\"ddlSelectCourse\">\
               <option value=\"{course_id}\" selected>{code_title}</option>\
             </select>\
             <p>Please sign in.</p>\
             </body></html>"
        )
    }

    /// Drives a run to its end; returns the finish and the refresh steps.
    fn drive(
        run: &mut RefreshRun,
        fetches: &[FetchResult],
    ) -> (RefreshFinish, Vec<StepOutcome>) {
        let config = SelectorConfig::default();
        let mut steps = Vec::new();
        let mut next = fetches.iter();
        loop {
            match run.next_course() {
                NextStep::Fetch { .. } => {
                    let result = next
                        .next()
                        .expect("one fetch result per course")
                        .clone();
                    steps.push(run.complete(result, &config));
                }
                NextStep::Ended { finish } => return (finish, steps),
            }
        }
    }

    fn page(course_id: i64, code: &str, section_id: i64) -> FetchResult {
        FetchResult::Page {
            html: course_page(course_id, &format!("{code} - TITLE"), &row(course_id, section_id, "S01")),
        }
    }

    // ---------- clean full refresh ----------

    #[test]
    fn clean_full_refresh_of_two_courses_completes() {
        let mut run = RefreshRun::start(vec![csintsy(), geartap()]);
        let fetches = [
            FetchResult::Page { html: CSINTSY_FIXTURE.into() },
            FetchResult::Page { html: GEARTAP_FIXTURE.into() },
        ];
        let (finish, steps) = drive(&mut run, &fetches);

        assert_eq!(finish.outcome.status, RefreshStatus::Complete);
        assert_eq!(finish.outcome.refreshed_courses, 2);
        assert_eq!(finish.outcome.total_courses, 2);
        assert_eq!(finish.outcome.halted_after_course_code, None);
        assert_eq!(finish.resume_token, None, "a complete run has nothing to resume");

        assert_eq!(steps.len(), 2, "one step per course");
        match &steps[0] {
            StepOutcome::Refreshed { course_id, sections, missing_section_ids, .. } => {
                assert_eq!(*course_id, 2923);
                assert_eq!(sections.len(), 5, "CSINTSY has 5 sections");
                assert!(missing_section_ids.is_empty(), "both plan sections appear");
            }
            other => panic!("first step must refresh, got {other:?}"),
        }
        match &steps[1] {
            StepOutcome::Refreshed { course_id, sections, missing_section_ids, .. } => {
                assert_eq!(*course_id, 564);
                assert_eq!(sections.len(), 42, "GEARTAP has 42 sections");
                assert!(missing_section_ids.is_empty());
            }
            other => panic!("second step must refresh, got {other:?}"),
        }
    }

    #[test]
    fn courses_are_fetched_in_plan_order_with_progress_indices() {
        let mut run = RefreshRun::start(vec![csintsy(), geartap(), third_course()]);
        let config = SelectorConfig::default();
        let mut seen: Vec<(usize, usize, String)> = Vec::new();
        for expected_code in ["CSINTSY", "GEARTAP", "THIRD"] {
            match run.next_course() {
                NextStep::Fetch { course, course_index, course_total } => {
                    assert_eq!(course.code, expected_code);
                    assert_eq!(course_total, 3);
                    seen.push((course_index, course_total, course.code.clone()));
                    let course_id = course.course_id;
                    let code = course.code.clone();
                    let result = run.complete(page(course_id, &code, 1), &config);
                    assert!(matches!(result, StepOutcome::Refreshed { .. }));
                }
                other => panic!("expected a fetch for {expected_code}, got {other:?}"),
            }
        }
        assert_eq!(
            seen,
            vec![(0, 3, "CSINTSY".into()), (1, 3, "GEARTAP".into()), (2, 3, "THIRD".into())],
            "progress indices advance with the plan order"
        );
    }

    // ---------- missing-section detection ----------

    #[test]
    fn a_plan_section_absent_from_the_fresh_results_is_flagged_not_removed() {
        let mut run = RefreshRun::start(vec![csintsy()]);
        let (finish, steps) = drive(&mut run, &[FetchResult::Page { html: CSINTSY_FIXTURE.into() }]);

        assert_eq!(finish.outcome.status, RefreshStatus::Complete);
        match &steps[0] {
            StepOutcome::Refreshed { sections, missing_section_ids, .. } => {
                assert_eq!(sections.len(), 5);
                assert!(missing_section_ids.is_empty(), "384 and 385 are both present");
            }
            other => panic!("must refresh, got {other:?}"),
        }

        // A plan section that has vanished: 9999 was in the plan but the
        // course's fresh results no longer carry it.
        let mut run = RefreshRun::start(vec![RefreshCourse {
            course_id: 2923,
            code: "CSINTSY".into(),
            plan_section_ids: vec![384, 9999],
        }]);
        let (finish, steps) = drive(&mut run, &[FetchResult::Page { html: CSINTSY_FIXTURE.into() }]);
        assert_eq!(finish.outcome.status, RefreshStatus::Complete, "missing never halts the run");
        match &steps[0] {
            StepOutcome::Refreshed { sections, missing_section_ids, .. } => {
                assert_eq!(sections.len(), 5, "the fresh sections are still recorded");
                assert_eq!(
                    *missing_section_ids,
                    vec![9999],
                    "the vanished plan section is flagged, in plan order"
                );
            }
            other => panic!("must refresh, got {other:?}"),
        }
    }

    // ---------- stale table ----------

    #[test]
    fn a_stale_table_matching_a_different_course_is_discarded_and_halts() {
        let mut run = RefreshRun::start(vec![csintsy(), geartap()]);
        let config = SelectorConfig::default();

        match run.next_course() {
            NextStep::Fetch { .. } => {}
            other => panic!("expected a fetch, got {other:?}"),
        }
        // The driver requested CSINTSY but the page still shows GEARTAP's
        // table — the stale-but-present failure mode this ticket exists to
        // prevent.
        let result = run.complete(
            FetchResult::Page { html: GEARTAP_FIXTURE.into() },
            &config,
        );
        match result {
            StepOutcome::Halted { finish } => {
                assert_eq!(finish.outcome.status, RefreshStatus::SessionExpired);
                assert_eq!(finish.outcome.refreshed_courses, 0, "the stale response is not stored");
                assert_eq!(finish.outcome.total_courses, 2);
                assert_eq!(finish.outcome.halted_after_course_code, None);
                assert!(finish.resume_token.is_some(), "a halted run can be resumed");
            }
            other => panic!("a stale table must halt, got {other:?}"),
        }

        // The run keeps reporting its halted state.
        match run.next_course() {
            NextStep::Ended { finish } => {
                assert_eq!(finish.outcome.status, RefreshStatus::SessionExpired);
            }
            other => panic!("a halted run must end, got {other:?}"),
        }
    }

    // ---------- mid-run expiry and resume ----------

    #[test]
    fn mid_run_expiry_keeps_the_partial_result_and_resume_continues_from_the_halted_course() {
        let mut run = RefreshRun::start(vec![csintsy(), geartap(), third_course()]);
        let fetches = [
            FetchResult::Page { html: CSINTSY_FIXTURE.into() },
            FetchResult::Page { html: GEARTAP_FIXTURE.into() },
            FetchResult::SessionExpired,
        ];
        let (finish, steps) = drive(&mut run, &fetches);

        assert_eq!(finish.outcome.status, RefreshStatus::SessionExpired);
        assert_eq!(finish.outcome.refreshed_courses, 2, "the partial result is kept");
        assert_eq!(finish.outcome.total_courses, 3);
        assert_eq!(
            finish.outcome.halted_after_course_code.as_deref(),
            Some("GEARTAP"),
            "the halt is named after the last successfully refreshed course"
        );
        assert_eq!(steps.len(), 3);
        assert!(matches!(steps[2], StepOutcome::Halted { .. }));

        let token = finish.resume_token.expect("a halted run mints a token");
        let mut resumed = RefreshRun::from_token(&token).expect("the token must resume");

        // Resume continues at the halted course, not from the beginning.
        match resumed.next_course() {
            NextStep::Fetch { course, course_index, course_total } => {
                assert_eq!(course.code, "THIRD", "the halted course is re-attempted first");
                assert_eq!(course_index, 2, "progress continues, it does not restart");
                assert_eq!(course_total, 3);
                let result = resumed.complete(page(301, "THIRD", 900), &SelectorConfig::default());
                assert!(matches!(result, StepOutcome::Refreshed { .. }));
            }
            other => panic!("resume must fetch the halted course, got {other:?}"),
        }

        match resumed.next_course() {
            NextStep::Ended { finish } => {
                assert_eq!(finish.outcome.status, RefreshStatus::Complete);
                assert_eq!(finish.outcome.refreshed_courses, 3);
                assert_eq!(finish.outcome.halted_after_course_code, None);
                assert_eq!(finish.resume_token, None);
            }
            other => panic!("the resumed run must complete, got {other:?}"),
        }
    }

    #[test]
    fn expiry_on_the_very_first_course_halts_with_nothing_refreshed() {
        let mut run = RefreshRun::start(vec![csintsy(), geartap()]);
        let (finish, steps) = drive(&mut run, &[FetchResult::SessionExpired]);

        assert_eq!(finish.outcome.status, RefreshStatus::SessionExpired);
        assert_eq!(finish.outcome.refreshed_courses, 0);
        assert_eq!(finish.outcome.halted_after_course_code, None);
        assert_eq!(steps.len(), 1);
        assert!(finish.resume_token.is_some());
    }

    // ---------- offline ----------

    #[test]
    fn offline_before_the_first_fetch_changes_nothing_and_says_so() {
        let mut run = RefreshRun::start(vec![csintsy(), geartap()]);
        let (finish, steps) = drive(&mut run, &[FetchResult::Offline]);

        assert_eq!(finish.outcome.status, RefreshStatus::Offline);
        assert_eq!(finish.outcome.refreshed_courses, 0, "nothing was fetched, nothing is stored");
        assert_eq!(finish.outcome.halted_after_course_code, None);
        assert_eq!(steps.len(), 1);
        assert!(matches!(steps[0], StepOutcome::Halted { .. }));
    }

    #[test]
    fn offline_mid_run_keeps_the_partial_result() {
        let mut run = RefreshRun::start(vec![csintsy(), geartap()]);
        let fetches = [
            FetchResult::Page { html: CSINTSY_FIXTURE.into() },
            FetchResult::Offline,
        ];
        let (finish, steps) = drive(&mut run, &fetches);

        assert_eq!(finish.outcome.status, RefreshStatus::Offline);
        assert_eq!(finish.outcome.refreshed_courses, 1, "the partial result survives");
        assert_eq!(
            finish.outcome.halted_after_course_code.as_deref(),
            Some("CSINTSY")
        );
        assert_eq!(steps.len(), 2);
    }

    // ---------- unverifiable pages ----------

    #[test]
    fn a_page_without_the_results_table_is_session_expiry() {
        let mut run = RefreshRun::start(vec![csintsy()]);
        let (finish, steps) = drive(
            &mut run,
            &[FetchResult::Page { html: expired_page(2923, "CSINTSY - TITLE") }],
        );

        assert_eq!(finish.outcome.status, RefreshStatus::SessionExpired);
        assert_eq!(finish.outcome.refreshed_courses, 0);
        assert!(matches!(steps[0], StepOutcome::Halted { .. }), "nothing may be stored");
    }

    #[test]
    fn a_page_whose_dropdown_cannot_be_read_is_rejected() {
        let mut run = RefreshRun::start(vec![csintsy()]);
        let html = course_page(2923, "CSINTSY - TITLE", &row(2923, 384, "S01"))
            .replace("<select id=\"ddlSelectCourse\">", "<select id=\"something-else\">");
        let (finish, steps) = drive(&mut run, &[FetchResult::Page { html }]);

        assert_eq!(
            finish.outcome.status,
            RefreshStatus::SessionExpired,
            "validity cannot be asserted, so the response cannot be trusted"
        );
        assert!(matches!(steps[0], StepOutcome::Halted { .. }));
    }

    #[test]
    fn a_page_parsing_to_zero_sections_with_row_errors_is_rejected() {
        let mut run = RefreshRun::start(vec![csintsy()]);
        // Rows carry another course's id: parser errors, zero sections.
        let html = course_page(2923, "CSINTSY - TITLE", &row(9999, 384, "S01"));
        let (finish, steps) = drive(&mut run, &[FetchResult::Page { html }]);

        assert_eq!(finish.outcome.status, RefreshStatus::SessionExpired);
        assert!(matches!(steps[0], StepOutcome::Halted { .. }));
    }

    // ---------- resume token ----------

    #[test]
    fn garbled_or_versioned_away_resume_tokens_are_rejected() {
        assert!(RefreshRun::from_token("not json").is_err());
        assert!(RefreshRun::from_token("{\"version\":99}").is_err());
        assert!(
            RefreshRun::from_token(
                "{\"version\":1,\"total_courses\":3,\"refreshed_codes\":[\"A\"],\
                 \"remaining\":[{\"course_id\":1,\"code\":\"B\",\"plan_section_ids\":[]}]}"
            )
            .is_err(),
            "refreshed + remaining must add up to the total"
        );
        assert!(
            RefreshRun::from_token(
                "{\"version\":1,\"total_courses\":1,\"refreshed_codes\":[],\
                 \"remaining\":[{\"course_id\":1,\"code\":\"\",\"plan_section_ids\":[]}]}"
            )
            .is_err(),
            "a course without a code is not resumable"
        );

        // A token minted by a real halt round-trips.
        let mut run = RefreshRun::start(vec![csintsy(), geartap()]);
        let (finish, _) = drive(&mut run, &[FetchResult::SessionExpired]);
        let token = finish.resume_token.expect("a halted run mints a token");
        assert!(RefreshRun::from_token(&token).is_ok());
    }

    // ---------- degenerate runs ----------

    #[test]
    fn an_empty_course_list_completes_immediately() {
        let mut run = RefreshRun::start(vec![]);
        match run.next_course() {
            NextStep::Ended { finish } => {
                assert_eq!(finish.outcome.status, RefreshStatus::Complete);
                assert_eq!(finish.outcome.refreshed_courses, 0);
                assert_eq!(finish.outcome.total_courses, 0);
                assert_eq!(finish.resume_token, None);
            }
            other => panic!("an empty plan has nothing to fetch, got {other:?}"),
        }
    }

    #[test]
    fn the_step_interval_is_one_and_a_half_seconds() {
        assert_eq!(DEFAULT_REFRESH_STEP_INTERVAL_MS, 1500);
    }
}
