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

export function formatFullAcademicYear(startYear: number, endYear?: number): string {
  const actualEndYear = endYear ?? startYear + 1;
  return `${startYear}-${actualEndYear}`;
}

export interface ParsedAcademicSession {
  year: string;
  startYear: number;
  endYear: number;
  term: number;
}

export function parseAcademicSessionName(name: string): ParsedAcademicSession | null {
  const match = /^AY\s*(\d{4})-(\d{2,4})\s*(?:T|Term\s*)(\d+)$/i.exec(name.trim());
  if (!match) return null;
  const startYear = parseInt(match[1], 10);
  const endYearRaw = match[2];
  let endYear: number;
  if (endYearRaw.length === 2) {
    const century = Math.floor(startYear / 100) * 100;
    endYear = century + parseInt(endYearRaw, 10);
  } else {
    endYear = parseInt(endYearRaw, 10);
  }
  const term = parseInt(match[3], 10);
  const year = formatFullAcademicYear(startYear, endYear);

  return {
    year,
    startYear,
    endYear,
    term,
  };
}

export interface AcademicTermOption {
  term: number;
  termLabel: string;
  sessionId: number;
}

export interface AcademicSessionStructure {
  years: string[];
  termsByYear: Record<string, AcademicTermOption[]>;
  defaultSessionId: number | null;
  defaultYear: string | null;
  defaultTerm: number | null;
  defaultStartYear: number;
}

export function resolveAcademicSessionId(
  sessionOptions: { id: number; name: string }[],
  startYear: number,
  term: number
): number {
  for (const option of sessionOptions) {
    const parsed = parseAcademicSessionName(option.name);
    if (parsed && parsed.startYear === startYear && parsed.term === term) {
      return option.id;
    }
  }
  return 155 + (startYear - 2026) * 3 + (term - 1);
}

export function buildAcademicSessionStructure(
  sessionOptions: { id: number; name: string }[]
): AcademicSessionStructure {
  const years: string[] = [];
  const termsByYear: Record<string, AcademicTermOption[]> = {};
  let defaultStartYear = 2026;

  for (const option of sessionOptions) {
    const parsed = parseAcademicSessionName(option.name);
    if (!parsed) continue;

    if (!termsByYear[parsed.year]) {
      termsByYear[parsed.year] = [];
      years.push(parsed.year);
      if (years.length === 1) {
        defaultStartYear = parsed.startYear;
      }
    }

    termsByYear[parsed.year].push({
      term: parsed.term,
      termLabel: `Term ${parsed.term}`,
      sessionId: option.id,
    });
  }

  for (const yr of years) {
    termsByYear[yr].sort((a, b) => a.term - b.term);
  }

  const defaultYear = years.length > 0 ? years[0] : null;
  const defaultTerms = defaultYear ? termsByYear[defaultYear] : [];
  const defaultSessionId =
    defaultTerms.length > 0 ? defaultTerms[0].sessionId : (sessionOptions[0]?.id ?? null);
  const defaultTerm = defaultTerms.length > 0 ? defaultTerms[0].term : 1;

  return {
    years,
    termsByYear,
    defaultSessionId,
    defaultYear,
    defaultTerm,
    defaultStartYear,
  };
}

