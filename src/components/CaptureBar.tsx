import {
  ExternalLink,
  ShieldCheck,
  Undo2,
  AlertTriangle,
  X,
  RefreshCw,
  Layers,
  Flag,
} from "lucide-react";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Alert, AlertTitle, AlertDescription } from "./ui/alert";
import type { CaptureSummary } from "../adapters/ipc/types";
import { formatCaptureCounter } from "../core/capture";

export interface CaptureBarProps {
  campusId: number;
  sessionId: number;
  campusName: string;
  sessionName: string;
  summary: CaptureSummary | null;
  isLoading: boolean;
  error: string | null;
  captureFailure: string | null;
  isOpening?: boolean;
  isUndoing?: boolean;
  onOpenCapture: () => void;
  onUndo: () => void;
  onDismissFailure: () => void;
  onReportBrokenCapture?: (error: string) => void;
}

export function CaptureBar({
  campusName,
  sessionName,
  summary,
  isLoading,
  error,
  captureFailure,
  isOpening = false,
  isUndoing = false,
  onOpenCapture,
  onUndo,
  onDismissFailure,
  onReportBrokenCapture,
}: CaptureBarProps) {
  const sectionCount = summary?.sectionCount ?? 0;
  const courseCount = summary?.courseCount ?? 0;
  const canUndo = summary?.canUndo ?? false;

  const counterText = formatCaptureCounter(sectionCount, courseCount);

  return (
    <div className="space-y-3">
      {/* Non-blocking Capture Failure Notice (ADR-0004, Ticket 12/23) */}
      {captureFailure && (
        <Alert variant="warning" className="relative pr-12">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div>
              <AlertTitle className="text-sm font-semibold text-amber-900">
                Capture parsing issue encountered
              </AlertTitle>
              <AlertDescription className="text-xs text-amber-800 mt-0.5 font-mono">
                {captureFailure}
              </AlertDescription>
            </div>
            <div className="flex items-center gap-2 mt-1 sm:mt-0 shrink-0">
              {onReportBrokenCapture && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onReportBrokenCapture(captureFailure)}
                  className="h-7 text-xs bg-amber-100 hover:bg-amber-200 text-amber-900 border-amber-300"
                >
                  <Flag className="h-3 w-3 mr-1" />
                  Report broken capture
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={onDismissFailure}
                className="h-7 text-xs text-amber-800 hover:bg-amber-200/50"
              >
                Dismiss
              </Button>
            </div>
          </div>
          <button
            type="button"
            onClick={onDismissFailure}
            className="absolute right-3 top-3 rounded-md p-1 text-amber-700 hover:bg-amber-200/60 focus:outline-none"
            aria-label="Close notification"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </Alert>
      )}

      {/* IPC Error Alert */}
      {error && (
        <Alert variant="destructive">
          <AlertTitle className="text-sm font-semibold">Capture error</AlertTitle>
          <AlertDescription className="text-xs font-mono">{error}</AlertDescription>
        </Alert>
      )}

      {/* Capture Control and Live Counter Panel */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 shadow-xs">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          {/* Left Column: Scope & Plain Privacy Disclaimer (ADR-0002) */}
          <div className="space-y-1.5 max-w-2xl">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-slate-900">
                Capture Sections
              </span>
              <Badge variant="outline" className="text-xs font-normal text-slate-600">
                {campusName} • {sessionName}
              </Badge>
            </div>
            <p className="text-xs text-slate-600 flex items-start sm:items-center gap-1.5 leading-relaxed">
              <ShieldCheck className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5 sm:mt-0" />
              <span>
                You will sign in directly on De La Salle University&#39;s Archer&#39;s Hub portal.
                Animo Plan never stores your credentials. Captures update silently.
              </span>
            </p>
          </div>

          {/* Right Column: Actions & Live Running Counter */}
          <div className="flex flex-wrap items-center gap-3">
            {/* Live running counter */}
            <div className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 border border-slate-200 text-sm">
              <Layers className="h-4 w-4 text-emerald-700" />
              <span className="font-semibold text-slate-800">
                {isLoading ? "Loading..." : counterText}
              </span>

              {/* Discoverable Undo Button next to counter */}
              <div className="h-4 w-px bg-slate-200 mx-0.5" />
              <Button
                variant="ghost"
                size="sm"
                disabled={!canUndo || isUndoing}
                onClick={onUndo}
                className="h-7 px-2 text-xs flex items-center gap-1 text-slate-600 hover:text-slate-900 disabled:opacity-40"
                title="Undo last captured course batch"
              >
                {isUndoing ? (
                  <RefreshCw className="h-3 w-3 animate-spin" />
                ) : (
                  <Undo2 className="h-3 w-3" />
                )}
                <span>Undo</span>
              </Button>
            </div>

            {/* Launch Archer's Hub Popup Button */}
            <Button
              variant="default"
              onClick={onOpenCapture}
              disabled={isOpening}
              className="bg-emerald-700 hover:bg-emerald-800 text-white flex items-center gap-1.5 text-sm font-medium"
            >
              {isOpening ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <ExternalLink className="h-4 w-4" />
              )}
              <span>Open Archer&#39;s Hub</span>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
