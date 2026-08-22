import { describe, expect, it } from "vitest";
import { formatErrorMessage, isUnimplementedError } from "./error";

describe("error core utilities", () => {
  describe("formatErrorMessage", () => {
    it("returns string errors verbatim", () => {
      expect(formatErrorMessage("unimplemented: list_plans")).toBe("unimplemented: list_plans");
      expect(formatErrorMessage("Network error")).toBe("Network error");
    });

    it("extracts message from Error objects", () => {
      expect(formatErrorMessage(new Error("Failed to fetch"))).toBe("Failed to fetch");
    });

    it("extracts error property from object errors", () => {
      expect(formatErrorMessage({ error: "custom error" })).toBe("custom error");
      expect(formatErrorMessage({ message: "custom message" })).toBe("custom message");
    });

    it("returns default fallback for null or undefined", () => {
      expect(formatErrorMessage(null)).toBe("An unexpected error occurred.");
      expect(formatErrorMessage(undefined)).toBe("An unexpected error occurred.");
    });
  });

  describe("isUnimplementedError", () => {
    it("identifies unimplemented command errors", () => {
      expect(isUnimplementedError("unimplemented: list_plans")).toBe(true);
      expect(isUnimplementedError("unimplemented: create_plan")).toBe(true);
      expect(isUnimplementedError("other error")).toBe(false);
      expect(isUnimplementedError(new Error("unimplemented: get_plan"))).toBe(true);
    });
  });
});
