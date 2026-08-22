import { beforeEach, describe, expect, it, vi } from "vitest";
import * as client from "../adapters/ipc/client";
import { usePlansState } from "./usePlans";

vi.mock("../adapters/ipc/client", () => ({
  listPlans: vi.fn(),
  createPlan: vi.fn(),
  deletePlan: vi.fn(),
  seedSamplePlan: vi.fn(),
}));

describe("usePlansState logic", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads plans successfully", async () => {
    const mockPlans = [
      {
        id: "p1",
        name: "Term 1 Schedule",
        campusId: 7,
        campusName: "Manila",
        sessionId: 155,
        sessionName: "AY2026-27 T1",
        createdAt: "2026-08-22T00:00:00Z",
        sectionCount: 5,
        isSample: false,
      },
    ];

    vi.mocked(client.listPlans).mockResolvedValue(mockPlans);

    const state = usePlansState();
    expect(state.isLoading).toBe(false);
    expect(state.plans).toEqual([]);

    await state.fetchPlans();

    expect(state.plans).toEqual(mockPlans);
    expect(state.isLoading).toBe(false);
    expect(state.error).toBeNull();
  });

  it("surfaces identifiable error when listPlans fails with unimplemented", async () => {
    vi.mocked(client.listPlans).mockRejectedValue("unimplemented: list_plans");

    const state = usePlansState();
    await state.fetchPlans();

    expect(state.error).toBe("unimplemented: list_plans");
    expect(state.plans).toEqual([]);
    expect(state.isLoading).toBe(false);
  });

  it("creates a plan and refreshes list", async () => {
    const createdPlan = {
      id: "p2",
      name: "New Plan",
      campusId: 7,
      campusName: "Manila",
      sessionId: 155,
      sessionName: "AY2026-27 T1",
      createdAt: "2026-08-22T00:00:00Z",
      sectionCount: 0,
      isSample: false,
    };

    vi.mocked(client.createPlan).mockResolvedValue(createdPlan);
    vi.mocked(client.listPlans).mockResolvedValue([createdPlan]);

    const state = usePlansState();
    const result = await state.handleCreatePlan({
      name: "New Plan",
      campusId: 7,
      sessionId: 155,
    });

    expect(result).toEqual(createdPlan);
    expect(client.createPlan).toHaveBeenCalledWith({
      name: "New Plan",
      campusId: 7,
      sessionId: 155,
    });
    expect(state.error).toBeNull();
  });

  it("surfaces identifiable error when createPlan fails", async () => {
    vi.mocked(client.createPlan).mockRejectedValue("unimplemented: create_plan");

    const state = usePlansState();
    await expect(
      state.handleCreatePlan({
        name: "New Plan",
        campusId: 7,
        sessionId: 155,
      })
    ).rejects.toBe("unimplemented: create_plan");

    expect(state.error).toBe("unimplemented: create_plan");
  });

  it("deletes a plan and refreshes list", async () => {
    vi.mocked(client.deletePlan).mockResolvedValue(undefined);
    vi.mocked(client.listPlans).mockResolvedValue([]);

    const state = usePlansState();
    await state.handleDeletePlan("p1");

    expect(client.deletePlan).toHaveBeenCalledWith({ planId: "p1" });
    expect(state.error).toBeNull();
  });

  it("seeds sample plan and refreshes list", async () => {
    const samplePlan = {
      id: "sample-1",
      name: "Sample Plan",
      campusId: 7,
      campusName: "Manila",
      sessionId: 155,
      sessionName: "AY2026-27 T1",
      createdAt: "2026-08-22T00:00:00Z",
      sectionCount: 2,
      isSample: true,
    };

    vi.mocked(client.seedSamplePlan).mockResolvedValue(samplePlan);
    vi.mocked(client.listPlans).mockResolvedValue([samplePlan]);

    const state = usePlansState();
    const result = await state.handleSeedSample();

    expect(result).toEqual(samplePlan);
    expect(client.seedSamplePlan).toHaveBeenCalled();
  });
});
