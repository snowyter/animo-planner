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
 *
 * Ticket 33 — this is a *working* surface, and it is treated as one: no
 * ambient background behind it, no per-block shadow or transition, no hover
 * repaint, and nothing that animates while the app is idle. The single
 * exception is the ghost-to-block handoff, which is armed for one section at
 * a time and disarmed as soon as it settles.
 */

import { useState, useEffect, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
// `motion/react-m` carries only `m`, so the feature bundle stays splittable.
import * as m from "motion/react-m";
/**
 * Four glyphs survive the icon cull, and they are not chrome.
 *
 * Hue is already spent on course identity (ADR-0012), so per-block modality
 * (ADR-0007), the conflict indicator (ADR-0009), and pin state have nowhere
 * else to live. Removing them destroys data the student is reading. Every
 * other icon on this surface sat beside a word that already said the same
 * thing, and the word is what stayed.
 */
import { Building2, Globe, Pin, AlertTriangle } from "lucide-react";
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
import {
  findCandidateConflicts,
  formatProfessor,
  formatEnrolledCap,
  toPlanSection,
} from "../core/section";
import {
  formatSectionCopyText,
  formatCaptureAge,
  describeBlockConflict,
  describeMissingSection,
  getMenuPlacement,
  computeMenuPosition,
  type AnchorRect,
} from "../core/gridMenu";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Skeleton } from "./ui/skeleton";
import {
  MOTION_DURATION_MS,
  staggerStyle,
  shouldArmHandoff,
  shouldLandBlock,
} from "../core/motion";
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
  anchorRect?: AnchorRect;
}

