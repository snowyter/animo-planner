import { beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SolvePanel } from "./SolvePanel";
import type { Solution, SolveResult } from "../adapters/ipc/types";

vi.mock("../adapters/ipc/client", () => ({
  solvePlan: vi.fn(),
  continueSolve: vi.fn(),
  cancelSolve: vi.fn(),
  applySolution: vi.fn(),
}));


/**
 * Unwraps a capture group an assertion above guarantees was matched —
 * the proof that no non-null assertion is needed anywhere in this suite.
 */
function matchGroup(match: RegExpExecArray | RegExpMatchArray | null, index: number): string {
  if (!match?.[index]) throw new Error("expected a regexp match");
  return match[index] as string;
}

describe("SolvePanel", () => {
  const planId = "plan-1";

  const mockSolution: Solution = {
    id: "solution-0",
    score: 150,
    breakdown: [
      { label: "Fewest campus days", points: 100 },
      { label: "Online bonus", points: 50 },
    ],
    warnings: [],
    sections: [
      {
        courseId: 2923,
        courseCode: "GEARTAP",
        sectionId: 384,
        sectionCode: "S11",
        pinned: true,
        blocks: [
          {
            day: "MON",
            startMin: 450,
            endMin: 540,
            modality: "F2F",
            location: "L226",
          },
        ],
      },
    ],
  };

  const mockSolveResult: SolveResult = {
    status: "complete",
    solutions: [mockSolution],
    resumeToken: null,
    unsatisfiableCourses: [],
    excludedFullCount: 0,
    snapshotTakenAt: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the primary preset options", () => {
    const html = renderToStaticMarkup(
      React.createElement(SolvePanel, {
        planId,
        onPlanUpdated: vi.fn(),
      })
    );

    expect(html).toContain("Fewest campus days");
    expect(html).toContain("No early mornings");
    expect(html).toContain("Most online");
  });

  it("renders secondary constraint options (day blacklist, time bounds, exclude full)", () => {
    const html = renderToStaticMarkup(
      React.createElement(SolvePanel, {
        planId,
        defaultShowConstraints: true,
        onPlanUpdated: vi.fn(),
      })
    );

    expect(html).toContain("Exclude full sections");
    expect(html).toContain("Earliest start");
    expect(html).toContain("Latest end");
    expect(html).toContain("Monday");
    expect(html).toContain("Saturday");
  });

  it("renders solutions and score breakdown when results exist", () => {
    const html = renderToStaticMarkup(
      React.createElement(SolvePanel, {
        planId,
        initialResult: mockSolveResult,
        onPlanUpdated: vi.fn(),
      })
    );

    expect(html).toContain("Schedule #1");
    expect(html).toContain("150");
    expect(html).toContain("Fewest campus days: +100");
    expect(html).toContain("GEARTAP");
  });

  it("renders partial search banner with Keep searching button on partial status", () => {
    const partialResult: SolveResult = {
      status: "partial",
      solutions: [mockSolution],
      resumeToken: "token-resume-123",
      unsatisfiableCourses: [],
      excludedFullCount: 0,
      snapshotTakenAt: null,
    };

    const html = renderToStaticMarkup(
      React.createElement(SolvePanel, {
        planId,
        initialResult: partialResult,
        onPlanUpdated: vi.fn(),
      })
    );

    expect(html).toContain("Search reached node limit");
    expect(html).toContain("Keep searching");
  });

  it("surfaces the exclusion count and the numbers' age when sections were excluded (ticket 34)", () => {
    const excludingResult: SolveResult = {
      ...mockSolveResult,
      excludedFullCount: 3,
      snapshotTakenAt: "2026-08-22T10:00:00Z",
    };

    const html = renderToStaticMarkup(
      React.createElement(SolvePanel, {
        planId,
        initialResult: excludingResult,
        onPlanUpdated: vi.fn(),
      })
    );

    expect(html).toContain("Excluded 3 full sections");
    expect(html).toContain("2026");
  });

  it("renders no exclusion notice when nothing was excluded", () => {
    const html = renderToStaticMarkup(
      React.createElement(SolvePanel, {
        planId,
        initialResult: mockSolveResult,
        onPlanUpdated: vi.fn(),
      })
    );

    expect(html).not.toContain("Excluded");
  });

  it("names the unsatisfiable courses when no solutions are found", () => {
    const unsatisfiableResult: SolveResult = {
      status: "unsatisfiable",
      solutions: [],
      resumeToken: null,
      unsatisfiableCourses: [{ courseId: 2923, code: "GEARTAP", reason: "all_sections_full" }],
      excludedFullCount: 2,
      snapshotTakenAt: "2026-08-22T10:00:00Z",
    };

    const html = renderToStaticMarkup(
      React.createElement(SolvePanel, {
        planId,
        initialResult: unsatisfiableResult,
        onPlanUpdated: vi.fn(),
      })
    );

    expect(html).toContain("GEARTAP");
    expect(html).toContain("every section is full");
    expect(html).toContain("Excluded 2 full sections");
  });

  it("clarifies in the panel that pinned sections are fixed and unpinned can move", () => {
    const html = renderToStaticMarkup(
      React.createElement(SolvePanel, {
        planId,
        onPlanUpdated: vi.fn(),
      })
    );

    expect(html).toContain("Pinned sections are fixed and never moved");
    expect(html).toContain("unpinned sections may be moved");
  });

  it("renders current plan sections with pinned exemption status and reachable pin toggles", () => {
    const planSections = [
      {
        courseId: 2923,
        courseCode: "GEARTAP",
        courseTitle: "Great Books",
        sectionId: 384,
        sectionCode: "S11",
        pinned: true,
        missing: false,
        modality: "F2F" as const,
        blocks: [],
        latestSnapshot: {
          capturedAt: "2026-08-22T00:00:00Z",
          enrolled: 30,
          professor: null,
          remark: null,
        },
      },
      {
        courseId: 564,
        courseCode: "CSINTSY",
        courseTitle: "Intro to AI",
        sectionId: 737,
        sectionCode: "S10",
        pinned: false,
        missing: false,
        modality: "ONLINE" as const,
        blocks: [],
        latestSnapshot: {
          capturedAt: "2026-08-22T00:00:00Z",
          enrolled: 30,
          professor: null,
          remark: null,
        },
      },
    ];

    const html = renderToStaticMarkup(
      React.createElement(SolvePanel, {
        planId,
        planSections,
        initialResult: mockSolveResult,
        onPlanUpdated: vi.fn(),
      })
    );

    expect(html).toContain("Your Plan Sections");
    expect(html).toContain("Pinned sections are exempt from moving");
    expect(html).toContain("GEARTAP");
    expect(html).toContain("S11");
    expect(html).toContain("Pinned (Exempt)");
    expect(html).toContain("CSINTSY");
    expect(html).toContain("S10");
    expect(html).toContain("Unpinned");
  });

  it("passes planSections to solution thumbnails to show what moves and what stays", () => {
    const planSections = [
      {
        courseId: 2923,
        courseCode: "GEARTAP",
        courseTitle: "Great Books",
        sectionId: 380,
        sectionCode: "S09",
        pinned: false,
        missing: false,
        modality: "F2F" as const,
        blocks: [],
        latestSnapshot: {
          capturedAt: "2026-08-22T00:00:00Z",
          enrolled: 30,
          professor: null,
          remark: null,
        },
      },
    ];

    const html = renderToStaticMarkup(
      React.createElement(SolvePanel, {
        planId,
        planSections,
        initialResult: mockSolveResult,
        onPlanUpdated: vi.fn(),
      })
    );

    // mockSolveResult has GEARTAP S11; plan has GEARTAP S09
    expect(html).toContain("moves S09 →");
    expect(html).toContain("S11");
    expect(html).toContain("Applying this will move your 1 section (GEARTAP S09 → S11).");
  });

  /**
   * Ticket 46 — the solver leaves the modal.
   *
   * It becomes the Solve tab, and a highlighted solution previews on the real
   * week grid rather than a thumbnail. That is the upgrade the restructure
   * buys: comparing candidates at full size instead of squinting at cards.
   */
  describe("as a panel rather than a modal", () => {
    it("renders inline, with nothing to dismiss", () => {
      const html = renderToStaticMarkup(
        React.createElement(SolvePanel, {
          planId,
          initialResult: mockSolveResult,
          onPlanUpdated: vi.fn(),
        })
      );

      expect(html).toContain('data-testid="solve-panel"');
      expect(html).not.toContain('role="dialog"');
      expect(html).not.toContain("dialog-overlay");
    });

    it("marks the solution being previewed on the grid", () => {
      const html = renderToStaticMarkup(
        React.createElement(SolvePanel, {
          planId,
          initialResult: mockSolveResult,
          selectedSolutionId: "solution-0",
          onSelectSolution: vi.fn(),
          onPlanUpdated: vi.fn(),
        })
      );

      expect(html).toMatch(/data-selected="true"/);
    });

    it("leaves nothing marked when no solution is selected", () => {
      const html = renderToStaticMarkup(
        React.createElement(SolvePanel, {
          planId,
          initialResult: mockSolveResult,
          selectedSolutionId: null,
          onSelectSolution: vi.fn(),
          onPlanUpdated: vi.fn(),
        })
      );

      expect(html).not.toMatch(/data-selected="true"/);
    });

    it("offers Continue when the search stopped at the node cap", () => {
      const partial: SolveResult = {
        ...mockSolveResult,
        status: "partial",
        resumeToken: "token-resume-123",
      };

      const html = renderToStaticMarkup(
        React.createElement(SolvePanel, {
          planId,
          initialResult: partial,
          onPlanUpdated: vi.fn(),
        })
      );

      const panel = html.slice(html.indexOf('data-testid="solve-panel"'));
      expect(panel).toContain("Keep searching");
      expect(panel).toContain("Search reached node limit");
    });

    it("shows progress and Cancel in the panel while the search runs", () => {
      const html = renderToStaticMarkup(
        React.createElement(SolvePanel, {
          planId,
          initialResult: mockSolveResult,
          initialIsSolving: true,
          onPlanUpdated: vi.fn(),
        })
      );

      const panel = html.slice(html.indexOf('data-testid="solve-panel"'));
      expect(panel).toContain("Searching combinations");
      expect(panel).toContain('data-testid="solve-cancel"');
    });

    it("says what applying would do before it happens (ticket 43)", () => {
      const planSections = [
        {
          courseId: 2923,
          courseCode: "GEARTAP",
          courseTitle: "Great Books",
          sectionId: 380,
          sectionCode: "S09",
          pinned: false,
          missing: false,
          modality: "F2F" as const,
          blocks: [],
          latestSnapshot: {
            capturedAt: "2026-08-22T00:00:00Z",
            enrolled: 30,
            professor: null,
            remark: null,
          },
        },
      ];

      const html = renderToStaticMarkup(
        React.createElement(SolvePanel, {
          planId,
          planSections,
          initialResult: mockSolveResult,
          onPlanUpdated: vi.fn(),
        })
      );

      expect(html).toContain("Applying this will move your 1 section (GEARTAP S09 → S11).");
      expect(html).toContain("Pinned sections are exempt from moving");
    });
  });

});

