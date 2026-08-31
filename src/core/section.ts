/**
 * Pure domain logic and formatting utilities for courses and sections.
 * Free of I/O and framework imports.
 */

import type { Conflict, PlanSection, Section, SectionRef } from "../adapters/ipc/types";
import { findConflicts } from "./conflicts";

/**
 * Format professor display name.
 *
 * Blank professor displays as "Unknown", never as absent or as a dash that reads like a value.
 * (SPEC §5, §7, CONTEXT.md)
 */
export function formatProfessor(professor: string | null | undefined): string {
  if (!professor) {
    return "Unknown";
  }
  const trimmed = professor.trim();
  return trimmed.length > 0 ? trimmed : "Unknown";
}

/**
 * Format enrolled count over capacity as a string (e.g. "38/45").
 */
export function formatEnrolledCap(enrolled: number, cap: number): string {
  return `${enrolled}/${cap}`;
}

/**
 * Check if a section is in the plan.
 */
export function isSectionInPlan(
  ref: SectionRef,
  planSections: readonly PlanSection[]
): boolean {
  return planSections.some(
    (s) => s.courseId === ref.courseId && s.sectionId === ref.sectionId
  );
}

/**
 * Check if a section in the plan is pinned.
 */
export function isSectionPinned(
  ref: SectionRef,
  planSections: readonly PlanSection[]
): boolean {
  return planSections.some(
    (s) => s.courseId === ref.courseId && s.sectionId === ref.sectionId && s.pinned
  );
}

/**
 * A section in the shape the plan and the conflict logic read.
 *
 * A catalog `Section` and a `PlanSection` differ in exactly two fields, and
 * both of them describe a section's relationship to a plan rather than the
 * section itself: a section that is not in the plan is neither pinned nor
 * missing from it. Everything that has to reason about "a section, wherever
 * it came from" — conflict checks, the grid's one preview path (ticket 46) —
 * goes through here rather than restating that mapping.
 */
export function toPlanSection(section: Section | PlanSection): PlanSection {
  return {
    courseId: section.courseId,
    courseCode: section.courseCode,
    courseTitle: section.courseTitle,
    sectionId: section.sectionId,
    sectionCode: section.sectionCode,
    pinned: "pinned" in section ? section.pinned : false,
    missing: "missing" in section ? section.missing : false,
    modality: section.modality,
    blocks: section.blocks,
    latestSnapshot: section.latestSnapshot,
  };
}

/**
 * Check for time conflicts between a candidate section and existing plan sections.
 * Returns any conflicts found.
 */
export function findCandidateConflicts(
  candidate: Section | PlanSection,
  planSections: readonly PlanSection[]
): Conflict[] {
  // Candidate section does not conflict with itself if already in the plan
  const otherSections = planSections.filter(
    (s) => !(s.courseId === candidate.courseId && s.sectionId === candidate.sectionId)
  );

  const candidateAsPlanSection = toPlanSection(candidate);

  const combined = [...otherSections, candidateAsPlanSection];
  const allConflicts = findConflicts(combined);

  // Return only conflicts involving the candidate
  return allConflicts.filter(
    (c) =>
      (c.a.courseId === candidate.courseId && c.a.sectionId === candidate.sectionId) ||
      (c.b.courseId === candidate.courseId && c.b.sectionId === candidate.sectionId)
  );
}

/**
 * What a candidate section collides with, named.
 *
 * The picker used to report a quantity — "Conflict (2 days)" — which tells the
 * student how bad it is but nothing about what to do. The actionable fact is
 * *which* section is in the way, because that is the thing they would swap,
 * unpin, or accept.
 *
 * When the collision is another section of the same course, the course code is
 * already the one the picker is showing, so only the section code is said.
 *
 * Conflicts are still displayed and never prevented (ADR-0009); this only
 * changes the wording of the display.
 */
export function formatCandidateConflictLabel(
  candidate: Pick<Section | PlanSection, "courseId" | "sectionId">,
  conflicts: readonly Conflict[],
  planSections: readonly PlanSection[]
): string | null {
  if (conflicts.length === 0) {
    return null;
  }

  // One section can collide on several days. The student swaps the section,
  // not the day, so each one is named once, in the order first met.
  const seen = new Set<string>();
  const others: { courseId: number; sectionId: number }[] = [];
  for (const conflict of conflicts) {
    const other =
      conflict.a.courseId === candidate.courseId &&
      conflict.a.sectionId === candidate.sectionId
        ? conflict.b
        : conflict.a;
    const key = `${other.courseId}-${other.sectionId}`;
    if (!seen.has(key)) {
      seen.add(key);
      others.push(other);
    }
  }

  const [first] = others;
  if (!first) return null;
  const match = planSections.find(
    (s) => s.courseId === first.courseId && s.sectionId === first.sectionId
  );

  // A conflict whose other side is not in the plan handed in is a bug
  // upstream, not a reason to render a sentence with a hole in it.
  const name = !match
    ? "another section"
    : match.courseId === candidate.courseId
    ? match.sectionCode
    : `${match.courseCode} ${match.sectionCode}`;

  const remaining = others.length - 1;
  if (remaining === 0) {
    return `Conflicts with ${name}`;
  }
  return `Conflicts with ${name} and ${remaining} more`;
}

export interface GroupedPickerSections {
  inPlan: Section[];
  other: Section[];
}

/**
 * Groups sections for the picker (Ticket 36):
 * 1. Sections already in the plan come first in `inPlan`.
 *    - Within `inPlan`, pinned sections come first.
 *    - Relative catalog order is preserved within pinned sections and within unpinned sections.
 * 2. Remaining sections come in `other`, preserving their catalog order.
 */
export function groupSectionsForPicker(
  sections: readonly Section[],
  planSections: readonly PlanSection[]
): GroupedPickerSections {
  const pinnedInPlan: Section[] = [];
  const unpinnedInPlan: Section[] = [];
  const other: Section[] = [];

  for (const section of sections) {
    const ref = { courseId: section.courseId, sectionId: section.sectionId };
    if (isSectionInPlan(ref, planSections)) {
      if (isSectionPinned(ref, planSections)) {
        pinnedInPlan.push(section);
      } else {
        unpinnedInPlan.push(section);
      }
    } else {
      other.push(section);
    }
  }

  return {
    inPlan: [...pinnedInPlan, ...unpinnedInPlan],
    other,
  };
}

