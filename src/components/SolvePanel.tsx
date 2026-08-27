import { useState, useEffect, useCallback, useRef } from "react";
/** Disclosure is an affordance no adjacent word supplies. Everything else on
 *  this surface labelled something the text already said. */
import { ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "./ui/button";
import { Alert, AlertTitle, AlertDescription } from "./ui/alert";
import { SolutionCard } from "./SolutionCard";
import type { Day, Plan, PlanSection, Preset, Solution, SolveOptions, SolveResult } from "../adapters/ipc/types";
import { DAY_INFOS } from "../core/grid";
import { PRESET_INFOS, defaultSolveOptions, formatExclusionNotice, formatUnsatisfiableCoursesMessage } from "../core/solver";
import type { PreferenceSummary, Priority } from "../core/teacherRanking";
import {
  DEFAULT_PRIORITY,
  PRIORITY_INFOS,
  formatPreferenceSummary,
  formatSchedulePriorityNoOp,
} from "../core/teacherRanking";
import * as client from "../adapters/ipc/client";
import { formatErrorMessage } from "../core/error";
import { solutionToSectionRefs } from "../core/solver";

/** Which ranked result the grid is previewing. Rank is how the grid names it. */
export interface SolutionSelection {
  solution: Solution;
  rank: number;
}

export interface SolvePanelProps {
  planId: string;
  planSections?: PlanSection[];
  onTogglePin?: (section: PlanSection, pinned: boolean) => void;
  initialResult?: SolveResult | null;
  defaultShowConstraints?: boolean;
  /**
   * Test seam for the in-flight state. The suite renders to static markup, so
   * a solve never actually runs and the progress row plus its Cancel control
   * would otherwise be unassertable.
   */
  initialIsSolving?: boolean;
  onPlanUpdated?: (plan: Plan) => void;
  /**
   * Which solution is being previewed on the week grid, and how the panel
   * says so (ticket 46). The preview itself lives on the grid, one region
   * over; this panel only names the choice.
   *
   * Controlled from the workspace rather than held here, because leaving the
   * Solve tab has to restore the real plan — and the tab is not this
   * component's to know about.
   */
  selectedSolutionId?: string | null;
  onSelectSolution?: (selection: SolutionSelection | null) => void;
  /**
   * How heavily a teacher ranking weighs against the preset (ADR-0021).
   * A second axis, not a fourth preset. The suite renders to static markup
   * and cannot click, so the selection is drivable from props.
   */
  initialPriority?: Priority;
  /**
   * What the student has already said, across the plan. Read-only here: the
   * panel is where a ranking is *felt*, and deliberately not where it is
   * made.
   */
  preferenceSummary?: PreferenceSummary;
  /** The way back to where preferences are actually edited. */
  onOpenPreferences?: () => void;
}

const EARLIEST_START_OPTIONS: { label: string; min: number | null }[] = [
  { label: "Any start time", min: null },
  { label: "07:30 AM or later", min: 450 },
  { label: "09:15 AM or later", min: 555 },
  { label: "11:00 AM or later", min: 660 },
  { label: "12:45 PM or later", min: 765 },
  { label: "02:30 PM or later", min: 870 },
  { label: "04:15 PM or later", min: 975 },
  { label: "06:00 PM or later", min: 1080 },
];

const LATEST_END_OPTIONS: { label: string; min: number | null }[] = [
  { label: "Any end time", min: null },
  { label: "By 12:30 PM", min: 750 },
  { label: "By 02:15 PM", min: 855 },
  { label: "By 04:00 PM", min: 960 },
  { label: "By 05:45 PM", min: 1065 },
  { label: "By 07:30 PM", min: 1170 },
  { label: "By 09:00 PM", min: 1260 },
];

export function SolvePanel({
  planId,
  planSections,
  onTogglePin,
  initialResult = null,
  defaultShowConstraints = false,
  initialIsSolving = false,
  onPlanUpdated,
  selectedSolutionId = null,
  onSelectSolution,
  initialPriority = DEFAULT_PRIORITY,
  preferenceSummary = { rankedCourses: 0, avoidedTeachers: 0 },
  onOpenPreferences,
}: SolvePanelProps) {
  const [options, setOptions] = useState<SolveOptions>(() => defaultSolveOptions());
  /**
   * The priority axis.
   *
   * Held beside the solve options rather than inside them: the solver does
   * not read it yet (ticket 48 is what teaches it to), and `Schedule` is
   * bit-for-bit today's behaviour, so a ranking simply has no effect until
   * that lands. What must not wait is the interface saying so.
   */
  const [priority, setPriority] = useState<Priority>(initialPriority);
  const [showConstraints, setShowConstraints] = useState(defaultShowConstraints);
  const [isSolving, setIsSolving] = useState(initialIsSolving);
  const [isContinuing, setIsContinuing] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SolveResult | null>(initialResult);
  const [currentPlanSections, setCurrentPlanSections] = useState<PlanSection[]>(
    () => planSections ?? []
  );

  useEffect(() => {
    if (planSections) {
      setCurrentPlanSections(planSections);
    }
  }, [planSections]);

  const handleTogglePinSection = async (section: PlanSection, pinned: boolean) => {
    setCurrentPlanSections((prev) =>
      prev.map((s) =>
        s.courseId === section.courseId && s.sectionId === section.sectionId
          ? { ...s, pinned }
          : s
      )
    );

    try {
      if (onTogglePin) {
        onTogglePin(section, pinned);
      } else {
        const updated = await client.setSectionPinned({
          planId,
          courseId: section.courseId,
          sectionId: section.sectionId,
          pinned,
        });
        onPlanUpdated?.(updated);
      }
      runSolve(options);
    } catch (err) {
      setError(formatErrorMessage(err));
    }
  };

  const runSolve = useCallback(
    async (solveOpts: SolveOptions) => {
      setIsSolving(true);
      setError(null);
      try {
        const res = await client.solvePlan({
          planId,
          options: solveOpts,
        });
        setResult(res);
      } catch (err) {
        setError(formatErrorMessage(err));
        setResult(null);
      } finally {
        setIsSolving(false);
      }
    },
    [planId]
  );

  // The panel only exists while the Solve tab is selected, so mounting is the
  // same event that opening the dialog used to be: solve once, on arrival.
  // Every later solve comes from a control the student pressed.
  const hasSolvedRef = useRef(false);
  useEffect(() => {
    if (hasSolvedRef.current || initialResult) {
      return;
    }
    hasSolvedRef.current = true;
    runSolve(options);
  }, [initialResult, options, runSolve]);

  const handlePresetSelect = (preset: Preset) => {
    const nextOpts: SolveOptions = { ...options, preset };
    setOptions(nextOpts);
    runSolve(nextOpts);
  };

  const handleToggleDay = (day: Day) => {
    const nextBlacklist = options.dayBlacklist.includes(day)
      ? options.dayBlacklist.filter((d) => d !== day)
      : [...options.dayBlacklist, day];
    setOptions({ ...options, dayBlacklist: nextBlacklist });
  };

  const handleResetConstraints = () => {
    setOptions({
      ...defaultSolveOptions(options.preset),
    });
  };

  const handleContinueSolve = async () => {
    if (!result?.resumeToken) return;
    setIsSolving(true);
    setIsContinuing(true);
    setError(null);
    try {
      const res = await client.continueSolve({
        planId,
        resumeToken: result.resumeToken,
      });
      setResult(res);
    } catch (err) {
      setError(formatErrorMessage(err));
    } finally {
      setIsSolving(false);
      setIsContinuing(false);
    }
  };

  const handleCancelSolve = async () => {
    try {
      await client.cancelSolve();
    } catch {
      // safe ignore
    }
  };

  /** Selecting the same solution twice clears the preview, as a toggle. */
  const handleSelectSolution = (solution: Solution, rank: number) => {
    onSelectSolution?.(
      selectedSolutionId === solution.id ? null : { solution, rank }
    );
  };

  const handleApplySolution = async (solution: Solution) => {
    setIsApplying(true);
    setError(null);
    try {
      const updatedPlan = await client.applySolution({
        planId,
        sections: solutionToSectionRefs(solution),
      });
      onPlanUpdated?.(updatedPlan);
      // The plan now *is* the solution, so a preview of it would be a preview
      // of what is already on the grid.
      onSelectSolution?.(null);
    } catch (err) {
      setError(formatErrorMessage(err));
    } finally {
      setIsApplying(false);
    }
  };

  // Exclude-full defaults to on (ticket 34): only a *deviation* from the
  // defaults — turning it off included — counts as an active constraint.
  const hasNonDefaultConstraints =
    options.dayBlacklist.length > 0 ||
    options.earliestStartMin !== null ||
    options.latestEndMin !== null ||
    options.excludeFull !== defaultSolveOptions(options.preset).excludeFull;

  const noOpWarning = formatSchedulePriorityNoOp(priority, preferenceSummary);

  const exclusionNotice = result
    ? formatExclusionNotice(result.excludedFullCount, result.snapshotTakenAt)
    : null;

  return (
    /* A panel in the tool column, not a modal over the workspace (ticket 46).
       Its whole point is that the week grid stays visible beside it while a
       candidate is previewed on it, which a dialog would have covered. */
    <div data-testid="solve-panel" className="space-y-4">
      <div className="rounded-panel border border-border bg-card p-4">
        <h3 className="text-base font-bold text-foreground">Solve the rest</h3>
        <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
          Find ranked, conflict-free combinations to fill unassigned courses
          around your choices. Pinned sections are fixed and never moved;
          unpinned sections may be moved to find valid combinations. Selecting
          a result previews it on the week grid.
        </p>
      </div>

      <div className="space-y-6">
          {/* Your Plan Sections & Pinning Panel (Ticket 43) */}
          {currentPlanSections.length > 0 && (
            <div className="rounded-panel border border-border bg-card p-4 space-y-3">
              <div className="flex flex-col gap-1">
                <span className="text-foreground font-bold text-micro uppercase tracking-wider">
                  Your Plan Sections ({currentPlanSections.length})
                </span>
                <span className="text-xs text-muted-foreground font-normal">
                  Pinned sections are exempt from moving
                </span>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Pinned sections are fixed and never moved. Unpinned sections can be swapped if needed to find conflict-free combinations.
              </p>

              <div className="grid grid-cols-1 gap-2 pt-1">
                {currentPlanSections.map((sec) => (
                  <div
                    key={`${sec.courseId}-${sec.sectionId}`}
                    className={`flex items-center justify-between p-2.5 rounded-card border text-xs ${
                      sec.pinned
                        ? "border-emerald-300 bg-emerald-50/60"
                        : "border-border bg-muted/40"
                    }`}
                  >
                    <div className="flex flex-col min-w-0 pr-2">
                      <div className="flex items-center gap-1.5 font-bold text-foreground truncate">
                        <span>{sec.courseCode}</span>
                        <span className="text-muted-foreground font-medium">{sec.sectionCode}</span>
                      </div>
                      <div className="mt-0.5">
                        {sec.pinned ? (
                          <span className="text-nano font-semibold text-emerald-800">
                            Pinned (Exempt)
                          </span>
                        ) : (
                          <span className="text-nano text-muted-foreground font-medium">
                            Unpinned
                          </span>
                        )}
                      </div>
                    </div>

                    <Button
                      type="button"
                      variant={sec.pinned ? "outline" : "secondary"}
                      size="sm"
                      disabled={isSolving}
                      onClick={() => handleTogglePinSection(sec, !sec.pinned)}
                      className="h-6 text-micro px-2 shrink-0 cursor-pointer"
                    >
                      {sec.pinned ? "Unpin" : "Pin"}
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Primary Controls: Presets (SPEC §6, Ticket 20) */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-micro font-bold uppercase tracking-wider text-muted-foreground">
                Ranking Preset (Primary Control)
              </label>
              {/* No spinner. A solve is exactly the moment the machine is
                  busiest, and the app must not be animating through it. */}
              {isSolving && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-primary font-medium">
                    Searching combinations...
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleCancelSolve}
                    className="h-6 text-micro px-2"
                    data-testid="solve-cancel"
                  >
                    Cancel
                  </Button>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 gap-2">
              {PRESET_INFOS.map((info) => {
                const isSelected = options.preset === info.preset;
                return (
                  <button
                    key={info.preset}
                    type="button"
                    disabled={isSolving}
                    onClick={() => handlePresetSelect(info.preset)}
                    className={`flex flex-col text-left p-3.5 rounded-panel border bg-card cursor-pointer ${
                      isSelected
                        ? "border-primary ring-1 ring-primary/25"
                        : "border-border hover:border-slate-300"
                    }`}
                  >
                    <div className="flex items-center justify-between w-full">
                      <span
                        className={`text-sm font-bold ${
                          isSelected ? "text-emerald-900" : "text-foreground"
                        }`}
                      >
                        {info.label}
                      </span>
                      {isSelected && (
                        <span className="h-2 w-2 rounded-pill bg-primary" />
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                      {info.description}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Priority: the second axis (ADR-0021). Every priority composes
              with every preset, which is why this is a row of its own rather
              than three more presets. */}
          <div className="space-y-2" data-testid="solve-priority">
            <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
              <label className="text-micro font-bold uppercase tracking-wider text-muted-foreground">
                Priority
              </label>
              <span className="text-nano text-muted-foreground">
                {formatPreferenceSummary(preferenceSummary)}
                {" · "}
                <button
                  type="button"
                  onClick={onOpenPreferences}
                  data-testid="solve-priority-summary-link"
                  className="cursor-pointer underline underline-offset-2 hover:text-foreground"
                >
                  Rank teachers in Capture
                </button>
              </span>
            </div>

            <div className="grid grid-cols-3 gap-2">
              {PRIORITY_INFOS.map((info) => {
                const isSelected = priority === info.priority;
                return (
                  <button
                    key={info.priority}
                    type="button"
                    data-priority={info.priority}
                    data-priority-selected={isSelected ? "true" : "false"}
                    disabled={isSolving}
                    onClick={() => setPriority(info.priority)}
                    title={info.description}
                    className={`rounded-card border bg-card px-2 py-2 text-xs font-bold cursor-pointer ${
                      isSelected
                        ? "border-primary text-emerald-900 ring-1 ring-primary/25"
                        : "border-border text-foreground hover:border-slate-300"
                    }`}
                  >
                    {info.label}
                  </button>
                );
              })}
            </div>

            <p className="text-nano leading-relaxed text-muted-foreground">
              {PRIORITY_INFOS.find((info) => info.priority === priority)?.description}
            </p>

            {/* A ranking under Schedule is a no-op by design, so the panel
                says so. A student who ranked for five minutes and saw nothing
                change would file the feature as broken (ADR-0021). */}
            {noOpWarning && (
              <div
                data-testid="priority-noop-warning"
                className="rounded-card border border-amber-300 bg-amber-50/80 p-3 space-y-2"
                role="status"
              >
                <p className="text-xs leading-relaxed text-amber-900">{noOpWarning}</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setPriority("teachers")}
                  data-testid="priority-noop-switch"
                  className="h-7 border-amber-300 bg-white text-xs text-amber-900 hover:bg-amber-100/50"
                >
                  Switch to Teachers
                </Button>
              </div>
            )}
          </div>

          {/* Secondary Controls: Constraints (Ticket 20) */}
          <div className="rounded-panel border border-border bg-card overflow-hidden">
            <div
              onClick={() => setShowConstraints(!showConstraints)}
              className="flex items-center justify-between p-4 cursor-pointer hover:bg-muted select-none"
            >
              <div className="flex items-center gap-2">
                <span className="text-micro font-bold text-foreground uppercase tracking-wider">
                  Secondary Constraints
                </span>
                {hasNonDefaultConstraints && (
                  <span className="ml-1.5 rounded-pill bg-emerald-100 text-emerald-900 text-nano font-bold px-2 py-0.5">
                    Active
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 text-muted-foreground text-xs">
                <span>{showConstraints ? "Hide constraints" : "Show constraints"}</span>
                {showConstraints ? (
                  <ChevronUp className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
              </div>
            </div>

            {showConstraints && (
              <div className="p-4 pt-0 border-t border-border space-y-4">
                {/* Day Blacklist */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-foreground">
                    Day Blacklist (exclude classes on selected days):
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {DAY_INFOS.map((d) => {
                      const isBlacklisted = options.dayBlacklist.includes(d.day);
                      return (
                        <button
                          key={d.day}
                          type="button"
                          disabled={isSolving}
                          onClick={() => handleToggleDay(d.day)}
                          className={`px-3 py-1.5 rounded-control text-xs font-semibold border cursor-pointer ${
                            isBlacklisted
                              ? "bg-red-50 text-red-700 border-red-300"
                              : "bg-card text-foreground border-border hover:bg-muted"
                          }`}
                        >
                          {d.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Earliest start / Latest end */}
                <div className="grid grid-cols-1 gap-3">
                  <div className="space-y-1.5">
                    <label
                      htmlFor="earliest-start"
                      className="text-xs font-semibold text-foreground block"
                    >
                      Earliest start
                    </label>
                    <select
                      id="earliest-start"
                      disabled={isSolving}
                      value={options.earliestStartMin ?? ""}
                      onChange={(e) => {
                        const val = e.target.value ? Number(e.target.value) : null;
                        setOptions({ ...options, earliestStartMin: val });
                      }}
                      className="flex h-9 w-full rounded-control border border-input bg-card px-3 py-1 text-xs"
                    >
                      {EARLIEST_START_OPTIONS.map((opt, i) => (
                        <option key={i} value={opt.min ?? ""}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <label
                      htmlFor="latest-end"
                      className="text-xs font-semibold text-foreground block"
                    >
                      Latest end
                    </label>
                    <select
                      id="latest-end"
                      disabled={isSolving}
                      value={options.latestEndMin ?? ""}
                      onChange={(e) => {
                        const val = e.target.value ? Number(e.target.value) : null;
                        setOptions({ ...options, latestEndMin: val });
                      }}
                      className="flex h-9 w-full rounded-control border border-input bg-card px-3 py-1 text-xs"
                    >
                      {LATEST_END_OPTIONS.map((opt, i) => (
                        <option key={i} value={opt.min ?? ""}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Exclude full & Actions.
                    The label is one line and the qualifier sits under it:
                    "Exclude full sections (enrolled ≥ capacity)" wrapped
                    mid-parenthesis beside the solve button and stopped
                    reading as a single control. */}
                <div className="flex flex-col gap-3 pt-2">
                  <div className="space-y-1">
                    <label
                      data-testid="exclude-full-label"
                      className="flex items-center gap-2 text-xs font-medium text-foreground cursor-pointer select-none"
                    >
                      <input
                        type="checkbox"
                        checked={options.excludeFull}
                        disabled={isSolving}
                        onChange={(e) =>
                          setOptions({ ...options, excludeFull: e.target.checked })
                        }
                        className="h-4 w-4 shrink-0 rounded-control border-slate-300 text-primary"
                      />
                      <span className="whitespace-nowrap">Exclude full sections</span>
                    </label>
                    <p className="pl-6 text-nano text-muted-foreground">
                      Enrolled is at or over capacity.
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {hasNonDefaultConstraints && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={isSolving}
                        onClick={handleResetConstraints}
                        className="h-7 text-xs text-muted-foreground hover:text-foreground"
                      >
                        Reset
                      </Button>
                    )}
                    <Button
                      type="button"
                      size="sm"
                      disabled={isSolving}
                      onClick={() => runSolve(options)}
                      className="h-8 text-xs"
                    >
                      Apply Constraints &amp; Solve
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Error Message */}
          {error && (
            <Alert variant="destructive">
              <AlertTitle>Solve error</AlertTitle>
              <AlertDescription className="font-mono text-xs break-all mt-1">
                {error}
              </AlertDescription>
            </Alert>
          )}

          {/* Node Cap Partial Result Banner (Ticket 20 requirement: keep searching extends search) */}
          {result?.status === "partial" && (
            <div className="flex flex-col gap-3 rounded-panel border border-amber-200 bg-amber-50/70 p-4">
              <div>
                <h4 className="text-xs font-bold text-amber-900">
                  Search reached node limit (partial results)
                </h4>
                <div>
                  <p className="text-xs text-amber-900 mt-0.5">
                    Found {result.solutions.length} valid combination
                    {result.solutions.length === 1 ? "" : "s"} so far. You can extend
                    the search to explore more combinations.
                  </p>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleContinueSolve}
                disabled={isSolving || isContinuing}
                className="text-xs shrink-0 text-amber-900 border-amber-300"
              >
                {isContinuing ? "Searching..." : "Keep searching"}
              </Button>
            </div>
          )}

          {/* Exclusion notice (ticket 34): the constraint is visible and
              its staleness is judgeable — never a quiet exclusion. */}
          {exclusionNotice && (
            <div className="rounded-panel border border-sky-200 bg-sky-50/70 p-4">
              <p className="text-xs text-sky-900 leading-relaxed">{exclusionNotice}</p>
            </div>
          )}

          {/* Unsatisfiable / Empty Results (Ticket 20 requirement: names the unsatisfiable course) */}
          {result &&
            result.solutions.length === 0 &&
            (result.status === "unsatisfiable" ||
              result.unsatisfiableCourses.length > 0 ||
              result.status === "complete") && (
              <div className="rounded-panel border border-border bg-card px-8 py-12 text-center">
                <h3 className="text-lg font-semibold text-foreground">
                  No conflict-free schedules found
                </h3>
                <p className="mt-2 text-sm text-muted-foreground max-w-md mx-auto leading-relaxed">
                  {formatUnsatisfiableCoursesMessage(result.unsatisfiableCourses)}
                </p>
                <p className="mt-3 text-xs text-muted-foreground max-w-md mx-auto leading-relaxed">
                  Try relaxing secondary constraints like day blacklists or
                  start/end bounds, or unpinning a conflicting section so the
                  solver can move it.
                </p>
              </div>
            )}

          {/* Solutions List */}
          {result && result.solutions.length > 0 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-micro font-bold uppercase tracking-wider text-muted-foreground">
                  Ranked Solutions ({result.solutions.length})
                </h3>
                <span className="text-xs text-muted-foreground">
                  Select one to preview it on the week grid · sorted by{" "}
                  {options.preset.replace(/_/g, " ")}
                </span>
              </div>

              <div className="grid grid-cols-1 gap-4">
                {result.solutions.map((solution, index) => (
                  <SolutionCard
                    key={solution.id}
                    solution={solution}
                    rank={index + 1}
                    topScore={result.solutions[0].score}
                    planSections={currentPlanSections}
                    isApplying={isApplying}
                    isSelected={selectedSolutionId === solution.id}
                    onSelect={(picked) => handleSelectSolution(picked, index + 1)}
                    onApply={handleApplySolution}
                  />
                ))}
              </div>
            </div>
          )}
      </div>
    </div>
  );
}
