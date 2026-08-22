import { ArrowLeft, Calendar, Building2, BookOpen } from "lucide-react";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import type { PlanSummary } from "../adapters/ipc/types";

export interface AppHeaderProps {
  activePlan: PlanSummary | null;
  onBackToPlans: () => void;
}

export function AppHeader({ activePlan, onBackToPlans }: AppHeaderProps) {
  return (
    <header className="sticky top-0 z-40 w-full border-b border-slate-200 bg-white/95 backdrop-blur-xs">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-4">
          {activePlan ? (
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={onBackToPlans}
                className="flex items-center gap-1.5 text-slate-600 hover:text-slate-900"
              >
                <ArrowLeft className="h-4 w-4" />
                <span>All Plans</span>
              </Button>
              <div className="h-5 w-px bg-slate-200" />
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-slate-900 text-base">
                    {activePlan.name}
                  </span>
                  {activePlan.isSample && (
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                      Sample
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <Badge variant="campus" className="flex items-center gap-1 text-[11px]">
                    <Building2 className="h-3 w-3" />
                    <span>{activePlan.campusName}</span>
                  </Badge>
                  <Badge variant="session" className="flex items-center gap-1 text-[11px]">
                    <Calendar className="h-3 w-3" />
                    <span>{activePlan.sessionName}</span>
                  </Badge>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-700 text-white font-bold shadow-xs">
                <BookOpen className="h-5 w-5" />
              </div>
              <div>
                <h1 className="text-lg font-bold tracking-tight text-slate-900 leading-tight">
                  Animo Plan
                </h1>
                <p className="text-xs text-slate-500">
                  Archer's Hub Enlistment Planner
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-400 font-medium">
            Read-only • No credentials stored
          </span>
        </div>
      </div>
    </header>
  );
}
