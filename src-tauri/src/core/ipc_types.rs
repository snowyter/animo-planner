//! Wire types for the Tauri IPC seam.
//!
//! The single source of truth for these shapes is `docs/ipc-contract.md`; the
//! amendment protocol there requires Rust and TypeScript sides to move together.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum Day {
    Mon,
    Tue,
    Wed,
    Thu,
    Fri,
    Sat,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum BlockModality {
    F2F,
    Online,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum SectionModality {
    F2F,
    Online,
    Hybrid,
}

/// One meeting of a section on one day. Modality belongs to the block (ADR-0007),
/// and `location` is `null` exactly when the block is online.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleBlock {
    pub day: Day,
    pub start_min: i64,
    pub end_min: i64,
    pub location: Option<String>,
    pub modality: BlockModality,
}

impl ScheduleBlock {
    pub fn is_well_formed(&self) -> bool {
        matches!(self.modality, BlockModality::Online) == self.location.is_none()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SectionRef {
    pub course_id: i64,
    pub section_id: i64,
}

/// Point-in-time reading of a section's mutable values. `teacher: None` means
/// *unknown* — never "not this professor".
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub captured_at: String,
    pub enrolled: i64,
    pub teacher: Option<String>,
    pub remark: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Section {
    pub campus_id: i64,
    pub session_id: i64,
    pub course_id: i64,
    pub course_code: String,
    pub course_title: String,
    pub section_id: i64,
    pub section_code: String,
    pub course_type: Option<String>,
    pub credits: Option<f64>,
    pub enroll_cap: i64,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    pub first_seen_at: String,
    pub last_seen_at: String,
    pub modality: SectionModality,
    pub blocks: Vec<ScheduleBlock>,
    pub latest_snapshot: Snapshot,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapturedCourse {
    pub course_id: i64,
    pub code: String,
    pub title: String,
    pub section_count: i64,
    pub first_seen_at: String,
    pub last_seen_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanSection {
    pub course_id: i64,
    pub course_code: String,
    pub course_title: String,
    pub section_id: i64,
    pub section_code: String,
    pub pinned: bool,
    pub missing: bool,
    pub modality: SectionModality,
    pub blocks: Vec<ScheduleBlock>,
    pub latest_snapshot: Snapshot,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanSummary {
    pub id: String,
    pub name: String,
    pub campus_id: i64,
    pub campus_name: String,
    pub session_id: i64,
    pub session_name: String,
    pub created_at: String,
    pub section_count: i64,
}

/// A plan is hard-scoped to exactly one `(campus, session)`; the ids are
/// non-optional by construction.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Plan {
    pub id: String,
    pub name: String,
    pub campus_id: i64,
    pub campus_name: String,
    pub session_id: i64,
    pub session_name: String,
    pub created_at: String,
    pub section_count: i64,
    pub sections: Vec<PlanSection>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CampusOption {
    pub id: i64,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionOption {
    pub id: i64,
    pub name: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SelectorConfigSource {
    Remote,
    Bundled,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub app_version: String,
    pub selector_config_version: String,
    pub selector_config_source: SelectorConfigSource,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Conflict {
    pub a: SectionRef,
    pub b: SectionRef,
    pub day: Day,
    pub start_min: i64,
    pub end_min: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Preset {
    FewestCampusDays,
    NoEarlyMornings,
    MostOnline,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SolveOptions {
    pub preset: Preset,
    #[serde(default)]
    pub day_blacklist: Vec<Day>,
    #[serde(default)]
    pub earliest_start_min: Option<i64>,
    #[serde(default)]
    pub latest_end_min: Option<i64>,
    #[serde(default = "default_exclude_full")]
    pub exclude_full: bool,
    #[serde(default = "default_result_limit")]
    pub result_limit: usize,
}

fn default_result_limit() -> usize {
    12
}

/// Ticket 34: exclude-full defaults to on — a section at capacity cannot be
/// enlisted into, so a fresh solve never builds around one. The student can
/// still turn it off in secondary constraints.
fn default_exclude_full() -> bool {
    true
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SolutionSection {
    pub course_id: i64,
    pub course_code: String,
    pub section_id: i64,
    pub section_code: String,
    pub pinned: bool,
    pub blocks: Vec<ScheduleBlock>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum WarningKind {
    // Spelled out per variant: `rename_all = "snake_case"` turns
    // `F2FOnlineBackToBack` into `f2_f_online_back_to_back`, because it breaks
    // before every capital and "F2F" is three of them. The contract declares
    // `f2f_online_back_to_back`, the frontend switches on that, and a mismatch
    // renders as an empty warning box rather than an error.
    #[serde(rename = "f2f_online_back_to_back")]
    F2FOnlineBackToBack,
    #[serde(rename = "f2f_f2f_different_buildings")]
    F2FF2FDifferentBuildings,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransitionWarning {
    pub kind: WarningKind,
    pub day: Day,
    pub start_min: i64,
    pub end_min: i64,
    pub from: SectionRef,
    pub to: SectionRef,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScoreComponent {
    pub label: String,
    pub points: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Solution {
    pub id: String,
    pub score: f64,
    pub breakdown: Vec<ScoreComponent>,
    pub warnings: Vec<TransitionWarning>,
    pub sections: Vec<SolutionSection>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SolveStatus {
    Complete,
    Partial,
    Cancelled,
    Unsatisfiable,
}

/// Why a course could not be filled (ticket 34). `all_sections_full` names
/// exclude-full as the cause, so "no solutions" never appears without
/// saying why — the student can turn the constraint off if the numbers look
/// stale. `no_valid_section` covers every other cause: no captured
/// sections, conflicts against the plan, or other constraints ruling
/// everything out.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UnsatisfiableReason {
    NoValidSection,
    AllSectionsFull,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnsatisfiableCourse {
    pub course_id: i64,
    pub code: String,
    pub reason: UnsatisfiableReason,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SolveResult {
    pub status: SolveStatus,
    #[serde(default)]
    pub solutions: Vec<Solution>,
    pub resume_token: Option<String>,
    #[serde(default)]
    pub unsatisfiable_courses: Vec<UnsatisfiableCourse>,
    /// How many sections the exclude-full constraint removed (ticket 34).
    /// Surfaced so the student can see the constraint working and turn it
    /// off when the numbers look stale.
    pub excluded_full_count: usize,
    /// The latest snapshot timestamp of the plan's scope (ticket 34) — how
    /// old the enrolment numbers behind any exclusion are. `None` when
    /// nothing is captured in the scope yet.
    pub snapshot_taken_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureSummary {
    pub campus_id: i64,
    pub session_id: i64,
    pub section_count: i64,
    pub course_count: i64,
}

/// One plan a forgotten course released sections from, and how many it lost
/// (ticket 35). The UI says this back to the student after the removal, so
/// the change is never silent even though it was agreed to.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AffectedPlan {
    pub plan_id: String,
    pub removed_sections: i64,
}

/// What `forget_captured_course` answers with (ticket 35): the updated
/// [`CaptureSummary`] the counter re-renders from, plus the plans whose
/// membership the removal released.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ForgetCourseOutcome {
    pub summary: CaptureSummary,
    pub affected_plans: Vec<AffectedPlan>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RefreshStatus {
    Complete,
    SessionExpired,
    Offline,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RefreshOutcome {
    pub status: RefreshStatus,
    pub refreshed_courses: i64,
    pub total_courses: i64,
    pub halted_after_course_code: Option<String>,
}

/// Body of the `refresh:progress` event, emitted once per course from the
/// indices the runner supplies (docs/ipc-contract.md, events table; ticket
/// 21 renders it via `onRefreshProgress`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RefreshProgress {
    pub course_index: i64,
    pub course_total: i64,
    pub course_code: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MissingSection {
    pub course_id: i64,
    pub section_id: i64,
    pub section_code: String,
    pub alternatives: Vec<Section>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IcsExport {
    pub file_name: String,
    pub contents: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureReport {
    pub title: String,
    pub body: String,
    pub issue_url: String,
}

#[cfg(test)]
mod tests {

    /// The frontend switches on these exact strings and has no fallback, so a
    /// drifted spelling shows the student an empty warning box instead of a
    /// warning. `docs/ipc-contract.md` declares both values.
    #[test]
    fn warning_kinds_cross_the_wire_as_the_contract_declares() {
        assert_eq!(
            serde_json::to_string(&WarningKind::F2FOnlineBackToBack).unwrap(),
            "\"f2f_online_back_to_back\""
        );
        assert_eq!(
            serde_json::to_string(&WarningKind::F2FF2FDifferentBuildings).unwrap(),
            "\"f2f_f2f_different_buildings\""
        );
    }
    use super::*;

    #[test]
    fn day_serializes_uppercase_and_covers_mon_through_sat() {
        let days = [Day::Mon, Day::Tue, Day::Wed, Day::Thu, Day::Fri, Day::Sat];
        for day in days {
            let json = serde_json::to_string(&day).unwrap();
            let raw = json.trim_matches('"');
            assert!(raw.chars().all(|c| c.is_ascii_uppercase()));
        }
        // The week is Mon–Sat; Sunday is not representable.
        assert!(serde_json::from_str::<Day>("\"SUN\"").is_err());
    }

    #[test]
    fn block_modality_is_per_block_and_online_means_null_location() {
        let f2f = ScheduleBlock {
            day: Day::Wed,
            start_min: 510,
            end_min: 600,
            location: Some("L226".into()),
            modality: BlockModality::F2F,
        };
        let online = ScheduleBlock {
            day: Day::Sat,
            start_min: 510,
            end_min: 600,
            location: None,
            modality: BlockModality::Online,
        };
        assert!(f2f.is_well_formed());
        assert!(online.is_well_formed());
        let f2f_json = serde_json::to_value(&f2f).unwrap();
        assert_eq!(f2f_json["modality"], "F2F");
        assert_eq!(f2f_json["location"], "L226");
        let online_json = serde_json::to_value(&online).unwrap();
        assert_eq!(online_json["modality"], "ONLINE");
        assert_eq!(online_json["location"], serde_json::Value::Null);
    }

    #[test]
    fn a_plan_carries_exactly_one_campus_and_session_non_optional() {
        let plan = Plan {
            id: "p1".into(),
            name: "T1 load".into(),
            campus_id: 7,
            campus_name: "Manila".into(),
            session_id: 155,
            session_name: "AY2026-27 T1".into(),
            created_at: "2026-08-22T00:00:00Z".into(),
            section_count: 0,
            sections: vec![],
        };
        let json = serde_json::to_value(&plan).unwrap();
        assert_eq!(json["campusId"], 7);
        assert_eq!(json["sessionId"], 155);
        // Missing scope is a deserialization failure, not a default.
        let mut no_campus = json.clone();
        no_campus.as_object_mut().unwrap().remove("campusId");
        assert!(serde_json::from_value::<Plan>(no_campus).is_err());
    }

    #[test]
    fn blank_teacher_serializes_as_null_meaning_unknown() {
        let snapshot = Snapshot {
            captured_at: "2026-08-22T00:00:00Z".into(),
            enrolled: 39,
            teacher: None,
            remark: None,
        };
        let json = serde_json::to_value(&snapshot).unwrap();
        assert_eq!(json["teacher"], serde_json::Value::Null);
        let parsed: Snapshot = serde_json::from_value(json).unwrap();
        assert_eq!(parsed.teacher, None);
    }

    #[test]
    fn solve_result_partial_carries_resume_token_and_round_trips() {
        let result = SolveResult {
            status: SolveStatus::Partial,
            solutions: vec![],
            resume_token: Some("tok".into()),
            unsatisfiable_courses: vec![],
            excluded_full_count: 3,
            snapshot_taken_at: Some("2026-08-22T10:00:00Z".into()),
        };
        let json = serde_json::to_value(&result).unwrap();
        assert_eq!(json["status"], "partial");
        assert_eq!(json["resumeToken"], "tok");
        // Ticket 34: the exclusion count and the numbers' age cross the wire
        // camelCased, so the dialog can surface them.
        assert_eq!(json["excludedFullCount"], 3);
        assert_eq!(json["snapshotTakenAt"], "2026-08-22T10:00:00Z");
        let parsed: SolveResult = serde_json::from_value(json).unwrap();
        assert_eq!(parsed.resume_token.as_deref(), Some("tok"));
        assert_eq!(parsed.excluded_full_count, 3);
        assert_eq!(parsed.snapshot_taken_at.as_deref(), Some("2026-08-22T10:00:00Z"));
    }

    #[test]
    fn refresh_halts_with_the_course_that_stopped_it() {
        let outcome = RefreshOutcome {
            status: RefreshStatus::SessionExpired,
            refreshed_courses: 3,
            total_courses: 8,
            halted_after_course_code: Some("GEARTAP".into()),
        };
        let json = serde_json::to_value(&outcome).unwrap();
        assert_eq!(json["status"], "session_expired");
        assert_eq!(json["haltedAfterCourseCode"], "GEARTAP");
    }

    #[test]
    fn refresh_progress_matches_the_declared_event_payload() {
        let progress = RefreshProgress {
            course_index: 2,
            course_total: 8,
            course_code: "GEARTAP".into(),
        };
        let json = serde_json::to_value(&progress).unwrap();
        assert_eq!(json["courseIndex"], 2);
        assert_eq!(json["courseTotal"], 8);
        assert_eq!(json["courseCode"], "GEARTAP");
        assert_eq!(
            serde_json::from_value::<RefreshProgress>(json).unwrap(),
            progress
        );
    }

    #[test]
    fn solve_options_apply_defaults_for_missing_fields() {
        let json = serde_json::json!({ "preset": "most_online" });
        let options: SolveOptions = serde_json::from_value(json).unwrap();
        assert_eq!(options.preset, Preset::MostOnline);
        assert!(options.day_blacklist.is_empty());
        assert_eq!(options.earliest_start_min, None);
        // Ticket 34: exclude-full defaults to on for a new solve; the
        // student can still turn it off in secondary constraints.
        assert!(options.exclude_full);
        assert_eq!(options.result_limit, 12);
    }
}

