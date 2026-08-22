import { describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppHeader } from "./AppHeader";
import type { PlanSummary } from "../adapters/ipc/types";

describe("AppHeader", () => {
  it("renders the app brand and default title when no plan is active", () => {
    const html = renderToStaticMarkup(
      React.createElement(AppHeader, {
        activePlan: null,
        onBackToPlans: vi.fn(),
      })
    );

    expect(html).toContain("Animo Plan");
    expect(html).toContain("Archer&#x27;s Hub Enlistment Planner");
  });

  it("renders the plan name and visible campus and session badges when a plan is active", () => {
    const mockPlan: PlanSummary = {
      id: "p1",
      name: "Graduation Term",
      campusId: 7,
      campusName: "Manila",
      sessionId: 155,
      sessionName: "AY2026-27 T1",
      createdAt: "2026-08-22T00:00:00Z",
      sectionCount: 3,
      isSample: false,
    };

    const html = renderToStaticMarkup(
      React.createElement(AppHeader, {
        activePlan: mockPlan,
        onBackToPlans: vi.fn(),
      })
    );

    expect(html).toContain("Graduation Term");
    expect(html).toContain("Manila");
    expect(html).toContain("AY2026-27 T1");
    expect(html).toContain("All Plans");
  });
});
