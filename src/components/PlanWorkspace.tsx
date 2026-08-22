import {
  Building2,
  Calendar,
  AlertCircle,
  RefreshCw,
  Search,
  Sparkles,
  Layers,
  Clock,
} from "lucide-react";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "./ui/card";
import { Alert, AlertTitle, AlertDescription } from "./ui/alert";
import type { Plan, PlanSummary } from "../adapters/ipc/types";
import { formatSectionCount } from "../core/plan";

export interface PlanWorkspaceProps {
  planSummary: PlanSummary;
  plan: Plan | null;
  isLoading: boolean;
  error: string | null;
  onBack: () => void;
  onRetry: () => void;
}

export function PlanWorkspace({
  planSummary,
  plan,
  isLoading,
  error,
  onRetry,
}: PlanWorkspaceProps) {
  const currentSections = plan?.sections ?? [];

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

          <div className="flex items-center gap-4 text-sm text-slate-600 bg-slate-50 rounded-lg p-3 border border-slate-100">
            <div className="flex items-center gap-1.5">
              <Layers className="h-4 w-4 text-emerald-700" />
              <span className="font-semibold text-slate-900">
                {formatSectionCount(currentSections.length || planSummary.sectionCount)}
              </span>
            </div>
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

      {/* Entry Points & Workspace (SPEC §7, ADR-0014) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <Card className="hover:border-slate-300 transition-colors">
          <CardHeader>
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700 mb-2">
              <Search className="h-5 w-5" />
            </div>
            <CardTitle className="text-lg">Pick my own sections</CardTitle>
            <CardDescription>
              Browse captured courses and sections for {planSummary.campusName} • {planSummary.sessionName},
              preview ghosts on the week grid, and select sections manually.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" className="w-full sm:w-auto" disabled={isLoading}>
              Browse Sections
            </Button>
          </CardContent>
        </Card>

        <Card className="hover:border-slate-300 transition-colors">
          <CardHeader>
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-700 mb-2">
              <Sparkles className="h-5 w-5" />
            </div>
            <CardTitle className="text-lg">Let the solver build it</CardTitle>
            <CardDescription>
              Automatically solve conflict-free schedule combinations using ranking
              presets (fewest campus days, no early mornings, most online).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" className="w-full sm:w-auto" disabled={isLoading}>
              Solve Schedule
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Week Grid / Sections Area placeholder */}
      <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center">
        <p className="text-sm text-slate-500">
          Week grid and section browser will be wired here in upcoming tickets.
        </p>
      </div>
    </div>
  );
}
