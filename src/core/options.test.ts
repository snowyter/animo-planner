import { describe, expect, it } from "vitest";
import {
  validateCreatePlanInput,
  formatFullAcademicYear,
  parseAcademicSessionName,
  buildAcademicSessionStructure,
  resolveAcademicSessionId,
  termsForStartYear,
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
    // SPEC §2's verified dropdown, in the order the site lists it.
    const fixtureSessions = [
      { id: 155, name: "AY2026-27 T1" },
      { id: 156, name: "AY2026-27 T2" },
      { id: 157, name: "AY2026-27 T3" },
      { id: 144, name: "Annual" },
      { id: 161, name: "SHS" },
    ];

    it("matches a session the catalog actually publishes", () => {
      expect(resolveAcademicSessionId(fixtureSessions, 2026, 1)).toBe(155);
      expect(resolveAcademicSessionId(fixtureSessions, 2026, 2)).toBe(156);
      expect(resolveAcademicSessionId(fixtureSessions, 2026, 3)).toBe(157);
    });

    it("returns null for a year the catalog does not publish", () => {
      expect(resolveAcademicSessionId(fixtureSessions, 2027, 1)).toBeNull();
      expect(resolveAcademicSessionId(fixtureSessions, 2025, 3)).toBeNull();
    });

    it("never hands an academic term the id of SHS", () => {
      // The regression this file exists to hold down. Extrapolating
      // `155 + (startYear - 2026) * 3 + (term - 1)` lands on 161 for
      // AY2028-29 T1, and SPEC §2 verified 161 as `SHS` — an offered
      // session, so every downstream check passed and the plan took that
      // scope silently, under a name the student never chose.
      expect(resolveAcademicSessionId(fixtureSessions, 2028, 1)).toBeNull();
      // Everything from AY2028-29 on was off by one term for the same reason.
      expect(resolveAcademicSessionId(fixtureSessions, 2028, 2)).toBeNull();
      expect(resolveAcademicSessionId(fixtureSessions, 2029, 1)).toBeNull();
    });

    it("never invents an id, for any year and term the stepper can reach", () => {
      // The stepper clamps to 2000-2100, so this is every session id the UI
      // can produce. Each one is either a real option or nothing at all —
      // which is what keeps the TypeScript and Rust sides of the seam in
      // agreement structurally, rather than by coincidence.
      const offered = new Set(fixtureSessions.map((session) => session.id));
      for (let year = 2000; year <= 2100; year += 1) {
        for (const term of [1, 2, 3]) {
          const id = resolveAcademicSessionId(fixtureSessions, year, term);
          if (id !== null) {
            expect(offered.has(id)).toBe(true);
          }
        }
      }
    });

    it("keeps the sessions that carry no year selectable", () => {
      // `Annual` and `SHS` were selectable before the year stepper existed.
      // They cannot be expressed as a year and a term, so the structure
      // carries them separately rather than narrowing what a plan may be.
      const struct = buildAcademicSessionStructure(fixtureSessions);
      expect(struct.otherSessions).toEqual([
        { id: 144, name: "Annual" },
        { id: 161, name: "SHS" },
      ]);
      expect(struct.years).toEqual(["2026-2027"]);
    });
  });

  describe("termsForStartYear", () => {
    const struct = buildAcademicSessionStructure([
      { id: 155, name: "AY2026-27 T1" },
      { id: 157, name: "AY2026-27 T3" },
    ]);

    it("lists only the terms that year actually publishes", () => {
      expect(termsForStartYear(struct, 2026)).toEqual([
        { term: 1, termLabel: "Term 1", sessionId: 155 },
        { term: 3, termLabel: "Term 3", sessionId: 157 },
      ]);
    });

    it("is empty for a year the catalog has not published", () => {
      expect(termsForStartYear(struct, 2031)).toEqual([]);
    });
  });
});
