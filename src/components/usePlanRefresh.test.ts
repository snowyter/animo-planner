import { beforeEach, describe, expect, it, vi } from "vitest";
import * as client from "../adapters/ipc/client";
import { usePlanRefreshState } from "./usePlanRefresh";
import type { MissingSection, RefreshOutcome, RefreshProgress, Section } from "../adapters/ipc/types";

vi.mock("../adapters/ipc/client", () => ({
  startRefresh: vi.fn(),
  resumeRefresh: vi.fn(),
  getMissingSections: vi.fn(),
  onRefreshProgress: vi.fn().mockResolvedValue(() => {}),
}));

describe("usePlanRefreshState", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(client.getMissingSections).mockResolvedValue([]);
    vi.mocked(client.onRefreshProgress).mockResolvedValue(() => {});
  });

  it("initializes with default idle state", () => {
    const state = usePlanRefreshState({ planId: "p1" });
    expect(state.isRefreshing).toBe(false);
    expect(state.progress).toBeNull();
    expect(state.outcome).toBeNull();
    expect(state.sessionExpired).toBe(false);
    expect(state.offline).toBe(false);
    expect(state.error).toBeNull();
    expect(state.missingSections).toEqual([]);
  });

  it("handles a successful full refresh run", async () => {
    const onPlanUpdated = vi.fn();
    const state = usePlanRefreshState({ planId: "p1", onPlanUpdated });

    const completeOutcome: RefreshOutcome = {
      status: "complete",
      refreshedCourses: 3,
      totalCourses: 3,
      haltedAfterCourseCode: null,
    };
    vi.mocked(client.startRefresh).mockResolvedValue(completeOutcome);

    const promise = state.startRefresh();
    expect(state.isRefreshing).toBe(true);

    const outcome = await promise;
    expect(outcome).toEqual(completeOutcome);
    expect(state.isRefreshing).toBe(false);
    expect(state.outcome).toEqual(completeOutcome);
    expect(state.sessionExpired).toBe(false);
    expect(state.offline).toBe(false);
    expect(state.error).toBeNull();

    expect(client.startRefresh).toHaveBeenCalledWith({ planId: "p1" });
    expect(client.getMissingSections).toHaveBeenCalledWith({ planId: "p1" });
    expect(onPlanUpdated).toHaveBeenCalled();
  });

  it("handles session expiry and keeps partial results on screen", async () => {
    const onPlanUpdated = vi.fn();
    const state = usePlanRefreshState({ planId: "p1", onPlanUpdated });

    const expiredOutcome: RefreshOutcome = {
      status: "session_expired",
      refreshedCourses: 2,
      totalCourses: 3,
      haltedAfterCourseCode: "GEARTAP",
    };
    vi.mocked(client.startRefresh).mockResolvedValue(expiredOutcome);

    const outcome = await state.startRefresh();
    expect(outcome).toEqual(expiredOutcome);
    expect(state.isRefreshing).toBe(false);
    expect(state.sessionExpired).toBe(true);
    expect(state.outcome).toEqual(expiredOutcome);
    expect(state.offline).toBe(false);
    // Partial results are kept and plan is updated
    expect(onPlanUpdated).toHaveBeenCalled();
  });

  it("resumes a halted refresh and continues from where it stopped", async () => {
    const onPlanUpdated = vi.fn();
    const state = usePlanRefreshState({ planId: "p1", onPlanUpdated });

    const completeOutcome: RefreshOutcome = {
      status: "complete",
      refreshedCourses: 3,
      totalCourses: 3,
      haltedAfterCourseCode: null,
    };
    vi.mocked(client.resumeRefresh).mockResolvedValue(completeOutcome);

    const outcome = await state.resumeRefresh();
    expect(outcome).toEqual(completeOutcome);
    expect(state.isRefreshing).toBe(false);
    expect(state.sessionExpired).toBe(false);
    expect(state.outcome).toEqual(completeOutcome);
    expect(client.resumeRefresh).toHaveBeenCalledWith({ planId: "p1" });
    expect(onPlanUpdated).toHaveBeenCalled();
  });

  it("handles offline status plainly without modifying plan", async () => {
    const onPlanUpdated = vi.fn();
    const state = usePlanRefreshState({ planId: "p1", onPlanUpdated });

    const offlineOutcome: RefreshOutcome = {
      status: "offline",
      refreshedCourses: 0,
      totalCourses: 3,
      haltedAfterCourseCode: null,
    };
    vi.mocked(client.startRefresh).mockResolvedValue(offlineOutcome);

    const outcome = await state.startRefresh();
    expect(outcome).toEqual(offlineOutcome);
    expect(state.isRefreshing).toBe(false);
    expect(state.offline).toBe(true);
    expect(state.sessionExpired).toBe(false);
  });

  it("updates progress and notifies listener as each course lands", () => {
    const onPlanUpdated = vi.fn();
    const state = usePlanRefreshState({ planId: "p1", onPlanUpdated });

    const progress: RefreshProgress = {
      courseIndex: 1,
      courseTotal: 3,
      courseCode: "GEARTAP",
    };
    state.handleRefreshProgress(progress);

    expect(state.progress).toEqual(progress);
    expect(onPlanUpdated).toHaveBeenCalled();
  });

  it("loads and exposes missing sections", async () => {
    const missing: MissingSection[] = [
      {
        courseId: 2923,
        sectionId: 384,
        sectionCode: "Y31",
        alternatives: [
          {
            campusId: 7,
            sessionId: 155,
            courseId: 2923,
            courseCode: "GEARTAP",
            courseTitle: "Art Appreciation",
            sectionId: 385,
            sectionCode: "Y32",
            courseType: "Lecture",
            credits: 3,
            enrollCap: 45,
            startDate: "2026-07-10",
            endDate: "2026-12-09",
            firstSeenAt: "2026-08-24T00:00:00Z",
            lastSeenAt: "2026-08-24T00:00:00Z",
            modality: "F2F",
            blocks: [],
            latestSnapshot: {
              capturedAt: "2026-08-24T00:00:00Z",
              enrolled: 40,
              teacher: "Prof B",
              remark: null,
            },
          } as Section,
        ],
      },
    ];

    vi.mocked(client.getMissingSections).mockResolvedValue(missing);

    const state = usePlanRefreshState({ planId: "p1" });
    await state.fetchMissingSections();

    expect(state.missingSections).toEqual(missing);
    expect(client.getMissingSections).toHaveBeenCalledWith({ planId: "p1" });
  });

  it("surfaces errors when startRefresh rejects", async () => {
    vi.mocked(client.startRefresh).mockRejectedValue(new Error("network error"));
    const state = usePlanRefreshState({ planId: "p1" });

    await expect(state.startRefresh()).rejects.toThrow("network error");
    expect(state.isRefreshing).toBe(false);
    expect(state.error).toBe("network error");
  });
});