/**
 * Ticket 46 — this surface lives in a ~440px tool panel beside the week grid,
 * and Tailwind's `sm:` / `md:` / `lg:` prefixes key off the *viewport*, not off
 * the column the markup is actually in. On the 1400px window the app opens at,
 * every one of them fires inside a 440px column: the capture panel put its
 * text and its buttons on one row and crushed the paragraph to one word per
 * line, the solver laid three preset cards side by side, and the result cards
 * overlapped their own Apply button.
 *
 * Nothing here may go horizontal on a viewport breakpoint. The panel's width
 * has nothing to do with the window's.
 */
const GOES_HORIZONTAL_ON_VIEWPORT =
  /\b(sm|md|lg|xl|2xl):(grid-cols-[2-9]|flex-row|flex-nowrap)\b/;

describe("the solve panel in a narrow column", () => {
  const planId = "plan-1";

  const mockSolveResult: SolveResult = {
    status: "complete",
    solutions: [
      {
        id: "solution-0",
        score: 150,
        breakdown: [{ label: "Fewest campus days", points: 100 }],
        warnings: [],
        sections: [
          {
            courseId: 2923,
            courseCode: "GEARTAP",
            sectionId: 384,
            sectionCode: "S11",
            pinned: true,
            blocks: [
              {
                day: "MON",
                startMin: 450,
                endMin: 540,
                modality: "F2F",
                location: "L226",
              },
            ],
          },
        ],
      },
    ],
    resumeToken: null,
    unsatisfiableCourses: [],
    excludedFullCount: 0,
    snapshotTakenAt: null,
  };

  it("never lays itself out against the viewport it cannot see", () => {
    const html = renderToStaticMarkup(
      React.createElement(SolvePanel, {
        planId,
        planSections: [
          {
            courseId: 2923,
            courseCode: "GEARTAP",
            courseTitle: "Great Books",
            sectionId: 380,
            sectionCode: "S09",
            pinned: false,
            missing: false,
            modality: "F2F" as const,
            blocks: [],
            latestSnapshot: {
              capturedAt: "2026-08-22T00:00:00Z",
              enrolled: 30,
              professor: null,
              remark: null,
            },
          },
        ],
        initialResult: mockSolveResult,
        defaultShowConstraints: true,
        onPlanUpdated: vi.fn(),
      })
    );

    const offenders = (html.match(/class="([^"]*)"/g) ?? []).filter((c) =>
      GOES_HORIZONTAL_ON_VIEWPORT.test(c)
    );

    expect(offenders, offenders.join(" | ")).toEqual([]);
  });

  it("keeps the exclude-full constraint on one line, where it reads as one thing", () => {
    const html = renderToStaticMarkup(
      React.createElement(SolvePanel, {
        planId,
        initialResult: mockSolveResult,
        defaultShowConstraints: true,
        onPlanUpdated: vi.fn(),
      })
    );

    // "Exclude full sections (enrolled >= capacity)" wrapped to two lines
    // beside the solve button and stopped reading as a single label. The
    // qualifier moves to its own muted line under it.
    const label = /<label[^>]*data-testid="exclude-full-label"[^>]*>[\s\S]*?<\/label>/.exec(
      html
    );
    expect(label).not.toBeNull();
    expect(matchGroup(label, 0)).toContain("Exclude full sections");
    expect(matchGroup(label, 0)).not.toContain("(enrolled");
    expect(html).toContain("Enrolled is at or over capacity");
  });

  describe("the Priority control (ticket 49, ADR-0021)", () => {
    const renderPanel = (props: Record<string, unknown> = {}) =>
      renderToStaticMarkup(
        React.createElement(SolvePanel, {
          planId,
          initialResult: mockSolveResult,
          onPlanUpdated: vi.fn(),
          ...props,
        })
      );

    it("sits with the other constraints, offering Schedule, Professors and Hybrid", () => {
      const html = renderPanel();

      expect(html).toContain('data-testid="solve-priority"');
      expect(html).toContain("Schedule");
      expect(html).toContain("Professors");
      expect(html).toContain("Hybrid");
    });

    it("defaults to Schedule, which is exactly today's behaviour", () => {
      const html = renderPanel();

      expect(html).toMatch(/data-priority="schedule"[^>]*data-priority-selected="true"/);
      expect(html).toMatch(/data-priority="professors"[^>]*data-priority-selected="false"/);
    });

    it("summarises the preferences read-only, and points back at where they are made", () => {
      const html = renderPanel({
        preferenceSummary: { rankedCourses: 3, avoidedProfessors: 2 },
      });

      expect(html).toContain("3 courses ranked · 2 professors avoided");
      expect(html).toContain('data-testid="solve-priority-summary-link"');
    });

    it("says a ranking is being ignored under Schedule, and offers the switch", () => {
      const html = renderPanel({
        preferenceSummary: { rankedCourses: 3, avoidedProfessors: 2 },
      });

      expect(html).toContain('data-testid="priority-noop-warning"');
      expect(html).toContain("being ignored");
      expect(html).toContain('data-testid="priority-noop-switch"');
    });

    it("stays quiet when there is nothing to ignore, or when the priority already uses it", () => {
      expect(renderPanel()).not.toContain('data-testid="priority-noop-warning"');
      expect(
        renderPanel({
          preferenceSummary: { rankedCourses: 3, avoidedProfessors: 2 },
          initialPriority: "professors",
        })
      ).not.toContain('data-testid="priority-noop-warning"');
    });
  });
});
