import { useMemo } from "react";
/** Pin stands alone in the mini-grid with no word beside it, so it stays. */
import { Pin } from "lucide-react";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { staggerStyle } from "../core/motion";
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
  /**
   * The best score in this result set, so the score bar has a denominator.
   * A number alone does not say whether 71 is close to the top or nowhere
   * near it; the bar is what makes the ranking legible at a glance.
   */
  topScore?: number;
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
  topScore,
  planSections,
  isSelected = false,
  isApplying = false,
  onSelect,
  onApply,
  className = "",
}: SolutionThumbnailProps) {
  const isTopResult = rank === 1;
  const best = topScore && topScore > 0 ? topScore : solution.score;
  const scorePercent =
    best > 0 ? Math.max(4, Math.min(100, Math.round((solution.score / best) * 100))) : 0;
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
      data-rank={rank}
      data-top-result={isTopResult ? "true" : undefined}
      /* The stagger is CSS `animation-delay` driven by a custom property —
         never a chain of setTimeouts, and never per-item JS state. */
      style={staggerStyle(rank - 1)}
      className={`stagger-rise flex flex-col rounded-panel border bg-card overflow-hidden ${
        isTopResult
          ? "border-primary ring-1 ring-primary/25 shadow-lifted"
          : isSelected
          ? "border-primary ring-1 ring-primary/20"
          : "border-border hover:border-slate-300"
      } ${className}`}
      onClick={() => onSelect?.(solution)}
    >
      {/* Header: rank, score, and the one action */}
      <div
        className={`p-4 border-b border-border ${
          isTopResult ? "bg-primary-soft" : "bg-muted/40"
        }`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span
                className={`font-bold tabular-nums text-foreground ${
                  isTopResult ? "text-lg" : "text-sm"
                }`}
              >
                Schedule #{rank}
              </span>
              {/* First among equals, said in words rather than in a colour
                  that could be mistaken for a course hue (ADR-0012). */}
              {isTopResult && (
                <Badge variant="default" className="uppercase tracking-wide">
                  Best match
                </Badge>
              )}
            </div>

            {/* Score as a bar and a number: the bar carries the comparison,
                the number carries the value. */}
            <div className="mt-2 flex items-center gap-2">
              <div
                data-testid="score-bar"
                role="img"
                aria-label={`Score ${solution.score} of ${best}`}
                className="h-1.5 w-28 overflow-hidden rounded-pill bg-slate-200"
              >
                <div
                  className={isTopResult ? "h-full bg-primary" : "h-full bg-slate-500"}
                  style={{ width: `${scorePercent}%` }}
                />
              </div>
              <span className="text-micro font-semibold tabular-nums text-muted-foreground">
                {solution.score}
              </span>
            </div>
          </div>

          <Button
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              onApply(solution);
            }}
            disabled={isApplying}
            className="h-8 text-xs shrink-0"
          >
            {isApplying ? "Applying..." : "Apply to plan"}
          </Button>
        </div>

        {/* Honest consequence sentence at point of clicking (ticket 43) */}
        {diff && (
          <p className="mt-2.5 text-micro text-muted-foreground leading-snug">
            {formatApplyConsequence(diff)}
          </p>
        )}

        {/* What stays and what moves (ticket 43). Designed as a small report
            rather than a badge stuck on the card: the heading states the
            outcome, and each row names one course and reads left to right. */}
        {diff && diff.totalPlanSections > 0 && (
          <div
            data-testid="what-would-move"
            className={`mt-2.5 rounded-card border px-2.5 py-2 text-xs ${
              diff.moveCount === 0
                ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                : "border-amber-200 bg-amber-50 text-amber-900"
            }`}
          >
            <div className="font-semibold">{formatDiffSummary(diff)}</div>
            {diff.moved.length > 0 && (
              <ul className="mt-1.5 space-y-1">
                {diff.moved.map((m) => (
                  <li
                    key={m.courseId}
                    className="flex items-center gap-1.5 rounded-control bg-white/80 px-1.5 py-0.5 text-micro font-medium"
                  >
                    <span className="font-bold">{m.courseCode}</span>
                    <span className="text-muted-foreground">
                      moves {m.fromSectionCode} →
                    </span>
                    <span className="font-bold">{m.toSectionCode}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Score breakdown (ticket 20: the ranking is legible, not magic) */}
        {solution.breakdown.length > 0 && (
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            {solution.breakdown.map((item, idx) => (
              <span
                key={idx}
                className="inline-flex items-center rounded-control border border-border bg-card px-2 py-0.5 text-micro font-medium text-muted-foreground"
              >
                {formatScoreBreakdown(item)}
              </span>
            ))}
          </div>
        )}

        {/* Advisory warnings. Amber, never red, and labelled as advice — they
            never remove a result and must never read as an error. */}
        {solution.warnings.length > 0 && (
          <div className="mt-2.5 rounded-card border border-amber-200 bg-amber-50/70 px-2.5 py-2">
            <span className="text-nano font-semibold uppercase tracking-wider text-amber-800">
              Advisory
            </span>
            <ul className="mt-1 space-y-0.5">
              {solution.warnings.map((w, idx) => (
                <li key={idx} className="text-micro font-medium text-amber-900">
                  {formatWarningLabel(w)}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Mini Week Grid Thumbnail (Hand-rolled CSS Grid: Mon–Sat × time span) */}
      <div className="p-3 bg-card border-b border-border overflow-hidden">
        <div className="rounded-card border border-border overflow-hidden">
          {/* Day Headers (Mon–Sat) */}
          <div className="grid grid-cols-6 border-b border-border bg-muted/60 text-nano font-bold text-muted-foreground text-center">
            {DAY_INFOS.map((d) => (
              <div key={d.day} className="py-1 border-r last:border-r-0 border-border">
                {d.shortLabel}
              </div>
            ))}
          </div>

          {/* Grid Canvas */}
          <div className="relative grid grid-cols-6 min-h-[140px] bg-card">
            {DAYS.map((day) => {
              const dayBlocks = blocksByDay[day];
              return (
                <div
                  key={day}
                  className="relative border-r last:border-r-0 border-border/70 min-h-[140px] p-0.5"
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
                        className={`absolute inset-x-0.5 rounded-control px-1 py-0.5 flex flex-col justify-between overflow-hidden text-nano leading-tight ${theme.bgClass} ${theme.textClass} border-l-[3px]`}
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
                        <div className="flex items-center justify-between text-nano opacity-80">
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
      <div className="p-3 bg-muted/30 text-xs flex flex-wrap items-center gap-1.5 mt-auto">
        <span className="text-micro font-semibold text-muted-foreground uppercase tracking-wider">
          Sections:
        </span>
        {solution.sections.map((section) => {
          const theme = getCourseTheme(section.courseId, uniqueCourseIds);
          const isPinned = section.pinned;
          const movedFrom = diff?.moved.find((m) => m.courseId === section.courseId);
          return (
            <span
              key={`${section.courseId}-${section.sectionId}`}
              className={`inline-flex items-center gap-1 rounded-control border px-2 py-0.5 text-micro font-medium ${theme.bgClass} ${theme.borderClass} ${theme.textClass}`}
            >
              <span className="font-bold">{section.courseCode}</span>
              <span>{section.sectionCode}</span>
              {isPinned && (
                <span className="text-nano opacity-90 font-normal">(pinned, exempt)</span>
              )}
              {movedFrom && (
                <span className="text-nano opacity-80 font-normal">
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
