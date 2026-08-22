import { useState } from "react";
import { AppHeader } from "./components/AppHeader";
import { PlanList } from "./components/PlanList";
import { CreatePlanDialog } from "./components/CreatePlanDialog";
import { PlanWorkspace } from "./components/PlanWorkspace";
import { usePlans } from "./components/usePlans";
import { useOptions } from "./components/useOptions";
import { usePlanDetail } from "./components/usePlanDetail";
import type { PlanSummary } from "./adapters/ipc/types";
import "./App.css";

function AppContent() {
  const [activePlanSummary, setActivePlanSummary] = useState<PlanSummary | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

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

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col font-sans">
      <AppHeader
        activePlan={activePlanSummary}
        onBackToPlans={onBackToPlans}
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
    </div>
  );
}

function App() {
  return <AppContent />;
}

export default App;
