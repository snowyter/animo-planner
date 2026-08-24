import { describe, expect, it } from "vitest";
import {
  deriveExportFileName,
  isAbortError,
  sanitizeFileNameStem,
} from "./export";

describe("core/export", () => {
  describe("sanitizeFileNameStem", () => {
    it("replaces forbidden characters with hyphens", () => {
      expect(sanitizeFileNameStem('Plan: T1 / Special * "Test"? <1> | 2')).toBe(
        "Plan- T1 - Special - -Test-- -1- - 2"
      );
    });

    it("strips control characters", () => {
      expect(sanitizeFileNameStem("Plan\n\t\0Name")).toBe("Plan---Name");
    });

    it("trims surrounding whitespace", () => {
      expect(sanitizeFileNameStem("  My Plan  ")).toBe("My Plan");
    });

    it("collapses multiple consecutive dashes cleanly if desired or preserves readability", () => {
      expect(sanitizeFileNameStem("Plan///Name")).toBe("Plan---Name");
    });
  });

  describe("deriveExportFileName", () => {
    it("combines plan name and term name into a sensible default filename for ics", () => {
      const fileName = deriveExportFileName("T1 Target", "AY2026-27 T1", "ics");
      expect(fileName).toBe("T1 Target - AY2026-27 T1.ics");
    });

    it("combines plan name and term name into a sensible default filename for png", () => {
      const fileName = deriveExportFileName("My Schedule", "AY2026-27 T2", "png");
      expect(fileName).toBe("My Schedule - AY2026-27 T2.png");
    });

    it("sanitizes forbidden characters in both plan name and session name", () => {
      const fileName = deriveExportFileName(
        "Plan/Draft:1",
        "AY2026/27*T1",
        "ics"
      );
      expect(fileName).toBe("Plan-Draft-1 - AY2026-27-T1.ics");
    });

    it("handles missing or empty session name by falling back to plan name only", () => {
      expect(deriveExportFileName("My Plan", "", "ics")).toBe("My Plan.ics");
      expect(deriveExportFileName("My Plan", "   ", "png")).toBe("My Plan.png");
    });

    it("handles empty plan name and empty session name with a sensible fallback", () => {
      expect(deriveExportFileName("", "", "ics")).toBe("plan.ics");
      expect(deriveExportFileName("   ", "", "png")).toBe("schedule.png");
    });

    it("handles only session name when plan name is empty", () => {
      expect(deriveExportFileName("", "AY2026-27 T1", "ics")).toBe(
        "AY2026-27 T1.ics"
      );
      expect(deriveExportFileName("", "AY2026-27 T1", "png")).toBe(
        "AY2026-27 T1.png"
      );
    });
  });

  describe("isAbortError", () => {
    it("returns true for DOMException with name AbortError", () => {
      const error = new DOMException("The user aborted a request.", "AbortError");
      expect(isAbortError(error)).toBe(true);
    });

    it("returns true for generic Error with name AbortError", () => {
      const error = new Error("Abort");
      error.name = "AbortError";
      expect(isAbortError(error)).toBe(true);
    });

    it("returns true for object with name AbortError", () => {
      expect(isAbortError({ name: "AbortError" })).toBe(true);
    });

    it("returns false for other errors", () => {
      expect(isAbortError(new Error("File not found"))).toBe(false);
      expect(isAbortError(new DOMException("Not allowed", "NotAllowedError"))).toBe(
        false
      );
      expect(isAbortError(null)).toBe(false);
      expect(isAbortError(undefined)).toBe(false);
      expect(isAbortError("AbortError")).toBe(false);
    });
  });
});
