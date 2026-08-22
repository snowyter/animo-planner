import { describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PlanWorkspace } from "./PlanWorkspace";
import type { Plan, PlanSummary } from "../adapters/ipc/types";

describe("PlanWorkspace", () => {
  const mockPlanSummary: PlanSummary = {
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

  it("always visibly displays the plan's campus and session", () => {
    const html = renderToStaticMarkup(
      React.createElement(PlanWorkspace, {
        planSummary: mockPlanSummary,
        plan: null,
        isLoading: false,
        error: null,
        onBack: vi.fn(),
        onRetry: vi.fn(),
      })
    );

    expect(html).toContain("Manila");
    expect(html).toContain("AY2026-27 T1");
    expect(html).toContain("T1 Target Schedule");
  });

  it("surfaces identifiable error state when getPlan fails with unimplemented", () => {
    const html = renderToStaticMarkup(
      React.createElement(PlanWorkspace, {
        planSummary: mockPlanSummary,
        plan: null,
        isLoading: false,
        error: "unimplemented: get_plan",
        onBack: vi.fn(),
        onRetry: vi.fn(),
      })
    );

    expect(html).toContain("unimplemented: get_plan");
    expect(html).toContain("Retry");
  });

  it("renders entry point affordances for section picker and solver", () => {
    const mockFullPlan: Plan = {
      ...mockPlanSummary,
      sections: [],
    };

    const html = renderToStaticMarkup(
      React.createElement(PlanWorkspace, {
        planSummary: mockPlanSummary,
        plan: mockFullPlan,
        isLoading: false,
        error: null,
        onBack: vi.fn(),
        onRetry: vi.fn(),
      })
    );

    expect(html).toContain("Pick my own sections");
    expect(html).toContain("Let the solver build it");
  });
});
