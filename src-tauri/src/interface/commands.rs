//! Tauri command layer — the Rust half of the IPC seam.
//!
//! Every command the v1 app will ever call is declared here with its final
//! name, arguments, and return type, and registered in `lib.rs`. Ticket 25
//! wired the v1 set through the shared [`StoreHandle`] and the tested
//! storage/solver logic underneath; each body is a thin adapter that maps
//! store errors to identifiable error strings and never returns
//! plausible-looking data on failure. Three commands remain deliberate
//! stubs that fail loudly: `start_refresh` / `resume_refresh` (ticket 16's
//! driver is still unmet) and `build_capture_report` (ticket 19).
//!
//! Amendment protocol: `docs/ipc-contract.md` is the single source of truth.
//! A signature change updates this file and `src/adapters/ipc/` in the same
//! commit and names the change in its PR description.

use crate::adapters::capture::CaptureEvents;
use crate::adapters::capture_window;
use crate::adapters::sample_seed;
use crate::adapters::store::{CaptureScope, PlanDetail, PlanSummaryRow, Store, StoreHandle};
use crate::core::ics;
use crate::core::ipc_types::*;
use crate::core::options;
use crate::core::solver::{Solver, SolveOutcome};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
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

fn capture_scope(args: &CampusSessionArgs) -> CaptureScope {
    CaptureScope {
        campus_id: args.campus_id,
        session_id: args.session_id,
    }
}

