import { useState, useCallback } from "react";
import * as client from "../adapters/ipc/client";
import type { Day, Plan, Preset, Solution, SolveOptions, SolveResult } from "../adapters/ipc/types";
import { defaultSolveOptions, solutionToSectionRefs } from "../core/solver";
import { formatErrorMessage } from "../core/error";

export interface SolvePlanOptions {
  planId: string;
  initialPreset?: Preset;
  onPlanUpdated?: (plan: Plan) => void;
}

export interface SolvePlanState {
  options: SolveOptions;
  isSolving: boolean;
  isContinuing: boolean;
  isApplying: boolean;
  isCancelling: boolean;
  error: string | null;
  result: SolveResult | null;
  selectedSolutionId: string | null;
  setPreset: (preset: Preset) => void;
  setDayBlacklist: (days: Day[]) => void;
  toggleDayBlacklist: (day: Day) => void;
  setEarliestStartMin: (min: number | null) => void;
  setLatestEndMin: (min: number | null) => void;
  setExcludeFull: (exclude: boolean) => void;
  setResultLimit: (limit: number) => void;
  resetConstraints: () => void;
  setSelectedSolutionId: (id: string | null) => void;
  solve: (optionsOverride?: Partial<SolveOptions>) => Promise<SolveResult | null>;
  continueSolve: () => Promise<SolveResult | null>;
  cancel: () => Promise<void>;
  apply: (solution: Solution) => Promise<Plan>;
}

export function useSolvePlanState(config: SolvePlanOptions): SolvePlanState {
  let options: SolveOptions = defaultSolveOptions(config.initialPreset ?? "fewest_campus_days");
  let isSolving = false;
  let isContinuing = false;
  let isApplying = false;
  let isCancelling = false;
  let error: string | null = null;
  let result: SolveResult | null = null;
  let selectedSolutionId: string | null = null;

  const setPreset = (preset: Preset) => {
    options = { ...options, preset };
  };

  const setDayBlacklist = (days: Day[]) => {
    options = { ...options, dayBlacklist: days };
  };

  const toggleDayBlacklist = (day: Day) => {
    const next = options.dayBlacklist.includes(day)
      ? options.dayBlacklist.filter((d) => d !== day)
      : [...options.dayBlacklist, day];
    options = { ...options, dayBlacklist: next };
  };

  const setEarliestStartMin = (min: number | null) => {
    options = { ...options, earliestStartMin: min };
  };

  const setLatestEndMin = (min: number | null) => {
    options = { ...options, latestEndMin: min };
  };

  const setExcludeFull = (exclude: boolean) => {
    options = { ...options, excludeFull: exclude };
  };

  const setResultLimit = (limit: number) => {
    options = { ...options, resultLimit: limit };
  };

  const resetConstraints = () => {
    options = {
      ...defaultSolveOptions(options.preset),
    };
  };

  const setSelectedSolutionId = (id: string | null) => {
    selectedSolutionId = id;
  };

  const solve = async (optionsOverride?: Partial<SolveOptions>): Promise<SolveResult | null> => {
    if (optionsOverride) {
      options = { ...options, ...optionsOverride };
    }
    isSolving = true;
    error = null;
    try {
      const res = await client.solvePlan({
        planId: config.planId,
        options,
      });
      result = res;
      const [firstSolution] = res.solutions;
      selectedSolutionId = firstSolution?.id ?? null;
      return res;
    } catch (err) {
      error = formatErrorMessage(err);
      result = null;
      return null;
    } finally {
      isSolving = false;
    }
  };

  const continueSolve = async (): Promise<SolveResult | null> => {
    if (!result?.resumeToken) return null;
    isSolving = true;
    isContinuing = true;
    error = null;
    try {
      const res = await client.continueSolve({
        planId: config.planId,
        resumeToken: result.resumeToken,
      });
      result = res;
      if (
        selectedSolutionId === null ||
        !res.solutions.some((s) => s.id === selectedSolutionId)
      ) {
        const [firstSolution] = res.solutions;
        if (firstSolution) {
          selectedSolutionId = firstSolution.id;
        }
      }
      return res;
    } catch (err) {
      error = formatErrorMessage(err);
      return null;
    } finally {
      isSolving = false;
      isContinuing = false;
    }
  };

  const cancel = async (): Promise<void> => {
    isCancelling = true;
    try {
      await client.cancelSolve();
    } catch (err) {
      error = formatErrorMessage(err);
    } finally {
      isCancelling = false;
    }
  };

  const apply = async (solution: Solution): Promise<Plan> => {
    isApplying = true;
    error = null;
    try {
      const updatedPlan = await client.applySolution({
        planId: config.planId,
        sections: solutionToSectionRefs(solution),
      });
      config.onPlanUpdated?.(updatedPlan);
      return updatedPlan;
    } catch (err) {
      const msg = formatErrorMessage(err);
      error = msg;
      throw err;
    } finally {
      isApplying = false;
    }
  };

  return {
    get options() {
      return options;
    },
    get isSolving() {
      return isSolving;
    },
    get isContinuing() {
      return isContinuing;
    },
    get isApplying() {
      return isApplying;
    },
    get isCancelling() {
      return isCancelling;
    },
    get error() {
      return error;
    },
    get result() {
      return result;
    },
    get selectedSolutionId() {
      return selectedSolutionId;
    },
    setPreset,
    setDayBlacklist,
    toggleDayBlacklist,
    setEarliestStartMin,
    setLatestEndMin,
    setExcludeFull,
    setResultLimit,
    resetConstraints,
    setSelectedSolutionId,
    solve,
    continueSolve,
    cancel,
    apply,
  };
}

