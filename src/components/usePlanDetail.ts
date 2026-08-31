import { useState, useCallback, useEffect, useRef } from "react";
import * as client from "../adapters/ipc/client";
import type { Plan } from "../adapters/ipc/types";
import { formatErrorMessage } from "../core/error";

export interface PlanDetailState {
  plan: Plan | null;
  isLoading: boolean;
  error: string | null;
  fetchPlan: () => Promise<void>;
}

export function usePlanDetailState(planId: string): PlanDetailState {
  let plan: Plan | null = null;
  let isLoading = false;
  let error: string | null = null;

  return {
    get plan() {
      return plan;
    },
    get isLoading() {
      return isLoading;
    },
    get error() {
      return error;
    },
    fetchPlan: async () => {
      isLoading = true;
      error = null;
      try {
        plan = await client.getPlan({ planId });
      } catch (err) {
        error = formatErrorMessage(err);
        plan = null;
      } finally {
        isLoading = false;
      }
    },
  };
}

export function usePlanDetail(planId: string) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Which plan the newest request is for. A fetch for a plan the student has
  // already navigated away from must not land: an older request that resolves
  // late would otherwise overwrite the current plan's state, which showed up
  // as "plan \"sample-plan\" not found" sitting over a loaded plan.
  const currentPlanIdRef = useRef<string>(planId);

  const fetchPlan = useCallback(async () => {
    currentPlanIdRef.current = planId;
    setIsLoading(true);
    setError(null);
    try {
      const result = await client.getPlan({ planId });
      if (currentPlanIdRef.current !== planId) return;
      setPlan(result);
    } catch (err) {
      if (currentPlanIdRef.current !== planId) return;
      setError(formatErrorMessage(err));
      setPlan(null);
    } finally {
      if (currentPlanIdRef.current === planId) {
        setIsLoading(false);
      }
    }
  }, [planId]);

  useEffect(() => {
    // One-shot fetch on mount (and again if the plan changes). The loading
    // flag is up before the first paint of the fetch; not a cascade.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchPlan();
  }, [fetchPlan]);

  return {
    plan,
    isLoading,
    error,
    refreshPlan: fetchPlan,
  };
}
