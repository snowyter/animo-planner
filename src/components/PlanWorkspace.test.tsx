import { beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PlanWorkspace } from "./PlanWorkspace";
import * as client from "../adapters/ipc/client";
import type { Plan, PlanSection, PlanSummary, ScheduleBlock } from "../adapters/ipc/types";

vi.mock("../adapters/ipc/client", () => ({
  getCaptureSummary: vi.fn(),
  openCaptureWindow: vi.fn(),
  undoLastCapture: vi.fn(),
  onCaptureUpdated: vi.fn().mockResolvedValue(() => {}),
  onCaptureFailed: vi.fn().mockResolvedValue(() => {}),
}));

describe("PlanWorkspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(client.getCaptureSummary).mockResolvedValue({
      campusId: 7,
      sessionId: 155,
      sectionCount: 42,
      courseCount: 8,
      canUndo: true,
    });
    vi.mocked(client.onCaptureUpdated).mockResolvedValue(() => {});
    vi.mocked(client.onCaptureFailed).mockResolvedValue(() => {});
  });

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

  const makeBlock = (
    day: ScheduleBlock["day"],
    startMin: number,
    endMin: number,
    modality: "F2F" | "ONLINE" = "F2F",
    location: string | null = modality === "F2F" ? "L226" : null
  ): ScheduleBlock => {
    if (modality === "F2F") {
      return {
        day,
        startMin,
        endMin,
        modality: "F2F",
        location: location ?? "L226",
      };
    }
    return {
      day,
      startMin,
      endMin,
      modality: "ONLINE",
      location: null,
    };
  };

  const makeSection = (
    courseId: number,
    sectionId: number,
    courseCode: string,
    sectionCode: string,
    blocks: ScheduleBlock[],
    pinned = false
  ): PlanSection => ({
    courseId,
    courseCode,
    courseTitle: `${courseCode} Title`,
    sectionId,
    sectionCode,
    pinned,
    missing: false,
    modality: blocks.some((b) => b.modality === "ONLINE")
      ? blocks.some((b) => b.modality === "F2F")
        ? "HYBRID"
        : "ONLINE"
      : "F2F",
    blocks,
    latestSnapshot: {
      capturedAt: "2026-08-22T00:00:00Z",
      enrolled: 42,
      teacher: "Prof X",
      remark: null,
    },
  });

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

  it("renders the week grid and displays persistent conflict count in plan header", () => {
    const sectionA = makeSection(
      2923,
      384,
      "GEARTAP",
      "S11",
      [makeBlock("MON", 450, 540, "F2F", "L226")]
    );
    const sectionB = makeSection(
      564,
      737,
      "CSINTSY",
      "Z01",
      [makeBlock("MON", 480, 570, "ONLINE")]
    );

    const mockPlanWithConflicts: Plan = {
      ...mockPlanSummary,
      sectionCount: 2,
      sections: [sectionA, sectionB],
    };

    const html = renderToStaticMarkup(
      React.createElement(PlanWorkspace, {
        planSummary: mockPlanSummary,
        plan: mockPlanWithConflicts,
        isLoading: false,
        error: null,
        onBack: vi.fn(),
        onRetry: vi.fn(),
      })
    );

    // Week grid rendered
    expect(html).toContain("GEARTAP");
    expect(html).toContain("CSINTSY");

    // Persistent conflict count in plan header
    expect(html).toContain("1 conflict");
  });

  it("displays 0 conflicts or clear status when plan sections have no conflicts", () => {
    const sectionA = makeSection(
      2923,
      384,
      "GEARTAP",
      "S11",
      [makeBlock("MON", 450, 540, "F2F", "L226")]
    );

    const mockPlanNoConflicts: Plan = {
      ...mockPlanSummary,
      sectionCount: 1,
      sections: [sectionA],
    };

    const html = renderToStaticMarkup(
      React.createElement(PlanWorkspace, {
        planSummary: mockPlanSummary,
        plan: mockPlanNoConflicts,
        isLoading: false,
        error: null,
        onBack: vi.fn(),
        onRetry: vi.fn(),
      })
    );

    expect(html).toContain("GEARTAP");
    expect(html).toContain("No conflicts");
  });

  it("renders the capture bar with open Archer's Hub button, credential disclaimer, and undo control", () => {
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

    expect(html).toContain("Open Archer&#x27;s Hub");
    expect(html).toContain("Capture Sections");
    expect(html).toMatch(/never (?:sees, captures, or )?stores (?:your )?credentials/i);
    expect(html).toContain("Undo");
  });

  it("renders SectionPicker with captured courses inside PlanWorkspace", () => {
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
  });

  it("renders explicit Refresh control button on the plan", () => {
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

    expect(html).toContain("Refresh");
  });

  it("renders persistent missing section banner when plan has missing sections", () => {
    const missingSection = makeSection(
      2923,
      384,
      "GEARTAP",
      "S11",
      [makeBlock("MON", 450, 540, "F2F", "L226")]
    );
    missingSection.missing = true;

    const mockPlanWithMissing: Plan = {
      ...mockPlanSummary,
      sectionCount: 1,
      sections: [missingSection],
    };

    const html = renderToStaticMarkup(
      React.createElement(PlanWorkspace, {
        planSummary: mockPlanSummary,
        plan: mockPlanWithMissing,
        isLoading: false,
        error: null,
        onBack: vi.fn(),
        onRetry: vi.fn(),
      })
    );

    expect(html).toContain("GEARTAP");
    expect(html).toContain("S11");
    expect(html).toContain("missing from the catalog");
  });
});

