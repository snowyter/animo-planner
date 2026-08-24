/**
 * Core refresh utilities and domain logic.
 *
 * SPEC §4 (Refresh, session expiry recovery), §5 (missing sections)
 */

import type { PlanSection, RefreshOutcome, RefreshProgress } from "../adapters/ipc/types";

/**
 * Formats user-facing progress showing which course is being refreshed and how many remain.
 * E.g., "Refreshing CSINTSY (1 of 3, 2 remaining)"
 */
export function formatRefreshProgress(progress: RefreshProgress): string {
  const currentNum = progress.courseIndex + 1;
  const remaining = Math.max(0, progress.courseTotal - currentNum);
  return `Refreshing ${progress.courseCode} (${currentNum} of ${progress.courseTotal}, ${remaining} remaining)`;
}

export interface ExpiryMessage {
  title: string;
  description: string;
}

/**
 * Formats the session expired notice with the exact phrase required by SPEC §4
 * and details about the partial results retained.
 */
export function formatExpiryMessage(outcome: Pick<RefreshOutcome, "refreshedCourses" | "totalCourses" | "haltedAfterCourseCode">): ExpiryMessage {
  const title = "Session expired — sign in to continue";
  if (outcome.haltedAfterCourseCode) {
    return {
      title,
      description: `Refreshed ${outcome.refreshedCourses} of ${outcome.totalCourses} courses (halted after ${outcome.haltedAfterCourseCode}). Sign in to Archer's Hub and click Resume to continue.`,
    };
  }
  return {
    title,
    description: "Sign in to Archer's Hub and click Resume to start the refresh.",
  };
}

/**
 * Plain message when offline / no network is available.
 */
export function formatOfflineMessage(): string {
  return "No network connection. Refresh could not reach Archer's Hub and your plan was not changed.";
}

/**
 * Formats completion outcome summary.
 */
export function formatCompleteMessage(refreshedCourses: number, totalCourses: number): string {
  return `Refreshed ${refreshedCourses} of ${totalCourses} courses successfully.`;
}

/**
 * Filters the plan's sections to find those marked as missing from the catalog.
 */
export function getMissingSections(sections: PlanSection[]): PlanSection[] {
  return sections.filter((section) => section.missing);
}