export interface WeekGridProps {
  sections: PlanSection[];
  /**
   * The one preview mechanism on this surface (ticket 46).
   *
   * The picker previews the single section under the cursor; the solver
   * previews a whole candidate schedule. They are the same concept, so they
   * share this prop and one code path — two systems drawing previews on the
   * same grid is the bug this exists to prevent. Only one is ever active:
   * they live on different tabs.
   */
  previewSections?: (Section | PlanSection)[] | null;
  /**
   * Names what is being previewed, and renders the notice that says so. A
   * hovered candidate needs no label — it is a gesture, not a mode. A solution
   * preview does, or it is mistakable for the applied plan.
   */
  previewLabel?: string | null;
  /**
   * A candidate *schedule* stands in place of the plan for as long as it is
   * shown; a candidate *section* joins the plan it would be added to. Drawing
   * both sets at once would read as a plan with twice the sections.
   */
  previewReplacesPlan?: boolean;
  /** Restores the real plan on the grid. Rendered beside the notice. */
  onClearPreview?: () => void;
  /**
   * Commits the previewed schedule, offered from the notice.
   *
   * A student decides while looking at the week, not at the card that
   * produced it — sending them back to the panel to act on a decision they
   * already made is where a live preview stops feeling live.
   */
  onApplyPreview?: () => void;
  isApplyingPreview?: boolean;
  conflicts?: Conflict[];
  onSelectSection?: (section: PlanSection) => void;
  onTogglePin?: (section: PlanSection, pinned: boolean) => void | Promise<void>;
  onRemoveSection?: (section: PlanSection) => void | Promise<void>;
  onShowOtherSections?: (courseId: number) => void;
  interactive?: boolean;
  /** Renders the grid's shape as a skeleton instead of a spinner. */
  isLoading?: boolean;
  initialMenu?: OpenMenuState | null;
  /**
   * Test seam for the ghost-to-block handoff, which is otherwise driven by an
   * effect and therefore inert under static markup.
   */
  initialHandoffKey?: string | null;
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
 * What a schedule block says on hover. The professor lives on the section's
 * latest snapshot and was not shown anywhere on the grid, so choosing between
 * two sections of the same course meant going back to the picker.
 *
 * A blank professor reads as *unknown*, never as absent and never as a dash:
 * the value is missing, not empty (CONTEXT.md).
 */
export function blockTooltip(
  section: PlanSection | Section,
  block: ScheduleBlock,
  flags: { isF2F: boolean; isGhost: boolean; isMissing: boolean }
): string {
  const where = flags.isF2F ? block.location ?? "Room" : "Online";
  const professor = section.latestSnapshot?.professor?.trim();
  const snapshot = section.latestSnapshot;

  const lines = [
    `${section.courseCode} ${section.sectionCode} (${formatMinutesRange(block.startMin, block.endMin)}) — ${where}`,
    `Professor: ${professor ? professor : "Unknown"}`,
  ];
  if (snapshot && typeof snapshot.enrolled === "number") {
    lines.push(`Enrolled: ${snapshot.enrolled}`);
  }
  const remark = snapshot?.remark?.trim();
  if (remark) {
    lines.push(`Remark: ${remark}`);
  }
  if (flags.isGhost) lines.push("[Preview]");
  if (flags.isMissing) lines.push("[Missing from catalog]");
  return lines.join("\n");
}

export function WeekGrid({
  sections: planSections,
  previewSections = null,
  previewLabel = null,
  previewReplacesPlan = false,
  onClearPreview,
  onApplyPreview,
  isApplyingPreview = false,
  conflicts: propConflicts,
  onSelectSection,
  onTogglePin,
  onRemoveSection,
  onShowOtherSections,
  interactive = true,
  isLoading = false,
  initialMenu = null,
  initialHandoffKey = null,
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

  /**
   * The preview, normalised once.
   *
   * `sections` is what the grid draws as the plan. A solution preview stands
   * in for it; a hovered candidate is drawn over it. Everything below reads
   * these two, so there is exactly one place the two kinds of preview differ.
   */
  const preview = useMemo(
    () => previewSections ?? [],
    [previewSections]
  );
  const sections = useMemo(
    () => (previewReplacesPlan && preview.length > 0 ? [] : planSections),
    [previewReplacesPlan, preview, planSections]
  );

  /**
   * The ghost-to-block handoff (ticket 33).
   *
   * `layoutId` is the one shared-element transition worth having here: the
   * preview the student is hovering becomes the committed block. It is also
   * the one thing that could put layout measurement on all forty blocks, so
   * it is armed for exactly the section that just landed and disarmed as soon
   * as it settles. Everything else on this grid renders as a plain `div`.
   */
  const [handoffKey, setHandoffKey] = useState<string | null>(() => initialHandoffKey);
  const previousGhostKey = useRef<string | null>(null);

  const menuRef = useRef<HTMLDivElement>(null);

  // Close context menu on click-outside, scroll, resize, or Escape
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

    function handleResize() {
      setOpenMenu(null);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpenMenu(null);
      }
    }

    document.addEventListener("mousedown", handleMouseDown);
    window.addEventListener("scroll", handleScroll, true);
    window.addEventListener("resize", handleResize);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("resize", handleResize);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [openMenu]);

  // Arm the handoff when a hovered ghost stops being a ghost and starts
  // being part of the plan, then disarm it one animation later.
  useEffect(() => {
    // Only a single-section preview hands off. A solution preview is a whole
    // schedule, and arming a shared-element transition on every block of it
    // would put layout measurement on the entire grid.
    const currentKey =
      preview.length === 1
        ? `${preview[0].courseId}-${preview[0].sectionId}`
        : null;
    const departedKey = previousGhostKey.current;
    previousGhostKey.current = currentKey;

    if (currentKey !== null || departedKey === null) {
      return;
    }
    const landed = sections.some(
      (s) => `${s.courseId}-${s.sectionId}` === departedKey
    );
    if (!landed) {
      return;
    }

    setHandoffKey(departedKey);
    const timer = setTimeout(() => setHandoffKey(null), MOTION_DURATION_MS.slow);
    return () => clearTimeout(timer);
  }, [preview, sections]);

  // Compute conflicts for plan sections if not provided via props
  const conflicts = useMemo(() => {
    return propConflicts ?? findConflicts(sections);
  }, [propConflicts, sections]);

