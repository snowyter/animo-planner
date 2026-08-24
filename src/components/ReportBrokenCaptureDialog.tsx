import { useState, useEffect, useMemo, useRef } from "react";
import {
  ShieldCheck,
  ShieldAlert,
  ExternalLink,
  Flag,
  Copy,
  Check,
} from "lucide-react";
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
  infoRef.current = loadedInfo;

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

  // Fetch appInfo if not provided
  useEffect(() => {
    if (!open) return;
    if (appInfo) {
      setLoadedInfo(appInfo);
      return;
    }
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

  // Synchronize when initialReport or captureFailure changes on open
  useEffect(() => {
    if (!open) return;

    if (initialReport) {
      setTitle(initialReport.title);
      setBody(initialReport.body);
      setReportError(null);
      setIsLoadingReport(false);
      return;
    }

    if (captureFailure) {
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
    }

    // Default empty draft if opened without a specific error
    const currentInfo = infoRef.current;
    const defaultTitle = buildIssueTitle("Unrecognized Course Finder layout");
    const defaultBody = buildDraftReportBody({
      appVersion: currentInfo?.appVersion ?? "0.1.0",
      selectorConfigVersion: currentInfo?.selectorConfigVersion ?? "1",
      selectorConfigSource: currentInfo?.selectorConfigSource ?? "bundled",
      error: "Describe what went wrong during capture...",
    });
    setTitle(defaultTitle);
    setBody(defaultBody);
    setIsLoadingReport(false);
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
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-100 text-amber-800">
              <Flag className="h-4 w-4" />
            </div>
            <DialogTitle className="text-xl font-bold text-slate-900">
              Report broken capture
            </DialogTitle>
          </div>
          <DialogDescription className="text-xs text-slate-600">
            Review the scrubbed diagnostic details below before opening an issue on GitHub.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 py-2 pr-1">
          {/* Privacy & Scrubbing verification banner */}
          <Alert variant="default" className="border-emerald-200 bg-emerald-50/60 text-emerald-950">
            <ShieldCheck className="h-4 w-4 text-emerald-700 shrink-0 mt-0.5" />
            <div>
              <AlertTitle className="text-xs font-semibold text-emerald-900">
                Privacy protected
              </AlertTitle>
              <AlertDescription className="text-xs text-emerald-800 mt-0.5 leading-relaxed">
                {SCRUBBED_FIELDS_NOTICE} No passwords, student IDs, or university credentials are ever included.
              </AlertDescription>
            </div>
          </Alert>

          {/* Warning if user inadvertently typed a private field */}
          {privacyViolations.length > 0 && (
            <Alert variant="destructive">
              <ShieldAlert className="h-4 w-4" />
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
            <label className="text-xs font-semibold text-slate-700">
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
              <label className="text-xs font-semibold text-slate-700">
                Scrubbed Report Body (Editable)
              </label>
              <button
                type="button"
                onClick={handleCopyReport}
                className="text-xs text-slate-500 hover:text-slate-800 flex items-center gap-1 cursor-pointer"
              >
                {copied ? (
                  <>
                    <Check className="h-3 w-3 text-emerald-600" />
                    <span className="text-emerald-700 font-medium">Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3 w-3" />
                    <span>Copy text</span>
                  </>
                )}
              </button>
            </div>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={10}
              disabled={isLoadingReport}
              className="w-full rounded-md border border-slate-200 bg-slate-50/50 p-3 font-mono text-xs text-slate-800 leading-relaxed focus:bg-white focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400 resize-y"
              placeholder="Loading scrubbed report..."
            />
          </div>

          {/* Notice that app never posts on their behalf */}
          <p className="text-xs text-slate-500 italic bg-slate-100/60 p-2.5 rounded-md border border-slate-200">
            The app never posts on your behalf. Submitting opens a pre-filled issue in your browser on GitHub so you can review and submit yourself.
          </p>
        </div>

        <DialogFooter className="shrink-0 gap-2 sm:gap-0 pt-3 border-t border-slate-200">
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
            className="bg-emerald-700 hover:bg-emerald-800 text-white text-xs flex items-center gap-1.5 shadow-2xs"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            <span>Open issue on GitHub</span>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
