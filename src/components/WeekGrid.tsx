/**
 * WeekGrid component.
 *
 * SPEC §7, ADR-0008, ADR-0009, ADR-0011, ADR-0012, Ticket 41:
 * - Hand-rolled CSS grid with 6 day columns (Mon–Sat) and 7 lattice time rows.
 * - Blocks positioned by actual start and end times.
 * - Hue encodes course identity only (shared across all blocks of a course).
 * - Modality indicated by left border style (solid vs dashed) and icon.
 * - Small numeric label for enrolled / enrollCap.
 * - Pinned vs tentative visible via border / opacity / badge.
 * - Overlapping conflicting blocks render hatched with conflict indicators.
 * - Context menu on right-click or keyboard activation for plan schedule blocks.
 * - Details modal, conflict explanation modal, and missing/flagged explanation modal.
 */

import { useState, useEffect, useRef, useMemo } from "react";
import {
  Building2,
  Globe,
  Pin,
  PinOff,
  AlertTriangle,
  AlertCircle,
  Info,
  BookOpen,
  Copy,
  Check,
  Trash2,
  MessageSquare,
} from "lucide-react";
import type { Conflict, Day, PlanSection, ScheduleBlock, Section } from "../adapters/ipc/types";
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
import { findCandidateConflicts, formatTeacher, formatEnrolledCap } from "../core/section";
import {
  formatSectionCopyText,
  formatCaptureAge,
  describeBlockConflict,
  describeMissingSection,
  getMenuPlacement,
} from "../core/gridMenu";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "./ui/dialog";

export interface OpenMenuState {
  section: PlanSection;
  block: ScheduleBlock;
}

export interface WeekGridProps {
  sections: PlanSection[];
  ghostSection?: Section | PlanSection | null;
  conflicts?: Conflict[];
  onSelectSection?: (section: PlanSection) => void;
  onTogglePin?: (section: PlanSection, pinned: boolean) => void | Promise<void>;
  onRemoveSection?: (section: PlanSection) => void | Promise<void>;
  onShowOtherSections?: (courseId: number) => void;
  interactive?: boolean;
  initialMenu?: OpenMenuState | null;
  initialDetailsSection?: PlanSection | null;
  initialConflictDetails?: OpenMenuState | null;
  initialFlaggedDetails?: PlanSection | null;
  className?: string;
}

interface FlattenedBlock {
  section: PlanSection | Section;
  block: ScheduleBlock;
  isConflicting: boolean;
  isGhost: boolean;
}

/**
 * What a schedule block says on hover. The teacher lives on the section's
 * latest snapshot and was not shown anywhere on the grid, so choosing between
 * two sections of the same course meant going back to the picker.
 *
 * A blank teacher reads as *unknown*, never as absent and never as a dash:
 * the value is missing, not empty (CONTEXT.md).
 */
export function blockTooltip(
  section: PlanSection | Section,
  block: ScheduleBlock,
  flags: { isF2F: boolean; isGhost: boolean; isMissing: boolean }
): string {
  const where = flags.isF2F ? block.location ?? "Room" : "Online";
  const teacher = section.latestSnapshot?.teacher?.trim();
  const snapshot = section.latestSnapshot;

  const lines = [
    `${section.courseCode} ${section.sectionCode} (${formatMinutesRange(block.startMin, block.endMin)}) — ${where}`,
    `Teacher: ${teacher ? teacher : "Unknown"}`,
  ];
  if (snapshot && typeof snapshot.enrolled === "number") {
    lines.push(`Enrolled: ${snapshot.enrolled}`);
  }
  if (flags.isGhost) lines.push("[Preview]");
  if (flags.isMissing) lines.push("[Missing from catalog]");
  return lines.join("\n");
}

