/**
 * Typed TypeScript client for the Tauri IPC seam.
 *
 * One function per command declared in `docs/ipc-contract.md`, with argument
 * and return types mirroring the Rust serde types.
 *
 * Payloads cross the seam wrapped in an `args` envelope: Tauri routes a
 * command's arguments by the *parameter name* on the Rust side, and every
 * command that takes a payload declares it as `args: XArgs`. Passing the
 * fields flat makes Rust reject the call with "missing required key args".
 * The fields inside stay camelCase, matching the `#[serde(rename_all =
 * "camelCase")]` on each Args struct. This module only calls
 * commands that the contract declares; inventing one here is a contract
 * violation. Until the matching headless tickets land, every command rejects
 * with an identifiable `unimplemented: <name>` error from Rust — the client
 * deliberately does not swallow or mask it.
 */

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  AppInfo,
  CampusOption,
  CaptureReport,
  CaptureSummary,
  CapturedCourse,
  Conflict,
  Day,
  ForgetCourseOutcome,
  InstallUpdateOutcome,
  IcsExport,
  MissingSection,
  Plan,
  PlanSummary,
  Preset,
  RankableTeacher,
  RefreshOutcome,
  RefreshProgress,
  Section,
  SectionRef,
  SessionOption,
  SolveResult,
  TeacherPreference,
  UpdateCheck,
} from "./types";

// Options & app info

export function getCampusOptions(): Promise<CampusOption[]> {
  return invoke("get_campus_options");
}

export function getSessionOptions(): Promise<SessionOption[]> {
  return invoke("get_session_options");
}

export function getAppInfo(): Promise<AppInfo> {
  return invoke("get_app_info");
}

// Plans

export function listPlans(): Promise<PlanSummary[]> {
  return invoke("list_plans");
}

export function createPlan(args: {
  name: string;
  campusId: number;
  sessionId: number;
}): Promise<PlanSummary> {
  return invoke("create_plan", { args });
}

export function deletePlan(args: { planId: string }): Promise<void> {
  return invoke("delete_plan", { args });
}

export function getPlan(args: { planId: string }): Promise<Plan> {
  return invoke("get_plan", { args });
}

// Captured catalog

export function listCapturedCourses(args: {
  campusId: number;
  sessionId: number;
}): Promise<CapturedCourse[]> {
  return invoke("list_captured_courses", { args });
}

export function listCapturedSections(args: {
  campusId: number;
  sessionId: number;
  courseId: number;
}): Promise<Section[]> {
  return invoke("list_captured_sections", { args });
}

/**
 * Forgets one captured course (tickets 29, 35): its sections, blocks, and
 * snapshots are removed for exactly the given campus/session, and plans
 * holding any of those sections are released. The outcome carries the
 * updated `CaptureSummary` for the counter plus the affected-plan report,
 * so the UI can say what happened to each plan.
 */
export function forgetCapturedCourse(args: {
  campusId: number;
  sessionId: number;
  courseId: number;
}): Promise<ForgetCourseOutcome> {
  return invoke("forget_captured_course", { args });
}

/**
 * Marks whether the student intends to enrol in a captured course.
 *
 * Excluding is not forgetting: nothing is deleted and the counter does not
 * move. The updated catalog comes back with it, so the tab that toggles and
 * the tab that browses read one loaded list.
 */
export function setCourseIncluded(args: {
  campusId: number;
  sessionId: number;
  courseId: number;
  included: boolean;
}): Promise<CapturedCourse[]> {
  return invoke("set_course_included", { args });
}

// Plan membership

export function addSectionToPlan(args: {
  planId: string;
  courseId: number;
  sectionId: number;
}): Promise<Plan> {
  return invoke("add_section_to_plan", { args });
}

export function removeSectionFromPlan(args: {
  planId: string;
  courseId: number;
  sectionId: number;
}): Promise<Plan> {
  return invoke("remove_section_from_plan", { args });
}

export function setSectionPinned(args: {
  planId: string;
  courseId: number;
  sectionId: number;
  pinned: boolean;
}): Promise<Plan> {
  return invoke("set_section_pinned", { args });
}

export function getPlanConflicts(args: { planId: string }): Promise<Conflict[]> {
  return invoke("get_plan_conflicts", { args });
}

export function applySolution(args: {
  planId: string;
  sections: SectionRef[];
}): Promise<Plan> {
  return invoke("apply_solution", { args });
}

// Capture window

export function openCaptureWindow(args: {
  campusId: number;
  sessionId: number;
}): Promise<void> {
  return invoke("open_capture_window", { args });
}

