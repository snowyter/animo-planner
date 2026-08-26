import { beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import App from "./App";
import * as client from "./adapters/ipc/client";
import { PlanWorkspace } from "./components/PlanWorkspace";
import { AppHeader } from "./components/AppHeader";
import type { PlanSummary, UpdateCheck } from "./adapters/ipc/types";

vi.mock("./adapters/ipc/client", () => ({
  listPlans: vi.fn(),
  getCampusOptions: vi.fn(),
  getSessionOptions: vi.fn(),
  createPlan: vi.fn(),
  deletePlan: vi.fn(),
  getPlan: vi.fn(),
  seedSamplePlan: vi.fn(),
  getCaptureSummary: vi.fn(),
  openCaptureWindow: vi.fn(),
  getAppInfo: vi.fn().mockResolvedValue({
    appVersion: "0.1.0",
    selectorConfigVersion: "1",
    selectorConfigSource: "bundled",
  }),
  buildCaptureReport: vi.fn(),
  clearBrowserSession: vi.fn(),
  checkForUpdate: vi.fn().mockResolvedValue({
    status: "up_to_date",
    currentVersion: "0.1.0",
    availableVersion: null,
    notes: null,
    failureReason: null,
    failureDetail: null,
  }),
  installUpdate: vi.fn(),
  onCaptureUpdated: vi.fn().mockResolvedValue(() => {}),
  onCaptureFailed: vi.fn().mockResolvedValue(() => {}),
}));

describe("App shell and navigation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the main app shell with header, about trigger, and plan list container", () => {
    vi.mocked(client.listPlans).mockResolvedValue([]);
    vi.mocked(client.getCampusOptions).mockResolvedValue([]);
    vi.mocked(client.getSessionOptions).mockResolvedValue([]);

    const html = renderToStaticMarkup(React.createElement(App));

    expect(html).toContain("Animo Plan");
    expect(html).toContain("Archer&#x27;s Hub Enlistment Planner");
    expect(html).toContain("About");
  });

  it("displays the plan's campus and session in header and workspace when a plan is active", () => {
    const mockPlan: PlanSummary = {
      id: "p1",
      name: "T1 Target Schedule",
      campusId: 7,
      campusName: "Manila",
      sessionId: 155,
      sessionName: "AY2026-27 T1",
      createdAt: "2026-08-22T00:00:00Z",
      sectionCount: 2,
    };

    const headerHtml = renderToStaticMarkup(
      React.createElement(AppHeader, {
        activePlan: mockPlan,
        onBackToPlans: vi.fn(),
        onOpenAbout: vi.fn(),
      })
    );

    expect(headerHtml).toContain("T1 Target Schedule");
    expect(headerHtml).toContain("Manila");
    expect(headerHtml).toContain("AY2026-27 T1");

    const workspaceHtml = renderToStaticMarkup(
      React.createElement(PlanWorkspace, {
        planSummary: mockPlan,
        plan: null,
        isLoading: false,
        error: null,
        onBack: vi.fn(),
        onRetry: vi.fn(),
      })
    );

    expect(workspaceHtml).toContain("T1 Target Schedule");
    expect(workspaceHtml).toContain("Manila");
    expect(workspaceHtml).toContain("AY2026-27 T1");
  });

  it("surfaces identifiable unimplemented error in the workspace when getPlan rejects", () => {
    const mockPlan: PlanSummary = {
      id: "p1",
      name: "T1 Target Schedule",
      campusId: 7,
      campusName: "Manila",
      sessionId: 155,
      sessionName: "AY2026-27 T1",
      createdAt: "2026-08-22T00:00:00Z",
      sectionCount: 0,
    };

    const workspaceHtml = renderToStaticMarkup(
      React.createElement(PlanWorkspace, {
        planSummary: mockPlan,
        plan: null,
        isLoading: false,
        error: "unimplemented: get_plan",
        onBack: vi.fn(),
        onRetry: vi.fn(),
      })
    );

    expect(workspaceHtml).toContain("unimplemented: get_plan");
  });

  it("shows onboarding tour on first run with the verbatim disclaimer", () => {
    vi.mocked(client.listPlans).mockResolvedValue([]);
    vi.mocked(client.getCampusOptions).mockResolvedValue([{ id: 7, name: "Manila" }]);
    vi.mocked(client.getSessionOptions).mockResolvedValue([{ id: 155, name: "AY2026-27 T1" }]);

    const html = renderToStaticMarkup(React.createElement(App));

    expect(html).toContain("Welcome to Animo Plan");
    expect(html).toMatch(/Start a real plan|Create your plan/i);
    // The sample-data path is gone; first run must not offer one.
    expect(html).not.toMatch(/sample/i);
    expect(html).toContain(
      "Animo Plan is a student-built tool with no affiliation to, endorsement by, or connection with De La Salle University. It never enlists, never modifies your records, and never stores your credentials."
    );
    expect(html).toMatch(/Tour/i);
  });

  it("does not display onboarding tour automatically if already marked completed in storage", () => {
    vi.mocked(client.listPlans).mockResolvedValue([]);
    vi.mocked(client.getCampusOptions).mockResolvedValue([]);
    vi.mocked(client.getSessionOptions).mockResolvedValue([]);

    const originalLocalStorage = (globalThis as unknown as { localStorage?: unknown }).localStorage;
    const store: Record<string, string> = {
      "animo-plan:onboarding-completed": "true",
    };
    (globalThis as unknown as { localStorage: unknown }).localStorage = {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, val: string) => {
        store[key] = val;
      },
    };

    const html = renderToStaticMarkup(React.createElement(App));

    expect(html).not.toContain("Welcome to Animo Plan");
    expect(html).toMatch(/Tour/i);

    // Restore
    (globalThis as unknown as { localStorage: unknown }).localStorage = originalLocalStorage;
  });

  it("renders a quiet waiting update notice with the offered version without opening a dialog", () => {
    vi.mocked(client.listPlans).mockResolvedValue([]);
    vi.mocked(client.getCampusOptions).mockResolvedValue([]);
    vi.mocked(client.getSessionOptions).mockResolvedValue([]);

    const availableCheck: UpdateCheck = {
      status: "available",
      currentVersion: "0.1.0",
      availableVersion: "0.2.0",
      notes: "Release notes",
      failureReason: null,
      failureDetail: null,
    };

    const html = renderToStaticMarkup(
      React.createElement(App, {
        initialUpdateCheck: availableCheck,
      })
    );

    expect(html).toContain("0.2.0");
    expect(html).toMatch(/A new version of Animo Plan/i);
  });

  it("does not render update notice banner when up to date or failed", () => {
    vi.mocked(client.listPlans).mockResolvedValue([]);
    vi.mocked(client.getCampusOptions).mockResolvedValue([]);
    vi.mocked(client.getSessionOptions).mockResolvedValue([]);

    const failedCheck: UpdateCheck = {
      status: "failed",
      currentVersion: "0.1.0",
      availableVersion: null,
      notes: null,
      failureReason: "network",
      failureDetail: "Network error",
    };

    const html = renderToStaticMarkup(
      React.createElement(App, {
        initialUpdateCheck: failedCheck,
      })
    );

    expect(html).not.toMatch(/A new version of Animo Plan/i);
  });
});
