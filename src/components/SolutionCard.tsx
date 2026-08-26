import { useMemo } from "react";
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
  groupTransitionWarnings,
} from "../core/solver";

export interface SolutionCardProps {
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

export function SolutionCard({
  solution,
  rank,
  topScore,
  planSections,
  isSelected = false,
  isApplying = false,
  onSelect,
  onApply,
  className = "",
}: SolutionCardProps) {
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

  const warningGroups = useMemo(
    () => groupTransitionWarnings(solution.warnings),
    [solution.warnings]
  );

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
      data-selected={isSelected ? "true" : undefined}
      /* The stagger is CSS `animation-delay` driven by a custom property —
         never a chain of setTimeouts, and never per-item JS state. */
      style={staggerStyle(rank - 1)}
      className={`stagger-rise flex flex-col rounded-panel border bg-card overflow-hidden ${
        /* Selection is what is drawn on the week grid, so it outranks "best
           match" for the border: the student needs to find the card matching
           what they are looking at. Ring weight only — never a hue, which is
           spent on course identity (ADR-0012). */
        isSelected
          ? "border-slate-900 ring-2 ring-slate-900/25"
          : isTopResult
          ? "border-primary ring-1 ring-primary/25 shadow-lifted"
          : "border-border hover:border-slate-300"
      } ${className}`}
    >
      {/* Header: rank, score, and the one action */}
      <div
        className={`p-4 border-b border-border ${
          isTopResult ? "bg-primary-soft" : "bg-muted/40"
        }`}
      >
        <div data-testid="solution-header" className="flex flex-col gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
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
              {/* Which card the week grid is currently drawing (ticket 46). */}
              {isSelected && (
                <Badge variant="outline" className="uppercase tracking-wide">
                  Previewing
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

          {/* Two explicit actions, and nothing implicit.
              Preview repaints the real week grid; Apply commits. Making the
              whole card a preview target meant a stray click repainted the
              week, which is the opposite of a mechanism you can trust. */}
          <div className="flex flex-wrap items-center gap-2">
            {onSelect && (
              <Button
                type="button"
                variant={isSelected ? "default" : "outline"}
                size="sm"
                onClick={() => onSelect(solution)}
                className="h-8 flex-1 text-xs"
                data-testid="preview-solution"
                title={
                  isSelected
                    ? "Stop previewing and show the plan again"
                    : "Show this schedule on the week grid without applying it"
                }
              >
                {isSelected ? "Previewing" : "Preview"}
              </Button>
            )}
            <Button
              size="sm"
              variant={onSelect ? "secondary" : "default"}
              onClick={() => onApply(solution)}
              disabled={isApplying}
              className="h-8 flex-1 text-xs"
            >
              {isApplying ? "Applying..." : "Apply to plan"}
            </Button>
          </div>
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
                    data-testid="moved-section"
                    className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 rounded-control bg-white/80 px-1.5 py-0.5 text-micro font-medium"
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
            never remove a result and must never read as an error (ADR-0009).

            One row per piece of advice, with the occasions as chips after it.
            Five warnings used to read as five separate problems when three of
            them were the same walk on different days, and the repeated
            sentence left a ragged column of dead space down the right. */}
        {warningGroups.length > 0 && (
          <div
            data-testid="solution-advisory"
            className="mt-2.5 rounded-card border border-amber-200 bg-amber-50/70 px-2.5 py-2"
          >
            <span className="text-nano font-semibold uppercase tracking-wider text-amber-800">
              Advisory
            </span>
            <ul className="mt-1 space-y-1.5">
              {warningGroups.map((group) => (
                <li key={group.kind}>
                  <span className="text-micro font-semibold text-amber-900">
                    {group.label}
                  </span>
                  <span className="mt-0.5 flex flex-wrap gap-1">
                    {group.occurrences.map((occurrence) => (
                      <span
                        key={occurrence}
                        className="rounded-control bg-amber-100/80 px-1.5 py-0.5 font-mono text-nano font-medium text-amber-900"
                      >
                        {occurrence}
                      </span>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* The week's shape (ticket 46).
          Not a schedule: a schedule is what the real grid draws, at full size,
          one press away. This carries the two things that survive at this
          size — which days are loaded, and which subject sits where. Section
          code, room, and modality are detail the real grid has room for and
          this does not. Course hue still encodes course identity and nothing
          else (ADR-0012); the left border still carries per-block modality
          (ADR-0007). */}
      <div className="border-b border-border bg-card p-3">
        <div
          data-testid="week-shape"
          className="overflow-hidden rounded-card border border-border"
        >
          <div className="grid grid-cols-6 border-b border-border bg-muted/60 text-nano font-bold text-muted-foreground">
            {DAY_INFOS.map((d) => (
              <div
                key={d.day}
                className="border-r py-1 text-center last:border-r-0 border-border"
              >
                {d.shortLabel}
              </div>
            ))}
          </div>

          <div className="relative grid grid-cols-6 bg-card">
            {DAYS.map((day) => (
              <div
                key={day}
                className="relative min-h-[140px] border-r p-0.5 last:border-r-0 border-border/70"
              >
                {blocksByDay[day].map(({ section, block }) => {
                  const pos = computeBlockPosition(
                    block.startMin,
                    block.endMin,
                    timeBounds.startMin,
                    timeBounds.endMin
                  );
                  const theme = getCourseTheme(section.courseId, uniqueCourseIds);
                  const isF2F = block.modality === "F2F";

                  return (
                    <div
                      key={`${section.courseId}-${section.sectionId}-${block.day}-${block.startMin}`}
                      data-testid="week-shape-bar"
                      className={`absolute inset-x-0.5 flex items-center overflow-hidden rounded-control border-l-[3px] px-0.5 ${theme.bgClass} ${theme.textClass}`}
                      style={{
                        top: `${pos.topPercent}%`,
                        height: `calc(${pos.heightPercent}% - 2px)`,
                        minHeight: "18px",
                        borderLeftColor: theme.borderHex,
                        borderLeftStyle: isF2F ? "solid" : "dashed",
                      }}
                      /* The detail the old labels tried to fit lives here and
                         on the real grid, where there is room for it. */
                      title={`${section.courseCode} ${section.sectionCode} — ${
                        isF2F ? block.location ?? "Room" : "Online"
                      }${section.pinned ? " (pinned — exempt)" : ""}`}
                    >
                      <span className="truncate text-nano font-bold leading-none">
                        {section.courseCode}
                      </span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Sections List in Solution */}
      <div data-testid="solution-sections" className="p-3 bg-muted/30 text-xs flex flex-wrap items-center gap-1.5 mt-auto">
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