export function getCaptureSummary(args: {
  campusId: number;
  sessionId: number;
}): Promise<CaptureSummary> {
  return invoke("get_capture_summary", { args });
}

export function clearBrowserSession(): Promise<void> {
  return invoke("clear_browser_session");
}

// Solver (async commands — never block the UI thread)

export function solvePlan(args: {
  planId: string;
  options: {
    preset: Preset;
    dayBlacklist: Day[];
    earliestStartMin: number | null;
    latestEndMin: number | null;
    excludeFull: boolean;
    resultLimit: number;
  };
}): Promise<SolveResult> {
  return invoke("solve_plan", { args });
}

export function continueSolve(args: {
  planId: string;
  resumeToken: string;
}): Promise<SolveResult> {
  return invoke("continue_solve", { args });
}

export function cancelSolve(): Promise<void> {
  return invoke("cancel_solve");
}

// Refresh (async commands — never block the UI thread)

export function startRefresh(args: { planId: string }): Promise<RefreshOutcome> {
  return invoke("start_refresh", { args });
}

export function resumeRefresh(args: { planId: string }): Promise<RefreshOutcome> {
  return invoke("resume_refresh", { args });
}

export function getMissingSections(args: {
  planId: string;
}): Promise<MissingSection[]> {
  return invoke("get_missing_sections", { args });
}

// Export & diagnostics

export function exportPlanIcs(args: { planId: string }): Promise<IcsExport> {
  return invoke("export_plan_ics", { args });
}

/**
 * Builds the broken-capture report (ticket 19). The arguments carry only
 * the error: the failing DOM is retained Rust-side and scrubbed there, so
 * raw DOM never crosses into the webview. The returned report is a
 * pre-filled GitHub issue URL the student opens themselves — nothing is
 * transmitted by this command.
 */
export function buildCaptureReport(args: { error: string }): Promise<CaptureReport> {
  return invoke("build_capture_report", { args });
}

// Teacher preferences (ticket 47)

/**
 * Returns the distinct teachers on the latest snapshot of each of a course's
 * sections, keyed and de-duplicated. A blank teacher has no key and never
 * appears.
 */
export function listRankableTeachers(args: {
  campusId: number;
  sessionId: number;
  courseId: number;
}): Promise<RankableTeacher[]> {
  return invoke("list_rankable_teachers", { args });
}

/**
 * Returns a course's stored preferences, including entries whose teacher no
 * longer appears in the latest-snapshot set. Those are inactive: kept,
 * returned, flagged (`active: false`), and scoring nothing.
 */
export function getCoursePreferences(args: {
  campusId: number;
  sessionId: number;
  courseId: number;
}): Promise<TeacherPreference[]> {
  return invoke("get_course_preferences", { args });
}

/**
 * Replaces a course's preferences in one call. `ranked` is an ordered list
 * of `{ key, displayName }`; `avoided` is a list of teacher keys. Returns
 * the updated preferences.
 */
export function writeCoursePreferences(args: {
  campusId: number;
  sessionId: number;
  courseId: number;
  ranked: { key: string; displayName: string }[];
  avoided: string[];
}): Promise<TeacherPreference[]> {
  return invoke("write_course_preferences", { args });
}

// Updates (ticket 38 — headless; the student decides, nothing installs itself)

/**
 * Checks GitHub Releases for a newer version. Offline, a 404, a malformed
 * document, or a bad signature each resolve to `status: "failed"` with a
 * distinguishable reason — an ordinary answer the UI may show quietly. The
 * app stays fully usable offline.
 */
export function checkForUpdate(): Promise<UpdateCheck> {
  return invoke("check_for_update");
}

/**
 * Installs the update the check found and restarts the app into it.
 * Nothing installs without this being called. A signature that does not
 * verify aborts as `status: "failed"` with reason `"signature"` — never an
 * install.
 */
export function installUpdate(): Promise<InstallUpdateOutcome> {
  return invoke("install_update");
}

// Events (Rust → main window)

export function onCaptureUpdated(
  handler: (payload: CaptureSummary) => void,
): Promise<UnlistenFn> {
  return listen<CaptureSummary>("capture:updated", (event) =>
    handler(event.payload),
  );
}

export function onCaptureFailed(
  handler: (payload: { error: string }) => void,
): Promise<UnlistenFn> {
  return listen<{ error: string }>("capture:failed", (event) =>
    handler(event.payload),
  );
}

export function onRefreshProgress(
  handler: (payload: RefreshProgress) => void,
): Promise<UnlistenFn> {
  return listen<RefreshProgress>("refresh:progress", (event) =>
    handler(event.payload),
  );
}
