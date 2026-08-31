import { useState, useCallback, useEffect } from "react";
import * as client from "../adapters/ipc/client";
import type { MissingSection, RefreshOutcome, RefreshProgress } from "../adapters/ipc/types";
import { formatErrorMessage } from "../core/error";

export interface UsePlanRefreshOptions {
  planId: string;
  onPlanUpdated?: () => void;
}

export interface PlanRefreshState {
  isRefreshing: boolean;
  isResuming: boolean;
  progress: RefreshProgress | null;
  outcome: RefreshOutcome | null;
  sessionExpired: boolean;
  offline: boolean;
  error: string | null;
  missingSections: MissingSection[];
  isLoadingMissing: boolean;
  startRefresh: () => Promise<RefreshOutcome>;
  resumeRefresh: () => Promise<RefreshOutcome>;
  fetchMissingSections: () => Promise<MissingSection[]>;
  dismissNotice: () => void;
  handleRefreshProgress: (progress: RefreshProgress) => void;
}

export function usePlanRefreshState(options: UsePlanRefreshOptions): PlanRefreshState {
  let isRefreshing = false;
  let isResuming = false;
  let progress: RefreshProgress | null = null;
  let outcome: RefreshOutcome | null = null;
  let sessionExpired = false;
  let offline = false;
  let error: string | null = null;
  let missingSections: MissingSection[] = [];
  let isLoadingMissing = false;

  const fetchMissingSections = async (): Promise<MissingSection[]> => {
    isLoadingMissing = true;
    try {
      missingSections = await client.getMissingSections({ planId: options.planId });
      return missingSections;
    } catch (err) {
      error = formatErrorMessage(err);
      return [];
    } finally {
      isLoadingMissing = false;
    }
  };

  const handleOutcome = async (res: RefreshOutcome): Promise<RefreshOutcome> => {
    outcome = res;
    if (res.status === "session_expired") {
      sessionExpired = true;
      await fetchMissingSections();
      options.onPlanUpdated?.();
    } else if (res.status === "offline") {
      offline = true;
    } else if (res.status === "complete") {
      sessionExpired = false;
      offline = false;
      await fetchMissingSections();
      options.onPlanUpdated?.();
    }
    return res;
  };

  const startRefresh = async (): Promise<RefreshOutcome> => {
    isRefreshing = true;
    error = null;
    sessionExpired = false;
    offline = false;
    progress = null;
    outcome = null;

    try {
      const res = await client.startRefresh({ planId: options.planId });
      return await handleOutcome(res);
    } catch (err) {
      const msg = formatErrorMessage(err);
      error = msg;
      throw err;
    } finally {
      isRefreshing = false;
      progress = null;
    }
  };

  const resumeRefresh = async (): Promise<RefreshOutcome> => {
    isRefreshing = true;
    isResuming = true;
    error = null;
    sessionExpired = false;
    offline = false;
    progress = null;

    try {
      const res = await client.resumeRefresh({ planId: options.planId });
      return await handleOutcome(res);
    } catch (err) {
      const msg = formatErrorMessage(err);
      error = msg;
      throw err;
    } finally {
      isRefreshing = false;
      isResuming = false;
      progress = null;
    }
  };

  const dismissNotice = () => {
    outcome = null;
    sessionExpired = false;
    offline = false;
    error = null;
  };

  const handleRefreshProgress = (prog: RefreshProgress) => {
    progress = prog;
    options.onPlanUpdated?.();
  };

  return {
    get isRefreshing() {
      return isRefreshing;
    },
    get isResuming() {
      return isResuming;
    },
    get progress() {
      return progress;
    },
    get outcome() {
      return outcome;
    },
    get sessionExpired() {
      return sessionExpired;
    },
    get offline() {
      return offline;
    },
    get error() {
      return error;
    },
    get missingSections() {
      return missingSections;
    },
    get isLoadingMissing() {
      return isLoadingMissing;
    },
    startRefresh,
    resumeRefresh,
    fetchMissingSections,
    dismissNotice,
    handleRefreshProgress,
  };
}

