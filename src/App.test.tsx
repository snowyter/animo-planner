import { beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import App from "./App";
import * as client from "./adapters/ipc/client";
import { PlanWorkspace } from "./components/PlanWorkspace";
import { AppHeader } from "./components/AppHeader";
import type { PlanSummary } from "./adapters/ipc/types";

vi.mock("./adapters/ipc/client", () => ({
  listPlans: vi.fn(),
  getCampusOptions: vi.fn(),
  getSessionOptions: vi.fn(),
  createPlan: vi.fn(),
  deletePlan: vi.fn(),
  getPlan: vi.fn(),
  seedSamplePlan: vi.fn(),
}));

describe("App shell and navigation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the main app shell with header and plan list container", () => {
    vi.mocked(client.listPlans).mockResolvedValue([]);
    vi.mocked(client.getCampusOptions).mockResolvedValue([]);
    vi.mocked(client.getSessionOptions).mockResolvedValue([]);

    const html = renderToStaticMarkup(React.createElement(App));

    expect(html).toContain("Animo Plan");
    expect(html).toContain("Archer&#x27;s Hub Enlistment Planner");
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
      isSample: false,
    };

    const headerHtml = renderToStaticMarkup(
      React.createElement(AppHeader, {
        activePlan: mockPlan,
        onBackToPlans: vi.fn(),
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
      isSample: false,
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
});