  /**
   * A preview's own conflicts.
   *
   * A hovered candidate is checked against the plan it would join. A solution
   * preview stands alone (the solver only ever emits conflict-free sets), so
   * the same call checks it against the empty plan behind it and finds none.
   */
  const previewConflicts = useMemo(() => {
    const previewAsPlan = preview.map(toPlanSection);
    return preview.flatMap((candidate) =>
      findCandidateConflicts(candidate, [
        ...sections,
        ...previewAsPlan.filter(
          (other) =>
            other.courseId !== candidate.courseId ||
            other.sectionId !== candidate.sectionId
        ),
      ])
    );
  }, [preview, sections]);

  // Extract unique course IDs for consistent palette distribution
  const uniqueCourseIds = useMemo(() => {
    const ids: number[] = [];
    for (const section of sections) {
      if (!ids.includes(section.courseId)) {
        ids.push(section.courseId);
      }
    }
    for (const candidate of preview) {
      if (!ids.includes(candidate.courseId)) {
        ids.push(candidate.courseId);
      }
    }
    return ids;
  }, [sections, preview]);

  // Extract all blocks to compute dynamic time bounds
  const allBlocks = useMemo(() => {
    const blocks = sections.flatMap((s) => s.blocks);
    for (const candidate of preview) {
      blocks.push(...candidate.blocks);
    }
    return blocks;
  }, [sections, preview]);

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

    // Preview blocks, for whatever is already not part of the plan.
    for (const candidate of preview) {
      if (
        sections.some(
          (s) =>
            s.courseId === candidate.courseId &&
            s.sectionId === candidate.sectionId
        )
      ) {
        continue;
      }
      for (const block of candidate.blocks) {
        const isConflicting = isBlockConflicting(
          block,
          {
            courseId: candidate.courseId,
            sectionId: candidate.sectionId,
          },
          previewConflicts
        );
        map[block.day].push({
          section: candidate,
          block,
          isConflicting,
          isGhost: true,
        });
      }
    }

