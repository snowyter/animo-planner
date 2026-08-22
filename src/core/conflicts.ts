/**
 * Core conflict detection over a plan's schedule blocks.
 *
 * A conflict is two schedule blocks belonging to different sections that
 * overlap in time on the same day. Conflict is a query over a plan, never a
 * constraint on membership (ADR-0009): adding an overlapping section always
 * succeeds, and this module reports the overlap.
 *
 * Modality is derived per-block (ADR-0007); conflict is checked per block,
 * and a section can never conflict with itself.
 */

import type { Conflict, ScheduleBlock, SectionRef } from "../adapters/ipc/types";

export interface PlannableSection {
  courseId: number;
  sectionId: number;
  blocks: ScheduleBlock[];
}

/**
 * Returns every overlapping block pair across the given plan sections.
 */
export function findConflicts(sections: PlannableSection[]): Conflict[] {
  const conflicts: Conflict[] = [];

  for (let i = 0; i < sections.length; i++) {
    const first = sections[i];
    for (let j = i + 1; j < sections.length; j++) {
      const second = sections[j];

      // A section cannot conflict with itself; if IDs match, skip
      if (
        first.courseId === second.courseId &&
        first.sectionId === second.sectionId
      ) {
        continue;
      }

      for (const blockA of first.blocks) {
        for (const blockB of second.blocks) {
          if (blockA.day !== blockB.day) {
            continue;
          }

          const startMin = Math.max(blockA.startMin, blockB.startMin);
          const endMin = Math.min(blockA.endMin, blockB.endMin);

          if (startMin >= endMin) {
            continue;
          }

          conflicts.push({
            a: {
              courseId: first.courseId,
              sectionId: first.sectionId,
            },
            b: {
              courseId: second.courseId,
              sectionId: second.sectionId,
            },
            day: blockA.day,
            startMin,
            endMin,
          });
        }
      }
    }
  }

  return conflicts;
}

/**
 * Checks if a specific schedule block belongs to an identified conflict.
 */
export function isBlockConflicting(
  block: ScheduleBlock,
  sectionRef: SectionRef,
  conflicts: Conflict[]
): boolean {
  return conflicts.some((c) => {
    if (c.day !== block.day) {
      return false;
    }

    const matchesSection =
      (c.a.courseId === sectionRef.courseId && c.a.sectionId === sectionRef.sectionId) ||
      (c.b.courseId === sectionRef.courseId && c.b.sectionId === sectionRef.sectionId);

    if (!matchesSection) {
      return false;
    }

    // Check if the block's time range intersects with the conflict range
    return block.startMin < c.endMin && block.endMin > c.startMin;
  });
}
