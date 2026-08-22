import { useState, useCallback, useEffect } from "react";
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

  const fetchPlan = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await client.getPlan({ planId });
      setPlan(result);
    } catch (err) {
      setError(formatErrorMessage(err));
      setPlan(null);
    } finally {
      setIsLoading(false);
    }
  }, [planId]);

  useEffect(() => {
    fetchPlan();
  }, [fetchPlan]);

  return {
    plan,
    isLoading,
    error,
    refreshPlan: fetchPlan,
  };
}
