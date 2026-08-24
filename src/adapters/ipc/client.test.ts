import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock, listenMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  listenMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/api/event", () => ({ listen: listenMock }));

import * as client from "./client";

describe("ipc client", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    listenMock.mockReset();
  });

  it("maps each function to its exact command name and passes arguments through", async () => {
    invokeMock.mockResolvedValue(undefined);

    const cases: Array<[() => Promise<unknown>, string, unknown[]]> = [
      [client.getCampusOptions, "get_campus_options", []],
      [client.getSessionOptions, "get_session_options", []],
      [client.getAppInfo, "get_app_info", []],
      [client.listPlans, "list_plans", []],
      [client.seedSamplePlan, "seed_sample_plan", []],
      [client.clearBrowserSession, "clear_browser_session", []],
      [client.cancelSolve, "cancel_solve", []],
      [
        () => client.createPlan({ name: "T1", campusId: 7, sessionId: 155 }),
        "create_plan",
        [{ name: "T1", campusId: 7, sessionId: 155 }],
      ],
      [
        () => client.deletePlan({ planId: "p1" }),
        "delete_plan",
        [{ planId: "p1" }],
      ],
      [
        () => client.getPlan({ planId: "p1" }),
        "get_plan",
        [{ planId: "p1" }],
      ],
      [
        () => client.listCapturedCourses({ campusId: 7, sessionId: 155 }),
        "list_captured_courses",
        [{ campusId: 7, sessionId: 155 }],
      ],
      [
        () =>
          client.listCapturedSections({ campusId: 7, sessionId: 155, courseId: 2923 }),
        "list_captured_sections",
        [{ campusId: 7, sessionId: 155, courseId: 2923 }],
      ],
      [
        () => client.addSectionToPlan({ planId: "p1", courseId: 2923, sectionId: 384 }),
        "add_section_to_plan",
        [{ planId: "p1", courseId: 2923, sectionId: 384 }],
      ],
      [
        () => client.removeSectionFromPlan({ planId: "p1", courseId: 2923, sectionId: 384 }),
        "remove_section_from_plan",
        [{ planId: "p1", courseId: 2923, sectionId: 384 }],
      ],
      [
        () => client.setSectionPinned({ planId: "p1", courseId: 2923, sectionId: 384, pinned: true }),
        "set_section_pinned",
        [{ planId: "p1", courseId: 2923, sectionId: 384, pinned: true }],
      ],
      [
        () => client.getPlanConflicts({ planId: "p1" }),
        "get_plan_conflicts",
        [{ planId: "p1" }],
      ],
      [
        () =>
          client.applySolution({
            planId: "p1",
            sections: [{ courseId: 2923, sectionId: 384 }],
          }),
        "apply_solution",
        [{ planId: "p1", sections: [{ courseId: 2923, sectionId: 384 }] }],
      ],
      [
        () => client.openCaptureWindow({ campusId: 7, sessionId: 155 }),
        "open_capture_window",
        [{ campusId: 7, sessionId: 155 }],
      ],
      [
        () => client.getCaptureSummary({ campusId: 7, sessionId: 155 }),
        "get_capture_summary",
        [{ campusId: 7, sessionId: 155 }],
      ],
      [
        () => client.undoLastCapture({ campusId: 7, sessionId: 155 }),
        "undo_last_capture",
        [{ campusId: 7, sessionId: 155 }],
      ],
      [
        () =>
          client.solvePlan({
            planId: "p1",
            options: {
              preset: "fewest_campus_days",
              dayBlacklist: [],
              earliestStartMin: null,
              latestEndMin: null,
              excludeFull: false,
              resultLimit: 12,
            },
          }),
        "solve_plan",
        [
          {
            planId: "p1",
            options: {
              preset: "fewest_campus_days",
              dayBlacklist: [],
              earliestStartMin: null,
              latestEndMin: null,
              excludeFull: false,
              resultLimit: 12,
            },
          },
        ],
      ],
      [
        () => client.continueSolve({ planId: "p1", resumeToken: "tok" }),
        "continue_solve",
        [{ planId: "p1", resumeToken: "tok" }],
      ],
      [
        () => client.startRefresh({ planId: "p1" }),
        "start_refresh",
        [{ planId: "p1" }],
      ],
      [
        () => client.resumeRefresh({ planId: "p1" }),
        "resume_refresh",
        [{ planId: "p1" }],
      ],
      [
        () => client.getMissingSections({ planId: "p1" }),
        "get_missing_sections",
        [{ planId: "p1" }],
      ],
      [
        () => client.exportPlanIcs({ planId: "p1" }),
        "export_plan_ics",
        [{ planId: "p1" }],
      ],
      [
        () => client.buildCaptureReport({ error: "boom" }),
        "build_capture_report",
        [{ error: "boom" }],
      ],
    ];

    for (const [call, name, args] of cases) {
      invokeMock.mockClear();
      await call();
      expect(invokeMock).toHaveBeenCalledTimes(1);
      expect(invokeMock).toHaveBeenCalledWith(name, ...args);
    }
  });

  it("propagates the identifiable unimplemented error instead of returning plausible data", async () => {
    invokeMock.mockRejectedValue("unimplemented: get_plan");
    await expect(client.getPlan({ planId: "p1" })).rejects.toBe(
      "unimplemented: get_plan",
    );
  });

  it("rejects rather than resolving empty data when the backend fails", async () => {
    invokeMock.mockRejectedValue("unimplemented: list_plans");
    const result = client.listPlans().then(
      () => "resolved",
      (error) => error,
    );
    await expect(result).resolves.toBe("unimplemented: list_plans");
  });

  it("registers typed event listeners on the declared event names", async () => {
    const unlisten = vi.fn();
    listenMock.mockResolvedValue(unlisten);

    const handler = vi.fn();
    const result = await client.onCaptureUpdated(handler);
    expect(listenMock).toHaveBeenCalledWith("capture:updated", expect.any(Function));

    const registered = listenMock.mock.calls[0][1] as (event: {
      payload: unknown;
    }) => void;
    const payload = { campusId: 7, sessionId: 155, sectionCount: 42, courseCount: 8, canUndo: true };
    registered({ payload });
    expect(handler).toHaveBeenCalledWith(payload);
    expect(result).toBe(unlisten);

    listenMock.mockClear();
    const failedHandler = vi.fn();
    await client.onCaptureFailed(failedHandler);
    expect(listenMock).toHaveBeenCalledWith("capture:failed", expect.any(Function));

    listenMock.mockClear();
    const progressHandler = vi.fn();
    await client.onRefreshProgress(progressHandler);
    expect(listenMock).toHaveBeenCalledWith("refresh:progress", expect.any(Function));
  });
});
