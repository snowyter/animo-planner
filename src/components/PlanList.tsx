import { Plus, Building2, Calendar, BookOpen, Trash2, ArrowRight, AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "./ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "./ui/card";
import { Badge } from "./ui/badge";
import { Alert, AlertTitle, AlertDescription } from "./ui/alert";
import type { PlanSummary } from "../adapters/ipc/types";
import { formatSectionCount } from "../core/plan";

export interface PlanListProps {
  plans: PlanSummary[];
  isLoading: boolean;
  error: string | null;
  onOpenCreate: () => void;
  onOpenPlan: (plan: PlanSummary) => void;
  onDeletePlan: (planId: string) => void;
  onRetry: () => void;
}

export function PlanList({
  plans,
  isLoading,
  error,
  onOpenCreate,
  onOpenPlan,
  onDeletePlan,
  onRetry,
}: PlanListProps) {
  if (isLoading && plans.length === 0) {
    return (
      <div className="flex min-h-[400px] flex-col items-center justify-center space-y-3">
        <RefreshCw className="h-8 w-8 animate-spin text-emerald-600" />
        <p className="text-sm text-slate-500 font-medium">Loading saved plans...</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      {error && (
        <Alert variant="destructive" className="mb-6">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle className="flex items-center justify-between">
            <span>Unable to load plans</span>
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

      {plans.length === 0 && !error ? (
        <div className="flex min-h-[440px] flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-200 bg-white p-8 text-center shadow-xs">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 text-emerald-700 mb-4">
            <BookOpen className="h-7 w-7" />
          </div>
          <h2 className="text-xl font-bold tracking-tight text-slate-900">
            No saved plans yet
          </h2>
          <p className="mt-2 max-w-md text-sm text-slate-500 leading-relaxed">
            Create your first schedule plan, scoped to your campus and academic
            session.
          </p>

          <div className="mt-6 flex flex-col sm:flex-row items-center gap-3">
            <Button onClick={onOpenCreate} className="w-full sm:w-auto shadow-sm">
              <Plus className="h-4 w-4 mr-1.5" />
              Create your first plan
            </Button>
          </div>
        </div>
      ) : (
        <div>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-slate-900">
                Saved Plans
              </h2>
              <p className="text-sm text-slate-500">
                Select a plan to manage sections, check conflicts, and solve schedules.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={onOpenCreate} className="text-xs shadow-sm">
                <Plus className="h-3.5 w-3.5 mr-1" />
                New Plan
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {plans.map((plan) => (
              <Card
                key={plan.id}
                className="flex flex-col justify-between transition-all hover:border-slate-300 hover:shadow-md cursor-pointer group"
                onClick={() => onOpenPlan(plan)}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-lg font-semibold text-slate-900 group-hover:text-emerald-700 transition-colors">
                      {plan.name}
                    </CardTitle>
                  </div>
                  <CardDescription className="text-xs text-slate-400">
                    Created {new Date(plan.createdAt).toLocaleDateString()}
                  </CardDescription>
                </CardHeader>

                <CardContent className="space-y-3 pb-3">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant="campus" className="flex items-center gap-1 text-xs">
                      <Building2 className="h-3 w-3" />
                      <span>{plan.campusName}</span>
                    </Badge>
                    <Badge variant="session" className="flex items-center gap-1 text-xs">
                      <Calendar className="h-3 w-3" />
                      <span>{plan.sessionName}</span>
                    </Badge>
                  </div>
                  <div className="text-sm font-medium text-slate-600">
                    {formatSectionCount(plan.sectionCount)}
                  </div>
                </CardContent>

                <CardFooter className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2 text-red-600 hover:bg-red-50 hover:text-red-700"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeletePlan(plan.id);
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-1" />
                    Delete
                  </Button>

                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2 text-emerald-700 group-hover:translate-x-0.5 transition-transform"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenPlan(plan);
                    }}
                  >
                    <span>Open Plan</span>
                    <ArrowRight className="h-3.5 w-3.5 ml-1" />
                  </Button>
                </CardFooter>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
