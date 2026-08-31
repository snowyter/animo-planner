import { describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CaptureBar } from "./CaptureBar";
import type { CaptureSummary } from "../adapters/ipc/types";


/**
 * Unwraps a capture group an assertion above guarantees was matched —
 * the proof that no non-null assertion is needed anywhere in this suite.
 */
function matchGroup(match: RegExpExecArray | RegExpMatchArray | null, index: number): string {
  if (!match?.[index]) throw new Error("expected a regexp match");
  return match[index] as string;
}

describe("CaptureBar", () => {
  const defaultProps = {
    campusId: 7,
    sessionId: 155,
    summary: {
      campusId: 7,
      sessionId: 155,
      sectionCount: 42,
      courseCount: 8,
    } as CaptureSummary,
    isLoading: false,
    error: null,
    captureFailure: null,
    isOpening: false,
    onOpenCapture: vi.fn(),
    onDismissFailure: vi.fn(),
    onReportBrokenCapture: vi.fn(),
  };

  it("tells the student plainly before opening that they sign in to university site and app never stores credentials", () => {
    const html = renderToStaticMarkup(
      React.createElement(CaptureBar, defaultProps)
    );

    expect(html).toContain("Archer&#x27;s Hub");
    expect(html).toContain("never");
    expect(html).toMatch(/never (?:sees, captures, or )?stores (?:your )?credentials/i);
  });

  it("renders running counter in the form 'N sections from M courses'", () => {
    const html = renderToStaticMarkup(
      React.createElement(CaptureBar, {
        ...defaultProps,
        summary: {
          campusId: 7,
          sessionId: 155,
          sectionCount: 42,
          courseCount: 8,
        },
      })
    );

    expect(html).toContain("42 sections from 8 courses");
  });

  it("renders 0 sections from 0 courses when summary is empty or null", () => {
    const html = renderToStaticMarkup(
      React.createElement(CaptureBar, {
        ...defaultProps,
        summary: null,
      })
    );

    expect(html).toContain("0 sections from 0 courses");
  });

  it("renders open Archer's Hub button scoped to campus and session", () => {
    const html = renderToStaticMarkup(
      React.createElement(CaptureBar, defaultProps)
    );

    expect(html).toContain("Open Archer&#x27;s Hub");
  });

  it("renders visible non-blocking notice with route to report flow when captureFailure is present", () => {
    const errorMessage = "Unrecognized table structure in Course Finder response";
    const html = renderToStaticMarkup(
      React.createElement(CaptureBar, {
        ...defaultProps,
        captureFailure: errorMessage,
      })
    );

    expect(html).toContain(errorMessage);
    expect(html).toMatch(/Report broken capture|Report issue/i);
    expect(html).toContain("Dismiss");
  });

  it("does not render failure notice when captureFailure is null", () => {
    const html = renderToStaticMarkup(
      React.createElement(CaptureBar, {
        ...defaultProps,
        captureFailure: null,
      })
    );

    expect(html).not.toContain("Report broken capture");
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

describe("the capture panel in a narrow column", () => {
  const panelProps = {
    campusId: 7,
    sessionId: 155,
    summary: {
      campusId: 7,
      sessionId: 155,
      sectionCount: 98,
      courseCount: 6,
    } as CaptureSummary,
    isLoading: false,
    error: null,
    captureFailure: null,
    isOpening: false,
    render: "controls" as const,
    onRefresh: vi.fn(),
    onOpenCapture: vi.fn(),
    onDismissFailure: vi.fn(),
  };

  it("never lays itself out against the viewport it cannot see", () => {
    const html = renderToStaticMarkup(
      React.createElement(CaptureBar, panelProps)
    );

    const offenders = (html.match(/class="([^"]*)"/g) ?? []).filter((c) =>
      GOES_HORIZONTAL_ON_VIEWPORT.test(c)
    );

    expect(offenders, offenders.join(" | ")).toEqual([]);
  });

  it("stacks the counter and its two actions rather than racing them off the edge", () => {
    const html = renderToStaticMarkup(
      React.createElement(CaptureBar, panelProps)
    );

    // The counter is a full row of its own; Refresh and Open Archer's Hub
    // share the row under it and are allowed to wrap.
    const actions = /<div[^>]*data-testid="capture-actions"[^>]*>/.exec(html);
    expect(actions).not.toBeNull();
    expect(matchGroup(actions, 0)).toMatch(/flex-wrap/);
  });
});
