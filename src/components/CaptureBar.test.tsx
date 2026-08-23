import { describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CaptureBar } from "./CaptureBar";
import type { CaptureSummary } from "../adapters/ipc/types";

describe("CaptureBar", () => {
  const defaultProps = {
    campusId: 7,
    sessionId: 155,
    campusName: "Manila",
    sessionName: "AY2026-27 T1",
    summary: {
      campusId: 7,
      sessionId: 155,
      sectionCount: 42,
      courseCount: 8,
      canUndo: true,
    } as CaptureSummary,
    isLoading: false,
    error: null,
    captureFailure: null,
    isOpening: false,
    isUndoing: false,
    onOpenCapture: vi.fn(),
    onUndo: vi.fn(),
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
          canUndo: true,
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

  it("renders undo button next to counter and enables it when canUndo is true", () => {
    const html = renderToStaticMarkup(
      React.createElement(CaptureBar, {
        ...defaultProps,
        summary: {
          campusId: 7,
          sessionId: 155,
          sectionCount: 42,
          courseCount: 8,
          canUndo: true,
        },
      })
    );

    expect(html).toContain("Undo");
    // Should not have disabled attribute on the undo button
    expect(html).not.toMatch(/<button[^>]*disabled[^>]*>[^<]*Undo/i);
  });

  it("disables undo button when canUndo is false", () => {
    const html = renderToStaticMarkup(
      React.createElement(CaptureBar, {
        ...defaultProps,
        summary: {
          campusId: 7,
          sessionId: 155,
          sectionCount: 0,
          courseCount: 0,
          canUndo: false,
        },
      })
    );

    expect(html).toContain("Undo");
    expect(html).toMatch(/<button[^>]*disabled/);
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
