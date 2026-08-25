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
  BookOpen,
} from "lucide-react";

import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Alert, AlertTitle, AlertDescription } from "./ui/alert";
import { WeekGrid } from "./WeekGrid";
import { CaptureBar } from "./CaptureBar";
import { useCapture } from "./useCapture";
import { SectionPicker } from "./SectionPicker";
import { useSectionPicker } from "./useSectionPicker";
import { SolveDialog } from "./SolveDialog";
import { usePlanRefresh } from "./usePlanRefresh";
import { MissingSectionBanner } from "./MissingSectionBanner";
import * as client from "../adapters/ipc/client";
import type { Plan, PlanSummary, Section } from "../adapters/ipc/types";
import { formatSectionCount } from "../core/plan";
import { findConflicts } from "../core/conflicts";
import {
  formatRefreshProgress,
  formatExpiryMessage,
  formatOfflineMessage,
} from "../core/refresh";
import { ExportMenu } from "./ExportMenu";

export interface PlanWorkspaceProps {
  planSummary: PlanSummary;
  plan: Plan | null;
  isLoading: boolean;
  error: string | null;
  onBack: () => void;
  onRetry: () => void;
  onReportBrokenCapture?: (error: string) => void;
  onPlanUpdated?: (plan: Plan) => void;
}

