import { describe, expect, it } from "vitest";
import type { Day, PlanSection, ScheduleBlock } from "../adapters/ipc/types";
import { findConflicts, isBlockConflicting } from "./conflicts";

describe("findConflicts", () => {
  const makeBlock = (
    day: Day,
    startMin: number,
    endMin: number,
    modality: "F2F" | "ONLINE" = "F2F",
    location: string | null = modality === "F2F" ? "L226" : null
  ): ScheduleBlock => {
    if (modality === "F2F") {
      return {
        day,
        startMin,
        endMin,
        modality: "F2F",
        location: location ?? "L226",
      };
    }
    return {
      day,
      startMin,
      endMin,
      modality: "ONLINE",
      location: null,
    };
  };

  const makeSection = (
    courseId: number,
    sectionId: number,
    blocks: ScheduleBlock[],
    courseCode = `COURSE${courseId}`,
    sectionCode = `SEC${sectionId}`
  ): PlanSection => ({
    courseId,
    courseCode,
    courseTitle: "Course Title",
    sectionId,
    sectionCode,
    pinned: false,
    missing: false,
    modality: blocks.some((b) => b.modality === "ONLINE")
      ? blocks.some((b) => b.modality === "F2F")
        ? "HYBRID"
        : "ONLINE"
      : "F2F",
    blocks,
    latestSnapshot: {
      capturedAt: "2026-08-22T00:00:00Z",
      enrolled: 40,
      teacher: null,
      remark: null,
    },
  });

  it("returns an empty array when plan has no sections", () => {
    expect(findConflicts([])).toEqual([]);
  });

  it("returns no conflicts when sections do not overlap in time or day", () => {
    const sections = [
      makeSection(2923, 384, [
        makeBlock("MON", 450, 540),
        makeBlock("THU", 450, 540),
      ]),
      makeSection(564, 737, [
        makeBlock("TUE", 450, 540),
        makeBlock("FRI", 450, 540),
      ]),
      makeSection(564, 738, [makeBlock("MON", 600, 690)]),
    ];
    expect(findConflicts(sections)).toEqual([]);
  });

  it("reports overlapping pair on the exact day and intersection range", () => {
    const sections = [
      makeSection(2923, 384, [
        makeBlock("MON", 450, 540),
        makeBlock("THU", 450, 540),
      ]),
      makeSection(564, 737, [
        makeBlock("MON", 480, 570),
        makeBlock("FRI", 480, 570),
      ]),
    ];

    const conflicts = findConflicts(sections);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toEqual({
      a: { courseId: 2923, sectionId: 384 },
      b: { courseId: 564, sectionId: 737 },
      day: "MON",
      startMin: 480,
      endMin: 540,
    });
  });

  it("does not report conflict for touching blocks with 0 overlap (back-to-back)", () => {
    const sections = [
      makeSection(2923, 384, [makeBlock("MON", 450, 540)]),
      makeSection(564, 737, [makeBlock("MON", 540, 630)]),
    ];
    expect(findConflicts(sections)).toEqual([]);
  });

  it("never reports a section conflicting with itself", () => {
    const sections = [
      makeSection(2923, 384, [
        makeBlock("MON", 450, 540),
        makeBlock("MON", 480, 570),
      ]),
    ];
    expect(findConflicts(sections)).toEqual([]);
  });

  it("reports conflict for hybrid section only on the day that overlaps", () => {
    const sections = [
      makeSection(2923, 384, [
        makeBlock("TUE", 450, 540, "F2F"),
        makeBlock("FRI", 450, 540, "ONLINE"),
      ]),
      makeSection(564, 737, [
        makeBlock("FRI", 480, 570, "F2F"),
        makeBlock("SAT", 450, 540, "F2F"),
      ]),
    ];

    const conflicts = findConflicts(sections);
    expect(conflicts).toEqual([
      {
        a: { courseId: 2923, sectionId: 384 },
        b: { courseId: 564, sectionId: 737 },
        day: "FRI",
        startMin: 480,
        endMin: 540,
      },
    ]);
  });

  it("correctly identifies whether a given block is in conflict", () => {
    const blockA = makeBlock("MON", 450, 540);
    const blockB = makeBlock("THU", 450, 540);
    const conflicts = [
      {
        a: { courseId: 2923, sectionId: 384 },
        b: { courseId: 564, sectionId: 737 },
        day: "MON" as Day,
        startMin: 480,
        endMin: 540,
      },
    ];

    expect(
      isBlockConflicting(blockA, { courseId: 2923, sectionId: 384 }, conflicts)
    ).toBe(true);

    expect(
      isBlockConflicting(blockB, { courseId: 2923, sectionId: 384 }, conflicts)
    ).toBe(false);

    expect(
      isBlockConflicting(blockA, { courseId: 999, sectionId: 999 }, conflicts)
    ).toBe(false);
  });
});
