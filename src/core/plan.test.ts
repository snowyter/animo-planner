import { describe, expect, it } from "vitest";
import { formatPlanScope, formatSectionCount, isPlanScoped } from "./plan";

describe("plan core utilities", () => {
  describe("formatPlanScope", () => {
    it("formats campus and session clearly together", () => {
      expect(formatPlanScope("Manila", "AY2026-27 T1")).toBe("Manila • AY2026-27 T1");
      expect(formatPlanScope("Laguna", "AY2026-27 T2")).toBe("Laguna • AY2026-27 T2");
    });
  });

  describe("formatSectionCount", () => {
    it("handles 0, 1, and plural section counts", () => {
      expect(formatSectionCount(0)).toBe("0 sections");
      expect(formatSectionCount(1)).toBe("1 section");
      expect(formatSectionCount(5)).toBe("5 sections");
    });
  });

  describe("isPlanScoped", () => {
    it("verifies a plan is hard-scoped with valid campus and session ids", () => {
      expect(isPlanScoped({ campusId: 7, sessionId: 155 })).toBe(true);
      expect(isPlanScoped({ campusId: 0, sessionId: 155 })).toBe(false);
      expect(isPlanScoped({ campusId: 7, sessionId: 0 })).toBe(false);
      expect(isPlanScoped({ campusId: -1, sessionId: 155 })).toBe(false);
    });
  });
});
