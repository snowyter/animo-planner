import { describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MissingSectionBanner } from "./MissingSectionBanner";
import type { MissingSection, PlanSection, ScheduleBlock, Section } from "../adapters/ipc/types";

describe("MissingSectionBanner", () => {
  const makeBlock = (day: ScheduleBlock["day"], startMin: number, endMin: number, location = "L226"): ScheduleBlock => ({
    day,
    startMin,
    endMin,
    modality: "F2F",
    location,
  });

  const mockAlternative: Section = {
    campusId: 7,
    sessionId: 155,
    courseId: 2923,
    courseCode: "GEARTAP",
    courseTitle: "Art Appreciation",
    sectionId: 385,
    sectionCode: "Y32",
    courseType: "Lecture",
    credits: 3,
    enrollCap: 45,
    startDate: "2026-07-10",
    endDate: "2026-12-09",
    firstSeenAt: "2026-08-24T00:00:00Z",
    lastSeenAt: "2026-08-24T00:00:00Z",
    modality: "F2F",
    blocks: [makeBlock("MON", 450, 540, "L226")],
    latestSnapshot: {
      capturedAt: "2026-08-24T00:00:00Z",
      enrolled: 40,
      teacher: "Prof B",
      remark: null,
    },
  };

  const mockMissing: MissingSection = {
    courseId: 2923,
    sectionId: 384,
    sectionCode: "Y31",
    alternatives: [mockAlternative],
  };

  const mockPlanSection: PlanSection = {
    courseId: 2923,
    courseCode: "GEARTAP",
    courseTitle: "Art Appreciation",
    sectionId: 384,
    sectionCode: "Y31",
    pinned: false,
    missing: true,
    modality: "F2F",
    blocks: [makeBlock("TUE", 450, 540, "L226")],
    latestSnapshot: {
      capturedAt: "2026-08-24T00:00:00Z",
      enrolled: 42,
      teacher: null,
      remark: null,
    },
  };

  it("renders nothing when there are no missing sections", () => {
    const html = renderToStaticMarkup(
      React.createElement(MissingSectionBanner, {
        missingSections: [],
        planSections: [],
        onAddAlternative: vi.fn(),
        onRemoveMissingSection: vi.fn(),
      })
    );
    expect(html).toBe("");
  });

  it("renders persistent banner naming the missing section", () => {
    const html = renderToStaticMarkup(
      React.createElement(MissingSectionBanner, {
        missingSections: [mockMissing],
        planSections: [mockPlanSection],
        onAddAlternative: vi.fn(),
        onRemoveMissingSection: vi.fn(),
      })
    );

    expect(html).toContain("GEARTAP");
    expect(html).toContain("Y31");
    expect(html).toContain("missing");
    expect(html).toContain("never silently removed");
  });

  it("surfaces alternatives for the missing section with their details", () => {
    const html = renderToStaticMarkup(
      React.createElement(MissingSectionBanner, {
        missingSections: [mockMissing],
        planSections: [mockPlanSection],
        onAddAlternative: vi.fn(),
        onRemoveMissingSection: vi.fn(),
      })
    );

    expect(html).toContain("Y32");
    expect(html).toContain("Prof B");
    expect(html).toContain("40/45");
    expect(html).toContain("L226");
    expect(html).toContain("Add to Plan");
  });

  it("shows a message when no alternatives exist for the missing section", () => {
    const missingNoAlts: MissingSection = {
      courseId: 2923,
      sectionId: 384,
      sectionCode: "Y31",
      alternatives: [],
    };

    const html = renderToStaticMarkup(
      React.createElement(MissingSectionBanner, {
        missingSections: [missingNoAlts],
        planSections: [mockPlanSection],
        onAddAlternative: vi.fn(),
        onRemoveMissingSection: vi.fn(),
      })
    );

    expect(html).toContain("No other sections");
  });
});
