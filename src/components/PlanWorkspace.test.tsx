import { beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PlanWorkspace } from "./PlanWorkspace";
import * as client from "../adapters/ipc/client";
import type { Plan, PlanSection, PlanSummary, ScheduleBlock, Section, Solution } from "../adapters/ipc/types";
import planWorkspaceSource from "./PlanWorkspace.tsx?raw";

vi.mock("../adapters/ipc/client", () => ({
  getCaptureSummary: vi.fn(),
  openCaptureWindow: vi.fn(),
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

  it("offers the picker and the solver as tools, not as entry points", () => {
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

    // The fork between "pick my own" and "let the solver build it" was never
    // a mode (SPEC §7); it is now two tabs over the same permanent grid.
    expect(html).toContain("Capture");
    expect(html).toContain("Solve");
    expect(html).toContain("Pick");
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

  it("renders the capture bar with open Archer's Hub button and credential disclaimer", () => {
    const html = renderToStaticMarkup(
      React.createElement(PlanWorkspace, {
        planSummary: mockPlanSummary,
        plan: null,
        isLoading: false,
        error: null,
        initialToolsOpen: true,
        onBack: vi.fn(),
        onRetry: vi.fn(),
      })
    );

    expect(html).toContain("Open Archer&#x27;s Hub");
    expect(html).toContain("Capture Sections");
    expect(html).toMatch(/never (?:sees, captures, or )?stores (?:your )?credentials/i);
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
        initialTab: "pick",
        initialToolsOpen: true,
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
          included: true,
          lastRefreshedAt: null,
        },
      ],
      selectedCourseId: 2923,
      sections: [],
      isLoadingCourses: false,
      isLoadingSections: false,
      isMutating: false,
      error: null,
      notice: null,
      hoveredSection: null,
      setHoveredSection: vi.fn(),
      fetchCourses: vi.fn(),
      syncCourses: vi.fn(),
      selectCourse: vi.fn(),
      addSection: vi.fn(),
      removeSection: vi.fn(),
      togglePin: vi.fn(),
      forgetCourse: vi.fn(),
      setCourseIncluded: vi.fn(),
      dismissNotice: vi.fn(),
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
        initialTab: "pick",
        initialToolsOpen: true,
        onBack: vi.fn(),
        onRetry: vi.fn(),
      })
    );

    expect(html).toContain("Remove course from catalog");
    expect(html).toContain('data-testid="remove-course-button"');

    spy.mockRestore();
  });

  it("holds the solver in a tab of its own rather than behind a button", () => {
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
        initialTab: "solve",
        initialToolsOpen: true,
        onBack: vi.fn(),
        onRetry: vi.fn(),
      })
    );

    expect(html).toContain("Solve the rest");
    expect(html).toContain('data-testid="solve-panel"');
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
        initialToolsOpen: true,
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

  it("renders Clear schedule action disabled when the plan is empty", () => {
    const mockEmptyPlan: Plan = {
      ...mockPlanSummary,
      sectionCount: 0,
      sections: [],
    };

    const html = renderToStaticMarkup(
      React.createElement(PlanWorkspace, {
        planSummary: mockPlanSummary,
        plan: mockEmptyPlan,
        isLoading: false,
        error: null,
        onBack: vi.fn(),
        onRetry: vi.fn(),
      })
    );

    expect(html).toContain("Clear schedule");
    const match = html.match(/<button[^>]*data-testid="clear-schedule-button"[^>]*>/);
    expect(match).not.toBeNull();
    expect(match![0]).toContain('disabled=""');
  });

  it("renders Clear schedule action enabled when plan has sections", () => {
    const sectionA = makeSection(
      2923,
      384,
      "GEARTAP",
      "S11",
      [makeBlock("MON", 450, 540, "F2F", "L226")]
    );

    const mockPlanWithSections: Plan = {
      ...mockPlanSummary,
      sectionCount: 1,
      sections: [sectionA],
    };

    const html = renderToStaticMarkup(
      React.createElement(PlanWorkspace, {
        planSummary: mockPlanSummary,
        plan: mockPlanWithSections,
        isLoading: false,
        error: null,
        onBack: vi.fn(),
        onRetry: vi.fn(),
      })
    );

    expect(html).toContain("Clear schedule");
    const match = html.match(/<button[^>]*data-testid="clear-schedule-button"[^>]*>/);
    expect(match).not.toBeNull();
    expect(match![0]).not.toContain('disabled=""');
  });

  it("renders Clear schedule confirmation dialog naming section count and plan name", () => {
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
      [makeBlock("TUE", 450, 540, "F2F", "Y603")]
    );

    const mockPlanWithSections: Plan = {
      ...mockPlanSummary,
      name: "T1 Schedule",
      sectionCount: 2,
      sections: [sectionA, sectionB],
    };

    const html = renderToStaticMarkup(
      React.createElement(PlanWorkspace, {
        planSummary: { ...mockPlanSummary, name: "T1 Schedule" },
        plan: mockPlanWithSections,
        isLoading: false,
        error: null,
        initialConfirmingClear: true,
        onBack: vi.fn(),
        onRetry: vi.fn(),
      })
    );

    expect(html).toContain("Clear schedule?");
    expect(html).toContain("2 sections");
    expect(html).toContain("T1 Schedule");
    expect(html).toContain("Captured courses and sections in your catalog will not be deleted");
    expect(html).toContain('data-testid="confirm-clear-schedule"');
    expect(html).toContain('data-testid="cancel-clear-schedule"');
  });

  it("renders Clear schedule confirmation dialog naming pinned count when plan has pinned sections", () => {
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
      [makeBlock("TUE", 450, 540, "F2F", "Y603")]
    );
    sectionB.pinned = true;

    const mockPlanWithSections: Plan = {
      ...mockPlanSummary,
      name: "T1 Schedule",
      sectionCount: 2,
      sections: [sectionA, sectionB],
    };

    const html = renderToStaticMarkup(
      React.createElement(PlanWorkspace, {
        planSummary: { ...mockPlanSummary, name: "T1 Schedule" },
        plan: mockPlanWithSections,
        isLoading: false,
        error: null,
        initialConfirmingClear: true,
        onBack: vi.fn(),
        onRetry: vi.fn(),
      })
    );

    expect(html).toContain("Clear schedule?");
    expect(html).toContain("2 sections");
    expect(html).toContain("including");
    expect(html).toContain("1 pinned section");
    expect(html).toContain('data-testid="confirm-clear-schedule"');
  });

  it("clears all plan sections via removeSectionFromPlan without deleting courses from catalog", async () => {
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
      [makeBlock("TUE", 450, 540, "F2F", "Y603")]
    );

    const mockPlanWithSections: Plan = {
      ...mockPlanSummary,
      name: "T1 Schedule",
      sectionCount: 2,
      sections: [sectionA, sectionB],
    };

    const emptyReturnedPlan: Plan = {
      ...mockPlanSummary,
      name: "T1 Schedule",
      sectionCount: 0,
      sections: [],
    };

    vi.mocked(client.removeSectionFromPlan).mockResolvedValue(emptyReturnedPlan);

    const onPlanUpdated = vi.fn();
    const onRetry = vi.fn();

    // Render workspace with confirm dialog open
    const html = renderToStaticMarkup(
      React.createElement(PlanWorkspace, {
        planSummary: { ...mockPlanSummary, name: "T1 Schedule" },
        plan: mockPlanWithSections,
        isLoading: false,
        error: null,
        initialConfirmingClear: true,
        onBack: vi.fn(),
        onRetry,
        onPlanUpdated,
      })
    );

    expect(html).toContain('data-testid="confirm-clear-schedule"');
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
  };

  it("renders the tool panel and the week grid side by side", () => {
    const html = renderToStaticMarkup(
      React.createElement(PlanWorkspace, {
        planSummary: mockPlanSummary,
        plan: { ...mockPlanSummary, sections: [] },
        isLoading: false,
        error: null,
        initialToolsOpen: true,
        onBack: vi.fn(),
        onRetry: vi.fn(),
      })
    );

    // Both the tool panel and the week grid are present
    expect(html).toContain('data-testid="tool-panel"');
    expect(html).toContain("Weekly Schedule");

    // Responsive 2-column container exists
    expect(html).toContain('data-testid="workspace-columns"');

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

  // The picker's chrome spans the full width above the columns so the section
  // list starts level with the week grid. Rendering the picker as two halves
  // must not leave two of anything.
  it("renders the course selector exactly once while picking", () => {
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

    expect((html.match(/data-testid="course-select"/g) ?? []).length).toBeLessThanOrEqual(1);
    expect((html.match(/Close section picker/g) ?? []).length).toBeLessThanOrEqual(1);
  });

  it("keeps the picker whole inside the tool panel, not split across the row", () => {
    const html = renderToStaticMarkup(
      React.createElement(PlanWorkspace, {
        planSummary: mockPlanSummary,
        plan: { ...mockPlanSummary, sections: [] },
        isLoading: false,
        error: null,
        initialTab: "pick",
        initialToolsOpen: true,
        onBack: vi.fn(),
        onRetry: vi.fn(),
      })
    );

    const panelAt = html.indexOf('data-testid="tool-panel"');
    expect(panelAt).toBeGreaterThan(-1);

    // The chrome and the section list used to sit in different columns so
    // they would line up with the grid. Inside a tool panel they are one
    // column, and the picker renders whole.
    const panel = html.slice(panelAt);
    expect(panel).toContain("Pick my own sections");
    expect((html.match(/data-testid="course-select"/g) ?? []).length).toBeLessThanOrEqual(1);
  });

  it("orders the week grid ahead of the section list in single-column fallback", () => {
    const html = renderToStaticMarkup(
      React.createElement(PlanWorkspace, {
        planSummary: mockPlanSummary,
        plan: { ...mockPlanSummary, sections: [] },
        isLoading: false,
        error: null,
        initialToolsOpen: true,
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
          included: true,
          lastRefreshedAt: null,
        },
      ],
      selectedCourseId: 2923,
      sections: [ghostCandidate],
      isLoadingCourses: false,
      isLoadingSections: false,
      isMutating: false,
      error: null,
      notice: null,
      hoveredSection: null,
      setHoveredSection: vi.fn(),
      fetchCourses: vi.fn(),
      syncCourses: vi.fn(),
      selectCourse: vi.fn(),
      addSection: vi.fn(),
      removeSection: vi.fn(),
      togglePin: vi.fn(),
      forgetCourse: vi.fn(),
      setCourseIncluded: vi.fn(),
      dismissNotice: vi.fn(),
    });

    const html = renderToStaticMarkup(
      React.createElement(PlanWorkspace, {
        planSummary: mockPlanSummary,
        plan: { ...mockPlanSummary, sections: [] },
        isLoading: false,
        error: null,
        initialTab: "pick",
        initialToolsOpen: true,
        onBack: vi.fn(),
        onRetry: vi.fn(),
      })
    );

    // Picker row is rendered in the tool panel, beside the permanent grid
    spy.mockRestore();
    expect(html).toContain('data-testid="section-row-S11"');
    expect(html).toContain('data-testid="week-grid"');
  });

  it("renders ghost preview with preview badge on the week grid when hovering candidate section", () => {
    const html = renderToStaticMarkup(
      React.createElement(PlanWorkspace, {
        planSummary: mockPlanSummary,
        plan: { ...mockPlanSummary, sections: [] },
        isLoading: false,
        error: null,
        initialToolsOpen: true,
        onBack: vi.fn(),
        onRetry: vi.fn(),
      })
    );

    // Week grid rendered beside the tool panel, on every tab
    expect(html).toContain('data-testid="week-grid"');
    expect(html).toContain('data-testid="tool-panel"');
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



/**
 * Ticket 46 — one tabbed tool panel, one permanent week grid.
 *
 * The workspace was four cards stacked vertically and the grid sat below the
 * fold on the window the app actually opens at. It is now two regions: the
 * tools are tabs, the grid is not.
 */
describe("the tool panel and the permanent week grid", () => {
  const planSummary: PlanSummary = {
    id: "p1",
    name: "T1 Target Schedule",
    campusId: 7,
    campusName: "Manila",
    sessionId: 155,
    sessionName: "AY2026-27 T1",
    createdAt: "2026-08-22T00:00:00Z",
    sectionCount: 0,
  };

  const emptyPlan: Plan = { ...planSummary, sections: [] };

  const planSection: PlanSection = {
    courseId: 2923,
    courseCode: "GEARTAP",
    courseTitle: "Art Appreciation",
    sectionId: 384,
    sectionCode: "S11",
    pinned: false,
    missing: false,
    modality: "F2F",
    blocks: [
      { day: "MON", startMin: 450, endMin: 540, modality: "F2F", location: "L226" },
    ],
    latestSnapshot: {
      capturedAt: "2026-08-22T00:00:00Z",
      enrolled: 42,
      teacher: "Prof X",
      remark: null,
    },
  };

  /**
   * The live week grid alone.
   *
   * Two other things on this page draw the same sections: `ExportMenu`
   * renders an off-screen copy above it (ticket 40), and the Solve panel
   * lists the plan's sections below it. Slicing to the end of the document
   * would catch both.
   */
  const liveGrid = (html: string) =>
    html.slice(
      html.lastIndexOf('data-testid="week-grid"', html.indexOf('data-testid="tool-panel"')),
      html.indexOf('data-testid="tool-panel"')
    );

  const render = (props: Record<string, unknown> = {}) =>
    renderToStaticMarkup(
      React.createElement(PlanWorkspace, {
        planSummary,
        plan: emptyPlan,
        isLoading: false,
        error: null,
        // The panel starts collapsed (see "the collapsible tool panel"
        // below); these assertions are about what it holds when it is open.
        initialToolsOpen: true,
        onBack: vi.fn(),
        onRetry: vi.fn(),
        ...props,
      })
    );

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(client.getCaptureSummary).mockResolvedValue({
      campusId: 7,
      sessionId: 155,
      sectionCount: 42,
      courseCount: 8,
    });
    vi.mocked(client.onCaptureUpdated).mockResolvedValue(() => {});
    vi.mocked(client.onCaptureFailed).mockResolvedValue(() => {});
  });

  describe("the tabs", () => {
    it("offers exactly three tools, in the order the work happens", () => {
      const html = render();
      const labels = [...html.matchAll(/role="tab"[^>]*>([A-Za-z]+)/g)].map((m) => m[1]);

      expect(labels).toEqual(["Capture", "Solve", "Pick"]);
    });

    it("gives the tabs the roles that make arrow keys work", () => {
      const html = render();

      expect(html).toContain('role="tablist"');
      expect(html).toContain('role="tabpanel"');
      // The panel is named by the tab that selects it.
      expect(html).toMatch(/role="tabpanel"[^>]*aria-labelledby="/);
      expect(html).toMatch(/role="tab"[^>]*aria-selected="true"/);
    });

    it("opens on Capture, the arrival surface", () => {
      const html = render();
      const selected = /aria-selected="true"[^>]*>([A-Za-z]+)/.exec(html);

      expect(selected?.[1]).toBe("Capture");
    });

    it("selects the tab it is told to, so the suite can drive it", () => {
      const solve = /aria-selected="true"[^>]*>([A-Za-z]+)/.exec(
        render({ initialTab: "solve" })
      );
      expect(solve?.[1]).toBe("Solve");

      const pick = /aria-selected="true"[^>]*>([A-Za-z]+)/.exec(
        render({ initialTab: "pick" })
      );
      expect(pick?.[1]).toBe("Pick");
    });
  });

  describe("what each tab holds", () => {
    it("Capture keeps the counter, Refresh, and Open Archer's Hub", () => {
      const html = render({ initialTab: "capture" });

      expect(html).toContain('data-testid="capture-counter"');
      expect(html).toContain("Refresh");
      expect(html).toMatch(/Open Archer/);
    });

    it("Capture shows what has landed, not only the way in", () => {
      const html = render({ initialTab: "capture" });

      expect(html).toContain('data-testid="captured-catalog"');
    });

    it("Pick keeps the course dropdown and the bounded section list", async () => {
      const useSectionPickerModule = await import("./useSectionPicker");
      const spy = vi
        .spyOn(useSectionPickerModule, "useSectionPicker")
        .mockReturnValue({
          courses: [
            {
              courseId: 2923,
              code: "GEARTAP",
              title: "Art Appreciation",
              sectionCount: 1,
              firstSeenAt: "2026-08-22T00:00:00Z",
              lastSeenAt: "2026-08-22T00:00:00Z",
              included: true,
              lastRefreshedAt: null,
            },
          ],
          selectedCourseId: 2923,
          sections: [],
          isLoadingCourses: false,
          isLoadingSections: false,
          isMutating: false,
          error: null,
          notice: null,
          hoveredSection: null,
          setHoveredSection: vi.fn(),
          fetchCourses: vi.fn(),
          syncCourses: vi.fn(),
          selectCourse: vi.fn(),
          addSection: vi.fn(),
          removeSection: vi.fn(),
          togglePin: vi.fn(),
          forgetCourse: vi.fn(),
          setCourseIncluded: vi.fn(),
          dismissNotice: vi.fn(),
        } as unknown as ReturnType<typeof useSectionPickerModule.useSectionPicker>);

      const html = render({ initialTab: "pick" });
      spy.mockRestore();

      expect(html).toContain('data-testid="course-select"');
      expect(html).toContain("Pick my own sections");
    });

    it("Solve is a panel in the tool column, never a modal", () => {
      const html = render({ initialTab: "solve" });

      expect(html).toContain('data-testid="solve-panel"');
      expect(html).not.toContain('role="dialog"');
    });
  });

  describe("the layout", () => {
    it("draws the week grid on every tab, in the same place", () => {
      for (const initialTab of ["capture", "solve", "pick"]) {
        const html = render({ initialTab });
        expect(
          html,
          `the grid must be present on the ${initialTab} tab`
        ).toContain('data-testid="week-grid"');
        expect(html).toContain('data-testid="grid-region"');
      }
    });

    it("keeps the plan header above both regions, untabbed", () => {
      const html = render();
      const header = html.indexOf("T1 Target Schedule");
      const tablist = html.indexOf('role="tablist"');

      expect(header).toBeGreaterThan(-1);
      expect(tablist).toBeGreaterThan(header);
    });

    it("gives the grid the larger share of a two-column row from lg", () => {
      const html = render();
      const columns = html.slice(html.indexOf('data-testid="workspace-columns"'));

      // The app opens at 1400x900 with a 1024 minimum: two columns from lg.
      expect(columns).toMatch(/lg:flex-row|lg:grid/);
      expect(columns).not.toMatch(/xl:flex-row|xl:grid/);
      // The tool panel is the fixed column; the grid takes what is left.
      expect(columns).toMatch(/lg:w-\[\d+px\]/);
      expect(columns).toContain("lg:flex-1");
    });

    it("scrolls the tool panel inside its own bounds rather than growing the page", () => {
      const html = render();
      const panel = /<div[^>]*data-testid="tool-panel"[^>]*>/.exec(html);
      const scroll = /<div[^>]*data-testid="tool-panel-scroll"[^>]*>/.exec(html);

      expect(panel, "the tool panel must be findable").not.toBeNull();
      expect(panel![0]).toMatch(/max-h-/);
      expect(scroll, "the tool must have its own scroll region").not.toBeNull();
      expect(scroll![0]).toMatch(/overflow-y-auto/);
    });

    it("keeps the tab strip still while the tool under it scrolls", () => {
      const html = render();
      const tablist = html.indexOf('role="tablist"');
      const scroll = html.indexOf('data-testid="tool-panel-scroll"');

      expect(tablist).toBeGreaterThan(-1);
      expect(scroll).toBeGreaterThan(-1);
      // Outside the scroll region, not merely `sticky` inside it: a sticky
      // offset would have to be kept in sync with the strip's own height,
      // and the picker's course selector pins to the same edge.
      expect(
        tablist,
        "Capture / Solve / Pick must not scroll away with the panel"
      ).toBeLessThan(scroll);
    });

    it("puts the grid above the panel when the row stops fitting", () => {
      const html = render();
      const columns = html.slice(html.indexOf('data-testid="workspace-columns"'));
      const grid = columns.indexOf('data-testid="grid-region"');
      const panel = columns.indexOf('data-testid="tool-panel"');

      expect(grid).toBeGreaterThan(-1);
      expect(panel).toBeGreaterThan(-1);
      // Source order is the stacked order; `order-*` puts the panel first
      // again once there are two columns.
      expect(grid).toBeLessThan(panel);
      expect(columns).toMatch(/lg:order-1/);
      expect(columns).toMatch(/lg:order-2/);
    });
  });

  describe("nothing gets hidden that must be seen", () => {
    it("keeps global notices outside the tabs, visible from every one of them", async () => {
      const usePlanRefreshModule = await import("./usePlanRefresh");
      const spy = vi.spyOn(usePlanRefreshModule, "usePlanRefresh").mockReturnValue({
        isRefreshing: false,
        isResuming: false,
        progress: null,
        outcome: null,
        sessionExpired: true,
        offline: false,
        error: null,
        missingSections: [],
        startRefresh: vi.fn(),
        resumeRefresh: vi.fn(),
        fetchMissingSections: vi.fn(),
        dismissNotice: vi.fn(),
      } as unknown as ReturnType<typeof usePlanRefreshModule.usePlanRefresh>);

      for (const initialTab of ["capture", "solve", "pick"]) {
        const html = render({ initialTab });
        expect(
          html,
          `a dead refresh must be visible from the ${initialTab} tab`
        ).toContain("Session expired");
      }

      spy.mockRestore();
    });

    it("marks the Capture tab while the catalog behind it is empty", () => {
      const html = render();
      const trigger = /data-empty-catalog="true"[\s\S]*?<\/button>/.exec(html);

      expect(trigger, "the Capture trigger must carry the signal").not.toBeNull();
      expect(trigger![0]).toContain("Capture");
      expect(trigger![0]).toContain("Empty");
    });

    it("points an empty Pick tab at the tab that fixes it", () => {
      const html = render({ initialTab: "pick" });

      expect(html).toContain("No captured courses");
      expect(html).toMatch(/Capture tab/);
    });
  });

  describe("the solver previews on the real grid", () => {
    const previewSolution: Solution = {
      id: "solution-0",
      score: 150,
      breakdown: [],
      warnings: [],
      sections: [
        {
          courseId: 2923,
          courseCode: "GEARTAP",
          sectionId: 385,
          sectionCode: "S12",
          pinned: false,
          blocks: [
            {
              day: "THU",
              startMin: 450,
              endMin: 540,
              modality: "F2F",
              location: "L226",
            },
          ],
        },
      ],
    };

    it("draws the whole selected solution on the week grid, at full size", () => {
      const html = render({
        initialTab: "solve",
        initialPreviewSolution: previewSolution,
      });

      const grid = liveGrid(html);
      expect(grid).toContain("S12");
      expect(grid).toContain('data-ghost="true"');
    });

    it("lets the student commit the schedule from the grid they are reading", () => {
      const html = render({
        initialTab: "solve",
        initialPreviewSolution: previewSolution,
      });

      expect(html).toContain('data-testid="week-grid-apply-preview"');
      expect(html).toContain("Apply this schedule");
    });

    it("says the preview is a preview and offers the way back", () => {
      const html = render({
        initialTab: "solve",
        initialPreviewSolution: previewSolution,
      });

      expect(html).toContain('data-testid="week-grid-preview-notice"');
      expect(html).toContain("Previewing Schedule #1");
      expect(html).toContain('data-testid="week-grid-clear-preview"');
    });

    it("hides the plan behind the preview so the two are never read as one", () => {
      const html = render({
        initialTab: "solve",
        plan: { ...planSummary, sectionCount: 1, sections: [planSection] },
        initialPreviewSolution: previewSolution,
      });

      const grid = liveGrid(html);
      expect(grid).toContain("S12");
      expect(grid).not.toContain("S11");
    });

    it("shows the real plan again once nothing is selected", () => {
      const html = render({
        initialTab: "solve",
        plan: { ...planSummary, sectionCount: 1, sections: [planSection] },
      });

      const grid = liveGrid(html);
      expect(grid).toContain("S11");
      expect(html).not.toContain('data-testid="week-grid-preview-notice"');
    });
  });

  /**
   * Capturing a course and intending to take it are different acts.
   */
  describe("choosing which courses count", () => {
    const catalog = [
      {
        courseId: 2923,
        code: "GEARTAP",
        title: "Art Appreciation",
        sectionCount: 42,
        firstSeenAt: "2026-08-22T00:00:00Z",
        lastSeenAt: "2026-08-22T00:00:00Z",
        included: true,
        lastRefreshedAt: null,
      },
      {
        courseId: 564,
        code: "CSINTSY",
        title: "Intelligent Systems",
        sectionCount: 5,
        firstSeenAt: "2026-08-22T00:00:00Z",
        lastSeenAt: "2026-08-22T00:00:00Z",
        included: false,
        lastRefreshedAt: null,
      },
    ];

    const withCatalog = async () => {
      const useSectionPickerModule = await import("./useSectionPicker");
      return vi.spyOn(useSectionPickerModule, "useSectionPicker").mockReturnValue({
        courses: catalog,
        selectedCourseId: 2923,
        sections: [],
        isLoadingCourses: false,
        isLoadingSections: false,
        isMutating: false,
        error: null,
        notice: null,
        hoveredSection: null,
        setHoveredSection: vi.fn(),
        fetchCourses: vi.fn(),
        syncCourses: vi.fn(),
        selectCourse: vi.fn(),
        addSection: vi.fn(),
        removeSection: vi.fn(),
        togglePin: vi.fn(),
        forgetCourse: vi.fn(),
        setCourseIncluded: vi.fn(),
        dismissNotice: vi.fn(),
      } as unknown as ReturnType<typeof useSectionPickerModule.useSectionPicker>);
    };

    it("shows the whole catalog on Capture, checked and unchecked alike", async () => {
      const spy = await withCatalog();
      const html = render({ initialTab: "capture" });
      spy.mockRestore();

      // Excluding is not forgetting — an unchecked course is still managed here.
      expect(html).toContain('data-testid="captured-course-2923"');
      expect(html).toContain('data-testid="captured-course-564"');
      expect(html).toContain('data-testid="include-course-564"');
      expect(html).toContain('data-testid="forget-course-564"');
    });

    it("offers only the checked courses to the picker", async () => {
      const spy = await withCatalog();
      const html = render({ initialTab: "pick" });
      spy.mockRestore();

      const select = html.slice(html.indexOf('data-testid="course-select"'));
      const options = select.slice(0, select.indexOf("</select>"));
      expect(options).toContain("GEARTAP");
      expect(
        options,
        "an unchecked course is not one the student is picking sections for"
      ).not.toContain("CSINTSY");
    });
  });

  /**
   * The tools fold away so the schedule can have the window.
   *
   * The grid is the artifact; the three tools act on it, and a student
   * comparing a full week does not need any of them on screen. Opening a plan
   * is that moment, so the panel starts folded and the schedule starts whole.
   */
  describe("the collapsible tool panel", () => {
    it("opens a plan on the schedule, with the tools folded away", () => {
      const html = renderToStaticMarkup(
        React.createElement(PlanWorkspace, {
          planSummary,
          plan: emptyPlan,
          isLoading: false,
          error: null,
          onBack: vi.fn(),
          onRetry: vi.fn(),
        })
      );

      expect(html).not.toContain('data-testid="tool-panel"');
      expect(html).toContain('data-testid="week-grid"');
    });

    it("gives the grid the whole row while the tools are folded", () => {
      const html = renderToStaticMarkup(
        React.createElement(PlanWorkspace, {
          planSummary,
          plan: emptyPlan,
          isLoading: false,
          error: null,
          onBack: vi.fn(),
          onRetry: vi.fn(),
        })
      );

      const region = /<div[^>]*data-testid="grid-region"[^>]*>/.exec(html);
      expect(region).not.toBeNull();
      // No fixed column beside it to leave room for.
      expect(region![0]).not.toMatch(/lg:sticky/);
      expect(region![0]).toMatch(/w-full/);
    });

    it("names the way back, so the tools are never merely gone", () => {
      const html = renderToStaticMarkup(
        React.createElement(PlanWorkspace, {
          planSummary,
          plan: emptyPlan,
          isLoading: false,
          error: null,
          onBack: vi.fn(),
          onRetry: vi.fn(),
        })
      );

      const show = /<button[^>]*data-testid="show-tools"[^>]*>[\s\S]*?<\/button>/.exec(
        html
      );
      expect(show, "a folded panel must say how to unfold it").not.toBeNull();
      expect(show![0]).toMatch(/Tools/);
    });

    it("offers the way to fold them again once they are open", () => {
      const html = render();

      expect(html).toContain('data-testid="hide-tools"');
      expect(html).not.toContain('data-testid="show-tools"');
    });

    it("carries the empty-catalog signal even while the tools are folded", () => {
      // Folding hides more state than a tab does. A student who opens a plan
      // with nothing captured must still see that the catalog is empty.
      const html = renderToStaticMarkup(
        React.createElement(PlanWorkspace, {
          planSummary,
          plan: emptyPlan,
          isLoading: false,
          error: null,
          onBack: vi.fn(),
          onRetry: vi.fn(),
        })
      );

      const show = /<button[^>]*data-testid="show-tools"[^>]*>[\s\S]*?<\/button>/.exec(
        html
      );
      expect(show![0]).toContain("Empty");
    });

    it("keeps global notices visible while the tools are folded", async () => {
      const usePlanRefreshModule = await import("./usePlanRefresh");
      const spy = vi.spyOn(usePlanRefreshModule, "usePlanRefresh").mockReturnValue({
        isRefreshing: false,
        isResuming: false,
        progress: null,
        outcome: null,
        sessionExpired: true,
        offline: false,
        error: null,
        missingSections: [],
        startRefresh: vi.fn(),
        resumeRefresh: vi.fn(),
        fetchMissingSections: vi.fn(),
        dismissNotice: vi.fn(),
      } as unknown as ReturnType<typeof usePlanRefreshModule.usePlanRefresh>);

      const html = renderToStaticMarkup(
        React.createElement(PlanWorkspace, {
          planSummary,
          plan: emptyPlan,
          isLoading: false,
          error: null,
          onBack: vi.fn(),
          onRetry: vi.fn(),
        })
      );
      spy.mockRestore();

      expect(html).toContain("Session expired");
    });
  });

  /**
   * Export exported the schedule from two places at once — the plan banner and
   * the schedule's own header — and each rendered its own off-screen copy of
   * the week grid to do it (ticket 40).
   */
  describe("one Export, beside the thing it exports", () => {
    it("offers exactly one export control", () => {
      const html = render();

      expect(html.match(/data-testid="export-wrapper"/g)).toHaveLength(1);
    });

    it("keeps it in the schedule header, not up in the plan banner", () => {
      const html = render();
      const planBanner = html.slice(0, html.indexOf('data-testid="workspace-columns"'));

      expect(planBanner).toContain("Plan Scope:");
      expect(planBanner, "the plan banner carries identity and counts, not actions").not.toContain(
        "Export"
      );
      expect(html.indexOf("Export")).toBeGreaterThan(html.indexOf("Weekly Schedule"));
    });
  });

  // Every mutation reloads the plan. Landing back on Capture after adding a
  // section would be maddening, and the suite cannot re-render to prove it —
  // so the guard is that nothing derives the selected tab from the plan.
  it("keeps the selected tab in state a plan reload cannot reach", () => {
    expect(planWorkspaceSource).toMatch(/useState<ToolTab>\(/);
    expect(planWorkspaceSource).not.toMatch(/setActiveTab[\s\S]{0,80}\[plan/);
    const effects = planWorkspaceSource.match(/useEffect\([\s\S]*?\}, \[[^\]]*\]\)/g) ?? [];
    for (const effect of effects) {
      expect(effect, "no effect may reset the selected tab").not.toContain(
        "setActiveTab"
      );
    }
  });
});

/**
 * Source-level guard. The suite renders to static markup, so it cannot click
 * "Remove course from catalog" and watch the week grid; the seam this covers
 * is which handlers reload the plan after changing it.
 *
 * Forgetting a course releases its sections from every plan holding them
 * (ticket 35), so it changes the open plan as surely as removing a section
 * does. It shipped without the reload every other mutating handler performs,
 * and the week grid kept drawing blocks for released sections until the
 * student pressed Refresh.
 */
describe("PlanWorkspace plan-mutating handlers reload the plan", () => {
  const handlerBody = (name: string): string => {
    const start = planWorkspaceSource.indexOf(`const ${name} = async (`);
    expect(start, `${name} must exist in PlanWorkspace`).toBeGreaterThan(-1);
    // Ends at the first close-brace back at the handler's own indentation.
    // Slicing to the next `const` instead would run to end of file for the
    // last handler and swallow every `onRetry()` in the JSX below it.
    const end = planWorkspaceSource.indexOf("\n  };", start);
    expect(end, `${name} must be a complete arrow function`).toBeGreaterThan(start);
    return planWorkspaceSource.slice(start, end);
  };

  it.each([
    "handleRemoveCourse",
    "handleRemoveMissingSection",
    "handleClearSchedule",
    "handleRemoveSection",
    "handleTogglePin",
  ])("%s calls onRetry so the week grid re-renders without a manual refresh", (name) => {
    expect(handlerBody(name)).toContain("onRetry()");
  });

  it("wires onTogglePin, onRemoveSection, and onShowOtherSections to WeekGrid in PlanWorkspace JSX", () => {
    expect(planWorkspaceSource).toContain("onTogglePin={handleTogglePin}");
    expect(planWorkspaceSource).toContain("onRemoveSection={handleRemoveSection}");
    expect(planWorkspaceSource).toContain("onShowOtherSections=");
  });
});

