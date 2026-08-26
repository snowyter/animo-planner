import { useState, useEffect } from "react";
/** "Opens outside the app" is not something the link text says. */
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
import { Badge } from "./ui/badge";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import * as client from "../adapters/ipc/client";
import type { AppInfo, UpdateCheck } from "../adapters/ipc/types";
import {
  DISCLAIMER_TEXT,
  PUBLIC_SOURCE_REPO_URL,
  formatSelectorConfigSource,
} from "../core/diagnostics";
import { formatUpdateFailureReason } from "../core/updater";

export interface AboutDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenReport?: () => void;
  initialAppInfo?: AppInfo | null;
  initialUpdateCheck?: UpdateCheck | null;
  isCheckingUpdate?: boolean;
  isInstallingUpdate?: boolean;
  onCheckForUpdate?: () => void;
  onInstallUpdate?: () => void;
  onUpdateCheckChange?: (check: UpdateCheck) => void;
}

export function AboutDialog({
  open,
  onOpenChange,
  onOpenReport,
  initialAppInfo,
  initialUpdateCheck,
  isCheckingUpdate: externalIsChecking,
  isInstallingUpdate: externalIsInstalling,
  onCheckForUpdate,
  onInstallUpdate,
  onUpdateCheckChange,
}: AboutDialogProps) {
  const [appInfo, setAppInfo] = useState<AppInfo | null>(() => initialAppInfo ?? null);
  const [isLoadingInfo, setIsLoadingInfo] = useState<boolean>(false);
  const [isConfirmingClear, setIsConfirmingClear] = useState<boolean>(false);
  const [isClearing, setIsClearing] = useState<boolean>(false);
  const [clearStatus, setClearStatus] = useState<"success" | "error" | null>(null);
  const [clearError, setClearError] = useState<string | null>(null);

  // Updater state
  const [updateCheck, setUpdateCheck] = useState<UpdateCheck | null>(
    () => initialUpdateCheck ?? null
  );
  const [internalIsChecking, setInternalIsChecking] = useState<boolean>(false);
  const [internalIsInstalling, setInternalIsInstalling] = useState<boolean>(false);
  const [installError, setInstallError] = useState<string | null>(null);

  const isChecking = externalIsChecking ?? internalIsChecking;
  const isInstalling = externalIsInstalling ?? internalIsInstalling;

  useEffect(() => {
    if (initialUpdateCheck !== undefined) {
      setUpdateCheck(initialUpdateCheck);
    }
  }, [initialUpdateCheck]);

  useEffect(() => {
    if (!open) {
      setIsConfirmingClear(false);
      setClearStatus(null);
      setClearError(null);
      setInstallError(null);
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

  const handleCheckForUpdate = async () => {
    if (isChecking || isInstalling) return;
    if (onCheckForUpdate) {
      onCheckForUpdate();
      return;
    }

    setInternalIsChecking(true);
    setInstallError(null);
    try {
      const result = await client.checkForUpdate();
      setUpdateCheck(result);
      onUpdateCheckChange?.(result);
    } catch {
      const failedCheck: UpdateCheck = {
        status: "failed",
        currentVersion: appInfo?.appVersion ?? "0.1.0",
        availableVersion: null,
        notes: null,
        failureReason: "unknown",
        failureDetail: "Update check failed",
      };
      setUpdateCheck(failedCheck);
      onUpdateCheckChange?.(failedCheck);
    } finally {
      setInternalIsChecking(false);
    }
  };

  const handleInstall = async () => {
    if (isInstalling || isChecking) return;
    if (onInstallUpdate) {
      onInstallUpdate();
      return;
    }

    setInternalIsInstalling(true);
    setInstallError(null);
    try {
      const outcome = await client.installUpdate();
      if (outcome.status === "failed") {
        setInstallError(outcome.failureDetail ?? "Update installation failed");
      }
    } catch (err: unknown) {
      setInstallError(err instanceof Error ? err.message : "Update installation failed");
    } finally {
      setInternalIsInstalling(false);
    }
  };

  const isUpdaterCompiledOut = updateCheck?.status === "unavailable";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="ambient-host max-w-2xl max-h-[90vh] flex flex-col p-6 overflow-hidden">
        {/* A calm screen, not a working one. */}
        <div data-testid="ambient-wash" aria-hidden="true" className="ambient-wash" />

        <DialogHeader className="ambient-content space-y-1 shrink-0">
          {/* The mark is the wordmark (docs/design-system.md). */}
          <DialogTitle className="text-wordmark text-foreground">
            About Animo Plan
          </DialogTitle>
          <DialogDescription className="text-micro text-muted-foreground">
            Archer&#39;s Hub Enlistment Planner
          </DialogDescription>
        </DialogHeader>

        <div className="ambient-content flex-1 overflow-y-auto space-y-4 py-3 pr-1">
          {/* Verbatim Disclaimer Banner (SPEC §1, ADR-0001, ADR-0002) */}
          <Alert className="bg-card/90">
            <AlertTitle className="text-xs font-semibold text-foreground">
              Disclaimer
            </AlertTitle>
            <AlertDescription className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
              {DISCLAIMER_TEXT}
            </AlertDescription>
          </Alert>

          {/* Versions and Selector Config Status (SPEC §9, ADR-0013, Ticket 39) */}
          <div className="rounded-panel border border-border bg-card p-4 space-y-3">
            <h4 className="text-micro font-bold text-foreground uppercase tracking-wider">
              Version &amp; Configuration
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="rounded-control bg-muted p-2.5 border border-border flex items-center justify-between">
                <span className="text-muted-foreground font-medium">App Version:</span>
                <span className="font-mono font-semibold text-foreground">
                  {isLoadingInfo ? "Loading..." : (appInfo?.appVersion ?? "0.1.0")}
                </span>
              </div>
              <div className="rounded-control bg-muted p-2.5 border border-border flex items-center justify-between">
                <span className="text-muted-foreground font-medium">Selector Config:</span>
                {isLoadingInfo && !appInfo ? (
                  <span className="font-mono text-muted-foreground">Loading...</span>
                ) : (
                  <div className="flex items-center gap-1.5 font-mono">
                    <span className="font-semibold text-foreground">
                      {appInfo ? `v${appInfo.selectorConfigVersion}` : "v1"}
                    </span>
                    <Badge
                      variant={appInfo?.selectorConfigSource === "remote" ? "default" : "secondary"}
                      className="px-1.5 py-0 capitalize"
                    >
                      {formatSelectorConfigSource(appInfo?.selectorConfigSource ?? "bundled")}
                    </Badge>
                  </div>
                )}
              </div>
            </div>

            {/* Updates area — omitted when updater is compiled out */}
            {!isUpdaterCompiledOut && (
              <div className="pt-2 border-t border-border space-y-2.5">
                {updateCheck?.status === "available" && (
                  <div className="rounded-card bg-emerald-50/80 border border-emerald-200 p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-emerald-950">
                        Animo Plan v{updateCheck.availableVersion} is available
                      </span>
                      <Badge variant="default">New Version</Badge>
                    </div>

                    {updateCheck.notes && (
                      <p className="text-xs text-foreground bg-card/80 rounded-control p-2 border border-emerald-100 font-sans leading-relaxed">
                        {updateCheck.notes}
                      </p>
                    )}

                    <p className="text-micro text-muted-foreground">
                      The app will restart after updating.
                    </p>

                    {installError && (
                      <Alert variant="destructive" className="py-1.5">
                        <AlertDescription className="text-xs">{installError}</AlertDescription>
                      </Alert>
                    )}

                    <div className="pt-1">
                      <Button
                        type="button"
                        size="sm"
                        disabled={isInstalling || isChecking}
                        onClick={handleInstall}
                        className="h-7 text-xs"
                      >
                        {isInstalling ? "Installing & restarting..." : "Install and Restart"}
                      </Button>
                    </div>
                  </div>
                )}

                {updateCheck?.status === "up_to_date" && (
                  <div className="flex items-center justify-between text-xs bg-muted rounded-control p-2.5 border border-border">
                    <span className="text-emerald-900 font-medium">
                      Animo Plan is up to date
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={isChecking}
                      onClick={handleCheckForUpdate}
                      className="h-6 text-micro px-2"
                    >
                      {isChecking ? "Checking..." : "Check again"}
                    </Button>
                  </div>
                )}

                {updateCheck?.status === "failed" && (
                  <div className="flex items-center justify-between text-xs bg-muted rounded-control p-2.5 border border-border">
                    <span className="text-foreground">
                      {formatUpdateFailureReason(updateCheck.failureReason)}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={isChecking}
                      onClick={handleCheckForUpdate}
                      className="h-6 text-micro px-2"
                    >
                      {isChecking ? "Checking..." : "Check again"}
                    </Button>
                  </div>
                )}

                {(!updateCheck || (updateCheck.status !== "available" && updateCheck.status !== "up_to_date" && updateCheck.status !== "failed")) && (
                  <div className="flex items-center justify-between pt-1">
                    <span className="text-xs text-muted-foreground">Check GitHub Releases for updates</span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={isChecking}
                      onClick={handleCheckForUpdate}
                      className="h-7 text-xs"
                    >
                      {isChecking ? "Checking for updates..." : "Check for updates"}
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Public Source Repository (ADR-0005, SPEC §8) */}
          <div className="rounded-panel border border-border bg-card p-4 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-micro font-bold text-foreground uppercase tracking-wider">
                Public Source Code
              </h4>
              <a
                href={PUBLIC_SOURCE_REPO_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-primary font-semibold flex items-center gap-1 hover:underline"
              >
                <span>github.com/snowyter/animo-planner</span>
                <ExternalLink className="h-3 w-3" aria-hidden="true" />
              </a>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Animo Plan is public and MIT-licensed. You are typing university credentials into a window this binary controls — &ldquo;read the source&rdquo; is the honest answer to why you should trust this tool.
            </p>
          </div>

          {/* Sign Out / Clear Session Control (SPEC §4, §8, ADR-0002) */}
          <div className="rounded-panel border border-border bg-card p-4 space-y-3">
            <h4 className="text-micro font-bold text-foreground uppercase tracking-wider">
              Sign out / clear session
            </h4>

            <p className="text-xs text-muted-foreground leading-relaxed">
              Wipes the persisted browser session, login credentials, and cookies from the Archer&#39;s Hub window. <strong>Captured sections and plans stay saved locally.</strong>
            </p>

            {clearStatus === "success" && (
              <Alert className="border-emerald-200 bg-emerald-50 text-emerald-950 py-2">
                <AlertDescription className="text-xs text-emerald-900 font-medium">
                  Browser session cleared successfully. The next capture will ask you to sign in.
                </AlertDescription>
              </Alert>
            )}

            {clearStatus === "error" && clearError && (
              <Alert variant="destructive" className="py-2">
                <AlertDescription className="text-xs font-medium">
                  {clearError}
                </AlertDescription>
              </Alert>
            )}

            {isConfirmingClear ? (
              <div className="rounded-card bg-amber-50 border border-amber-200 p-3 space-y-2">
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
                    {isClearing ? "Clearing..." : "Confirm & Clear Session"}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={isClearing}
                    onClick={() => setIsConfirmingClear(false)}
                    className="h-7 text-xs"
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
                className="text-xs"
              >
                Sign out / clear session
              </Button>
            )}
          </div>

          {/* Report Broken Capture Affordance (SPEC §9) */}
          {onOpenReport && (
            <div className="rounded-panel border border-border bg-card p-4 space-y-2.5">
              <h4 className="text-micro font-bold text-foreground uppercase tracking-wider">
                Diagnostics &amp; Broken Capture
              </h4>
              <p className="text-xs text-muted-foreground leading-relaxed">
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
                className="text-xs text-amber-900 border-amber-300 hover:bg-amber-50"
              >
                Report broken capture
              </Button>
            </div>
          )}
        </div>

        <DialogFooter className="ambient-content shrink-0 pt-3 border-t border-border">
          <Button
            type="button"
            variant="default"
            size="sm"
            onClick={() => onOpenChange(false)}
            className="text-xs px-4"
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
