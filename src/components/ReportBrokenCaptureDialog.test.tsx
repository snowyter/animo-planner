import { beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ReportBrokenCaptureDialog } from "./ReportBrokenCaptureDialog";
import type { CaptureReport, AppInfo } from "../adapters/ipc/types";

vi.mock("../adapters/ipc/client", () => ({
  buildCaptureReport: vi.fn(),
  getAppInfo: vi.fn(),
}));

describe("ReportBrokenCaptureDialog", () => {
  const mockAppInfo: AppInfo = {
    appVersion: "0.1.0",
    selectorConfigVersion: "1",
    selectorConfigSource: "bundled",
  };

  const mockReport: CaptureReport = {
    title: "Broken capture: table not found in DOM",
    body: "## Broken capture\n\n- Animo Plan version: 0.1.0\n- selector config: v1 (bundled)\n\n### Parse error\n\ntable not found\n\n### DOM fragment at the failure\n\n```html\n<table id=\"tblCourseSelection\"></table>\n```",
    issueUrl: "https://github.com/snowyter/animo-planner/issues/new?title=Broken%20capture&body=test",
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders dialog when open with title and description", () => {
    const html = renderToStaticMarkup(
      React.createElement(ReportBrokenCaptureDialog, {
        open: true,
        onOpenChange: vi.fn(),
        initialReport: mockReport,
        appInfo: mockAppInfo,
      })
    );

    expect(html).toContain("Report broken capture");
  });

  it("shows the full scrubbed report text in an editable text area", () => {
    const html = renderToStaticMarkup(
      React.createElement(ReportBrokenCaptureDialog, {
        open: true,
        onOpenChange: vi.fn(),
        initialReport: mockReport,
        appInfo: mockAppInfo,
      })
    );

    expect(html).toContain("Animo Plan version: 0.1.0");
    expect(html).toContain("selector config: v1 (bundled)");
    expect(html).toContain("table not found in DOM");
    expect(html).toContain("<textarea");
  });

  it("says plainly what was stripped out so the student can verify", () => {
    const html = renderToStaticMarkup(
      React.createElement(ReportBrokenCaptureDialog, {
        open: true,
        onOpenChange: vi.fn(),
        initialReport: mockReport,
        appInfo: mockAppInfo,
      })
    );

    expect(html).toContain("hdnStudId");
    expect(html).toContain("userID");
    expect(html).toContain("IP_ADDRESS");
    expect(html).toContain("MAC_ADDRESS");
  });

  it("explicitly clarifies that the app never posts on their behalf and submitting opens in browser", () => {
    const html = renderToStaticMarkup(
      React.createElement(ReportBrokenCaptureDialog, {
        open: true,
        onOpenChange: vi.fn(),
        initialReport: mockReport,
        appInfo: mockAppInfo,
      })
    );

    expect(html).toMatch(/never (?:posts|submits) on (?:your|their) behalf/i);
    expect(html).toMatch(/opens (?:a pre-filled issue )?(?:in your browser|on GitHub)/i);
  });

  it("renders submit button to open the issue on GitHub", () => {
    const html = renderToStaticMarkup(
      React.createElement(ReportBrokenCaptureDialog, {
        open: true,
        onOpenChange: vi.fn(),
        initialReport: mockReport,
        appInfo: mockAppInfo,
      })
    );

    expect(html).toMatch(/Open issue on GitHub|Open in browser/i);
  });

  it("renders draft report when captureFailure error is passed and initialReport is absent", () => {
    const html = renderToStaticMarkup(
      React.createElement(ReportBrokenCaptureDialog, {
        open: true,
        onOpenChange: vi.fn(),
        captureFailure: "Course selection table missing from DOM",
        appInfo: mockAppInfo,
      })
    );

    expect(html).toContain("Course selection table missing from DOM");
    expect(html).toContain("Animo Plan version: 0.1.0");
  });
});
