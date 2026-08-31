import { useState, useEffect, useMemo, useRef } from "react";
/** "Opens outside the app" is not something the label says. */
import { ExternalLink } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import * as client from "../adapters/ipc/client";
import type { CaptureReport, AppInfo } from "../adapters/ipc/types";
import {
  buildIssueTitle,
  buildIssueUrl,
  buildDraftReportBody,
  SCRUBBED_FIELDS_NOTICE,
} from "../core/diagnostics";
import { findScrubViolations } from "../core/scrub";

export interface ReportBrokenCaptureDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  captureFailure?: string | null;
  initialReport?: CaptureReport | null;
  appInfo?: AppInfo | null;
}

export function ReportBrokenCaptureDialog({
  open,
  onOpenChange,
  captureFailure,
  initialReport,
  appInfo,
}: ReportBrokenCaptureDialogProps) {
  const [loadedInfo, setLoadedInfo] = useState<AppInfo | null>(() => appInfo ?? null);
  const infoRef = useRef<AppInfo | null>(loadedInfo);

  // Latest committed appInfo, for the async fallback below to read without
  // subscribing its effect to it. Written in an effect, never during render.
  useEffect(() => {
    infoRef.current = loadedInfo;
  }, [loadedInfo]);

  const [lastAppInfo, setLastAppInfo] = useState(appInfo);
  if (appInfo !== lastAppInfo) {
    setLastAppInfo(appInfo);
    if (open && appInfo) {
      setLoadedInfo(appInfo);
    }
  }

  const [title, setTitle] = useState<string>(() => {
    if (initialReport) return initialReport.title;
    if (captureFailure) return buildIssueTitle(captureFailure);
    return buildIssueTitle("Unrecognized Course Finder layout");
  });
  const [body, setBody] = useState<string>(() => {
    if (initialReport) return initialReport.body;
    if (captureFailure) {
      return buildDraftReportBody({
        appVersion: appInfo?.appVersion ?? "0.1.0",
        selectorConfigVersion: appInfo?.selectorConfigVersion ?? "1",
        selectorConfigSource: appInfo?.selectorConfigSource ?? "bundled",
        error: captureFailure,
      });
    }
    return buildDraftReportBody({
      appVersion: appInfo?.appVersion ?? "0.1.0",
      selectorConfigVersion: appInfo?.selectorConfigVersion ?? "1",
      selectorConfigSource: appInfo?.selectorConfigSource ?? "bundled",
      error: "Describe what went wrong during capture...",
    });
  });
  const [isLoadingReport, setIsLoadingReport] = useState<boolean>(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [copied, setCopied] = useState<boolean>(false);

  // Synchronize the editable draft with its inputs (initialReport wins over
  // captureFailure wins over an empty default) while rendering, instead of
  // resyncing from an effect.
  const [lastOpen, setLastOpen] = useState(open);
  const [lastInitialReport, setLastInitialReport] = useState(initialReport);
  const [lastCaptureFailure, setLastCaptureFailure] = useState(captureFailure);
  if (
    lastOpen !== open ||
    lastInitialReport !== initialReport ||
    lastCaptureFailure !== captureFailure
  ) {
    setLastOpen(open);
    setLastInitialReport(initialReport);
    setLastCaptureFailure(captureFailure);
    if (open) {
      if (initialReport) {
        setTitle(initialReport.title);
        setBody(initialReport.body);
        setReportError(null);
        setIsLoadingReport(false);
      } else if (!captureFailure) {
        setTitle(buildIssueTitle("Unrecognized Course Finder layout"));
        setBody(
          buildDraftReportBody({
            appVersion: loadedInfo?.appVersion ?? "0.1.0",
            selectorConfigVersion: loadedInfo?.selectorConfigVersion ?? "1",
            selectorConfigSource: loadedInfo?.selectorConfigSource ?? "bundled",
            error: "Describe what went wrong during capture...",
          })
        );
        setIsLoadingReport(false);
      }
    }
  }

  // Fetch appInfo if not provided
  useEffect(() => {
    if (!open || appInfo) return;
    let active = true;
    client
      .getAppInfo()
      .then((info) => {
        if (active) setLoadedInfo(info);
      })
      .catch(() => {
        // Ignore error
      });
    return () => {
      active = false;
    };
  }, [open, appInfo]);

  // Assemble the report for a capture failure over IPC
  useEffect(() => {
    if (!open || initialReport || !captureFailure) return;

    // The loading flag must be up before the first paint of the fetch; a
    // one-shot assembly on open, not a cascade.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsLoadingReport(true);
    setReportError(null);
    let active = true;

    client
      .buildCaptureReport({ error: captureFailure })
      .then((report) => {
        if (active) {
          setTitle(report.title);
          setBody(report.body);
          setIsLoadingReport(false);
        }
      })
      .catch(() => {
        // If backend couldn't find a retained failure matching this exact string,
        // assemble a clean local draft report from available info.
        if (active) {
          const currentInfo = infoRef.current;
          const fallbackTitle = buildIssueTitle(captureFailure);
          const fallbackBody = buildDraftReportBody({
            appVersion: currentInfo?.appVersion ?? "0.1.0",
            selectorConfigVersion: currentInfo?.selectorConfigVersion ?? "1",
            selectorConfigSource: currentInfo?.selectorConfigSource ?? "bundled",
            error: captureFailure,
          });
          setTitle(fallbackTitle);
          setBody(fallbackBody);
          setIsLoadingReport(false);
        }
      });

    return () => {
      active = false;
    };
  }, [open, initialReport, captureFailure]);

  // Real-time privacy audit of the editable text
  const privacyViolations = useMemo(() => {
    return findScrubViolations(body);
  }, [body]);

  const issueUrl = useMemo(() => {
    return buildIssueUrl(title, body);
  }, [title, body]);

  const handleCopyReport = async () => {
    try {
      await navigator.clipboard.writeText(body);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
    }
  };

  const handleOpenIssue = () => {
    if (typeof window !== "undefined") {
      window.open(issueUrl, "_blank", "noopener,noreferrer");
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col p-6 overflow-hidden">
        <DialogHeader className="space-y-1.5 shrink-0">
          <DialogTitle className="text-xl font-bold text-foreground">
            Report broken capture
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Review the scrubbed diagnostic details below before opening an issue on GitHub.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 py-2 pr-1">
          {/* Privacy & Scrubbing verification banner */}
          <Alert variant="default" className="border-emerald-200 bg-emerald-50/60 text-emerald-950">
            <AlertTitle className="text-xs font-semibold text-emerald-900">
              Privacy protected
            </AlertTitle>
            <AlertDescription className="text-xs text-emerald-900 mt-0.5 leading-relaxed">
              {SCRUBBED_FIELDS_NOTICE} No passwords, student IDs, or university credentials are ever included.
            </AlertDescription>
          </Alert>

          {/* Warning if user inadvertently typed a private field */}
          {privacyViolations.length > 0 && (
            <Alert variant="destructive">
              <AlertTitle className="text-xs font-semibold">
                Potential sensitive value detected in text
              </AlertTitle>
              <AlertDescription className="text-xs mt-0.5">
                The report text currently contains {privacyViolations.join(", ")}. Please remove before submitting.
              </AlertDescription>
            </Alert>
          )}

          {reportError && (
            <Alert variant="destructive">
              <AlertTitle className="text-xs font-semibold">Unable to fetch full report</AlertTitle>
              <AlertDescription className="text-xs font-mono">{reportError}</AlertDescription>
            </Alert>
          )}

          {/* Issue Title */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-foreground">
              Issue Title
            </label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Broken capture summary"
              className="text-sm font-medium"
            />
          </div>

          {/* Editable Scrubbed Report Text */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-foreground">
                Scrubbed Report Body (Editable)
              </label>
              <button
                type="button"
                onClick={handleCopyReport}
                className="text-xs text-muted-foreground hover:text-foreground cursor-pointer"
              >
                {copied ? (
                  <span className="text-primary font-medium">Copied</span>
                ) : (
                  <span>Copy text</span>
                )}
              </button>
            </div>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={10}
              disabled={isLoadingReport}
              className="w-full rounded-control border border-input bg-muted/50 p-3 font-mono text-xs text-foreground leading-relaxed focus:bg-card resize-y"
              placeholder="Loading scrubbed report..."
            />
          </div>

          {/* Notice that app never posts on their behalf */}
          <p className="text-xs text-muted-foreground italic bg-muted/60 p-2.5 rounded-card border border-border">
            The app never posts on your behalf. Submitting opens a pre-filled issue in your browser on GitHub so you can review and submit yourself.
          </p>
        </div>

        <DialogFooter className="shrink-0 gap-2 sm:gap-0 pt-3 border-t border-border">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            className="text-xs"
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={handleOpenIssue}
            disabled={!title.trim() || !body.trim() || privacyViolations.length > 0}
            className="text-xs flex items-center gap-1.5"
          >
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Open issue on GitHub</span>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
