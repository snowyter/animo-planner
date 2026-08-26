/**
 * Wire types for the Tauri IPC seam.
 *
 * These mirror the Rust serde types in `src-tauri/src/core/ipc_types.rs` and
 * the single source of truth in `docs/ipc-contract.md`. The amendment protocol
 * in that file requires Rust and TypeScript sides to move together; `npm run
 * verify` type-checks this file, so a drifted signature is a build failure.
 */

export type Day = "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT";

export type BlockModality = "F2F" | "ONLINE";

export type SectionModality = "F2F" | "ONLINE" | "HYBRID";

/**
 * One meeting of a section on one day. Modality belongs to the block
 * (ADR-0007), and the location/modality pair is enforced by the type itself:
 * an online block has `location: null`, a face-to-face block has a room.
 */
export type ScheduleBlock =
  | {
      day: Day;
      startMin: number;
      endMin: number;
      modality: "F2F";
      location: string;
    }
  | {
      day: Day;
      startMin: number;
      endMin: number;
      modality: "ONLINE";
      location: null;
    };

export interface SectionRef {
  courseId: number;
  sectionId: number;
}

/**
 * Point-in-time reading of a section's mutable values. `teacher: null` means
 * *unknown* — never "not this professor"; no filter may treat it as a
 * mismatch. `remark` is opaque and never parsed or branched on.
 */
export interface Snapshot {
  capturedAt: string;
  enrolled: number;
  teacher: string | null;
  remark: string | null;
}

export interface Section {
  campusId: number;
  sessionId: number;
  courseId: number;
  courseCode: string;
  courseTitle: string;
  sectionId: number;
  sectionCode: string;
  courseType: string | null;
  credits: number | null;
  enrollCap: number;
  startDate: string | null;
  endDate: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  modality: SectionModality;
  blocks: ScheduleBlock[];
  latestSnapshot: Snapshot;
}

