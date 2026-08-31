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
  PlanSection,
  Preset,
  SectionModality,
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
    const [only] = unsatisfiableCourses;
    if (!only) {
      return "No conflict-free schedules found matching your constraints.";
    }
    return `No conflict-free schedules found. Course ${unsatisfiableCourseLabel(
      only
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

/** One piece of advice, and every occasion it applies to. */
export interface WarningGroup {
  kind: TransitionWarning["kind"];
  /** The advice itself, with no day or time in it. */
  label: string;
  /** "MON 12:30–12:45", in the order the warnings were emitted. */
  occurrences: string[];
}

/** The advice alone — the day and the time belong to the occurrence. */
function warningAdvice(kind: TransitionWarning["kind"]): string {
  switch (kind) {
    case "f2f_online_back_to_back":
      return "F2F → Online back-to-back";
    case "f2f_f2f_different_buildings":
      return "F2F → F2F in different buildings";
    default:
      // An unrecognised kind still says something rather than rendering an
      // empty advisory box: a yellow panel telling the student nothing at all.
      return "Tight transition";
  }
}

/**
 * Folds transition warnings into one row per piece of advice.
 *
 * Five warnings read as five separate problems, but three of them were the
 * same advice about the same walk on different days — and the repeated
 * sentence is what made the advisory box a wall of near-identical lines.
 *
 * Nothing is dropped: warnings stay advisory and stay visible (ADR-0009).
 * The advice is said once and the occasions are listed after it.
 */
export function groupTransitionWarnings(
  warnings: readonly TransitionWarning[]
): WarningGroup[] {
  const groups: WarningGroup[] = [];

  for (const warning of warnings) {
    const occurrence = `${warning.day} ${formatMinutesToTime24(
      warning.startMin
    )}–${formatMinutesToTime24(warning.endMin)}`;

    const existing = groups.find((g) => g.kind === warning.kind);
    if (existing) {
      existing.occurrences.push(occurrence);
    } else {
      groups.push({
        kind: warning.kind,
        label: warningAdvice(warning.kind),
        occurrences: [occurrence],
      });
    }
  }

  return groups;
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

/**
 * Turns a candidate solution into sections the week grid can draw (ticket 46).
 *
 * The solver previews on the real grid rather than a thumbnail, and the grid
 * draws `PlanSection`s. A `SolutionSection` carries identity, pin state, and
 * blocks; the rest is filled from the plan's own row for that course when it
 * has one, so a previewed schedule is never anonymous.
 *
 * Modality is derived from the blocks and never read as a field (ADR-0007).
 */
export function solutionToPreviewSections(
  solution: Solution,
  planSections: PlanSection[]
): PlanSection[] {
  return solution.sections.map((s) => {
    const known = planSections.find((p) => p.courseId === s.courseId);
    return {
      courseId: s.courseId,
      courseCode: s.courseCode,
      courseTitle: known?.courseTitle ?? s.courseCode,
      sectionId: s.sectionId,
      sectionCode: s.sectionCode,
      pinned: s.pinned,
      missing: false,
      modality: deriveModality(s.blocks),
      blocks: s.blocks,
      latestSnapshot:
        known && known.sectionId === s.sectionId
          ? known.latestSnapshot
          : { capturedAt: "", enrolled: 0, professor: null, remark: null },
    };
  });
}

/** Per-block modality, folded into the section's own (ADR-0007). */
function deriveModality(blocks: { modality: "F2F" | "ONLINE" }[]): SectionModality {
  const hasF2F = blocks.some((b) => b.modality === "F2F");
  const hasOnline = blocks.some((b) => b.modality === "ONLINE");
  if (hasF2F && hasOnline) return "HYBRID";
  return hasOnline ? "ONLINE" : "F2F";
}

/** What the grid says while it is showing a candidate rather than the plan. */
export function formatSolutionPreviewLabel(rank: number): string {
  return `Previewing Schedule #${rank}`;
}

export interface MovedSection {
  courseId: number;
  courseCode: string;
  fromSectionId: number;
  fromSectionCode: string;
  toSectionId: number;
  toSectionCode: string;
}

export interface KeptSection {
  courseId: number;
  courseCode: string;
  sectionId: number;
  sectionCode: string;
  pinned: boolean;
}

export interface AddedSection {
  courseId: number;
  courseCode: string;
  sectionId: number;
  sectionCode: string;
}

