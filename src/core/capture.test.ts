import { describe, expect, it } from "vitest";
import { formatCaptureCounter } from "./capture";

describe("capture core utilities", () => {
  describe("formatCaptureCounter", () => {
    it("formats 0 sections and 0 courses with plural nouns", () => {
      expect(formatCaptureCounter(0, 0)).toBe("0 sections from 0 courses");
    });

    it("formats singular section and course", () => {
      expect(formatCaptureCounter(1, 1)).toBe("1 section from 1 course");
    });

    it("formats plural sections and singular course", () => {
      expect(formatCaptureCounter(2, 1)).toBe("2 sections from 1 course");
      expect(formatCaptureCounter(42, 1)).toBe("42 sections from 1 course");
    });

    it("formats singular section and plural courses", () => {
      expect(formatCaptureCounter(1, 2)).toBe("1 section from 2 courses");
    });

    it("formats plural sections and plural courses matching SPEC §4 format", () => {
      expect(formatCaptureCounter(42, 8)).toBe("42 sections from 8 courses");
      expect(formatCaptureCounter(12, 3)).toBe("12 sections from 3 courses");
    });
  });
});
