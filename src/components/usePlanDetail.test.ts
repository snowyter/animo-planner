import { beforeEach, describe, expect, it, vi } from "vitest";
import * as client from "../adapters/ipc/client";
import { usePlanDetailState } from "./usePlanDetail";

vi.mock("../adapters/ipc/client", () => ({
  getPlan: vi.fn(),
}));

describe("usePlanDetailState", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads a plan by planId", async () => {
    const mockPlan = {
      id: "p1",
      name: "T1 Schedule",
      campusId: 7,
      campusName: "Manila",
      sessionId: 155,
      sessionName: "AY2026-27 T1",
      createdAt: "2026-08-22T00:00:00Z",
      sectionCount: 0,
      isSample: false,
      sections: [],
    };

    vi.mocked(client.getPlan).mockResolvedValue(mockPlan);

    const state = usePlanDetailState("p1");
    await state.fetchPlan();

    expect(state.plan).toEqual(mockPlan);
    expect(state.error).toBeNull();
    expect(client.getPlan).toHaveBeenCalledWith({ planId: "p1" });
  });

  it("surfaces identifiable error when getPlan rejects with unimplemented", async () => {
    vi.mocked(client.getPlan).mockRejectedValue("unimplemented: get_plan");

    const state = usePlanDetailState("p1");
    await state.fetchPlan();

    expect(state.plan).toBeNull();
    expect(state.error).toBe("unimplemented: get_plan");
  });
});