export interface SolutionPlanDiff {
  kept: KeptSection[];
  pinned: KeptSection[];
  unpinnedKept: KeptSection[];
  moved: MovedSection[];
  added: AddedSection[];
  stayCount: number;
  moveCount: number;
  totalPlanSections: number;
}

/**
 * Computes how a candidate solution changes the current plan (ticket 43):
 * which sections stay (including pinned sections which are visibly exempt),
 * which sections move from their current choice to a different section of the same course,
 * and which sections are new additions for courses not yet in the plan.
 */
export function diffSolutionWithPlan(
  planSections: PlanSection[],
  solution: Solution
): SolutionPlanDiff {
  const kept: KeptSection[] = [];
  const pinned: KeptSection[] = [];
  const unpinnedKept: KeptSection[] = [];
  const moved: MovedSection[] = [];
  const added: AddedSection[] = [];

  for (const planSection of planSections) {
    const solSec = solution.sections.find((s) => s.courseId === planSection.courseId);
    if (solSec) {
      if (solSec.sectionId === planSection.sectionId) {
        const item: KeptSection = {
          courseId: planSection.courseId,
          courseCode: planSection.courseCode,
          sectionId: planSection.sectionId,
          sectionCode: planSection.sectionCode,
          pinned: planSection.pinned || solSec.pinned,
        };
        kept.push(item);
        if (item.pinned) {
          pinned.push(item);
        } else {
          unpinnedKept.push(item);
        }
      } else {
        moved.push({
          courseId: planSection.courseId,
          courseCode: planSection.courseCode,
          fromSectionId: planSection.sectionId,
          fromSectionCode: planSection.sectionCode,
          toSectionId: solSec.sectionId,
          toSectionCode: solSec.sectionCode,
        });
      }
    }
  }

  for (const solSec of solution.sections) {
    if (!planSections.some((ps) => ps.courseId === solSec.courseId)) {
      added.push({
        courseId: solSec.courseId,
        courseCode: solSec.courseCode,
        sectionId: solSec.sectionId,
        sectionCode: solSec.sectionCode,
      });
    }
  }

  return {
    kept,
    pinned,
    unpinnedKept,
    moved,
    added,
    stayCount: kept.length,
    moveCount: moved.length,
    totalPlanSections: planSections.length,
  };
}

/**
 * Formats a short summary of what a solution would change.
 * A solution that moves nothing says so explicitly for reassurance (ticket 43).
 */
export function formatDiffSummary(diff: SolutionPlanDiff): string {
  if (diff.totalPlanSections === 0) {
    const count = diff.added.length;
    return `Adds ${count} ${count === 1 ? "section" : "sections"} to schedule`;
  }

  if (diff.moveCount === 0) {
    return `Changes nothing — keeps all ${diff.totalPlanSections} sections`;
  }

  if (diff.stayCount === 0) {
    if (diff.moveCount === 1) {
      return "Moves 1 section";
    }
    return `Moves all ${diff.moveCount} sections`;
  }

  const moveText = `${diff.moveCount} ${diff.moveCount === 1 ? "section" : "sections"}`;
  return `Moves ${moveText}, keeps ${diff.stayCount}`;
}

/**
 * Plain sentence explaining the consequence of applying this solution (ticket 43).
 */
export function formatApplyConsequence(diff: SolutionPlanDiff): string {
  if (diff.totalPlanSections === 0) {
    const count = diff.added.length;
    return `Applying this will add ${count} ${count === 1 ? "section" : "sections"} to your plan.`;
  }

  if (diff.moveCount === 0) {
    const count = diff.totalPlanSections;
    return `Applying this keeps all ${count} of your chosen ${count === 1 ? "section" : "sections"} unchanged.`;
  }

  const movedDetail = diff.moved
    .map((m) => `${m.courseCode} ${m.fromSectionCode} → ${m.toSectionCode}`)
    .join(", ");

  if (diff.stayCount === 0) {
    const count = diff.moveCount;
    if (count === 1) {
      return `Applying this will move your 1 section (${movedDetail}).`;
    }
    return `Applying this will move all ${count} of your sections (${movedDetail}).`;
  }

  const count = diff.totalPlanSections;
  const moveText = `${diff.moveCount} of your ${count} ${count === 1 ? "section" : "sections"}`;
  return `Applying this will move ${moveText} (${movedDetail}) and keep ${diff.stayCount}.`;
}

