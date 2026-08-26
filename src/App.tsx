import { useState, useEffect } from "react";
import { LazyMotion, MotionConfig } from "motion/react";
import { AppHeader } from "./components/AppHeader";
import { PlanList } from "./components/PlanList";
import { CreatePlanDialog } from "./components/CreatePlanDialog";
import { PlanWorkspace } from "./components/PlanWorkspace";
import { AboutDialog } from "./components/AboutDialog";
import { ReportBrokenCaptureDialog } from "./components/ReportBrokenCaptureDialog";
import { OnboardingDialog } from "./components/OnboardingDialog";
import { UpdateNotice } from "./components/UpdateNotice";
import { usePlans } from "./components/usePlans";
import { useOptions } from "./components/useOptions";
import { usePlanDetail } from "./components/usePlanDetail";
import { openCaptureWindow, checkForUpdate } from "./adapters/ipc/client";
import { isOnboardingCompleted, setOnboardingCompleted } from "./core/onboarding";
import type { PlanSummary, UpdateCheck } from "./adapters/ipc/types";
import "./App.css";

export interface AppProps {
  initialUpdateCheck?: UpdateCheck | null;
}

/** The feature bundle, loaded lazily. See `src/lib/motionFeatures.ts`. */
const loadMotionFeatures = () => import("./lib/motionFeatures").then((mod) => mod.default);

function AppContent({ initialUpdateCheck }: AppProps) {
  const [isOnboardingOpen, setIsOnboardingOpen] = useState(() => !isOnboardingCompleted());
  const [activePlanSummary, setActivePlanSummary] = useState<PlanSummary | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // About and Report Diagnostics dialog states
  const [isAboutOpen, setIsAboutOpen] = useState(false);
  const [isReportOpen, setIsReportOpen] = useState(false);
  const [reportFailureError, setReportFailureError] = useState<string | null>(null);

  // Updater state
  const [updateCheck, setUpdateCheck] = useState<UpdateCheck | null>(
    () => initialUpdateCheck ?? null
  );
  const [isUpdateDismissed, setIsUpdateDismissed] = useState(false);

  // Startup check runs off the critical path without delaying first paint or blocking plans
  useEffect(() => {
    let active = true;
    checkForUpdate()
      .then((check) => {
        if (active) {
          setUpdateCheck(check);
        }
      })
      .catch(() => {
        // A failed check is quiet (SPEC §9, ADR-0017)
      });

    return () => {
      active = false;
    };
  }, []);

  const {
    plans,
    isLoading: isPlansLoading,
    error: plansError,
    fetchPlans,
    handleCreatePlan,
    handleDeletePlan,
  } = usePlans();

  const {
    campusOptions,
    sessionOptions,
  } = useOptions();

  // If a plan is active, fetch its details
  const {
    plan: activePlanDetail,
    isLoading: isPlanDetailLoading,
    error: planDetailError,
    refreshPlan,
  } = usePlanDetail(activePlanSummary?.id ?? "");

  const onOpenPlan = (plan: PlanSummary) => {
    setActivePlanSummary(plan);
  };

  const onBackToPlans = () => {
    setActivePlanSummary(null);
    fetchPlans();
  };

  const onHandleCreate = async (args: { name: string; campusId: number; sessionId: number }) => {
    setCreateError(null);
    try {
      const created = await handleCreatePlan(args);
      setIsCreateOpen(false);
      setActivePlanSummary(created);
    } catch (err: unknown) {
      if (typeof err === "string") {
        setCreateError(err);
      } else if (err instanceof Error) {
        setCreateError(err.message);
      } else {
        setCreateError("Failed to create plan");
      }
    }
  };

  const onHandleDeletePlan = async (planId: string) => {
    if (activePlanSummary?.id === planId) {
      setActivePlanSummary(null);
    }
    await handleDeletePlan(planId);
  };

  const handleOpenReport = (errorText?: string) => {
    setReportFailureError(errorText ?? null);
    setIsReportOpen(true);
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col font-sans">
      <AppHeader
        activePlan={activePlanSummary}
        onBackToPlans={onBackToPlans}
        onOpenAbout={() => setIsAboutOpen(true)}
        onOpenTour={() => setIsOnboardingOpen(true)}
      />

      <UpdateNotice
        updateCheck={updateCheck}
        dismissed={isUpdateDismissed}
        onOpenAbout={() => setIsAboutOpen(true)}
        onDismiss={() => setIsUpdateDismissed(true)}
      />

      {/* Keyed so switching between the two screens replays the entrance
          rather than cutting. One animated element, not one per card. */}
      <main key={activePlanSummary ? `plan-${activePlanSummary.id}` : "plans"} className="flex-1 screen-enter">
        {activePlanSummary ? (
          <PlanWorkspace
            planSummary={activePlanSummary}
            plan={activePlanDetail}
            isLoading={isPlanDetailLoading}
            error={planDetailError}
            onBack={onBackToPlans}
            onRetry={refreshPlan}
            onReportBrokenCapture={handleOpenReport}
            onPlanUpdated={() => {
              refreshPlan();
              fetchPlans();
            }}
          />
        ) : (
          <PlanList
            plans={plans}
            isLoading={isPlansLoading}
            error={plansError}
            onOpenCreate={() => {
              setCreateError(null);
              setIsCreateOpen(true);
            }}
            onOpenPlan={onOpenPlan}
            onDeletePlan={onHandleDeletePlan}
            onRetry={fetchPlans}
          />
        )}
      </main>

      <OnboardingDialog
        open={isOnboardingOpen}
        onOpenChange={setIsOnboardingOpen}
        campusOptions={campusOptions}
        sessionOptions={sessionOptions}
        onCreatePlan={handleCreatePlan}
        onOpenCapture={openCaptureWindow}
        onSelectPlan={(plan) => setActivePlanSummary(plan)}
        onComplete={() => setOnboardingCompleted()}
      />

      <CreatePlanDialog
        open={isCreateOpen}
        onOpenChange={(open) => {
          setIsCreateOpen(open);
          if (!open) {
            setCreateError(null);
          }
        }}
        campusOptions={campusOptions}
        sessionOptions={sessionOptions}
        error={createError}
        onSubmit={onHandleCreate}
      />

      <AboutDialog
        open={isAboutOpen}
        onOpenChange={setIsAboutOpen}
        onOpenReport={() => handleOpenReport()}
        initialUpdateCheck={updateCheck}
        onUpdateCheckChange={setUpdateCheck}
      />

      <ReportBrokenCaptureDialog
        open={isReportOpen}
        onOpenChange={setIsReportOpen}
        captureFailure={reportFailureError}
      />
    </div>
  );
}

export function App(props: AppProps) {
  return (
    /* The single reduced-motion pattern for everything `motion` drives; the
       CSS half lives at the bottom of App.css. `strict` makes a stray full
       `motion.*` component fail loudly instead of quietly pulling the whole
       feature set into the initial bundle. */
    <MotionConfig reducedMotion="user">
      <LazyMotion features={loadMotionFeatures} strict>
        <AppContent {...props} />
      </LazyMotion>
    </MotionConfig>
  );
}

export default App;
