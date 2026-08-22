/**
 * Core campus and academic session domain options and plan input validation.
 *
 * Scoped to DLSU Archer's Hub options verified in SPEC.md §2.
 */

export interface CampusOption {
  id: number;
  name: string;
}

export interface SessionOption {
  id: number;
  name: string;
}

/**
 * Verified campus options from SPEC §2.
 * Manila=7, Laguna=8, Rufino=9
 */
export const DEFAULT_CAMPUS_OPTIONS: CampusOption[] = [
  { id: 7, name: "Manila" },
  { id: 8, name: "Laguna" },
  { id: 9, name: "Rufino" },
];

/**
 * Verified academic session options from SPEC §2.
 * AY2026-27 T1=155, T2=156, T3=157, Annual=144, SHS=161
 */
export const DEFAULT_SESSION_OPTIONS: SessionOption[] = [
  { id: 155, name: "AY2026-27 T1" },
  { id: 156, name: "AY2026-27 T2" },
  { id: 157, name: "AY2026-27 T3" },
  { id: 144, name: "Annual" },
  { id: 161, name: "SHS" },
];

export interface CreatePlanValidationResult {
  valid: boolean;
  errors: {
    name?: string;
    campusId?: string;
    sessionId?: string;
  };
}

export interface CreatePlanInput {
  name?: string;
  campusId?: number | null;
  sessionId?: number | null;
}

export function validateCreatePlanInput(input: CreatePlanInput): CreatePlanValidationResult {
  const errors: { name?: string; campusId?: string; sessionId?: string } = {};

  if (!input.name || input.name.trim().length === 0) {
    errors.name = "Plan name is required";
  }

  if (typeof input.campusId !== "number" || isNaN(input.campusId) || input.campusId <= 0) {
    errors.campusId = "Campus is required";
  }

  if (typeof input.sessionId !== "number" || isNaN(input.sessionId) || input.sessionId <= 0) {
    errors.sessionId = "Academic session is required";
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
  };
}
