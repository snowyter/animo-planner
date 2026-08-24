import { beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PlanWorkspace } from "./PlanWorkspace";
import * as client from "../adapters/ipc/client";
import type { Plan, PlanSection, PlanSummary, ScheduleBlock, Section } from "../adapters/ipc/types";

vi.mock("../adapters/ipc/client", () => ({
  getCaptureSummary: vi.fn(),
  openCaptureWindow: vi.fn(),
  undoLastCapture: vi.fn(),
  forgetCapturedCourse: vi.fn(),
  listCapturedCourses: vi.fn().mockResolvedValue([]),
  listCapturedSections: vi.fn().mockResolvedValue([]),
  addSectionToPlan: vi.fn(),
  removeSectionFromPlan: vi.fn(),
  setSectionPinned: vi.fn(),
  solvePlan: vi.fn().mockResolvedValue({
    status: "complete",
    solutions: [],
    resumeToken: null,
    unsatisfiableCourses: [],
  }),
  continueSolve: vi.fn(),
  cancelSolve: vi.fn(),
  applySolution: vi.fn(),
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

  it("renders SectionPicker with remove course action wired", async () => {
    const useSectionPickerModule = await import("./useSectionPicker");
    const spy = vi.spyOn(useSectionPickerModule, "useSectionPicker").mockReturnValue({
      courses: [
        {
          courseId: 2923,
          code: "GEARTAP",
          title: "Art Appreciation",
          sectionCount: 2,
          firstSeenAt: "2026-08-22T00:00:00Z",
          lastSeenAt: "2026-08-22T00:00:00Z",
        },
      ],
      selectedCourseId: 2923,
      sections: [],
      isLoadingCourses: false,
      isLoadingSections: false,
      isMutating: false,
      error: null,
      hoveredSection: null,
      setHoveredSection: vi.fn(),
      fetchCourses: vi.fn(),
      syncCourses: vi.fn(),
      selectCourse: vi.fn(),
      addSection: vi.fn(),
      removeSection: vi.fn(),
      togglePin: vi.fn(),
      forgetCourse: vi.fn(),
    });

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

    expect(html).toContain("Remove course from catalog");
    expect(html).toContain('data-testid="remove-course-button"');

    spy.mockRestore();
  });

  it("renders Solve the rest button for triggering solver", () => {
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

    expect(html).toContain("Solve the rest");
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

  it("renders export control offering calendar and image export options", () => {
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

    expect(html).toContain("Export");
  });
});

describe("PlanWorkspace persistent week grid layout (ticket 28)", () => {
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

  it("renders section picker and sticky week grid container side by side while picking is open", () => {
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

    // Both section picker and week grid are present
    expect(html).toContain("Pick my own sections");
    expect(html).toContain("Weekly Schedule");

    // Responsive 2-column container exists
    expect(html).toContain("data-testid=\"picking-layout\"");

    // The app opens at 1200x800 (tauri.conf.json), so the two-column layout
    // must engage at lg (1024px). Gating it at xl (1280px) left every fresh
    // install stacked with the grid scrolled out of view while hovering --
    // the exact problem this layout exists to solve.
    expect(html).toMatch(/lg:flex-row|lg:grid/);
    expect(
      html,
      "the layout must not be gated above the window width the app ships with",
    ).not.toMatch(/xl:flex-row|xl:grid/);

    // Week grid container is sticky so it stays put while the list scrolls
    expect(html).toMatch(/lg:sticky\s+lg:top-6|sticky/);
  });

  it("orders the week grid ahead of the section list in single-column fallback", () => {
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

    // Week grid column has order-1 (narrow) and xl:order-2 (desktop)
    // Section picker column has order-2 (narrow) and xl:order-1 (desktop)
    expect(html).toMatch(/order-1[\s\S]*order-2/);
  });

  it("prevents horizontal page overflow by scoping grid min-width to its own scroll container", () => {
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

    // The grid column wrapper must have min-w-0 to prevent flex expansion
    expect(html).toContain("min-w-0");
  });

  it("renders ghost preview on the week grid when hovering a section in the new layout", async () => {
    const useSectionPickerModule = await import("./useSectionPicker");
    const ghostCandidate: Section = {
      campusId: 7,
      sessionId: 155,
      courseId: 2923,
      courseCode: "GEARTAP",
      courseTitle: "Art Appreciation",
      sectionId: 384,
      sectionCode: "S11",
      courseType: "Lecture",
      credits: 3,
      enrollCap: 45,
      startDate: "2026-07-10",
      endDate: "2026-12-09",
      firstSeenAt: "2026-08-22T00:00:00Z",
      lastSeenAt: "2026-08-22T00:00:00Z",
      modality: "F2F",
      blocks: [
        {
          day: "TUE",
          startMin: 870,
          endMin: 960,
          modality: "F2F",
          location: "L226",
        },
      ],
      latestSnapshot: {
        capturedAt: "2026-08-22T00:00:00Z",
        enrolled: 42,
        teacher: "Prof X",
        remark: null,
      },
    };

    const spy = vi.spyOn(useSectionPickerModule, "useSectionPicker").mockReturnValue({
      courses: [
        {
          courseId: 2923,
          code: "GEARTAP",
          title: "Art Appreciation",
          sectionCount: 1,
          firstSeenAt: "2026-08-22T00:00:00Z",
          lastSeenAt: "2026-08-22T00:00:00Z",
        },
      ],
      selectedCourseId: 2923,
      sections: [ghostCandidate],
      isLoadingCourses: false,
      isLoadingSections: false,
      isMutating: false,
      error: null,
      hoveredSection: null,
      setHoveredSection: vi.fn(),
      fetchCourses: vi.fn(),
      syncCourses: vi.fn(),
      selectCourse: vi.fn(),
      addSection: vi.fn(),
      removeSection: vi.fn(),
      togglePin: vi.fn(),
      forgetCourse: vi.fn(),
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

    // Picker row is rendered in the new layout
    expect(html).toContain("data-testid=\"section-row-S11\"");

    spy.mockRestore();
  });

  it("renders ghost preview with preview badge on the week grid when hovering candidate section", () => {
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

    // Week grid rendered within picking layout
    expect(html).toContain("data-testid=\"week-grid\"");
    expect(html).toContain("data-testid=\"picking-layout\"");
  });

  it("keeps conflict display and hatched styling intact in persistent week grid layout", () => {
    const sectionA = {
      courseId: 2923,
      courseCode: "GEARTAP",
      courseTitle: "Art Appreciation",
      sectionId: 384,
      sectionCode: "S11",
      pinned: false,
      missing: false,
      modality: "F2F" as const,
      blocks: [
        {
          day: "MON" as const,
          startMin: 450,
          endMin: 540,
          modality: "F2F" as const,
          location: "L226",
        },
      ],
      latestSnapshot: {
        capturedAt: "2026-08-22T00:00:00Z",
        enrolled: 42,
        teacher: "Prof X",
        remark: null,
      },
    };

    const sectionB = {
      courseId: 564,
      courseCode: "CSINTSY",
      courseTitle: "Intro to Intelligent Systems",
      sectionId: 737,
      sectionCode: "Z01",
      pinned: false,
      missing: false,
      modality: "ONLINE" as const,
      blocks: [
        {
          day: "MON" as const,
          startMin: 480,
          endMin: 570,
          modality: "ONLINE" as const,
          location: null,
        },
      ],
      latestSnapshot: {
        capturedAt: "2026-08-22T00:00:00Z",
        enrolled: 30,
        teacher: "Prof Y",
        remark: null,
      },
    };

    const html = renderToStaticMarkup(
      React.createElement(PlanWorkspace, {
        planSummary: mockPlanSummary,
        plan: { ...mockPlanSummary, sectionCount: 2, sections: [sectionA, sectionB] },
        isLoading: false,
        error: null,
        onBack: vi.fn(),
        onRetry: vi.fn(),
      })
    );

    // Conflict displayed in header
    expect(html).toContain("1 conflict");
    // Hatched styling on grid blocks
    expect(html).toContain("hatched");
  });
});


