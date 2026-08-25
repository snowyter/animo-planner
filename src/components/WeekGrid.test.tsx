import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { WeekGrid, blockTooltip } from "./WeekGrid";
import type { PlanSection, ScheduleBlock } from "../adapters/ipc/types";
import { findConflicts } from "../core/conflicts";

describe("WeekGrid component", () => {
  // The teacher lives on the latest snapshot and appeared nowhere on the grid,
  // so choosing between two sections of one course meant leaving it.
  it("names the teacher in a block's hover tooltip", () => {
    const tip = blockTooltip(
      {
        courseCode: "CSOPESY",
        sectionCode: "S01",
        latestSnapshot: { capturedAt: "", enrolled: 37, teacher: "Gregory Cu", remark: null },
      } as never,
      { day: "TUE", startMin: 555, endMin: 645, location: "G207", modality: "F2F" } as never,
      { isF2F: true, isGhost: false, isMissing: false }
    );

    expect(tip).toContain("CSOPESY S01");
    expect(tip).toContain("Gregory Cu");
    expect(tip).toContain("37");
  });

  // A blank teacher is unknown, never absent and never a dash (CONTEXT.md).
  it("reads a blank teacher as unknown rather than omitting it", () => {
    const tip = blockTooltip(
      {
        courseCode: "CSOPESY",
        sectionCode: "S01",
        latestSnapshot: { capturedAt: "", enrolled: 0, teacher: null, remark: null },
      } as never,
      { day: "TUE", startMin: 555, endMin: 645, location: null, modality: "ONLINE" } as never,
      { isF2F: false, isGhost: false, isMissing: false }
    );

    expect(tip).toContain("Teacher: Unknown");
  });

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

  it("renders missing section visibly on the grid marked with data-missing='true' and missing indicator", () => {
    const missingSection = makeSection(
      2923,
      384,
      "GEARTAP",
      "S11",
      [makeBlock("MON", 450, 540, "F2F", "L226")]
    );
    missingSection.missing = true;

    const html = renderToStaticMarkup(
      React.createElement(WeekGrid, {
        sections: [missingSection],
      })
    );

    expect(html).toContain("data-missing=\"true\"");
    expect(html).toContain("Missing");
    expect(html).toContain("GEARTAP");
    expect(html).toContain("S11");
  });

  describe("Context menu & actions (Ticket 41)", () => {
    it("renders schedule blocks as focusable with accessible button role and aria-haspopup", () => {
      const section = makeSection(
        2923,
        384,
        "GEARTAP",
        "S11",
        [makeBlock("MON", 450, 540, "F2F", "L226")]
      );

      const html = renderToStaticMarkup(
        React.createElement(WeekGrid, {
          sections: [section],
        })
      );

      expect(html).toContain('tabindex="0"');
      expect(html).toContain('role="button"');
      expect(html).toContain('aria-haspopup="menu"');
      expect(html).toContain("focus-visible:ring-2");
    });

    it("renders context menu with all core items for an unpinned normal plan block", () => {
      const section = makeSection(
        2923,
        384,
        "GEARTAP",
        "S11",
        [makeBlock("MON", 450, 540, "F2F", "L226")],
        false
      );

      const html = renderToStaticMarkup(
        React.createElement(WeekGrid, {
          sections: [section],
          initialMenu: { section, block: section.blocks[0] },
        })
      );

      expect(html).toContain('data-testid="grid-context-menu"');
      expect(html).toContain("View details");
      expect(html).toContain("Pin section");
      expect(html).toContain("Show other sections of this course");
      expect(html).toContain("Copy details");
      expect(html).toContain("Remove from schedule");
      // Destructive action placed last with destructive styling
      expect(html).toContain("text-red-600");
      // Not conflicting or missing, so conditional items should NOT appear
      expect(html).not.toContain("Why is this conflicting?");
      expect(html).not.toContain("Why is this flagged?");
    });

    it("renders 'Unpin section' when the section is currently pinned", () => {
      const pinnedSection = makeSection(
        2923,
        384,
        "GEARTAP",
        "S11",
        [makeBlock("MON", 450, 540, "F2F", "L226")],
        true
      );

      const html = renderToStaticMarkup(
        React.createElement(WeekGrid, {
          sections: [pinnedSection],
          initialMenu: { section: pinnedSection, block: pinnedSection.blocks[0] },
        })
      );

      expect(html).toContain("Unpin section");
      expect(html).not.toContain("Pin section");
    });

    it("renders 'Why is this conflicting?' only when block is conflicting", () => {
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

      const conflicts = findConflicts([sectionA, sectionB]);

      const html = renderToStaticMarkup(
        React.createElement(WeekGrid, {
          sections: [sectionA, sectionB],
          conflicts,
          initialMenu: { section: sectionA, block: sectionA.blocks[0] },
        })
      );

      expect(html).toContain("Why is this conflicting?");
    });

    it("renders 'Why is this flagged?' only when section is marked missing", () => {
      const missingSection = makeSection(
        2923,
        384,
        "GEARTAP",
        "S11",
        [makeBlock("MON", 450, 540, "F2F", "L226")]
      );
      missingSection.missing = true;

      const html = renderToStaticMarkup(
        React.createElement(WeekGrid, {
          sections: [missingSection],
          initialMenu: { section: missingSection, block: missingSection.blocks[0] },
        })
      );

      expect(html).toContain("Why is this flagged?");
    });

    it("keeps ghost blocks completely inert with no context menu affordance or focusability", () => {
      const planSection = makeSection(
        2923,
        384,
        "GEARTAP",
        "S11",
        [makeBlock("MON", 450, 540, "F2F", "L226")]
      );

      const ghostSection = makeSection(
        564,
        737,
        "CSINTSY",
        "Z01",
        [makeBlock("WED", 450, 540, "ONLINE")]
      );

      const html = renderToStaticMarkup(
        React.createElement(WeekGrid, {
          sections: [planSection],
          ghostSection,
        })
      );

      // Ghost block has pointer-events-none and data-ghost="true"
      expect(html).toContain("data-ghost=\"true\"");
      expect(html).toContain("pointer-events-none");
    });

    it("renders no interactive menu or focus affordances when interactive=false (PNG export safety)", () => {
      const section = makeSection(
        2923,
        384,
        "GEARTAP",
        "S11",
        [makeBlock("MON", 450, 540, "F2F", "L226")]
      );

      const html = renderToStaticMarkup(
        React.createElement(WeekGrid, {
          sections: [section],
          interactive: false,
        })
      );

      expect(html).not.toContain('tabindex="0"');
      expect(html).not.toContain('data-testid="grid-context-menu"');
    });

    it("renders Section Details modal with course code, title, section code, blocks, teacher, enrolment, remark and capture age", () => {
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
      section.latestSnapshot = {
        capturedAt: "2026-08-22T00:00:00Z",
        enrolled: 42,
        teacher: "Prof Gregory Cu",
        remark: "Room subject to change",
      };

      const html = renderToStaticMarkup(
        React.createElement(WeekGrid, {
          sections: [section],
          initialDetailsSection: section,
        })
      );

      expect(html).toContain('data-testid="section-details-dialog"');
      expect(html).toContain("GEARTAP");
      expect(html).toContain("GEARTAP Title");
      expect(html).toContain("S11");
      expect(html).toContain("Prof Gregory Cu");
      expect(html).toContain("42/45");
      expect(html).toContain("L226");
      expect(html).toContain("Online");
      expect(html).toContain("Room subject to change");
      expect(html).toContain("Captured");
    });

    it("renders Section Details modal with blank teacher as 'Unknown' (never absent or a dash)", () => {
      const section = makeSection(
        564,
        737,
        "CSINTSY",
        "Z01",
        [makeBlock("WED", 660, 750, "ONLINE")],
        false,
        30,
        40
      );
      section.latestSnapshot = {
        capturedAt: "2026-08-22T00:00:00Z",
        enrolled: 30,
        teacher: null,
        remark: null,
      };

      const html = renderToStaticMarkup(
        React.createElement(WeekGrid, {
          sections: [section],
          initialDetailsSection: section,
        })
      );

      expect(html).toContain('data-testid="section-details-dialog"');
      expect(html).toContain("Teacher:");
      expect(html).toContain("Unknown");
      expect(html).not.toContain("Teacher: -");
    });

    it("renders Conflict Explanation modal describing conflicting section and overlap window", () => {
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

      const conflicts = findConflicts([sectionA, sectionB]);

      const html = renderToStaticMarkup(
        React.createElement(WeekGrid, {
          sections: [sectionA, sectionB],
          conflicts,
          initialConflictDetails: { section: sectionA, block: sectionA.blocks[0] },
        })
      );

      expect(html).toContain('data-testid="conflict-explanation-dialog"');
      expect(html).toContain("CSINTSY Z01");
      expect(html).toContain("MON");
      expect(html).toContain("8:00 AM – 9:00 AM");
      expect(html).toContain("ADR-0009");
    });

    it("renders Flagged Explanation modal explaining missing status and ADR-0008 invariant", () => {
      const missingSection = makeSection(
        2923,
        384,
        "GEARTAP",
        "S11",
        [makeBlock("MON", 450, 540, "F2F", "L226")]
      );
      missingSection.missing = true;

      const html = renderToStaticMarkup(
        React.createElement(WeekGrid, {
          sections: [missingSection],
          initialFlaggedDetails: missingSection,
        })
      );

      expect(html).toContain('data-testid="flagged-explanation-dialog"');
      expect(html).toContain("GEARTAP S11");
      expect(html).toContain("stopped appearing");
      expect(html).toContain("ADR-0008");
      expect(html).toContain("never automatically deleted");
    });
  });
});


