import React, { useState, useMemo } from "react";
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
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { CampusOption, SessionOption } from "../adapters/ipc/types";
import {
  validateCreatePlanInput,
  formatFullAcademicYear,
  buildAcademicSessionStructure,
  resolveAcademicSessionId,
  termsForStartYear,
  type AcademicTermOption,
} from "../core/options";

export interface CreatePlanDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campusOptions: CampusOption[];
  sessionOptions: SessionOption[];
  error?: string | null;
  isLoading?: boolean;
  onSubmit: (args: { name: string; campusId: number; sessionId: number }) => Promise<void> | void;
}

export function CreatePlanDialog({
  open,
  onOpenChange,
  campusOptions,
  sessionOptions,
  error = null,
  isLoading = false,
  onSubmit,
}: CreatePlanDialogProps) {
  const sessionStructure = useMemo(
    () => buildAcademicSessionStructure(sessionOptions),
    [sessionOptions]
  );

  const [name, setName] = useState("");
  const [campusId, setCampusId] = useState<number | null>(
    campusOptions.length > 0 ? campusOptions[0].id : null
  );
  const [startYear, setStartYear] = useState<number>(
    () => sessionStructure.defaultStartYear
  );
  const [selectedTerm, setSelectedTerm] = useState<number>(
    () => sessionStructure.defaultTerm ?? 1
  );
  const [otherSessionId, setOtherSessionId] = useState<number | null>(null);
  const [validationErrors, setValidationErrors] = useState<{
    name?: string;
    campusId?: string;
    sessionId?: string;
  }>({});

  const formattedYear = formatFullAcademicYear(startYear);
  const availableTerms = termsForStartYear(sessionStructure, startYear);
  /**
   * The year's published terms when the catalog has them, and the three a
   * DLSU year has otherwise — so stepping to a year Archer's Hub has not
   * published yet leaves a control the student can still read, which then
   * reports the gap, rather than an empty select that explains nothing.
   */
  const termChoices: AcademicTermOption[] =
    availableTerms.length > 0
      ? availableTerms
      : [1, 2, 3].map((term) => ({ term, termLabel: `Term ${term}`, sessionId: -1 }));
  const currentSessionId =
    otherSessionId ?? resolveAcademicSessionId(sessionOptions, startYear, selectedTerm);
  const isSessionUnavailable = currentSessionId === null;
  const sessionChoiceValue =
    otherSessionId !== null ? `session:${otherSessionId}` : `term:${selectedTerm}`;

  const handleStepYear = (delta: number) => {
    const nextYear = startYear + delta;
    if (nextYear >= 2000 && nextYear <= 2100) {
      setStartYear(nextYear);
      if (validationErrors.sessionId) {
        setValidationErrors((prev) => ({ ...prev, sessionId: undefined }));
      }
    }
  };

  const handleSessionChoiceChange = (raw: string) => {
    if (raw.startsWith("session:")) {
      setOtherSessionId(Number(raw.slice("session:".length)));
    } else {
      setOtherSessionId(null);
      setSelectedTerm(Number(raw.slice("term:".length)));
    }
    if (validationErrors.sessionId) {
      setValidationErrors((prev) => ({ ...prev, sessionId: undefined }));
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
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

    setValidationErrors({});
    if (campusId !== null && currentSessionId !== null) {
      onSubmit({
        name: name.trim(),
        campusId,
        sessionId: currentSessionId,
      });
    }
  };

  const handleClose = () => {
    setName("");
    setValidationErrors({});
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create Plan</DialogTitle>
          <DialogDescription>
            Create a new schedule plan. A plan is hard-scoped to one campus and
            academic session to ensure valid schedules.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <Alert variant="destructive" className="my-2">
            <AlertTitle>Unable to create plan</AlertTitle>
            <AlertDescription className="font-mono text-xs break-all">
              {error}
            </AlertDescription>
          </Alert>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          <div className="space-y-1.5">
            <label htmlFor="plan-name" className="text-sm font-medium text-foreground">
              Plan Name <span className="text-red-600">*</span>
            </label>
            <Input
              id="plan-name"
              placeholder="e.g. T1 Target Load, Priority Schedule"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (validationErrors.name) {
                  setValidationErrors((prev) => ({ ...prev, name: undefined }));
                }
              }}
              disabled={isLoading}
              autoFocus
            />
            {validationErrors.name && (
              <p className="text-xs text-red-600 font-medium">{validationErrors.name}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <label htmlFor="plan-campus" className="text-sm font-medium text-foreground block">
              Campus <span className="text-red-600">*</span>
            </label>
            <select
              id="plan-campus"
              value={campusId ?? ""}
              onChange={(e) => {
                const val = e.target.value ? Number(e.target.value) : null;
                setCampusId(val);
                if (validationErrors.campusId) {
                  setValidationErrors((prev) => ({ ...prev, campusId: undefined }));
                }
              }}
              disabled={isLoading}
              className="flex h-9 w-full rounded-control border border-input bg-card px-3 py-1 text-sm disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="" disabled>
                Select a campus...
              </option>
              {campusOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            {validationErrors.campusId && (
              <p className="text-xs text-red-600 font-medium">{validationErrors.campusId}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground block">
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
                  disabled={isLoading || otherSessionId !== null || startYear <= 2000}
                  onClick={() => handleStepYear(-1)}
                  aria-label="Previous Academic Year"
                  className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground disabled:opacity-30 cursor-pointer"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span
                  data-testid="plan-year-display"
                  className="text-sm font-medium text-foreground px-2 tabular-nums select-none"
                >
                  {formattedYear}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={isLoading || otherSessionId !== null || startYear >= 2100}
                  onClick={() => handleStepYear(1)}
                  aria-label="Next Academic Year"
                  className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground disabled:opacity-30 cursor-pointer"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
              <select
                id="plan-term"
                aria-label="Academic Term or Session"
                value={sessionChoiceValue}
                onChange={(e) => handleSessionChoiceChange(e.target.value)}
                disabled={isLoading}
                className="flex h-9 flex-1 rounded-control border border-input bg-card px-3 py-1 text-sm disabled:cursor-not-allowed disabled:opacity-50"
              >
                {termChoices.map((choice) => (
                  <option key={choice.term} value={`term:${choice.term}`}>
                    {choice.termLabel}
                  </option>
                ))}
                {sessionStructure.otherSessions.length > 0 && (
                  <optgroup label="Other sessions">
                    {sessionStructure.otherSessions.map((session) => (
                      <option key={session.id} value={`session:${session.id}`}>
                        {session.name}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </div>
            {isSessionUnavailable && (
              <p
                data-testid="plan-session-unavailable"
                className="text-xs font-medium text-amber-700"
              >
                AY{formattedYear} Term {selectedTerm} is not in the Archer&rsquo;s Hub
                catalog. Pick a term it currently offers &mdash; a plan cannot be
                scoped to a session that does not exist.
              </p>
            )}
            {validationErrors.sessionId && (
              <p className="text-xs text-red-600 font-medium">{validationErrors.sessionId}</p>
            )}
          </div>

          <div className="rounded-card bg-muted p-3 text-xs text-muted-foreground border border-border">
            <strong>Hard-scoping note:</strong> Once created, a plan is permanently
            scoped to this campus and session. Mixing terms is not supported.
          </div>

          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={isLoading}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading || isSessionUnavailable}>
              {isLoading ? "Creating..." : "Create Plan"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
