import React, { useState, useEffect, useMemo } from "react";
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
/** "Opens outside the app" is not something the label says. */
import { ExternalLink, ChevronLeft, ChevronRight } from "lucide-react";
import type { CampusOption, SessionOption, PlanSummary } from "../adapters/ipc/types";
import {
  DISCLAIMER_TEXT,
  SIGN_IN_NOTICE,
  type OnboardingStep,
} from "../core/onboarding";
import {
  validateCreatePlanInput,
  formatFullAcademicYear,
  buildAcademicSessionStructure,
  resolveAcademicSessionId,
} from "../core/options";

export interface OnboardingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campusOptions: CampusOption[];
  sessionOptions: SessionOption[];
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
  onCreatePlan,
  onOpenCapture,
  onSelectPlan,
  onComplete,
  initialStep = "choice",
}: OnboardingDialogProps) {
  const sessionStructure = useMemo(
    () => buildAcademicSessionStructure(sessionOptions),
    [sessionOptions]
  );

  const [step, setStep] = useState<OnboardingStep>(initialStep);
  const [name, setName] = useState("Target Schedule");
  const [campusId, setCampusId] = useState<number | null>(
    campusOptions.length > 0 ? campusOptions[0].id : 7
  );
  const [startYear, setStartYear] = useState<number>(
    () => sessionStructure.defaultStartYear
  );
  const [selectedTerm, setSelectedTerm] = useState<number>(
    () => sessionStructure.defaultTerm ?? 1
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

  const formattedYear = formatFullAcademicYear(startYear);
  const currentSessionId = resolveAcademicSessionId(sessionOptions, startYear, selectedTerm);

  const handleStepYear = (delta: number) => {
    const nextYear = startYear + delta;
    if (nextYear >= 2000 && nextYear <= 2100) {
      setStartYear(nextYear);
      if (validationErrors.sessionId) {
        setValidationErrors((prev) => ({ ...prev, sessionId: undefined }));
      }
    }
  };

  const handleTermChange = (term: number) => {
    setSelectedTerm(term);
    if (validationErrors.sessionId) {
      setValidationErrors((prev) => ({ ...prev, sessionId: undefined }));
    }
  };

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

  const handleCreateStepSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const result = validateCreatePlanInput({
      name,
      campusId,
      sessionId: currentSessionId,
    });
    if (!result.valid) {
      setValidationErrors(result.errors);
      return;
    }

    if (campusId === null || currentSessionId === null) return;

    setIsLoading(true);
    setError(null);
    try {
      const plan = await onCreatePlan({
        name: name.trim(),
        campusId,
        sessionId: currentSessionId,
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
    const sId = createdPlan?.sessionId ?? currentSessionId ?? 155;
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
      <DialogContent className="ambient-host sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        {/* A calm screen, and the first one a student sees. */}
        <div data-testid="ambient-wash" aria-hidden="true" className="ambient-wash" />

        {step === "choice" && (
          /* One path in.
             The sample-data option was removed, and this screen is set as a
             single centred column rather than a two-up choice grid with one
             cell missing — there is no choice left to present, so it stops
             pretending there is. */
          <div className="ambient-content space-y-6 py-4 text-center">
            <DialogHeader className="space-y-2 text-center sm:text-center">
              <DialogTitle className="text-wordmark text-foreground">
                Welcome to Animo Plan
              </DialogTitle>
              <DialogDescription className="text-sm text-muted-foreground max-w-md mx-auto leading-relaxed">
                Set up a plan for your campus and term, then capture the courses
                you are looking at in Archer&#39;s Hub. Nothing is ever written
                back, and no credentials are stored.
              </DialogDescription>
            </DialogHeader>

            {error && (
              <Alert variant="destructive" className="text-left">
                <AlertTitle>Error</AlertTitle>
                <AlertDescription className="font-mono text-xs break-all">
                  {error}
                </AlertDescription>
              </Alert>
            )}

            <Button
              onClick={() => {
                setError(null);
                setStep("pick-scope");
              }}
              className="px-8"
            >
              Create your plan
            </Button>

            {/* Verbatim Disclaimer during first run (ADR-0001, ADR-0002, Spec §1) */}
            <div className="rounded-card border border-border bg-card/90 p-3.5 text-xs text-muted-foreground space-y-1 text-left">
              <span className="font-semibold text-foreground block">Disclaimer</span>
              <p className="leading-relaxed">{DISCLAIMER_TEXT}</p>
            </div>

            <DialogFooter className="pt-1 sm:justify-center items-center">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleSkip}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Skip tour
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === "pick-scope" && (
          <div className="ambient-content space-y-5 py-2">
            <DialogHeader>
              <div className="flex items-center justify-between">
                <span className="text-micro font-bold uppercase tracking-wider text-primary">
                  Step 1 of 3
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleSkip}
                  className="h-7 text-xs text-muted-foreground hover:text-foreground"
                >
                  Skip
                </Button>
              </div>
              <DialogTitle className="text-lg font-bold text-foreground">
                Pick Campus &amp; Academic Session
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                A plan is hard-scoped to one campus and academic session to guarantee schedule validity.
              </DialogDescription>
            </DialogHeader>

            {error && (
              <Alert variant="destructive">
                <AlertTitle>Error</AlertTitle>
                <AlertDescription className="font-mono text-xs break-all">
                  {error}
                </AlertDescription>
              </Alert>
            )}

            <form onSubmit={handleCreateStepSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <label htmlFor="onboarding-plan-name" className="text-xs font-semibold text-foreground">
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
                <label htmlFor="onboarding-campus" className="text-xs font-semibold text-foreground block">
                  Campus <span className="text-red-600">*</span>
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
                  className="flex h-9 w-full rounded-control border border-input bg-card px-3 py-1 text-sm"
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
                <label className="text-xs font-semibold text-foreground block">
                  Academic Session <span className="text-red-600">*</span>
                </label>
                <div className="flex items-center gap-2">
                  <span className="flex h-9 items-center justify-center rounded-control border border-input bg-muted px-3 text-sm font-bold text-foreground select-none shrink-0">
                    AY
                  </span>
                  <div className="flex h-9 items-center justify-between rounded-control border border-input bg-card px-1 flex-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={isLoading || startYear <= 2000}
                      onClick={() => handleStepYear(-1)}
                      aria-label="Previous Academic Year"
                      className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground disabled:opacity-30 cursor-pointer"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span
                      data-testid="onboarding-year-display"
                      className="text-sm font-medium text-foreground px-2 tabular-nums select-none"
                    >
                      {formattedYear}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={isLoading || startYear >= 2100}
                      onClick={() => handleStepYear(1)}
                      aria-label="Next Academic Year"
                      className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground disabled:opacity-30 cursor-pointer"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                  <select
                    id="onboarding-term"
                    aria-label="Academic Term"
                    value={selectedTerm}
                    onChange={(e) => handleTermChange(Number(e.target.value))}
                    disabled={isLoading}
                    className="flex h-9 flex-1 rounded-control border border-input bg-card px-3 py-1 text-sm"
                  >
                    <option value={1}>Term 1</option>
                    <option value={2}>Term 2</option>
                    <option value={3}>Term 3</option>
                  </select>
                </div>
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
                >
                  {isLoading ? "Creating..." : "Continue"}
                </Button>
              </DialogFooter>
            </form>
          </div>
        )}

        {step === "sign-in" && (
          <div className="ambient-content space-y-5 py-2">
            <DialogHeader>
              <div className="flex items-center justify-between">
                <span className="text-micro font-bold uppercase tracking-wider text-primary">
                  Step 2 of 3
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleSkip}
                  className="h-7 text-xs text-muted-foreground hover:text-foreground"
                >
                  Skip
                </Button>
              </div>
              <DialogTitle className="text-lg font-bold text-foreground">
                Sign In to Archer&#39;s Hub
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                Sign in manually through the Archer&#39;s Hub popup window to search your courses.
              </DialogDescription>
            </DialogHeader>

            {/* Clear Sign-In Privacy Notice (ADR-0002, Spec §8) */}
            <div className="rounded-panel border border-emerald-200 bg-emerald-50/70 p-4 space-y-2">
              <span className="block text-emerald-900 font-semibold text-sm">
                Zero Credential Storage
              </span>
              <p className="text-xs text-emerald-800 leading-relaxed font-medium">
                {SIGN_IN_NOTICE}
              </p>
              <p className="text-xs text-emerald-700 leading-relaxed">
                When you click below, Archer&#39;s Hub opens in a secure popup window. You will log in manually using your DLSU ERP credentials. Your session is saved securely in your local browser profile.
              </p>
            </div>

            {error && (
              <Alert variant="destructive">
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
                className="w-full sm:w-auto font-medium flex items-center justify-center gap-1.5"
              >
                {!isLoading && <ExternalLink className="h-4 w-4" aria-hidden="true" />}
                <span>{isLoading ? "Opening..." : "Open Archer's Hub"}</span>
              </Button>
              {hasOpenedCapture && (
                <span className="text-xs text-emerald-800 font-medium">
                  Archer&#39;s Hub window opened
                </span>
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
              >
                Next
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === "search-course" && (
          <div className="ambient-content space-y-5 py-2">
            <DialogHeader>
              <div className="flex items-center justify-between">
                <span className="text-micro font-bold uppercase tracking-wider text-primary">
                  Step 3 of 3
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleSkip}
                  className="h-7 text-xs text-muted-foreground hover:text-foreground"
                >
                  Skip
                </Button>
              </div>
              <DialogTitle className="text-lg font-bold text-foreground">
                Search Your First Course
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                How automatic silent capture works during your enlistment planning.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3">
              <div className="flex items-start gap-3 rounded-card border border-border bg-card p-3.5">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-control bg-emerald-100 text-emerald-900 font-bold text-xs">
                  1
                </div>
                <div className="text-xs text-muted-foreground leading-relaxed">
                  <strong className="text-foreground block font-semibold mb-0.5">
                    Navigate to Course Finder
                  </strong>
                  In the Archer&#39;s Hub popup, open the Course Finder page.
                </div>
              </div>

              <div className="flex items-start gap-3 rounded-card border border-border bg-card p-3.5">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-control bg-emerald-100 text-emerald-900 font-bold text-xs">
                  2
                </div>
                <div className="text-xs text-muted-foreground leading-relaxed">
                  <strong className="text-foreground block font-semibold mb-0.5">
                    Search Any Subject
                  </strong>
                  Select any course from the dropdown (e.g. <code className="text-primary font-mono">CSINTSY</code>, <code className="text-primary font-mono">GEARTAP</code>).
                </div>
              </div>

              <div className="flex items-start gap-3 rounded-card border border-border bg-card p-3.5">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-control bg-emerald-100 text-emerald-900 font-bold text-xs">
                  3
                </div>
                <div className="text-xs text-muted-foreground leading-relaxed">
                  <strong className="text-foreground block font-semibold mb-0.5">
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
                className="font-semibold"
              >
                Finish &amp; Go to Plan
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
