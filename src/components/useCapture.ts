import { useState, useCallback, useEffect } from "react";
import * as client from "../adapters/ipc/client";
import type { CaptureSummary } from "../adapters/ipc/types";
import { formatErrorMessage } from "../core/error";

export interface CaptureScope {
  campusId: number;
  sessionId: number;
}

export interface CaptureState {
  summary: CaptureSummary | null;
  isLoading: boolean;
  error: string | null;
  captureFailure: string | null;
  isOpening: boolean;
  isUndoing: boolean;
  fetchSummary: () => Promise<void>;
  openCapture: () => Promise<void>;
  undoLast: () => Promise<void>;
  dismissFailure: () => void;
  handleCaptureUpdated: (summary: CaptureSummary) => void;
  handleCaptureFailed: (payload: { error: string }) => void;
}

export function useCaptureState(scope: CaptureScope): CaptureState {
  let summary: CaptureSummary | null = null;
  let isLoading = false;
  let error: string | null = null;
  let captureFailure: string | null = null;
  let isOpening = false;
  let isUndoing = false;

  return {
    get summary() {
      return summary;
    },
    get isLoading() {
      return isLoading;
    },
    get error() {
      return error;
    },
    get captureFailure() {
      return captureFailure;
    },
    get isOpening() {
      return isOpening;
    },
    get isUndoing() {
      return isUndoing;
    },
    fetchSummary: async () => {
      isLoading = true;
      error = null;
      try {
        summary = await client.getCaptureSummary(scope);
      } catch (err) {
        error = formatErrorMessage(err);
        summary = null;
      } finally {
        isLoading = false;
      }
    },
    openCapture: async () => {
      isOpening = true;
      error = null;
      try {
        await client.openCaptureWindow(scope);
      } catch (err) {
        error = formatErrorMessage(err);
        throw error;
      } finally {
        isOpening = false;
      }
    },
    undoLast: async () => {
      isUndoing = true;
      error = null;
      try {
        summary = await client.undoLastCapture(scope);
      } catch (err) {
        error = formatErrorMessage(err);
        throw error;
      } finally {
        isUndoing = false;
      }
    },
    dismissFailure: () => {
      captureFailure = null;
    },
    handleCaptureUpdated: (updatedSummary: CaptureSummary) => {
      if (
        updatedSummary.campusId === scope.campusId &&
        updatedSummary.sessionId === scope.sessionId
      ) {
        summary = updatedSummary;
      }
    },
    handleCaptureFailed: (payload: { error: string }) => {
      captureFailure = payload.error;
    },
  };
}

export function useCapture(campusId: number, sessionId: number) {
  const [summary, setSummary] = useState<CaptureSummary | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [captureFailure, setCaptureFailure] = useState<string | null>(null);
  const [isOpening, setIsOpening] = useState<boolean>(false);
  const [isUndoing, setIsUndoing] = useState<boolean>(false);

  const fetchSummary = useCallback(async () => {
    if (!campusId || !sessionId) return;
    setIsLoading(true);
    setError(null);
    try {
      const result = await client.getCaptureSummary({ campusId, sessionId });
      setSummary(result);
    } catch (err) {
      setError(formatErrorMessage(err));
      setSummary(null);
    } finally {
      setIsLoading(false);
    }
  }, [campusId, sessionId]);

  const openCapture = useCallback(async () => {
    if (!campusId || !sessionId) return;
    setIsOpening(true);
    setError(null);
    try {
      await client.openCaptureWindow({ campusId, sessionId });
    } catch (err) {
      const msg = formatErrorMessage(err);
      setError(msg);
      throw msg;
    } finally {
      setIsOpening(false);
    }
  }, [campusId, sessionId]);

  const undoLast = useCallback(async () => {
    if (!campusId || !sessionId) return;
    setIsUndoing(true);
    setError(null);
    try {
      const result = await client.undoLastCapture({ campusId, sessionId });
      setSummary(result);
    } catch (err) {
      const msg = formatErrorMessage(err);
      setError(msg);
      throw msg;
    } finally {
      setIsUndoing(false);
    }
  }, [campusId, sessionId]);

  const dismissFailure = useCallback(() => {
    setCaptureFailure(null);
  }, []);

  useEffect(() => {
    fetchSummary();
  }, [fetchSummary]);

  useEffect(() => {
    let unlistenUpdated: (() => void) | null = null;
    let unlistenFailed: (() => void) | null = null;

    client
      .onCaptureUpdated((updatedSummary) => {
        if (
          updatedSummary.campusId === campusId &&
          updatedSummary.sessionId === sessionId
        ) {
          setSummary(updatedSummary);
        }
      })
      .then((unlisten) => {
        unlistenUpdated = unlisten;
      })
      .catch(() => {
        // In non-Tauri or unit test environments, ignore listener setup errors
      });

    client
      .onCaptureFailed((payload) => {
        setCaptureFailure(payload.error);
      })
      .then((unlisten) => {
        unlistenFailed = unlisten;
      })
      .catch(() => {
        // In non-Tauri or unit test environments, ignore listener setup errors
      });

    return () => {
      if (unlistenUpdated) unlistenUpdated();
      if (unlistenFailed) unlistenFailed();
    };
  }, [campusId, sessionId]);

  return {
    summary,
    isLoading,
    error,
    captureFailure,
    isOpening,
    isUndoing,
    fetchSummary,
    openCapture,
    undoLast,
    dismissFailure,
  };
}
