/**
 * Pure domain logic for week grid context menu and block details.
 * Free of I/O and framework imports (SPEC §7, ADR-0008, ADR-0009, ADR-0012, CONTEXT.md).
 */

import type { Conflict, Day, PlanSection, ScheduleBlock, Section } from "../adapters/ipc/types";
import { formatTeacher } from "./section";
import { formatMinutesToTime12 } from "./grid";

/**
 * Formats full section details as clean plain text for pasting into group chat.
 */
export function formatSectionCopyText(section: PlanSection | Section): string {
  const teacher = formatTeacher(section.latestSnapshot?.teacher);
  const enrolled = section.latestSnapshot?.enrolled;
  const enrollCap = "enrollCap" in section ? (section.enrollCap as number | undefined) : undefined;
  const remark = section.latestSnapshot?.remark;

  const lines: string[] = [
    `${section.courseCode} ${section.sectionCode} — ${section.courseTitle}`,
    `Teacher: ${teacher}`,
    "Schedule:",
  ];

  for (const block of section.blocks) {
    const timeRange = `${formatMinutesToTime12(block.startMin)} – ${formatMinutesToTime12(block.endMin)}`;
    const where = block.modality === "F2F" ? `${block.location ?? "Room"}, F2F` : "Online";
    lines.push(`• ${block.day} ${timeRange} (${where})`);
  }

  if (typeof enrolled === "number") {
    if (typeof enrollCap === "number") {
      lines.push(`Enrolled: ${enrolled}/${enrollCap}`);
    } else {
      lines.push(`Enrolled: ${enrolled}`);
    }
  }

  if (remark && remark.trim().length > 0) {
    lines.push(`Remark: ${remark.trim()}`);
  }

  return lines.join("\n");
}

/**
 * Formats a snapshot capture timestamp as human-readable relative age.
 */
export function formatCaptureAge(
  capturedAt: string | null | undefined,
  now: Date = new Date()
): string {
  if (!capturedAt) return "Unknown";
  const date = new Date(capturedAt);
  if (isNaN(date.getTime())) return "Unknown";

  const diffMs = now.getTime() - date.getTime();
  if (diffMs < 0) return "just now";

  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return "just now";

  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) {
    return `${diffMin} ${diffMin === 1 ? "minute" : "minutes"} ago`;
  }

  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) {
    return `${diffHours} ${diffHours === 1 ? "hour" : "hours"} ago`;
  }

  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays} ${diffDays === 1 ? "day" : "days"} ago`;
}

export interface BlockConflictDescription {
  otherCourseCode: string;
  otherSectionCode: string;
  day: Day;
  startMin: number;
  endMin: number;
  message: string;
}

/**
 * Describes a conflict affecting a specific schedule block in the plan.
 * Returns null if the block does not have any conflicts.
 */
export function describeBlockConflict(
  section: PlanSection,
  block: ScheduleBlock,
  conflicts: readonly Conflict[],
  allSections: readonly PlanSection[]
): BlockConflictDescription | null {
  const match = conflicts.find((c) => {
    if (c.day !== block.day) return false;
    // Check if time windows overlap
    const overlaps = block.startMin < c.endMin && block.endMin > c.startMin;
    if (!overlaps) return false;

    const isA = c.a.courseId === section.courseId && c.a.sectionId === section.sectionId;
    const isB = c.b.courseId === section.courseId && c.b.sectionId === section.sectionId;
    return isA || isB;
  });

  if (!match) return null;

  const isA = match.a.courseId === section.courseId && match.a.sectionId === section.sectionId;
  const otherRef = isA ? match.b : match.a;

  const otherSection = allSections.find(
    (s) => s.courseId === otherRef.courseId && s.sectionId === otherRef.sectionId
  );

  const otherCourseCode = otherSection?.courseCode ?? `Course ${otherRef.courseId}`;
  const otherSectionCode = otherSection?.sectionCode ?? `Section ${otherRef.sectionId}`;

  const timeRange = `${formatMinutesToTime12(match.startMin)} – ${formatMinutesToTime12(match.endMin)}`;
  const message = `Overlaps with ${otherCourseCode} ${otherSectionCode} on ${match.day} from ${timeRange}.`;

  return {
    otherCourseCode,
    otherSectionCode,
    day: match.day,
    startMin: match.startMin,
    endMin: match.endMin,
    message,
  };
}

export interface MissingSectionDescription {
  lastSeen: string;
  message: string;
}

/**
 * Explains why a section is marked as missing and describes the ADR-0008 invariant.
 */
export function describeMissingSection(
  section: PlanSection,
  now: Date = new Date()
): MissingSectionDescription {
  const lastSeen = formatCaptureAge(section.latestSnapshot?.capturedAt, now);
  const message =
    "This section stopped appearing in Archer's Hub search results during a recent refresh. In Animo Plan, sections are never automatically deleted (ADR-0008). You can keep this section in your plan, check for alternative sections in the picker, or remove it from your schedule.";

  return {
    lastSeen,
    message,
  };
}

export interface MenuPlacement {
  alignX: "left" | "right";
  alignY: "top" | "bottom";
  className: string;
}

/**
 * Calculates context menu placement based on column day and start time
 * to prevent clipping off right edge (Sat) or bottom edge (evening).
 */
export function getMenuPlacement(day: Day, startMin: number): MenuPlacement {
  const isRightEdge = day === "FRI" || day === "SAT";
  const isBottomEdge = startMin >= 960; // 4:00 PM or later (lattice slots: 16:15, 18:00)

  const alignX = isRightEdge ? "right" : "left";
  const alignY = isBottomEdge ? "bottom" : "top";

  const xClass = isRightEdge ? "right-0 origin-top-right" : "left-0 origin-top-left";
  const yClass = isBottomEdge ? "bottom-full mb-1" : "top-full mt-1";

  return {
    alignX,
    alignY,
    className: `${xClass} ${yClass}`,
  };
}
