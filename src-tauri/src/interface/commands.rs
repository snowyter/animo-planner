//! Tauri command layer — the Rust half of the IPC seam.
//!
//! Every command the v1 app will ever call is declared here with its final
//! name, arguments, and return type, and registered in `lib.rs`. Ticket 25
//! wired the v1 set through the shared [`StoreHandle`] and the tested
//! storage/solver logic underneath; each body is a thin adapter that maps
//! store errors to identifiable error strings and never returns
//! plausible-looking data on failure. Ticket 19 implemented
//! `build_capture_report`, whose fragment argument was amended away: the
//! failing fragment is retained Rust-side at the capture-failure site and
//! scrubbed there before any report is assembled, so raw DOM never crosses
//! into the webview. Ticket 26 implemented `start_refresh` / `resume_refresh`
//! on top of the ticket-16 runner and the ticket-26 driver: the popup is
//! driven course by course, every trusted step lands through
//! `Store::apply_refresh` — never the undoable capture journal — and
//! `refresh:progress` fires once per course for ticket 21's listener.
//!
//! Amendment protocol: `docs/ipc-contract.md` is the single source of truth.
//! A signature change updates this file and `src/adapters/ipc/` in the same
//! commit and names the change in its PR description.

use crate::adapters::capture::CaptureEvents;
use crate::adapters::capture::RetainedFailures;
use crate::adapters::capture_window;
use crate::adapters::refresh_driver::{
    drive_refresh, ActiveRefreshRun, HaltedRefreshTokens, LiveRefreshSource, RefreshEvents,
    RefreshSink,
};
use crate::adapters::remote_config::{LoadedSelectorConfig, SelectorConfigHandle};
use crate::adapters::store::{CaptureScope, PlanDetail, PlanSummaryRow, Store, StoreHandle};
use crate::core::capture_report::{self, CaptureReportInput};
use crate::core::ics;
use crate::core::ipc_types::*;
use crate::core::options;
use crate::core::parser::ParsedSection;
use crate::core::refresh::{
    RefreshCourse, RefreshFinish, RefreshRun, DEFAULT_REFRESH_STEP_INTERVAL_MS,
};
use crate::core::solver::{Solver, SolveOutcome};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::Emitter;

pub mod events {
    pub const CAPTURE_UPDATED: &str = "capture:updated";
    pub const CAPTURE_FAILED: &str = "capture:failed";
    pub const REFRESH_PROGRESS: &str = "refresh:progress";
}

/// Announces capture outcomes as Tauri events for the main window: the
/// running counter listens to `capture:updated`, failure notices to
/// `capture:failed` (ticket 12).
#[derive(Clone)]
pub struct AppHandleEvents(pub tauri::AppHandle);

impl CaptureEvents for AppHandleEvents {
    fn capture_updated(&self, summary: CaptureSummary) {
        let _ = self.0.emit(events::CAPTURE_UPDATED, summary);
    }

    fn capture_failed(&self, error: String) {
        let _ = self.0.emit(events::CAPTURE_FAILED, serde_json::json!({ "error": error }));
    }
}

/// Announces refresh progress as the `refresh:progress` Tauri event —
/// once per course, from the indices the runner supplies (ticket 21 renders
/// it through `onRefreshProgress`).
impl RefreshEvents for AppHandleEvents {
    fn refresh_progress(&self, progress: RefreshProgress) {
        let _ = self.0.emit(events::REFRESH_PROGRESS, progress);
    }
}

/// Everything a refresh command needs, managed as one Tauri state: the
/// shared store, the active-run registration that routes `/capture` posts,
/// where halted tokens are remembered per plan, the live selector config,
/// and the event emitter.
#[derive(Clone)]
pub struct RefreshContext {
    pub store: StoreHandle,
    pub active: ActiveRefreshRun,
    pub halted: HaltedRefreshTokens,
    pub selector_config: SelectorConfigHandle,
    pub events: AppHandleEvents,
}

/// The production [`RefreshSink`]: trusted steps land through
/// [`Store::apply_refresh`] — snapshots appended, vanished sections flagged,
/// never an undoable capture batch — and progress is announced per course.
struct LiveRefreshSink<E: RefreshEvents> {
    store: StoreHandle,
    events: E,
}

impl<E: RefreshEvents> RefreshSink for LiveRefreshSink<E> {
    fn persist(
        &self,
        plan_id: &str,
        course_id: i64,
        sections: &[ParsedSection],
    ) -> Result<(), String> {
        let mut store = self.store.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        store
            .apply_refresh(plan_id, course_id, sections, &crate::adapters::capture::now_iso())
            .map_err(|err| err.to_string())
    }

    fn progress(&self, course_index: usize, course_total: usize, course_code: &str) {
        self.events.refresh_progress(RefreshProgress {
            course_index: course_index as i64,
            course_total: course_total as i64,
            course_code: course_code.to_string(),
        });
    }
}

