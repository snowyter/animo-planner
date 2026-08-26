import { beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AboutDialog } from "./AboutDialog";
import type { AppInfo, UpdateCheck } from "../adapters/ipc/types";

vi.mock("../adapters/ipc/client", () => ({
  getAppInfo: vi.fn(),
  clearBrowserSession: vi.fn(),
  checkForUpdate: vi.fn(),
  installUpdate: vi.fn(),
}));

describe("AboutDialog", () => {
  const mockAppInfo: AppInfo = {
    appVersion: "0.1.0",
    selectorConfigVersion: "1",
    selectorConfigSource: "bundled",
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the disclaimer verbatim", () => {
    const html = renderToStaticMarkup(
      React.createElement(AboutDialog, {
        open: true,
        onOpenChange: vi.fn(),
        initialAppInfo: mockAppInfo,
      })
    );

    expect(html).toContain(
      "Animo Plan is a student-built tool with no affiliation to, endorsement by, or connection with De La Salle University. It never enlists, never modifies your records, and never stores your credentials."
    );
  });

  it("displays both app version and selector-config version with source indicator", () => {
    const html = renderToStaticMarkup(
      React.createElement(AboutDialog, {
        open: true,
        onOpenChange: vi.fn(),
        initialAppInfo: mockAppInfo,
      })
    );

    expect(html).toContain("0.1.0");
    expect(html).toContain("v1");
    expect(html).toMatch(/bundled/i);
  });

  it("displays remote indicator when selector config source is remote", () => {
    const remoteAppInfo: AppInfo = {
      appVersion: "0.1.0",
      selectorConfigVersion: "9",
      selectorConfigSource: "remote",
    };

    const html = renderToStaticMarkup(
      React.createElement(AboutDialog, {
        open: true,
        onOpenChange: vi.fn(),
        initialAppInfo: remoteAppInfo,
      })
    );

    expect(html).toContain("v9");
    expect(html).toMatch(/remote/i);
  });

  it("includes a link opening the public source repository", () => {
    const html = renderToStaticMarkup(
      React.createElement(AboutDialog, {
        open: true,
        onOpenChange: vi.fn(),
        initialAppInfo: mockAppInfo,
      })
    );

    expect(html).toContain("https://github.com/snowyter/animo-planner");
    expect(html).toContain("target=\"_blank\"");
  });

  it("renders sign out / clear session control explaining what it will and will not remove", () => {
    const html = renderToStaticMarkup(
      React.createElement(AboutDialog, {
        open: true,
        onOpenChange: vi.fn(),
        initialAppInfo: mockAppInfo,
      })
    );

    expect(html).toMatch(/Sign out|Clear session/i);
    expect(html).toMatch(/captured sections (?:and plans )?stay/i);
  });

  it("renders report broken capture button", () => {
    const html = renderToStaticMarkup(
      React.createElement(AboutDialog, {
        open: true,
        onOpenChange: vi.fn(),
        initialAppInfo: mockAppInfo,
        onOpenReport: vi.fn(),
      })
    );

    expect(html).toContain("Report broken capture");
  });

  // Ticket 39 — Updater acceptance tests in AboutDialog

  it("renders check for updates action and keeps running version visible when no check has run yet", () => {
    const html = renderToStaticMarkup(
      React.createElement(AboutDialog, {
        open: true,
        onOpenChange: vi.fn(),
        initialAppInfo: mockAppInfo,
      })
    );

    expect(html).toContain("0.1.0");
    expect(html).toMatch(/Check for updates/i);
  });

  it("renders up-to-date inline state and keeps running version visible", () => {
    const check: UpdateCheck = {
      status: "up_to_date",
      currentVersion: "0.1.0",
      availableVersion: null,
      notes: null,
      failureReason: null,
      failureDetail: null,
    };

    const html = renderToStaticMarkup(
      React.createElement(AboutDialog, {
        open: true,
        onOpenChange: vi.fn(),
        initialAppInfo: mockAppInfo,
        initialUpdateCheck: check,
      })
    );

    expect(html).toContain("0.1.0");
    expect(html).toMatch(/up to date/i);
    expect(html).toMatch(/Check for updates|Check again/i);
  });

  it("renders available update with version, release notes, restart notice, and install action", () => {
    const check: UpdateCheck = {
      status: "available",
      currentVersion: "0.1.0",
      availableVersion: "0.2.0",
      notes: "Support new AY2026-27 term options",
      failureReason: null,
      failureDetail: null,
    };

    const html = renderToStaticMarkup(
      React.createElement(AboutDialog, {
        open: true,
        onOpenChange: vi.fn(),
        initialAppInfo: mockAppInfo,
        initialUpdateCheck: check,
      })
    );

    expect(html).toContain("0.1.0");
    expect(html).toContain("0.2.0");
    expect(html).toContain("Support new AY2026-27 term options");
    expect(html).toMatch(/restart/i);
    expect(html).toMatch(/Install|Update/i);
  });

  it("renders quiet non-alarming inline failure note and check again action on failed check", () => {
    const check: UpdateCheck = {
      status: "failed",
      currentVersion: "0.1.0",
      availableVersion: null,
      notes: null,
      failureReason: "network",
      failureDetail: "Network timeout",
    };

    const html = renderToStaticMarkup(
      React.createElement(AboutDialog, {
        open: true,
        onOpenChange: vi.fn(),
        initialAppInfo: mockAppInfo,
        initialUpdateCheck: check,
      })
    );

    expect(html).toContain("0.1.0");
    expect(html).toMatch(/offline|Could not connect|could not complete/i);
    expect(html).toMatch(/Check again|Check for updates/i);
  });

  it("renders NO update controls at all when updater is compiled out (status: unavailable)", () => {
    const check: UpdateCheck = {
      status: "unavailable",
      currentVersion: "0.1.0",
      availableVersion: null,
      notes: null,
      failureReason: null,
      failureDetail: null,
    };

    const html = renderToStaticMarkup(
      React.createElement(AboutDialog, {
        open: true,
        onOpenChange: vi.fn(),
        initialAppInfo: mockAppInfo,
        initialUpdateCheck: check,
      })
    );

    expect(html).toContain("0.1.0");
    expect(html).not.toMatch(/Check for updates/i);
    expect(html).not.toMatch(/Check again/i);
    expect(html).not.toMatch(/Install update/i);
  });

  it("shows in-progress state and disables button when checking for updates", () => {
    const html = renderToStaticMarkup(
      React.createElement(AboutDialog, {
        open: true,
        onOpenChange: vi.fn(),
        initialAppInfo: mockAppInfo,
        isCheckingUpdate: true,
      })
    );

    expect(html).toContain("0.1.0");
    expect(html).toMatch(/Checking for updates\.\.\./i);
    expect(html).toMatch(/disabled/i);
  });

  it("shows in-progress state and disables button when installing update", () => {
    const check: UpdateCheck = {
      status: "available",
      currentVersion: "0.1.0",
      availableVersion: "0.2.0",
      notes: null,
      failureReason: null,
      failureDetail: null,
    };

    const html = renderToStaticMarkup(
      React.createElement(AboutDialog, {
        open: true,
        onOpenChange: vi.fn(),
        initialAppInfo: mockAppInfo,
        initialUpdateCheck: check,
        isInstallingUpdate: true,
      })
    );

    expect(html).toContain("0.1.0");
    expect(html).toMatch(/Installing|Updating/i);
    expect(html).toMatch(/disabled/i);
  });
});
