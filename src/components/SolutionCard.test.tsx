import { describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SolutionCard } from "./SolutionCard";
import solutionCardSource from "./SolutionCard.tsx?raw";
import type { Solution } from "../adapters/ipc/types";

describe("SolutionCard", () => {
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
      React.createElement(SolutionCard, {
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
      React.createElement(SolutionCard, {
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
      React.createElement(SolutionCard, {
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
      React.createElement(SolutionCard, {
        solution: mockSolution,
        rank: 1,
        onApply: vi.fn(),
      })
    );

    expect(html).toMatch(/apply|use this schedule/i);
  });

  it("says when a solution changes nothing, providing reassurance", () => {
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
          teacher: null,
          remark: null,
        },
      },
      {
        courseId: 564,
        courseCode: "CSINTSY",
        courseTitle: "Intro to AI",
        sectionId: 737,
        sectionCode: "Z01",
        pinned: false,
        missing: false,
        modality: "ONLINE" as const,
        blocks: [],
        latestSnapshot: {
          capturedAt: "2026-08-22T00:00:00Z",
          enrolled: 30,
          teacher: null,
          remark: null,
        },
      },
    ];

    const html = renderToStaticMarkup(
      React.createElement(SolutionCard, {
        solution: mockSolution,
        rank: 1,
        planSections,
        onApply: vi.fn(),
      })
    );

    expect(html).toContain("Changes nothing — keeps all 2 sections");
    expect(html).toContain("Applying this keeps all 2 of your chosen sections unchanged.");
  });

  it("displays moved section details when a solution would move unpinned sections", () => {
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
          teacher: null,
          remark: null,
        },
      },
      {
        courseId: 564,
        courseCode: "CSINTSY",
        courseTitle: "Intro to AI",
        sectionId: 730,
        sectionCode: "S10",
        pinned: false,
        missing: false,
        modality: "ONLINE" as const,
        blocks: [],
        latestSnapshot: {
          capturedAt: "2026-08-22T00:00:00Z",
          enrolled: 30,
          teacher: null,
          remark: null,
        },
      },
    ];

    const html = renderToStaticMarkup(
      React.createElement(SolutionCard, {
        solution: mockSolution,
        rank: 1,
        planSections,
        onApply: vi.fn(),
      })
    );

    expect(html).toContain("Moves 1 section, keeps 1");
    expect(html).toContain("CSINTSY");
    expect(html).toContain("moves S10 →");
    expect(html).toContain("Z01");
    expect(html).toContain("Applying this will move 1 of your 2 sections (CSINTSY S10 → Z01) and keep 1.");
  });

  it("visibly marks pinned sections as exempt", () => {
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
          teacher: null,
          remark: null,
        },
      },
    ];

    const html = renderToStaticMarkup(
      React.createElement(SolutionCard, {
        solution: mockSolution,
        rank: 1,
        planSections,
        onApply: vi.fn(),
      })
    );

    expect(html).toContain("exempt");
  });

  /**
   * Ticket 46 — a selected result is the one drawn on the real week grid, so
   * the card has to say which one that is even when it is also the top result.
   */
  describe("the card that is being previewed", () => {
    it("marks itself as selected", () => {
      const html = renderToStaticMarkup(
        React.createElement(SolutionCard, {
          solution: mockSolution,
          rank: 2,
          isSelected: true,
          onSelect: vi.fn(),
          onApply: vi.fn(),
        })
      );

      expect(html).toContain('data-selected="true"');
      expect(html).toMatch(/Previewing/);
    });

    it("still says so when the selected result is also the best match", () => {
      const html = renderToStaticMarkup(
        React.createElement(SolutionCard, {
          solution: mockSolution,
          rank: 1,
          isSelected: true,
          onSelect: vi.fn(),
          onApply: vi.fn(),
        })
      );

      expect(html).toContain('data-selected="true"');
      expect(html).toMatch(/Best match/);
      expect(html).toMatch(/Previewing/);
    });

    it("says nothing when it is not the one on the grid", () => {
      const html = renderToStaticMarkup(
        React.createElement(SolutionCard, {
          solution: mockSolution,
          rank: 1,
          onApply: vi.fn(),
        })
      );

      expect(html).not.toContain('data-selected="true"');
      expect(html).not.toMatch(/Previewing/);
    });
  });

  /**
   * Ticket 46 — these cards are listed one-per-row in a ~440px tool panel now,
   * not two-up in a 900px modal. `md:` and `sm:` key off the viewport, which
   * on the window the app opens at is four times the width of the column the
   * card is actually in.
   */
  describe("in a narrow column", () => {
    it("never lays itself out against the viewport it cannot see", () => {
      const html = renderToStaticMarkup(
        React.createElement(SolutionCard, {
          solution: mockSolution,
          rank: 1,
          onApply: vi.fn(),
        })
      );

      const offenders = (html.match(/class="([^"]*)"/g) ?? []).filter((c) =>
        /\b(sm|md|lg|xl|2xl):(grid-cols-[2-9]|flex-row|flex-nowrap)\b/.test(c)
      );

      expect(offenders, offenders.join(" | ")).toEqual([]);
    });

    it("keeps the rank, its badges, and Apply from colliding", () => {
      const html = renderToStaticMarkup(
        React.createElement(SolutionCard, {
          solution: mockSolution,
          rank: 1,
          isSelected: true,
          onSelect: vi.fn(),
          onApply: vi.fn(),
        })
      );

      // Apply sits on a row of its own under the identity block. Side by side
      // in a narrow card, "Best match" and "Previewing" rode over the button.
      const header = /<div[^>]*data-testid="solution-header"[^>]*>/.exec(html);
      expect(header).not.toBeNull();
      expect(header![0]).toMatch(/flex-col/);
      expect(header![0]).not.toMatch(/justify-between/);
    });

    it("lets a move row wrap instead of squeezing the section codes", () => {
      const html = renderToStaticMarkup(
        React.createElement(SolutionCard, {
          solution: mockSolution,
          rank: 1,
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
                teacher: null,
                remark: null,
              },
            },
          ],
          onApply: vi.fn(),
        })
      );

      const move = /<li[^>]*data-testid="moved-section"[^>]*>/.exec(html);
      expect(move).not.toBeNull();
      expect(move![0]).toMatch(/flex-wrap/);
    });
  });

  /**
   * Ticket 46, second pass — the card stops trying to be the schedule.
   *
   * A six-column week grid with course code, section code, and modality
   * inside 26px blocks is unreadable in a 400px column: the blocks overlapped
   * their own labels. Ticket 46 already said what replaces it — "a
   * highlighted solution previews on the real week grid instead of a
   * thumbnail... comparing twenty candidate schedules at full size rather
   * than squinting at cards".
   *
   * So the card keeps the one thing a thumbnail is genuinely good at — the
   * *shape* of the week, which days are loaded and which are free — and hands
   * every detail to the real grid.
   */
  describe("the week shape", () => {
    it("draws one bar per block, naming the subject and nothing else", () => {
      const html = renderToStaticMarkup(
        React.createElement(SolutionCard, {
          solution: mockSolution,
          rank: 1,
          onApply: vi.fn(),
        })
      );

      const shape = html.slice(
        html.indexOf('data-testid="week-shape"'),
        html.indexOf('data-testid="solution-sections"')
      );
      expect(shape, "the card must still say what shape the week is").not.toBe("");

      const bars = html.match(/data-testid="week-shape-bar"/g) ?? [];
      const blocks = mockSolution.sections.flatMap((s) => s.blocks);
      expect(bars).toHaveLength(blocks.length);

      // The subject is what a student scans for. Section code, room, and
      // modality stay in the hover title and on the real grid, so the check
      // is on what is *drawn*, with attributes stripped out.
      const drawn = shape.replace(/<[^>]*>/g, " ");
      expect(drawn).toContain("GEARTAP");
      expect(drawn).not.toContain("S11");
      expect(drawn).not.toMatch(/F2F|ONL|L226/);
    });

    it("gives a bar enough height to read the subject on", () => {
      const html = renderToStaticMarkup(
        React.createElement(SolutionCard, {
          solution: mockSolution,
          rank: 1,
          onApply: vi.fn(),
        })
      );

      const bar = /<div[^>]*data-testid="week-shape-bar"[^>]*style="([^"]*)"/.exec(html);
      expect(bar).not.toBeNull();
      const minHeight = /min-height:\s*(\d+)px/.exec(bar![1]);
      expect(minHeight, "a bar carrying a word needs a floor").not.toBeNull();
      expect(Number(minHeight![1])).toBeGreaterThanOrEqual(16);
    });

    it("still names the days, because which day is the whole question", () => {
      const html = renderToStaticMarkup(
        React.createElement(SolutionCard, {
          solution: mockSolution,
          rank: 1,
          onApply: vi.fn(),
        })
      );

      const shape = html.slice(html.indexOf('data-testid="week-shape"'));
      expect(shape).toContain("Mon");
      expect(shape).toContain("Sat");
    });
  });

  describe("previewing on the real grid", () => {
    it("offers an explicit control rather than making the whole card a target", () => {
      const html = renderToStaticMarkup(
        React.createElement(SolutionCard, {
          solution: mockSolution,
          rank: 1,
          onSelect: vi.fn(),
          onApply: vi.fn(),
        })
      );

      const preview = /<button[^>]*data-testid="preview-solution"[^>]*>[\s\S]*?<\/button>/.exec(
        html
      );
      expect(preview, "previewing must be something you press").not.toBeNull();
      expect(preview![0]).toContain("Preview");
    });

    it("says it is the one on the grid while it is", () => {
      const html = renderToStaticMarkup(
        React.createElement(SolutionCard, {
          solution: mockSolution,
          rank: 1,
          isSelected: true,
          onSelect: vi.fn(),
          onApply: vi.fn(),
        })
      );

      const preview = /<button[^>]*data-testid="preview-solution"[^>]*>[\s\S]*?<\/button>/.exec(
        html
      );
      expect(preview![0]).toContain("Previewing");
    });

    it("never makes the card body itself change what is on the grid", () => {
      // A card you can nudge into repainting the whole week is the opposite
      // of smooth. Static markup cannot click, so this is a source guard.
      const root = solutionCardSource.slice(
        solutionCardSource.indexOf("data-testid={`solution-card-"),
        solutionCardSource.indexOf("data-testid=\"solution-header\"")
      );
      expect(root, "the card root must not be a click target").not.toContain("onClick");
    });
  });

  describe("the advisory", () => {
    it("says each piece of advice once and lists when it applies", () => {
      const html = renderToStaticMarkup(
        React.createElement(SolutionCard, {
          solution: {
            ...mockSolution,
            warnings: [
              {
                kind: "f2f_f2f_different_buildings" as const,
                day: "MON" as const,
                startMin: 750,
                endMin: 765,
                from: { courseId: 1, sectionId: 1 },
                to: { courseId: 2, sectionId: 2 },
              },
              {
                kind: "f2f_f2f_different_buildings" as const,
                day: "THU" as const,
                startMin: 750,
                endMin: 765,
                from: { courseId: 1, sectionId: 1 },
                to: { courseId: 2, sectionId: 2 },
              },
            ],
          },
          rank: 1,
          onApply: vi.fn(),
        })
      );

      const advisory = html.slice(html.indexOf('data-testid="solution-advisory"'));
      // One sentence, not one per day.
      expect(advisory.match(/different buildings/g)).toHaveLength(1);
      expect(advisory).toContain("MON 12:30–12:45");
      expect(advisory).toContain("THU 12:30–12:45");
    });

    it("stays advisory and never reads as an error (ADR-0009)", () => {
      const html = renderToStaticMarkup(
        React.createElement(SolutionCard, {
          solution: {
            ...mockSolution,
            warnings: [
              {
                kind: "f2f_online_back_to_back" as const,
                day: "MON" as const,
                startMin: 960,
                endMin: 975,
                from: { courseId: 1, sectionId: 1 },
                to: { courseId: 2, sectionId: 2 },
              },
            ],
          },
          rank: 1,
          onApply: vi.fn(),
        })
      );

      const advisory = html.slice(html.indexOf('data-testid="solution-advisory"'));
      expect(advisory).toContain("Advisory");
      expect(advisory).not.toMatch(/text-red-|bg-red-|border-red-/);
    });
  });
});
