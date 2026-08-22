//! Tauri command stubs — the Rust half of the IPC seam.
//!
//! Every command the v1 app will ever call is declared here with its final
//! name, arguments, and return type, and registered in `lib.rs`. The bodies
//! deliberately fail loudly: a stub never returns empty or plausible-looking
//! data, so no UI ticket can be declared finished against a command that does
//! nothing.
//!
//! Amendment protocol: `docs/ipc-contract.md` is the single source of truth.
//! A signature change updates this file and `src/adapters/ipc/` in the same
//! commit and names the change in its PR description.

use crate::core::ipc_types::*;
use serde::Deserialize;

pub mod events {
    pub const CAPTURE_UPDATED: &str = "capture:updated";
    pub const CAPTURE_FAILED: &str = "capture:failed";
    pub const REFRESH_PROGRESS: &str = "refresh:progress";
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

#[tauri::command]
pub fn get_campus_options() -> Result<Vec<CampusOption>, String> {
    Err(unimplemented("get_campus_options"))
}

#[tauri::command]
pub fn get_session_options() -> Result<Vec<SessionOption>, String> {
    Err(unimplemented("get_session_options"))
}

#[tauri::command]
pub fn get_app_info() -> Result<AppInfo, String> {
    Err(unimplemented("get_app_info"))
}

#[tauri::command]
pub fn list_plans() -> Result<Vec<PlanSummary>, String> {
    Err(unimplemented("list_plans"))
}

#[tauri::command]
pub fn create_plan(_args: CreatePlanArgs) -> Result<PlanSummary, String> {
    Err(unimplemented("create_plan"))
}

#[tauri::command]
pub fn delete_plan(_args: PlanIdArgs) -> Result<(), String> {
    Err(unimplemented("delete_plan"))
}

#[tauri::command]
pub fn get_plan(_args: PlanIdArgs) -> Result<Plan, String> {
    Err(unimplemented("get_plan"))
}

#[tauri::command]
pub fn seed_sample_plan() -> Result<PlanSummary, String> {
    Err(unimplemented("seed_sample_plan"))
}

#[tauri::command]
pub fn list_captured_courses(_args: CampusSessionArgs) -> Result<Vec<CapturedCourse>, String> {
    Err(unimplemented("list_captured_courses"))
}

#[tauri::command]
pub fn list_captured_sections(_args: CapturedSectionsArgs) -> Result<Vec<Section>, String> {
    Err(unimplemented("list_captured_sections"))
}

#[tauri::command]
pub fn add_section_to_plan(_args: SectionInPlanArgs) -> Result<Plan, String> {
    Err(unimplemented("add_section_to_plan"))
}

#[tauri::command]
pub fn remove_section_from_plan(_args: SectionInPlanArgs) -> Result<Plan, String> {
    Err(unimplemented("remove_section_from_plan"))
}

#[tauri::command]
pub fn set_section_pinned(_args: SetPinnedArgs) -> Result<Plan, String> {
    Err(unimplemented("set_section_pinned"))
}

#[tauri::command]
pub fn get_plan_conflicts(_args: PlanIdArgs) -> Result<Vec<Conflict>, String> {
    Err(unimplemented("get_plan_conflicts"))
}

#[tauri::command]
pub fn apply_solution(_args: ApplySolutionArgs) -> Result<Plan, String> {
    Err(unimplemented("apply_solution"))
}

#[tauri::command]
pub fn open_capture_window(_args: CampusSessionArgs) -> Result<(), String> {
    Err(unimplemented("open_capture_window"))
}

#[tauri::command]
pub fn get_capture_summary(_args: CampusSessionArgs) -> Result<CaptureSummary, String> {
    Err(unimplemented("get_capture_summary"))
}

#[tauri::command]
pub fn undo_last_capture(_args: CampusSessionArgs) -> Result<CaptureSummary, String> {
    Err(unimplemented("undo_last_capture"))
}

#[tauri::command]
pub fn clear_browser_session() -> Result<(), String> {
    Err(unimplemented("clear_browser_session"))
}

#[tauri::command]
pub async fn solve_plan(_args: SolvePlanArgs) -> Result<SolveResult, String> {
    Err(unimplemented("solve_plan"))
}

#[tauri::command]
pub async fn continue_solve(_args: ContinueSolveArgs) -> Result<SolveResult, String> {
    Err(unimplemented("continue_solve"))
}

#[tauri::command]
pub fn cancel_solve() -> Result<(), String> {
    Err(unimplemented("cancel_solve"))
}

#[tauri::command]
pub async fn start_refresh(_args: PlanIdArgs) -> Result<RefreshOutcome, String> {
    Err(unimplemented("start_refresh"))
}

#[tauri::command]
pub async fn resume_refresh(_args: PlanIdArgs) -> Result<RefreshOutcome, String> {
    Err(unimplemented("resume_refresh"))
}

#[tauri::command]
pub fn get_missing_sections(_args: PlanIdArgs) -> Result<Vec<MissingSection>, String> {
    Err(unimplemented("get_missing_sections"))
}

#[tauri::command]
pub fn export_plan_ics(_args: PlanIdArgs) -> Result<IcsExport, String> {
    Err(unimplemented("export_plan_ics"))
}

#[tauri::command]
pub fn build_capture_report(_args: BuildCaptureReportArgs) -> Result<CaptureReport, String> {
    Err(unimplemented("build_capture_report"))
}

#[cfg(test)]
mod tests {
    use super::*;
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
        loop {
            match Pin::new(&mut pinned).as_mut().poll(&mut context) {
                Poll::Ready(output) => return output,
                Poll::Pending => panic!("stub future must never be pending"),
            }
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

    fn scope_args() -> CampusSessionArgs {
        CampusSessionArgs { campus_id: 7, session_id: 155 }
    }

    fn section_args() -> SectionInPlanArgs {
        SectionInPlanArgs { plan_id: "p1".into(), course_id: 2923, section_id: 384 }
    }

    #[test]
    fn every_command_fails_loudly_and_identifiably() {
        expect_unimplemented("get_campus_options", get_campus_options());
        expect_unimplemented("get_session_options", get_session_options());
        expect_unimplemented("get_app_info", get_app_info());
        expect_unimplemented("list_plans", list_plans());
        expect_unimplemented("create_plan", create_plan(CreatePlanArgs {
            name: "T1".into(), campus_id: 7, session_id: 155,
        }));
        expect_unimplemented("delete_plan", delete_plan(simple_args()));
        expect_unimplemented("get_plan", get_plan(simple_args()));
        expect_unimplemented("seed_sample_plan", seed_sample_plan());
        expect_unimplemented("list_captured_courses", list_captured_courses(scope_args()));
        expect_unimplemented("list_captured_sections", list_captured_sections(CapturedSectionsArgs {
            campus_id: 7, session_id: 155, course_id: 2923,
        }));
        expect_unimplemented("add_section_to_plan", add_section_to_plan(section_args()));
        expect_unimplemented("remove_section_from_plan", remove_section_from_plan(section_args()));
        expect_unimplemented("set_section_pinned", set_section_pinned(SetPinnedArgs {
            plan_id: "p1".into(), course_id: 2923, section_id: 384, pinned: true,
        }));
        expect_unimplemented("get_plan_conflicts", get_plan_conflicts(simple_args()));
        expect_unimplemented("apply_solution", apply_solution(ApplySolutionArgs {
            plan_id: "p1".into(),
            sections: vec![SectionRef { course_id: 2923, section_id: 384 }],
        }));
        expect_unimplemented("open_capture_window", open_capture_window(scope_args()));
        expect_unimplemented("get_capture_summary", get_capture_summary(scope_args()));
        expect_unimplemented("undo_last_capture", undo_last_capture(scope_args()));
        expect_unimplemented("clear_browser_session", clear_browser_session());
        expect_unimplemented("solve_plan", block_on(solve_plan(SolvePlanArgs {
            plan_id: "p1".into(),
            options: SolveOptions {
                preset: Preset::FewestCampusDays,
                day_blacklist: vec![],
                earliest_start_min: None,
                latest_end_min: None,
                exclude_full: false,
                result_limit: 12,
            },
        })));
        expect_unimplemented("continue_solve", block_on(continue_solve(ContinueSolveArgs {
            plan_id: "p1".into(),
            resume_token: "tok".into(),
        })));
        expect_unimplemented("cancel_solve", cancel_solve());
        expect_unimplemented("start_refresh", block_on(start_refresh(simple_args())));
        expect_unimplemented("resume_refresh", block_on(resume_refresh(simple_args())));
        expect_unimplemented("get_missing_sections", get_missing_sections(simple_args()));
        expect_unimplemented("export_plan_ics", export_plan_ics(simple_args()));
        expect_unimplemented("build_capture_report", build_capture_report(BuildCaptureReportArgs {
            error: "boom".into(), fragment: "<td></td>".into(),
        }));
    }
}
