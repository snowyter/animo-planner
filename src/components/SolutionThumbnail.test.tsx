import { describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SolutionThumbnail } from "./SolutionThumbnail";
import type { Solution } from "../adapters/ipc/types";

describe("SolutionThumbnail", () => {
  const mockSolution: Solution = {
    id: "solution-0",
    score: 125,
    breakdown: [
      { label: "Fewest campus days", points: 80 },
      { label: "Online bonus", points: 45 },
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
          {
            day: "THU",
            startMin: 450,
            endMin: 540,
            modality: "ONLINE",
            location: null,
          },
        ],
      },
      {
        courseId: 564,
        courseCode: "CSINTSY",
        sectionId: 737,
        sectionCode: "Z01",
        pinned: false,
        blocks: [
          {
            day: "TUE",
            startMin: 555,
            endMin: 645,
            modality: "ONLINE",
            location: null,
          },
        ],
      },
    ],
  };

  it("renders solution score and breakdown items", () => {
    const html = renderToStaticMarkup(
      React.createElement(SolutionThumbnail, {
        solution: mockSolution,
        rank: 1,
        onApply: vi.fn(),
      })
    );

    expect(html).toContain("125");
    expect(html).toContain("Fewest campus days: +80");
    expect(html).toContain("Online bonus: +45");
  });

  it("renders compact week grid with course codes and section codes", () => {
    const html = renderToStaticMarkup(
      React.createElement(SolutionThumbnail, {
        solution: mockSolution,
        rank: 1,
        onApply: vi.fn(),
      })
    );

    expect(html).toContain("GEARTAP");
    expect(html).toContain("S11");
    expect(html).toContain("CSINTSY");
    expect(html).toContain("Z01");
    // Day headers
    expect(html).toContain("Mon");
    expect(html).toContain("Tue");
    expect(html).toContain("Wed");
    expect(html).toContain("Thu");
    expect(html).toContain("Fri");
    expect(html).toContain("Sat");
  });

  it("displays advisory warnings when present", () => {
    const solutionWithWarning: Solution = {
      ...mockSolution,
      warnings: [
        {
          kind: "f2f_online_back_to_back",
          day: "MON",
          startMin: 540,
          endMin: 555,
          from: { courseId: 2923, sectionId: 384 },
          to: { courseId: 564, sectionId: 737 },
        },
      ],
    };

    const html = renderToStaticMarkup(
      React.createElement(SolutionThumbnail, {
        solution: solutionWithWarning,
        rank: 1,
        onApply: vi.fn(),
      })
    );

    expect(html).toContain("F2F → Online back-to-back");
    expect(html).toContain("MON");
  });

  it("renders Apply button to apply solution to plan", () => {
    const html = renderToStaticMarkup(
      React.createElement(SolutionThumbnail, {
        solution: mockSolution,
        rank: 1,
        onApply: vi.fn(),
      })
    );

    expect(html).toMatch(/apply|use this schedule/i);
  });
});
