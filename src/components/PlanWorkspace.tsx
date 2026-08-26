import { useState, useMemo } from "react";
/**
 * One glyph survives on this screen: the conflict indicator (ADR-0009), which
 * is the single thing a student scans the plan header for. Everything else
 * sat beside a word that already said it.
 */
import { AlertTriangle } from "lucide-react";

import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Alert, AlertTitle, AlertDescription } from "./ui/alert";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "./ui/dialog";
import { WeekGrid } from "./WeekGrid";
import { CaptureBar } from "./CaptureBar";
import { useCapture } from "./useCapture";
import { SectionPicker } from "./SectionPicker";
import { useSectionPicker } from "./useSectionPicker";
import { SolveDialog } from "./SolveDialog";
import { usePlanRefresh } from "./usePlanRefresh";
import { MissingSectionBanner } from "./MissingSectionBanner";
import * as client from "../adapters/ipc/client";
import type { Plan, PlanSection, PlanSummary, Section } from "../adapters/ipc/types";
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
  initialConfirmingClear?: boolean;
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
  initialConfirmingClear = false,
  onRetry,
  onReportBrokenCapture,
  onPlanUpdated,
}: PlanWorkspaceProps) {
  const [hoveredSection, setHoveredSection] = useState<Section | null>(null);
  const [isSolveOpen, setIsSolveOpen] = useState<boolean>(false);
  const [isPickerOpen, setIsPickerOpen] = useState<boolean>(true);
  const [isConfirmingClear, setIsConfirmingClear] = useState<boolean>(
    () => initialConfirmingClear
  );
  const [isClearing, setIsClearing] = useState<boolean>(false);

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
    notice: pickerNotice,
    fetchCourses,
    selectCourse,
    addSection,
    removeSection,
    togglePin,
    forgetCourse,
    dismissNotice: dismissPickerNotice,
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

  const handleClearSchedule = async () => {
    setIsClearing(true);
    try {
      let updatedPlan: Plan | null = null;
      for (const section of currentSections) {
        updatedPlan = await client.removeSectionFromPlan({
          planId: planSummary.id,
          courseId: section.courseId,
          sectionId: section.sectionId,
        });
      }
      if (updatedPlan) {
        onPlanUpdated?.(updatedPlan);
      }
      setIsConfirmingClear(false);
      onRetry();
    } catch {
      setIsConfirmingClear(false);
    } finally {
      setIsClearing(false);
    }
  };

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

  const handleRemoveSection = async (section: Section | PlanSection) => {
    try {
      await removeSection(section as Section);
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

  const handleTogglePin = async (section: Section | PlanSection, pinned: boolean) => {
    try {
      await togglePin(section as Section, pinned);
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
      // Forgetting a course releases its sections from every plan that held
      // them, so the plan on screen may have just lost rows. Without this the
      // week grid keeps drawing blocks for sections that are no longer in the
      // plan until the student presses Refresh.
      onRetry();
    } catch {
      // Error handled in picker state
    }
  };

  /**
   * The week grid's header, shared by both layouts so they cannot drift.
   *
   * Clear schedule lives here rather than up in the plan banner: it destroys
   * the schedule, so it belongs beside the schedule, where the student can see
   * what they are about to lose. It stays visually subordinate to Export — a
   * ghost button, not an outlined one — because emptying the plan is the rare
   * action on this row.
   */
  const renderScheduleHeader = () => (
    <div className="flex items-center justify-between gap-3">
      <h3 className="text-base font-semibold text-foreground">Weekly Schedule</h3>
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">
          {currentSections.length === 0
            ? "No sections added yet"
            : formatSectionCount(currentSections.length)}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={currentSections.length === 0 || isClearing || isLoading}
          onClick={() => setIsConfirmingClear(true)}
          className="h-9 text-xs text-muted-foreground hover:text-red-700 hover:bg-red-50"
          data-testid="clear-schedule-button"
          title={
            currentSections.length === 0
              ? "Plan is empty"
              : "Clear all sections from schedule"
          }
        >
          Clear schedule
        </Button>
        <ExportMenu planSummary={planSummary} plan={plan} conflicts={conflicts} />
      </div>
    </div>
  );

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 space-y-6">
      {/* Plan Scoping Banner — Always visible on every screen that operates on it */}
      <div className="rounded-panel border border-border bg-card p-panel">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-foreground">
              {planSummary.name}
            </h2>
            <div className="flex flex-wrap items-center gap-2 mt-2">
              <span className="text-micro font-semibold text-muted-foreground uppercase tracking-wider">
                Plan Scope:
              </span>
              <Badge variant="campus">{planSummary.campusName}</Badge>
              <Badge variant="session">{planSummary.sessionName}</Badge>
            </div>
          </div>

          {/* Persistent stats, conflict indicator, explicit Refresh control, and Export menu (SPEC §4, ADR-0009) */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground bg-muted/60 rounded-card p-3 border border-border">
              <span className="font-semibold text-foreground">
                {formatSectionCount(currentSections.length || planSummary.sectionCount)}
              </span>

              <div className="h-4 w-px bg-border" />

              {/* Persistent conflict count (ADR-0009). The glyph stays: this
                  is the one thing on the header a student scans for. */}
              {conflicts.length > 0 ? (
                <span className="flex items-center gap-1.5 text-red-600 font-semibold">
                  <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                  <span>
                    {conflicts.length} {conflicts.length === 1 ? "conflict" : "conflicts"}
                  </span>
                </span>
              ) : (
                <span>No conflicts</span>
              )}

              <div className="h-4 w-px bg-border" />

              <span>Created {new Date(planSummary.createdAt).toLocaleDateString()}</span>
            </div>

            <ExportMenu planSummary={planSummary} plan={plan} conflicts={conflicts} />
          </div>
        </div>
      </div>

      {/* Clear Schedule Confirmation Dialog (Ticket 36) */}
      <Dialog open={isConfirmingClear} onOpenChange={setIsConfirmingClear}>
        <DialogContent className="max-w-md p-6" data-testid="clear-schedule-dialog">
          <DialogHeader className="space-y-2 text-left">
            <DialogTitle className="text-base font-bold text-foreground">
              Clear schedule?
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground leading-relaxed">
              This will remove{" "}
              <strong className="text-slate-900 font-semibold">
                {currentSections.length}{" "}
                {currentSections.length === 1 ? "section" : "sections"}
              </strong>{" "}
              from{" "}
              <strong className="text-slate-900 font-semibold">
                "{planSummary.name}"
              </strong>
              {currentSections.some((s) => s.pinned) ? (
                <>
                  {" "}
                  (including{" "}
                  <strong className="text-slate-900 font-semibold">
                    {currentSections.filter((s) => s.pinned).length}{" "}
                    {currentSections.filter((s) => s.pinned).length === 1
                      ? "pinned section"
                      : "pinned sections"}
                  </strong>
                  ).
                </>
              ) : (
                "."
              )}
              <br />
              <br />
              This removes sections from this plan only. Captured courses and sections in your catalog will not be deleted.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex flex-row items-center justify-end gap-2 pt-4 border-t border-slate-100">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={isClearing}
              onClick={() => setIsConfirmingClear(false)}
              className="h-8 text-xs text-slate-600 hover:text-slate-900"
              data-testid="cancel-clear-schedule"
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={isClearing}
              onClick={handleClearSchedule}
              className="h-8 text-xs"
              data-testid="confirm-clear-schedule"
            >
              {isClearing ? "Clearing..." : "Clear schedule"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
        /* No spinner: a refresh is in flight, which is one of the two
           moments the app must not be animating through. The progress text
           already names the course and the count. */
        <div
          className="rounded-panel border border-emerald-200 bg-emerald-50/80 p-4"
          role="status"
        >
          <p className="text-sm font-semibold text-emerald-950">
            {formatRefreshProgress(refreshProgress)}
          </p>
        </div>
      )}

      {/* Session Expiry Notice with Resume Button (Ticket 21, SPEC §4) */}
      {isSessionExpired && (
        <Alert variant="destructive" className="border-amber-300 bg-amber-50/90 text-amber-950">
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
                className="h-7 text-xs"
              >
                {isResuming ? "Resuming..." : "Resume"}
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
        <Alert className="border-border bg-muted text-foreground">
          <AlertTitle className="flex items-center justify-between font-semibold text-foreground">
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
          <AlertTitle className="flex items-center justify-between">
            <span>Unable to load plan details</span>
            <Button
              variant="outline"
              size="sm"
              onClick={onRetry}
              className="h-7 text-xs border-red-200"
            >
              Retry
            </Button>
          </AlertTitle>
          <AlertDescription className="font-mono text-xs break-all mt-1">
            {error}
          </AlertDescription>
        </Alert>
      )}

      {isLoading && !plan && !error && (
        /* The shape of a week is known, so the skeleton draws it. */
        <WeekGrid sections={[]} isLoading interactive={false} />
      )}

      {/* Main workspace layout: Section Picker + Week Grid (SPEC §7, ADR-0011, ADR-0012, ADR-0014, Ticket 28) */}
      <div className="space-y-6">
        {/* Solver affordance / Entry point ("Let the solver build it" / "Solve the rest") */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-panel border border-border bg-card p-4">
          <div>
            <h4 className="text-sm font-semibold text-foreground">
              Let the solver build it
            </h4>
            <p className="text-xs text-muted-foreground">
              Solve conflict-free combinations filled around your choices.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={isLoading}
            onClick={() => setIsSolveOpen(true)}
            className="text-xs shrink-0"
          >
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
              planName={planSummary.name}
              isLoadingCourses={isLoadingCourses}
              isLoadingSections={isLoadingSections}
              isMutating={isMutating}
              error={pickerError}
              notice={pickerNotice}
              onDismissNotice={dismissPickerNotice}
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
                planName={planSummary.name}
                isLoadingCourses={isLoadingCourses}
                isLoadingSections={isLoadingSections}
                isMutating={isMutating}
                error={pickerError}
                notice={pickerNotice}
                onDismissNotice={dismissPickerNotice}
                onSelectCourse={selectCourse}
                onAddSection={handleAddSection}
                onRemoveSection={handleRemoveSection}
                onRemoveCourse={handleRemoveCourse}
                onTogglePin={handleTogglePin}
                onHoverSection={setHoveredSection}
                onClose={() => setIsPickerOpen(false)}
              />
            </div>

            {/* Week grid column: right and pinned on desktop, above the picker
                when stacked so the preview is never below the list.
                `top-20` clears the app header (sticky, h-16) with a little
                room; at `top-6` the column pinned underneath it and lost the
                "Weekly Schedule / Clear schedule / Export" row. */}
            <div className="w-full lg:flex-1 min-w-0 order-1 lg:order-2 lg:sticky lg:top-20 space-y-3">
              {renderScheduleHeader()}

              <WeekGrid
                sections={currentSections}
                ghostSection={hoveredSection}
                conflicts={conflicts}
                onTogglePin={handleTogglePin}
                onRemoveSection={handleRemoveSection}
                onShowOtherSections={(courseId) => {
                  selectCourse(courseId);
                  setIsPickerOpen(true);
                }}
              />
            </div>
            </div>
          </div>
        ) : (
          /* Single-column reading order when picker is closed */
          <div className="space-y-6">
            {/* Pick my own sections affordance */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-panel border border-border bg-card p-4">
              <div>
                <h4 className="text-sm font-semibold text-foreground">
                  Pick my own sections
                </h4>
                <p className="text-xs text-muted-foreground">
                  Browse captured sections course by course and preview ghosts on the week grid.
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsPickerOpen(true)}
                className="text-xs shrink-0"
              >
                Open picker
              </Button>
            </div>

            {/* Week Grid in full width single column */}
            <div className="space-y-3">
              {renderScheduleHeader()}

              <WeekGrid
                sections={currentSections}
                ghostSection={hoveredSection}
                conflicts={conflicts}
                onTogglePin={handleTogglePin}
                onRemoveSection={handleRemoveSection}
                onShowOtherSections={(courseId) => {
                  selectCourse(courseId);
                  setIsPickerOpen(true);
                }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Solve The Rest Dialog (Ticket 20, Ticket 43) */}
      <SolveDialog
        open={isSolveOpen}
        onOpenChange={setIsSolveOpen}
        planId={planSummary.id}
        planSections={currentSections}
        onTogglePin={handleTogglePin}
        onPlanUpdated={(updatedPlan) => {
          onPlanUpdated?.(updatedPlan);
          onRetry();
        }}
      />
    </div>
  );
}
