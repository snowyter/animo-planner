import { describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PlanList } from "./PlanList";
import type { PlanSummary } from "../adapters/ipc/types";

const mockPlans: PlanSummary[] = [
  {
    id: "p1",
    name: "Term 1 Schedule",
    campusId: 7,
    campusName: "Manila",
    sessionId: 155,
    sessionName: "AY2026-27 T1",
    createdAt: "2026-08-22T00:00:00Z",
    sectionCount: 4,
  },
  {
    id: "p2",
    name: "Laguna Sample",
    campusId: 8,
    campusName: "Laguna",
    sessionId: 156,
    sessionName: "AY2026-27 T2",
    createdAt: "2026-08-22T00:00:00Z",
    sectionCount: 0,
  },
];

describe("PlanList", () => {
  it("renders empty state when there are no plans, pointing at plan creation", () => {
    const html = renderToStaticMarkup(
      React.createElement(PlanList, {
        plans: [],
        isLoading: false,
        error: null,
        onOpenCreate: vi.fn(),
        onOpenPlan: vi.fn(),
        onDeletePlan: vi.fn(),
        onRetry: vi.fn(),
      })
    );

    expect(html).toContain("No saved plans yet");
    expect(html).toContain("Create your first plan");
    // The sample-plan path is gone: the empty state must not offer one.
    expect(html).not.toContain("sample");
    expect(html).not.toContain("Sample");
  });

  it("renders identifiable error state when error is provided", () => {
    const html = renderToStaticMarkup(
      React.createElement(PlanList, {
        plans: [],
        isLoading: false,
        error: "unimplemented: list_plans",
        onOpenCreate: vi.fn(),
        onOpenPlan: vi.fn(),
        onDeletePlan: vi.fn(),
        onRetry: vi.fn(),
      })
    );

    expect(html).toContain("unimplemented: list_plans");
    expect(html).toContain("Retry");
  });

  it("renders plan cards with name, campus, session, and section count when plans exist", () => {
    const html = renderToStaticMarkup(
      React.createElement(PlanList, {
        plans: mockPlans,
        isLoading: false,
        error: null,
        onOpenCreate: vi.fn(),
        onOpenPlan: vi.fn(),
        onDeletePlan: vi.fn(),
        onRetry: vi.fn(),
      })
    );

    expect(html).toContain("Term 1 Schedule");
    expect(html).toContain("Manila");
    expect(html).toContain("AY2026-27 T1");
    expect(html).toContain("4 sections");

    expect(html).toContain("Laguna Sample");
    expect(html).toContain("Laguna");
    expect(html).toContain("AY2026-27 T2");
    expect(html).toContain("0 sections");
    expect(html).toContain("Sample");
    expect(html).toContain("New Plan");
  });

  it("rises each plan card, staggered and capped, as the list arrives", () => {
    // Solve results already read as an ordering; the plan list is the first
    // thing a student sees and it cut in flat. The stagger is CSS
    // animation-delay driven by a custom property, and it is capped, so a
    // long list of plans is not still arriving.
    const html = renderToStaticMarkup(
      React.createElement(PlanList, {
        plans: mockPlans,
        isLoading: false,
        error: null,
        onOpenCreate: vi.fn(),
        onOpenPlan: vi.fn(),
        onDeletePlan: vi.fn(),
        onRetry: vi.fn(),
      })
    );

    expect(html).toContain("stagger-rise");

    const delays = [...html.matchAll(/--stagger-delay:\s*(\d+)ms/g)].map((m) =>
      Number(m[1])
    );
    expect(delays.length).toBe(mockPlans.length);
    expect(Math.max(...delays)).toBeLessThanOrEqual(320);
  });

  it("arrives the empty state and the error alert rather than cutting them in", () => {
    const empty = renderToStaticMarkup(
      React.createElement(PlanList, {
        plans: [],
        isLoading: false,
        error: null,
        onOpenCreate: vi.fn(),
        onOpenPlan: vi.fn(),
        onDeletePlan: vi.fn(),
        onRetry: vi.fn(),
      })
    );
    expect(empty).toContain("enter-rise");

    const errored = renderToStaticMarkup(
      React.createElement(PlanList, {
        plans: [],
        isLoading: false,
        error: "unimplemented: list_plans",
        onOpenCreate: vi.fn(),
        onOpenPlan: vi.fn(),
        onDeletePlan: vi.fn(),
        onRetry: vi.fn(),
      })
    );
    // An error is information the student must act on; arriving makes it
    // noticeable. It is a fade, not a rise: the alert sits above the list
    // and moving it would shift the content under it.
    expect(errored).toContain("enter-fade");
  });
});
