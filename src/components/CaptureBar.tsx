/** "Opens outside the app" is not something the label says. */
import { ExternalLink } from "lucide-react";
// `motion/react-m` carries only `m`, so the feature bundle stays splittable.
import * as m from "motion/react-m";
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
  isRefreshing?: boolean;
  onRefresh?: () => void;
  onOpenCapture: () => void;
  onDismissFailure: () => void;
  onReportBrokenCapture?: (error: string) => void;
}

/**
 * The running counter.
 *
 * Capture is silent by design — a student searches ten courses back to back
 * and a prompt each time would be ten interruptions in the task being sped up.
 * That silence is also how a capture can land without being noticed at all,
 * so the number moves when it changes: keyed on the text, one element, and
 * `transform` plus `opacity` only.
 */
function CaptureCounter({ text }: { text: string }) {
  return (
    <m.span
      key={text}
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
      className="font-semibold text-foreground tabular-nums"
      data-testid="capture-counter"
    >
      {text}
    </m.span>
  );
}

export function CaptureBar({
  campusName,
  sessionName,
  summary,
  isLoading,
  error,
  captureFailure,
  isOpening = false,
  isRefreshing = false,
  onRefresh,
  onOpenCapture,
  onDismissFailure,
  onReportBrokenCapture,
}: CaptureBarProps) {
  const sectionCount = summary?.sectionCount ?? 0;
  const courseCount = summary?.courseCount ?? 0;

  const counterText = formatCaptureCounter(sectionCount, courseCount);

  return (
    <div className="space-y-3">
      {/* Non-blocking Capture Failure Notice (ADR-0004, Ticket 12/23) */}
      {captureFailure && (
        /* Informative, not alarming: amber, a plain heading, and the two
           things the student can do about it. Nothing here is an error. */
        <Alert variant="warning" className="relative pr-12">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div>
              <AlertTitle className="text-sm font-semibold text-amber-950">
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
                  className="h-7 text-xs text-amber-900 border-amber-300"
                >
                  Report broken capture
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={onDismissFailure}
                className="h-7 text-xs text-amber-900 hover:bg-amber-200/50"
              >
                Dismiss
              </Button>
            </div>
          </div>
          <button
            type="button"
            onClick={onDismissFailure}
            className="absolute right-3 top-3 rounded-control px-1.5 text-micro font-semibold text-amber-800 hover:bg-amber-200/60"
            aria-label="Close notification"
          >
            ✕
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
      <div className="rounded-panel border border-border bg-card p-4 sm:p-panel">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          {/* Left Column: Scope & Plain Privacy Disclaimer (ADR-0002) */}
          <div className="space-y-1.5 min-w-0 lg:flex-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-foreground">
                Capture Sections
              </span>
              <Badge variant="outline" className="font-normal text-muted-foreground">
                {campusName} • {sessionName}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              You will sign in directly on De La Salle University&#39;s Archer&#39;s Hub portal.
              Animo Plan never stores your credentials. Captures update silently.
            </p>
          </div>

          {/* Right Column: Actions & Live Running Counter.
              Kept on one line: wrapping put Open Archer's Hub on a row of its
              own and left the rest of the panel empty beside it. The text
              column shrinks instead. */}
          <div className="flex flex-wrap items-center gap-3 lg:flex-nowrap lg:shrink-0">
            {/* Live running counter */}
            <div
              className="flex shrink-0 items-center rounded-card bg-muted px-3 py-2 border border-border text-sm whitespace-nowrap"
              aria-live="polite"
            >
              {isLoading ? (
                <span className="font-semibold text-muted-foreground">Loading...</span>
              ) : (
                <CaptureCounter text={counterText} />
              )}
            </div>

            {/* Refresh sits with capture because both reach Archer's Hub for
                fresh numbers; it is never automatic or on a timer (ticket 21). */}
            {onRefresh && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isRefreshing}
                onClick={onRefresh}
                className="h-10 shrink-0 whitespace-nowrap text-xs font-semibold px-3.5"
                title="Re-run every captured course in this scope to refresh its enrolment numbers"
              >
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </Button>
            )}

            {/* Launch Archer's Hub Popup Button */}
            <Button
              variant="default"
              onClick={onOpenCapture}
              disabled={isOpening}
              className="flex shrink-0 whitespace-nowrap items-center gap-1.5 text-sm font-medium"
            >
              {!isOpening && <ExternalLink className="h-4 w-4" aria-hidden="true" />}
              <span>{isOpening ? "Opening..." : "Open Archer's Hub"}</span>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
