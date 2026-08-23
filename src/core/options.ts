/**
 * Core plan input validation.
 *
 * The campus and academic session option values live in Rust
 * (`src-tauri/src/core/options.rs`) and cross the seam through
 * `get_campus_options` / `get_session_options`. Rust is the single source
 * of those names since ticket 25; this module deliberately holds no copy.
 */

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