describe("PlanWorkspace refresh recovery states", () => {
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

  it("renders session expiry notice with exact phrase and Resume button", async () => {
    const usePlanRefreshModule = await import("./usePlanRefresh");
    const spy = vi.spyOn(usePlanRefreshModule, "usePlanRefresh").mockReturnValue({
      isRefreshing: false,
      isResuming: false,
      progress: null,
      outcome: {
        status: "session_expired",
        refreshedCourses: 2,
        totalCourses: 3,
        haltedAfterCourseCode: "GEARTAP",
      },
      sessionExpired: true,
      offline: false,
      error: null,
      missingSections: [],
      isLoadingMissing: false,
      startRefresh: vi.fn(),
      resumeRefresh: vi.fn(),
      fetchMissingSections: vi.fn(),
      dismissNotice: vi.fn(),
    });

    const html = renderToStaticMarkup(
      React.createElement(PlanWorkspace, {
        planSummary: mockPlanSummary,
        plan: { ...mockPlanSummary, sections: [] },
        isLoading: false,
        error: null,
        onBack: vi.fn(),
        onRetry: vi.fn(),
      })
    );

    expect(html).toContain("Session expired — sign in to continue");
    expect(html).toContain("Resume");
    expect(html).toContain("Open Archer&#x27;s Hub");
    expect(html).toContain("halted after GEARTAP");

    spy.mockRestore();
  });

  it("renders progress display showing course being refreshed and how many remain", async () => {
    const usePlanRefreshModule = await import("./usePlanRefresh");
    const spy = vi.spyOn(usePlanRefreshModule, "usePlanRefresh").mockReturnValue({
      isRefreshing: true,
      isResuming: false,
      progress: {
        courseIndex: 0,
        courseTotal: 3,
        courseCode: "CSINTSY",
      },
      outcome: null,
      sessionExpired: false,
      offline: false,
      error: null,
      missingSections: [],
      isLoadingMissing: false,
      startRefresh: vi.fn(),
      resumeRefresh: vi.fn(),
      fetchMissingSections: vi.fn(),
      dismissNotice: vi.fn(),
    });

    const html = renderToStaticMarkup(
      React.createElement(PlanWorkspace, {
        planSummary: mockPlanSummary,
        plan: { ...mockPlanSummary, sections: [] },
        isLoading: false,
        error: null,
        onBack: vi.fn(),
        onRetry: vi.fn(),
      })
    );

    expect(html).toContain("Refreshing CSINTSY (1 of 3, 2 remaining)");

    spy.mockRestore();
  });

  it("renders plain offline notice when refresh is offline", async () => {
    const usePlanRefreshModule = await import("./usePlanRefresh");
    const spy = vi.spyOn(usePlanRefreshModule, "usePlanRefresh").mockReturnValue({
      isRefreshing: false,
      isResuming: false,
      progress: null,
      outcome: {
        status: "offline",
        refreshedCourses: 0,
        totalCourses: 3,
        haltedAfterCourseCode: null,
      },
      sessionExpired: false,
      offline: true,
      error: null,
      missingSections: [],
      isLoadingMissing: false,
      startRefresh: vi.fn(),
      resumeRefresh: vi.fn(),
      fetchMissingSections: vi.fn(),
      dismissNotice: vi.fn(),
    });

    const html = renderToStaticMarkup(
      React.createElement(PlanWorkspace, {
        planSummary: mockPlanSummary,
        plan: { ...mockPlanSummary, sections: [] },
        isLoading: false,
        error: null,
        onBack: vi.fn(),
        onRetry: vi.fn(),
      })
    );

    expect(html).toContain("Offline");
    expect(html).toContain("No network connection");
    expect(html).toContain("plan was not changed");

    spy.mockRestore();
  });
});