    return map;
  }, [sections, conflicts, preview, previewConflicts]);

  const handleCopySectionDetails = (section: PlanSection | Section) => {
    const text = formatSectionCopyText(section);
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text);
    }
    setCopiedId(`${section.courseId}-${section.sectionId}`);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const isEmpty = sections.length === 0 && preview.length === 0;

  if (isLoading) {
    // The shape of the incoming content is known, so a skeleton says more
    // than a spinner — and a spinner would be an animation running at exactly
    // the moment the machine is busiest.
    return (
      <div
        className={`rounded-panel border border-border bg-card overflow-hidden ${className}`}
        data-testid="week-grid-skeleton"
      >
        <div className="overflow-x-auto">
          <div className="min-w-0">
            <div className="grid grid-cols-[48px_repeat(6,1fr)] border-b border-border bg-muted/60 text-xs font-semibold text-foreground">
              <div className="p-2 text-center text-muted-foreground font-normal border-r border-border text-micro">
                Time
              </div>
              {DAY_INFOS.map((info) => (
                <div
                  key={info.day}
                  className="p-3 text-center border-r last:border-r-0 border-border"
                >
                  {info.shortLabel}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-[48px_repeat(6,1fr)] min-h-[640px]">
              <div className="border-r border-border bg-muted/30 p-1.5 space-y-14">
                {LATTICE_START_MINUTES.map((startMin) => (
                  <Skeleton key={startMin} className="h-3 w-8" />
                ))}
              </div>
              {DAYS.map((day, column) => (
                <div
                  key={day}
                  className="border-r last:border-r-0 border-border p-1.5 space-y-3"
                >
                  {[0, 1].map((row) => (
                    <Skeleton
                      key={row}
                      className="w-full"
                      style={{ height: "72px", marginTop: row === 0 ? `${column * 26}px` : undefined }}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`relative rounded-panel border border-border bg-card overflow-hidden ${className}`}
      data-testid="week-grid"
    >
      {/* What a preview says it is (ticket 46).
          A candidate schedule drawn at full size on the real grid is exactly
          as convincing as the applied plan, so it names itself and offers the
          way back. Flat, quiet, and above the grid's own scroll container. */}
      {previewLabel && preview.length > 0 && (
        <div
          data-testid="week-grid-preview-notice"
          role="status"
          className="flex flex-wrap items-center justify-between gap-2 border-b border-sky-200 bg-sky-50 px-3 py-2"
        >
          <span className="text-xs font-semibold text-sky-900">{previewLabel}</span>
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-nano uppercase tracking-wider font-semibold text-sky-800">
              Not applied
            </span>
            {onApplyPreview && (
              <Button
                type="button"
                size="sm"
                disabled={isApplyingPreview}
                onClick={onApplyPreview}
                className="h-6 px-2 text-micro"
                data-testid="week-grid-apply-preview"
              >
                {isApplyingPreview ? "Applying..." : "Apply this schedule"}
              </Button>
            )}
            {onClearPreview && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onClearPreview}
                className="h-6 border-sky-300 px-2 text-micro text-sky-900"
                data-testid="week-grid-clear-preview"
              >
                Show my plan
              </Button>
            )}
          </span>
        </div>
      )}

      {/* Scroll container for smaller viewports.
          An empty grid fades back so the "No sections yet" card carries the
          screen. The fade is on the lattice, never on the root — the card
          sits outside this element and stays at full strength, and dimming
          the root would dim the message along with everything else.
          Deliberately opacity and not a tint: a wash of colour would shift
          the perceived hue of every block that lands here (ADR-0012), and
          at zero sections there is nothing whose colour can be distorted.
          `overflow-x-auto` also computes `overflow-y: auto`, so the fade
          must not become a stacking context that clips the portalled
          context menu — opacity below 1 creates one, which is why it is
          applied only while the grid is empty and has no menu to open. */}
      <div
        className={isEmpty ? "overflow-x-auto opacity-40" : "overflow-x-auto"}
        data-testid="week-grid-lattice"
        aria-hidden={isEmpty ? true : undefined}
      >
        <div className="min-w-0">
          {/* Day Headers (Mon–Sat) */}
          <div className="grid grid-cols-[48px_repeat(6,1fr)] border-b border-border bg-muted/60 sticky top-0 z-10 text-xs font-semibold text-foreground">
            <div className="p-2 text-center text-muted-foreground font-normal border-r border-border text-micro">
              Time
            </div>
            {DAY_INFOS.map((info) => {
              const dayBlockCount = blocksByDay[info.day].length;
              return (
                <div
                  key={info.day}
                  className="p-3 text-center border-r last:border-r-0 border-border"
                >
                  <span className="font-bold text-foreground">{info.shortLabel}</span>
                  <span className="hidden sm:inline text-muted-foreground font-normal ml-1">
                    ({info.label})
                  </span>
                  {dayBlockCount > 0 && (
                    <span className="ml-1.5 inline-flex items-center justify-center rounded-full bg-secondary px-1.5 py-0.5 text-nano font-medium text-muted-foreground">
                      {dayBlockCount}
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          {/* Grid Canvas */}
          <div className="relative grid grid-cols-[48px_repeat(6,1fr)] min-h-[640px] bg-card">
            {/* Time labels & horizontal guide lines */}
            <div className="border-r border-border bg-muted/30 relative">
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
                    className={`absolute right-1 text-micro font-mono font-medium text-muted-foreground select-none pointer-events-none ${
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
            <div className="absolute inset-0 left-[48px] pointer-events-none">
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
                    className="absolute inset-x-0 border-t border-border/70"
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
                  className="relative border-r last:border-r-0 border-border min-h-[640px] p-1"
                >
                  {dayBlocks.map(({ section, block, isConflicting, isGhost }, blockIndex) => {
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
                    const remark = section.latestSnapshot?.remark?.trim();

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

                    // Pinned vs tentative vs ghost vs missing.
                    //
                    // Ring weight and opacity only — no per-block shadow. A
                    // box-shadow on forty repeated elements is paint this app
                    // cannot afford.
                    const visualClass = isGhost
                      ? "opacity-75 ring-2 ring-dashed ring-slate-400/70"
                      : isMissing
                      ? "ring-2 ring-amber-500/80"
                      : isPinned
                      ? "ring-1 ring-slate-500/60"
                      : "";

                    // Conflicting hatched styling. `.conflict-hatch` lives in
                    // App.css; it paints instantly and never transitions,
                    // because a conflict is displayed and never softened
                    // (ADR-0009).
                    const conflictClass = isConflicting
                      ? "hatched conflict-hatch ring-2 ring-red-500/80"
                      : "";

                    /**
                     * The entrance, at last.
                     *
                     * One CSS animation on the block itself — never a
                     * `motion` component and never a `layout` prop, so a
                     * forty-block grid measures nothing to arrive.
                     *
                     * Three things are deliberately NOT animated:
                     *
                     * - **A conflicting block.** ADR-0009 is intact: the
                     *   hatch appears the instant the conflict exists.
                     * - **The lattice, the day column, and the grid root.**
                     *   The lattice is the scroll container that mounts the
                     *   portalled menu's anchor, and a transform or an
                     *   opacity on any ancestor of it re-parents that
                     *   `position: fixed` menu — tickets 41 and 45.
                     * - **A block that is already on screen.** The delay is
                     *   capped in `core/motion.ts`, so a full grid finishes
                     *   arriving in a few frames rather than in sequence.
                     */
                    // The ghost-to-block handoff is armed for one section at a
                    // time. Every other block stays a plain `div` and never
                    // measures. Both decisions are pure and live in
                    // `core/motion.ts`, where they are tested: `layoutId` is
                    // not an attribute, so a handoff that stops happening
                    // renders identical markup and no assertion here would
                    // notice.
                    const sectionKey = `${section.courseId}-${section.sectionId}`;
                    const isHandingOff = shouldArmHandoff({
                      isGhost,
                      sectionKey,
                      handoffKey,
                    });
                    const isLanding = shouldLandBlock({
                      isConflicting,
                      isGhost,
                      isHandingOff,
                    });
                    const blockAnimationClass = isLanding ? "block-land" : "";
                    const blockAnimationStyle = isLanding
                      ? staggerStyle(blockIndex)
                      : undefined;
                    const BlockTag = isHandingOff ? m.div : "div";
                    const handoffProps = isHandingOff
                      ? {
                          layoutId: `grid-block-${sectionKey}-${block.day}-${block.startMin}`,
                        }
                      : {};

                    return (
                      <BlockTag
                        {...handoffProps}
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
                        onContextMenu={(e: React.MouseEvent<HTMLDivElement>) => {
                          if (!interactive || isGhost) return;
                          e.preventDefault();
                          e.stopPropagation();
                          const rect = e.currentTarget.getBoundingClientRect();
                          setOpenMenu({
                            section: section as PlanSection,
                            block,
                            anchorRect: {
                              top: rect.top,
                              left: rect.left,
                              right: rect.right,
                              bottom: rect.bottom,
                              width: rect.width,
                              height: rect.height,
                            },
                          });
                        }}
                        onKeyDown={(e: React.KeyboardEvent<HTMLDivElement>) => {
                          if (!interactive || isGhost) return;
                          if (
                            e.key === "Enter" ||
                            e.key === " " ||
                            e.key === "ContextMenu" ||
                            (e.shiftKey && e.key === "F10")
                          ) {
                            e.preventDefault();
                            e.stopPropagation();
                            const rect = e.currentTarget.getBoundingClientRect();
                            setOpenMenu({
                              section: section as PlanSection,
                              block,
                              anchorRect: {
                                top: rect.top,
                                left: rect.left,
                                right: rect.right,
                                bottom: rect.bottom,
                                width: rect.width,
                                height: rect.height,
                              },
                            });
                          }
                        }}
                        className={`absolute inset-x-0.5 rounded-control p-1.5 flex flex-col justify-between select-none overflow-hidden ${
                          isGhost
                            ? "cursor-default pointer-events-none"
                            : interactive
                            ? "cursor-pointer focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2"
                            : "cursor-default"
                        } ${theme.bgClass} ${theme.borderClass} ${theme.textClass} ${borderStyleClass} ${visualClass} ${conflictClass} ${blockAnimationClass}`}
                        style={{
                          ...blockAnimationStyle,
                          top: `${pos.topPercent}%`,
                          height: `calc(${pos.heightPercent}% - 4px)`,
                          minHeight: "56px",
                          borderLeftColor: isConflicting ? "#ef4444" : isMissing ? "#f59e0b" : theme.borderHex,
                          borderLeftStyle: isF2F ? "solid" : "dashed",
                        }}
                        title={
                          isCurrentMenuOpen
                            ? undefined
                            : blockTooltip(section, block, {
                                isF2F,
                                isGhost,
                                isMissing,
                              })
                        }
                      >
                        {/* Top row: Course Code, Section Code, Actions */}
                        <div className="flex items-center justify-between gap-1 leading-tight min-w-0">
                          <div className="flex items-baseline gap-1 min-w-0">
                            <span className="font-bold text-xs truncate">
                              {section.courseCode}
                            </span>
                            <span className="text-micro font-medium opacity-75 shrink-0">
                              {section.sectionCode}
                            </span>
                          </div>

                          <div className="flex items-center gap-1 shrink-0">
                            {isPinned && (
                              <Pin
                                className="h-3 w-3 text-slate-700"
                                aria-label="Pinned"
                              />
                            )}
                            {isConflicting && (
                              <AlertTriangle
                                /* No pulse: a conflict is shown the instant it
                                   exists, and animating it would soften it
                                   (ADR-0009) as well as put a forever-looping
                                   element on a forty-block surface. */
                                className="h-3.5 w-3.5 text-red-600"
                                aria-label="Conflicting section"
                              />
                            )}
                          </div>
                        </div>

                        {/* Middle: Location, Remark, and Status Badges / Enrolment */}
                        <div className="flex items-center justify-between gap-1 text-nano mt-0.5 opacity-90 min-w-0">
                          <div className="flex items-center gap-1 min-w-0 truncate">
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
                            {remark && (
                              <span
                                className="text-nano font-medium opacity-85 truncate"
                                title={remark}
                              >
                                • {remark}
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-1 shrink-0">
                            {isGhost && (
                              <span className="text-nano uppercase font-semibold opacity-75 bg-black/5 px-1 rounded-control">
                                Preview
                              </span>
                            )}
                            {isMissing && (
                              <span className="text-nano uppercase font-semibold bg-amber-200 text-amber-900 px-1 rounded-control">
                                Missing
                              </span>
                            )}
                            {!isGhost && !isMissing && (
                              <div
                                className="font-mono text-nano font-medium px-1 py-0.2 rounded-control bg-black/5 shrink-0"
                                title="Enrolled / Capacity"
                              >
                                {enrollLabel}
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Bottom: Precise Time Range */}
                        <div className="text-nano font-medium opacity-85 mt-0.5 whitespace-nowrap truncate tracking-tight">
                          {formatMinutesToTime12(block.startMin)} – {formatMinutesToTime12(block.endMin)}
                        </div>
                      </BlockTag>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Empty state.
          The grid is still drawn behind it, because the Mon-Sat shape is part
          of the answer to "what goes here". No ambient colour: this is a
          working surface, and any tint shifts the perceived hue of every block
          that lands in it (ADR-0012). */}
      {isEmpty && (
        <div
          data-testid="week-grid-empty"
          className="pointer-events-none absolute inset-0 top-12 flex items-center justify-center p-6"
        >
          <div className="pointer-events-auto max-w-sm rounded-panel border border-border bg-card/95 px-6 py-5 text-center shadow-lifted">
            <p className="text-base font-semibold text-foreground">
              No sections yet
            </p>
            {/* Describes the state, never the chrome around it: the tool
                panel folds away (ticket 46), and this same grid is what the
                PNG export renders. Naming a surface that may not be on
                screen — or that does not exist in an exported image — is how
                an empty state stops being true. */}
            <p className="mt-1.5 text-xs text-muted-foreground leading-relaxed">
              Sections you add to this plan appear here. Hovering a section
              previews it first — clicking commits it, and the preview becomes
              the block.
            </p>
          </div>
        </div>
      )}

      {/* Context Menu (Ticket 41, Ticket 45: rendered outside grid subtree and portaled to body in browser) */}
      {(() => {
        if (!openMenu || !interactive) return null;

        const { section, block, anchorRect } = openMenu;
        const isPinned = "pinned" in section ? section.pinned : false;
        const isMissing = "missing" in section ? section.missing : false;
        const isConflicting = isBlockConflicting(
          block,
          { courseId: section.courseId, sectionId: section.sectionId },
          conflicts
        );

        let computedStyle: React.CSSProperties;
        let placementClass: string;

        if (anchorRect && typeof window !== "undefined") {
          const viewport = {
            width: window.innerWidth,
            height: window.innerHeight,
          };
          const pos = computeMenuPosition(anchorRect, viewport);
          computedStyle = {
            position: "fixed",
            top: `${pos.top}px`,
            left: `${pos.left}px`,
          };
          placementClass = pos.alignY === "bottom" ? "origin-bottom" : "origin-top";
        } else {
          // Fallback for SSR / static markup tests
          computedStyle = {};
          placementClass = getMenuPlacement(block.day, block.startMin).className;
        }

        const menuJsx = (
          <div
            ref={menuRef}
            data-testid="grid-context-menu"
            role="menu"
            aria-orientation="vertical"
            className={`menu-enter z-50 w-56 rounded-panel border border-border bg-popover p-1.5 shadow-overlay text-popover-foreground text-xs font-sans ${placementClass}`}
            style={computedStyle}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-2 py-1 border-b border-border text-micro font-semibold text-muted-foreground truncate">
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
                className="flex w-full items-center rounded-control px-2 py-1.5 text-left text-xs text-foreground hover:bg-muted cursor-pointer"
              >
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
                className="flex w-full items-center rounded-control px-2 py-1.5 text-left text-xs text-foreground hover:bg-muted cursor-pointer"
              >
                <span>{isPinned ? "Unpin section" : "Pin section"}</span>
              </button>

              {/* 3. Show other sections of this course */}
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpenMenu(null);
                  onShowOtherSections?.(section.courseId);
                }}
                className="flex w-full items-center rounded-control px-2 py-1.5 text-left text-xs text-foreground hover:bg-muted cursor-pointer"
              >
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
                className="flex w-full items-center rounded-control px-2 py-1.5 text-left text-xs text-foreground hover:bg-muted cursor-pointer"
              >
                {copiedId === `${section.courseId}-${section.sectionId}` ? (
                  <span className="text-primary font-medium">Copied!</span>
                ) : (
                  <span>Copy details</span>
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
                  className="flex w-full items-center rounded-control px-2 py-1.5 text-left text-xs text-red-700 hover:bg-red-50 cursor-pointer font-medium"
                >
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
                  className="flex w-full items-center rounded-control px-2 py-1.5 text-left text-xs text-amber-800 hover:bg-amber-50 cursor-pointer font-medium"
                >
                  <span>Why is this flagged?</span>
                </button>
              )}

              {/* Separator before destructive action */}
              <div className="my-1 border-t border-border" />

              {/* 7. Remove from schedule (Destructive, last) */}
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpenMenu(null);
                  onRemoveSection?.(section as PlanSection);
                }}
                className="flex w-full items-center rounded-control px-2 py-1.5 text-left text-xs text-red-600 hover:bg-red-50 hover:text-red-700 cursor-pointer font-medium"
              >
                <span>Remove from schedule</span>
              </button>
            </div>
          </div>
        );

        if (typeof document !== "undefined" && document.body) {
          return createPortal(menuJsx, document.body);
        }
        return menuJsx;
      })()}

      {/* Section Details Modal */}
      {detailsSection && (
        <Dialog open={!!detailsSection} onOpenChange={(open) => !open && setDetailsSection(null)}>
          <DialogContent className="max-w-lg p-6 space-y-4" data-testid="section-details-dialog">
            <DialogHeader className="space-y-2 text-left">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-bold text-xl text-foreground">
                  {detailsSection.courseCode}
                </span>
                <span className="text-muted-foreground font-semibold text-lg">
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
                {detailsSection.pinned && <Badge variant="secondary">Pinned</Badge>}
                {detailsSection.missing && (
                  <Badge variant="destructive" className="bg-amber-100 text-amber-900 border-amber-300">
                    Missing
                  </Badge>
                )}
              </div>
              <DialogTitle className="text-base font-semibold text-foreground leading-snug">
                {detailsSection.courseTitle}
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                Detailed schedule and capture information for this section.
              </DialogDescription>
            </DialogHeader>

            {/* Meeting Schedule Blocks */}
            <div className="space-y-2">
              <label className="text-micro font-semibold text-muted-foreground uppercase tracking-wider block">
                Meeting Schedule
              </label>
              <div className="space-y-1.5">
                {detailsSection.blocks.map((b, idx) => (
                  <div
                    key={`${b.day}-${b.startMin}-${idx}`}
                    className="flex items-center justify-between rounded-card border border-border bg-muted/50 px-3 py-2 text-xs"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-foreground">{b.day}</span>
                      <span className="text-muted-foreground">•</span>
                      <span className="font-mono text-muted-foreground">
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
            <div className="grid grid-cols-2 gap-3 rounded-panel border border-border bg-muted/40 p-3 text-xs">
              <div>
                <span className="text-slate-500 block">Professor:</span>
                <span className="font-medium text-slate-900">
                  {formatProfessor(detailsSection.latestSnapshot?.professor)}
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
                <span className="font-semibold text-foreground block">Remark:</span>
                <p className="text-slate-600 font-mono break-words">
                  {detailsSection.latestSnapshot.remark}
                </p>
              </div>
            )}

            <DialogFooter className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-border">
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => handleCopySectionDetails(detailsSection)}
                  className="h-8 text-xs"
                >
                  Copy details
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
                    className="h-8 text-xs"
                  >
                    Other sections
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
                    className="h-8 text-xs border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
                  >
                    Remove
                  </Button>
                )}
                <Button
                  type="button"
                  size="sm"
                  onClick={() => setDetailsSection(null)}
                  className="h-8 text-xs bg-foreground text-white hover:bg-slate-800"
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
              <DialogTitle className="text-base font-bold text-foreground">
                Why is this conflicting?
              </DialogTitle>
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

            {/* The amber explainer that used to sit here was more panel than
                the moment warranted, but it carried one thing nothing else on
                this surface says: that keeping the overlap is a real option.
                A conflict is displayed and never prevented (ADR-0009), and a
                student who is not told that reads the hatch as a refusal. One
                line, in the dialog that is already explaining the conflict. */}
            <p className="text-xs text-muted-foreground" data-testid="conflict-is-allowed">
              Keeping both is allowed — Animo Plan shows conflicts and never blocks them.
            </p>

            <DialogFooter className="flex flex-row items-center justify-end gap-2 pt-3 border-t border-border">
              {onShowOtherSections && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    onShowOtherSections(conflictExplanation.section.courseId);
                    setConflictExplanation(null);
                  }}
                  className="h-8 text-xs"
                >
                  Show alternatives
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                onClick={() => setConflictExplanation(null)}
                className="h-8 text-xs bg-foreground text-white hover:bg-slate-800"
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
              <DialogTitle className="text-base font-bold text-foreground">
                Why is this flagged?
              </DialogTitle>
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
                    <span className="font-semibold text-foreground">Retention Invariant (ADR-0008):</span>
                    <span className="text-micro text-muted-foreground">
                      Last seen: {missingDesc.lastSeen}
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    {missingDesc.message}
                  </p>
                </div>
              );
            })()}

            <DialogFooter className="flex flex-row items-center justify-end gap-2 pt-3 border-t border-border">
              {onShowOtherSections && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    onShowOtherSections(flaggedExplanation.courseId);
                    setFlaggedExplanation(null);
                  }}
                  className="h-8 text-xs"
                >
                  Find alternative
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
                  Remove
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                onClick={() => setFlaggedExplanation(null)}
                className="h-8 text-xs bg-foreground text-white hover:bg-slate-800"
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
