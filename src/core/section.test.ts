import { describe, expect, it } from "vitest";
import {
  formatTeacher,
  formatEnrolledCap,
  isSectionInPlan,
  isSectionPinned,
  findCandidateConflicts,
  groupSectionsForPicker,
} from "./section";
import type { PlanSection, ScheduleBlock, Section } from "../adapters/ipc/types";

describe("section core logic", () => {
  const makeBlock = (
    day: ScheduleBlock["day"],
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
    courseCode: string,
    sectionCode: string,
    blocks: ScheduleBlock[],
    teacher: string | null = null,
    enrolled = 35,
    enrollCap = 45,
    remark: string | null = null
  ): Section => ({
    campusId: 7,
    sessionId: 155,
    courseId,
    courseCode,
    courseTitle: `${courseCode} Title`,
    sectionId,
    sectionCode,
    courseType: "Lecture",
    credits: 3,
    enrollCap,
    startDate: "2026-07-10",
    endDate: "2026-12-09",
    firstSeenAt: "2026-08-22T00:00:00Z",
    lastSeenAt: "2026-08-22T00:00:00Z",
    modality: blocks.some((b) => b.modality === "ONLINE")
      ? blocks.some((b) => b.modality === "F2F")
        ? "HYBRID"
        : "ONLINE"
      : "F2F",
    blocks,
    latestSnapshot: {
      capturedAt: "2026-08-22T00:00:00Z",
      enrolled,
      teacher,
      remark,
    },
  });

  const makePlanSection = (
    courseId: number,
    sectionId: number,
    courseCode: string,
    sectionCode: string,
    blocks: ScheduleBlock[],
    pinned = false
  ): PlanSection => ({
    courseId,
    courseCode,
    courseTitle: `${courseCode} Title`,
    sectionId,
    sectionCode,
    pinned,
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
      teacher: "Prof X",
      remark: null,
    },
  });

  describe("formatTeacher", () => {
    it("returns 'Unknown' when teacher is null", () => {
      expect(formatTeacher(null)).toBe("Unknown");
    });

    it("returns 'Unknown' when teacher is undefined", () => {
      expect(formatTeacher(undefined)).toBe("Unknown");
    });

    it("returns 'Unknown' when teacher is empty string or only whitespace", () => {
      expect(formatTeacher("")).toBe("Unknown");
      expect(formatTeacher("   ")).toBe("Unknown");
    });

    it("returns trimmed teacher name when teacher is populated", () => {
      expect(formatTeacher("DELA CRUZ, JUAN")).toBe("DELA CRUZ, JUAN");
      expect(formatTeacher("  SANTOS, MARIA  ")).toBe("SANTOS, MARIA");
    });
  });

  describe("formatEnrolledCap", () => {
    it("formats enrolled over capacity correctly", () => {
      expect(formatEnrolledCap(42, 45)).toBe("42/45");
      expect(formatEnrolledCap(0, 40)).toBe("0/40");
      expect(formatEnrolledCap(45, 45)).toBe("45/45");
    });
  });

  describe("isSectionInPlan and isSectionPinned", () => {
    const planSections: PlanSection[] = [
      makePlanSection(2923, 384, "GEARTAP", "S11", [makeBlock("MON", 450, 540)], true),
      makePlanSection(564, 737, "CSINTSY", "Z01", [makeBlock("WED", 450, 540)], false),
    ];

    it("identifies if a section is in the plan", () => {
      expect(isSectionInPlan({ courseId: 2923, sectionId: 384 }, planSections)).toBe(true);
      expect(isSectionInPlan({ courseId: 564, sectionId: 737 }, planSections)).toBe(true);
      expect(isSectionInPlan({ courseId: 2923, sectionId: 999 }, planSections)).toBe(false);
      expect(isSectionInPlan({ courseId: 999, sectionId: 384 }, planSections)).toBe(false);
    });

    it("identifies if a section is pinned in the plan", () => {
      expect(isSectionPinned({ courseId: 2923, sectionId: 384 }, planSections)).toBe(true);
      expect(isSectionPinned({ courseId: 564, sectionId: 737 }, planSections)).toBe(false);
      expect(isSectionPinned({ courseId: 999, sectionId: 999 }, planSections)).toBe(false);
    });
  });

  describe("findCandidateConflicts", () => {
    const planSections: PlanSection[] = [
      makePlanSection(2923, 384, "GEARTAP", "S11", [makeBlock("MON", 450, 540)]),
    ];

    it("returns empty array when candidate has no time conflicts with plan", () => {
      const nonConflicting = makeSection(564, 737, "CSINTSY", "Z01", [
        makeBlock("WED", 450, 540),
      ]);
      expect(findCandidateConflicts(nonConflicting, planSections)).toEqual([]);
    });

    it("returns conflict details when candidate overlaps with a plan section", () => {
      const conflicting = makeSection(564, 737, "CSINTSY", "Z01", [
        makeBlock("MON", 480, 570), // Overlaps 480-540 on MON
      ]);
      const conflicts = findCandidateConflicts(conflicting, planSections);
      expect(conflicts.length).toBe(1);
      expect(conflicts[0].day).toBe("MON");
      expect(conflicts[0].startMin).toBe(480);
      expect(conflicts[0].endMin).toBe(540);
    });

    it("does not conflict with itself if candidate is already in the plan", () => {
      const sameSection = makeSection(2923, 384, "GEARTAP", "S11", [
        makeBlock("MON", 450, 540),
      ]);
      const conflicts = findCandidateConflicts(sameSection, planSections);
      expect(conflicts).toEqual([]);
    });
  });

  describe("groupSectionsForPicker", () => {
    const sec1 = makeSection(2923, 101, "GEARTAP", "S01", [makeBlock("MON", 450, 540)]);
    const sec2 = makeSection(2923, 102, "GEARTAP", "S02", [makeBlock("MON", 550, 640)]);
    const sec3 = makeSection(2923, 103, "GEARTAP", "S03", [makeBlock("TUE", 450, 540)]);
    const sec4 = makeSection(2923, 104, "GEARTAP", "S04", [makeBlock("TUE", 550, 640)]);
    const catalogSections = [sec1, sec2, sec3, sec4];

    it("returns empty inPlan and all catalog sections in other when no sections are in plan", () => {
      const result = groupSectionsForPicker(catalogSections, []);
      expect(result.inPlan).toEqual([]);
      expect(result.other).toEqual(catalogSections);
    });

    it("places sections in plan first, with pinned sections ahead of unpinned within inPlan", () => {
      // Plan has sec3 (pinned) and sec1 (unpinned)
      const planSections = [
        makePlanSection(2923, 101, "GEARTAP", "S01", [makeBlock("MON", 450, 540)], false),
        makePlanSection(2923, 103, "GEARTAP", "S03", [makeBlock("TUE", 450, 540)], true),
      ];

      const result = groupSectionsForPicker(catalogSections, planSections);

      // inPlan must have sec3 first (pinned), then sec1 (unpinned)
      expect(result.inPlan.map((s) => s.sectionCode)).toEqual(["S03", "S01"]);
      // other must preserve catalog order for remaining sections: sec2, sec4
      expect(result.other.map((s) => s.sectionCode)).toEqual(["S02", "S04"]);
    });

    it("preserves relative catalog order among multiple pinned sections and among multiple unpinned sections in plan", () => {
      // Plan has sec1 (pinned), sec4 (pinned), sec2 (unpinned), sec3 (unpinned)
      const planSections = [
        makePlanSection(2923, 104, "GEARTAP", "S04", [makeBlock("TUE", 550, 640)], true),
        makePlanSection(2923, 101, "GEARTAP", "S01", [makeBlock("MON", 450, 540)], true),
        makePlanSection(2923, 103, "GEARTAP", "S03", [makeBlock("TUE", 450, 540)], false),
        makePlanSection(2923, 102, "GEARTAP", "S02", [makeBlock("MON", 550, 640)], false),
      ];

      const result = groupSectionsForPicker(catalogSections, planSections);

      // Pinned group (sec1, sec4) should follow catalog order (sec1 then sec4)
      // Unpinned in-plan group (sec2, sec3) should follow catalog order (sec2 then sec3)
      expect(result.inPlan.map((s) => s.sectionCode)).toEqual(["S01", "S04", "S02", "S03"]);
      expect(result.other).toEqual([]);
    });
  });
});
