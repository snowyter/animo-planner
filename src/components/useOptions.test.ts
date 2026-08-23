import { beforeEach, describe, expect, it, vi } from "vitest";
import * as client from "../adapters/ipc/client";
import { useOptionsState } from "./useOptions";

vi.mock("../adapters/ipc/client", () => ({
  getCampusOptions: vi.fn(),
  getSessionOptions: vi.fn(),
}));

describe("useOptionsState", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads options from the backend, which is their single source", async () => {
    const mockCampuses = [{ id: 7, name: "Manila" }];
    const mockSessions = [{ id: 155, name: "AY2026-27 T1" }];

    vi.mocked(client.getCampusOptions).mockResolvedValue(mockCampuses);
    vi.mocked(client.getSessionOptions).mockResolvedValue(mockSessions);

    const state = useOptionsState();
    await state.fetchOptions();

    expect(state.campusOptions).toEqual(mockCampuses);
    expect(state.sessionOptions).toEqual(mockSessions);
    expect(state.error).toBeNull();
  });

  it("starts empty and surfaces failures instead of masking them with hardcoded data", async () => {
    // Rust owns these values since ticket 25; a failed fetch must show the
    // error against empty lists rather than silently pretending a stale
    // frontend copy is still true.
    vi.mocked(client.getCampusOptions).mockRejectedValue(
      "unimplemented: get_campus_options",
    );
    vi.mocked(client.getSessionOptions).mockRejectedValue(
      "unimplemented: get_session_options",
    );

    const state = useOptionsState();
    expect(state.campusOptions).toEqual([]);
    expect(state.sessionOptions).toEqual([]);

    await state.fetchOptions();

    expect(state.campusOptions).toEqual([]);
    expect(state.sessionOptions).toEqual([]);
    expect(state.error).toBe("unimplemented: get_campus_options");
  });
});
