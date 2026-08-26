import { useMemo } from "react";
import {
  Pin,
  AlertTriangle,
  Check,
} from "lucide-react";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import type { Day, PlanSection, ScheduleBlock, Solution, SolutionSection } from "../adapters/ipc/types";
import { DAYS, DAY_INFOS, computeBlockPosition, getGridTimeBounds } from "../core/grid";
import { getCourseTheme } from "../core/palette";
import {
  diffSolutionWithPlan,
  formatApplyConsequence,
  formatDiffSummary,
  formatScoreBreakdown,
  formatWarningLabel,
} from "../core/solver";

export interface SolutionThumbnailProps {
  solution: Solution;
  rank: number;
  planSections?: PlanSection[];
  isSelected?: boolean;
  isApplying?: boolean;
  onSelect?: (solution: Solution) => void;
  onApply: (solution: Solution) => void;
  className?: string;
}

interface FlattenedSolutionBlock {
  section: SolutionSection;
  block: ScheduleBlock;
}

export function SolutionThumbnail({
  solution,
  rank,
  planSections,
  isSelected = false,
  isApplying = false,
  onSelect,
  onApply,
  className = "",
}: SolutionThumbnailProps) {
  // Compute what would move/stay against the current plan (ticket 43)
  const diff = useMemo(() => {
    if (!planSections || planSections.length === 0) {
      return null;
    }
    return diffSolutionWithPlan(planSections, solution);
  }, [planSections, solution]);

  // Extract unique course IDs for consistent hue distribution (ADR-0012)
  const uniqueCourseIds = useMemo(() => {
    const ids: number[] = [];
    for (const section of solution.sections) {
      if (!ids.includes(section.courseId)) {
        ids.push(section.courseId);
      }
    }
    return ids;
  }, [solution.sections]);

  // Extract all blocks for grid bounds
  const allBlocks = useMemo(() => {
    return solution.sections.flatMap((s) => s.blocks);
  }, [solution.sections]);

  const timeBounds = useMemo(() => {
    return getGridTimeBounds(allBlocks);
  }, [allBlocks]);

  // Group blocks by day
  const blocksByDay = useMemo(() => {
    const map: Record<Day, FlattenedSolutionBlock[]> = {
      MON: [],
      TUE: [],
      WED: [],
      THU: [],
      FRI: [],
      SAT: [],
    };

    for (const section of solution.sections) {
      for (const block of section.blocks) {
        map[block.day].push({
          section,
          block,
        });
      }
    }

    return map;
  }, [solution.sections]);

  return (
    <div
      data-testid={`solution-thumbnail-${solution.id}`}
      className={`flex flex-col rounded-xl border bg-white shadow-xs transition-all overflow-hidden ${
        isSelected
          ? "border-emerald-600 ring-2 ring-emerald-600/20 shadow-md"
          : "border-slate-200 hover:border-slate-300 hover:shadow-sm"
      } ${className}`}
      onClick={() => onSelect?.(solution)}
    >
      {/* Header: Rank, Score, and Actions */}
      <div className="p-4 border-b border-slate-100 bg-slate-50/50">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-800">
              {rank}
            </span>
            <span className="text-sm font-bold text-slate-900">
              Schedule #{rank}
            </span>
            <Badge variant="secondary" className="font-mono text-xs font-semibold">
              Score: {solution.score}
            </Badge>
          </div>

          <Button
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              onApply(solution);
            }}
            disabled={isApplying}
            className="h-7 text-xs shadow-xs"
          >
            {isApplying ? (
              <span>Applying...</span>
            ) : (
              <>
                <Check className="h-3.5 w-3.5 mr-1" />
                Apply to plan
              </>
            )}
          </Button>
        </div>

        {/* Honest consequence sentence at point of clicking (ticket 43) */}
        {diff && (
          <p className="mt-1.5 text-[11px] text-slate-500 leading-snug">
            {formatApplyConsequence(diff)}
          </p>
        )}

        {/* Change summary: what stays, what moves (ticket 43) */}
        {diff && diff.moveCount === 0 && diff.totalPlanSections > 0 && (
          <div className="mt-2.5 flex items-center gap-1.5 text-xs text-emerald-800 bg-emerald-50 border border-emerald-200/80 rounded-md px-2.5 py-1.5 font-medium">
            <Check className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
            <span>{formatDiffSummary(diff)}</span>
          </div>
        )}

        {diff && diff.moveCount > 0 && (
          <div className="mt-2.5 space-y-1.5 rounded-md bg-amber-50 border border-amber-200/80 p-2.5 text-xs text-amber-900">
            <div className="flex items-center justify-between font-semibold">
              <span>{formatDiffSummary(diff)}</span>
            </div>
            <div className="space-y-1">
              {diff.moved.map((m) => (
                <div
                  key={m.courseId}
                  className="flex items-center gap-1.5 text-[11px] text-amber-900 bg-white/80 rounded px-1.5 py-0.5 border border-amber-200/60 font-medium"
                >
                  <span className="font-bold">{m.courseCode}</span>
                  <span>
                    moves {m.fromSectionCode} →{" "}
                    <strong className="font-bold text-amber-950">{m.toSectionCode}</strong>
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Score Breakdown (Ticket 20 requirement: ranking is legible rather than magic) */}
        {solution.breakdown.length > 0 && (
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            {solution.breakdown.map((item, idx) => (
              <span
                key={idx}
                className="inline-flex items-center rounded-md bg-white border border-slate-200 px-2 py-0.5 text-[11px] font-medium text-slate-600 shadow-2xs"
              >
                {formatScoreBreakdown(item)}
              </span>
            ))}
          </div>
        )}

        {/* Advisory Warnings (Ticket 20 requirement: warnings show and never remove results) */}
        {solution.warnings.length > 0 && (
          <div className="mt-2 space-y-1">
            {solution.warnings.map((w, idx) => (
              <div
                key={idx}
                className="flex items-start gap-1.5 rounded-md bg-amber-50 border border-amber-200/80 p-1.5 text-[11px] font-medium text-amber-800"
              >
                <AlertTriangle className="h-3.5 w-3.5 text-amber-600 shrink-0 mt-0.5" />
                <span>{formatWarningLabel(w)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Mini Week Grid Thumbnail (Hand-rolled CSS Grid: Mon–Sat × time span) */}
      <div className="p-3 bg-white border-b border-slate-100 overflow-hidden">
        <div className="rounded-lg border border-slate-200 overflow-hidden bg-slate-50/20">
          {/* Day Headers (Mon–Sat) */}
          <div className="grid grid-cols-6 border-b border-slate-200 bg-slate-50 text-[10px] font-bold text-slate-600 text-center">
            {DAY_INFOS.map((d) => (
              <div key={d.day} className="py-1 border-r last:border-r-0 border-slate-200">
                {d.shortLabel}
              </div>
            ))}
          </div>

          {/* Grid Canvas */}
          <div className="relative grid grid-cols-6 min-h-[140px] bg-white">
            {DAYS.map((day) => {
              const dayBlocks = blocksByDay[day];
              return (
                <div
                  key={day}
                  className="relative border-r last:border-r-0 border-slate-100 min-h-[140px] p-0.5"
                >
                  {dayBlocks.map(({ section, block }) => {
                    const pos = computeBlockPosition(
                      block.startMin,
                      block.endMin,
                      timeBounds.startMin,
                      timeBounds.endMin
                    );

                    const theme = getCourseTheme(section.courseId, uniqueCourseIds);
                    const isF2F = block.modality === "F2F";
                    const isPinned = section.pinned;

                    // Border style: solid for F2F, dashed for ONLINE (ADR-0007, ADR-0012)
                    const borderStyle = isF2F ? "solid" : "dashed";

                    return (
                      <div
                        key={`${section.courseId}-${section.sectionId}-${block.day}-${block.startMin}`}
                        className={`absolute inset-x-0.5 rounded px-1 py-0.5 flex flex-col justify-between overflow-hidden text-[9px] leading-tight ${theme.bgClass} ${theme.textClass} border-l-[3px] shadow-2xs`}
                        style={{
                          top: `${pos.topPercent}%`,
                          height: `calc(${pos.heightPercent}% - 2px)`,
                          minHeight: "26px",
                          borderLeftColor: theme.borderHex,
                          borderLeftStyle: borderStyle,
                        }}
                        title={`${section.courseCode} ${section.sectionCode} (${isF2F ? block.location ?? "Room" : "Online"})${isPinned ? " (pinned — exempt)" : ""}`}
                      >
                        <div className="flex items-center justify-between gap-0.5">
                          <span className="font-bold truncate">{section.courseCode}</span>
                          {isPinned && (
                            <Pin className="h-2 w-2 text-slate-700 shrink-0" aria-label="Pinned (exempt)" />
                          )}
                        </div>
                        <div className="flex items-center justify-between text-[8px] opacity-80">
                          <span>{section.sectionCode}</span>
                          <span>{isF2F ? "F2F" : "ONL"}</span>
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

      {/* Sections List in Solution */}
      <div className="p-3 bg-slate-50/40 text-xs flex flex-wrap items-center gap-1.5 mt-auto">
        <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
          Sections:
        </span>
        {solution.sections.map((section) => {
          const theme = getCourseTheme(section.courseId, uniqueCourseIds);
          const isPinned = section.pinned;
          const movedFrom = diff?.moved.find((m) => m.courseId === section.courseId);
          return (
            <span
              key={`${section.courseId}-${section.sectionId}`}
              className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium ${theme.bgClass} ${theme.borderClass} ${theme.textClass}`}
            >
              <span className="font-bold">{section.courseCode}</span>
              <span>{section.sectionCode}</span>
              {isPinned && (
                <span className="inline-flex items-center gap-0.5 text-[10px] opacity-90 font-normal">
                  <Pin className="h-2.5 w-2.5 shrink-0" aria-label="Pinned (exempt)" />
                  <span>(exempt)</span>
                </span>
              )}
              {movedFrom && (
                <span className="text-[10px] opacity-80 font-normal">
                  (was {movedFrom.fromSectionCode})
                </span>
              )}
            </span>
          );
        })}
      </div>
    </div>
  );
}