export function PlanWorkspace({
  planSummary,
  plan,
  isLoading,
  error,
  onRetry,
  onReportBrokenCapture,
  onPlanUpdated,
}: PlanWorkspaceProps) {
  const [hoveredSection, setHoveredSection] = useState<Section | null>(null);
  const [isSolveOpen, setIsSolveOpen] = useState<boolean>(false);
  const [isPickerOpen, setIsPickerOpen] = useState<boolean>(true);

  const currentSections = plan?.sections ?? [];

  const conflicts = useMemo(() => {
    return findConflicts(currentSections);
  }, [currentSections]);

  const {
    summary: captureSummary,
    isLoading: isCaptureLoading,
    error: captureError,
    captureFailure,
    isOpening: isOpeningCapture,
    openCapture,
    dismissFailure,
    fetchSummary,
  } = useCapture(planSummary.campusId, planSummary.sessionId);

  const {
    courses,
    selectedCourseId,
    sections,
    isLoadingCourses,
    isLoadingSections,
    isMutating,
    error: pickerError,
    fetchCourses,
    selectCourse,
    addSection,
    removeSection,
    togglePin,
    forgetCourse,
  } = useSectionPicker({
    campusId: planSummary.campusId,
    sessionId: planSummary.sessionId,
    planId: planSummary.id,
    onPlanUpdated: (updatedPlan) => {
      onPlanUpdated?.(updatedPlan);
      onRetry();
    },
    onCaptureUpdated: () => {
      fetchSummary();
    },
  });

  const {
    isRefreshing,
    isResuming,
    progress: refreshProgress,
    outcome: refreshOutcome,
    sessionExpired: isSessionExpired,
    offline: isOffline,
    error: refreshError,
    missingSections: refreshMissingSections,
    startRefresh,
    resumeRefresh,
    fetchMissingSections,
    dismissNotice: dismissRefreshNotice,
  } = usePlanRefresh({
    planId: planSummary.id,
    onPlanUpdated: () => {
      onRetry();
      fetchCourses();
    },
  });

  // Synthesize missing sections from current plan if store hasn't been queried yet
  const effectiveMissingSections = useMemo(() => {
    if (refreshMissingSections.length > 0) {
      return refreshMissingSections;
    }
    const missingInPlan = currentSections.filter((s) => s.missing);
    if (missingInPlan.length === 0) {
      return [];
    }
    return missingInPlan.map((s) => ({
      courseId: s.courseId,
      sectionId: s.sectionId,
      sectionCode: s.sectionCode,
      alternatives: [],
    }));
  }, [refreshMissingSections, currentSections]);

  const handleAddSection = async (section: Section) => {
    try {
      await addSection(section);
      await fetchMissingSections();
      onRetry();
    } catch {
      // Error handled in picker state
    }
  };

  const handleRemoveSection = async (section: Section) => {
    try {
      await removeSection(section);
      await fetchMissingSections();
      onRetry();
    } catch {
      // Error handled in picker state
    }
  };

  const handleRemoveMissingSection = async (courseId: number, sectionId: number) => {
    try {
      const updatedPlan = await client.removeSectionFromPlan({
        planId: planSummary.id,
        courseId,
        sectionId,
      });
      onPlanUpdated?.(updatedPlan);
      await fetchMissingSections();
      onRetry();
    } catch {
      // Error handled
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

  const handleRemoveCourse = async (courseId: number) => {
    try {
      await forgetCourse(courseId);
      await fetchMissingSections();
      await fetchSummary();
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

          {/* Persistent stats, conflict indicator, explicit Refresh control, and Export menu (SPEC §4, ADR-0009) */}
          <div className="flex flex-wrap items-center gap-3">
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

            <ExportMenu
              planSummary={planSummary}
              plan={plan}
              conflicts={conflicts}
            />
          </div>
        </div>
      </div>

      {/* Capture launch and running counter (ticket 12, SPEC section 4) */}
      <CaptureBar
        campusId={planSummary.campusId}
        sessionId={planSummary.sessionId}
        campusName={planSummary.campusName}
        sessionName={planSummary.sessionName}
        summary={captureSummary}
        isLoading={isCaptureLoading}
        error={captureError}
        captureFailure={captureFailure}
        isOpening={isOpeningCapture}
        onOpenCapture={openCapture}
        isRefreshing={isRefreshing}
        onRefresh={() => startRefresh()}
        onDismissFailure={dismissFailure}
        onReportBrokenCapture={onReportBrokenCapture}
      />

      {/* Refresh Progress Indicator (Ticket 21: Shows which course is being refreshed and how many remain) */}
      {isRefreshing && refreshProgress && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/80 p-4 flex items-center gap-3 shadow-2xs">
          <RefreshCw className="h-4 w-4 animate-spin text-emerald-700 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-emerald-950">
              {formatRefreshProgress(refreshProgress)}
            </p>
          </div>
        </div>
      )}

      {/* Session Expiry Notice with Resume Button (Ticket 21, SPEC §4) */}
      {isSessionExpired && (
        <Alert variant="destructive" className="border-amber-300 bg-amber-50/90 text-amber-950">
          <AlertCircle className="h-4 w-4 text-amber-800" />
          <AlertTitle className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-amber-950">
            <span className="font-bold">Session expired — sign in to continue</span>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => openCapture()}
                className="h-7 text-xs bg-white text-slate-900 border-amber-300 hover:bg-amber-100/50"
              >
                Open Archer&#x27;s Hub
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={isRefreshing}
                onClick={() => resumeRefresh()}
                className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700 text-white shadow-2xs flex items-center gap-1"
              >
                <RefreshCw className={`h-3 w-3 ${isResuming ? "animate-spin" : ""}`} />
                <span>Resume</span>
              </Button>
            </div>
          </AlertTitle>
          <AlertDescription className="text-xs text-amber-900 mt-1">
            {
              formatExpiryMessage(
                refreshOutcome ?? {
                  refreshedCourses: 0,
                  totalCourses: 0,
                  haltedAfterCourseCode: null,
                }
              ).description
            }
          </AlertDescription>
        </Alert>
      )}

      {/* Offline Notice (Ticket 21, SPEC §4) */}
      {isOffline && (
        <Alert className="border-slate-300 bg-slate-50 text-slate-800">
          <AlertCircle className="h-4 w-4 text-slate-600" />
          <AlertTitle className="flex items-center justify-between font-semibold text-slate-900">
            <span>Offline</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={dismissRefreshNotice}
              className="h-6 px-2 text-xs text-slate-500 hover:text-slate-900"
            >
              Dismiss
            </Button>
          </AlertTitle>
          <AlertDescription className="text-xs text-slate-600 mt-0.5">
            {formatOfflineMessage()}
          </AlertDescription>
        </Alert>
      )}

      {/* Refresh Error Banner */}
      {refreshError && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle className="flex items-center justify-between">
            <span>Refresh failed</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={dismissRefreshNotice}
              className="h-6 px-2 text-xs text-red-700 hover:text-red-900"
            >
              Dismiss
            </Button>
          </AlertTitle>
          <AlertDescription className="text-xs mt-0.5">{refreshError}</AlertDescription>
        </Alert>
      )}

      {/* Persistent Missing Section Banner (Ticket 21, SPEC §5, ADR-0008) */}
      <MissingSectionBanner
        missingSections={effectiveMissingSections}
        planSections={currentSections}
        onAddAlternative={handleAddSection}
        onRemoveMissingSection={handleRemoveMissingSection}
      />

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

      {/* Main workspace layout: Section Picker + Week Grid (SPEC §7, ADR-0011, ADR-0012, ADR-0014, Ticket 28) */}
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
            onClick={() => setIsSolveOpen(true)}
            className="text-xs shrink-0 bg-white hover:bg-slate-50 text-blue-700 border-blue-200"
          >
            <Sparkles className="h-3.5 w-3.5 mr-1" />
            Solve the rest
          </Button>
        </div>

        {isPickerOpen ? (
          /* Picking layout. The picker's chrome -- title, course selector, and
             the selected-course banner -- spans the full width above, so the
             section list below starts level with the week grid instead of
             being pushed down by its own header. Two columns from `lg:`
             (1024px): the app ships at 1400x900, and gating this at `xl:`
             once left every fresh install stacked with the grid scrolled out
             of view. The grid takes the larger share; the picker is the tool,
             the grid is the artifact. */
          <div data-testid="picking-layout" className="space-y-4">
            <SectionPicker
              render="chrome"
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
              onRemoveCourse={handleRemoveCourse}
              onTogglePin={handleTogglePin}
              onHoverSection={setHoveredSection}
              onClose={() => setIsPickerOpen(false)}
            />

            <div className="flex flex-col lg:flex-row items-start gap-6">
            {/* Section list column: left on desktop, below the grid when stacked */}
            <div className="w-full lg:w-[380px] xl:w-[440px] lg:shrink-0 min-w-0 order-2 lg:order-1">
              <SectionPicker
                render="list"
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
                onRemoveCourse={handleRemoveCourse}
                onTogglePin={handleTogglePin}
                onHoverSection={setHoveredSection}
                onClose={() => setIsPickerOpen(false)}
              />
            </div>

            {/* Week grid column: right and sticky on desktop, above the picker
                when stacked so the preview is never below the list. */}
            <div className="w-full lg:flex-1 min-w-0 order-1 lg:order-2 lg:sticky lg:top-6 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold text-slate-900">Weekly Schedule</h3>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-slate-500">
                    {currentSections.length === 0
                      ? "No sections added yet"
                      : formatSectionCount(currentSections.length)}
                  </span>
                  <ExportMenu
                    planSummary={planSummary}
                    plan={plan}
                    conflicts={conflicts}
                  />
                </div>
              </div>

              <WeekGrid
                sections={currentSections}
                ghostSection={hoveredSection}
                conflicts={conflicts}
              />
            </div>
            </div>
          </div>
        ) : (
          /* Single-column reading order when picker is closed */
          <div className="space-y-6">
            {/* Pick my own sections affordance */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-xl border border-emerald-100 bg-emerald-50/50 p-4">
              <div className="flex items-start sm:items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700 shrink-0">
                  <BookOpen className="h-4 w-4" />
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-slate-900">
                    Pick my own sections
                  </h4>
                  <p className="text-xs text-slate-500">
                    Browse captured sections course by course and preview ghosts on the week grid.
                  </p>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsPickerOpen(true)}
                className="text-xs shrink-0 bg-white hover:bg-slate-50 text-emerald-700 border-emerald-200"
              >
                <BookOpen className="h-3.5 w-3.5 mr-1" />
                Open picker
              </Button>
            </div>

            {/* Week Grid in full width single column */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold text-slate-900">Weekly Schedule</h3>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-slate-500">
                    {currentSections.length === 0
                      ? "No sections added yet"
                      : formatSectionCount(currentSections.length)}
                  </span>
                  <ExportMenu
                    planSummary={planSummary}
                    plan={plan}
                    conflicts={conflicts}
                  />
                </div>
              </div>

              <WeekGrid
                sections={currentSections}
                ghostSection={hoveredSection}
                conflicts={conflicts}
              />
            </div>
          </div>
        )}
      </div>

      {/* Solve The Rest Dialog (Ticket 20) */}
      <SolveDialog
        open={isSolveOpen}
        onOpenChange={setIsSolveOpen}
        planId={planSummary.id}
        onPlanUpdated={(updatedPlan) => {
          onPlanUpdated?.(updatedPlan);
          onRetry();
        }}
      />
    </div>
  );
}
