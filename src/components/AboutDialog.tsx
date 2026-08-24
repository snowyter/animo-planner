import { useState, useEffect } from "react";
import {
  BookOpen,
  ShieldCheck,
  Code2,
  ExternalLink,
  LogOut,
  Flag,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
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
import { Badge } from "./ui/badge";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import * as client from "../adapters/ipc/client";
import type { AppInfo } from "../adapters/ipc/types";
import {
  DISCLAIMER_TEXT,
  PUBLIC_SOURCE_REPO_URL,
  formatSelectorConfigSource,
} from "../core/diagnostics";

export interface AboutDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenReport?: () => void;
  initialAppInfo?: AppInfo | null;
}

export function AboutDialog({
  open,
  onOpenChange,
  onOpenReport,
  initialAppInfo,
}: AboutDialogProps) {
  const [appInfo, setAppInfo] = useState<AppInfo | null>(() => initialAppInfo ?? null);
  const [isLoadingInfo, setIsLoadingInfo] = useState<boolean>(false);
  const [isConfirmingClear, setIsConfirmingClear] = useState<boolean>(false);
  const [isClearing, setIsClearing] = useState<boolean>(false);
  const [clearStatus, setClearStatus] = useState<"success" | "error" | null>(null);
  const [clearError, setClearError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setIsConfirmingClear(false);
      setClearStatus(null);
      setClearError(null);
      return;
    }

    if (initialAppInfo) {
      setAppInfo(initialAppInfo);
      return;
    }

    let active = true;
    setIsLoadingInfo(true);
    client
      .getAppInfo()
      .then((info) => {
        if (active) {
          setAppInfo(info);
          setIsLoadingInfo(false);
        }
      })
      .catch(() => {
        if (active) {
          setIsLoadingInfo(false);
        }
      });

    return () => {
      active = false;
    };
  }, [open, initialAppInfo]);

  const handleClearSession = async () => {
    setIsClearing(true);
    setClearError(null);
    try {
      await client.clearBrowserSession();
      setClearStatus("success");
      setIsConfirmingClear(false);
    } catch (err: unknown) {
      setClearStatus("error");
      if (typeof err === "string") {
        setClearError(err);
      } else if (err instanceof Error) {
        setClearError(err.message);
      } else {
        setClearError("Failed to clear browser session");
      }
    } finally {
      setIsClearing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col p-6 overflow-hidden">
        <DialogHeader className="space-y-1.5 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-700 text-white font-bold shadow-xs">
              <BookOpen className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle className="text-xl font-bold text-slate-900 leading-tight">
                About Animo Plan
              </DialogTitle>
              <DialogDescription className="text-xs text-slate-500">
                Archer&#39;s Hub Enlistment Planner
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 py-2 pr-1">
          {/* Verbatim Disclaimer Banner (SPEC §1, ADR-0001, ADR-0002) */}
          <Alert className="border-slate-200 bg-slate-50/80 text-slate-800">
            <ShieldCheck className="h-4 w-4 text-emerald-700 shrink-0 mt-0.5" />
            <div>
              <AlertTitle className="text-xs font-semibold text-slate-900">
                Disclaimer
              </AlertTitle>
              <AlertDescription className="text-xs text-slate-600 mt-0.5 leading-relaxed">
                {DISCLAIMER_TEXT}
              </AlertDescription>
            </div>
          </Alert>

          {/* Versions and Selector Config Status (SPEC §9, ADR-0013) */}
          <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-3 shadow-2xs">
            <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
              Version & Configuration
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="rounded-md bg-slate-50 p-2.5 border border-slate-100 flex items-center justify-between">
                <span className="text-slate-600 font-medium">App Version:</span>
                <span className="font-mono font-semibold text-slate-900">
                  {isLoadingInfo ? "Loading..." : (appInfo?.appVersion ?? "0.1.0")}
                </span>
              </div>
              <div className="rounded-md bg-slate-50 p-2.5 border border-slate-100 flex items-center justify-between">
                <span className="text-slate-600 font-medium">Selector Config:</span>
                {isLoadingInfo && !appInfo ? (
                  <span className="font-mono text-slate-500">Loading...</span>
                ) : (
                  <div className="flex items-center gap-1.5 font-mono">
                    <span className="font-semibold text-slate-900">
                      {appInfo ? `v${appInfo.selectorConfigVersion}` : "v1"}
                    </span>
                    <Badge
                      variant={appInfo?.selectorConfigSource === "remote" ? "default" : "secondary"}
                      className="text-[10px] px-1.5 py-0 capitalize"
                    >
                      {formatSelectorConfigSource(appInfo?.selectorConfigSource ?? "bundled")}
                    </Badge>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Public Source Repository (ADR-0005, SPEC §8) */}
          <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-2 shadow-2xs">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Code2 className="h-4 w-4 text-slate-700" />
                <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                  Public Source Code
                </h4>
              </div>
              <a
                href={PUBLIC_SOURCE_REPO_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-emerald-700 hover:text-emerald-800 font-semibold flex items-center gap-1 hover:underline"
              >
                <span>github.com/snowyter/animo-planner</span>
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              Animo Plan is public and MIT-licensed. You are typing university credentials into a window this binary controls — &ldquo;read the source&rdquo; is the honest answer to why you should trust this tool.
            </p>
          </div>

          {/* Sign Out / Clear Session Control (SPEC §4, §8, ADR-0002) */}
          <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-3 shadow-2xs">
            <div className="flex items-center gap-2">
              <LogOut className="h-4 w-4 text-slate-700" />
              <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                Sign out / clear session
              </h4>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              Wipes the persisted browser session, login credentials, and cookies from the Archer&#39;s Hub window. <strong>Captured sections and plans stay saved locally.</strong>
            </p>

            {clearStatus === "success" && (
              <Alert className="border-emerald-200 bg-emerald-50 text-emerald-950 py-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-700" />
                <AlertDescription className="text-xs text-emerald-900 font-medium">
                  Browser session cleared successfully. The next capture will ask you to sign in.
                </AlertDescription>
              </Alert>
            )}

            {clearStatus === "error" && clearError && (
              <Alert variant="destructive" className="py-2">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription className="text-xs font-medium">
                  {clearError}
                </AlertDescription>
              </Alert>
            )}

            {isConfirmingClear ? (
              <div className="rounded-md bg-amber-50 border border-amber-200 p-3 space-y-2">
                <p className="text-xs font-semibold text-amber-900">
                  Confirm clearing session?
                </p>
                <p className="text-xs text-amber-800 leading-relaxed">
                  This will log you out of Archer&#39;s Hub in the capture window. Your captured courses, sections, and plans will not be deleted.
                </p>
                <div className="flex items-center gap-2 pt-1">
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    disabled={isClearing}
                    onClick={handleClearSession}
                    className="h-7 text-xs"
                  >
                    {isClearing ? (
                      <RefreshCw className="h-3 w-3 animate-spin mr-1" />
                    ) : (
                      <LogOut className="h-3 w-3 mr-1" />
                    )}
                    <span>{isClearing ? "Clearing..." : "Confirm & Clear Session"}</span>
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={isClearing}
                    onClick={() => setIsConfirmingClear(false)}
                    className="h-7 text-xs text-slate-600 hover:text-slate-900"
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setClearStatus(null);
                  setIsConfirmingClear(true);
                }}
                className="text-xs text-slate-700 hover:text-slate-900 border-slate-300"
              >
                <LogOut className="h-3.5 w-3.5 mr-1.5" />
                <span>Sign out / clear session</span>
              </Button>
            )}
          </div>

          {/* Report Broken Capture Affordance (SPEC §9) */}
          {onOpenReport && (
            <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-2.5 shadow-2xs">
              <div className="flex items-center gap-2">
                <Flag className="h-4 w-4 text-amber-700" />
                <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                  Diagnostics & Broken Capture
                </h4>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">
                If Course Finder changed its markup or searches fail to capture, you can inspect and submit a scrubbed bug report directly on GitHub.
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  onOpenChange(false);
                  onOpenReport();
                }}
                className="text-xs bg-amber-50 hover:bg-amber-100 text-amber-900 border-amber-300 flex items-center gap-1.5"
              >
                <Flag className="h-3.5 w-3.5" />
                <span>Report broken capture</span>
              </Button>
            </div>
          )}
        </div>

        <DialogFooter className="shrink-0 pt-3 border-t border-slate-200">
          <Button
            type="button"
            variant="default"
            size="sm"
            onClick={() => onOpenChange(false)}
            className="bg-slate-900 hover:bg-slate-800 text-white text-xs px-4"
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
