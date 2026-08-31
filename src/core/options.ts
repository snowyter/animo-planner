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

/**
 * Reads `AY2026-27 T1` into its parts, or `null` when the name is not an
 * academic-year term at all.
 *
 * `Annual` and `SHS` are offered sessions that deliberately fail this parse
 * (SPEC §2). They are sessions without a year, not malformed years, and the
 * caller is expected to carry them separately rather than drop them.
 */
export function parseAcademicSessionName(name: string): ParsedAcademicSession | null {
  const match = /^AY\s*(\d{4})-(\d{2,4})\s*(?:T|Term\s*)(\d+)$/i.exec(name.trim());
  const [, startYearRaw, endYearRaw, termRaw] = match ?? [];
  if (!startYearRaw || !endYearRaw || !termRaw) return null;
  const startYear = parseInt(startYearRaw, 10);
  let endYear: number;
  if (endYearRaw.length === 2) {
    const century = Math.floor(startYear / 100) * 100;
    endYear = century + parseInt(endYearRaw, 10);
  } else {
    endYear = parseInt(endYearRaw, 10);
  }
  const term = parseInt(termRaw, 10);
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
  /**
   * The offered sessions that carry no academic year — `Annual`, `SHS`.
   *
   * They are as real as any term and were selectable before the year
   * stepper existed. A year-and-term control cannot express them, so it
   * carries them alongside instead of quietly narrowing what a plan may be
   * scoped to.
   */
  otherSessions: { id: number; name: string }[];
  defaultSessionId: number | null;
  defaultYear: string | null;
  defaultTerm: number | null;
  defaultStartYear: number;
}

/**
 * The session id for an academic year and term, or `null` when the fetched
 * options list no such session.
 *
 * This is a lookup, and it must never become a calculation. An earlier
 * version extrapolated ids from AY2026-27 T1 = 155 on the assumption that
 * Archer's Hub numbers terms in an unbroken run of three per year. It does
 * not. The id that formula produced for AY2028-29 T1 was 161 — which SPEC §2
 * verified as `SHS`, an offered session in its own right. The invented id
 * therefore passed every validity check on both sides of the seam and
 * scoped the plan to the wrong catalog, under a name the student never
 * chose and with nothing anywhere to flag it.
 *
 * Session identity comes from the config that carries it (ADR-0013), or it
 * does not exist. `null` is the honest answer for a term the catalog has
 * not published, and the caller is expected to say so rather than guess.
 */
export function resolveAcademicSessionId(
  sessionOptions: { id: number; name: string }[],
  startYear: number,
  term: number
): number | null {
  for (const option of sessionOptions) {
    const parsed = parseAcademicSessionName(option.name);
    if (parsed && parsed.startYear === startYear && parsed.term === term) {
      return option.id;
    }
  }
  return null;
}

/** The terms the catalog publishes for one academic year, possibly none. */
export function termsForStartYear(
  structure: AcademicSessionStructure,
  startYear: number
): AcademicTermOption[] {
  return structure.termsByYear[formatFullAcademicYear(startYear)] ?? [];
}

export function buildAcademicSessionStructure(
  sessionOptions: { id: number; name: string }[]
): AcademicSessionStructure {
  const years: string[] = [];
  const termsByYear: Record<string, AcademicTermOption[]> = {};
  const otherSessions: { id: number; name: string }[] = [];
  let defaultStartYear = 2026;

  for (const option of sessionOptions) {
    const parsed = parseAcademicSessionName(option.name);
    if (!parsed) {
      otherSessions.push({ id: option.id, name: option.name });
      continue;
    }

    // First sighting of a year opens its term list and records the order the
    // years were published in; the first one seen is the default.
    let terms = termsByYear[parsed.year];
    if (!terms) {
      terms = [];
      termsByYear[parsed.year] = terms;
      years.push(parsed.year);
      if (years.length === 1) {
        defaultStartYear = parsed.startYear;
      }
    }

    terms.push({
      term: parsed.term,
      termLabel: `Term ${parsed.term}`,
      sessionId: option.id,
    });
  }

  for (const yr of years) {
    termsByYear[yr]?.sort((a, b) => a.term - b.term);
  }

  const [firstYear] = years;
  const defaultYear = firstYear ?? null;
  const defaultTerms = defaultYear ? (termsByYear[defaultYear] ?? []) : [];
  const defaultSessionId =
    defaultTerms[0]?.sessionId ?? sessionOptions[0]?.id ?? null;
  const defaultTerm = defaultTerms[0]?.term ?? 1;

  return {
    years,
    termsByYear,
    otherSessions,
    defaultSessionId,
    defaultYear,
    defaultTerm,
    defaultStartYear,
  };
}
