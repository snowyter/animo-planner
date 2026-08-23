/**
 * Pure domain logic and formatting utilities for courses and sections.
 * Free of I/O and framework imports.
 */

import type { Conflict, PlanSection, Section, SectionRef } from "../adapters/ipc/types";
import { findConflicts } from "./conflicts";

/**
 * Format teacher display name.
 *
 * Blank teacher displays as "Unknown", never as absent or as a dash that reads like a value.
 * (SPEC §5, §7, CONTEXT.md)
 */
export function formatTeacher(teacher: string | null | undefined): string {
  if (!teacher) {
    return "Unknown";
  }
  const trimmed = teacher.trim();
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

  const candidateAsPlanSection: PlanSection = {
    courseId: candidate.courseId,
    courseCode: candidate.courseCode,
    courseTitle: candidate.courseTitle,
    sectionId: candidate.sectionId,
    sectionCode: candidate.sectionCode,
    pinned: "pinned" in candidate ? candidate.pinned : false,
    missing: "missing" in candidate ? candidate.missing : false,
    modality: candidate.modality,
    blocks: candidate.blocks,
    latestSnapshot: candidate.latestSnapshot,
  };

  const combined = [...otherSections, candidateAsPlanSection];
  const allConflicts = findConflicts(combined);

  // Return only conflicts involving the candidate
  return allConflicts.filter(
    (c) =>
      (c.a.courseId === candidate.courseId && c.a.sectionId === candidate.sectionId) ||
      (c.b.courseId === candidate.courseId && c.b.sectionId === candidate.sectionId)
  );
}
