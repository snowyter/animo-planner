import { beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SolveDialog } from "./SolveDialog";
import type { Solution, SolveResult } from "../adapters/ipc/types";

vi.mock("../adapters/ipc/client", () => ({
  solvePlan: vi.fn(),
  continueSolve: vi.fn(),
  cancelSolve: vi.fn(),
  applySolution: vi.fn(),
}));

describe("SolveDialog", () => {
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
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the primary preset options", () => {
    const html = renderToStaticMarkup(
      React.createElement(SolveDialog, {
        open: true,
        onOpenChange: vi.fn(),
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
      React.createElement(SolveDialog, {
        open: true,
        onOpenChange: vi.fn(),
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
      React.createElement(SolveDialog, {
        open: true,
        onOpenChange: vi.fn(),
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
    };

    const html = renderToStaticMarkup(
      React.createElement(SolveDialog, {
        open: true,
        onOpenChange: vi.fn(),
        planId,
        initialResult: partialResult,
        onPlanUpdated: vi.fn(),
      })
    );

    expect(html).toContain("Search reached node limit");
    expect(html).toContain("Keep searching");
  });

  it("names the unsatisfiable courses when no solutions are found", () => {
    const unsatisfiableResult: SolveResult = {
      status: "unsatisfiable",
      solutions: [],
      resumeToken: null,
      unsatisfiableCourses: [{ courseId: 2923, code: "GEARTAP" }],
    };

    const html = renderToStaticMarkup(
      React.createElement(SolveDialog, {
        open: true,
        onOpenChange: vi.fn(),
        planId,
        initialResult: unsatisfiableResult,
        onPlanUpdated: vi.fn(),
      })
    );

    expect(html).toContain("GEARTAP");
    expect(html).toContain("could not be satisfied");
  });
});
