import { ArrowLeft } from "lucide-react";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import type { PlanSummary } from "../adapters/ipc/types";

export interface AppHeaderProps {
  activePlan: PlanSummary | null;
  onBackToPlans: () => void;
  onOpenAbout?: () => void;
  onOpenTour?: () => void;
}

/**
 * The mark is the wordmark.
 *
 * "Animo Plan" set as type — display weight, tight tracking — and nothing
 * else. The green tile holding a stock `BookOpen` glyph that used to sign the
 * app was a placeholder for a logo and the least distinctive thing on screen.
 * The subtitle survives, subordinate rather than a second line of equal
 * weight. See `docs/design-system.md`.
 */
function Wordmark() {
  return (
    <div data-testid="wordmark" className="flex flex-col">
      <span className="text-wordmark text-foreground whitespace-nowrap">Animo Plan</span>
      <span className="text-micro text-muted-foreground mt-0.5">
        Archer&#39;s Hub Enlistment Planner
      </span>
    </div>
  );
}

export function AppHeader({
  activePlan,
  onBackToPlans,
  onOpenAbout,
  onOpenTour,
}: AppHeaderProps) {
  return (
    /* Opaque, not frosted. A blurred header repaints everything scrolling
       beneath it, which on the plan workspace is the week grid. */
    <header className="sticky top-0 z-40 w-full border-b border-border bg-card">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-4">
          {activePlan ? (
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={onBackToPlans}
                className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
              >
                {/* Direction is not something the words say. */}
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                <span>All Plans</span>
              </Button>
              <div className="h-5 w-px bg-border" />
              <div>
                <span className="font-semibold text-foreground text-base">
                  {activePlan.name}
                </span>
                <div className="flex items-center gap-2 mt-0.5">
                  <Badge variant="campus" className="text-micro">
                    {activePlan.campusName}
                  </Badge>
                  <Badge variant="session" className="text-micro">
                    {activePlan.sessionName}
                  </Badge>
                </div>
              </div>
            </div>
          ) : (
            <Wordmark />
          )}
        </div>

        <div className="flex items-center gap-3">
          {/* The app's trust claim (ADR-0001, ADR-0002), not decoration. */}
          <span className="hidden sm:inline text-micro text-muted-foreground">
            Read-only • No credentials stored
          </span>
          {onOpenTour && (
            <Button
              variant="outline"
              size="sm"
              onClick={onOpenTour}
              className="h-8 px-3 text-micro font-semibold"
              title="Replay tour"
            >
              Tour
            </Button>
          )}
          {onOpenAbout && (
            <Button
              variant="outline"
              size="sm"
              onClick={onOpenAbout}
              className="h-8 px-3 text-micro font-semibold"
            >
              About
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}
