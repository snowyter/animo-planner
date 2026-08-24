import { beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AboutDialog } from "./AboutDialog";
import type { AppInfo } from "../adapters/ipc/types";

vi.mock("../adapters/ipc/client", () => ({
  getAppInfo: vi.fn(),
  clearBrowserSession: vi.fn(),
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
});
