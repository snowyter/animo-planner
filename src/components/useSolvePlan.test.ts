import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSolvePlanState } from "./useSolvePlan";
import * as client from "../adapters/ipc/client";
import type { Plan, Solution, SolveResult } from "../adapters/ipc/types";

vi.mock("../adapters/ipc/client", () => ({
  solvePlan: vi.fn(),
  continueSolve: vi.fn(),
  cancelSolve: vi.fn(),
  applySolution: vi.fn(),
}));

describe("useSolvePlanState", () => {
  const planId = "plan-123";

  const mockSolution: Solution = {
    id: "solution-0",
    score: 120,
    breakdown: [{ label: "Campus days", points: 120 }],
    warnings: [],
    sections: [
      {
        courseId: 2923,
        courseCode: "GEARTAP",
        sectionId: 384,
        sectionCode: "S11",
        pinned: false,
        blocks: [],
      },
    ],
  };

  const mockSolveResult: SolveResult = {
    status: "complete",
    solutions: [mockSolution],
    resumeToken: null,
    unsatisfiableCourses: [],
    excludedFullCount: 0,
    snapshotTakenAt: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("initializes with default options and empty results", () => {
    const state = useSolvePlanState({ planId });

    expect(state.options.preset).toBe("fewest_campus_days");
    expect(state.options.dayBlacklist).toEqual([]);
    expect(state.options.earliestStartMin).toBeNull();
    expect(state.options.latestEndMin).toBeNull();
    // Ticket 34: exclude-full defaults to on.
    expect(state.options.excludeFull).toBe(true);
    expect(state.isSolving).toBe(false);
    expect(state.isApplying).toBe(false);
    expect(state.error).toBeNull();
    expect(state.result).toBeNull();
    expect(state.selectedSolutionId).toBeNull();
  });

  it("updates options when setters are called", () => {
    const state = useSolvePlanState({ planId });

    state.setPreset("no_early_mornings");
    expect(state.options.preset).toBe("no_early_mornings");

    state.toggleDayBlacklist("SAT");
    expect(state.options.dayBlacklist).toEqual(["SAT"]);

    state.toggleDayBlacklist("SAT");
    expect(state.options.dayBlacklist).toEqual([]);

    state.setEarliestStartMin(555);
    expect(state.options.earliestStartMin).toBe(555);

    state.setLatestEndMin(1080);
    expect(state.options.latestEndMin).toBe(1080);

    state.setExcludeFull(false);
    expect(state.options.excludeFull).toBe(false);

    state.resetConstraints();
    expect(state.options.dayBlacklist).toEqual([]);
    expect(state.options.earliestStartMin).toBeNull();
    expect(state.options.latestEndMin).toBeNull();
    // Reset returns to the ticket-34 default: exclude-full back on.
    expect(state.options.excludeFull).toBe(true);
    // Preset is retained when resetting constraints
    expect(state.options.preset).toBe("no_early_mornings");
  });

  it("calls solvePlan and stores results", async () => {
    vi.mocked(client.solvePlan).mockResolvedValue(mockSolveResult);

    const state = useSolvePlanState({ planId });
    await state.solve();

    expect(client.solvePlan).toHaveBeenCalledWith({
      planId,
      options: state.options,
    });
    expect(state.result).toEqual(mockSolveResult);
    expect(state.selectedSolutionId).toBe("solution-0");
    expect(state.isSolving).toBe(false);
    expect(state.error).toBeNull();
  });

  it("handles solvePlan failure gracefully", async () => {
    vi.mocked(client.solvePlan).mockRejectedValue(new Error("solver failed"));

    const state = useSolvePlanState({ planId });
    await state.solve();

    expect(state.isSolving).toBe(false);
    expect(state.error).toBe("solver failed");
    expect(state.result).toBeNull();
  });

  it("continues solve when resumeToken is present", async () => {
    const partialResult: SolveResult = {
      status: "partial",
      solutions: [mockSolution],
      resumeToken: "token-abc",
      unsatisfiableCourses: [],
      excludedFullCount: 0,
      snapshotTakenAt: null,
    };
    const resumedResult: SolveResult = {
      status: "complete",
      solutions: [
        mockSolution,
        {
          ...mockSolution,
          id: "solution-1",
          score: 110,
        },
      ],
      resumeToken: null,
      unsatisfiableCourses: [],
      excludedFullCount: 0,
      snapshotTakenAt: null,
    };

    vi.mocked(client.solvePlan).mockResolvedValue(partialResult);
    vi.mocked(client.continueSolve).mockResolvedValue(resumedResult);

    const state = useSolvePlanState({ planId });
    await state.solve();
    expect(state.result?.status).toBe("partial");

    await state.continueSolve();
    expect(client.continueSolve).toHaveBeenCalledWith({
      planId,
      resumeToken: "token-abc",
    });
    expect(state.result?.status).toBe("complete");
    expect(state.result?.solutions).toHaveLength(2);
  });

  it("calls cancelSolve when requested", async () => {
    vi.mocked(client.cancelSolve).mockResolvedValue();

    const state = useSolvePlanState({ planId });
    await state.cancel();

    expect(client.cancelSolve).toHaveBeenCalledTimes(1);
  });

  it("applies a solution to the plan and triggers onPlanUpdated", async () => {
    const mockUpdatedPlan: Plan = {
      id: planId,
      name: "Test Plan",
      campusId: 7,
      campusName: "Manila",
      sessionId: 155,
      sessionName: "AY2026-27 T1",
      createdAt: "2026-08-22T00:00:00Z",
      sectionCount: 1,
      isSample: false,
      sections: [],
    };

    vi.mocked(client.applySolution).mockResolvedValue(mockUpdatedPlan);
    const onPlanUpdated = vi.fn();

    const state = useSolvePlanState({ planId, onPlanUpdated });
    const applied = await state.apply(mockSolution);

    expect(client.applySolution).toHaveBeenCalledWith({
      planId,
      sections: [{ courseId: 2923, sectionId: 384 }],
    });
    expect(applied).toEqual(mockUpdatedPlan);
    expect(onPlanUpdated).toHaveBeenCalledWith(mockUpdatedPlan);
    expect(state.isApplying).toBe(false);
  });
});
