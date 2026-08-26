import { Button } from "./ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "./ui/card";
import { Badge } from "./ui/badge";
import { Skeleton } from "./ui/skeleton";
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

/**
 * Placeholder cards in the shape of the plan cards that are coming, rather
 * than a spinner that describes nothing.
 */
function PlanCardSkeleton() {
  return (
    <div
      data-testid="plan-list-skeleton"
      className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3"
    >
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="rounded-panel border border-border bg-card p-panel space-y-4"
        >
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-3 w-1/3" />
          <div className="flex gap-2">
            <Skeleton className="h-5 w-20" />
            <Skeleton className="h-5 w-28" />
          </div>
          <Skeleton className="h-3 w-24" />
        </div>
      ))}
    </div>
  );
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
  const isEmpty = plans.length === 0 && !error && !isLoading;

  return (
    /* A rich surface: the plan list is where the student arrives, and it is
       not a working surface. `ambient-host` stays `position: relative` with
       `z-index: auto` so it creates no stacking context. */
    <div className="ambient-host min-h-[70vh]">
      <div data-testid="ambient-wash" aria-hidden="true" className="ambient-wash" />

      <div className="ambient-content mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {error && (
          <Alert variant="destructive" className="mb-6">
            <AlertTitle className="flex items-center justify-between">
              <span>Unable to load plans</span>
              <Button
                variant="outline"
                size="sm"
                onClick={onRetry}
                className="h-7 text-micro"
              >
                Retry
              </Button>
            </AlertTitle>
            <AlertDescription className="font-mono text-micro break-all mt-1">
              {error}
            </AlertDescription>
          </Alert>
        )}

        {isLoading && plans.length === 0 && !error ? (
          <div className="space-y-6">
            <div className="space-y-2">
              <Skeleton className="h-8 w-48" />
              <Skeleton className="h-4 w-96 max-w-full" />
            </div>
            <PlanCardSkeleton />
          </div>
        ) : isEmpty ? (
          /* The empty state earns its space: it names what a plan is, what it
             is scoped to, and the one action that starts one. It lost half its
             content when the sample-data path was removed, so it is set as a
             centred column rather than a card with a hole where the second
             option used to be. */
          <div className="mx-auto flex min-h-[440px] max-w-xl flex-col items-center justify-center rounded-panel border border-border bg-card px-8 py-14 text-center shadow-raised">
            <h2 className="text-3xl font-bold tracking-tight text-foreground">
              No saved plans yet
            </h2>
            <p className="mt-3 text-sm text-muted-foreground leading-relaxed">
              A plan is the artifact — a named set of sections, hard-scoped to
              one campus and academic session. Start one, then capture the
              courses you are looking at in Archer&#39;s Hub and the sections
              land here to pick from.
            </p>

            <Button onClick={onOpenCreate} className="mt-8 px-6">
              Create your first plan
            </Button>

            <p className="mt-4 text-micro text-muted-foreground">
              Nothing leaves your machine, and no credentials are stored.
            </p>
          </div>
        ) : (
          <div>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
              <div>
                <h2 className="text-2xl font-bold tracking-tight text-foreground">
                  Saved Plans
                </h2>
                <p className="text-sm text-muted-foreground">
                  Select a plan to manage sections, check conflicts, and solve schedules.
                </p>
              </div>
              <Button size="sm" onClick={onOpenCreate} className="text-xs">
                New Plan
              </Button>
            </div>

            {/* Repeated elements stay cheap: border colour on hover, no
                per-card shadow and no `transition-all`. */}
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {plans.map((plan) => (
                <Card
                  key={plan.id}
                  className="flex flex-col justify-between hover:border-slate-300 cursor-pointer group"
                  onClick={() => onOpenPlan(plan)}
                >
                  <CardHeader className="pb-3">
                    <CardTitle className="text-lg font-semibold text-foreground">
                      {plan.name}
                    </CardTitle>
                    <CardDescription className="text-micro">
                      Created {new Date(plan.createdAt).toLocaleDateString()}
                    </CardDescription>
                  </CardHeader>

                  <CardContent className="space-y-3 pb-3">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge variant="campus">{plan.campusName}</Badge>
                      <Badge variant="session">{plan.sessionName}</Badge>
                    </div>
                    <div className="text-sm font-medium text-muted-foreground">
                      {formatSectionCount(plan.sectionCount)}
                    </div>
                  </CardContent>

                  <CardFooter className="pt-3 border-t border-border flex items-center justify-between">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 px-2 text-micro text-red-600 hover:bg-red-50 hover:text-red-700"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeletePlan(plan.id);
                      }}
                    >
                      Delete
                    </Button>

                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 px-2 text-micro text-primary"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenPlan(plan);
                      }}
                    >
                      Open Plan
                    </Button>
                  </CardFooter>
                </Card>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
