import { describe, expect, it } from "vitest";
import {
  formatProfessor,
  formatEnrolledCap,
  isSectionInPlan,
  isSectionPinned,
  findCandidateConflicts,
  formatCandidateConflictLabel,
  groupSectionsForPicker,
  toPlanSection,
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
    professor: string | null = null,
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
      professor,
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
      professor: "Prof X",
      remark: null,
    },
  });

  describe("formatProfessor", () => {
    it("returns 'Unknown' when professor is null", () => {
      expect(formatProfessor(null)).toBe("Unknown");
    });

    it("returns 'Unknown' when professor is undefined", () => {
      expect(formatProfessor(undefined)).toBe("Unknown");
    });

    it("returns 'Unknown' when professor is empty string or only whitespace", () => {
      expect(formatProfessor("")).toBe("Unknown");
      expect(formatProfessor("   ")).toBe("Unknown");
    });

    it("returns trimmed professor name when professor is populated", () => {
      expect(formatProfessor("DELA CRUZ, JUAN")).toBe("DELA CRUZ, JUAN");
      expect(formatProfessor("  SANTOS, MARIA  ")).toBe("SANTOS, MARIA");
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
      const [conflict] = conflicts;
      if (!conflict) throw new Error("one conflict is expected");
      expect(conflict.day).toBe("MON");
      expect(conflict.startMin).toBe(480);
      expect(conflict.endMin).toBe(540);
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

describe("formatCandidateConflictLabel", () => {
  const makeBlock = (
    day: ScheduleBlock["day"],
    startMin: number,
    endMin: number
  ): ScheduleBlock => ({ day, startMin, endMin, modality: "ONLINE", location: null });

  const makePlanSection = (
    courseId: number,
    sectionId: number,
    courseCode: string,
    sectionCode: string,
    blocks: ScheduleBlock[]
  ): PlanSection => ({
    courseId,
    courseCode,
    courseTitle: `${courseCode} Title`,
    sectionId,
    sectionCode,
    pinned: false,
    missing: false,
    modality: "ONLINE",
    blocks,
    latestSnapshot: {
      capturedAt: "2026-08-22T00:00:00Z",
      enrolled: 40,
      professor: null,
      remark: null,
    },
  });

  const mon = makeBlock("MON", 555, 645);
  const thu = makeBlock("THU", 555, 645);
  const tue = makeBlock("TUE", 555, 645);

  const label = (candidate: PlanSection, plan: PlanSection[]) =>
    formatCandidateConflictLabel(candidate, findCandidateConflicts(candidate, plan), plan);

  it("is null when nothing conflicts", () => {
    const candidate = makePlanSection(1, 10, "GESTSOC", "E06", [mon]);
    const plan = [makePlanSection(2, 20, "CSOPESY", "S03", [tue])];
    expect(label(candidate, plan)).toBeNull();
  });

  it("names the course and section it collides with", () => {
    // "Conflict (2 days)" reported a quantity the student cannot act on.
    // What they need is the name of the thing to swap.
    const candidate = makePlanSection(1, 10, "GESTSOC", "E06", [mon]);
    const plan = [makePlanSection(2, 20, "CSOPESY", "S03", [mon])];
    expect(label(candidate, plan)).toBe("Conflicts with CSOPESY S03");
  });

  it("names only the section when the collision is another section of the same course", () => {
    // The course code is already the one the picker is showing, so repeating
    // it says nothing. The section code is the whole distinction.
    const candidate = makePlanSection(1, 10, "GESTSOC", "E06", [mon]);
    const plan = [makePlanSection(1, 11, "GESTSOC", "Z16", [mon])];
    expect(label(candidate, plan)).toBe("Conflicts with Z16");
  });

  it("counts one section once even when it collides on several days", () => {
    const candidate = makePlanSection(1, 10, "GESTSOC", "E06", [mon, thu]);
    const plan = [makePlanSection(1, 11, "GESTSOC", "Z16", [mon, thu])];
    expect(label(candidate, plan)).toBe("Conflicts with Z16");
  });

  it("names the first and counts the rest when several sections collide", () => {
    const candidate = makePlanSection(1, 10, "GESTSOC", "E06", [mon, thu, tue]);
    const plan = [
      makePlanSection(2, 20, "CSOPESY", "S03", [mon]),
      makePlanSection(3, 30, "NSCOM", "S40A", [thu]),
      makePlanSection(4, 40, "GEWORLD", "Y04", [tue]),
    ];
    expect(label(candidate, plan)).toBe("Conflicts with CSOPESY S03 and 2 more");
  });

  it("says 1 more, not 1 mores, for a single extra", () => {
    const candidate = makePlanSection(1, 10, "GESTSOC", "E06", [mon, thu]);
    const plan = [
      makePlanSection(2, 20, "CSOPESY", "S03", [mon]),
      makePlanSection(3, 30, "NSCOM", "S40A", [thu]),
    ];
    expect(label(candidate, plan)).toBe("Conflicts with CSOPESY S03 and 1 more");
  });

  it("degrades to a plain statement rather than naming nothing", () => {
    // A conflict whose other side is not in the list handed in is a bug, not
    // a reason to render "Conflicts with  ".
    const candidate = makePlanSection(1, 10, "GESTSOC", "E06", [mon]);
    const orphan = [
      {
        a: { courseId: 1, sectionId: 10 },
        b: { courseId: 99, sectionId: 99 },
        day: "MON" as const,
        startMin: 555,
        endMin: 645,
      },
    ];
    expect(formatCandidateConflictLabel(candidate, orphan, [])).toBe(
      "Conflicts with another section"
    );
  });
});

/**
 * Ticket 46 — the week grid previews one hovered candidate or a whole solved
 * schedule through one code path, and that path needs both kinds of section
 * in the shape the conflict logic reads.
 */
describe("toPlanSection", () => {
  const block: ScheduleBlock = {
    day: "MON",
    startMin: 450,
    endMin: 540,
    modality: "F2F",
    location: "L226",
  };

  const captured: Section = {
    campusId: 7,
    sessionId: 155,
    courseId: 2923,
    courseCode: "GEARTAP",
    courseTitle: "Art Appreciation",
    sectionId: 384,
    sectionCode: "S11",
    courseType: "Lecture",
    credits: 3,
    enrollCap: 45,
    startDate: "2026-07-10",
    endDate: "2026-12-09",
    firstSeenAt: "2026-08-22T00:00:00Z",
    lastSeenAt: "2026-08-22T00:00:00Z",
    modality: "F2F",
    blocks: [block],
    latestSnapshot: {
      capturedAt: "2026-08-22T00:00:00Z",
      enrolled: 35,
      professor: null,
      remark: null,
    },
  };

  it("keeps a captured section's identity and blocks", () => {
    const converted = toPlanSection(captured);

    expect(converted.courseId).toBe(2923);
    expect(converted.sectionId).toBe(384);
    expect(converted.courseCode).toBe("GEARTAP");
    expect(converted.blocks).toEqual([block]);
  });

  it("reads a catalog section as neither pinned nor missing, because it is neither", () => {
    const converted = toPlanSection(captured);

    expect(converted.pinned).toBe(false);
    expect(converted.missing).toBe(false);
  });

  it("leaves a section already in the plan exactly as it was", () => {
    const inPlan: PlanSection = {
      courseId: 2923,
      courseCode: "GEARTAP",
      courseTitle: "Art Appreciation",
      sectionId: 384,
      sectionCode: "S11",
      pinned: true,
      missing: true,
      modality: "F2F",
      blocks: [block],
      latestSnapshot: captured.latestSnapshot,
    };

    expect(toPlanSection(inPlan)).toEqual(inPlan);
  });
});
