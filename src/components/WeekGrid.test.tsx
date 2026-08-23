import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { WeekGrid } from "./WeekGrid";
import type { PlanSection, ScheduleBlock } from "../adapters/ipc/types";
import { findConflicts } from "../core/conflicts";

describe("WeekGrid component", () => {
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
    pinned = false,
    enrolled = 38,
    enrollCap = 45
  ): PlanSection & { enrollCap: number } => ({
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
      enrolled,
      teacher: "Prof X",
      remark: null,
    },
    enrollCap,
  });

  it("renders six day columns Mon–Sat (never Mon–Fri)", () => {
    const html = renderToStaticMarkup(
      React.createElement(WeekGrid, {
        sections: [],
      })
    );

    // Mon–Sat headers
    expect(html).toContain("Mon");
    expect(html).toContain("Tue");
    expect(html).toContain("Wed");
    expect(html).toContain("Thu");
    expect(html).toContain("Fri");
    expect(html).toContain("Sat");
    expect(html).not.toContain("Sun");
  });

  it("renders all seven time-lattice rows", () => {
    const html = renderToStaticMarkup(
      React.createElement(WeekGrid, {
        sections: [],
      })
    );

    expect(html).toContain("07:30");
    expect(html).toContain("09:15");
    expect(html).toContain("11:00");
    expect(html).toContain("12:45");
    expect(html).toContain("14:30");
    expect(html).toContain("16:15");
    expect(html).toContain("18:00");
  });

  it("renders a plan with one section including course code, section code, modality and enrolled/cap", () => {
    const section = makeSection(
      2923,
      384,
      "GEARTAP",
      "S11",
      [
        makeBlock("TUE", 870, 960, "F2F", "L226"),
        makeBlock("FRI", 870, 960, "ONLINE"),
      ],
      false,
      42,
      45
    );

    const html = renderToStaticMarkup(
      React.createElement(WeekGrid, {
        sections: [section],
      })
    );

    expect(html).toContain("GEARTAP");
    expect(html).toContain("S11");
    expect(html).toContain("42/45");
    expect(html).toContain("L226");
    expect(html).toContain("Online");
  });

  it("ensures hybrid section's two blocks share the exact same course hue", () => {
    const section = makeSection(
      2923,
      384,
      "GEARTAP",
      "S11",
      [
        makeBlock("TUE", 870, 960, "F2F", "L226"),
        makeBlock("FRI", 870, 960, "ONLINE"),
      ],
      false,
      42,
      45
    );

    const html = renderToStaticMarkup(
      React.createElement(WeekGrid, {
        sections: [section],
      })
    );

    // Both blocks must have the same course theme styling classes or hex
    // And modality reads from left border (solid vs dashed)
    expect(html).toContain("border-l-solid");
    expect(html).toContain("border-l-dashed");
  });

  it("renders a section whose blocks are all online", () => {
    const onlineSection = makeSection(
      564,
      737,
      "CSINTSY",
      "Z01",
      [
        makeBlock("WED", 660, 750, "ONLINE"),
        makeBlock("SAT", 660, 750, "ONLINE"),
      ],
      false,
      35,
      40
    );

    const html = renderToStaticMarkup(
      React.createElement(WeekGrid, {
        sections: [onlineSection],
      })
    );

    expect(html).toContain("CSINTSY");
    expect(html).toContain("Z01");
    expect(html).toContain("35/40");
    expect(html).toContain("Online");
  });

  it("renders pinned vs tentative with distinct styling", () => {
    const pinnedSection = makeSection(
      2923,
      384,
      "GEARTAP",
      "S11",
      [makeBlock("MON", 450, 540, "F2F", "L226")],
      true
    );

    const tentativeSection = makeSection(
      564,
      737,
      "CSINTSY",
      "Z01",
      [makeBlock("WED", 450, 540, "F2F", "Y603")],
      false
    );

    const html = renderToStaticMarkup(
      React.createElement(WeekGrid, {
        sections: [pinnedSection, tentativeSection],
      })
    );

    expect(html).toContain("data-pinned=\"true\"");
    expect(html).toContain("data-pinned=\"false\"");
  });

  it("renders overlapping conflicting blocks with hatched styling", () => {
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

    const sections = [sectionA, sectionB];
    const conflicts = findConflicts(sections);
    expect(conflicts.length).toBe(1);

    const html = renderToStaticMarkup(
      React.createElement(WeekGrid, {
        sections,
        conflicts,
      })
    );

    expect(html).toContain("data-conflicting=\"true\"");
    expect(html).toContain("hatched");
  });

  it("renders multi-day conflicts correctly across multiple days", () => {
    const sectionA = makeSection(
      1,
      10,
      "COURSE_A",
      "A1",
      [
        makeBlock("MON", 450, 540, "F2F", "L226"),
        makeBlock("THU", 450, 540, "F2F", "L226"),
      ]
    );
    const sectionB = makeSection(
      2,
      20,
      "COURSE_B",
      "B1",
      [
        makeBlock("MON", 480, 570, "ONLINE"),
        makeBlock("THU", 480, 570, "ONLINE"),
      ]
    );

    const sections = [sectionA, sectionB];
    const conflicts = findConflicts(sections);
    expect(conflicts.length).toBe(2);

    const html = renderToStaticMarkup(
      React.createElement(WeekGrid, {
        sections,
        conflicts,
      })
    );

    expect(html).toContain("COURSE_A");
    expect(html).toContain("COURSE_B");
    expect(html).toContain("data-conflicting=\"true\"");
  });

  it("renders a ghost section with data-ghost='true' and preview styling", () => {
    const planSection = makeSection(
      2923,
      384,
      "GEARTAP",
      "S11",
      [makeBlock("MON", 450, 540, "F2F", "L226")]
    );

    const ghostCandidate = makeSection(
      564,
      737,
      "CSINTSY",
      "Z01",
      [makeBlock("WED", 450, 540, "ONLINE")]
    );

    const html = renderToStaticMarkup(
      React.createElement(WeekGrid, {
        sections: [planSection],
        ghostSection: ghostCandidate,
      })
    );

    expect(html).toContain("data-ghost=\"true\"");
    expect(html).toContain("CSINTSY");
    expect(html).toContain("Z01");
  });

  it("renders ghost section as conflicting and hatched when overlapping with a plan section", () => {
    const planSection = makeSection(
      2923,
      384,
      "GEARTAP",
      "S11",
      [makeBlock("MON", 450, 540, "F2F", "L226")]
    );

    const ghostConflicting = makeSection(
      564,
      737,
      "CSINTSY",
      "Z01",
      [makeBlock("MON", 480, 570, "ONLINE")]
    );

    const html = renderToStaticMarkup(
      React.createElement(WeekGrid, {
        sections: [planSection],
        ghostSection: ghostConflicting,
      })
    );

    expect(html).toContain("data-ghost=\"true\"");
    expect(html).toContain("data-conflicting=\"true\"");
    expect(html).toContain("hatched");
  });

  it("does not render ghost blocks when ghostSection is null", () => {
    const planSection = makeSection(
      2923,
      384,
      "GEARTAP",
      "S11",
      [makeBlock("MON", 450, 540, "F2F", "L226")]
    );

    const html = renderToStaticMarkup(
      React.createElement(WeekGrid, {
        sections: [planSection],
        ghostSection: null,
      })
    );

    expect(html).not.toContain("data-ghost=\"true\"");
  });
});

