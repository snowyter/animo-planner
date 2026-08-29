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

  it("includes remark in block tooltip when present", () => {
    const tip = blockTooltip(
      {
        courseCode: "PETHREE",
        sectionCode: "Y16H",
        latestSnapshot: {
          capturedAt: "",
          enrolled: 42,
          professor: "Prof Coach",
          remark: "PICKLEBALL",
        },
      } as never,
      { day: "SAT", startMin: 480, endMin: 600, location: "R7B", modality: "F2F" } as never,
      { isF2F: true, isGhost: false, isMissing: false }
    );

    expect(tip).toContain("Remark: PICKLEBALL");
  });

  it("omits remark line in block tooltip when remark is null", () => {
    const tip = blockTooltip(
      {
        courseCode: "GEARTAP",
        sectionCode: "S11",
        latestSnapshot: { capturedAt: "", enrolled: 40, professor: "Prof A", remark: null },
      } as never,
      { day: "MON", startMin: 450, endMin: 540, location: "L226", modality: "F2F" } as never,
      { isF2F: true, isGhost: false, isMissing: false }
    );

    expect(tip).not.toContain("Remark");
  });

  it("omits remark line in block tooltip when remark is empty string", () => {
    const tip = blockTooltip(
      {
        courseCode: "GEARTAP",
        sectionCode: "S11",
        latestSnapshot: { capturedAt: "", enrolled: 40, professor: "Prof A", remark: "" },
      } as never,
      { day: "MON", startMin: 450, endMin: 540, location: "L226", modality: "F2F" } as never,
      { isF2F: true, isGhost: false, isMissing: false }
    );

    expect(tip).not.toContain("Remark");
  });

  it("omits remark line in block tooltip when remark is whitespace-only", () => {
    const tip = blockTooltip(
      {
        courseCode: "GEARTAP",
        sectionCode: "S11",
        latestSnapshot: { capturedAt: "", enrolled: 40, professor: "Prof A", remark: "   " },
      } as never,
      { day: "MON", startMin: 450, endMin: 540, location: "L226", modality: "F2F" } as never,
      { isF2F: true, isGhost: false, isMissing: false }
    );

    expect(tip).not.toContain("Remark");
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
    enrollCap = 45,
    remark: string | null = null
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
      remark,
    },
    enrollCap,
  });

  it("renders a section with a remark displaying the remark text on the grid block", () => {
    const peSection = makeSection(
      101,
      201,
      "PETHREE",
      "Y16H",
      [makeBlock("SAT", 480, 600, "F2F", "R7B")],
      false,
      42,
      45,
      "PICKLEBALL"
    );

    const html = renderToStaticMarkup(
      React.createElement(WeekGrid, {
        sections: [peSection],
      })
    );

    expect(html).toContain("PETHREE");
    expect(html).toContain("Y16H");
    expect(html).toContain("PICKLEBALL");
    expect(html).toMatch(/<span[^>]*class="[^"]*truncate[^"]*"[^>]*title="PICKLEBALL"[^>]*>\s*(?:•\s*)?PICKLEBALL\s*<\/span>/);
  });

  it("renders a section without a remark identically with no empty remark element or dash", () => {
    const sectionNull = makeSection(
      2923,
      384,
      "GEARTAP",
      "S11",
      [makeBlock("MON", 450, 540, "F2F", "L226")],
      false,
      42,
      45,
      null
    );

    const sectionEmpty = makeSection(
      2923,
      384,
      "GEARTAP",
      "S11",
      [makeBlock("MON", 450, 540, "F2F", "L226")],
      false,
      42,
      45,
      ""
    );

    const sectionWhitespace = makeSection(
      2923,
      384,
      "GEARTAP",
      "S11",
      [makeBlock("MON", 450, 540, "F2F", "L226")],
      false,
      42,
      45,
      "   "
    );

    const htmlNull = renderToStaticMarkup(React.createElement(WeekGrid, { sections: [sectionNull] }));
    const htmlEmpty = renderToStaticMarkup(React.createElement(WeekGrid, { sections: [sectionEmpty] }));
    const htmlWhitespace = renderToStaticMarkup(React.createElement(WeekGrid, { sections: [sectionWhitespace] }));

    expect(htmlNull).toBe(htmlEmpty);
    expect(htmlNull).toBe(htmlWhitespace);
    expect(htmlNull).toContain("GEARTAP");
    expect(htmlNull).toContain("S11");
    expect(htmlNull).not.toContain("Remark:");
    expect(htmlNull).not.toMatch(/title="null"/);
    expect(htmlNull).not.toMatch(/title="undefined"/);
  });

  it("truncates a long remark with the full text available in title", () => {
    const longRemark = "VERY LONG REMARK DESCRIBING SECTION REQUIREMENTS AND SPECIAL PREREQUISITES";
    const sectionWithLongRemark = makeSection(
      102,
      202,
      "PETHREE",
      "Y07K",
      [makeBlock("SAT", 930, 1050, "F2F", "ERPOOL")],
      false,
      45,
      45,
      longRemark
    );

    const html = renderToStaticMarkup(
      React.createElement(WeekGrid, {
        sections: [sectionWithLongRemark],
      })
    );

    expect(html).toContain("PETHREE");
    expect(html).toContain("Y07K");
    expect(html).toContain(longRemark);
    expect(html).toMatch(new RegExp(`title="${longRemark}"`));
    expect(html).toMatch(/class="[^"]*truncate[^"]*"/);
  });

  it("renders course code and section code distinctly in the top row", () => {
    const section = makeSection(
      101,
      201,
      "PETHREE",
      "Y16H",
      [makeBlock("SAT", 480, 600, "F2F", "R7B")],
      false,
      42,
      45,
      "PICKLEBALL"
    );

    const html = renderToStaticMarkup(
      React.createElement(WeekGrid, {
        sections: [section],
      })
    );

    expect(html).toMatch(/<span[^>]*class="[^"]*font-bold[^"]*truncate[^"]*"[^>]*>\s*PETHREE\s*<\/span>/);
    expect(html).toContain("Y16H");
  });

  it("keeps time range on a single line with whitespace-nowrap so times do not break onto multiple lines", () => {
    const section = makeSection(
      101,
      201,
      "GEWORLD",
      "E01A",
      [makeBlock("WED", 555, 645, "F2F", "G208")],
      false,
      45,
      45
    );

    const html = renderToStaticMarkup(
      React.createElement(WeekGrid, {
        sections: [section],
      })
    );

    expect(html).toMatch(/<div[^>]*class="[^"]*whitespace-nowrap[^"]*"[^>]*>\s*9:15 AM – 10:45 AM\s*<\/div>/);
  });

  it("keeps grid responsive and full-width without forcing a horizontal scrollbar", () => {
    const html = renderToStaticMarkup(
      React.createElement(WeekGrid, {
        sections: [],
      })
    );

    expect(html).toContain('min-w-0');
    expect(html).not.toContain('min-w-[880px]');
    expect(html).not.toContain('min-w-[840px]');
    expect(html).not.toContain('min-w-[680px]');
  });

  it("renders remark on preview/ghost blocks alongside Preview badge", () => {
    const ghostSectionWithRemark = makeSection(
      103,
      203,
      "PETHREE",
      "Y09J",
      [makeBlock("SAT", 480, 600, "F2F", "R804")],
      false,
      40,
      45,
      "SOCDANCE"
    );

    const html = renderToStaticMarkup(
      React.createElement(WeekGrid, {
        sections: [],
        previewSections: [ghostSectionWithRemark],
      })
    );

    expect(html).toContain("data-ghost=\"true\"");
    expect(html).toContain("SOCDANCE");
    expect(html).toContain("Preview");
  });

  it("confines tile contents with overflow-hidden on the schedule block container", () => {
    const section = makeSection(
      101,
      201,
      "CSOPESY",
      "S03",
      [makeBlock("MON", 660, 750, "F2F", "G207")],
      false,
      45,
      45
    );

    const html = renderToStaticMarkup(
      React.createElement(WeekGrid, {
        sections: [section],
      })
    );

    expect(html).toMatch(/<div[^>]*role="button"[^>]*class="[^"]*overflow-hidden[^"]*"/);
  });

  it("places Preview and Missing badges in the status cluster", () => {
    const ghostSection = makeSection(
      101,
      201,
      "CSOPESY",
      "S03",
      [makeBlock("MON", 660, 750, "F2F", "G207")],
      false,
      45,
      45
    );

    const html = renderToStaticMarkup(
      React.createElement(WeekGrid, {
        sections: [],
        previewSections: [ghostSection],
      })
    );

    expect(html).toMatch(/<div class="flex items-center gap-1 shrink-0"><span[^>]*>\s*Preview\s*<\/span><\/div>/);
  });

  it("renders remark on conflicting blocks alongside AlertTriangle conflict indicator", () => {
    const sectionA = makeSection(
      101,
      201,
      "PETHREE",
      "Y16H",
      [makeBlock("SAT", 480, 600, "F2F", "R7B")],
      false,
      42,
      45,
      "PICKLEBALL"
    );
    const sectionB = makeSection(
      103,
      203,
      "PETHREE",
      "Y09J",
      [makeBlock("SAT", 480, 600, "F2F", "R804")],
      false,
      40,
      45,
      "SOCDANCE"
    );

    const conflicts = findConflicts([sectionA, sectionB]);
    expect(conflicts.length).toBe(1);

    const html = renderToStaticMarkup(
      React.createElement(WeekGrid, {
        sections: [sectionA, sectionB],
        conflicts,
      })
    );

    expect(html).toContain("PICKLEBALL");
    expect(html).toContain("SOCDANCE");
    expect(html).toContain("data-conflicting=\"true\"");
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
      // Anchored on the testid, not on an exact class string: the lattice
      // also fades when the grid is empty, and matching the className meant
      // this guard broke on a styling change rather than on a real one.
      const overflowStartIndex = html.indexOf('data-testid="week-grid-lattice"');
      const menuIndex = html.indexOf('data-testid="grid-context-menu"');
      expect(overflowStartIndex).toBeGreaterThan(-1);
      expect(menuIndex).toBeGreaterThan(-1);

      // The grid canvas and all schedule blocks precede the context menu
      const canvasStartIndex = html.indexOf('class="relative grid grid-cols-[48px_repeat(6,1fr)]');
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
  describe("the empty grid (ticket 50)", () => {
    it("fades the lattice back so the empty message carries the screen", () => {
      const html = renderToStaticMarkup(React.createElement(WeekGrid, { sections: [] }));

      const lattice = /<div[^>]*data-testid="week-grid-lattice"[^>]*>/.exec(html);
      expect(lattice, "the lattice must render").not.toBeNull();
      expect(lattice![0]).toMatch(/opacity-40/);
      expect(html).toContain('data-testid="week-grid-empty"');
    });

    it("keeps the message itself at full strength, outside the fade", () => {
      const html = renderToStaticMarkup(React.createElement(WeekGrid, { sections: [] }));

      // Dimming the root would dim the message along with the lattice.
      const lattice = html.indexOf('data-testid="week-grid-lattice"');
      const empty = html.indexOf('data-testid="week-grid-empty"');
      expect(empty).toBeGreaterThan(lattice);
      expect(html.slice(lattice, empty)).not.toContain("No sections yet");
    });

    it("does not fade a grid that has sections in it", () => {
      const section = makeSection(1, 1, "GEARTAP", "S01", [makeBlock("MON", 450, 540)]);
      const html = renderToStaticMarkup(
        React.createElement(WeekGrid, { sections: [section] })
      );

      const lattice = /<div[^>]*data-testid="week-grid-lattice"[^>]*>/.exec(html);
      expect(lattice![0]).not.toMatch(/opacity-/);
    });
  });

  describe("block entrance", () => {
    it("lands a committed block with the shared CSS entrance", () => {
      const section = makeSection(1, 1, "GEARTAP", "S01", [makeBlock("MON", 450, 540)]);
      const html = renderToStaticMarkup(
        React.createElement(WeekGrid, { sections: [section] })
      );

      expect(html).toContain("block-land");
    });

    it("never animates a conflicting block — a conflict is shown, not softened (ADR-0009)", () => {
      // Two overlapping sections: the second is hatched. The hatch appears
      // the instant it exists and must carry no entrance animation.
      const sectionA = makeSection(1, 1, "GEARTAP", "S01", [makeBlock("MON", 450, 540)]);
      const sectionB = makeSection(2, 2, "LBYJSWA", "S02", [makeBlock("MON", 480, 570)]);

      const html = renderToStaticMarkup(
        React.createElement(WeekGrid, { sections: [sectionA, sectionB] })
      );

      const conflicting = html
        .split("<div")
        .filter((chunk) => chunk.includes('data-conflicting="true"'));
      expect(conflicting.length).toBeGreaterThan(0);
      for (const chunk of conflicting) {
        expect(chunk).not.toContain("block-land");
      }
    });

    it("staggers the blocks within a day, capped, so a full grid is not still arriving", () => {
      // Six blocks on one day: each carries a `--stagger-delay`, and the
      // delay is computed from a capped step count in core/motion.ts rather
      // than growing with the size of the grid.
      const blocks = [
        makeBlock("MON", 450, 500),
        makeBlock("MON", 510, 560),
        makeBlock("MON", 570, 620),
        makeBlock("MON", 630, 680),
        makeBlock("MON", 690, 740),
        makeBlock("MON", 750, 800),
      ];
      const section = makeSection(1, 1, "GEARTAP", "S01", blocks);

      const html = renderToStaticMarkup(
        React.createElement(WeekGrid, { sections: [section] })
      );

      const delays = [...html.matchAll(/--stagger-delay:\s*(\d+)ms/g)].map((m) =>
        Number(m[1])
      );
      expect(delays.length).toBe(6);
      expect(Math.max(...delays)).toBeLessThanOrEqual(320);
      expect(new Set(delays).size).toBeGreaterThan(1);
    });

    it("keeps the entrance off the lattice, the day column, and the grid root", () => {
      // The three places a transform or an opacity would be fatal: the
      // lattice is a scroll container that would clip the portalled menu,
      // and a transform on a column or the root re-parents it (ticket 45).
      const section = makeSection(1, 1, "GEARTAP", "S01", [makeBlock("MON", 450, 540)]);
      const html = renderToStaticMarkup(
        React.createElement(WeekGrid, { sections: [section] })
      );

      const lattice = /<div[^>]*data-testid="week-grid-lattice"[^>]*>/.exec(html)![0];
      expect(lattice).not.toMatch(/block-land|transform|opacity/);

      const root = /<div[^>]*data-testid="week-grid"[^>]*>/.exec(html)![0];
      expect(root).not.toMatch(/block-land/);
    });

    it("still renders the portalled context menu outside the animated subtree", () => {
      // The regression this change could plausibly cause: an animated block
      // is inside the grid subtree, and if its animation left a transform or
      // an opacity anywhere on an ancestor, the `position: fixed` menu would
      // be trapped or mis-placed. Ordering is the assertion.
      const section = makeSection(1, 1, "GEARTAP", "S01", [makeBlock("MON", 450, 540)]);
      const html = renderToStaticMarkup(
        React.createElement(WeekGrid, {
          sections: [section],
          initialMenu: { section, block: section.blocks[0] },
        })
      );

      const menuIndex = html.indexOf('data-testid="grid-context-menu"');
      const canvasIndex = html.indexOf(
        'class="relative grid grid-cols-[48px_repeat(6,1fr)]'
      );
      expect(canvasIndex).toBeGreaterThan(-1);
      expect(menuIndex).toBeGreaterThan(canvasIndex);
      expect(html.slice(canvasIndex, menuIndex)).not.toContain(
        'data-testid="grid-context-menu"'
      );
    });
  });
});



