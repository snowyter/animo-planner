import { useState, useEffect, useCallback } from "react";
import {
  Sparkles,
  RefreshCw,
  AlertTriangle,
  AlertCircle,
  Clock,
  SlidersHorizontal,
  ChevronDown,
  ChevronUp,
  XCircle,
  RotateCcw,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { Alert, AlertTitle, AlertDescription } from "./ui/alert";
import { SolutionThumbnail } from "./SolutionThumbnail";
import type { Day, Plan, Preset, Solution, SolveOptions, SolveResult } from "../adapters/ipc/types";
import { DAY_INFOS } from "../core/grid";
import { PRESET_INFOS, defaultSolveOptions, formatUnsatisfiableCoursesMessage } from "../core/solver";
import * as client from "../adapters/ipc/client";
import { formatErrorMessage } from "../core/error";
import { solutionToSectionRefs } from "../core/solver";

export interface SolveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  planId: string;
  initialResult?: SolveResult | null;
  defaultShowConstraints?: boolean;
  onPlanUpdated?: (plan: Plan) => void;
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

export function SolveDialog({
  open,
  onOpenChange,
  planId,
  initialResult = null,
  defaultShowConstraints = false,
  onPlanUpdated,
}: SolveDialogProps) {
  const [options, setOptions] = useState<SolveOptions>(() => defaultSolveOptions());
  const [showConstraints, setShowConstraints] = useState(defaultShowConstraints);
  const [isSolving, setIsSolving] = useState(false);
  const [isContinuing, setIsContinuing] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SolveResult | null>(initialResult);

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

  // When dialog opens and no initial result was passed, trigger solve
  useEffect(() => {
    if (open && !initialResult) {
      runSolve(options);
    }
  }, [open, initialResult, runSolve]);

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

  const handleApplySolution = async (solution: Solution) => {
    setIsApplying(true);
    setError(null);
    try {
      const updatedPlan = await client.applySolution({
        planId,
        sections: solutionToSectionRefs(solution),
      });
      onPlanUpdated?.(updatedPlan);
      onOpenChange(false);
    } catch (err) {
      setError(formatErrorMessage(err));
    } finally {
      setIsApplying(false);
    }
  };

  const hasNonDefaultConstraints =
    options.dayBlacklist.length > 0 ||
    options.earliestStartMin !== null ||
    options.latestEndMin !== null ||
    options.excludeFull;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col p-0 gap-0 overflow-hidden sm:rounded-2xl">
        {/* Header */}
        <DialogHeader className="p-6 pb-4 border-b border-slate-200 bg-white">
          <div className="flex items-center gap-2 text-emerald-700">
            <Sparkles className="h-5 w-5" />
            <DialogTitle className="text-xl font-bold text-slate-900">
              Solve the rest
            </DialogTitle>
          </div>
          <DialogDescription className="text-xs text-slate-500 mt-1">
            Find ranked, conflict-free combinations to fill unassigned courses
            around your choices. Anything already in your plan is treated as
            pinned and kept unchanged.
          </DialogDescription>
        </DialogHeader>

        {/* Scrollable Main Area */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-slate-50/50">
          {/* Primary Controls: Presets (SPEC §6, Ticket 20) */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-600">
                Ranking Preset (Primary Control)
              </label>
              {isSolving && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-emerald-700 font-medium flex items-center gap-1.5">
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    Searching combinations...
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleCancelSolve}
                    className="h-6 text-[11px] px-2 text-slate-600"
                  >
                    <XCircle className="h-3 w-3 mr-1 text-slate-500" />
                    Cancel
                  </Button>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {PRESET_INFOS.map((info) => {
                const isSelected = options.preset === info.preset;
                return (
                  <button
                    key={info.preset}
                    type="button"
                    disabled={isSolving}
                    onClick={() => handlePresetSelect(info.preset)}
                    className={`flex flex-col text-left p-3.5 rounded-xl border transition-all cursor-pointer ${
                      isSelected
                        ? "border-emerald-600 bg-white ring-2 ring-emerald-600/20 shadow-xs"
                        : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/50 text-slate-700"
                    }`}
                  >
                    <div className="flex items-center justify-between w-full">
                      <span
                        className={`text-sm font-bold ${
                          isSelected ? "text-emerald-900" : "text-slate-900"
                        }`}
                      >
                        {info.label}
                      </span>
                      {isSelected && (
                        <span className="h-2 w-2 rounded-full bg-emerald-600" />
                      )}
                    </div>
                    <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                      {info.description}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Secondary Controls: Constraints (Ticket 20) */}
          <div className="rounded-xl border border-slate-200 bg-white shadow-2xs overflow-hidden">
            <div
              onClick={() => setShowConstraints(!showConstraints)}
              className="flex items-center justify-between p-4 cursor-pointer hover:bg-slate-50 transition-colors select-none"
            >
              <div className="flex items-center gap-2">
                <SlidersHorizontal className="h-4 w-4 text-slate-500" />
                <span className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                  Secondary Constraints
                </span>
                {hasNonDefaultConstraints && (
                  <span className="ml-1.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-bold px-2 py-0.5">
                    Active
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 text-slate-500 text-xs">
                <span>{showConstraints ? "Hide constraints" : "Show constraints"}</span>
                {showConstraints ? (
                  <ChevronUp className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
              </div>
            </div>

            {showConstraints && (
              <div className="p-4 pt-0 border-t border-slate-100 space-y-4">
                {/* Day Blacklist */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700">
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
                          className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all cursor-pointer ${
                            isBlacklisted
                              ? "bg-red-50 text-red-700 border-red-200 ring-1 ring-red-400/40"
                              : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
                          }`}
                        >
                          {d.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Earliest start / Latest end */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label
                      htmlFor="earliest-start"
                      className="text-xs font-semibold text-slate-700 flex items-center gap-1"
                    >
                      <Clock className="h-3.5 w-3.5 text-slate-400" />
                      <span>Earliest start</span>
                    </label>
                    <select
                      id="earliest-start"
                      disabled={isSolving}
                      value={options.earliestStartMin ?? ""}
                      onChange={(e) => {
                        const val = e.target.value ? Number(e.target.value) : null;
                        setOptions({ ...options, earliestStartMin: val });
                      }}
                      className="flex h-9 w-full rounded-md border border-slate-200 bg-white px-3 py-1 text-xs shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-600"
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
                      className="text-xs font-semibold text-slate-700 flex items-center gap-1"
                    >
                      <Clock className="h-3.5 w-3.5 text-slate-400" />
                      <span>Latest end</span>
                    </label>
                    <select
                      id="latest-end"
                      disabled={isSolving}
                      value={options.latestEndMin ?? ""}
                      onChange={(e) => {
                        const val = e.target.value ? Number(e.target.value) : null;
                        setOptions({ ...options, latestEndMin: val });
                      }}
                      className="flex h-9 w-full rounded-md border border-slate-200 bg-white px-3 py-1 text-xs shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-600"
                    >
                      {LATEST_END_OPTIONS.map((opt, i) => (
                        <option key={i} value={opt.min ?? ""}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Exclude full & Actions */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-2">
                  <label className="flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={options.excludeFull}
                      disabled={isSolving}
                      onChange={(e) =>
                        setOptions({ ...options, excludeFull: e.target.checked })
                      }
                      className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                    />
                    <span>Exclude full sections (enrolled ≥ capacity)</span>
                  </label>

                  <div className="flex items-center gap-2">
                    {hasNonDefaultConstraints && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={isSolving}
                        onClick={handleResetConstraints}
                        className="h-7 text-xs text-slate-500 hover:text-slate-900"
                      >
                        <RotateCcw className="h-3 w-3 mr-1" />
                        Reset
                      </Button>
                    )}
                    <Button
                      type="button"
                      size="sm"
                      disabled={isSolving}
                      onClick={() => runSolve(options)}
                      className="h-8 text-xs shadow-xs"
                    >
                      <Sparkles className="h-3.5 w-3.5 mr-1" />
                      Apply Constraints & Solve
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Error Message */}
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Solve error</AlertTitle>
              <AlertDescription className="font-mono text-xs break-all mt-1">
                {error}
              </AlertDescription>
            </Alert>
          )}

          {/* Node Cap Partial Result Banner (Ticket 20 requirement: keep searching extends search) */}
          {result?.status === "partial" && (
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50/70 p-4">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <h4 className="text-xs font-bold text-amber-900">
                    Search reached node limit (partial results)
                  </h4>
                  <p className="text-xs text-amber-700 mt-0.5">
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
                className="text-xs shrink-0 bg-white hover:bg-amber-50 text-amber-900 border-amber-300"
              >
                <Sparkles className="h-3.5 w-3.5 mr-1 text-amber-600" />
                {isContinuing ? "Searching..." : "Keep searching"}
              </Button>
            </div>
          )}

          {/* Unsatisfiable / Empty Results (Ticket 20 requirement: names the unsatisfiable course) */}
          {result &&
            result.solutions.length === 0 &&
            (result.status === "unsatisfiable" ||
              result.unsatisfiableCourses.length > 0 ||
              result.status === "complete") && (
              <div className="rounded-xl border border-slate-200 bg-white p-8 text-center space-y-3 shadow-2xs">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-50 text-amber-600">
                  <AlertCircle className="h-6 w-6" />
                </div>
                <h3 className="text-base font-bold text-slate-900">
                  No conflict-free schedules found
                </h3>
                <p className="text-xs text-slate-600 max-w-md mx-auto leading-relaxed">
                  {formatUnsatisfiableCoursesMessage(result.unsatisfiableCourses)}
                </p>
                <p className="text-[11px] text-slate-400">
                  Try relaxing secondary constraints like day blacklists or start/end bounds, or unpinning conflicting sections.
                </p>
              </div>
            )}

          {/* Solutions List */}
          {result && result.solutions.length > 0 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600">
                  Ranked Solutions ({result.solutions.length})
                </h3>
                <span className="text-xs text-slate-400">
                  Sorted by {options.preset.replace(/_/g, " ")}
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {result.solutions.map((solution, index) => (
                  <SolutionThumbnail
                    key={solution.id}
                    solution={solution}
                    rank={index + 1}
                    isApplying={isApplying}
                    onApply={handleApplySolution}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
