import { describe, expect, it } from "vitest";
import { validateCreatePlanInput } from "./options";

// The campus/session option values themselves live in Rust
// (`src-tauri/src/core/options.rs`, served by `get_campus_options` /
// `get_session_options`) — the single source since ticket 25. Restating
// them here would be a second copy that can drift, so they are not tested
// on this side.

describe("plan input validation", () => {
  describe("validateCreatePlanInput", () => {
    it("returns valid when all three required fields are provided", () => {
      const result = validateCreatePlanInput({
        name: "My T1 Plan",
        campusId: 7,
        sessionId: 155,
      });
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual({});
    });

    it("rejects when name is empty or only whitespace", () => {
      const resultEmpty = validateCreatePlanInput({
        name: "",
        campusId: 7,
        sessionId: 155,
      });
      expect(resultEmpty.valid).toBe(false);
      expect(resultEmpty.errors.name).toBe("Plan name is required");

      const resultWhitespace = validateCreatePlanInput({
        name: "   ",
        campusId: 7,
        sessionId: 155,
      });
      expect(resultWhitespace.valid).toBe(false);
      expect(resultWhitespace.errors.name).toBe("Plan name is required");
    });

    it("rejects when campus is missing or invalid", () => {
      const resultNull = validateCreatePlanInput({
        name: "Plan",
        campusId: null,
        sessionId: 155,
      });
      expect(resultNull.valid).toBe(false);
      expect(resultNull.errors.campusId).toBe("Campus is required");

      const resultUndef = validateCreatePlanInput({
        name: "Plan",
        sessionId: 155,
      });
      expect(resultUndef.valid).toBe(false);
      expect(resultUndef.errors.campusId).toBe("Campus is required");
    });

    it("rejects when session is missing or invalid", () => {
      const resultNull = validateCreatePlanInput({
        name: "Plan",
        campusId: 7,
        sessionId: null,
      });
      expect(resultNull.valid).toBe(false);
      expect(resultNull.errors.sessionId).toBe("Academic session is required");

      const resultUndef = validateCreatePlanInput({
        name: "Plan",
        campusId: 7,
      });
      expect(resultUndef.valid).toBe(false);
      expect(resultUndef.errors.sessionId).toBe("Academic session is required");
    });

    it("collects all errors when multiple fields are invalid", () => {
      const result = validateCreatePlanInput({
        name: "",
        campusId: null,
        sessionId: null,
      });
      expect(result.valid).toBe(false);
      expect(result.errors.name).toBe("Plan name is required");
      expect(result.errors.campusId).toBe("Campus is required");
      expect(result.errors.sessionId).toBe("Academic session is required");
    });
  });
});