export function WeekGrid({
  sections,
  ghostSection,
  conflicts: propConflicts,
  onSelectSection,
  onTogglePin,
  onRemoveSection,
  onShowOtherSections,
  interactive = true,
  initialMenu = null,
  initialDetailsSection = null,
  initialConflictDetails = null,
  initialFlaggedDetails = null,
  className = "",
}: WeekGridProps) {
  const [openMenu, setOpenMenu] = useState<OpenMenuState | null>(() => initialMenu);
  const [detailsSection, setDetailsSection] = useState<PlanSection | null>(
    () => initialDetailsSection
  );
  const [conflictExplanation, setConflictExplanation] = useState<OpenMenuState | null>(
    () => initialConflictDetails
  );
  const [flaggedExplanation, setFlaggedExplanation] = useState<PlanSection | null>(
    () => initialFlaggedDetails
  );
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const menuRef = useRef<HTMLDivElement>(null);

  // Close context menu on click-outside, scroll, or Escape
  useEffect(() => {
    if (!openMenu) return;

    function handleMouseDown(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpenMenu(null);
      }
    }

    function handleScroll() {
      setOpenMenu(null);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpenMenu(null);
      }
    }

    document.addEventListener("mousedown", handleMouseDown);
    window.addEventListener("scroll", handleScroll, true);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("scroll", handleScroll, true);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [openMenu]);

  // Compute conflicts for plan sections if not provided via props
  const conflicts = useMemo(() => {
    return propConflicts ?? findConflicts(sections);
  }, [propConflicts, sections]);

  // Compute ghost conflicts against current plan sections
  const ghostConflicts = useMemo(() => {
    if (!ghostSection) return [];
    return findCandidateConflicts(ghostSection, sections);
  }, [ghostSection, sections]);

  // Extract unique course IDs for consistent palette distribution
  const uniqueCourseIds = useMemo(() => {
    const ids: number[] = [];
    for (const section of sections) {
      if (!ids.includes(section.courseId)) {
        ids.push(section.courseId);
      }
    }
    if (ghostSection && !ids.includes(ghostSection.courseId)) {
      ids.push(ghostSection.courseId);
    }
    return ids;
  }, [sections, ghostSection]);

  // Extract all blocks to compute dynamic time bounds
  const allBlocks = useMemo(() => {
    const blocks = sections.flatMap((s) => s.blocks);
    if (ghostSection) {
      blocks.push(...ghostSection.blocks);
    }
    return blocks;
  }, [sections, ghostSection]);

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
          isGhost: false,
        });
      }
    }

    // Add ghost blocks if ghostSection is present and not already in plan
    if (
      ghostSection &&
      !sections.some(
        (s) =>
          s.courseId === ghostSection.courseId &&
          s.sectionId === ghostSection.sectionId
      )
    ) {
      for (const block of ghostSection.blocks) {
        const isConflicting = isBlockConflicting(
          block,
          {
            courseId: ghostSection.courseId,
            sectionId: ghostSection.sectionId,
          },
          ghostConflicts
        );
        map[block.day].push({
          section: ghostSection,
          block,
          isConflicting,
          isGhost: true,
        });
      }
    }

    return map;
  }, [sections, conflicts, ghostSection, ghostConflicts]);

  const handleCopySectionDetails = (section: PlanSection | Section) => {
    const text = formatSectionCopyText(section);
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text);
    }
    setCopiedId(`${section.courseId}-${section.sectionId}`);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div
      className={`rounded-xl border border-slate-200 bg-white shadow-xs overflow-hidden ${className}`}
      data-testid="week-grid"
    >
      {/* Scroll container for smaller viewports */}
      <div className="overflow-x-auto">
        <div className="min-w-[680px]">
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
                    className={`absolute right-2 text-[11px] font-mono font-medium text-slate-400 select-none pointer-events-none ${
                      pos.topPercent <= 0 ? "translate-y-0" : "-translate-y-2"
                    }`}
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
                  {dayBlocks.map(({ section, block, isConflicting, isGhost }) => {
                    const pos = computeBlockPosition(
                      block.startMin,
                      block.endMin,
                      timeBounds.startMin,
                      timeBounds.endMin
                    );

                    const theme = getCourseTheme(section.courseId, uniqueCourseIds);
                    const isF2F = block.modality === "F2F";
                    const isPinned = !isGhost && ("pinned" in section ? section.pinned : false);
                    const isMissing = !isGhost && ("missing" in section ? section.missing : false);
                    const enrolled = section.latestSnapshot?.enrolled ?? 0;
                    const enrollCap =
                      "enrollCap" in section ? (section.enrollCap as number | undefined) : undefined;
                    const enrollLabel =
                      enrollCap !== undefined ? `${enrolled}/${enrollCap}` : `${enrolled}`;

                    const isCurrentMenuOpen =
                      openMenu !== null &&
                      !isGhost &&
                      openMenu.section.courseId === section.courseId &&
                      openMenu.section.sectionId === section.sectionId &&
                      openMenu.block.day === block.day &&
                      openMenu.block.startMin === block.startMin;

                    // Border style for modality: solid for F2F, dashed for ONLINE
                    const borderStyleClass = isF2F
                      ? "border-l-solid border-l-[4px]"
                      : "border-l-dashed border-l-[4px]";

                    // Pinned vs tentative vs ghost vs missing styling
                    const visualClass = isGhost
                      ? "opacity-75 ring-2 ring-dashed ring-slate-400/70 shadow-sm"
                      : isMissing
                      ? "ring-2 ring-amber-500/80 opacity-90 shadow-xs"
                      : isPinned
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

                    const menuPlacement = getMenuPlacement(block.day, block.startMin);

                    return (
                      <div
                        key={`${isGhost ? "ghost-" : ""}${section.courseId}-${section.sectionId}-${block.day}-${block.startMin}`}
                        data-pinned={isPinned ? "true" : "false"}
                        data-missing={isMissing ? "true" : "false"}
                        data-ghost={isGhost ? "true" : "false"}
                        data-conflicting={isConflicting ? "true" : "false"}
                        data-modality={block.modality}
                        tabIndex={interactive && !isGhost ? 0 : undefined}
                        role={interactive && !isGhost ? "button" : undefined}
                        aria-haspopup={interactive && !isGhost ? "menu" : undefined}
                        aria-expanded={interactive && !isGhost ? (isCurrentMenuOpen ? "true" : "false") : undefined}
                        aria-label={`${section.courseCode} ${section.sectionCode}, ${block.day} ${formatMinutesToTime12(block.startMin)} to ${formatMinutesToTime12(block.endMin)}`}
                        onClick={() => {
                          if (!isGhost && onSelectSection && "pinned" in section && "missing" in section) {
                            onSelectSection(section as PlanSection);
                          }
                        }}
                        onContextMenu={(e) => {
                          if (!interactive || isGhost) return;
                          e.preventDefault();
                          e.stopPropagation();
                          setOpenMenu({
                            section: section as PlanSection,
                            block,
                          });
                        }}
                        onKeyDown={(e) => {
                          if (!interactive || isGhost) return;
                          if (
                            e.key === "Enter" ||
                            e.key === " " ||
                            e.key === "ContextMenu" ||
                            (e.shiftKey && e.key === "F10")
                          ) {
                            e.preventDefault();
                            e.stopPropagation();
                            setOpenMenu({
                              section: section as PlanSection,
                              block,
                            });
                          }
                        }}
                        className={`absolute inset-x-1 rounded-md p-2 flex flex-col justify-between transition-all duration-150 select-none ${
                          isGhost
                            ? "cursor-default pointer-events-none"
                            : interactive
                            ? "cursor-pointer focus:outline-hidden focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2"
                            : "cursor-default"
                        } ${theme.bgClass} ${theme.borderClass} ${theme.textClass} ${borderStyleClass} ${visualClass} ${conflictClass}`}
                        style={{
                          top: `${pos.topPercent}%`,
                          height: `calc(${pos.heightPercent}% - 4px)`,
                          minHeight: "56px",
                          borderLeftColor: isConflicting ? "#ef4444" : isMissing ? "#f59e0b" : theme.borderHex,
                          borderLeftStyle: isF2F ? "solid" : "dashed",
                          ...hatchedBgStyle,
                        }}
                        title={blockTooltip(section, block, {
                          isF2F,
                          isGhost,
                          isMissing,
                        })}
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
                            {isGhost && (
                              <span className="text-[9px] uppercase tracking-wider font-semibold opacity-75 bg-black/5 dark:bg-white/10 px-1 rounded ml-0.5">
                                Preview
                              </span>
                            )}
                            {isMissing && (
                              <span className="text-[9px] uppercase tracking-wider font-semibold bg-amber-200 text-amber-900 dark:bg-amber-900/50 dark:text-amber-200 px-1 rounded ml-0.5">
                                Missing
                              </span>
                            )}
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

                        {/* Context Menu (Ticket 41) */}
                        {isCurrentMenuOpen && interactive && (
                          <div
                            ref={menuRef}
                            data-testid="grid-context-menu"
                            role="menu"
                            aria-orientation="vertical"
                            className={`absolute z-50 w-56 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl ring-1 ring-black/5 text-slate-900 text-xs font-sans ${menuPlacement.className}`}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <div className="px-2 py-1 border-b border-slate-100 text-[11px] font-semibold text-slate-500 truncate">
                              {section.courseCode} {section.sectionCode}
                            </div>

                            <div className="py-1 space-y-0.5">
                              {/* 1. View details */}
                              <button
                                type="button"
                                role="menuitem"
                                onClick={() => {
                                  setOpenMenu(null);
                                  setDetailsSection(section as PlanSection);
                                }}
                                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-50 hover:text-slate-900 cursor-pointer"
                              >
                                <Info className="h-3.5 w-3.5 text-slate-500" />
                                <span>View details</span>
                              </button>

                              {/* 2. Pin / Unpin */}
                              <button
                                type="button"
                                role="menuitem"
                                onClick={() => {
                                  setOpenMenu(null);
                                  onTogglePin?.(section as PlanSection, !isPinned);
                                }}
                                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-50 hover:text-slate-900 cursor-pointer"
                              >
                                {isPinned ? (
                                  <>
                                    <PinOff className="h-3.5 w-3.5 text-slate-500" />
                                    <span>Unpin section</span>
                                  </>
                                ) : (
                                  <>
                                    <Pin className="h-3.5 w-3.5 text-slate-500" />
                                    <span>Pin section</span>
                                  </>
                                )}
                              </button>

                              {/* 3. Show other sections of this course */}
                              <button
                                type="button"
                                role="menuitem"
                                onClick={() => {
                                  setOpenMenu(null);
                                  onShowOtherSections?.(section.courseId);
                                }}
                                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-50 hover:text-slate-900 cursor-pointer"
                              >
                                <BookOpen className="h-3.5 w-3.5 text-slate-500" />
                                <span>Show other sections of this course</span>
                              </button>

                              {/* 4. Copy details */}
                              <button
                                type="button"
                                role="menuitem"
                                onClick={() => {
                                  handleCopySectionDetails(section);
                                  setOpenMenu(null);
                                }}
                                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-50 hover:text-slate-900 cursor-pointer"
                              >
                                {copiedId === `${section.courseId}-${section.sectionId}` ? (
                                  <>
                                    <Check className="h-3.5 w-3.5 text-emerald-600" />
                                    <span className="text-emerald-700 font-medium">Copied!</span>
                                  </>
                                ) : (
                                  <>
                                    <Copy className="h-3.5 w-3.5 text-slate-500" />
                                    <span>Copy details</span>
                                  </>
                                )}
                              </button>

                              {/* 5. Why is this conflicting? (Conditional: conflicting blocks only) */}
                              {isConflicting && (
                                <button
                                  type="button"
                                  role="menuitem"
                                  onClick={() => {
                                    setOpenMenu(null);
                                    setConflictExplanation({
                                      section: section as PlanSection,
                                      block,
                                    });
                                  }}
                                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-red-700 hover:bg-red-50 cursor-pointer font-medium"
                                >
                                  <AlertTriangle className="h-3.5 w-3.5 text-red-600" />
                                  <span>Why is this conflicting?</span>
                                </button>
                              )}

                              {/* 6. Why is this flagged? (Conditional: missing blocks only) */}
                              {isMissing && (
                                <button
                                  type="button"
                                  role="menuitem"
                                  onClick={() => {
                                    setOpenMenu(null);
                                    setFlaggedExplanation(section as PlanSection);
                                  }}
                                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-amber-800 hover:bg-amber-50 cursor-pointer font-medium"
                                >
                                  <AlertCircle className="h-3.5 w-3.5 text-amber-600" />
                                  <span>Why is this flagged?</span>
                                </button>
                              )}

                              {/* Separator before destructive action */}
                              <div className="my-1 border-t border-slate-100" />

                              {/* 7. Remove from schedule (Destructive, last) */}
                              <button
                                type="button"
                                role="menuitem"
                                onClick={() => {
                                  setOpenMenu(null);
                                  onRemoveSection?.(section as PlanSection);
                                }}
                                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-red-600 hover:bg-red-50 hover:text-red-700 cursor-pointer font-medium"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                                <span>Remove from schedule</span>
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Section Details Modal */}
      {detailsSection && (
        <Dialog open={!!detailsSection} onOpenChange={(open) => !open && setDetailsSection(null)}>
          <DialogContent className="max-w-lg p-6 space-y-4" data-testid="section-details-dialog">
            <DialogHeader className="space-y-2 text-left">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-bold text-xl text-slate-900">
                  {detailsSection.courseCode}
                </span>
                <span className="text-slate-500 font-semibold text-lg">
                  {detailsSection.sectionCode}
                </span>
                <Badge
                  variant={
                    detailsSection.modality === "ONLINE"
                      ? "session"
                      : detailsSection.modality === "HYBRID"
                      ? "secondary"
                      : "campus"
                  }
                  className="text-xs ml-1"
                >
                  {detailsSection.modality}
                </Badge>
                {detailsSection.pinned && (
                  <Badge variant="secondary" className="flex items-center gap-1 text-xs">
                    <Pin className="h-3 w-3" />
                    <span>Pinned</span>
                  </Badge>
                )}
                {detailsSection.missing && (
                  <Badge variant="destructive" className="flex items-center gap-1 text-xs bg-amber-100 text-amber-900 border-amber-300">
                    <AlertTriangle className="h-3 w-3 text-amber-700" />
                    <span>Missing</span>
                  </Badge>
                )}
              </div>
              <DialogTitle className="text-base font-semibold text-slate-800 leading-snug">
                {detailsSection.courseTitle}
              </DialogTitle>
              <DialogDescription className="text-xs text-slate-500">
                Detailed schedule and capture information for this section.
              </DialogDescription>
            </DialogHeader>

            {/* Meeting Schedule Blocks */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-600 uppercase tracking-wider block">
                Meeting Schedule
              </label>
              <div className="space-y-1.5">
                {detailsSection.blocks.map((b, idx) => (
                  <div
                    key={`${b.day}-${b.startMin}-${idx}`}
                    className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2 text-xs"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-slate-900">{b.day}</span>
                      <span className="text-slate-400">•</span>
                      <span className="font-mono text-slate-700">
                        {formatMinutesToTime12(b.startMin)} – {formatMinutesToTime12(b.endMin)}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 font-medium">
                      {b.modality === "F2F" ? (
                        <>
                          <Building2 className="h-3.5 w-3.5 text-emerald-700" />
                          <span className="text-emerald-900 font-semibold">
                            {b.location ?? "Room"}
                          </span>
                        </>
                      ) : (
                        <>
                          <Globe className="h-3.5 w-3.5 text-blue-700" />
                          <span className="text-blue-900 font-semibold">Online</span>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Details Grid */}
            <div className="grid grid-cols-2 gap-3 rounded-xl border border-slate-100 bg-slate-50/50 p-3 text-xs">
              <div>
                <span className="text-slate-500 block">Teacher:</span>
                <span className="font-medium text-slate-900">
                  {formatTeacher(detailsSection.latestSnapshot?.teacher)}
                </span>
              </div>

              <div>
                <span className="text-slate-500 block">Enrolment:</span>
                <span className="font-mono font-medium text-slate-900">
                  {"enrollCap" in detailsSection &&
                  typeof (detailsSection as PlanSection & { enrollCap?: number }).enrollCap === "number"
                    ? formatEnrolledCap(
                        detailsSection.latestSnapshot?.enrolled ?? 0,
                        (detailsSection as PlanSection & { enrollCap: number }).enrollCap
                      )
                    : `${detailsSection.latestSnapshot?.enrolled ?? 0}`}
                </span>
              </div>

              <div>
                <span className="text-slate-500 block">Captured:</span>
                <span className="text-slate-700" title={detailsSection.latestSnapshot?.capturedAt}>
                  {formatCaptureAge(detailsSection.latestSnapshot?.capturedAt)}
                </span>
              </div>

              <div>
                <span className="text-slate-500 block">Status in Plan:</span>
                <span className="font-medium text-slate-900">
                  {detailsSection.pinned ? "Pinned" : "Tentative"}
                </span>
              </div>
            </div>

            {/* Remark (verbatim display if present) */}
            {detailsSection.latestSnapshot?.remark && (
              <div className="rounded-lg border border-slate-200 bg-white p-3 text-xs space-y-1">
                <span className="font-semibold text-slate-700 flex items-center gap-1">
                  <MessageSquare className="h-3.5 w-3.5 text-slate-400" />
                  <span>Remark:</span>
                </span>
                <p className="text-slate-600 font-mono break-words">
                  {detailsSection.latestSnapshot.remark}
                </p>
              </div>
            )}

            <DialogFooter className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-slate-100">
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => handleCopySectionDetails(detailsSection)}
                  className="h-8 text-xs flex items-center gap-1.5"
                >
                  <Copy className="h-3.5 w-3.5 text-slate-500" />
                  <span>Copy details</span>
                </Button>

                {onShowOtherSections && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      onShowOtherSections(detailsSection.courseId);
                      setDetailsSection(null);
                    }}
                    className="h-8 text-xs flex items-center gap-1.5 text-slate-700"
                  >
                    <BookOpen className="h-3.5 w-3.5 text-slate-500" />
                    <span>Other sections</span>
                  </Button>
                )}
              </div>

              <div className="flex items-center gap-2">
                {onRemoveSection && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      onRemoveSection(detailsSection);
                      setDetailsSection(null);
                    }}
                    className="h-8 text-xs border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700 flex items-center gap-1"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>Remove</span>
                  </Button>
                )}
                <Button
                  type="button"
                  size="sm"
                  onClick={() => setDetailsSection(null)}
                  className="h-8 text-xs bg-slate-900 text-white hover:bg-slate-800"
                >
                  Close
                </Button>
              </div>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Conflict Explanation Modal (ADR-0009) */}
      {conflictExplanation && (
        <Dialog
          open={!!conflictExplanation}
          onOpenChange={(open) => !open && setConflictExplanation(null)}
        >
          <DialogContent className="max-w-md p-6 space-y-4" data-testid="conflict-explanation-dialog">
            <DialogHeader className="space-y-2 text-left">
              <div className="flex items-center gap-2 text-red-600">
                <AlertTriangle className="h-5 w-5 shrink-0" />
                <DialogTitle className="text-base font-bold text-slate-900">
                  Why is this conflicting?
                </DialogTitle>
              </div>
              <DialogDescription className="text-xs text-slate-600 leading-relaxed">
                {(() => {
                  const desc = describeBlockConflict(
                    conflictExplanation.section,
                    conflictExplanation.block,
                    conflicts,
                    sections
                  );
                  return desc ? (
                    <>
                      This block overlaps with{" "}
                      <strong className="text-slate-900 font-semibold">
                        {desc.otherCourseCode} {desc.otherSectionCode}
                      </strong>{" "}
                      on <strong className="text-slate-900">{desc.day}</strong> from{" "}
                      <span className="font-mono font-medium text-slate-900">
                        {formatMinutesToTime12(desc.startMin)} – {formatMinutesToTime12(desc.endMin)}
                      </span>.
                    </>
                  ) : (
                    "This block overlaps with another section on the same day."
                  );
                })()}
              </DialogDescription>
            </DialogHeader>

            <div className="rounded-lg border border-amber-200 bg-amber-50/70 p-3 text-xs text-amber-900 space-y-1">
              <span className="font-semibold block">About Conflicts (ADR-0009):</span>
              <p className="leading-relaxed">
                In Animo Plan, conflicts are displayed and never prevented. You can keep conflicting sections
                while planning, swap one for an alternative in the picker, or remove it from your schedule.
              </p>
            </div>

            <DialogFooter className="flex flex-row items-center justify-end gap-2 pt-3 border-t border-slate-100">
              {onShowOtherSections && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    onShowOtherSections(conflictExplanation.section.courseId);
                    setConflictExplanation(null);
                  }}
                  className="h-8 text-xs text-slate-700"
                >
                  <BookOpen className="h-3.5 w-3.5 mr-1" />
                  <span>Show alternatives</span>
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                onClick={() => setConflictExplanation(null)}
                className="h-8 text-xs bg-slate-900 text-white hover:bg-slate-800"
              >
                Close
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Flagged / Missing Section Modal (ADR-0008) */}
      {flaggedExplanation && (
        <Dialog
          open={!!flaggedExplanation}
          onOpenChange={(open) => !open && setFlaggedExplanation(null)}
        >
          <DialogContent className="max-w-md p-6 space-y-4" data-testid="flagged-explanation-dialog">
            <DialogHeader className="space-y-2 text-left">
              <div className="flex items-center gap-2 text-amber-600">
                <AlertCircle className="h-5 w-5 shrink-0" />
                <DialogTitle className="text-base font-bold text-slate-900">
                  Why is this flagged?
                </DialogTitle>
              </div>
              <DialogDescription className="text-xs text-slate-600 leading-relaxed">
                <strong className="text-slate-900 font-semibold">
                  {flaggedExplanation.courseCode} {flaggedExplanation.sectionCode}
                </strong>{" "}
                stopped appearing in Archer's Hub search results during a recent refresh.
              </DialogDescription>
            </DialogHeader>

            {(() => {
              const missingDesc = describeMissingSection(flaggedExplanation);
              return (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-900">Retention Invariant (ADR-0008):</span>
                    <span className="text-[11px] text-slate-500">
                      Last seen: {missingDesc.lastSeen}
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    {missingDesc.message}
                  </p>
                </div>
              );
            })()}

            <DialogFooter className="flex flex-row items-center justify-end gap-2 pt-3 border-t border-slate-100">
              {onShowOtherSections && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    onShowOtherSections(flaggedExplanation.courseId);
                    setFlaggedExplanation(null);
                  }}
                  className="h-8 text-xs text-slate-700"
                >
                  <BookOpen className="h-3.5 w-3.5 mr-1" />
                  <span>Find alternative</span>
                </Button>
              )}
              {onRemoveSection && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    onRemoveSection(flaggedExplanation);
                    setFlaggedExplanation(null);
                  }}
                  className="h-8 text-xs border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
                >
                  <Trash2 className="h-3.5 w-3.5 mr-1" />
                  <span>Remove</span>
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                onClick={() => setFlaggedExplanation(null)}
                className="h-8 text-xs bg-slate-900 text-white hover:bg-slate-800"
              >
                Close
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
