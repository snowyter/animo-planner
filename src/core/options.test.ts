import { describe, expect, it } from "vitest";
import {
  DEFAULT_CAMPUS_OPTIONS,
  DEFAULT_SESSION_OPTIONS,
  validateCreatePlanInput,
} from "./options";

describe("options and plan input validation", () => {
  describe("DEFAULT_CAMPUS_OPTIONS", () => {
    it("covers the verified campus values from SPEC §2", () => {
      const ids = DEFAULT_CAMPUS_OPTIONS.map((c) => c.id);
      expect(ids).toContain(7); // Manila
      expect(ids).toContain(8); // Laguna
      expect(ids).toContain(9); // Rufino

      const manila = DEFAULT_CAMPUS_OPTIONS.find((c) => c.id === 7);
      expect(manila?.name).toBe("Manila");

      const laguna = DEFAULT_CAMPUS_OPTIONS.find((c) => c.id === 8);
      expect(laguna?.name).toBe("Laguna");

      const rufino = DEFAULT_CAMPUS_OPTIONS.find((c) => c.id === 9);
      expect(rufino?.name).toBe("Rufino");
    });
  });

  describe("DEFAULT_SESSION_OPTIONS", () => {
    it("covers the verified academic session values from SPEC §2", () => {
      const ids = DEFAULT_SESSION_OPTIONS.map((s) => s.id);
      expect(ids).toContain(155); // AY2026-27 T1
      expect(ids).toContain(156); // AY2026-27 T2
      expect(ids).toContain(157); // AY2026-27 T3
      expect(ids).toContain(144); // Annual
      expect(ids).toContain(161); // SHS

      const t1 = DEFAULT_SESSION_OPTIONS.find((s) => s.id === 155);
      expect(t1?.name).toBe("AY2026-27 T1");
    });
  });

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