export function usePlanRefresh(options: UsePlanRefreshOptions) {
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [isResuming, setIsResuming] = useState<boolean>(false);
  const [progress, setProgress] = useState<RefreshProgress | null>(null);
  const [outcome, setOutcome] = useState<RefreshOutcome | null>(null);
  const [sessionExpired, setSessionExpired] = useState<boolean>(false);
  const [offline, setOffline] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [missingSections, setMissingSections] = useState<MissingSection[]>([]);
  const [isLoadingMissing, setIsLoadingMissing] = useState<boolean>(false);

  const fetchMissingSections = useCallback(async () => {
    if (!options.planId) return [];
    setIsLoadingMissing(true);
    try {
      const result = await client.getMissingSections({ planId: options.planId });
      setMissingSections(result);
      return result;
    } catch (err) {
      setError(formatErrorMessage(err));
      return [];
    } finally {
      setIsLoadingMissing(false);
    }
  }, [options.planId]);

  const handleOutcome = useCallback(
    async (res: RefreshOutcome) => {
      setOutcome(res);
      if (res.status === "session_expired") {
        setSessionExpired(true);
        await fetchMissingSections();
        options.onPlanUpdated?.();
      } else if (res.status === "offline") {
        setOffline(true);
      } else if (res.status === "complete") {
        setSessionExpired(false);
        setOffline(false);
        await fetchMissingSections();
        options.onPlanUpdated?.();
      }
      return res;
    },
    [fetchMissingSections, options]
  );

  const startRefresh = useCallback(async () => {
    if (!options.planId) return;
    setIsRefreshing(true);
    setError(null);
    setSessionExpired(false);
    setOffline(false);
    setProgress(null);
    setOutcome(null);

    try {
      const res = await client.startRefresh({ planId: options.planId });
      return await handleOutcome(res);
    } catch (err) {
      const msg = formatErrorMessage(err);
      setError(msg);
      throw err;
    } finally {
      setIsRefreshing(false);
      setProgress(null);
    }
  }, [handleOutcome, options.planId]);

  const resumeRefresh = useCallback(async () => {
    if (!options.planId) return;
    setIsRefreshing(true);
    setIsResuming(true);
    setError(null);
    setSessionExpired(false);
    setOffline(false);
    setProgress(null);

    try {
      const res = await client.resumeRefresh({ planId: options.planId });
      return await handleOutcome(res);
    } catch (err) {
      const msg = formatErrorMessage(err);
      setError(msg);
      throw err;
    } finally {
      setIsRefreshing(false);
      setIsResuming(false);
      setProgress(null);
    }
  }, [handleOutcome, options.planId]);

  const dismissNotice = useCallback(() => {
    setOutcome(null);
    setSessionExpired(false);
    setOffline(false);
    setError(null);
  }, []);

  const handleRefreshProgress = useCallback(
    (prog: RefreshProgress) => {
      setProgress(prog);
      options.onPlanUpdated?.();
    },
    [options]
  );

  useEffect(() => {
    // One-shot fetch on mount (and again if the plan changes). The loading
    // flag is up before the first paint of the fetch; not a cascade.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchMissingSections();
  }, [fetchMissingSections]);

  useEffect(() => {
    let unlisten: (() => void) | null = null;

    client
      .onRefreshProgress((prog) => {
        handleRefreshProgress(prog);
      })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {
        // Ignore in non-Tauri / test environments
      });

    return () => {
      if (unlisten) unlisten();
    };
  }, [handleRefreshProgress]);

  return {
    isRefreshing,
    isResuming,
    progress,
    outcome,
    sessionExpired,
    offline,
    error,
    missingSections,
    isLoadingMissing,
    startRefresh,
    resumeRefresh,
    fetchMissingSections,
    dismissNotice,
  };
}