fn unimplemented(command: &str) -> String {
    format!("unimplemented: {command}")
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
    pub fragment: String,
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
        is_sample: row.is_sample,
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
        is_sample: summary.is_sample,
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
            false,
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
        is_sample: plan.is_sample,
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

/// The About-screen facts (ticket 23): the app version plus which selector
/// config is running. Ticket 18 owns the real config version; until it
/// lands the bundled copy is reported honestly — `Bundled` source, and a
/// version string that names the bundled config without inventing a number
/// that would read as real.
fn app_info(app_version: String) -> AppInfo {
    AppInfo {
        app_version,
        selector_config_version: "bundled".to_string(),
        selector_config_source: SelectorConfigSource::Bundled,
    }
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

#[tauri::command]
pub fn get_app_info(app: tauri::AppHandle) -> Result<AppInfo, String> {
    Ok(app_info(app.package_info().version.to_string()))
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

/// Seeds the sample-data plan (ticket 07): the bundled fixtures go through
/// the real parser and storage layer into a plan marked `is_sample`. Runs
/// entirely offline — the fixtures are embedded at compile time.
/// Idempotent: a repeat call returns the existing sample plan untouched.
///
/// The seed writes through the shared store handle, never its own
/// connection: the loopback capture listener holds the same handle, and a
/// second connection to the same file would write outside that mutex.
#[tauri::command]
pub fn seed_sample_plan(store: tauri::State<'_, StoreHandle>) -> Result<PlanSummary, String> {
    let mut store = store.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let captured_at = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
    sample_seed::seed_sample_plan(&mut store, &captured_at).map_err(|err| err.to_string())
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
#[tauri::command]
pub fn open_capture_window(
    args: CampusSessionArgs,
    app: tauri::AppHandle,
    listener: tauri::State<'_, crate::adapters::capture::CaptureListener>,
) -> Result<(), String> {
    capture_window::open_capture_window(&app, &listener, capture_scope(&args))
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

#[tauri::command]
pub fn undo_last_capture(
    args: CampusSessionArgs,
    store: tauri::State<'_, StoreHandle>,
) -> Result<CaptureSummary, String> {
    let mut store = store.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    store.undo_last_capture().map_err(|err| err.to_string())?;
    store
        .capture_summary(&capture_scope(&args))
        .map_err(|err| err.to_string())
}

/// Signs the student out of the capture popup (ticket 10): destroys the
/// window and wipes its persisted WebView profile. The control is surfaced
/// by ticket 23; this command does the wiping.
#[tauri::command]
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

/// Builds the seeded solver for a plan (ADR-0014): sections already chosen
/// are fixed, and only unassigned courses — every other captured course of
/// the plan's scope — are filled. Constraints and preset come from
/// `args.options`.
fn begin_solve(store: &Store, args: &SolvePlanArgs) -> Result<Solver, String> {
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
        })
        .collect();
    let catalog = store.solver_courses(&scope).map_err(|err| err.to_string())?;
    Ok(Solver::new(catalog, fixed, args.options.clone()))
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
fn finish_outcome(outcome: SolveOutcome, plan_id: &str, cancelled: bool) -> SolveResult {
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
    }
}

/// One bounded search chunk, off the interface thread: the window never
/// freezes even while a chunk burns its whole node budget.
async fn run_solver_chunk(
    solver: Solver,
    plan_id: &str,
    cancellation: &Arc<AtomicBool>,
) -> Result<SolveResult, String> {
    let outcome = tauri::async_runtime::spawn_blocking(move || {
        let mut solver = solver;
        solver.run()
    })
    .await
    .map_err(|err| format!("solve task failed: {err}"))?;
    Ok(finish_outcome(outcome, plan_id, cancellation.load(Ordering::SeqCst)))
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
    let solver = {
        let store = store.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        begin_solve(&store, &args)?
    };
    // A fresh solve clears a stale cancellation; cancel_solve sets it again
    // while the chunk runs.
    cancellation.0.store(false, Ordering::SeqCst);
    run_solver_chunk(solver, &args.plan_id, &cancellation.0).await
}

#[tauri::command]
pub async fn continue_solve(
    args: ContinueSolveArgs,
    cancellation: tauri::State<'_, SolveCancellation>,
) -> Result<SolveResult, String> {
    let state_token = open_resume_token(&args.resume_token, &args.plan_id)?;
    let solver = Solver::from_token(&state_token).map_err(|err| err.to_string())?;
    cancellation.0.store(false, Ordering::SeqCst);
    run_solver_chunk(solver, &args.plan_id, &cancellation.0).await
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

#[tauri::command]
pub async fn start_refresh(_args: PlanIdArgs) -> Result<RefreshOutcome, String> {
    Err(unimplemented("start_refresh"))
}

#[tauri::command]
pub async fn resume_refresh(_args: PlanIdArgs) -> Result<RefreshOutcome, String> {
    Err(unimplemented("resume_refresh"))
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

#[tauri::command]
pub fn build_capture_report(_args: BuildCaptureReportArgs) -> Result<CaptureReport, String> {
    Err(unimplemented("build_capture_report"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::adapters::store::Store;
    use crate::core::ipc_types::{BlockModality, Day, SectionModality};
    use crate::core::parser::{ParsedBlock, ParsedLocation, ParsedSection};
    use std::future::Future;
    use std::pin::Pin;
    use std::task::{Context, Poll, RawWaker, RawWakerVTable, Waker};

    /// Minimal executor for stubs whose futures are ready immediately.
    fn block_on<F: Future>(future: F) -> F::Output {
        fn noop(_: *const ()) {}
        fn clone(_: *const ()) -> RawWaker {
            RawWaker::new(std::ptr::null(), &VTABLE)
        }
        static VTABLE: RawWakerVTable = RawWakerVTable::new(clone, noop, noop, noop);
        let waker = unsafe { Waker::from_raw(RawWaker::new(std::ptr::null(), &VTABLE)) };
        let mut context = Context::from_waker(&waker);
        let mut pinned = Box::pin(future);
        match Pin::new(&mut pinned).as_mut().poll(&mut context) {
            Poll::Ready(output) => output,
            Poll::Pending => panic!("stub future must never be pending"),
        }
    }

    fn expect_unimplemented(name: &str, result: Result<impl std::fmt::Debug, String>) {
        match result {
            Err(message) => {
                assert_eq!(message, format!("unimplemented: {name}"),
                    "{name} must fail loudly and identifiably at runtime");
            }
            Ok(value) => panic!("{name} must not return plausible data, got: {value:?}"),
        }
    }

    fn simple_args() -> PlanIdArgs {
        PlanIdArgs { plan_id: "p1".into() }
    }

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
            .create_plan("p1", "T1 load", &CaptureScope { campus_id: 7, session_id: 155 }, T1, false)
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
    fn app_info_reports_the_app_version_and_the_bundled_config_honestly() {
        let info = app_info("9.9.9".into());
        assert_eq!(info.app_version, "9.9.9");
        assert_eq!(info.selector_config_source, SelectorConfigSource::Bundled);
        assert_ne!(
            info.selector_config_version, "",
            "an empty version would read as broken data"
        );
        assert!(
            !info
                .selector_config_version
                .chars()
                .next()
                .is_some_and(|c| c.is_ascii_digit()),
            "the pre-ticket-18 version must not read like a real config version"
        );
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
        assert!(!summary.is_sample);
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
        store.create_plan("p1", "T1 load", &scope, T1, false).expect("plan");
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

    // Every command that is still a stub fails loudly and identifiably.
    // Ticket 25 implemented everything else; `start_refresh` and
    // `resume_refresh` return to ticket 16, `build_capture_report` to
    // ticket 19.
    #[test]
    fn every_command_fails_loudly_and_identifiably() {
        expect_unimplemented("start_refresh", block_on(start_refresh(simple_args())));
        expect_unimplemented("resume_refresh", block_on(resume_refresh(simple_args())));
        expect_unimplemented(
            "build_capture_report",
            build_capture_report(BuildCaptureReportArgs {
                error: "boom".into(),
                fragment: "<td></td>".into(),
            }),
        );
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
        // The plan already chose C2923/S01 (Mon); the solve fills C564.
        store.add_section_to_plan("p1", 2923, 384).expect("choose");
        let args = SolvePlanArgs { plan_id: "p1".into(), options: solve_options() };

        let mut solver = begin_solve(&store, &args).expect("the solver builds");
        let result = finish_outcome(solver.run(), &args.plan_id, false);

        assert_eq!(result.status, SolveStatus::Complete);
        assert!(result.resume_token.is_none(), "a complete solve mints no token");
        assert!(result.resume_token.is_none(), "a complete solve mints no token");
        assert_eq!(
            result.solutions.len(),
            1,
            "C564 has one captured section, so one conflict-free completion"
        );
        let solution = &result.solutions[0];
        assert_eq!(solution.id, "solution-0", "every solution carries a stable id");
        assert!(
            solution.sections.iter().any(|s| s.pinned && s.section_id == 384),
            "the chosen plan section is fixed in the result"
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
    fn a_course_with_no_valid_section_comes_back_named_in_the_result() {
        let mut store = seeded_store();
        store.add_section_to_plan("p1", 2923, 384).expect("choose");
        let mut options_args = solve_options();
        options_args.day_blacklist = vec![Day::Tue]; // C564's only section sits on Tuesday
        let args = SolvePlanArgs { plan_id: "p1".into(), options: options_args };

        let mut solver = begin_solve(&store, &args).expect("the solver builds");
        let result = finish_outcome(solver.run(), &args.plan_id, false);

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
        store.create_plan("p1", "T1 load", &scope, T1, false).expect("plan");
        store.add_section_to_plan("p1", 2923, 384).expect("choose");

        let args = SolvePlanArgs { plan_id: "p1".into(), options: solve_options() };
        let mut solver = begin_solve(&store, &args).expect("the solver builds");
        let result = finish_outcome(solver.run(), &args.plan_id, false);

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
        let result = finish_outcome(stopped, "p1", true);
        assert_eq!(result.status, SolveStatus::Cancelled);
        assert!(result.resume_token.is_none());

        // A clean chunk under no cancellation keeps its statuses untouched.
        let mut fresh = Solver::new(vec![], vec![], solve_options());
        let complete = fresh.run();
        let result = finish_outcome(complete, "p1", false);
        assert_eq!(result.status, SolveStatus::Complete);
    }
}
