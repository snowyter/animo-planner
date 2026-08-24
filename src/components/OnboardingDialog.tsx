import React, { useState, useEffect } from "react";
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
import {
  Sparkles,
  ArrowRight,
  ShieldCheck,
  Building2,
  Calendar,
  ExternalLink,
  BookOpen,
  Info,
  CheckCircle2,
  RefreshCw,
  AlertCircle,
} from "lucide-react";
import type { CampusOption, SessionOption, PlanSummary } from "../adapters/ipc/types";
import {
  DISCLAIMER_TEXT,
  SIGN_IN_NOTICE,
  type OnboardingStep,
} from "../core/onboarding";
import { validateCreatePlanInput } from "../core/options";

export interface OnboardingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campusOptions: CampusOption[];
  sessionOptions: SessionOption[];
  onSeedSample: () => Promise<PlanSummary>;
  onCreatePlan: (args: { name: string; campusId: number; sessionId: number }) => Promise<PlanSummary>;
  onOpenCapture: (args: { campusId: number; sessionId: number }) => Promise<void>;
  onSelectPlan: (plan: PlanSummary) => void;
  onComplete: () => void;
  initialStep?: OnboardingStep;
}

export function OnboardingDialog({
  open,
  onOpenChange,
  campusOptions,
  sessionOptions,
  onSeedSample,
  onCreatePlan,
  onOpenCapture,
  onSelectPlan,
  onComplete,
  initialStep = "choice",
}: OnboardingDialogProps) {
  const [step, setStep] = useState<OnboardingStep>(initialStep);
  const [name, setName] = useState("Target Schedule");
  const [campusId, setCampusId] = useState<number | null>(
    campusOptions.length > 0 ? campusOptions[0].id : 7
  );
  const [sessionId, setSessionId] = useState<number | null>(
    sessionOptions.length > 0 ? sessionOptions[0].id : 155
  );
  const [createdPlan, setCreatedPlan] = useState<PlanSummary | null>(null);

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<{
    name?: string;
    campusId?: string;
    sessionId?: string;
  }>({});
  const [hasOpenedCapture, setHasOpenedCapture] = useState(false);

  useEffect(() => {
    if (open) {
      setStep(initialStep);
      setError(null);
      setValidationErrors({});
      setHasOpenedCapture(false);
    }
  }, [open, initialStep]);

  useEffect(() => {
    if (campusId === null && campusOptions.length > 0) {
      setCampusId(campusOptions[0].id);
    }
  }, [campusId, campusOptions]);

  useEffect(() => {
    if (sessionId === null && sessionOptions.length > 0) {
      setSessionId(sessionOptions[0].id);
    }
  }, [sessionId, sessionOptions]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      onComplete();
      if (createdPlan) {
        onSelectPlan(createdPlan);
      }
    }
    onOpenChange(nextOpen);
  };

  const handleSkip = () => {
    handleOpenChange(false);
  };

  const handleSelectSample = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const sample = await onSeedSample();
      onComplete();
      onSelectPlan(sample);
      onOpenChange(false);
    } catch (err: unknown) {
      if (typeof err === "string") {
        setError(err);
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Failed to seed sample data");
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateStepSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const result = validateCreatePlanInput({ name, campusId, sessionId });
    if (!result.valid) {
      setValidationErrors(result.errors);
      return;
    }

    if (campusId === null || sessionId === null) return;

    setIsLoading(true);
    setError(null);
    try {
      const plan = await onCreatePlan({
        name: name.trim(),
        campusId,
        sessionId,
      });
      setCreatedPlan(plan);
      setStep("sign-in");
    } catch (err: unknown) {
      if (typeof err === "string") {
        setError(err);
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Failed to create plan");
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleOpenArcherHub = async () => {
    const cId = createdPlan?.campusId ?? campusId ?? 7;
    const sId = createdPlan?.sessionId ?? sessionId ?? 155;
    setIsLoading(true);
    setError(null);
    try {
      await onOpenCapture({ campusId: cId, sessionId: sId });
      setHasOpenedCapture(true);
    } catch (err: unknown) {
      if (typeof err === "string") {
        setError(err);
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Failed to open Archer's Hub window");
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleFinish = () => {
    handleOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        {step === "choice" && (
          <div className="space-y-6 py-2">
            <DialogHeader>
              <div className="flex items-center gap-2 mb-1">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-700 text-white font-bold">
                  <BookOpen className="h-4 w-4" />
                </div>
                <DialogTitle className="text-xl font-bold text-slate-900">
                  Welcome to Animo Plan
                </DialogTitle>
              </div>
              <DialogDescription className="text-sm text-slate-600">
                Choose how you would like to get started. You can explore the app immediately with sample data or set up a live plan with your campus and term.
              </DialogDescription>
            </DialogHeader>

            {/* Verbatim Disclaimer during first run (ADR-0001, ADR-0002, Spec §1) */}
            <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-3.5 text-xs text-slate-600 space-y-1">
              <div className="flex items-center gap-1.5 font-semibold text-slate-800">
                <Info className="h-3.5 w-3.5 text-emerald-700 shrink-0" />
                <span>Disclaimer</span>
              </div>
              <p className="leading-relaxed">{DISCLAIMER_TEXT}</p>
            </div>

            {error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Error</AlertTitle>
                <AlertDescription className="font-mono text-xs break-all">
                  {error}
                </AlertDescription>
              </Alert>
            )}

            {/* Two equal-weight paths (Ticket 24 & Spec §7) */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Option A: Start a Real Plan */}
              <div className="flex flex-col justify-between rounded-xl border-2 border-emerald-600 bg-white p-5 shadow-xs transition-all hover:shadow-md">
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-emerald-800 font-bold text-base">
                    <BookOpen className="h-5 w-5 text-emerald-700" />
                    <h3>Start a real plan</h3>
                  </div>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    Set up your campus and term, sign in to Archer&#39;s Hub in a secure popup, and capture your courses directly.
                  </p>
                </div>
                <div className="mt-5 pt-3 border-t border-slate-100">
                  <Button
                    onClick={() => {
                      setError(null);
                      setStep("pick-scope");
                    }}
                    className="w-full bg-emerald-700 hover:bg-emerald-800 text-white font-semibold flex items-center justify-center gap-1.5 shadow-sm"
                  >
                    <span>Create your plan</span>
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {/* Option B: Explore with Sample Data */}
              <div className="flex flex-col justify-between rounded-xl border-2 border-amber-500 bg-white p-5 shadow-xs transition-all hover:shadow-md">
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-amber-900 font-bold text-base">
                    <Sparkles className="h-5 w-5 text-amber-600" />
                    <h3>Explore with sample data</h3>
                  </div>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    Instantly load 47 real sections (GEARTAP &amp; CSINTSY). Demo the week grid, section picker, and solver offline with no sign-in.
                  </p>
                </div>
                <div className="mt-5 pt-3 border-t border-slate-100">
                  <Button
                    variant="outline"
                    onClick={handleSelectSample}
                    disabled={isLoading}
                    className="w-full border-amber-400 text-amber-900 hover:bg-amber-50 font-semibold flex items-center justify-center gap-1.5"
                  >
                    {isLoading ? (
                      <RefreshCw className="h-4 w-4 animate-spin" />
                    ) : (
                      <Sparkles className="h-4 w-4 text-amber-600" />
                    )}
                    <span>Explore with sample data</span>
                  </Button>
                </div>
              </div>
            </div>

            <DialogFooter className="pt-2 sm:justify-between items-center">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleSkip}
                className="text-xs text-slate-500 hover:text-slate-800"
              >
                Skip tour
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === "pick-scope" && (
          <div className="space-y-5 py-2">
            <DialogHeader>
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-emerald-700">
                  Step 1 of 3
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleSkip}
                  className="h-7 text-xs text-slate-500 hover:text-slate-800"
                >
                  Skip
                </Button>
              </div>
              <DialogTitle className="text-lg font-bold text-slate-900">
                Pick Campus &amp; Academic Session
              </DialogTitle>
              <DialogDescription className="text-xs text-slate-600">
                A plan is hard-scoped to one campus and academic session to guarantee schedule validity.
              </DialogDescription>
            </DialogHeader>

            {error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Error</AlertTitle>
                <AlertDescription className="font-mono text-xs break-all">
                  {error}
                </AlertDescription>
              </Alert>
            )}

            <form onSubmit={handleCreateStepSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <label htmlFor="onboarding-plan-name" className="text-xs font-semibold text-slate-900">
                  Plan Name <span className="text-red-500">*</span>
                </label>
                <Input
                  id="onboarding-plan-name"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    if (validationErrors.name) {
                      setValidationErrors((prev) => ({ ...prev, name: undefined }));
                    }
                  }}
                  disabled={isLoading}
                  placeholder="e.g. T1 Target Load"
                  autoFocus
                />
                {validationErrors.name && (
                  <p className="text-xs text-red-600">{validationErrors.name}</p>
                )}
              </div>

              <div className="space-y-1.5">
                <label htmlFor="onboarding-campus" className="text-xs font-semibold text-slate-900 flex items-center gap-1.5">
                  <Building2 className="h-3.5 w-3.5 text-slate-500" />
                  <span>Campus</span> <span className="text-red-500">*</span>
                </label>
                <select
                  id="onboarding-campus"
                  value={campusId ?? ""}
                  onChange={(e) => {
                    const val = e.target.value ? Number(e.target.value) : null;
                    setCampusId(val);
                    if (validationErrors.campusId) {
                      setValidationErrors((prev) => ({ ...prev, campusId: undefined }));
                    }
                  }}
                  disabled={isLoading}
                  className="flex h-9 w-full rounded-md border border-slate-200 bg-white px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-600"
                >
                  <option value="" disabled>
                    Select campus...
                  </option>
                  {campusOptions.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                {validationErrors.campusId && (
                  <p className="text-xs text-red-600">{validationErrors.campusId}</p>
                )}
              </div>

              <div className="space-y-1.5">
                <label htmlFor="onboarding-session" className="text-xs font-semibold text-slate-900 flex items-center gap-1.5">
                  <Calendar className="h-3.5 w-3.5 text-slate-500" />
                  <span>Academic Session</span> <span className="text-red-500">*</span>
                </label>
                <select
                  id="onboarding-session"
                  value={sessionId ?? ""}
                  onChange={(e) => {
                    const val = e.target.value ? Number(e.target.value) : null;
                    setSessionId(val);
                    if (validationErrors.sessionId) {
                      setValidationErrors((prev) => ({ ...prev, sessionId: undefined }));
                    }
                  }}
                  disabled={isLoading}
                  className="flex h-9 w-full rounded-md border border-slate-200 bg-white px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-600"
                >
                  <option value="" disabled>
                    Select academic session...
                  </option>
                  {sessionOptions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                {validationErrors.sessionId && (
                  <p className="text-xs text-red-600">{validationErrors.sessionId}</p>
                )}
              </div>

              <DialogFooter className="pt-2 sm:justify-between items-center">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setStep("choice")}
                  disabled={isLoading}
                >
                  Back
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={isLoading}
                  className="bg-emerald-700 hover:bg-emerald-800 text-white"
                >
                  {isLoading ? "Creating..." : "Continue"}
                </Button>
              </DialogFooter>
            </form>
          </div>
        )}

        {step === "sign-in" && (
          <div className="space-y-5 py-2">
            <DialogHeader>
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-emerald-700">
                  Step 2 of 3
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleSkip}
                  className="h-7 text-xs text-slate-500 hover:text-slate-800"
                >
                  Skip
                </Button>
              </div>
              <DialogTitle className="text-lg font-bold text-slate-900">
                Sign In to Archer&#39;s Hub
              </DialogTitle>
              <DialogDescription className="text-xs text-slate-600">
                Sign in manually through the Archer&#39;s Hub popup window to search your courses.
              </DialogDescription>
            </DialogHeader>

            {/* Clear Sign-In Privacy Notice (ADR-0002, Spec §8) */}
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-4 space-y-2">
              <div className="flex items-center gap-2 text-emerald-900 font-semibold text-sm">
                <ShieldCheck className="h-5 w-5 text-emerald-700 shrink-0" />
                <span>Zero Credential Storage</span>
              </div>
              <p className="text-xs text-emerald-800 leading-relaxed font-medium">
                {SIGN_IN_NOTICE}
              </p>
              <p className="text-xs text-emerald-700 leading-relaxed">
                When you click below, Archer&#39;s Hub opens in a secure popup window. You will log in manually using your DLSU ERP credentials. Your session is saved securely in your local browser profile.
              </p>
            </div>

            {error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Error</AlertTitle>
                <AlertDescription className="font-mono text-xs break-all">
                  {error}
                </AlertDescription>
              </Alert>
            )}

            <div className="flex flex-col sm:flex-row items-center gap-3 justify-center py-2">
              <Button
                onClick={handleOpenArcherHub}
                disabled={isLoading}
                className="w-full sm:w-auto bg-emerald-700 hover:bg-emerald-800 text-white font-medium flex items-center justify-center gap-1.5"
              >
                {isLoading ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  <ExternalLink className="h-4 w-4" />
                )}
                <span>Open Archer&#39;s Hub</span>
              </Button>
              {hasOpenedCapture && (
                <div className="flex items-center gap-1.5 text-xs text-emerald-700 font-medium">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  <span>Archer&#39;s Hub window opened</span>
                </div>
              )}
            </div>

            <DialogFooter className="pt-2 sm:justify-between items-center">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setStep("pick-scope")}
                disabled={isLoading}
              >
                Back
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => setStep("search-course")}
                className="bg-emerald-700 hover:bg-emerald-800 text-white"
              >
                Next
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === "search-course" && (
          <div className="space-y-5 py-2">
            <DialogHeader>
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-emerald-700">
                  Step 3 of 3
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleSkip}
                  className="h-7 text-xs text-slate-500 hover:text-slate-800"
                >
                  Skip
                </Button>
              </div>
              <DialogTitle className="text-lg font-bold text-slate-900">
                Search Your First Course
              </DialogTitle>
              <DialogDescription className="text-xs text-slate-600">
                How automatic silent capture works during your enlistment planning.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3">
              <div className="flex items-start gap-3 rounded-lg border border-slate-200 bg-white p-3.5 shadow-2xs">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-emerald-100 text-emerald-800 font-bold text-xs">
                  1
                </div>
                <div className="text-xs text-slate-600 leading-relaxed">
                  <strong className="text-slate-900 block font-semibold mb-0.5">
                    Navigate to Course Finder
                  </strong>
                  In the Archer&#39;s Hub popup, open the Course Finder page.
                </div>
              </div>

              <div className="flex items-start gap-3 rounded-lg border border-slate-200 bg-white p-3.5 shadow-2xs">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-emerald-100 text-emerald-800 font-bold text-xs">
                  2
                </div>
                <div className="text-xs text-slate-600 leading-relaxed">
                  <strong className="text-slate-900 block font-semibold mb-0.5">
                    Search Any Subject
                  </strong>
                  Select any course from the dropdown (e.g. <code className="text-emerald-700 font-mono">CSINTSY</code>, <code className="text-emerald-700 font-mono">GEARTAP</code>).
                </div>
              </div>

              <div className="flex items-start gap-3 rounded-lg border border-slate-200 bg-white p-3.5 shadow-2xs">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-emerald-100 text-emerald-800 font-bold text-xs">
                  3
                </div>
                <div className="text-xs text-slate-600 leading-relaxed">
                  <strong className="text-slate-900 block font-semibold mb-0.5">
                    Silent Local Capture
                  </strong>
                  Sections are captured automatically into your local database. Animo Plan will update the live section counter and let you browse or solve conflict-free schedules.
                </div>
              </div>
            </div>

            <DialogFooter className="pt-2 sm:justify-between items-center">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setStep("sign-in")}
              >
                Back
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={handleFinish}
                className="bg-emerald-700 hover:bg-emerald-800 text-white font-semibold"
              >
                <span>Finish &amp; Go to Plan</span>
                <ArrowRight className="h-4 w-4 ml-1" />
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
