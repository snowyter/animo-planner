import { describe, expect, it, vi } from "vitest";
import { getAppVersion } from "./appVersion";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";

describe("getAppVersion", () => {
  it("invokes the get_app_version command", async () => {
    vi.mocked(invoke).mockResolvedValueOnce("0.1.0");
    await expect(getAppVersion()).resolves.toBe("0.1.0");
    expect(invoke).toHaveBeenCalledWith("get_app_version");
  });

  it("propagates command errors", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("boom"));
    await expect(getAppVersion()).rejects.toThrow("boom");
  });
});
