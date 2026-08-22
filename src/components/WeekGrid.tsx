/**
 * WeekGrid component.
 *
 * SPEC §7, ADR-0011, ADR-0012:
 * - Hand-rolled CSS grid with 6 day columns (Mon–Sat) and 7 lattice time rows.
 * - Blocks positioned by actual start and end times.
 * - Hue encodes course identity only (shared across all blocks of a course).
 * - Modality indicated by left border style (solid vs dashed) and icon.
 * - Small numeric label for enrolled / enrollCap.
 * - Pinned vs tentative visible via border / opacity / badge.
 * - Overlapping conflicting blocks render hatched with conflict indicators.
 */

import { useMemo } from "react";
import {
  Building2,
  Globe,
  Pin,
  AlertTriangle,
} from "lucide-react";
import type { Conflict, Day, PlanSection, ScheduleBlock } from "../adapters/ipc/types";
import {
  DAYS,
  DAY_INFOS,
  LATTICE_START_MINUTES,
  computeBlockPosition,
  formatMinutesToTime24,
  formatMinutesToTime12,
  formatMinutesRange,
  getGridTimeBounds,
} from "../core/grid";
import { getCourseTheme } from "../core/palette";
import { findConflicts, isBlockConflicting } from "../core/conflicts";

export interface WeekGridProps {
  sections: PlanSection[];
  conflicts?: Conflict[];
  onSelectSection?: (section: PlanSection) => void;
  className?: string;
}

interface FlattenedBlock {
  section: PlanSection;
  block: ScheduleBlock;
  isConflicting: boolean;
}

