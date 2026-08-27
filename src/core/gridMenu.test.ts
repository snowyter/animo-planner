import { describe, expect, it } from "vitest";
import {
  formatSectionCopyText,
  formatCaptureAge,
  describeBlockConflict,
  describeMissingSection,
  getMenuPlacement,
  computeMenuPosition,
} from "./gridMenu";
import type { Conflict, PlanSection, ScheduleBlock } from "../adapters/ipc/types";

describe("gridMenu core domain logic", () => {
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
    options?: {
      courseTitle?: string;
      pinned?: boolean;
      missing?: boolean;
      professor?: string | null;
      enrolled?: number;
      enrollCap?: number;
      remark?: string | null;
      capturedAt?: string;
    }
  ): PlanSection & { enrollCap?: number } => ({
    courseId,
    courseCode,
    courseTitle: options?.courseTitle ?? `${courseCode} Title`,
    sectionId,
    sectionCode,
    pinned: options?.pinned ?? false,
    missing: options?.missing ?? false,
    modality: blocks.some((b) => b.modality === "ONLINE")
      ? blocks.some((b) => b.modality === "F2F")
        ? "HYBRID"
        : "ONLINE"
      : "F2F",
    blocks,
    latestSnapshot: {
      capturedAt: options?.capturedAt ?? "2026-08-22T00:00:00Z",
      enrolled: options?.enrolled ?? 42,
      professor: options && "professor" in options ? options.professor ?? null : "Prof Gregory Cu",
      remark: options && "remark" in options ? options.remark ?? null : null,
    },
    enrollCap: options?.enrollCap ?? 45,
  });

  describe("formatSectionCopyText", () => {
    it("formats section details as clean plain text for pasting into chat", () => {
      const section = makeSection(
        2923,
        384,
        "GEARTAP",
        "S11",
        [
          makeBlock("TUE", 870, 960, "F2F", "L226"),
          makeBlock("FRI", 870, 960, "ONLINE"),
        ],
        {
          courseTitle: "Art Appreciation",
          professor: "Gregory Cu",
          enrolled: 42,
          enrollCap: 45,
          remark: "Verified schedule",
        }
      );

      const text = formatSectionCopyText(section);

      expect(text).toContain("GEARTAP S11 — Art Appreciation");
      expect(text).toContain("Professor: Gregory Cu");
      expect(text).toContain("TUE 2:30 PM – 4:00 PM (L226, F2F)");
      expect(text).toContain("FRI 2:30 PM – 4:00 PM (Online)");
      expect(text).toContain("Enrolled: 42/45");
      expect(text).toContain("Remark: Verified schedule");
    });

    it("formats blank professor as Unknown (never absent or a dash)", () => {
      const section = makeSection(
        564,
        737,
        "CSINTSY",
        "Z01",
        [makeBlock("WED", 660, 750, "ONLINE")],
        {
          professor: null,
          enrolled: 30,
          enrollCap: 40,
        }
      );

      const text = formatSectionCopyText(section);

      expect(text).toContain("CSINTSY Z01");
      expect(text).toContain("Professor: Unknown");
      expect(text).not.toContain("Professor: -");
    });
  });

  describe("formatCaptureAge", () => {
    it("formats minutes, hours, and days ago accurately", () => {
      const now = new Date("2026-08-26T12:00:00Z");

      expect(formatCaptureAge("2026-08-26T11:59:30Z", now)).toBe("just now");
      expect(formatCaptureAge("2026-08-26T11:45:00Z", now)).toBe("15 minutes ago");
      expect(formatCaptureAge("2026-08-26T10:00:00Z", now)).toBe("2 hours ago");
      expect(formatCaptureAge("2026-08-24T12:00:00Z", now)).toBe("2 days ago");
      expect(formatCaptureAge(null, now)).toBe("Unknown");
      expect(formatCaptureAge("invalid-date", now)).toBe("Unknown");
    });
  });

  describe("describeBlockConflict", () => {
    it("identifies the conflicting section and overlapping time window", () => {
      const sectionA = makeSection(
        2923,
        384,
        "GEARTAP",
        "S11",
        [makeBlock("MON", 450, 540, "F2F", "L226")]
      );
      const sectionB = makeSection(
        564,
        737,
        "CSINTSY",
        "Z01",
        [makeBlock("MON", 480, 570, "ONLINE")]
      );

      const conflicts: Conflict[] = [
        {
          a: { courseId: 2923, sectionId: 384 },
          b: { courseId: 564, sectionId: 737 },
          day: "MON",
          startMin: 480,
          endMin: 540,
        },
      ];

      const descA = describeBlockConflict(
        sectionA,
        sectionA.blocks[0],
        conflicts,
        [sectionA, sectionB]
      );

      expect(descA).not.toBeNull();
      expect(descA?.otherCourseCode).toBe("CSINTSY");
      expect(descA?.otherSectionCode).toBe("Z01");
      expect(descA?.day).toBe("MON");
      expect(descA?.startMin).toBe(480);
      expect(descA?.endMin).toBe(540);
      expect(descA?.message).toContain("CSINTSY Z01");
      expect(descA?.message).toContain("MON");
      expect(descA?.message).toContain("8:00 AM – 9:00 AM");

      const descB = describeBlockConflict(
        sectionB,
        sectionB.blocks[0],
        conflicts,
        [sectionA, sectionB]
      );
      expect(descB?.otherCourseCode).toBe("GEARTAP");
      expect(descB?.otherSectionCode).toBe("S11");
    });

    it("returns null if the block has no conflict", () => {
      const sectionA = makeSection(
        2923,
        384,
        "GEARTAP",
        "S11",
        [makeBlock("MON", 450, 540, "F2F", "L226")]
      );

      const desc = describeBlockConflict(
        sectionA,
        sectionA.blocks[0],
        [],
        [sectionA]
      );
      expect(desc).toBeNull();
    });
  });

  describe("describeMissingSection", () => {
    it("explains ADR-0008 invariant and capture history for missing section", () => {
      const missingSection = makeSection(
        2923,
        384,
        "GEARTAP",
        "S11",
        [makeBlock("MON", 450, 540, "F2F", "L226")],
        {
          missing: true,
          capturedAt: "2026-08-22T00:00:00Z",
        }
      );

      const desc = describeMissingSection(
        missingSection,
        new Date("2026-08-26T00:00:00Z")
      );

      expect(desc.message).toContain("stopped appearing");
      expect(desc.message).toContain("never automatically deleted");
      expect(desc.lastSeen).toBe("4 days ago");
    });
  });

  describe("getMenuPlacement", () => {
    it("returns top-left placement for Monday morning block", () => {
      const placement = getMenuPlacement("MON", 450);
      expect(placement.alignX).toBe("left");
      expect(placement.alignY).toBe("top");
    });

    it("flips horizontally on Saturday column to prevent clipping", () => {
      const placement = getMenuPlacement("SAT", 450);
      expect(placement.alignX).toBe("right");
      expect(placement.alignY).toBe("top");
    });

    it("flips vertically on 2:30 PM (14:30) afternoon block to prevent clipping off bottom", () => {
      const placement = getMenuPlacement("MON", 870);
      expect(placement.alignX).toBe("left");
      expect(placement.alignY).toBe("bottom");
      expect(placement.className).toContain("bottom-full");
    });

    it("flips vertically on evening block to prevent clipping off bottom", () => {
      const placement = getMenuPlacement("MON", 1080);
      expect(placement.alignX).toBe("left");
      expect(placement.alignY).toBe("bottom");
      expect(placement.className).toContain("bottom-full");
    });

    it("flips both horizontally and vertically for Saturday 2:30 PM block", () => {
      const placement = getMenuPlacement("SAT", 870);
      expect(placement.alignX).toBe("right");
      expect(placement.alignY).toBe("bottom");
      expect(placement.className).toContain("right-0");
      expect(placement.className).toContain("bottom-full");
    });

    it("flips both horizontally and vertically for Saturday evening block", () => {
      const placement = getMenuPlacement("SAT", 1080);
      expect(placement.alignX).toBe("right");
      expect(placement.alignY).toBe("bottom");
    });
  });

  describe("computeMenuPosition", () => {
    const defaultViewport = { width: 1024, height: 768 };
    const defaultMenuSize = { width: 224, height: 250 };

    it("positions below and left-aligned for morning block with ample space", () => {
      const anchorRect = { top: 100, left: 150, right: 250, bottom: 160 };
      const pos = computeMenuPosition(anchorRect, defaultViewport, defaultMenuSize);

      expect(pos.alignX).toBe("left");
      expect(pos.alignY).toBe("top");
      expect(pos.top).toBe(164); // anchorRect.bottom + 4
      expect(pos.left).toBe(150); // anchorRect.left
    });

    it("flips vertically when anchor is at 2:30 PM or later near bottom edge", () => {
      // Anchor near bottom of viewport: bottom is at 600, 600 + 250 + 8 = 858 > 768
      const anchorRect = { top: 540, left: 150, right: 250, bottom: 600 };
      const pos = computeMenuPosition(anchorRect, defaultViewport, defaultMenuSize);

      expect(pos.alignX).toBe("left");
      expect(pos.alignY).toBe("bottom");
      expect(pos.top).toBe(286); // 540 - 250 - 4
      expect(pos.left).toBe(150);
    });

    it("flips horizontally when anchor is in Saturday column near right edge", () => {
      // Anchor near right edge: left is at 900, 900 + 224 + 8 = 1132 > 1024
      const anchorRect = { top: 100, left: 880, right: 980, bottom: 160 };
      const pos = computeMenuPosition(anchorRect, defaultViewport, defaultMenuSize);

      expect(pos.alignX).toBe("right");
      expect(pos.alignY).toBe("top");
      expect(pos.top).toBe(164);
      expect(pos.left).toBe(756); // 980 - 224
    });

    it("flips both horizontally and vertically for Saturday afternoon block", () => {
      const anchorRect = { top: 540, left: 880, right: 980, bottom: 600 };
      const pos = computeMenuPosition(anchorRect, defaultViewport, defaultMenuSize);

      expect(pos.alignX).toBe("right");
      expect(pos.alignY).toBe("bottom");
      expect(pos.top).toBe(286);
      expect(pos.left).toBe(756);
    });

    it("clamps position to viewport padding when block is near screen boundaries", () => {
      const tightViewport = { width: 300, height: 300 };
      const anchorRect = { top: 5, left: 2, right: 50, bottom: 60 };
      const pos = computeMenuPosition(anchorRect, tightViewport, defaultMenuSize);

      expect(pos.left).toBeGreaterThanOrEqual(8);
      expect(pos.top).toBeGreaterThanOrEqual(8);
    });
  });
});
