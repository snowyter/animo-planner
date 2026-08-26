import { useState, useEffect } from "react";
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
    handleSeedSample,
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

  const onHandleSeedSample = async () => {
    try {
      const sample = await handleSeedSample();
      setActivePlanSummary(sample);
    } catch {
      // Error is captured in usePlans.error
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
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col font-sans">
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

      <main className="flex-1">
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
            onSeedSample={onHandleSeedSample}
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
        onSeedSample={handleSeedSample}
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
  return <AppContent {...props} />;
}

export default App;
