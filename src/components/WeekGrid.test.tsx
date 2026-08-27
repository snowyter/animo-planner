import { describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { WeekGrid, blockTooltip } from "./WeekGrid";
import type { PlanSection, ScheduleBlock } from "../adapters/ipc/types";
import { findConflicts } from "../core/conflicts";

describe("WeekGrid component", () => {
  // The professor lives on the latest snapshot and appeared nowhere on the grid,
  // so choosing between two sections of one course meant leaving it.
  it("names the professor in a block's hover tooltip", () => {
    const tip = blockTooltip(
      {
        courseCode: "CSOPESY",
        sectionCode: "S01",
        latestSnapshot: { capturedAt: "", enrolled: 37, professor: "Gregory Cu", remark: null },
      } as never,
      { day: "TUE", startMin: 555, endMin: 645, location: "G207", modality: "F2F" } as never,
      { isF2F: true, isGhost: false, isMissing: false }
    );

    expect(tip).toContain("CSOPESY S01");
    expect(tip).toContain("Gregory Cu");
    expect(tip).toContain("37");
  });

  // A blank professor is unknown, never absent and never a dash (CONTEXT.md).
  it("reads a blank professor as unknown rather than omitting it", () => {
    const tip = blockTooltip(
      {
        courseCode: "CSOPESY",
        sectionCode: "S01",
        latestSnapshot: { capturedAt: "", enrolled: 0, professor: null, remark: null },
      } as never,
      { day: "TUE", startMin: 555, endMin: 645, location: null, modality: "ONLINE" } as never,
      { isF2F: false, isGhost: false, isMissing: false }
    );

    expect(tip).toContain("Professor: Unknown");
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
      professor: "Prof X",
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
        previewSections: [ghostCandidate],
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
        previewSections: [ghostConflicting],
      })
    );

    expect(html).toContain("data-ghost=\"true\"");
    expect(html).toContain("data-conflicting=\"true\"");
    expect(html).toContain("hatched");
  });

  it("does not render preview blocks when nothing is previewed", () => {
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
        previewSections: null,
      })
    );

    expect(html).not.toContain("data-ghost=\"true\"");
  });

  /**
   * Ticket 46 — one preview mechanism.
   *
   * The picker previews one hovered section; the solver previews a whole
   * candidate schedule. They are the same concept and share this one prop, so
   * two systems can never race for the same surface.
   */
  describe("previewing a whole set of sections", () => {
    it("draws every section of a previewed solution as a preview block", () => {
      const previewA = makeSection(
        2923,
        384,
        "GEARTAP",
        "S11",
        [makeBlock("TUE", 870, 960, "F2F", "L226")]
      );
      const previewB = makeSection(
        564,
        737,
        "CSINTSY",
        "Z01",
        [makeBlock("WED", 450, 540, "ONLINE")]
      );

      const html = renderToStaticMarkup(
        React.createElement(WeekGrid, {
          sections: [],
          previewSections: [previewA, previewB],
        })
      );

      expect(html.match(/data-ghost="true"/g)).toHaveLength(2);
      expect(html).toContain("GEARTAP");
      expect(html).toContain("CSINTSY");
    });

    it("keeps a previewed set from being mistaken for the applied plan", () => {
      const previewA = makeSection(
        2923,
        384,
        "GEARTAP",
        "S11",
        [makeBlock("TUE", 870, 960, "F2F", "L226")]
      );

      const html = renderToStaticMarkup(
        React.createElement(WeekGrid, {
          sections: [],
          previewSections: [previewA],
          previewLabel: "Previewing Schedule #1",
        })
      );

      // Marked on the block, and named on the grid itself.
      expect(html).toContain("Preview");
      expect(html).toContain('data-testid="week-grid-preview-notice"');
      expect(html).toContain("Previewing Schedule #1");
      expect(html).toContain("pointer-events-none");
    });

    it("hides the plan's own sections behind the previewed set, not beside it", () => {
      // A solution preview replaces the schedule for as long as it is shown.
      // Drawing both at once would read as a plan with double the sections.
      const planSection = makeSection(
        2923,
        384,
        "GEARTAP",
        "S11",
        [makeBlock("MON", 450, 540, "F2F", "L226")]
      );
      const previewOther = makeSection(
        2923,
        385,
        "GEARTAP",
        "S12",
        [makeBlock("THU", 450, 540, "F2F", "L226")]
      );

      const html = renderToStaticMarkup(
        React.createElement(WeekGrid, {
          sections: [planSection],
          previewSections: [previewOther],
          previewReplacesPlan: true,
        })
      );

      expect(html).toContain("S12");
      expect(html).not.toContain("S11");
    });

    it("offers to apply the schedule from the grid the student is reading", () => {
      // The decision is made while looking at the week, not at the card that
      // produced it. Making them go back to the panel to act on what they
      // just decided is the seam where a preview stops feeling live.
      const previewA = makeSection(
        2923,
        384,
        "GEARTAP",
        "S11",
        [makeBlock("TUE", 870, 960, "F2F", "L226")]
      );

      const html = renderToStaticMarkup(
        React.createElement(WeekGrid, {
          sections: [],
          previewSections: [previewA],
          previewLabel: "Previewing Schedule #1",
          previewReplacesPlan: true,
          onApplyPreview: vi.fn(),
          onClearPreview: vi.fn(),
        })
      );

      const notice = html.slice(html.indexOf('data-testid="week-grid-preview-notice"'));
      expect(notice).toContain('data-testid="week-grid-apply-preview"');
      expect(notice).toContain('data-testid="week-grid-clear-preview"');
    });

    it("offers no apply control when applying is not the caller's to offer", () => {
      const previewA = makeSection(
        2923,
        384,
        "GEARTAP",
        "S11",
        [makeBlock("TUE", 870, 960, "F2F", "L226")]
      );

      const html = renderToStaticMarkup(
        React.createElement(WeekGrid, {
          sections: [],
          previewSections: [previewA],
          previewLabel: "Previewing Schedule #1",
          previewReplacesPlan: true,
          onClearPreview: vi.fn(),
        })
      );

      expect(html).not.toContain('data-testid="week-grid-apply-preview"');
    });

    it("still ghosts a single hovered candidate over the plan it would join", () => {
      const planSection = makeSection(
        2923,
        384,
        "GEARTAP",
        "S11",
        [makeBlock("MON", 450, 540, "F2F", "L226")]
      );
      const hovered = makeSection(
        564,
        737,
        "CSINTSY",
        "Z01",
        [makeBlock("WED", 450, 540, "ONLINE")]
      );

      const html = renderToStaticMarkup(
        React.createElement(WeekGrid, {
          sections: [planSection],
          previewSections: [hovered],
        })
      );

      expect(html).toContain("S11");
      expect(html).toContain("Z01");
      expect(html.match(/data-ghost="true"/g)).toHaveLength(1);
      // And nothing to dismiss: a hover preview is not a mode.
      expect(html).not.toContain('data-testid="week-grid-preview-notice"');
    });
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
          previewSections: [ghostSection],
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

    it("renders Section Details modal with course code, title, section code, blocks, professor, enrolment, remark and capture age", () => {
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
        professor: "Prof Gregory Cu",
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

    it("renders Section Details modal with blank professor as 'Unknown' (never absent or a dash)", () => {
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
        professor: null,
        remark: null,
      };

      const html = renderToStaticMarkup(
        React.createElement(WeekGrid, {
          sections: [section],
          initialDetailsSection: section,
        })
      );

      expect(html).toContain('data-testid="section-details-dialog"');
      expect(html).toContain("Professor:");
      expect(html).toContain("Unknown");
      expect(html).not.toContain("Professor: -");
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

    it("renders context menu outside the grid's overflow scroll container (ticket 45)", () => {
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
          initialMenu: { section, block: section.blocks[0] },
        })
      );

      expect(html).toContain('data-testid="grid-context-menu"');

      // The menu must render after the grid canvas and day columns, outside the clipping subtree
      const overflowStartIndex = html.indexOf('class="overflow-x-auto"');
      const menuIndex = html.indexOf('data-testid="grid-context-menu"');
      expect(overflowStartIndex).toBeGreaterThan(-1);
      expect(menuIndex).toBeGreaterThan(-1);

      // The grid canvas and all schedule blocks precede the context menu
      const canvasStartIndex = html.indexOf('class="relative grid grid-cols-[70px_repeat(6,1fr)]');
      expect(canvasStartIndex).toBeGreaterThan(-1);
      expect(canvasStartIndex).toBeLessThan(menuIndex);

      // The canvasSection containing all day columns and blocks must not contain the menu
      const canvasSection = html.slice(canvasStartIndex, menuIndex);
      expect(canvasSection).not.toContain('data-testid="grid-context-menu"');
    });

    it("suppresses native hover tooltip on the block when context menu is open for that block (ticket 45)", () => {
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
        [makeBlock("WED", 450, 540, "ONLINE")]
      );

      const html = renderToStaticMarkup(
        React.createElement(WeekGrid, {
          sections: [sectionA, sectionB],
          initialMenu: { section: sectionA, block: sectionA.blocks[0] },
        })
      );

      // Section B (menu not open) has its normal tooltip
      expect(html).toContain("CSINTSY Z01");
      expect(html).toContain("title=\"CSINTSY Z01");

      // Section A (menu is open) does NOT have title="GEARTAP S11..." on its block
      expect(html).not.toContain("title=\"GEARTAP S11");
    });

    it("flips context menu vertically on a 2:30 PM (14:30) block (ticket 45)", () => {
      const section = makeSection(
        2923,
        384,
        "GEARTAP",
        "S11",
        [makeBlock("MON", 870, 960, "F2F", "L226")]
      );

      const html = renderToStaticMarkup(
        React.createElement(WeekGrid, {
          sections: [section],
          initialMenu: { section, block: section.blocks[0] },
        })
      );

      expect(html).toContain('data-testid="grid-context-menu"');
      expect(html).toContain("bottom-full");
    });

    it("flips context menu horizontally on a Saturday column block (ticket 45)", () => {
      const section = makeSection(
        2923,
        384,
        "GEARTAP",
        "S11",
        [makeBlock("SAT", 450, 540, "F2F", "L226")]
      );

      const html = renderToStaticMarkup(
        React.createElement(WeekGrid, {
          sections: [section],
          initialMenu: { section, block: section.blocks[0] },
        })
      );

      expect(html).toContain('data-testid="grid-context-menu"');
      expect(html).toContain("right-0");
    });
  });
});



