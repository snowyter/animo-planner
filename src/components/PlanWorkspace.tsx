import { useState, useMemo } from "react";
import {
  Building2,
  Calendar,
  AlertCircle,
  RefreshCw,
  Layers,
  Clock,
  AlertTriangle,
  CheckCircle2,
  Sparkles,
} from "lucide-react";

import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Alert, AlertTitle, AlertDescription } from "./ui/alert";
import { WeekGrid } from "./WeekGrid";
import { SectionPicker } from "./SectionPicker";
import { useSectionPicker } from "./useSectionPicker";
import type { Plan, PlanSummary, Section } from "../adapters/ipc/types";
import { formatSectionCount } from "../core/plan";
import { findConflicts } from "../core/conflicts";

export interface PlanWorkspaceProps {
  planSummary: PlanSummary;
  plan: Plan | null;
  isLoading: boolean;
  error: string | null;
  onBack: () => void;
  onRetry: () => void;
  onPlanUpdated?: (plan: Plan) => void;
}

export function PlanWorkspace({
  planSummary,
  plan,
  isLoading,
  error,
  onRetry,
  onPlanUpdated,
}: PlanWorkspaceProps) {
  const [hoveredSection, setHoveredSection] = useState<Section | null>(null);

  const currentSections = plan?.sections ?? [];

  const conflicts = useMemo(() => {
    return findConflicts(currentSections);
  }, [currentSections]);

  const {
    courses,
    selectedCourseId,
    sections,
    isLoadingCourses,
    isLoadingSections,
    isMutating,
    error: pickerError,
    selectCourse,
    addSection,
    removeSection,
    togglePin,
  } = useSectionPicker({
    campusId: planSummary.campusId,
    sessionId: planSummary.sessionId,
    planId: planSummary.id,
    onPlanUpdated: (updatedPlan) => {
      onPlanUpdated?.(updatedPlan);
      onRetry();
    },
  });

  const handleAddSection = async (section: Section) => {
    try {
      await addSection(section);
      onRetry();
    } catch {
      // Error handled in picker state
    }
  };

  const handleRemoveSection = async (section: Section) => {
    try {
      await removeSection(section);
      onRetry();
    } catch {
      // Error handled in picker state
    }
  };

  const handleTogglePin = async (section: Section, pinned: boolean) => {
    try {
      await togglePin(section, pinned);
      onRetry();
    } catch {
      // Error handled in picker state
    }
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 space-y-6">
      {/* Plan Scoping Banner — Always visible on every screen that operates on it */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <h2 className="text-2xl font-bold tracking-tight text-slate-900">
                {planSummary.name}
              </h2>
              {planSummary.isSample && (
                <Badge variant="secondary" className="text-xs">
                  Sample Data
                </Badge>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2 mt-2">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                Plan Scope:
              </span>
              <Badge variant="campus" className="flex items-center gap-1 text-xs">
                <Building2 className="h-3.5 w-3.5" />
                <span>{planSummary.campusName}</span>
              </Badge>
              <Badge variant="session" className="flex items-center gap-1 text-xs">
                <Calendar className="h-3.5 w-3.5" />
                <span>{planSummary.sessionName}</span>
              </Badge>
            </div>
          </div>

          {/* Persistent stats & conflict indicator (ADR-0009) */}
          <div className="flex flex-wrap items-center gap-4 text-sm text-slate-600 bg-slate-50 rounded-lg p-3 border border-slate-100">
            <div className="flex items-center gap-1.5">
              <Layers className="h-4 w-4 text-emerald-700" />
              <span className="font-semibold text-slate-900">
                {formatSectionCount(currentSections.length || planSummary.sectionCount)}
              </span>
            </div>

            <div className="h-4 w-px bg-slate-200" />

            {/* Persistent Conflict Count in Plan Header */}
            {conflicts.length > 0 ? (
              <div className="flex items-center gap-1.5 text-red-600 font-semibold">
                <AlertTriangle className="h-4 w-4" />
                <span>
                  {conflicts.length} {conflicts.length === 1 ? "conflict" : "conflicts"}
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 text-slate-600">
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                <span>No conflicts</span>
              </div>
            )}

            <div className="h-4 w-px bg-slate-200" />

            <div className="flex items-center gap-1.5">
              <Clock className="h-4 w-4 text-slate-400" />
              <span>Created {new Date(planSummary.createdAt).toLocaleDateString()}</span>
            </div>
          </div>
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle className="flex items-center justify-between">
            <span>Unable to load plan details</span>
            <Button
              variant="outline"
              size="sm"
              onClick={onRetry}
              className="h-7 text-xs bg-white hover:bg-slate-50 text-slate-900 border-red-200"
            >
              <RefreshCw className="h-3 w-3 mr-1" />
              Retry
            </Button>
          </AlertTitle>
          <AlertDescription className="font-mono text-xs break-all mt-1">
            {error}
          </AlertDescription>
        </Alert>
      )}

      {isLoading && !plan && !error && (
        <div className="flex min-h-[300px] flex-col items-center justify-center space-y-3 rounded-xl border border-slate-200 bg-white p-8">
          <RefreshCw className="h-8 w-8 animate-spin text-emerald-600" />
          <p className="text-sm text-slate-500 font-medium">Loading plan details...</p>
        </div>
      )}

      {/* Main workspace layout: Section Picker + Week Grid (SPEC §7, ADR-0011, ADR-0012, ADR-0014) */}
      <div className="space-y-6">
        {/* Solver affordance / Entry point ("Let the solver build it" / "Solve the rest") */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-xl border border-blue-100 bg-blue-50/50 p-4">
          <div className="flex items-start sm:items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-100 text-blue-700 shrink-0">
              <Sparkles className="h-4 w-4" />
            </div>
            <div>
              <h4 className="text-sm font-semibold text-slate-900">
                Let the solver build it
              </h4>
              <p className="text-xs text-slate-500">
                Solve conflict-free combinations filled around your choices.
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={isLoading}
            className="text-xs shrink-0 bg-white hover:bg-slate-50 text-blue-700 border-blue-200"
          >
            <Sparkles className="h-3.5 w-3.5 mr-1" />
            Solve the rest
          </Button>
        </div>

        {/* Section Picker (Ticket 13: default entry point for browsing & picking sections) */}
        <SectionPicker
          courses={courses}
          selectedCourseId={selectedCourseId}
          sections={sections}
          planSections={currentSections}
          isLoadingCourses={isLoadingCourses}
          isLoadingSections={isLoadingSections}
          isMutating={isMutating}
          error={pickerError}
          onSelectCourse={selectCourse}
          onAddSection={handleAddSection}
          onRemoveSection={handleRemoveSection}
          onTogglePin={handleTogglePin}
          onHoverSection={setHoveredSection}
        />


        {/* Week Grid */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold text-slate-900">Weekly Schedule</h3>
            <span className="text-xs text-slate-500">
              {currentSections.length === 0
                ? "No sections added yet"
                : formatSectionCount(currentSections.length)}
            </span>
          </div>

          <WeekGrid
            sections={currentSections}
            ghostSection={hoveredSection}
            conflicts={conflicts}
          />
        </div>
      </div>
    </div>
  );
}