export function useSolvePlan(config: SolvePlanOptions) {
  const [options, setOptions] = useState<SolveOptions>(() =>
    defaultSolveOptions(config.initialPreset ?? "fewest_campus_days")
  );
  const [isSolving, setIsSolving] = useState<boolean>(false);
  const [isContinuing, setIsContinuing] = useState<boolean>(false);
  const [isApplying, setIsApplying] = useState<boolean>(false);
  const [isCancelling, setIsCancelling] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SolveResult | null>(null);
  const [selectedSolutionId, setSelectedSolutionId] = useState<string | null>(null);

  const setPreset = useCallback((preset: Preset) => {
    setOptions((prev) => ({ ...prev, preset }));
  }, []);

  const setDayBlacklist = useCallback((days: Day[]) => {
    setOptions((prev) => ({ ...prev, dayBlacklist: days }));
  }, []);

  const toggleDayBlacklist = useCallback((day: Day) => {
    setOptions((prev) => {
      const next = prev.dayBlacklist.includes(day)
        ? prev.dayBlacklist.filter((d) => d !== day)
        : [...prev.dayBlacklist, day];
      return { ...prev, dayBlacklist: next };
    });
  }, []);

  const setEarliestStartMin = useCallback((min: number | null) => {
    setOptions((prev) => ({ ...prev, earliestStartMin: min }));
  }, []);

  const setLatestEndMin = useCallback((min: number | null) => {
    setOptions((prev) => ({ ...prev, latestEndMin: min }));
  }, []);

  const setExcludeFull = useCallback((exclude: boolean) => {
    setOptions((prev) => ({ ...prev, excludeFull: exclude }));
  }, []);

  const setResultLimit = useCallback((limit: number) => {
    setOptions((prev) => ({ ...prev, resultLimit: limit }));
  }, []);

  const resetConstraints = useCallback(() => {
    setOptions((prev) => ({
      ...defaultSolveOptions(prev.preset),
    }));
  }, []);

  const solve = useCallback(
    async (optionsOverride?: Partial<SolveOptions>): Promise<SolveResult | null> => {
      const activeOptions = optionsOverride ? { ...options, ...optionsOverride } : options;
      if (optionsOverride) {
        setOptions(activeOptions);
      }
      setIsSolving(true);
      setError(null);
      try {
        const res = await client.solvePlan({
          planId: config.planId,
          options: activeOptions,
        });
        setResult(res);
        const [firstSolution] = res.solutions;
        setSelectedSolutionId(firstSolution?.id ?? null);
        return res;
      } catch (err) {
        const msg = formatErrorMessage(err);
        setError(msg);
        setResult(null);
        return null;
      } finally {
        setIsSolving(false);
      }
    },
    [config.planId, options]
  );

  const continueSolve = useCallback(async (): Promise<SolveResult | null> => {
    if (!result?.resumeToken) return null;
    setIsSolving(true);
    setIsContinuing(true);
    setError(null);
    try {
      const res = await client.continueSolve({
        planId: config.planId,
        resumeToken: result.resumeToken,
      });
      setResult(res);
      if (
        selectedSolutionId === null ||
        !res.solutions.some((s) => s.id === selectedSolutionId)
      ) {
        const [firstSolution] = res.solutions;
        if (firstSolution) {
          setSelectedSolutionId(firstSolution.id);
        }
      }
      return res;
    } catch (err) {
      const msg = formatErrorMessage(err);
      setError(msg);
      return null;
    } finally {
      setIsSolving(false);
      setIsContinuing(false);
    }
  }, [config.planId, result, selectedSolutionId]);

  const cancel = useCallback(async (): Promise<void> => {
    setIsCancelling(true);
    try {
      await client.cancelSolve();
    } catch (err) {
      setError(formatErrorMessage(err));
    } finally {
      setIsCancelling(false);
    }
  }, []);

  const apply = useCallback(
    async (solution: Solution): Promise<Plan> => {
      setIsApplying(true);
      setError(null);
      try {
        const updatedPlan = await client.applySolution({
          planId: config.planId,
          sections: solutionToSectionRefs(solution),
        });
        config.onPlanUpdated?.(updatedPlan);
        return updatedPlan;
      } catch (err) {
        const msg = formatErrorMessage(err);
        setError(msg);
        throw err;
      } finally {
        setIsApplying(false);
      }
    },
    [config]
  );

  return {
    options,
    isSolving,
    isContinuing,
    isApplying,
    isCancelling,
    error,
    result,
    selectedSolutionId,
    setPreset,
    setDayBlacklist,
    toggleDayBlacklist,
    setEarliestStartMin,
    setLatestEndMin,
    setExcludeFull,
    setResultLimit,
    resetConstraints,
    setSelectedSolutionId,
    solve,
    continueSolve,
    cancel,
    apply,
  };
}
