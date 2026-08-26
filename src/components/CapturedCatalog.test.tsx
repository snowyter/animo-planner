import { describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CapturedCatalog } from "./CapturedCatalog";
import type { CapturedCourse } from "../adapters/ipc/types";

describe("CapturedCatalog", () => {
  const now = new Date("2026-08-22T12:00:00Z");

  const courses: CapturedCourse[] = [
    {
      courseId: 2923,
      code: "GEARTAP",
      title: "Art Appreciation",
      sectionCount: 42,
      firstSeenAt: "2026-08-20T09:00:00Z",
      lastSeenAt: "2026-08-22T11:45:00Z",
      included: true,
      lastRefreshedAt: null,
    },
    {
      courseId: 564,
      code: "CSINTSY",
      title: "Introduction to Intelligent Systems",
      sectionCount: 5,
      firstSeenAt: "2026-08-20T09:00:00Z",
      lastSeenAt: "2026-08-20T12:00:00Z",
      included: true,
      lastRefreshedAt: null,
    },
  ];

  it("names every captured course with its section count", () => {
    const html = renderToStaticMarkup(
      React.createElement(CapturedCatalog, { courses, now })
    );

    expect(html).toContain("GEARTAP");
    expect(html).toContain("Art Appreciation");
    expect(html).toContain("42 sections");
    expect(html).toContain("CSINTSY");
    expect(html).toContain("5 sections");
  });

  it("says how fresh each capture is, because enrolment counts move", () => {
    const html = renderToStaticMarkup(
      React.createElement(CapturedCatalog, { courses, now })
    );

    expect(html).toContain("captured 15m ago");
    expect(html).toContain("captured 2d ago");
  });

  it("totals the catalog so the tab agrees with the counter beside it", () => {
    const html = renderToStaticMarkup(
      React.createElement(CapturedCatalog, { courses, now })
    );

    expect(html).toContain("2 courses");
    expect(html).toContain("47 sections");
  });

  it("names the next action when nothing has landed", () => {
    const html = renderToStaticMarkup(
      React.createElement(CapturedCatalog, { courses: [], now })
    );

    expect(html).toContain('data-testid="captured-catalog-empty"');
    expect(html).toMatch(/Open Archer/i);
    expect(html).toMatch(/Course Finder/);
  });

  it("draws the shape of the incoming rows while loading, never a spinner", () => {
    const html = renderToStaticMarkup(
      React.createElement(CapturedCatalog, { courses: [], isLoading: true, now })
    );

    expect(html).toContain('data-testid="captured-catalog-skeleton"');
    expect(html).not.toContain("animate-spin");
  });

  it("offers a way into the tab that browses a course's sections", () => {
    const html = renderToStaticMarkup(
      React.createElement(CapturedCatalog, {
        courses,
        now,
        onBrowseCourse: vi.fn(),
      })
    );

    expect(html).toContain('data-testid="captured-course-2923"');
    expect(html).toMatch(/Browse GEARTAP in the Pick tab/);
  });

  it("offers no browse control when there is nowhere to go", () => {
    const html = renderToStaticMarkup(
      React.createElement(CapturedCatalog, { courses, now })
    );

    expect(html).not.toMatch(/Browse GEARTAP/);
  });

  /**
   * The Capture tab is where the catalog is managed, not merely listed.
   */
  describe("managing a captured course", () => {
    it("says which act produced the numbers, and how long ago", () => {
      // A refresh writes both stamps from the same instant, which is what
      // makes it the later act and therefore the one worth naming.
      const refreshed: CapturedCourse[] = [
        {
          ...courses[0],
          lastSeenAt: "2026-08-22T10:00:00Z",
          lastRefreshedAt: "2026-08-22T10:00:00Z",
        },
        courses[1],
      ];

      const html = renderToStaticMarkup(
        React.createElement(CapturedCatalog, { courses: refreshed, now })
      );

      expect(html).toContain("refreshed 2h ago");
      expect(html).toContain("captured 2d ago");
    });

    it("offers to forget a course from the catalog", () => {
      const html = renderToStaticMarkup(
        React.createElement(CapturedCatalog, {
          courses,
          now,
          onRemoveCourse: vi.fn(),
        })
      );

      const remove = /<button[^>]*data-testid="forget-course-2923"[^>]*>/.exec(html);
      expect(remove, "the catalog is where a course is removed from").not.toBeNull();
      expect(html).toMatch(/Remove GEARTAP from the captured catalog/);
    });

    it("offers no remove control when there is nothing to remove it with", () => {
      const html = renderToStaticMarkup(
        React.createElement(CapturedCatalog, { courses, now })
      );

      expect(html).not.toContain('data-testid="forget-course-2923"');
    });

    it("checks a course the student intends to enrol in", () => {
      const html = renderToStaticMarkup(
        React.createElement(CapturedCatalog, {
          courses,
          now,
          onSetIncluded: vi.fn(),
        })
      );

      const box = /<input[^>]*data-testid="include-course-2923"[^>]*>/.exec(html);
      expect(box).not.toBeNull();
      expect(box![0]).toContain('type="checkbox"');
      expect(box![0]).toContain('checked=""');
      expect(box![0]).toMatch(/aria-label="[^"]*GEARTAP[^"]*"/);
    });

    it("leaves an excluded course unchecked but still listed", () => {
      const html = renderToStaticMarkup(
        React.createElement(CapturedCatalog, {
          courses: [{ ...courses[0], included: false }, courses[1]],
          now,
          onSetIncluded: vi.fn(),
        })
      );

      const box = /<input[^>]*data-testid="include-course-2923"[^>]*>/.exec(html);
      expect(box![0]).not.toContain('checked=""');
      // Excluding is not forgetting: it is still in the catalog, still counted.
      expect(html).toContain("GEARTAP");
      expect(html).toContain("42 sections");
      expect(html).toContain("47 sections");
    });

    it("says what the checkbox is for, once, rather than on every row", () => {
      const html = renderToStaticMarkup(
        React.createElement(CapturedCatalog, {
          courses,
          now,
          onSetIncluded: vi.fn(),
        })
      );

      expect(html).toMatch(/Checked courses are the ones the solver fills/i);
    });
  });
});
