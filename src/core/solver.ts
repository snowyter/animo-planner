/**
 * Core solver domain logic and helpers.
 *
 * SPEC §6, ADR-0010, ADR-0014:
 * - Three primary presets: Fewest campus days, No early mornings, Most online.
 * - Secondary constraints: Day blacklist, start/end bounds, exclude full.
 * - Legible score breakdowns and advisory transition warnings.
 * - Unsatisfiable course messaging.
 */

import type {
  Preset,
  ScoreComponent,
  SectionRef,
  Solution,
  SolveOptions,
  TransitionWarning,
  UnsatisfiableCourse,
} from "../adapters/ipc/types";
import { formatMinutesToTime24 } from "./grid";

export interface PresetInfo {
  preset: Preset;
  label: string;
  description: string;
}

export const PRESET_INFOS: readonly PresetInfo[] = [
  {
    preset: "fewest_campus_days",
    label: "Fewest campus days",
    description: "Minimizes campus days by grouping classes into fewer commuting days",
  },
  {
    preset: "no_early_mornings",
    label: "No early mornings",
    description: "Avoids early 07:30 and 09:15 class blocks",
  },
  {
    preset: "most_online",
    label: "Most online",
    description: "Prioritizes online class blocks over in-person attendance",
  },
];

/**
 * Returns default SolveOptions with sensible defaults.
 *
 * Ticket 34: exclude-full defaults to on — a section at capacity cannot be
 * enlisted into, so a fresh solve never builds around one. The student can
 * still turn it off in secondary constraints.
 */
export function defaultSolveOptions(preset: Preset = "fewest_campus_days"): SolveOptions {
  return {
    preset,
    dayBlacklist: [],
    earliestStartMin: null,
    latestEndMin: null,
    excludeFull: true,
    resultLimit: 20,
  };
}

/**
 * Formats advisory transition warnings with day and time details.
 */
export function formatWarningLabel(warning: TransitionWarning): string {
  const timeRange = `${formatMinutesToTime24(warning.startMin)}–${formatMinutesToTime24(warning.endMin)}`;
  switch (warning.kind) {
    case "f2f_online_back_to_back":
      return `F2F → Online back-to-back on ${warning.day} (${timeRange})`;
    case "f2f_f2f_different_buildings":
      return `F2F → F2F in different buildings on ${warning.day} (${timeRange})`;
    default:
      // An unrecognised kind still says something. Falling off the switch
      // returned undefined, which rendered as an empty warning box: a yellow
      // panel telling the student nothing at all.
      return `Tight transition on ${warning.day} (${timeRange})`;
  }
}

/**
 * Names a course and, when exclusion is the cause (ticket 34), says so —
 * "no solutions" never appears without its reason.
 */
function unsatisfiableCourseLabel(course: UnsatisfiableCourse): string {
  if (course.reason === "all_sections_full") {
    return `${course.code} (every section is full)`;
  }
  return course.code;
}

/**
 * Formats a message describing why no solutions could be found.
 */
export function formatUnsatisfiableCoursesMessage(
  unsatisfiableCourses: UnsatisfiableCourse[]
): string {
  if (unsatisfiableCourses.length === 0) {
    return "No conflict-free schedules found matching your constraints.";
  }
  if (unsatisfiableCourses.length === 1) {
    return `No conflict-free schedules found. Course ${unsatisfiableCourseLabel(
      unsatisfiableCourses[0]
    )} could not be satisfied with the current constraints.`;
  }
  const codes = unsatisfiableCourses.map(unsatisfiableCourseLabel).join(", ");
  return `No conflict-free schedules found. The following courses could not be satisfied: ${codes}.`;
}

/**
 * The exclusion notice the solve dialog renders next to its results
 * (ticket 34): how many sections exclude-full removed and how old the
 * enrolment numbers behind that decision are, so the student can tell a
 * five-minute-old exclusion from a five-day-old one and turn the
 * constraint off when the numbers look stale. `null` when nothing was
 * excluded — no notice, never a nag.
 */
export function formatExclusionNotice(
  excludedFullCount: number,
  snapshotTakenAt: string | null
): string | null {
  if (excludedFullCount <= 0) {
    return null;
  }
  const sections = excludedFullCount === 1 ? "section" : "sections";
  let notice = `Excluded ${excludedFullCount} full ${sections} from this solve.`;
  if (snapshotTakenAt) {
    const captured = new Date(snapshotTakenAt);
    const rendered = isNaN(captured.getTime())
      ? snapshotTakenAt
      : captured.toLocaleString();
    notice += ` Enrolment numbers were captured ${rendered}.`;
  }
  notice +=
    ' If these numbers look stale, turn off "Exclude full sections" under Secondary Constraints and solve again.';
  return notice;
}

/**
 * Formats a score breakdown item (e.g. "Campus days: +40").
 */
export function formatScoreBreakdown(item: ScoreComponent): string {
  const sign = item.points > 0 ? "+" : "";
  return `${item.label}: ${sign}${item.points}`;
}

/**
 * Converts a solution's sections into SectionRef array for applying to a plan.
 */
export function solutionToSectionRefs(solution: Solution): SectionRef[] {
  return solution.sections.map((s) => ({
    courseId: s.courseId,
    sectionId: s.sectionId,
  }));
}
