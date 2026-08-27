import { useState, useMemo, useRef } from "react";
/**
 * One glyph survives on this screen: the conflict indicator (ADR-0009), which
 * is the single thing a student scans the plan header for. Everything else
 * sat beside a word that already said it.
 */
import { Menu } from "lucide-react";

import { Button } from "./ui/button";
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
import { AvoidedProfessorNotice } from "./AvoidedProfessorNotice";
import { ProfessorRanking } from "./ProfessorRanking";
import { useCourseRanking, useProfessorPreferences } from "./useProfessorPreferences";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import * as client from "../adapters/ipc/client";
import type {
  Plan,
  PlanSection,
  PlanSummary,
  Section,
  Solution,
  ProfessorPreference,
} from "../adapters/ipc/types";
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
import {
  findAvoidedProfessorAdvisories,
  summarisePreferences,
} from "../core/professorRanking";

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
  /**
   * Which course's professor ranking the drill-down opens on, if any
   * (ticket 49). The suite renders to static markup and cannot click a
   * course row, so the drill-down is drivable from props — the same seam
   * `initialTab` provides for the tool panel.
   */
  initialRankingCourseId?: number | null;
  /**
   * The catalog's stored preferences, seeded. Nothing loads under a static
   * render, and the advisory notice and the Priority summary are both
   * computed from this.
   */
  initialPreferencesByCourse?: Map<number, ProfessorPreference[]>;
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
  initialRankingCourseId = null,
  initialPreferencesByCourse,
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
  /**
   * Which course's professor ranking is open, if any.
   *
   * A drill-down, not a fourth tab: the workspace stays, the plan header
   * stays, and the two-column region gives way to it for as long as it is
   * open. Held beside the selected tab so leaving returns to the tool the
   * student came from.
   */
  const [rankingCourseId, setRankingCourseId] = useState<number | null>(
    () => initialRankingCourseId
  );
  /**
   * Where the tool column was scrolled when the drill-down was entered.
   * The column unmounts while the ranking is open, so the offset is put back
   * by the scroll region's own ref rather than by an effect.
   */
  const toolScrollRef = useRef<HTMLDivElement | null>(null);
  const savedToolScrollRef = useRef<number>(0);
  const savedWindowScrollRef = useRef<number>(0);
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

  /**
   * The catalog's professor preferences.
   *
   * Read here rather than inside the Solve panel because two surfaces need
   * them and neither owns the other: the panel summarises them, and the
   * advisory notice — which lives outside the tabs — is computed from them.
   */
  const { preferencesByCourse, reloadPreferences } = useProfessorPreferences(
    { campusId: planSummary.campusId, sessionId: planSummary.sessionId },
    courses.map((course) => course.courseId),
    initialPreferencesByCourse
  );

  const rankingCourse = courses.find((course) => course.courseId === rankingCourseId);

  const ranking = useCourseRanking(
    { campusId: planSummary.campusId, sessionId: planSummary.sessionId },
    rankingCourseId
  );

  const preferenceSummary = useMemo(
    () => summarisePreferences([...preferencesByCourse.values()]),
    [preferencesByCourse]
  );

  /**
   * A section already in the plan that has acquired an avoided professor.
   *
   * Advisory only. Nothing is removed and nothing is re-solved — the plan is
   * the student's (ADR-0009), and avoid is a filter on what a solve offers
   * (ADR-0020).
   */
  const avoidedProfessorAdvisories = useMemo(
    () => findAvoidedProfessorAdvisories(currentSections, preferencesByCourse),
    [currentSections, preferencesByCourse]
  );

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
   * Going into, and coming back from, the ranking.
   *
   * Leaving returns to the Capture tab on the course it was entered from,
   * scrolled where it was — the panel's scroll offset is restored when the
   * tool column mounts again. Coming back also re-reads the preferences, so
   * the Priority summary and the advisory notice reflect what was just said.
   */
  const openRanking = (courseId: number) => {
    savedToolScrollRef.current = toolScrollRef.current?.scrollTop ?? 0;
    savedWindowScrollRef.current =
      typeof window === "undefined" ? 0 : window.scrollY;
    setPreviewSelection(null);
    setActiveTab("capture");
    setIsToolsOpen(true);
    setRankingCourseId(courseId);
  };

  const closeRanking = () => {
    setRankingCourseId(null);
    reloadPreferences();
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
   * The one bar above the workspace: the fold control, the tabs, the title,
   * and the actions that operate on the schedule.
   *
   * It used to be two stacked cards — a plan banner repeating the name and
   * scope the app header already shows, and a separate schedule toolbar
   * under it. Two cards, one of them redundant, and the grid pushed below
   * the fold to pay for them.
   *
   * The bar mirrors the two columns beneath it: the fold control and the
   * tabs sit over the tool panel, the title and the actions over the grid.
   * The plan's stats ride along on the right because nothing else shows
   * them any more.
   */
  const renderWorkspaceBar = () => (
    /* Not a card. The tab strip has to line up with the tool panel below it,
       and a card's own padding is exactly the offset that stopped it: the
       panel starts at the column's left edge, so anything that must align
       with it has to start there too. Dropping the chrome also spends one
       fewer box on a screen whose whole revision was about spending fewer. */
    <div data-testid="workspace-bar" className="flex flex-wrap items-center gap-x-4 gap-y-3">
      {/* One cluster over the column it drives, at exactly that column's
          width and flush with its left edge.

          The fold control sits *inside* the cluster rather than before it,
          which is the only arrangement that satisfies both things at once:
          eyes travel left to right, so the control that opens the tools is
          the first thing on the row — and because it is inside, it costs the
          strip no offset. Put it before the cluster and its own width is
          exactly how far out of line the tabs fall. */}
      <div
        data-testid="tool-cluster"
        className={
          isToolsOpen
            ? "flex w-full shrink-0 items-center gap-1 rounded-panel border border-border bg-muted p-1 lg:w-[400px] xl:w-[480px]"
            : "flex shrink-0 items-center"
        }
      >
        <Button
          type="button"
          size="sm"
          onClick={() => setIsToolsOpen(!isToolsOpen)}
          className="h-9 shrink-0 gap-2 bg-emerald-700 px-3 text-white hover:bg-emerald-800"
          data-testid={isToolsOpen ? "hide-tools" : "show-tools"}
          aria-expanded={isToolsOpen}
          title={
            isToolsOpen
              ? "Hide the tools and give the schedule the whole window"
              : "Show Capture, Solve, and Pick"
          }
        >
          <Menu className="h-4 w-4" aria-hidden="true" />
          <span className="sr-only">{isToolsOpen ? "Hide tools" : "Show tools"}</span>
          {!isToolsOpen && emptyCatalogSignal && (
            <span className="rounded-pill bg-amber-100 px-1.5 py-0.5 text-nano font-bold uppercase tracking-wider text-amber-900">
              {emptyCatalogSignal}
            </span>
          )}
        </Button>

        {/* The strip drops its own shell inside the cluster: the cluster is
            already wearing it, and two nested pills would read as two
            controls. Rendered only while the panel it selects is on screen. */}
        {isToolsOpen && (
        <TabsList
          className="min-w-0 flex-1 border-0 bg-transparent p-0"
          data-testid="tool-tabs"
        >
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
        )}
      </div>

      <h3 className="text-base font-semibold text-foreground">Weekly Schedule</h3>

      <div className="ml-auto flex flex-wrap items-center gap-2">
        {/* Clear schedule destroys the schedule, so it belongs beside it.
            It reads as destructive rather than as a ghost: it was quiet
            enough that students could not find it, and a control nobody
            can find is not restraint. Outlined and red rather than solid —
            it is still the rare action on this row, and Export is still
            the common one. */}
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={currentSections.length === 0 || isClearing || isLoading}
          onClick={() => setIsConfirmingClear(true)}
          className="h-9 border-red-200 text-xs font-semibold text-red-700 hover:border-red-300 hover:bg-red-50 hover:text-red-800 disabled:border-border disabled:text-muted-foreground"
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

      {/* A section already in the plan has acquired an avoided professor on a
          refresh (ticket 49). Same family as the banner above it, same
          restraint: it names the section and changes nothing. It belongs out
          here with the global notices, not inside Capture — a student on
          Pick needs to see it too (ticket 46). */}
      <AvoidedProfessorNotice
        advisories={avoidedProfessorAdvisories}
        onOpenRanking={openRanking}
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
      {/* The professor ranking drill-down (ticket 49).
          Ranking is not a fourth tool acting on the grid — it is a place you
          go and come back from — so it takes the entire workspace width
          rather than displacing the grid, and ticket 46's rule that the grid
          sits in the same place on every *tab* survives untouched. */}
      {rankingCourseId !== null ? (
        <div
          data-testid="ranking-drilldown"
          data-course-id={rankingCourseId}
          className="w-full min-w-0"
        >
          <ProfessorRanking
            courseCode={rankingCourse?.code ?? `Course ${rankingCourseId}`}
            courseTitle={rankingCourse?.title ?? ""}
            entries={ranking.entries}
            sectionCodesById={ranking.sectionCodesById}
            isLoading={ranking.isLoading}
            isSaving={ranking.isSaving}
            error={ranking.error}
            onMove={ranking.move}
            onBack={closeRanking}
          />
        </div>
      ) : (
      /* One Tabs root spanning the bar and the columns: the strip lives in
         the bar, the panels in the column, and Radix requires them to share
         a root to stay wired together. */
      <Tabs
        value={activeTab}
        onValueChange={handleTabChange}
        className="space-y-6"
      >
      {renderWorkspaceBar()}

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
          <div
            /* `flex-1 min-h-0` is what actually makes the bound bite: without
               it the panels size to their content and overflow the panel
               instead of handing the overflow to the scroll region below. */
            className="flex min-h-0 flex-1 flex-col"
          >
            <div
              data-testid="tool-panel-scroll"
              ref={(node) => {
                toolScrollRef.current = node;
                if (node && savedToolScrollRef.current > 0) {
                  node.scrollTop = savedToolScrollRef.current;
                }
                if (node && savedWindowScrollRef.current > 0 && typeof window !== "undefined") {
                  window.scrollTo(0, savedWindowScrollRef.current);
                }
              }}
              className="min-h-0 flex-1 lg:overflow-y-auto lg:pr-1"
            >
            {/* Capture: the arrival surface. The way in, and what came in. */}
            <TabsContent value="capture" className="space-y-4">
              <CaptureBar
                render="controls"
                campusId={planSummary.campusId}
                sessionId={planSummary.sessionId}
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
                onRankProfessors={openRanking}
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
                preferenceSummary={preferenceSummary}
                onOpenPreferences={() => {
                  setActiveTab("capture");
                  setIsToolsOpen(true);
                }}
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
          </div>
        </div>
        )}
      </div>
      </Tabs>
      )}
    </div>
  );
}
