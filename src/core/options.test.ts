import { describe, expect, it } from "vitest";
import {
  validateCreatePlanInput,
  formatFullAcademicYear,
  parseAcademicSessionName,
  buildAcademicSessionStructure,
  resolveAcademicSessionId,
} from "./options";

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

  describe("formatFullAcademicYear", () => {
    it("formats start year and computed end year", () => {
      expect(formatFullAcademicYear(2026)).toBe("2026-2027");
      expect(formatFullAcademicYear(2026, 2027)).toBe("2026-2027");
      expect(formatFullAcademicYear(2025, 2026)).toBe("2025-2026");
    });
  });

  describe("parseAcademicSessionName", () => {
    it("parses AY and Term from standard session names with complete 4-digit year", () => {
      expect(parseAcademicSessionName("AY2026-27 T1")).toEqual({
        year: "2026-2027",
        startYear: 2026,
        endYear: 2027,
        term: 1,
      });
      expect(parseAcademicSessionName("AY 2026-2027 Term 2")).toEqual({
        year: "2026-2027",
        startYear: 2026,
        endYear: 2027,
        term: 2,
      });
      expect(parseAcademicSessionName("AY2025-26 Term 3")).toEqual({
        year: "2025-2026",
        startYear: 2025,
        endYear: 2026,
        term: 3,
      });
    });

    it("returns null for non-AY sessions like Annual and SHS", () => {
      expect(parseAcademicSessionName("Annual")).toBeNull();
      expect(parseAcademicSessionName("SHS")).toBeNull();
      expect(parseAcademicSessionName("Sample Term")).toBeNull();
    });
  });

  describe("buildAcademicSessionStructure", () => {
    const fixtureSessions = [
      { id: 144, name: "Annual" },
      { id: 155, name: "AY2026-27 T1" },
      { id: 156, name: "AY2026-27 T2" },
      { id: 157, name: "AY2026-27 T3" },
      { id: 161, name: "SHS" },
    ];

    it("extracts unique complete years and groups terms under their year", () => {
      const struct = buildAcademicSessionStructure(fixtureSessions);
      expect(struct.years).toEqual(["2026-2027"]);
      expect(struct.termsByYear["2026-2027"]).toEqual([
        { term: 1, termLabel: "Term 1", sessionId: 155 },
        { term: 2, termLabel: "Term 2", sessionId: 156 },
        { term: 3, termLabel: "Term 3", sessionId: 157 },
      ]);
      expect(struct.defaultYear).toBe("2026-2027");
      expect(struct.defaultTerm).toBe(1);
      expect(struct.defaultSessionId).toBe(155);
    });

    it("handles multiple academic years gracefully with complete 4-digit years", () => {
      const multiYears = [
        { id: 150, name: "AY2025-26 T3" },
        { id: 155, name: "AY2026-27 T1" },
        { id: 156, name: "AY2026-27 T2" },
      ];
      const struct = buildAcademicSessionStructure(multiYears);
      expect(struct.years).toEqual(["2025-2026", "2026-2027"]);
      expect(struct.termsByYear["2025-2026"]).toEqual([
        { term: 3, termLabel: "Term 3", sessionId: 150 },
      ]);
      expect(struct.termsByYear["2026-2027"]).toEqual([
        { term: 1, termLabel: "Term 1", sessionId: 155 },
        { term: 2, termLabel: "Term 2", sessionId: 156 },
      ]);
    });

    it("handles empty options gracefully", () => {
      const struct = buildAcademicSessionStructure([]);
      expect(struct.years).toEqual([]);
      expect(struct.termsByYear).toEqual({});
      expect(struct.defaultSessionId).toBeNull();
      expect(struct.defaultYear).toBeNull();
      expect(struct.defaultTerm).toBe(1);
      expect(struct.defaultStartYear).toBe(2026);
    });
  });

  describe("resolveAcademicSessionId", () => {
    const fixtureSessions = [
      { id: 155, name: "AY2026-27 T1" },
      { id: 156, name: "AY2026-27 T2" },
      { id: 157, name: "AY2026-27 T3" },
    ];

    it("matches existing session option when available", () => {
      expect(resolveAcademicSessionId(fixtureSessions, 2026, 1)).toBe(155);
      expect(resolveAcademicSessionId(fixtureSessions, 2026, 2)).toBe(156);
      expect(resolveAcademicSessionId(fixtureSessions, 2026, 3)).toBe(157);
    });

    it("computes session id dynamically for incremented/decremented years", () => {
      // 2027-2028: 158, 159, 160
      expect(resolveAcademicSessionId(fixtureSessions, 2027, 1)).toBe(158);
      expect(resolveAcademicSessionId(fixtureSessions, 2027, 2)).toBe(159);
      expect(resolveAcademicSessionId(fixtureSessions, 2027, 3)).toBe(160);

      // 2025-2026: 152, 153, 154
      expect(resolveAcademicSessionId(fixtureSessions, 2025, 1)).toBe(152);
      expect(resolveAcademicSessionId(fixtureSessions, 2025, 2)).toBe(153);
      expect(resolveAcademicSessionId(fixtureSessions, 2025, 3)).toBe(154);
    });
  });
});
