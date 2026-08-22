/**
 * Pure grid layout calculations and time-lattice constants for the week grid.
 *
 * SPEC §7, ADR-0011:
 * - 6 day columns (Mon–Sat) — never Mon–Fri.
 * - 7 time-lattice rows at 07:30, 09:15, 11:00, 12:45, 14:30, 16:15, 18:00.
 * - Blocks positioned by their actual start and end times rather than snapped
 *   to a row index, so off-lattice sections render accurately.
 */

import type { Day, ScheduleBlock } from "../adapters/ipc/types";

export const DAYS: Day[] = ["MON", "TUE", "WED", "THU", "FRI", "SAT"];

export interface DayInfo {
  day: Day;
  label: string;
  shortLabel: string;
}

export const DAY_INFOS: DayInfo[] = [
  { day: "MON", label: "Monday", shortLabel: "Mon" },
  { day: "TUE", label: "Tuesday", shortLabel: "Tue" },
  { day: "WED", label: "Wednesday", shortLabel: "Wed" },
  { day: "THU", label: "Thursday", shortLabel: "Thu" },
  { day: "FRI", label: "Friday", shortLabel: "Fri" },
  { day: "SAT", label: "Saturday", shortLabel: "Sat" },
];

/**
 * Standard 7 lattice start minutes (minutes from midnight).
 * 07:30, 09:15, 11:00, 12:45, 14:30, 16:15, 18:00
 */
export const LATTICE_START_MINUTES: readonly number[] = [
  450, // 07:30
  555, // 09:15
  660, // 11:00
  765, // 12:45
  870, // 14:30
  975, // 16:15
  1080, // 18:00
];

export const DEFAULT_GRID_START_MIN = 450; // 07:30
export const DEFAULT_GRID_END_MIN = 1170; // 19:30 (18:00 + 90 min)

export interface GridTimeBounds {
  startMin: number;
  endMin: number;
  totalMinutes: number;
}

/**
 * Computes grid time bounds to cover at least the default lattice span (07:30 to 19:30),
 * extending if any blocks start earlier or end later.
 */
export function getGridTimeBounds(blocks: ScheduleBlock[]): GridTimeBounds {
  let startMin = DEFAULT_GRID_START_MIN;
  let endMin = DEFAULT_GRID_END_MIN;

  for (const block of blocks) {
    if (block.startMin < startMin) {
      startMin = block.startMin;
    }
    if (block.endMin > endMin) {
      endMin = block.endMin;
    }
  }

  return {
    startMin,
    endMin,
    totalMinutes: Math.max(1, endMin - startMin),
  };
}

export interface BlockPosition {
  topPercent: number;
  heightPercent: number;
}

/**
 * Calculates the top and height percentages for a block given its start/end minutes.
 */
export function computeBlockPosition(
  startMin: number,
  endMin: number,
  gridStartMin = DEFAULT_GRID_START_MIN,
  gridEndMin = DEFAULT_GRID_END_MIN
): BlockPosition {
  const totalMinutes = Math.max(1, gridEndMin - gridStartMin);
  const clampedStart = Math.max(gridStartMin, startMin);
  const clampedEnd = Math.min(gridEndMin, Math.max(clampedStart, endMin));

  const topPercent = ((clampedStart - gridStartMin) / totalMinutes) * 100;
  const heightPercent = ((clampedEnd - clampedStart) / totalMinutes) * 100;

  return {
    topPercent,
    heightPercent,
  };
}

/**
 * Formats minutes from midnight into 24-hour HH:MM format.
 */
export function formatMinutesToTime24(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const hh = h.toString().padStart(2, "0");
  const mm = m.toString().padStart(2, "0");
  return `${hh}:${mm}`;
}

/**
 * Formats minutes from midnight into 12-hour h:mm A format (e.g. "7:30 AM", "2:30 PM").
 */
export function formatMinutesToTime12(minutes: number): string {
  const totalMinutes = Math.max(0, minutes);
  const totalHours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;

  const period = totalHours >= 12 && totalHours < 24 ? "PM" : "AM";
  const hours12 = totalHours % 12 === 0 ? 12 : totalHours % 12;
  const mm = mins.toString().padStart(2, "0");

  return `${hours12}:${mm} ${period}`;
}

/**
 * Formats a start and end range (e.g. "7:30 AM – 9:00 AM").
 */
export function formatMinutesRange(startMin: number, endMin: number): string {
  return `${formatMinutesToTime12(startMin)} – ${formatMinutesToTime12(endMin)}`;
}
