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
