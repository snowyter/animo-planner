/**
 * Pure domain logic and formatting utilities for captured catalog and counter.
 * No I/O, no framework imports.
 */

/**
 * Formats a live capture summary count into the standard reading:
 * "N sections from M courses" (e.g. "42 sections from 8 courses").
 * Correctly pluralizes singular and plural nouns.
 */
export function formatCaptureCounter(sectionCount: number, courseCount: number): string {
  const sectionPart = sectionCount === 1 ? "1 section" : `${sectionCount} sections`;
  const coursePart = courseCount === 1 ? "1 course" : `${courseCount} courses`;
  return `${sectionPart} from ${coursePart}`;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * How long ago, in the coarsest unit that still says something.
 *
 * Shared by both freshness readings so "5m ago" cannot come out one way for
 * a capture and another for a refresh.
 */
function formatAge(stamp: string, now: Date): string | null {
  const then = new Date(stamp).getTime();
  if (!Number.isFinite(then)) {
    return null;
  }

  // Clock skew is not freshness information, so a future stamp reads as now.
  const elapsed = Math.max(0, now.getTime() - then);

  if (elapsed < MINUTE_MS) return "just now";
  if (elapsed < HOUR_MS) return `${Math.floor(elapsed / MINUTE_MS)}m ago`;
  if (elapsed < DAY_MS) return `${Math.floor(elapsed / HOUR_MS)}h ago`;
  return `${Math.floor(elapsed / DAY_MS)}d ago`;
}

/**
 * How old a capture is.
 *
 * The Capture tab is the arrival surface: what landed, when, how fresh
 * (ticket 46). Enrolment counts move during enlistment week, so the age of a
 * capture is what decides whether its numbers are worth acting on.
 *
 * An unparseable timestamp reads as unknown, never as recent — the same rule
 * a blank professor follows (CONTEXT.md): missing is not a value.
 */
export function formatCapturedAge(capturedAt: string, now: Date = new Date()): string {
  const age = formatAge(capturedAt, now);
  return age === null ? "captured at an unknown time" : `captured ${age}`;
}

/**
 * How a catalog row describes its own freshness.
 *
 * Two acts write a course: a capture, when the student searches it in Course
 * Finder, and a refresh, when they press Refresh. Both advance `lastSeenAt`,
 * so it alone cannot say which one produced the numbers on screen — and
 * during enlistment week that is exactly the thing worth knowing.
 *
 * The later act wins and names itself. Re-searching a course after refreshing
 * it is a capture, and saying "refreshed" then would be a lie about where the
 * numbers came from.
 */
export function formatCatalogFreshness(
  course: { lastSeenAt: string; lastRefreshedAt: string | null },
  now: Date = new Date()
): string {
  const seen = new Date(course.lastSeenAt).getTime();
  const refreshed = course.lastRefreshedAt
    ? new Date(course.lastRefreshedAt).getTime()
    : Number.NaN;

  const refreshIsLatest =
    Number.isFinite(refreshed) && (!Number.isFinite(seen) || refreshed >= seen);

  if (refreshIsLatest) {
    const age = formatAge(course.lastRefreshedAt as string, now);
    if (age !== null) return `refreshed ${age}`;
  }

  return formatCapturedAge(course.lastSeenAt, now);
}
