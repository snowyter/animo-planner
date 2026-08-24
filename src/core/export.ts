/**
 * Pure domain logic and utilities for exporting plans.
 *
 * SPEC §7, ADR-0001, ADR-0004:
 * - No I/O, no framework imports.
 * - Filesystem-safe name sanitization and combination.
 */

const FORBIDDEN_CHARS: readonly string[] = [
  "/",
  "\\",
  ":",
  "*",
  "?",
  '"',
  "<",
  ">",
  "|",
];

/**
 * Sanitizes a string to make it safe for use in filesystem file names across Windows,
 * macOS, and Linux. Replaces forbidden or control characters with dashes and trims whitespace.
 */
export function sanitizeFileNameStem(input: string): string {
  const chars = Array.from(input);
  const sanitized = chars
    .map((c) => {
      const code = c.charCodeAt(0);
      if (FORBIDDEN_CHARS.includes(c) || code < 32 || code === 127) {
        return "-";
      }
      return c;
    })
    .join("")
    .trim();

  return sanitized;
}

/**
 * Derives a sensible, filesystem-safe default filename for exporting a plan as a
 * calendar file (.ics) or image (.png), combining the plan name and term name.
 */
export function deriveExportFileName(
  planName: string,
  sessionName: string,
  extension: "ics" | "png"
): string {
  const cleanPlan = sanitizeFileNameStem(planName);
  const cleanSession = sanitizeFileNameStem(sessionName);

  let stem: string;
  if (cleanPlan && cleanSession) {
    stem = `${cleanPlan} - ${cleanSession}`;
  } else if (cleanPlan) {
    stem = cleanPlan;
  } else if (cleanSession) {
    stem = cleanSession;
  } else {
    stem = extension === "ics" ? "plan" : "schedule";
  }

  return `${stem}.${extension}`;
}

/**
 * Determines whether an error was thrown due to user cancellation in the native
 * file picker dialog (AbortError).
 */
export function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  if ("name" in error && error.name === "AbortError") {
    return true;
  }

  return false;
}
