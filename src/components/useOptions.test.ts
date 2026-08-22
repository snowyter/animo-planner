import { beforeEach, describe, expect, it, vi } from "vitest";
import * as client from "../adapters/ipc/client";
import { useOptionsState } from "./useOptions";
import { DEFAULT_CAMPUS_OPTIONS, DEFAULT_SESSION_OPTIONS } from "../core/options";

vi.mock("../adapters/ipc/client", () => ({
  getCampusOptions: vi.fn(),
  getSessionOptions: vi.fn(),
}));

describe("useOptionsState", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads options from backend when available", async () => {
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

  it("falls back to SPEC §2 default options when IPC throws unimplemented", async () => {
    vi.mocked(client.getCampusOptions).mockRejectedValue("unimplemented: get_campus_options");
    vi.mocked(client.getSessionOptions).mockRejectedValue("unimplemented: get_session_options");

    const state = useOptionsState();
    await state.fetchOptions();

    // Default fallback options covering SPEC §2
    expect(state.campusOptions).toEqual(DEFAULT_CAMPUS_OPTIONS);
    expect(state.sessionOptions).toEqual(DEFAULT_SESSION_OPTIONS);
    expect(state.error).toBe("unimplemented: get_campus_options");
  });
});
