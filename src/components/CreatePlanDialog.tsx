import React, { useState } from "react";
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
import { AlertCircle, Calendar, Building2 } from "lucide-react";
import type { CampusOption, SessionOption } from "../adapters/ipc/types";
import { validateCreatePlanInput } from "../core/options";

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
  const [name, setName] = useState("");
  const [campusId, setCampusId] = useState<number | null>(
    campusOptions.length > 0 ? campusOptions[0].id : null
  );
  const [sessionId, setSessionId] = useState<number | null>(
    sessionOptions.length > 0 ? sessionOptions[0].id : null
  );
  const [validationErrors, setValidationErrors] = useState<{
    name?: string;
    campusId?: string;
    sessionId?: string;
  }>({});

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const result = validateCreatePlanInput({ name, campusId, sessionId });
    if (!result.valid) {
      setValidationErrors(result.errors);
      return;
    }

    setValidationErrors({});
    if (campusId !== null && sessionId !== null) {
      onSubmit({
        name: name.trim(),
        campusId,
        sessionId,
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
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Unable to create plan</AlertTitle>
            <AlertDescription className="font-mono text-xs break-all">
              {error}
            </AlertDescription>
          </Alert>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          <div className="space-y-1.5">
            <label htmlFor="plan-name" className="text-sm font-medium text-slate-900">
              Plan Name <span className="text-red-500">*</span>
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
            <label htmlFor="plan-campus" className="text-sm font-medium text-slate-900 flex items-center gap-1.5">
              <Building2 className="h-3.5 w-3.5 text-slate-500" />
              <span>Campus</span> <span className="text-red-500">*</span>
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
              className="flex h-9 w-full rounded-md border border-slate-200 bg-white px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"
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
            <label htmlFor="plan-session" className="text-sm font-medium text-slate-900 flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5 text-slate-500" />
              <span>Academic Session</span> <span className="text-red-500">*</span>
            </label>
            <select
              id="plan-session"
              value={sessionId ?? ""}
              onChange={(e) => {
                const val = e.target.value ? Number(e.target.value) : null;
                setSessionId(val);
                if (validationErrors.sessionId) {
                  setValidationErrors((prev) => ({ ...prev, sessionId: undefined }));
                }
              }}
              disabled={isLoading}
              className="flex h-9 w-full rounded-md border border-slate-200 bg-white px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="" disabled>
                Select an academic session...
              </option>
              {sessionOptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            {validationErrors.sessionId && (
              <p className="text-xs text-red-600 font-medium">{validationErrors.sessionId}</p>
            )}
          </div>

          <div className="rounded-md bg-slate-50 p-3 text-xs text-slate-600 border border-slate-200">
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
            <Button type="submit" disabled={isLoading}>
              {isLoading ? "Creating..." : "Create Plan"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
