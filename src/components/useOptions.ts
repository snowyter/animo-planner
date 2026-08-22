import { useState, useCallback, useEffect } from "react";
import * as client from "../adapters/ipc/client";
import type { CampusOption, SessionOption } from "../adapters/ipc/types";
import { DEFAULT_CAMPUS_OPTIONS, DEFAULT_SESSION_OPTIONS } from "../core/options";
import { formatErrorMessage } from "../core/error";

export interface OptionsState {
  campusOptions: CampusOption[];
  sessionOptions: SessionOption[];
  isLoading: boolean;
  error: string | null;
  fetchOptions: () => Promise<void>;
}

export function useOptionsState(): OptionsState {
  let campusOptions: CampusOption[] = DEFAULT_CAMPUS_OPTIONS;
  let sessionOptions: SessionOption[] = DEFAULT_SESSION_OPTIONS;
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
        const campuses = await client.getCampusOptions();
        if (Array.isArray(campuses) && campuses.length > 0) {
          campusOptions = campuses;
        }
      } catch (err) {
        campusErr = err;
        campusOptions = DEFAULT_CAMPUS_OPTIONS;
      }

      try {
        const sessions = await client.getSessionOptions();
        if (Array.isArray(sessions) && sessions.length > 0) {
          sessionOptions = sessions;
        }
      } catch (err) {
        sessionErr = err;
        sessionOptions = DEFAULT_SESSION_OPTIONS;
      }

      if (campusErr || sessionErr) {
        error = formatErrorMessage(campusErr || sessionErr);
      }

      isLoading = false;
    },
  };
}

export function useOptions() {
  const [campusOptions, setCampusOptions] = useState<CampusOption[]>(DEFAULT_CAMPUS_OPTIONS);
  const [sessionOptions, setSessionOptions] = useState<SessionOption[]>(DEFAULT_SESSION_OPTIONS);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const fetchOptions = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    let campusErr: unknown = null;
    let sessionErr: unknown = null;

    try {
      const campuses = await client.getCampusOptions();
      if (Array.isArray(campuses) && campuses.length > 0) {
        setCampusOptions(campuses);
      }
    } catch (err) {
      campusErr = err;
      setCampusOptions(DEFAULT_CAMPUS_OPTIONS);
    }

    try {
      const sessions = await client.getSessionOptions();
      if (Array.isArray(sessions) && sessions.length > 0) {
        setSessionOptions(sessions);
      }
    } catch (err) {
      sessionErr = err;
      setSessionOptions(DEFAULT_SESSION_OPTIONS);
    }

    if (campusErr || sessionErr) {
      setError(formatErrorMessage(campusErr || sessionErr));
    }

    setIsLoading(false);
  }, []);

  useEffect(() => {
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
