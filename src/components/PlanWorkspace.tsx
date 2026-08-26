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
import { CapturedCatalog } from "./CapturedCatalog";
import { useCapture } from "./useCapture";
import { SectionPicker } from "./SectionPicker";
import { useSectionPicker } from "./useSectionPicker";
import { SolvePanel } from "./SolvePanel";
import { usePlanRefresh } from "./usePlanRefresh";
import { MissingSectionBanner } from "./MissingSectionBanner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import * as client from "../adapters/ipc/client";
import type { Plan, PlanSection, PlanSummary, Section, Solution } from "../adapters/ipc/types";
import { formatSectionCount } from "../core/plan";
import { findConflicts } from "../core/conflicts";
import {
  formatRefreshProgress,
  formatExpiryMessage,
  formatOfflineMessage,
} from "../core/refresh";
import type { ToolTab } from "../core/toolPanel";
import {
  DEFAULT_TOOL_TAB,
  TOOL_TABS,
  formatEmptyCatalogSignal,
  resolveToolTab,
} from "../core/toolPanel";
import {
  formatSolutionPreviewLabel,
  solutionToPreviewSections,
  solutionToSectionRefs,
} from "../core/solver";
import { ExportMenu } from "./ExportMenu";

export interface PlanWorkspaceProps {
  planSummary: PlanSummary;
  plan: Plan | null;
  isLoading: boolean;
  error: string | null;
  initialConfirmingClear?: boolean;
  /**
   * Which tool the panel opens on. The suite renders to static markup and
   * cannot click a tab, so the selection is drivable from props — the same
   * seam `initialConfirmingClear` already provides for the clear dialog.
   */
  initialTab?: ToolTab;
  /** Test seam for the solution preview the Solve tab paints on the grid. */
  initialPreviewSolution?: Solution | null;
  /**
   * Whether the tool panel starts unfolded.
   *
   * It does not: opening a plan is the moment a student wants to look at the
   * schedule, and the three tools are things that act on it rather than
   * things to read. The suite renders to static markup and cannot click the
   * control, so this is drivable from props.
   */
  initialToolsOpen?: boolean;
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
  initialTab = DEFAULT_TOOL_TAB,
  initialPreviewSolution = null,
  initialToolsOpen = false,
  onRetry,
  onReportBrokenCapture,
  onPlanUpdated,
}: PlanWorkspaceProps) {
  const [hoveredSection, setHoveredSection] = useState<Section | null>(null);
  /**
   * The selected tool.
   *
   * Held here and nowhere else. Every mutation reloads the plan through
   * `onRetry`, and this component stays mounted across that — so adding a
   * section cannot bounce the student back to Capture. Nothing derives this
   * from the plan, and no effect resets it.
   */
  const [activeTab, setActiveTab] = useState<ToolTab>(() => initialTab);
  /**
   * Whether the tool panel is unfolded.
   *
   * Folded, the grid takes the whole row — which is the view a student wants
   * when comparing a full week, and the one the app opens a plan on. Held
   * here beside the selected tab, so unfolding returns to the tool that was
   * last in use rather than resetting to Capture.
   */
  const [isToolsOpen, setIsToolsOpen] = useState<boolean>(() => initialToolsOpen);
  /**
   * The candidate schedule painted on the week grid, and its rank, which is
   * how the grid names it. Held here rather than in `SolvePanel` because
   * leaving the Solve tab has to put the real plan back, and the panel does
   * not know about tabs.
   */
  const [previewSelection, setPreviewSelection] = useState<{
    solution: Solution;
    rank: number;
  } | null>(() => (initialPreviewSolution ? { solution: initialPreviewSolution, rank: 1 } : null));
  const [isConfirmingClear, setIsConfirmingClear] = useState<boolean>(
    () => initialConfirmingClear
  );
  const [isClearing, setIsClearing] = useState<boolean>(false);
  const [isApplyingPreview, setIsApplyingPreview] = useState<boolean>(false);

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
    setCourseIncluded,
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
   * Switching tools.
   *
   * Leaving Solve puts the real plan back on the grid: a candidate schedule
   * is only ever shown while the panel that produced it is on screen, so it
   * can never be left behind looking like the applied plan.
   */
  const handleTabChange = (next: string) => {
    const tab = resolveToolTab(next);
    if (tab !== "solve") {
      setPreviewSelection(null);
    }
    setActiveTab(tab);
  };

  const browseCourse = (courseId: number) => {
    selectCourse(courseId);
    setPreviewSelection(null);
    setActiveTab("pick");
    setIsToolsOpen(true);
  };

  /**
   * The one preview on the grid (ticket 46).
   *
   * A solution preview and the picker's hover ghost are the same concept and
   * take the same path onto the grid. They live on different tabs, so only
   * one is ever active — and this expression is where that is guaranteed
   * rather than hoped for.
   */
  const previewSections = previewSelection
    ? solutionToPreviewSections(previewSelection.solution, currentSections)
    : hoveredSection
    ? [hoveredSection]
    : null;

  const handleSetCourseIncluded = async (courseId: number, included: boolean) => {
    try {
      await setCourseIncluded(courseId, included);
      // Excluding a course the solver was filling changes what a solve would
      // return, so a preview built from the old catalog is stale.
      setPreviewSelection(null);
    } catch {
      // Error handled in picker state
    }
  };

  /**
   * What the Pick tab browses.
   *
   * The Capture tab manages the whole catalog — that is where a course is
   * checked, unchecked, and forgotten. Pick offers only the courses the
   * student said they intend to take. One loaded array, filtered at the point
   * of use: never a second fetch, which is the bug ticket 32 fixed.
   */
  const includedCourses = courses.filter((course) => course.included);

  const emptyCatalogSignal = formatEmptyCatalogSignal(courses.length);

  /**
   * Applying the schedule currently on the grid.
   *
   * The same command the Solve panel's own Apply button issues — one path,
   * reached from either the card or the week the student is reading.
   */
  const handleApplyPreview = async () => {
    if (!previewSelection) return;
    setIsApplyingPreview(true);
    try {
      const updatedPlan = await client.applySolution({
        planId: planSummary.id,
        sections: solutionToSectionRefs(previewSelection.solution),
      });
      onPlanUpdated?.(updatedPlan);
      // The plan now is the schedule, so previewing it would preview what is
      // already drawn.
      setPreviewSelection(null);
      onRetry();
    } catch {
      // Surfaced by the Solve panel, which owns the solve's error state.
    } finally {
      setIsApplyingPreview(false);
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
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <h3 className="text-base font-semibold text-foreground">Weekly Schedule</h3>

        {/* Unfolding the tools. Folding hides more than a tab does, so the
            way back is a named control rather than an edge to find, and it
            carries the empty-catalog signal the tab strip would have. */}
        {!isToolsOpen && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setIsToolsOpen(true)}
            className="h-8 gap-1.5 text-xs"
            data-testid="show-tools"
            title="Show Capture, Solve, and Pick"
          >
            <span>Tools</span>
            {emptyCatalogSignal && (
              <span className="rounded-pill bg-amber-100 px-1.5 py-0.5 text-nano font-bold uppercase tracking-wider text-amber-900">
                {emptyCatalogSignal}
              </span>
            )}
          </Button>
        )}
      </div>
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

          {/* Persistent stats and conflict indicator (SPEC §4, ADR-0009).
              Export lives beside the schedule it exports, in the Weekly
              Schedule header — one control, not two, and one off-screen
              export canvas rather than two (ticket 40). */}
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

      {/* Global notices, deliberately outside the tabs (ticket 46).
          A capture that failed to parse, a refresh that died, a section that
          vanished from the catalog — none of these are the Capture tab's
          private business. Tabs hide state, and this is the state that must
          never be hidden. */}
      <CaptureBar
        render="notices"
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

      {/* Two regions (ticket 46): a tabbed tool panel and the week grid, which
          is always visible because it is the artifact the whole app exists to
          produce. Switching tabs changes the tool, never the workspace.

          Source order is the stacked order — the grid comes first, so below
          the width where two columns fit it sits above the panel (ticket 28).
          `order-*` puts the panel back on the left from `lg`.

          Neither wrapper takes `transform`, `filter`, or a blurred backdrop:
          the grid's context menu is portalled to `document.body` and
          positioned `fixed`, and every one of those properties would make an
          ancestor its containing block and silently mis-place it
          (tickets 41, 45). */}
      <div
        data-testid="workspace-columns"
        className="flex flex-col lg:flex-row items-start gap-6"
      >
        {/* The permanent week grid. Same place, same size, on every tab. */}
        <div
          data-testid="grid-region"
          className={`w-full min-w-0 order-1 space-y-3 ${
            isToolsOpen ? "lg:flex-1 lg:order-2 lg:sticky lg:top-20" : ""
          }`}
        >
          {renderScheduleHeader()}

          {isLoading && !plan && !error ? (
            /* The shape of a week is known, so the skeleton draws it. */
            <WeekGrid sections={[]} isLoading interactive={false} />
          ) : (
            <WeekGrid
              sections={currentSections}
              previewSections={previewSections}
              previewLabel={
                previewSelection
                  ? formatSolutionPreviewLabel(previewSelection.rank)
                  : null
              }
              previewReplacesPlan={previewSelection !== null}
              onClearPreview={() => setPreviewSelection(null)}
              onApplyPreview={previewSelection ? handleApplyPreview : undefined}
              isApplyingPreview={isApplyingPreview}
              conflicts={conflicts}
              onTogglePin={handleTogglePin}
              onRemoveSection={handleRemoveSection}
              onShowOtherSections={browseCourse}
            />
          )}
        </div>

        {/* The tool panel. Bounded in height, with the scroll on the region
            *under* the tab strip rather than on the panel itself — so Capture
            / Solve / Pick stay put while the tool they select scrolls.

            Sticky positioning would have worked too, but the offset would
            have to track the strip's own height, and the picker's course
            selector pins to the same edge. Taking the tabs out of the scroll
            container makes both correct with no magic numbers. */}
        {isToolsOpen && (
        <div
          data-testid="tool-panel"
          className="w-full lg:w-[400px] xl:w-[480px] lg:shrink-0 min-w-0 order-2 lg:order-1 flex flex-col lg:max-h-[calc(100vh-14rem)]"
        >
          <Tabs
            value={activeTab}
            onValueChange={handleTabChange}
            /* `flex-1 min-h-0` is what actually makes the bound bite: without
               it the tabs size to their content and overflow the panel
               instead of handing the overflow to the scroll region below. */
            className="flex min-h-0 flex-1 flex-col"
          >
            {/* Tab strip and the fold control share a row: folding is a
                property of the panel, so it sits on the panel's own chrome. */}
            <div className="flex shrink-0 items-center gap-2">
            <TabsList className="min-w-0 flex-1">
              {TOOL_TABS.map((info) => (
                <TabsTrigger
                  key={info.tab}
                  value={info.tab}
                  title={info.description}
                  data-empty-catalog={
                    info.tab === "capture" && emptyCatalogSignal ? "true" : undefined
                  }
                >
                  {info.label}
                  {info.tab === "capture" && emptyCatalogSignal && (
                    /* The cost of tabs, paid deliberately: a student on Solve
                       or Pick can see that the catalog behind Capture is
                       empty without switching to find out. */
                    <span className="rounded-pill bg-amber-100 px-1.5 py-0.5 text-nano font-bold uppercase tracking-wider text-amber-900">
                      {emptyCatalogSignal}
                    </span>
                  )}
                </TabsTrigger>
              ))}
            </TabsList>

            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setIsToolsOpen(false)}
              className="h-9 shrink-0 px-2 text-xs text-muted-foreground hover:text-foreground"
              data-testid="hide-tools"
              title="Hide the tools and give the schedule the whole window"
            >
              Hide
            </Button>
            </div>

            <div
              data-testid="tool-panel-scroll"
              className="min-h-0 flex-1 lg:overflow-y-auto lg:pr-1"
            >
            {/* Capture: the arrival surface. The way in, and what came in. */}
            <TabsContent value="capture" className="space-y-4">
              <CaptureBar
                render="controls"
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

              {/* The same loaded catalog the Pick tab browses — one array,
                  passed to both. Ticket 32 fixed a fetch here and a local
                  patch there disagreeing about this data once already. */}
              <CapturedCatalog
                courses={courses}
                isLoading={isLoadingCourses}
                isMutating={isMutating}
                onBrowseCourse={browseCourse}
                onSetIncluded={handleSetCourseIncluded}
                onRemoveCourse={handleRemoveCourse}
              />
            </TabsContent>

            {/* Solve: the former modal, now a panel beside the grid it draws on. */}
            <TabsContent value="solve">
              <SolvePanel
                planId={planSummary.id}
                planSections={currentSections}
                onTogglePin={handleTogglePin}
                selectedSolutionId={previewSelection?.solution.id ?? null}
                onSelectSolution={setPreviewSelection}
                onPlanUpdated={(updatedPlan) => {
                  onPlanUpdated?.(updatedPlan);
                  onRetry();
                }}
              />
            </TabsContent>

            {/* Pick: unchanged, in a column of its own. */}
            <TabsContent value="pick">
              <SectionPicker
                render="all"
                scrollContext="panel"
                courses={includedCourses}
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
              />
            </TabsContent>
            </div>
          </Tabs>
        </div>
        )}
      </div>
    </div>
  );
}
