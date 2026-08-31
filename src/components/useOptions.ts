import { useState, useCallback, useEffect } from "react";
import * as client from "../adapters/ipc/client";
import type { CampusOption, SessionOption } from "../adapters/ipc/types";
import { formatErrorMessage } from "../core/error";

// The option values are owned by Rust (`get_campus_options` /
// `get_session_options`) — the single source since ticket 25. A failed
// fetch leaves the lists empty and surfaces the error; nothing here masks
// a failure with a hardcoded copy that could silently drift.

export interface OptionsState {
  campusOptions: CampusOption[];
  sessionOptions: SessionOption[];
  isLoading: boolean;
  error: string | null;
  fetchOptions: () => Promise<void>;
}

export function useOptionsState(): OptionsState {
  let campusOptions: CampusOption[] = [];
  let sessionOptions: SessionOption[] = [];
  let isLoading = false;
  let error: string | null = null;

  return {
    get campusOptions() {
      return campusOptions;
    },
    get sessionOptions() {
      return sessionOptions;
    },
    get isLoading() {
      return isLoading;
    },
    get error() {
      return error;
    },
    fetchOptions: async () => {
      isLoading = true;
      error = null;
      let campusErr: unknown = null;
      let sessionErr: unknown = null;

      try {
        campusOptions = await client.getCampusOptions();
      } catch (err) {
        campusErr = err;
        campusOptions = [];
      }

      try {
        sessionOptions = await client.getSessionOptions();
      } catch (err) {
        sessionErr = err;
        sessionOptions = [];
      }

      if (campusErr || sessionErr) {
        error = formatErrorMessage(campusErr || sessionErr);
      }

      isLoading = false;
    },
  };
}

export function useOptions() {
  const [campusOptions, setCampusOptions] = useState<CampusOption[]>([]);
  const [sessionOptions, setSessionOptions] = useState<SessionOption[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const fetchOptions = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    let campusErr: unknown = null;
    let sessionErr: unknown = null;

    try {
      setCampusOptions(await client.getCampusOptions());
    } catch (err) {
      campusErr = err;
      setCampusOptions([]);
    }

    try {
      setSessionOptions(await client.getSessionOptions());
    } catch (err) {
      sessionErr = err;
      setSessionOptions([]);
    }

    if (campusErr || sessionErr) {
      setError(formatErrorMessage(campusErr || sessionErr));
    }

    setIsLoading(false);
  }, []);

  useEffect(() => {
    // One-shot fetch on mount. The loading flag is up before the first
    // paint of the fetch; not a cascade.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchOptions();
  }, [fetchOptions]);

  return {
    campusOptions,
    sessionOptions,
    isLoading,
    error,
    fetchOptions,
  };
}
