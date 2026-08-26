import { describe, expect, it } from "vitest";
import type { UpdateCheck } from "../adapters/ipc/types";
import {
  formatUpdateFailureReason,
  shouldShowUpdateNotice,
} from "./updater";

describe("updater domain logic", () => {
  describe("shouldShowUpdateNotice", () => {
    it("returns true when an update is available and not dismissed", () => {
      const check: UpdateCheck = {
        status: "available",
        currentVersion: "0.1.0",
        availableVersion: "0.2.0",
        notes: "Some notes",
        failureReason: null,
        failureDetail: null,
      };
      expect(shouldShowUpdateNotice(check, false)).toBe(true);
    });

    it("returns false when dismissed even if update is available", () => {
      const check: UpdateCheck = {
        status: "available",
        currentVersion: "0.1.0",
        availableVersion: "0.2.0",
        notes: null,
        failureReason: null,
        failureDetail: null,
      };
      expect(shouldShowUpdateNotice(check, true)).toBe(false);
    });

    it("returns false when check is up to date", () => {
      const check: UpdateCheck = {
        status: "up_to_date",
        currentVersion: "0.1.0",
        availableVersion: null,
        notes: null,
        failureReason: null,
        failureDetail: null,
      };
      expect(shouldShowUpdateNotice(check, false)).toBe(false);
    });

    it("returns false when check failed", () => {
      const check: UpdateCheck = {
        status: "failed",
        currentVersion: "0.1.0",
        availableVersion: null,
        notes: null,
        failureReason: "network",
        failureDetail: "connection refused",
      };
      expect(shouldShowUpdateNotice(check, false)).toBe(false);
    });

    it("returns false when updater is unavailable (compiled out)", () => {
      const check: UpdateCheck = {
        status: "unavailable",
        currentVersion: "0.1.0",
        availableVersion: null,
        notes: null,
        failureReason: null,
        failureDetail: null,
      };
      expect(shouldShowUpdateNotice(check, false)).toBe(false);
    });

    it("returns false when check is null", () => {
      expect(shouldShowUpdateNotice(null, false)).toBe(false);
    });
  });

  describe("formatUpdateFailureReason", () => {
    it("formats network reason quietly", () => {
      expect(formatUpdateFailureReason("network")).toMatch(/offline|network|connection/i);
    });

    it("formats endpoint reason quietly", () => {
      expect(formatUpdateFailureReason("endpoint")).toMatch(/endpoint|server|release/i);
    });

    it("formats malformed reason quietly", () => {
      expect(formatUpdateFailureReason("malformed")).toMatch(/format|unreadable|response/i);
    });

    it("formats signature reason quietly", () => {
      expect(formatUpdateFailureReason("signature")).toMatch(/signature|verification/i);
    });

    it("formats unknown or null reason quietly", () => {
      expect(formatUpdateFailureReason("unknown")).toMatch(/unknown|check failed/i);
      expect(formatUpdateFailureReason(null)).toMatch(/could not complete|check failed/i);
    });
  });
});