export function WeekGrid({
  sections,
  conflicts: propConflicts,
  onSelectSection,
  className = "",
}: WeekGridProps) {
  // Compute conflicts if not provided via props
  const conflicts = useMemo(() => {
    return propConflicts ?? findConflicts(sections);
  }, [propConflicts, sections]);

  // Extract unique course IDs for consistent palette distribution
  const uniqueCourseIds = useMemo(() => {
    const ids: number[] = [];
    for (const section of sections) {
      if (!ids.includes(section.courseId)) {
        ids.push(section.courseId);
      }
    }
    return ids;
  }, [sections]);

  // Extract all blocks to compute dynamic time bounds
  const allBlocks = useMemo(() => {
    return sections.flatMap((s) => s.blocks);
  }, [sections]);

  const timeBounds = useMemo(() => {
    return getGridTimeBounds(allBlocks);
  }, [allBlocks]);

  // Group blocks by day
  const blocksByDay = useMemo(() => {
    const map: Record<Day, FlattenedBlock[]> = {
      MON: [],
      TUE: [],
      WED: [],
      THU: [],
      FRI: [],
      SAT: [],
    };

    for (const section of sections) {
      for (const block of section.blocks) {
        const isConflicting = isBlockConflicting(
          block,
          { courseId: section.courseId, sectionId: section.sectionId },
          conflicts
        );
        map[block.day].push({
          section,
          block,
          isConflicting,
        });
      }
    }

    return map;
  }, [sections, conflicts]);

  return (
    <div
      className={`rounded-xl border border-slate-200 bg-white shadow-xs overflow-hidden ${className}`}
      data-testid="week-grid"
    >
      {/* Scroll container for smaller viewports */}
      <div className="overflow-x-auto">
        <div className="min-w-[760px]">
          {/* Day Headers (Mon–Sat) */}
          <div className="grid grid-cols-[70px_repeat(6,1fr)] border-b border-slate-200 bg-slate-50/80 sticky top-0 z-10 text-xs font-semibold text-slate-700">
            <div className="p-3 text-center text-slate-400 font-normal border-r border-slate-200">
              Time
            </div>
            {DAY_INFOS.map((info) => {
              const dayBlockCount = blocksByDay[info.day].length;
              return (
                <div
                  key={info.day}
                  className="p-3 text-center border-r last:border-r-0 border-slate-200"
                >
                  <span className="font-bold text-slate-900">{info.shortLabel}</span>
                  <span className="hidden sm:inline text-slate-500 font-normal ml-1">
                    ({info.label})
                  </span>
                  {dayBlockCount > 0 && (
                    <span className="ml-1.5 inline-flex items-center justify-center rounded-full bg-slate-200/80 px-1.5 py-0.5 text-[10px] font-medium text-slate-700">
                      {dayBlockCount}
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          {/* Grid Canvas */}
          <div className="relative grid grid-cols-[70px_repeat(6,1fr)] min-h-[640px] bg-white">
            {/* Time labels & horizontal guide lines */}
            <div className="border-r border-slate-200 bg-slate-50/40 relative">
              {LATTICE_START_MINUTES.map((startMin) => {
                const pos = computeBlockPosition(
                  startMin,
                  startMin + 90,
                  timeBounds.startMin,
                  timeBounds.endMin
                );
                return (
                  <div
                    key={startMin}
                    className="absolute right-2 -translate-y-2 text-[11px] font-mono font-medium text-slate-400 select-none pointer-events-none"
                    style={{ top: `${pos.topPercent}%` }}
                  >
                    {formatMinutesToTime24(startMin)}
                  </div>
                );
              })}
            </div>

            {/* Horizontal guide lines spanning all day columns */}
            <div className="absolute inset-0 left-[70px] pointer-events-none">
              {LATTICE_START_MINUTES.map((startMin) => {
                const pos = computeBlockPosition(
                  startMin,
                  startMin + 90,
                  timeBounds.startMin,
                  timeBounds.endMin
                );
                return (
                  <div
                    key={startMin}
                    className="absolute inset-x-0 border-t border-slate-100"
                    style={{ top: `${pos.topPercent}%` }}
                  />
                );
              })}
            </div>

            {/* Day Columns */}
            {DAYS.map((day) => {
              const dayBlocks = blocksByDay[day];

              return (
                <div
                  key={day}
                  className="relative border-r last:border-r-0 border-slate-200 min-h-[640px] p-1"
                >
                  {dayBlocks.map(({ section, block, isConflicting }) => {
                    const pos = computeBlockPosition(
                      block.startMin,
                      block.endMin,
                      timeBounds.startMin,
                      timeBounds.endMin
                    );

                    const theme = getCourseTheme(section.courseId, uniqueCourseIds);
                    const isF2F = block.modality === "F2F";
                    const isPinned = section.pinned;
                    const enrolled = section.latestSnapshot?.enrolled ?? 0;
                    const enrollCap = (section as unknown as { enrollCap?: number }).enrollCap;
                    const enrollLabel = enrollCap !== undefined ? `${enrolled}/${enrollCap}` : `${enrolled}`;

                    // Border style for modality: solid for F2F, dashed for ONLINE
                    const borderStyleClass = isF2F
                      ? "border-l-solid border-l-[4px]"
                      : "border-l-dashed border-l-[4px]";

                    // Pinned vs tentative styling
                    const pinClass = isPinned
                      ? "ring-1 ring-slate-400/50 shadow-xs opacity-100"
                      : "opacity-95";

                    // Conflicting hatched styling
                    const conflictClass = isConflicting
                      ? "hatched ring-2 ring-red-500/80"
                      : "";

                    const hatchedBgStyle = isConflicting
                      ? {
                          backgroundImage:
                            "repeating-linear-gradient(135deg, rgba(239, 68, 68, 0.12), rgba(239, 68, 68, 0.12) 8px, transparent 8px, transparent 16px)",
                        }
                      : {};

                    return (
                      <div
                        key={`${section.courseId}-${section.sectionId}-${block.day}-${block.startMin}`}
                        data-pinned={isPinned ? "true" : "false"}
                        data-conflicting={isConflicting ? "true" : "false"}
                        data-modality={block.modality}
                        onClick={() => onSelectSection?.(section)}
                        className={`absolute inset-x-1 rounded-md p-2 flex flex-col justify-between overflow-hidden transition-all duration-150 cursor-pointer select-none ${theme.bgClass} ${theme.borderClass} ${theme.textClass} ${borderStyleClass} ${pinClass} ${conflictClass}`}
                        style={{
                          top: `${pos.topPercent}%`,
                          height: `calc(${pos.heightPercent}% - 4px)`,
                          minHeight: "56px",
                          borderLeftColor: isConflicting ? "#ef4444" : theme.borderHex,
                          borderLeftStyle: isF2F ? "solid" : "dashed",
                          ...hatchedBgStyle,
                        }}
                        title={`${section.courseCode} ${section.sectionCode} (${formatMinutesRange(block.startMin, block.endMin)}) — ${isF2F ? block.location ?? "Room" : "Online"}`}
                      >
                        {/* Top row: Course Code, Section Code, Badges */}
                        <div className="flex items-start justify-between gap-1 leading-tight">
                          <div className="flex items-center gap-1 min-w-0">
                            <span className="font-bold text-xs truncate">
                              {section.courseCode}
                            </span>
                            <span className="text-[11px] font-medium opacity-75">
                              {section.sectionCode}
                            </span>
                          </div>

                          <div className="flex items-center gap-1 shrink-0">
                            {isPinned && (
                              <Pin
                                className="h-3 w-3 text-slate-700 dark:text-slate-200"
                                aria-label="Pinned"
                              />
                            )}
                            {isConflicting && (
                              <AlertTriangle
                                className="h-3.5 w-3.5 text-red-600 animate-pulse"
                                aria-label="Conflicting section"
                              />
                            )}
                          </div>
                        </div>

                        {/* Middle: Time and Location / Modality */}
                        <div className="flex items-center justify-between text-[10px] mt-1 opacity-90">
                          <div className="flex items-center gap-1 truncate">
                            {isF2F ? (
                              <>
                                <Building2 className="h-3 w-3 shrink-0" />
                                <span className="truncate">{block.location ?? "Room"}</span>
                              </>
                            ) : (
                              <>
                                <Globe className="h-3 w-3 shrink-0" />
                                <span>Online</span>
                              </>
                            )}
                          </div>

                          {/* Enrolled / Cap numeric label */}
                          <div
                            className="font-mono text-[10px] font-medium px-1 py-0.2 rounded bg-black/5 dark:bg-white/10 shrink-0"
                            title="Enrolled / Capacity"
                          >
                            {enrollLabel}
                          </div>
                        </div>

                        {/* Bottom: Precise Time Range */}
                        <div className="text-[9px] font-mono opacity-70 mt-0.5">
                          {formatMinutesToTime12(block.startMin)} – {formatMinutesToTime12(block.endMin)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