export interface CapturedCourse {
  courseId: number;
  code: string;
  title: string;
  sectionCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface PlanSection {
  courseId: number;
  courseCode: string;
  courseTitle: string;
  sectionId: number;
  sectionCode: string;
  pinned: boolean;
  missing: boolean;
  modality: SectionModality;
  blocks: ScheduleBlock[];
  latestSnapshot: Snapshot;
}

export interface PlanSummary {
  id: string;
  name: string;
  campusId: number;
  campusName: string;
  sessionId: number;
  sessionName: string;
  createdAt: string;
  sectionCount: number;
}

/** A plan is hard-scoped to exactly one (campus, session) — non-optional by type. */
export interface Plan extends PlanSummary {
  sections: PlanSection[];
}

export interface CampusOption {
  id: number;
  name: string;
}

export interface SessionOption {
  id: number;
  name: string;
}

export type SelectorConfigSource = "remote" | "bundled";

export interface AppInfo {
  appVersion: string;
  selectorConfigVersion: string;
  selectorConfigSource: SelectorConfigSource;
}

export interface Conflict {
  a: SectionRef;
  b: SectionRef;
  day: Day;
  /** Overlapping range, minutes since midnight. */
  startMin: number;
  endMin: number;
}

export type Preset =
  | "fewest_campus_days"
  | "no_early_mornings"
  | "most_online";

export interface SolveOptions {
  preset: Preset;
  dayBlacklist: Day[];
  earliestStartMin: number | null;
  latestEndMin: number | null;
  excludeFull: boolean;
  resultLimit: number;
}

export interface SolutionSection {
  courseId: number;
  courseCode: string;
  sectionId: number;
  sectionCode: string;
  pinned: boolean;
  blocks: ScheduleBlock[];
}

export type WarningKind =
  | "f2f_online_back_to_back"
  | "f2f_f2f_different_buildings";

export interface TransitionWarning {
  kind: WarningKind;
  day: Day;
  startMin: number;
  endMin: number;
  from: SectionRef;
  to: SectionRef;
}

export interface ScoreComponent {
  label: string;
  points: number;
}

export interface Solution {
  id: string;
  score: number;
  breakdown: ScoreComponent[];
  warnings: TransitionWarning[];
  sections: SolutionSection[];
}

export type SolveStatus = "complete" | "partial" | "cancelled" | "unsatisfiable";

/**
 * Why a course could not be filled (ticket 34). `all_sections_full` names
 * exclude-full as the cause, so "no solutions" never appears without saying
 * why.
 */
export type UnsatisfiableReason = "no_valid_section" | "all_sections_full";

export interface UnsatisfiableCourse {
  courseId: number;
  code: string;
  reason: UnsatisfiableReason;
}

export interface SolveResult {
  status: SolveStatus;
  solutions: Solution[];
  /** Present iff status is "partial"; pass to continueSolve. */
  resumeToken: string | null;
  unsatisfiableCourses: UnsatisfiableCourse[];
  /**
   * How many sections the exclude-full constraint removed (ticket 34).
   * Surfaced so the student can see the constraint working and turn it off
   * when the numbers look stale.
   */
  excludedFullCount: number;
  /**
   * The latest snapshot timestamp of the plan's scope (ticket 34) — how old
   * the enrolment numbers behind any exclusion are. Null when nothing is
   * captured in the scope yet.
   */
  snapshotTakenAt: string | null;
}

export interface CaptureSummary {
  campusId: number;
  sessionId: number;
  sectionCount: number;
  courseCount: number;
}

/** One plan a forgotten course released sections from, and how many it lost. */
export interface AffectedPlan {
  planId: string;
  removedSections: number;
}

/**
 * What `forget_captured_course` answers with: the updated summary for the
 * capture counter, plus the plans whose membership the removal released.
 */
export interface ForgetCourseOutcome {
  summary: CaptureSummary;
  affectedPlans: AffectedPlan[];
}

export type RefreshStatus = "complete" | "session_expired" | "offline";

export interface RefreshOutcome {
  status: RefreshStatus;
  refreshedCourses: number;
  totalCourses: number;
  haltedAfterCourseCode: string | null;
}

export interface RefreshProgress {
  courseIndex: number;
  courseTotal: number;
  courseCode: string;
}

export interface MissingSection {
  courseId: number;
  sectionId: number;
  sectionCode: string;
  alternatives: Section[];
}

export interface IcsExport {
  fileName: string;
  contents: string;
}

export interface CaptureReport {
  title: string;
  body: string;
  issueUrl: string;
}

export type UpdateCheckStatus =
  | "available"
  | "up_to_date"
  | "failed"
  | "unavailable";

/**
 * Why a check or install did not succeed (ticket 38). Coarse enough for a
 * UI to switch on; `failureDetail` carries the underlying message.
 */
export type UpdateFailureReason =
  | "network"
  | "endpoint"
  | "malformed"
  | "signature"
  | "unknown";

/**
 * What `checkForUpdate` answers: whether one is available, the version
 * offered, the version running, and the release notes if the endpoint
 * carries them. A failed or unreachable check is an ordinary answer
 * (`status: "failed"` plus a distinguishable reason), never a rejected
 * promise; `"unavailable"` means the updater was compiled out of this build.
 */
export interface UpdateCheck {
  status: UpdateCheckStatus;
  currentVersion: string;
  availableVersion: string | null;
  notes: string | null;
  failureReason: UpdateFailureReason | null;
  failureDetail: string | null;
}

export type InstallUpdateStatus =
  | "installed"
  | "nothing_to_install"
  | "failed"
  | "unavailable";

/**
 * What `installUpdate` answers. Nothing installs unless this command is
 * called; a signature that does not verify surfaces as `status: "failed"`
 * with reason `"signature"` — never as an installed update. A real install
 * ends with the app restarting into the new version.
 */
export interface InstallUpdateOutcome {
  status: InstallUpdateStatus;
  failureReason: UpdateFailureReason | null;
  failureDetail: string | null;
}
