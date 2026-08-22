import { useState, useCallback, useEffect } from "react";
import * as client from "../adapters/ipc/client";
import type { PlanSummary } from "../adapters/ipc/types";
import { formatErrorMessage } from "../core/error";

export interface PlansState {
  plans: PlanSummary[];
  isLoading: boolean;
  error: string | null;
  fetchPlans: () => Promise<void>;
  handleCreatePlan: (args: { name: string; campusId: number; sessionId: number }) => Promise<PlanSummary>;
  handleDeletePlan: (planId: string) => Promise<void>;
  handleSeedSample: () => Promise<PlanSummary>;
  clearError: () => void;
}

export function usePlansState(): PlansState {
  let plans: PlanSummary[] = [];
  let isLoading = false;
  let error: string | null = null;

  const stateObj: PlansState = {
    get plans() {
      return plans;
    },
    get isLoading() {
      return isLoading;
    },
    get error() {
      return error;
    },
    fetchPlans: async () => {
      isLoading = true;
      error = null;
      try {
        plans = await client.listPlans();
      } catch (err) {
        error = formatErrorMessage(err);
        plans = [];
      } finally {
        isLoading = false;
      }
    },
    handleCreatePlan: async (args) => {
      isLoading = true;
      error = null;
      try {
        const created = await client.createPlan(args);
        await stateObj.fetchPlans();
        return created;
      } catch (err) {
        error = formatErrorMessage(err);
        throw err;
      } finally {
        isLoading = false;
      }
    },
    handleDeletePlan: async (planId) => {
      isLoading = true;
      error = null;
      try {
        await client.deletePlan({ planId });
        await stateObj.fetchPlans();
      } catch (err) {
        error = formatErrorMessage(err);
        throw err;
      } finally {
        isLoading = false;
      }
    },
    handleSeedSample: async () => {
      isLoading = true;
      error = null;
      try {
        const sample = await client.seedSamplePlan();
        await stateObj.fetchPlans();
        return sample;
      } catch (err) {
        error = formatErrorMessage(err);
        throw err;
      } finally {
        isLoading = false;
      }
    },
    clearError: () => {
      error = null;
    },
  };

  return stateObj;
}

export function usePlans() {
  const [plans, setPlans] = useState<PlanSummary[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPlans = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await client.listPlans();
      setPlans(result);
    } catch (err) {
      setError(formatErrorMessage(err));
      setPlans([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleCreatePlan = useCallback(
    async (args: { name: string; campusId: number; sessionId: number }): Promise<PlanSummary> => {
      setIsLoading(true);
      setError(null);
      try {
        const created = await client.createPlan(args);
        await fetchPlans();
        return created;
      } catch (err) {
        setError(formatErrorMessage(err));
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [fetchPlans]
  );

  const handleDeletePlan = useCallback(
    async (planId: string): Promise<void> => {
      setIsLoading(true);
      setError(null);
      try {
        await client.deletePlan({ planId });
        await fetchPlans();
      } catch (err) {
        setError(formatErrorMessage(err));
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [fetchPlans]
  );

  const handleSeedSample = useCallback(async (): Promise<PlanSummary> => {
    setIsLoading(true);
    setError(null);
    try {
      const sample = await client.seedSamplePlan();
      await fetchPlans();
      return sample;
    } catch (err) {
      setError(formatErrorMessage(err));
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [fetchPlans]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  useEffect(() => {
    fetchPlans();
  }, [fetchPlans]);

  return {
    plans,
    isLoading,
    error,
    fetchPlans,
    handleCreatePlan,
    handleDeletePlan,
    handleSeedSample,
    clearError,
  };
}