fn capture_scope(args: &CampusSessionArgs) -> CaptureScope {
    CaptureScope {
        campus_id: args.campus_id,
        session_id: args.session_id,
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatePlanArgs {
    pub name: String,
    pub campus_id: i64,
    pub session_id: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanIdArgs {
    pub plan_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CampusSessionArgs {
    pub campus_id: i64,
    pub session_id: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapturedSectionsArgs {
    pub campus_id: i64,
    pub session_id: i64,
    pub course_id: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CourseInclusionArgs {
    pub campus_id: i64,
    pub session_id: i64,
    pub course_id: i64,
    pub included: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SectionInPlanArgs {
    pub plan_id: String,
    pub course_id: i64,
    pub section_id: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetPinnedArgs {
    pub plan_id: String,
    pub course_id: i64,
    pub section_id: i64,
    pub pinned: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplySolutionArgs {
    pub plan_id: String,
    pub sections: Vec<SectionRef>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SolvePlanArgs {
    pub plan_id: String,
    pub options: SolveOptions,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContinueSolveArgs {
    pub plan_id: String,
    pub resume_token: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildCaptureReportArgs {
    pub error: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TeacherPreferencesArgs {
    pub campus_id: i64,
    pub session_id: i64,
    pub course_id: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteTeacherPreferencesArgs {
    pub campus_id: i64,
    pub session_id: i64,
    pub course_id: i64,
    pub ranked: Vec<TeacherEntry>,
    pub avoided: Vec<TeacherEntry>,
}

/// One teacher named in a preference write, ranked or avoided alike: the
/// normalized key the preference is stored under, and the verbatim name the
/// student sees. Both lists carry the name — the key is case-folded, so it
/// is never fit to display.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TeacherEntry {
    pub key: String,
    pub display_name: String,
}

/// Shared cancellation flag for the solve commands: `cancel_solve` sets it,
/// a starting solve clears it, and a finishing chunk reports
/// [`SolveStatus::Cancelled`] when it saw the flag set.
#[derive(Default)]
pub struct SolveCancellation(pub Arc<AtomicBool>);

// ---------- seam helpers ----------

/// The campus/session *names* for a scope, from [`options`] — the single
/// source. An id outside the offered options is a loud error, never an
/// invented name.
fn scope_names(campus_id: i64, session_id: i64) -> Result<(String, String), String> {
    let campus_name = options::campus_name(campus_id)
        .ok_or_else(|| format!("unknown campus id {campus_id}"))?;
    let session_name = options::session_name(session_id)
        .ok_or_else(|| format!("unknown session id {session_id}"))?;
    Ok((campus_name.to_string(), session_name.to_string()))
}

fn plan_summary_from_row(row: PlanSummaryRow) -> Result<PlanSummary, String> {
    let (campus_name, session_name) = scope_names(row.campus_id, row.session_id)?;
    Ok(PlanSummary {
        id: row.id,
        name: row.name,
        campus_id: row.campus_id,
        campus_name,
        session_id: row.session_id,
        session_name,
        created_at: row.created_at,
        section_count: row.section_count,
    })
}

fn plan_from_detail(detail: PlanDetail) -> Result<Plan, String> {
    let (campus_name, session_name) = scope_names(detail.summary.campus_id, detail.summary.session_id)?;
    let summary = plan_summary_from_row(detail.summary)?;
    Ok(Plan {
        id: summary.id,
        name: summary.name,
        campus_id: summary.campus_id,
        campus_name,
        session_id: summary.session_id,
        session_name,
        created_at: summary.created_at,
        section_count: summary.section_count,
        sections: detail.sections,
    })
}

fn get_plan_impl(store: &Store, plan_id: &str) -> Result<Plan, String> {
    store
        .get_plan(plan_id)
        .map_err(|err| err.to_string())
        .and_then(plan_from_detail)
}

fn list_plans_impl(store: &Store) -> Result<Vec<PlanSummary>, String> {
    store
        .list_plans()
        .map_err(|err| err.to_string())?
        .into_iter()
        .map(plan_summary_from_row)
        .collect()
}

/// A fresh opaque plan id: 96 bits of randomness, hex-encoded — same shape
/// of mint as the capture listener's bearer token. Never derived from user
/// data.
fn new_plan_id() -> String {
    let mut bytes = [0u8; 12];
    rand::rng().fill_bytes(&mut bytes);
    let hex: String = bytes.iter().map(|byte| format!("{byte:02x}")).collect();
    format!("plan-{hex}")
}

fn create_plan_impl(store: &mut Store, args: CreatePlanArgs) -> Result<PlanSummary, String> {
    let name = args.name.trim();
    if name.is_empty() {
        return Err("plan name must not be blank".to_string());
    }
    // The negative ids ticket 27 reserved are still not real scopes, and
    // `scope_names` will happily name them, so plan creation keeps refusing
    // them explicitly. The sample seed that once used them is gone; the
    // guard is not, because nothing else stops a crafted call.
    if args.campus_id == options::SAMPLE_CAMPUS_ID
        || args.session_id == options::SAMPLE_SESSION_ID
    {
        return Err(
            "that campus and session are reserved and not real scopes; \
             pick one of the offered options"
                .to_string(),
        );
    }
    // Validate the scope against the offered options now, so an unknown id
    // fails at creation instead of breaking every later read.
    scope_names(args.campus_id, args.session_id)?;
    let id = new_plan_id();
    let created_at = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
    store
        .create_plan(
            &id,
            name,
            &CaptureScope {
                campus_id: args.campus_id,
                session_id: args.session_id,
            },
            &created_at,
        )
        .map_err(|err| err.to_string())?;
    get_plan_impl(store, &id).map(|plan| PlanSummary {
        id: plan.id,
        name: plan.name,
        campus_id: plan.campus_id,
        campus_name: plan.campus_name,
        session_id: plan.session_id,
        session_name: plan.session_name,
        created_at: plan.created_at,
        section_count: plan.section_count,
    })
}

/// Runs one membership mutation and answers with the updated plan, so the
/// UI re-renders from one source of truth instead of stitching optimistic
/// state together.
fn membership_impl(
    store: &mut Store,
    plan_id: &str,
    mutate: impl FnOnce(&mut Store) -> Result<(), crate::adapters::store::StoreError>,
) -> Result<Plan, String> {
    mutate(store).map_err(|err| err.to_string())?;
    get_plan_impl(store, plan_id)
}

fn add_section_to_plan_impl(store: &mut Store, args: SectionInPlanArgs) -> Result<Plan, String> {
    membership_impl(store, &args.plan_id, |store| {
        store.add_section_to_plan(&args.plan_id, args.course_id, args.section_id)
    })
}

fn remove_section_from_plan_impl(
    store: &mut Store,
    args: SectionInPlanArgs,
) -> Result<Plan, String> {
    membership_impl(store, &args.plan_id, |store| {
        store.remove_section_from_plan(&args.plan_id, args.course_id, args.section_id)
    })
}

fn set_section_pinned_impl(store: &mut Store, args: SetPinnedArgs) -> Result<Plan, String> {
    membership_impl(store, &args.plan_id, |store| {
        store.set_section_pinned(&args.plan_id, args.course_id, args.section_id, args.pinned)
    })
}

fn apply_solution_impl(store: &mut Store, args: ApplySolutionArgs) -> Result<Plan, String> {
    membership_impl(store, &args.plan_id, |store| {
        store.apply_solution(&args.plan_id, &args.sections)
    })
}

fn get_plan_conflicts_impl(store: &Store, plan_id: &str) -> Result<Vec<Conflict>, String> {
    store.conflicts_in_plan(plan_id).map_err(|err| err.to_string())
}

fn delete_plan_impl(store: &mut Store, plan_id: &str) -> Result<(), String> {
    store.delete_plan(plan_id).map_err(|err| err.to_string())
}

fn get_missing_sections_impl(
    store: &Store,
    plan_id: &str,
) -> Result<Vec<MissingSection>, String> {
    store.missing_sections(plan_id).map_err(|err| err.to_string())
}

fn list_captured_courses_impl(
    store: &Store,
    scope: CaptureScope,
) -> Result<Vec<CapturedCourse>, String> {
    store.captured_courses(&scope).map_err(|err| err.to_string())
}

fn list_captured_sections_impl(
    store: &Store,
    args: CapturedSectionsArgs,
) -> Result<Vec<Section>, String> {
    store
        .captured_sections(
            &CaptureScope {
                campus_id: args.campus_id,
                session_id: args.session_id,
            },
            args.course_id,
        )
        .map_err(|err| err.to_string())
}

/// Forgets one captured course (tickets 29, 35): the course and its
/// sections' rows go, and plans holding any of those sections are released
/// — the returned [`ForgetCourseOutcome`] carries the updated
/// [`CaptureSummary`] for the counter plus the affected-plan report the UI
/// says back to the student.
fn forget_captured_course_impl(
    store: &mut Store,
    args: CapturedSectionsArgs,
) -> Result<ForgetCourseOutcome, String> {
    store
        .forget_course(
            &CaptureScope {
                campus_id: args.campus_id,
                session_id: args.session_id,
            },
            args.course_id,
        )
        .map_err(|err| err.to_string())
}

/// Marks whether the student intends to enrol in a captured course.
///
/// Excluding is not forgetting: nothing is deleted, the counter does not
/// move, and the course stays in the catalog. It stops being a course the
/// solver has to satisfy, which is what makes searching forty courses to
/// browse them survivable.
fn set_course_included_impl(
    store: &mut Store,
    args: CourseInclusionArgs,
) -> Result<Vec<CapturedCourse>, String> {
    let scope = CaptureScope {
        campus_id: args.campus_id,
        session_id: args.session_id,
    };
    store
        .set_course_included(&scope, args.course_id, args.included)
        .map_err(|err| err.to_string())?;
    // The updated catalog comes back with it: one loaded list, so the tab
    // that toggles and the tab that browses cannot disagree about it.
    store.captured_courses(&scope).map_err(|err| err.to_string())
}

// ---------- commands: options & app info ----------

#[tauri::command]
pub fn get_campus_options() -> Result<Vec<CampusOption>, String> {
    Ok(options::CAMPUS_OPTIONS
        .iter()
        .map(|(id, name)| CampusOption {
            id: *id,
            name: name.to_string(),
        })
        .collect())
}

#[tauri::command]
pub fn get_session_options() -> Result<Vec<SessionOption>, String> {
    Ok(options::SESSION_OPTIONS
        .iter()
        .map(|(id, name)| SessionOption {
            id: *id,
            name: name.to_string(),
        })
        .collect())
}

/// Reports the app version together with which selector config is live —
/// its version and whether it came from the remote document or the bundled
/// fallback (ticket 18). A bug report about broken capture is undiagnosable
/// without these; they feed the About screen and report flow (SPEC §9).
#[tauri::command]
pub fn get_app_info(
    app: tauri::AppHandle,
    selector_config: tauri::State<'_, SelectorConfigHandle>,
) -> Result<AppInfo, String> {
    Ok(app_info_from(
        app.package_info().version.to_string(),
        &selector_config.loaded(),
    ))
}

fn app_info_from(app_version: String, loaded: &LoadedSelectorConfig) -> AppInfo {
    AppInfo {
        app_version,
        selector_config_version: loaded.version.clone(),
        selector_config_source: loaded.source,
    }
}

// ---------- commands: plans ----------

#[tauri::command]
pub fn list_plans(store: tauri::State<'_, StoreHandle>) -> Result<Vec<PlanSummary>, String> {
    let store = store.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    list_plans_impl(&store)
}

#[tauri::command]
pub fn create_plan(
    args: CreatePlanArgs,
    store: tauri::State<'_, StoreHandle>,
) -> Result<PlanSummary, String> {
    let mut store = store.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    create_plan_impl(&mut store, args)
}

#[tauri::command]
pub fn delete_plan(
    args: PlanIdArgs,
    store: tauri::State<'_, StoreHandle>,
) -> Result<(), String> {
    let mut store = store.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    delete_plan_impl(&mut store, &args.plan_id)
}

#[tauri::command]
pub fn get_plan(args: PlanIdArgs, store: tauri::State<'_, StoreHandle>) -> Result<Plan, String> {
    let store = store.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    get_plan_impl(&store, &args.plan_id)
}


// ---------- commands: captured catalog ----------

#[tauri::command]
pub fn list_captured_courses(
    args: CampusSessionArgs,
    store: tauri::State<'_, StoreHandle>,
) -> Result<Vec<CapturedCourse>, String> {
    let store = store.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    list_captured_courses_impl(&store, capture_scope(&args))
}

#[tauri::command]
pub fn list_captured_sections(
    args: CapturedSectionsArgs,
    store: tauri::State<'_, StoreHandle>,
) -> Result<Vec<Section>, String> {
    let store = store.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    list_captured_sections_impl(&store, args)
}

#[tauri::command]
pub fn forget_captured_course(
    args: CapturedSectionsArgs,
    store: tauri::State<'_, StoreHandle>,
) -> Result<ForgetCourseOutcome, String> {
    let mut store = store.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    forget_captured_course_impl(&mut store, args)
}

#[tauri::command]
pub fn set_course_included(
    args: CourseInclusionArgs,
    store: tauri::State<'_, StoreHandle>,
) -> Result<Vec<CapturedCourse>, String> {
    let mut store = store.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    set_course_included_impl(&mut store, args)
}

// ---------- commands: plan membership ----------

#[tauri::command]
pub fn add_section_to_plan(
    args: SectionInPlanArgs,
    store: tauri::State<'_, StoreHandle>,
) -> Result<Plan, String> {
    let mut store = store.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    add_section_to_plan_impl(&mut store, args)
}

#[tauri::command]
pub fn remove_section_from_plan(
    args: SectionInPlanArgs,
    store: tauri::State<'_, StoreHandle>,
) -> Result<Plan, String> {
    let mut store = store.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    remove_section_from_plan_impl(&mut store, args)
}

#[tauri::command]
pub fn set_section_pinned(
    args: SetPinnedArgs,
    store: tauri::State<'_, StoreHandle>,
) -> Result<Plan, String> {
    let mut store = store.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    set_section_pinned_impl(&mut store, args)
}

#[tauri::command]
pub fn get_plan_conflicts(
    args: PlanIdArgs,
    store: tauri::State<'_, StoreHandle>,
) -> Result<Vec<Conflict>, String> {
    let store = store.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    get_plan_conflicts_impl(&store, &args.plan_id)
}

#[tauri::command]
pub fn apply_solution(
    args: ApplySolutionArgs,
    store: tauri::State<'_, StoreHandle>,
) -> Result<Plan, String> {
    let mut store = store.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    apply_solution_impl(&mut store, args)
}

/// Opens (or refocuses) the Archer's Hub capture popup for the given plan
/// scope (ticket 10). The popup is a separate window where the student
/// signs in manually; its injected script posts captures to the loopback
/// endpoint. The remote origin never gets Tauri IPC (ADR-0003).
// Runs off the interface thread. Tauri executes a plain `#[tauri::command]`
// on the main thread, which is the event loop thread; creating a webview
// window there deadlocks, because `build()` waits for a window-creation the
// blocked loop can never deliver. The symptom is a white popup that ignores
// its own close button and a `build()` that never returns.
#[tauri::command(async)]
pub fn open_capture_window(
    args: CampusSessionArgs,
    app: tauri::AppHandle,
    listener: tauri::State<'_, crate::adapters::capture::CaptureListener>,
    selector_config: tauri::State<'_, SelectorConfigHandle>,
) -> Result<(), String> {
    capture_window::open_capture_window(
        &app,
        &listener,
        &selector_config.loaded().config,
        capture_scope(&args),
    )
}

#[tauri::command]
pub fn get_capture_summary(
    args: CampusSessionArgs,
    store: tauri::State<'_, StoreHandle>,
) -> Result<CaptureSummary, String> {
    let store = store.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    store
        .capture_summary(&capture_scope(&args))
        .map_err(|err| err.to_string())
}

/// Signs the student out of the capture popup (ticket 10): destroys the
/// window and wipes its persisted WebView profile. The control is surfaced
/// by ticket 23; this command does the wiping.
// Off the interface thread for the same reason as `open_capture_window`:
// destroying a window also has to reach the event loop.
#[tauri::command(async)]
pub fn clear_browser_session(app: tauri::AppHandle) -> Result<(), String> {
    capture_window::clear_browser_session(&app)
}

// ---------- solve plumbing ----------

/// Opaque resume-token envelope: the solver's serialized search state plus
/// the plan it was minted for. The UI treats `resume_token` as an opaque
/// string; the envelope lets `continue_solve` verify the token is being
/// spent on the plan that started it.
#[derive(Serialize, Deserialize)]
struct SolveResumeEnvelope {
    plan_id: String,
    token: String,
}

fn mint_resume_token(plan_id: &str, state_token: &str) -> String {
    serde_json::to_string(&SolveResumeEnvelope {
        plan_id: plan_id.to_string(),
        token: state_token.to_string(),
    })
    .expect("the resume envelope must always serialize")
}

fn open_resume_token(token: &str, requested_plan_id: &str) -> Result<String, String> {
    let envelope: SolveResumeEnvelope = serde_json::from_str(token)
        .map_err(|err| format!("invalid solve resume token: {err}"))?;
    if envelope.plan_id != requested_plan_id {
        return Err(format!(
            "solve resume token belongs to plan {:?}, not plan {:?}",
            envelope.plan_id, requested_plan_id
        ));
    }
    Ok(envelope.token)
}

/// Builds the seeded solver for a plan (ADR-0014, ticket 42): pinned plan
/// members are fixed, unpinned members seed their own course's search, and
/// every other captured course of the plan's scope is filled. Constraints
/// and preset come from `args.options`. Also answers with the latest
/// snapshot timestamp of the plan's scope (ticket 34), so the result can
/// say how old the enrolment numbers behind any exclusion are.
fn begin_solve(store: &Store, args: &SolvePlanArgs) -> Result<(Solver, Option<String>), String> {
    let detail = store.get_plan(&args.plan_id).map_err(|err| err.to_string())?;
    let scope = CaptureScope {
        campus_id: detail.summary.campus_id,
        session_id: detail.summary.session_id,
    };
    let fixed: Vec<crate::core::solver::FixedSection> = detail
        .sections
        .iter()
        .map(|section| crate::core::solver::FixedSection {
            course_id: section.course_id,
            course_code: section.course_code.clone(),
            section_id: section.section_id,
            section_code: section.section_code.clone(),
            blocks: section.blocks.clone(),
            pinned: section.pinned,
        })
        .collect();
    let catalog = store.solver_courses(&scope).map_err(|err| err.to_string())?;
    // Pinned plan sections are never candidates (ticket 14): a full section
    // the student pinned is fixed, never excluded. An *unpinned* member's
    // course stays searchable (ticket 42) — its own choice leads the scan —
    // so exclude-full may swap it for one with seats, decided in favour of
    // exclude-full.
    let stamp = store.latest_snapshot_at(&scope).map_err(|err| err.to_string())?;
    Ok((Solver::new(catalog, fixed, args.options.clone()), stamp))
}

/// Wire solution with its stable id (`solution-<index>`, best first).
fn wire_solution(solution: crate::core::solver::SolveSolution, index: usize) -> Solution {
    Solution {
        id: format!("solution-{index}"),
        score: solution.score,
        breakdown: solution.breakdown,
        warnings: solution.warnings,
        sections: solution.sections,
    }
}

/// Maps a solver outcome to the wire result. A cancellation observed after
/// the chunk ran wins over the chunk's own status, and no resume token ever
/// survives a cancellation — a stale Continue must not resurrect a dead run.
/// The exclusion count and snapshot stamp (ticket 34) ride along so the
/// dialog can surface them next to the results.
fn finish_outcome(
    outcome: SolveOutcome,
    plan_id: &str,
    cancelled: bool,
    snapshot_taken_at: Option<String>,
) -> SolveResult {
    let status = if cancelled { SolveStatus::Cancelled } else { outcome.status };
    let resume_token = match (&status, outcome.resume_token) {
        (SolveStatus::Partial, Some(state_token)) => {
            Some(mint_resume_token(plan_id, &state_token))
        }
        _ => None,
    };
    SolveResult {
        status,
        solutions: outcome
            .solutions
            .into_iter()
            .enumerate()
            .map(|(index, solution)| wire_solution(solution, index))
            .collect(),
        resume_token,
        unsatisfiable_courses: outcome.unsatisfiable_courses,
        excluded_full_count: outcome.excluded_full_count,
        snapshot_taken_at,
    }
}

/// One bounded search chunk, off the interface thread: the window never
/// freezes even while a chunk burns its whole node budget.
async fn run_solver_chunk(
    solver: Solver,
    plan_id: &str,
    snapshot_taken_at: Option<String>,
    cancellation: &Arc<AtomicBool>,
) -> Result<SolveResult, String> {
    let outcome = tauri::async_runtime::spawn_blocking(move || {
        let mut solver = solver;
        solver.run()
    })
    .await
    .map_err(|err| format!("solve task failed: {err}"))?;
    Ok(finish_outcome(
        outcome,
        plan_id,
        cancellation.load(Ordering::SeqCst),
        snapshot_taken_at,
    ))
}

// ---------- commands: solver ----------

#[tauri::command]
pub async fn solve_plan(
    args: SolvePlanArgs,
    store: tauri::State<'_, StoreHandle>,
    cancellation: tauri::State<'_, SolveCancellation>,
) -> Result<SolveResult, String> {
    // All store access happens under the shared mutex before the chunk;
    // the lock never crosses the await.
    let (solver, snapshot_taken_at) = {
        let store = store.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        begin_solve(&store, &args)?
    };
    // A fresh solve clears a stale cancellation; cancel_solve sets it again
    // while the chunk runs.
    cancellation.0.store(false, Ordering::SeqCst);
    run_solver_chunk(solver, &args.plan_id, snapshot_taken_at, &cancellation.0).await
}

#[tauri::command]
pub async fn continue_solve(
    args: ContinueSolveArgs,
    store: tauri::State<'_, StoreHandle>,
    cancellation: tauri::State<'_, SolveCancellation>,
) -> Result<SolveResult, String> {
    let state_token = open_resume_token(&args.resume_token, &args.plan_id)?;
    let solver = Solver::from_token(&state_token).map_err(|err| err.to_string())?;
    // A resumed chunk reports the freshness of the numbers as they stand
    // now: a refresh between chunks moves the stamp forward.
    let snapshot_taken_at = solve_snapshot_stamp(&store, &args.plan_id)?;
    cancellation.0.store(false, Ordering::SeqCst);
    run_solver_chunk(solver, &args.plan_id, snapshot_taken_at, &cancellation.0).await
}

/// The latest snapshot timestamp of a plan's scope (ticket 34), read
/// through the shared store.
fn solve_snapshot_stamp(
    store: &tauri::State<'_, StoreHandle>,
    plan_id: &str,
) -> Result<Option<String>, String> {
    let store = store.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let scope = store.plan_scope_of(plan_id).map_err(|err| err.to_string())?;
    store.latest_snapshot_at(&scope).map_err(|err| err.to_string())
}

/// Stops an in-flight solve: the running chunk finishes its budget and then
/// resolves as [`SolveStatus::Cancelled`]. Safe when nothing is running —
/// it only sets a flag the next solve clears on start.
#[tauri::command]
pub fn cancel_solve(cancellation: tauri::State<'_, SolveCancellation>) -> Result<(), String> {
    cancellation.0.store(true, Ordering::SeqCst);
    Ok(())
}

// ---------- commands: refresh & missing ----------

/// Refreshes every course already in the plan (ticket 26): the driver walks
/// the ticket-16 runner's steps, drives the open Archer's Hub popup to
/// select each course roughly 1.5 seconds apart, and stores what the runner
/// trusts. Only plan courses are touched; nothing runs on a timer or in the
/// background — this is always something the student asked for (SPEC §4).
#[tauri::command]
pub async fn start_refresh(
    args: PlanIdArgs,
    context: tauri::State<'_, RefreshContext>,
    app: tauri::AppHandle,
) -> Result<RefreshOutcome, String> {
    let courses = {
        let store = context.store.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        store.refresh_courses(&args.plan_id).map_err(|err| err.to_string())?
    };
    drive_refresh_for_plan(args.plan_id.clone(), courses, None, context.inner(), app).await
}

/// Resumes a refresh halted by session expiry (ticket 26): rebuilds the run
/// from the token stashed when it halted and continues from the halted
/// course rather than restarting. Fails identifiably when no halted run is
/// remembered for the plan.
#[tauri::command]
pub async fn resume_refresh(
    args: PlanIdArgs,
    context: tauri::State<'_, RefreshContext>,
    app: tauri::AppHandle,
) -> Result<RefreshOutcome, String> {
    let token = context
        .halted
        .take(&args.plan_id)
        .ok_or_else(|| format!("no halted refresh to resume for plan {:?}", args.plan_id))?;
    drive_refresh_for_plan(args.plan_id.clone(), Vec::new(), Some(token), context.inner(), app).await
}

/// The shared drive behind both refresh commands: registers the active run
/// so `/capture` routes to it, spawns the blocking drive loop off the UI
/// thread, unregisters no matter how the drive ends, and remembers a halt's
/// resume token for `resume_refresh`.
async fn drive_refresh_for_plan(
    plan_id: String,
    courses: Vec<RefreshCourse>,
    resume_token: Option<String>,
    context: &RefreshContext,
    app: tauri::AppHandle,
) -> Result<RefreshOutcome, String> {
    let scope = {
        let store = context.store.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        store.plan_scope_of(&plan_id).map_err(|err| err.to_string())?
    };
    // A run with nothing to drive (an empty plan) ends before it could ever
    // consume a post — registering it would only open a window in which an
    // ordinary search is routed into a channel nobody reads. Routing is
    // registered exactly when a render can actually be awaited; a resumed
    // run always carries at least its halted course.
    let drives_anything = resume_token.is_some() || !courses.is_empty();
    let mut run = match &resume_token {
        Some(token) => RefreshRun::from_token(token).map_err(|err| err.to_string())?,
        None => RefreshRun::start(courses),
    };
    let (sender, receiver) = std::sync::mpsc::channel();
    if drives_anything {
        context.active.begin(&plan_id, scope, sender)?;
    }
    let args_plan_id = plan_id.clone();

    let config = context.selector_config.loaded().config;
    let source = LiveRefreshSource::new(app, receiver, config.clone());
    let sink = LiveRefreshSink {
        store: context.store.clone(),
        events: context.events.clone(),
    };
    let driven = tauri::async_runtime::spawn_blocking(move || {
        drive_refresh(
            &mut run,
            &source,
            &sink,
            &plan_id,
            &config,
            Duration::from_millis(DEFAULT_REFRESH_STEP_INTERVAL_MS),
        )
    })
    .await;

    // The registration must die with the drive — success, halt, or failure —
    // or every later post would be swallowed by a dead run.
    if drives_anything {
        context.active.end(&args_plan_id);
    }

    let finish: RefreshFinish = driven.map_err(|err| format!("refresh task failed: {err}"))??;
    match finish.resume_token.clone() {
        Some(token) => context.halted.stash(&args_plan_id, token),
        None => {
            // Completing (or resuming past) a run discards any stale memory.
            drop(context.halted.take(&args_plan_id));
        }
    }
    Ok(finish.outcome)
}

#[tauri::command]
pub fn get_missing_sections(
    args: PlanIdArgs,
    store: tauri::State<'_, StoreHandle>,
) -> Result<Vec<MissingSection>, String> {
    let store = store.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    get_missing_sections_impl(&store, &args.plan_id)
}

/// Exports a plan as an `.ics` calendar file (ticket 17). Pure Rust, no
/// network: the plan is read from the local store and serialised by the
/// core exporter, so the export works with no connection at all.
#[tauri::command]
pub fn export_plan_ics(
    args: PlanIdArgs,
    store: tauri::State<'_, StoreHandle>,
) -> Result<IcsExport, String> {
    let store = store.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let plan = store
        .load_plan_ics_export(&args.plan_id)
        .map_err(|err| err.to_string())?;
    Ok(ics::export_plan_ics(
        &plan.name,
        &plan.sections,
        chrono::Utc::now(),
    ))
}

/// Assembles the broken-capture report (ticket 19) from a failure the
/// capture listener retained this launch. The fragment never came from the
/// webview — the contract amendment that removed it from the arguments is
/// what keeps raw DOM out of the frontend entirely. Nothing here
/// transmits anything: the result is a pre-filled issue URL the student
/// opens themselves (SPEC §8, §9).
fn build_capture_report_impl(
    failures: &RetainedFailures,
    error: &str,
    app_version: String,
    loaded: &LoadedSelectorConfig,
) -> Result<CaptureReport, String> {
    let failure = failures.find(error).ok_or_else(|| {
        format!(
            "no matching retained capture failure to report; the error must be one \
             this launch announced (got {:?})",
            error
        )
    })?;
    Ok(capture_report::build_capture_report(CaptureReportInput {
        error,
        fragment: failure.fragment.as_deref(),
        app_version: &app_version,
        selector_config_version: &loaded.version,
        selector_config_source: loaded.source,
    }))
}

#[tauri::command]
pub fn build_capture_report(
    args: BuildCaptureReportArgs,
    listener: tauri::State<'_, crate::adapters::capture::CaptureListener>,
    selector_config: tauri::State<'_, SelectorConfigHandle>,
    app: tauri::AppHandle,
) -> Result<CaptureReport, String> {
    build_capture_report_impl(
        listener.retained_failures(),
        &args.error,
        app.package_info().version.to_string(),
        &selector_config.loaded(),
    )
}

// ---------- commands: teacher preferences (ticket 47) ----------

#[tauri::command]
pub fn list_rankable_teachers(
    args: TeacherPreferencesArgs,
    store: tauri::State<'_, StoreHandle>,
) -> Result<Vec<RankableTeacher>, String> {
    let store = store.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    store
        .rankable_teachers(
            &CaptureScope {
                campus_id: args.campus_id,
                session_id: args.session_id,
            },
            args.course_id,
        )
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub fn get_course_preferences(
    args: TeacherPreferencesArgs,
    store: tauri::State<'_, StoreHandle>,
) -> Result<Vec<TeacherPreference>, String> {
    let store = store.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    store
        .course_preferences(
            &CaptureScope {
                campus_id: args.campus_id,
                session_id: args.session_id,
            },
            args.course_id,
        )
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub fn write_course_preferences(
    args: WriteTeacherPreferencesArgs,
    store: tauri::State<'_, StoreHandle>,
) -> Result<Vec<TeacherPreference>, String> {
    let mut store = store.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let scope = CaptureScope {
        campus_id: args.campus_id,
        session_id: args.session_id,
    };
    let ranked: Vec<(String, String)> = args
        .ranked
        .iter()
        .map(|r| (r.key.clone(), r.display_name.clone()))
        .collect();
    // Avoided teachers carry a display name for the same reason ranked ones
    // do: the key is case-folded, and the student must see the name they
    // avoided, not its normalization.
    let avoided: Vec<(String, String)> = args
        .avoided
        .iter()
        .map(|r| (r.key.clone(), r.display_name.clone()))
        .collect();
    store
        .write_course_preferences(&scope, args.course_id, &ranked, &avoided)
        .map_err(|err| err.to_string())?;
    store
        .course_preferences(&scope, args.course_id)
        .map_err(|err| err.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::adapters::store::Store;
    use crate::core::ipc_types::{BlockModality, Day, SectionModality};
    use crate::core::parser::{ParsedBlock, ParsedLocation, ParsedSection};
    use std::sync::{Arc as StdArc, Mutex as StdMutex};

    // ---------- command wiring fixtures (ticket 25) ----------

    const T1: &str = "2026-08-22T10:00:00Z";

    fn store() -> Store {
        Store::open_in_memory().expect("in-memory store must open")
    }

    fn parsed_section(
        course_id: i64,
        section_id: i64,
        section_code: &str,
        blocks: Vec<ParsedBlock>,
    ) -> ParsedSection {
        ParsedSection {
            course_id,
            course_code: format!("C{course_id}"),
            course_title: format!("Course {course_id}"),
            section_id,
            section_code: section_code.into(),
            course_type: Some("Lecture".into()),
            credits: Some(3.0),
            enroll_cap: Some(45),
            enrolled: Some(20),
            teacher: None,
            remark: None,
            start_date: None,
            end_date: None,
            blocks,
        }
    }

    fn block(day: Day, start_min: i64) -> ParsedBlock {
        ParsedBlock {
            day,
            start_min,
            end_min: start_min + 90,
            location: ParsedLocation::Online,
        }
    }

    /// A store with two captured courses (2923 and 564, one section each)
    /// and a plan p1 scoped to Manila / AY2026-27 T1.
    fn seeded_store() -> Store {
        let mut store = store();
        store
            .record_capture(
                &CaptureScope { campus_id: 7, session_id: 155 },
                &[
                    parsed_section(2923, 384, "S01", vec![block(Day::Mon, 450)]),
                    parsed_section(564, 737, "Y11", vec![block(Day::Tue, 570)]),
                ],
                T1,
            )
            .expect("seed captures");
        store
            .create_plan("p1", "T1 load", &CaptureScope { campus_id: 7, session_id: 155 }, T1)
            .expect("seed plan");
        store
    }

    #[test]
    fn campus_and_session_options_come_from_the_shared_rust_source() {
        let campuses = get_campus_options().expect("campus options");
        assert_eq!(
            campuses.iter().map(|option| (option.id, option.name.as_str())).collect::<Vec<_>>(),
            vec![(7, "Manila"), (8, "Laguna"), (9, "Rufino")],
        );
        let sessions = get_session_options().expect("session options");
        assert_eq!(
            sessions.iter().map(|option| (option.id, option.name.as_str())).collect::<Vec<_>>(),
            vec![
                (155, "AY2026-27 T1"),
                (156, "AY2026-27 T2"),
                (157, "AY2026-27 T3"),
                (144, "Annual"),
                (161, "SHS"),
            ],
        );
    }

    #[test]
    fn app_info_reports_the_app_version_and_which_selector_config_is_live() {
        let remote = crate::adapters::remote_config::LoadedSelectorConfig {
            source: crate::core::ipc_types::SelectorConfigSource::Remote,
            version: "9".into(),
            config: crate::core::parser::SelectorConfig::default(),
        };
        let info = app_info_from("0.1.0".into(), &remote);
        assert_eq!(info.app_version, "0.1.0");
        assert_eq!(info.selector_config_version, "9");
        assert_eq!(
            info.selector_config_source,
            crate::core::ipc_types::SelectorConfigSource::Remote
        );

        let bundled = crate::adapters::remote_config::bundled();
        let info = app_info_from("0.1.0".into(), &bundled);
        assert_eq!(info.selector_config_source, SelectorConfigSource::Bundled);
        assert_eq!(info.selector_config_version, bundled.version);
    }

    #[test]
    fn create_plan_rejects_a_blank_name_with_an_identifiable_error() {
        let mut store = seeded_store();
        for blank in ["", "   "] {
            let err = create_plan_impl(
                &mut store,
                CreatePlanArgs {
                    name: blank.into(),
                    campus_id: 7,
                    session_id: 155,
                },
            )
            .expect_err("a blank name must be rejected, not silently accepted");
            assert!(
                err.to_lowercase().contains("name"),
                "the error must name the problem, got: {err}"
            );
        }
        assert_eq!(store.list_plans().expect("list").len(), 1, "nothing was created");
    }

    #[test]
    fn create_plan_creates_a_scoped_plan_and_returns_it_with_scope_names() {
        let mut store = seeded_store();
        let summary = create_plan_impl(
            &mut store,
            CreatePlanArgs {
                name: "  My plan  ".into(),
                campus_id: 8,
                session_id: 156,
            },
        )
        .expect("create must succeed");
        assert_eq!(summary.name, "My plan", "the name is trimmed");
        assert_eq!(summary.campus_id, 8);
        assert_eq!(summary.campus_name, "Laguna", "names come from the shared source");
        assert_eq!(summary.session_id, 156);
        assert_eq!(summary.session_name, "AY2026-27 T2");
        assert_eq!(summary.section_count, 0);
        assert!(!summary.id.is_empty(), "the command mints the plan id");

        let listed = list_plans_impl(&store).expect("list plans");
        assert_eq!(listed.len(), 2);
        assert!(
            listed.iter().any(|plan| plan.id == summary.id),
            "the new plan is listed with its names attached"
        );

        let err = create_plan_impl(
            &mut store,
            CreatePlanArgs {
                name: "Nope".into(),
                campus_id: 42,
                session_id: 155,
            },
        )
        .expect_err("an unknown campus id must fail loudly at creation time");
        assert!(err.contains("campus"), "got: {err}");
    }

    #[test]
    fn create_plan_cannot_target_the_reserved_sample_scope() {
        // Ticket 27: the sample scope is reserved for the bundled seed. A
        // plan created in it would render "Sample Campus · Sample Term"
        // while sharing the fabricated catalog, so creation must refuse.
        let mut store = seeded_store();
        let err = create_plan_impl(
            &mut store,
            CreatePlanArgs {
                name: "Sneaky".into(),
                campus_id: options::SAMPLE_CAMPUS_ID,
                session_id: options::SAMPLE_SESSION_ID,
            },
        )
        .expect_err("the reserved scope must be refused");
        assert!(
            err.to_lowercase().contains("reserved"),
            "the error must name the reservation, got: {err}"
        );
        assert_eq!(
            store.list_plans().expect("list").len(),
            1,
            "nothing was created in the sample scope"
        );
    }

    #[test]
    fn get_plan_delete_plan_and_membership_round_trip_through_the_seam() {
        let mut store = seeded_store();

        let empty = get_plan_impl(&store, "p1").expect("get plan");
        assert_eq!(empty.name, "T1 load");
        assert_eq!(empty.campus_name, "Manila");
        assert_eq!(empty.session_name, "AY2026-27 T1");
        assert!(empty.sections.is_empty());

        // Adding an out-of-plan-conflicting section succeeds (ADR-0009).
        let added = add_section_to_plan_impl(
            &mut store,
            SectionInPlanArgs { plan_id: "p1".into(), course_id: 2923, section_id: 384 },
        )
        .expect("add must succeed and return the updated plan");
        assert_eq!(added.sections.len(), 1);
        assert_eq!(added.sections[0].section_id, 384);
        assert_eq!(added.section_count, 1);

        // A different-term section is rejected naming the mismatch.
        store
            .record_capture(
                &CaptureScope { campus_id: 8, session_id: 156 },
                &[parsed_section(2923, 999, "S99", vec![])],
                T1,
            )
            .expect("other-term capture");
        let err = add_section_to_plan_impl(
            &mut store,
            SectionInPlanArgs { plan_id: "p1".into(), course_id: 2923, section_id: 999 },
        )
        .expect_err("a different-term section must be rejected");
        assert!(
            err.contains("scoped to") && err.contains("campus 8"),
            "the error names the mismatch, got: {err}"
        );

        let pinned = set_section_pinned_impl(
            &mut store,
            SetPinnedArgs {
                plan_id: "p1".into(),
                course_id: 2923,
                section_id: 384,
                pinned: true,
            },
        )
        .expect("pin returns the updated plan");
        assert!(pinned.sections[0].pinned);

        let removed = remove_section_from_plan_impl(
            &mut store,
            SectionInPlanArgs { plan_id: "p1".into(), course_id: 2923, section_id: 384 },
        )
        .expect("remove returns the updated plan");
        assert!(removed.sections.is_empty());

        delete_plan_impl(&mut store, "p1").expect("delete");
        let err =
            get_plan_impl(&store, "p1").expect_err("a deleted plan cannot be fetched any more");
        assert!(err.contains("not found"), "got: {err}");
    }

    #[test]
    fn forget_captured_course_returns_the_updated_summary_and_the_affected_plan_report() {
        let mut store = seeded_store();
        store.add_section_to_plan("p1", 2923, 384).expect("p1 holds C2923/S01");
        store.set_section_pinned("p1", 2923, 384, true).expect("pin it");

        let args = CapturedSectionsArgs { campus_id: 7, session_id: 155, course_id: 2923 };
        let outcome = forget_captured_course_impl(&mut store, args)
            .expect("forget succeeds and releases the holding plan through the seam");
        assert_eq!(
            outcome.affected_plans,
            vec![AffectedPlan { plan_id: "p1".into(), removed_sections: 1 }],
            "the seam reports which plans lost sections, pinned ones included"
        );
        assert_eq!(
            (outcome.summary.section_count, outcome.summary.course_count),
            (1, 1),
            "the returned summary counts only what survives"
        );
        let listed = list_captured_courses_impl(
            &store,
            CaptureScope { campus_id: 7, session_id: 155 },
        )
        .expect("picker reads the same truth");
        assert_eq!(listed.iter().map(|course| course.course_id).collect::<Vec<_>>(), vec![564]);

        let err = forget_captured_course_impl(
            &mut store,
            CapturedSectionsArgs { campus_id: 7, session_id: 155, course_id: 2923 },
        )
        .expect_err("a second forget has nothing left to remove");
        assert!(err.contains("nothing to forget"), "got: {err}");
    }

    #[test]
    fn captured_course_and_section_queries_cross_the_seam_per_scope() {
        let store = seeded_store();
        let scope = CampusSessionArgs { campus_id: 7, session_id: 155 };

        let courses =
            list_captured_courses_impl(&store, capture_scope(&scope)).expect("captured courses");
        assert_eq!(
            courses.iter().map(|course| course.code.as_str()).collect::<Vec<_>>(),
            vec!["C2923", "C564"],
        );
        assert_eq!(courses[0].section_count, 1);

        let sections = list_captured_sections_impl(
            &store,
            CapturedSectionsArgs { campus_id: 7, session_id: 155, course_id: 2923 },
        )
        .expect("captured sections");
        assert_eq!(sections.len(), 1);
        assert_eq!(sections[0].modality, SectionModality::Online);
        assert_eq!(sections[0].blocks.len(), 1);
        assert_eq!(sections[0].blocks[0].modality, BlockModality::Online);
        assert_eq!(
            sections[0].latest_snapshot.teacher, None,
            "a blank teacher crosses the seam as unknown"
        );

        let other_term = list_captured_courses_impl(
            &store,
            CaptureScope { campus_id: 8, session_id: 156 },
        )
        .expect("other term query");
        assert!(other_term.is_empty(), "another term's rows never leak in");
    }

    #[test]
    fn conflicts_and_missing_sections_expose_the_existing_store_queries() {
        let mut store = store();
        let scope = CaptureScope { campus_id: 7, session_id: 155 };
        let overlapping = vec![
            parsed_section(2923, 384, "S01", vec![block(Day::Mon, 450)]),
            parsed_section(2923, 385, "S02", vec![block(Day::Mon, 480)]),
        ];
        store.record_capture(&scope, &overlapping, T1).expect("capture");
        store.create_plan("p1", "T1 load", &scope, T1).expect("plan");
        store.add_section_to_plan("p1", 2923, 384).expect("add");
        store.add_section_to_plan("p1", 2923, 385).expect("add — conflict is legal (ADR-0009)");

        let conflicts = get_plan_conflicts_impl(&store, "p1").expect("conflicts");
        assert_eq!(conflicts.len(), 1);
        assert_eq!(conflicts[0].day, Day::Mon);
        assert_eq!(conflicts[0].start_min, 480);

        // Refresh flags S02 missing; the seam exposes the named banner data.
        store
            .apply_refresh("p1", 2923, &[overlapping[0].clone()], T1)
            .expect("refresh");
        let missing = get_missing_sections_impl(&store, "p1").expect("missing sections");
        assert_eq!(missing.len(), 1);
        assert_eq!(missing[0].section_id, 385);
        assert_eq!(missing[0].alternatives.len(), 1, "S01 remains an alternative");

        apply_solution_impl(
            &mut store,
            ApplySolutionArgs {
                plan_id: "p1".into(),
                sections: vec![SectionRef { course_id: 564, section_id: 737 }],
            },
        )
        .expect_err("an unknown section fails loudly through apply too");
    }

    #[test]
    fn apply_solution_writes_the_solution_and_returns_the_updated_plan() {
        let mut store = seeded_store();
        let plan = apply_solution_impl(
            &mut store,
            ApplySolutionArgs {
                plan_id: "p1".into(),
                sections: vec![
                    SectionRef { course_id: 2923, section_id: 384 },
                    SectionRef { course_id: 564, section_id: 737 },
                ],
            },
        )
        .expect("apply returns the updated plan");
        assert_eq!(plan.sections.len(), 2);
        assert!(plan.sections.iter().all(|section| !section.pinned));

        // Applied sections stay individually removable.
        let after_remove = remove_section_from_plan_impl(
            &mut store,
            SectionInPlanArgs { plan_id: "p1".into(), course_id: 564, section_id: 737 },
        )
        .expect("applied sections stay removable");
        assert_eq!(after_remove.sections.len(), 1);
    }

    // ---------- solve seam: exclusion is visible and reversible (ticket 34) ----------

    /// What a fresh frontend send now produces: exclude-full on by default
    /// (ticket 34), everything else untouched.
    fn fresh_solve_options() -> SolveOptions {
        SolveOptions {
            preset: Preset::FewestCampusDays,
            day_blacklist: vec![],
            earliest_start_min: None,
            latest_end_min: None,
            exclude_full: true,
            result_limit: 12,
        }
    }

    #[test]
    fn a_full_plan_section_survives_and_the_result_carries_the_numbers_age() {
        let mut store = store();
        let scope = CaptureScope { campus_id: 7, session_id: 155 };
        // S01 sits exactly at capacity; the student chose it anyway.
        let mut s01 = parsed_section(2923, 384, "S01", vec![block(Day::Mon, 450)]);
        s01.enrolled = Some(45);
        s01.enroll_cap = Some(45);
        let y11 = parsed_section(564, 737, "Y11", vec![block(Day::Tue, 570)]);
        store.record_capture(&scope, &[s01, y11], T1).expect("capture");
        store.create_plan("p1", "T1 load", &scope, T1).expect("plan");
        store.add_section_to_plan("p1", 2923, 384).expect("choose");
        store.set_section_pinned("p1", 2923, 384, true).expect("pin");

        let args = SolvePlanArgs { plan_id: "p1".into(), options: fresh_solve_options() };
        let (mut solver, stamp) = begin_solve(&store, &args).expect("begin solve");
        assert_eq!(
            stamp.as_deref(),
            Some(T1),
            "the solve knows how old the enrolment numbers are"
        );

        let outcome = solver.run();
        assert_eq!(outcome.status, SolveStatus::Complete);
        assert_eq!(
            outcome.excluded_full_count, 0,
            "the plan's own section was never a candidate to exclude"
        );

        let result = finish_outcome(outcome, "p1", false, stamp);
        assert_eq!(result.snapshot_taken_at.as_deref(), Some(T1));
        assert_eq!(result.excluded_full_count, 0);
        let pinned = result.solutions[0]
            .sections
            .iter()
            .find(|section| section.pinned)
            .expect("the plan section stays in every result");
        assert_eq!(
            (pinned.course_id, pinned.section_id),
            (2923, 384),
            "a plan section at capacity survives, pinned or not"
        );
    }

    #[test]
    fn an_all_full_course_reaches_the_wire_unsatisfiable_with_reason_count_and_stamp() {
        let mut store = store();
        let scope = CaptureScope { campus_id: 7, session_id: 155 };
        let mut s01 = parsed_section(2923, 384, "S01", vec![block(Day::Mon, 450)]);
        s01.enrolled = Some(50);
        s01.enroll_cap = Some(45);
        store.record_capture(&scope, &[s01], T1).expect("capture");
        store.create_plan("p1", "T1 load", &scope, T1).expect("plan");

        let args = SolvePlanArgs { plan_id: "p1".into(), options: fresh_solve_options() };
        let (mut solver, stamp) = begin_solve(&store, &args).expect("begin solve");
        let outcome = solver.run();

        assert_eq!(outcome.status, SolveStatus::Unsatisfiable);
        assert_eq!(outcome.excluded_full_count, 1);

        let result = finish_outcome(outcome, "p1", false, stamp);
        assert_eq!(result.status, SolveStatus::Unsatisfiable);
        assert_eq!(result.excluded_full_count, 1);
        assert_eq!(result.snapshot_taken_at.as_deref(), Some(T1));
        let json = serde_json::to_value(&result).unwrap();
        assert_eq!(json["excludedFullCount"], 1, "the count crosses the wire camelCased");
        assert_eq!(json["snapshotTakenAt"], T1);
        assert_eq!(
            json["unsatisfiableCourses"][0]["reason"],
            "all_sections_full",
            "the reason is named, never a bare 'no solutions'"
        );
    }

    // `start_refresh` and `resume_refresh` were the last stubs; ticket 26
    // implemented them on top of the ticket-16 runner and the driver. Their
    // storage seam is pinned by the tests below: trusted steps land through
    // `apply_refresh`, never as undoable capture batches, and progress is
    // announced once per course.

    /// Event sink recording every announced refresh progress payload.
    #[derive(Clone, Default)]
    struct RecordingRefreshEvents(StdArc<StdMutex<Vec<RefreshProgress>>>);

    impl RefreshEvents for RecordingRefreshEvents {
        fn refresh_progress(&self, progress: RefreshProgress) {
            self.0.lock().unwrap().push(progress);
        }
    }

    fn sink_handle(store: Store) -> (StoreHandle, StoreHandle) {
        let handle: StoreHandle = StdArc::new(StdMutex::new(store));
        (handle.clone(), handle)
    }

    /// Creating or destroying a webview window has to reach the event loop.
    /// Tauri runs a plain `#[tauri::command]` on the main thread -- which *is*
    /// the event loop thread -- so `build()` there waits for a window creation
    /// the blocked loop can never deliver: the popup renders white, ignores
    /// its close button, and `build()` never returns. No async test can catch
    /// this, because the deadlock needs Tauri's real main thread; a source
    /// guard is the honest way to hold the invariant.
    #[test]
    fn window_commands_run_off_the_main_thread() {
        let src = std::fs::read_to_string("src/interface/commands.rs")
            .expect("commands.rs must be readable from the package root");

        for name in ["open_capture_window", "clear_browser_session"] {
            let decl = format!("pub fn {name}(");
            let at = src
                .find(&decl)
                .unwrap_or_else(|| panic!("{name} must be declared in this file"));
            let preceding = src[..at].trim_end();
            assert!(
                preceding.ends_with("#[tauri::command(async)]"),
                "{name} touches a webview window, so it must be declared                  #[tauri::command(async)] to run off the main thread;                  a plain #[tauri::command] deadlocks the event loop"
            );
        }
    }

    #[test]
    fn a_trusted_step_lands_through_apply_refresh_never_the_undo_journal() {
        let mut store = store();
        let scope = CaptureScope { campus_id: 7, session_id: 155 };
        store.create_plan("p1", "T1 load", &scope, T1).expect("plan");
        // Baseline catalog laid down through the refresh path itself —
        // deliberately not the journaling capture path.
        let initial = vec![parsed_section(2923, 384, "S01", vec![block(Day::Mon, 450)])];
        store.apply_refresh("p1", 2923, &initial, T1).expect("baseline");
        store.add_section_to_plan("p1", 2923, 384).expect("choose");


        let (sink_store, read_store) = sink_handle(store);
        let sink = LiveRefreshSink { store: sink_store, events: RecordingRefreshEvents::default() };

        // The fresh results no longer carry section 384 — it must be flagged
        // missing, never deleted — and S02 arrives as new.
        let fresh = vec![parsed_section(2923, 385, "S02", vec![block(Day::Mon, 570)])];
        sink.persist("p1", 2923, &fresh).expect("the step persists");

        let read = read_store.lock().unwrap();

        let missing = read.missing_sections("p1").expect("missing query");
        assert_eq!(missing.len(), 1, "the vanished plan section is flagged");
        assert_eq!(missing[0].section_id, 384);
        assert_eq!(missing[0].alternatives.len(), 1, "S02 remains an alternative");

        let sections = read.captured_sections(&scope, 2923).expect("sections");
        assert_eq!(sections.len(), 2, "snapshots are appended through the refresh path");
        assert!(sections.iter().any(|section| section.section_id == 385));
    }

    #[test]
    fn a_persistence_failure_surfaces_identifiably_from_the_sink() {
        let (sink_store, _) = sink_handle(seeded_store());
        let sink = LiveRefreshSink { store: sink_store, events: () };

        let err = sink
            .persist("no-such-plan", 2923, &[])
            .expect_err("an unknown plan cannot absorb a refresh");
        assert!(err.contains("not found"), "identifiable, got: {err}");
    }

    #[test]
    fn progress_is_announced_once_per_course_with_the_runner_s_indices() {
        let events = RecordingRefreshEvents::default();
        let (_, store_handle) = sink_handle(seeded_store());
        let sink = LiveRefreshSink { store: store_handle, events: clone_events(&events) };

        sink.progress(0, 3, "CSINTSY");
        sink.progress(1, 3, "GEARTAP");

        let announced = events.0.lock().unwrap().clone();
        assert_eq!(announced.len(), 2, "once per course");
        assert_eq!(announced[0].course_index, 0);
        assert_eq!(announced[0].course_total, 3);
        assert_eq!(announced[0].course_code, "CSINTSY");
        assert_eq!(announced[1].course_index, 1);

        // The wire shape matches docs/ipc-contract.md's declared payload.
        let json = serde_json::to_value(&announced[0]).unwrap();
        assert_eq!(json["courseIndex"], 0);
        assert_eq!(json["courseTotal"], 3);
        assert_eq!(json["courseCode"], "CSINTSY");
    }

    fn clone_events(events: &RecordingRefreshEvents) -> RecordingRefreshEvents {
        events.clone()
    }

    // ---------- broken-capture report (ticket 19) ----------

    /// Raw DOM as the failure site retains it — hazard-laden, never scrubbed.
    const RAW_RETAINED_FRAGMENT: &str = "<html><body>\
         <input type=\"hidden\" name=\"hdnStudId\" value=\"2299999\">\
         <input type=\"hidden\" name=\"MAC_ADDRESS\" value=\"60:45:BD:1B:55:13\">\
         <table id=\"tblCourseSelection\"><tbody><tr><td>S01</td></tr></tbody></table>\
         </body></html>";

    fn retained_failures_with_one_failure() -> crate::adapters::capture::RetainedFailures {
        let failures = crate::adapters::capture::RetainedFailures::default();
        failures.record(crate::adapters::capture::CapturedFailure {
            error: "unparseable capture payload: results table not found in the given HTML"
                .into(),
            fragment: Some(RAW_RETAINED_FRAGMENT.into()),
        });
        failures
    }

    fn bundled_config() -> LoadedSelectorConfig {
        crate::adapters::remote_config::bundled()
    }

    #[test]
    fn the_report_command_assembles_from_the_retained_failure_and_scrubs_first() {
        let failures = retained_failures_with_one_failure();
        let report = build_capture_report_impl(
            &failures,
            "unparseable capture payload: results table not found in the given HTML",
            "0.1.0".into(),
            &bundled_config(),
        )
        .expect("a retained failure builds a report");

        assert!(report.body.contains("results table not found"));
        assert!(report.body.contains("Animo Plan version: 0.1.0"));
        assert!(
            !report.body.contains("hdnStudId") && !report.body.contains("2299999"),
            "the raw fragment must be scrubbed before assembly: {}",
            report.body
        );
        assert!(report.body.contains("tblCourseSelection"), "the table survives");
        assert!(report.issue_url.starts_with("https://github.com/"));

        // An unknown error is refused loudly — a report must correspond to
        // an actual capture failure this launch saw.
        let err = build_capture_report_impl(
            &failures,
            "an error no capture ever announced",
            "0.1.0".into(),
            &bundled_config(),
        )
        .expect_err("no report without a matching retained failure");
        assert!(err.to_lowercase().contains("no matching"), "got: {err}");
    }

    #[test]
    fn the_report_command_never_transmits_anything() {
        // The whole flow is local composition; this pins that the only
        // network-shaped string it produces is the issue URL the student
        // opens themselves — nothing posts, nothing phones home (ADR-0004).
        let failures = retained_failures_with_one_failure();
        let report = build_capture_report_impl(
            &failures,
            "unparseable capture payload: results table not found in the given HTML",
            "0.1.0".into(),
            &bundled_config(),
        )
        .expect("report");
        let urls: Vec<&str> = report
            .body
            .lines()
            .filter(|line| line.trim_start().starts_with("http"))
            .map(|line| line.trim())
            .chain(std::iter::once(report.issue_url.as_str()))
            .collect();
        for url in urls {
            let parsed = reqwest::Url::parse(url).expect("any url in a report parses");
            assert_eq!(parsed.host_str(), Some("github.com"), "{url}");
        }
    }

    // ---------- solve seam (ticket 25) ----------

    fn solve_options() -> SolveOptions {
        SolveOptions {
            preset: Preset::FewestCampusDays,
            day_blacklist: vec![],
            earliest_start_min: None,
            latest_end_min: None,
            exclude_full: false,
            result_limit: 12,
        }
    }

    #[test]
    fn solve_seeds_from_the_current_plan_and_returns_scored_ranked_solutions() {
        let mut store = seeded_store();
        // The plan already chose C2923/S01 (Mon), unpinned: the solve may
        // keep it or swap it within C2923, but C2923 stays in every result
        // (ticket 42). Here keeping it is the only valid completion.
        store.add_section_to_plan("p1", 2923, 384).expect("choose");
        let args = SolvePlanArgs { plan_id: "p1".into(), options: solve_options() };

        let (mut solver, stamp) = begin_solve(&store, &args).expect("the solver builds");
        let result = finish_outcome(solver.run(), &args.plan_id, false, stamp);

        assert_eq!(result.status, SolveStatus::Complete);
        assert!(
            result.snapshot_taken_at.is_some(),
            "the seeded scope has snapshots, so the result carries their age"
        );
        assert!(result.resume_token.is_none(), "a complete solve mints no token");
        assert_eq!(
            result.solutions.len(),
            1,
            "C564 has one captured section, so one conflict-free completion"
        );
        let solution = &result.solutions[0];
        assert_eq!(solution.id, "solution-0", "every solution carries a stable id");
        let seeded = solution
            .sections
            .iter()
            .find(|section| section.section_id == 384)
            .expect("the chosen plan section survives in the result");
        assert!(
            !seeded.pinned,
            "pin state crosses the seam truthfully: this member was never pinned"
        );
        assert!(
            solution.sections.iter().any(|s| !s.pinned && s.course_id == 564),
            "only unassigned courses are filled"
        );
        let sum: f64 = solution.breakdown.iter().map(|component| component.points).sum();
        assert!(
            (solution.score - sum).abs() < 1e-9,
            "each returned solution carries its score breakdown"
        );

        // An unknown plan cannot seed a solve at all.
        let Err(err) = begin_solve(
            &store,
            &SolvePlanArgs {
                plan_id: "missing".into(),
                options: solve_options(),
            },
        ) else {
            panic!("an unknown plan must fail loudly");
        };
        assert!(err.contains("not found"), "got: {err}");
    }

    #[test]
    fn solving_a_plan_with_nothing_pinned_swaps_a_choice_that_leaves_no_room() {
        // The reported case, through the real seam: pin nothing, choose
        // C2923/S01 which collides with the only section of captured C564,
        // and the solve still answers — by swapping the unpinned choice for
        // its own course's alternative.
        let mut store = store();
        let scope = CaptureScope { campus_id: 7, session_id: 155 };
        store
            .record_capture(
                &scope,
                &[
                    parsed_section(2923, 384, "S01", vec![block(Day::Mon, 450)]),
                    parsed_section(2923, 385, "S02", vec![block(Day::Tue, 450)]),
                    parsed_section(564, 737, "Y11", vec![block(Day::Mon, 450)]),
                ],
                T1,
            )
            .expect("capture");
        store.create_plan("p1", "T1 load", &scope, T1).expect("plan");
        store.add_section_to_plan("p1", 2923, 384).expect("choose, deliberately unpinned");

        let args = SolvePlanArgs { plan_id: "p1".into(), options: solve_options() };
        let (mut solver, stamp) = begin_solve(&store, &args).expect("the solver builds");
        let result = finish_outcome(solver.run(), &args.plan_id, false, stamp);

        assert_eq!(result.status, SolveStatus::Complete);
        assert_eq!(result.solutions.len(), 1);
        let picked: Vec<(i64, i64)> = result.solutions[0]
            .sections
            .iter()
            .map(|section| (section.course_id, section.section_id))
            .collect();
        assert_eq!(
            picked,
            vec![(564, 737), (2923, 385)],
            "S01 made way for Y11 within its own course; nothing was dropped"
        );
        assert!(
            result.solutions[0].sections.iter().all(|section| !section.pinned),
            "nothing in this plan is pinned and the result says so"
        );
    }

    #[test]
    fn a_course_with_no_valid_section_comes_back_named_in_the_result() {
        let mut store = seeded_store();
        store.add_section_to_plan("p1", 2923, 384).expect("choose");
        let mut options_args = solve_options();
        options_args.day_blacklist = vec![Day::Tue]; // C564's only section sits on Tuesday
        let args = SolvePlanArgs { plan_id: "p1".into(), options: options_args };

        let (mut solver, stamp) = begin_solve(&store, &args).expect("the solver builds");
        let result = finish_outcome(solver.run(), &args.plan_id, false, stamp);

        assert_eq!(result.status, SolveStatus::Unsatisfiable);
        assert!(result.solutions.is_empty());
        assert_eq!(result.unsatisfiable_courses.len(), 1);
        assert_eq!(result.unsatisfiable_courses[0].course_id, 564);
        assert_eq!(result.unsatisfiable_courses[0].code, "C564");
    }

    #[test]
    fn solutions_carry_advisory_warnings_across_the_seam() {
        // A fixed F2F class ending at 9:00 in building J and a solvable
        // course whose only section starts at 9:00 in building V: legal,
        // but warned.
        let mut store = store();
        let scope = CaptureScope { campus_id: 7, session_id: 155 };
        let room_block = |start_min: i64, room: &str| ParsedBlock {
            day: Day::Mon,
            start_min,
            end_min: start_min + 90,
            location: ParsedLocation::Room(room.into()),
        };
        let fixed = parsed_section(2923, 384, "S01", vec![room_block(450, "J112")]);
        let warned = parsed_section(564, 737, "Y11", vec![room_block(540, "V501")]);
        store.record_capture(&scope, &[fixed, warned], T1).expect("capture");
        store.create_plan("p1", "T1 load", &scope, T1).expect("plan");
        store.add_section_to_plan("p1", 2923, 384).expect("choose");

        let args = SolvePlanArgs { plan_id: "p1".into(), options: solve_options() };
        let (mut solver, stamp) = begin_solve(&store, &args).expect("the solver builds");
        let result = finish_outcome(solver.run(), &args.plan_id, false, stamp);

        assert_eq!(result.status, SolveStatus::Complete);
        assert_eq!(
            result.solutions.len(),
            1,
            "the fixture assumption: exactly one conflict-free completion"
        );
        assert_eq!(
            result.solutions[0].warnings.len(),
            1,
            "the advisory transition warning crosses the seam with the solution"
        );
        assert_eq!(
            result.solutions[0].warnings[0].kind,
            WarningKind::F2FF2FDifferentBuildings
        );
        assert_eq!(result.solutions[0].warnings[0].day, Day::Mon);
    }

    /// 4 courses x 6 non-conflicting sections each — enough search space
    /// that a small node budget stops mid-run.
    fn wide_problem() -> Vec<crate::core::solver::SolverCourse> {
        let days = [Day::Mon, Day::Tue, Day::Wed, Day::Thu, Day::Fri, Day::Sat];
        (0..4)
            .map(|course_index| {
                let day = days[course_index];
                crate::core::solver::SolverCourse {
                    course_id: course_index as i64 + 1,
                    code: format!("C{}", course_index + 1),
                    sections: (0..6)
                        .map(|section_index| crate::core::solver::SolverSection {
                            section_id: section_index as i64 + 1,
                            section_code: format!("S{}", section_index + 1),
                            blocks: vec![ScheduleBlock {
                                day,
                                start_min: 450 + section_index as i64 * 90,
                                end_min: 540 + section_index as i64 * 90,
                                location: None,
                                modality: BlockModality::Online,
                            }],
                            enrolled: None,
                            enroll_cap: None,
                            teacher: None,
                        })
                        .collect(),
                }
            })
            .collect()
    }

    #[test]
    fn a_partial_solve_mints_a_resume_envelope_that_continues_not_restarts() {
        let mut solver = Solver::new(wide_problem(), vec![], solve_options());
        let stopped = solver.run_with_budget(50);
        assert_eq!(stopped.status, SolveStatus::Partial);
        let state_token = stopped.resume_token.expect("a partial stop mints a token");

        // The seam wraps the state in an envelope naming the owning plan.
        let envelope_token = mint_resume_token("p1", &state_token);

        // Opening for the wrong plan is rejected; opening for the owner
        // rebuilds the search exactly where it stopped.
        let err = open_resume_token(&envelope_token, "other-plan")
            .expect_err("a token minted for p1 must not serve another plan");
        assert!(err.contains("p1"), "the error names both plans, got: {err}");

        let inner = open_resume_token(&envelope_token, "p1").expect("opens for the owner");
        let mut resumed = Solver::from_token(&inner).expect("the token resumes");
        let finished = resumed.run();
        assert_eq!(finished.status, SolveStatus::Complete);
        assert_eq!(
            finished.solutions.len(),
            12,
            "resuming continues the search rather than restarting it"
        );

        assert!(open_resume_token("garbage", "p1").is_err(), "a garbled token is rejected");
    }

    #[test]
    fn cancellation_reports_cancelled_and_never_leaks_a_resume_token() {
        let mut solver = Solver::new(wide_problem(), vec![], solve_options());
        let stopped = solver.run_with_budget(50);
        assert_eq!(stopped.status, SolveStatus::Partial);

        // Cancelled beats whatever the chunk found: no partial token may
        // survive, so a stale Continue can never resurrect a dead run.
        let result = finish_outcome(stopped, "p1", true, None);
        assert_eq!(result.status, SolveStatus::Cancelled);
        assert!(result.resume_token.is_none());

        // A clean chunk under no cancellation keeps its statuses untouched.
        let mut fresh = Solver::new(vec![], vec![], solve_options());
        let complete = fresh.run();
        let result = finish_outcome(complete, "p1", false, None);
        assert_eq!(result.status, SolveStatus::Complete);
    }

    // ---------- teacher preferences seam (ticket 47) ----------

    #[test]
    fn list_rankable_teachers_crosses_the_seam_with_keyed_and_deduplicated_teachers() {
        let mut store = seeded_store();
        // Add teachers to the captured sections.
        store.record_capture(
            &CaptureScope { campus_id: 7, session_id: 155 },
            &[
                {
                    let mut s = parsed_section(2923, 384, "S01", vec![block(Day::Mon, 450)]);
                    s.teacher = Some("Bryant Lee".into());
                    s
                },
                {
                    let mut s = parsed_section(2923, 385, "S02", vec![block(Day::Tue, 570)]);
                    s.teacher = Some("BRYANT LEE".into());
                    s
                },
            ],
            T1,
        ).expect("capture with teachers");

        let teachers = store.rankable_teachers(
            &CaptureScope { campus_id: 7, session_id: 155 },
            2923,
        ).expect("rankable");
        assert_eq!(teachers.len(), 1, "same key deduplicates");
        assert_eq!(teachers[0].key, "bryant lee");
        assert_eq!(teachers[0].display_name, "Bryant Lee");
        assert_eq!(teachers[0].section_ids, vec![384, 385]);
    }

    #[test]
    fn write_and_read_course_preferences_round_trip_through_the_store() {
        let mut store = seeded_store();
        store.record_capture(
            &CaptureScope { campus_id: 7, session_id: 155 },
            &[
                {
                    let mut s = parsed_section(2923, 384, "S01", vec![block(Day::Mon, 450)]);
                    s.teacher = Some("Bryant Lee".into());
                    s
                },
                {
                    let mut s = parsed_section(2923, 385, "S02", vec![block(Day::Tue, 570)]);
                    s.teacher = Some("Other Teacher".into());
                    s
                },
            ],
            T1,
        ).expect("capture with teachers");

        let scope = CaptureScope { campus_id: 7, session_id: 155 };
        store.write_course_preferences(
            &scope, 2923,
            &[("bryant lee".into(), "Bryant Lee".into())],
            &[("other teacher".into(), "Other Teacher".into())],
        ).expect("write prefs");

        let prefs = store.course_preferences(&scope, 2923).expect("read prefs");
        assert_eq!(prefs.len(), 2);
        let ranked = prefs.iter().find(|p| p.teacher_key == "bryant lee").expect("ranked");
        assert_eq!(ranked.rank, Some(1));
        assert!(!ranked.avoid);
        let avoided = prefs.iter().find(|p| p.teacher_key == "other teacher").expect("avoided");
        assert_eq!(avoided.rank, None);
        assert!(avoided.avoid);
    }
}
