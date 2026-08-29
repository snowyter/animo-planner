/**
 * Persistent banner for sections in the plan that have gone missing.
 *
 * SPEC §5 (ADR-0008: Sections are never hard-deleted; missing sections
 * raise a persistent banner naming them and surface alternatives).
 *
 * Ticket 33 — this reads as informative, not alarming. A section leaving the
 * catalog is information the student needs during enlistment week, and the
 * banner's job is to hand them the alternatives, not to sound an alarm. Amber,
 * a plain heading, and no warning glyph on the heading itself.
 */

/** Per-block modality is derived data that is displayed (ADR-0007). */
import { Building2, Globe } from "lucide-react";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import type { MissingSection, PlanSection, ScheduleBlock, Section } from "../adapters/ipc/types";
import { formatProfessor, formatEnrolledCap } from "../core/section";
import { formatMinutesToTime12 } from "../core/grid";

export interface MissingSectionBannerProps {
  missingSections: MissingSection[];
  planSections: PlanSection[];
  onAddAlternative: (section: Section) => void;
  onRemoveMissingSection: (courseId: number, sectionId: number) => void;
  className?: string;
}

export function MissingSectionBanner({
  missingSections,
  planSections,
  onAddAlternative,
  onRemoveMissingSection,
  className = "",
}: MissingSectionBannerProps) {
  if (missingSections.length === 0) {
    return null;
  }

  return (
    <div className={`space-y-4 ${className}`} data-testid="missing-section-banner">
      {missingSections.map((missing) => {
        const planSec = planSections.find(
          (s) => s.courseId === missing.courseId && s.sectionId === missing.sectionId
        );
        const courseCode = planSec?.courseCode ?? "Course";

        return (
          <div
            key={`missing-${missing.courseId}-${missing.sectionId}`}
            className="enter-rise rounded-panel border border-amber-300 bg-amber-50/80 p-panel"
          >
            <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
              <div className="space-y-1">
                <h4 className="text-base font-bold text-amber-950">
                  Section {courseCode} {missing.sectionCode} is missing from the catalog
                </h4>
                <p className="text-xs text-amber-900">
                  This section was not found during refresh. Sections are never silently removed; it remains in your plan, but you can swap to an available alternative below.
                </p>
              </div>

              <div className="shrink-0">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => onRemoveMissingSection(missing.courseId, missing.sectionId)}
                  className="h-8 text-xs border-amber-300 text-amber-900 hover:bg-amber-100/50"
                >
                  Remove from plan
                </Button>
              </div>
            </div>

            {/* Alternatives section */}
            <div className="mt-4 pt-4 border-t border-amber-200/70 space-y-3">
              <div className="text-micro font-semibold text-amber-950 uppercase tracking-wider">
                Available alternatives ({missing.alternatives.length}):
              </div>

              {missing.alternatives.length === 0 ? (
                <p className="text-xs text-amber-800 italic">
                  No other sections of {courseCode} are currently captured.
                </p>
              ) : (
                <div className="space-y-2.5">
                  {missing.alternatives.map((alt) => {
                    const professorDisplay = formatProfessor(alt.latestSnapshot?.professor);
                    const enrolledCapDisplay = formatEnrolledCap(
                      alt.latestSnapshot?.enrolled ?? 0,
                      alt.enrollCap
                    );

                    return (
                      <div
                        key={`alt-${alt.courseId}-${alt.sectionId}`}
                        className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-card border border-amber-200 bg-card p-3"
                      >
                        <div className="space-y-1.5 min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-bold text-sm text-foreground">
                              {alt.sectionCode}
                            </span>
                            <Badge
                              variant={
                                alt.modality === "ONLINE"
                                  ? "session"
                                  : alt.modality === "HYBRID"
                                  ? "secondary"
                                  : "campus"
                              }
                            >
                              {alt.modality}
                            </Badge>
                            {alt.courseType && (
                              <span className="text-xs text-muted-foreground">• {alt.courseType}</span>
                            )}
                          </div>

                          {/* Meeting Blocks */}
                          <div className="flex flex-wrap items-center gap-1.5 text-xs text-foreground">
                            {alt.blocks.map((block: ScheduleBlock, idx: number) => {
                              const isF2F = block.modality === "F2F";
                              return (
                                <div
                                  key={`alt-block-${block.day}-${block.startMin}-${idx}`}
                                  className="flex items-center gap-1 rounded-control bg-muted border border-border px-2 py-0.5 text-micro"
                                >
                                  <span className="font-semibold text-foreground">{block.day}</span>
                                  <span className="text-muted-foreground">•</span>
                                  <span className="font-mono">
                                    {formatMinutesToTime12(block.startMin)} –{" "}
                                    {formatMinutesToTime12(block.endMin)}
                                  </span>
                                  <span className="text-muted-foreground">•</span>
                                  {isF2F ? (
                                    <span className="flex items-center gap-0.5 text-emerald-800">
                                      <Building2 className="h-3 w-3" aria-hidden="true" />
                                      <span>{block.location ?? "Room"}</span>
                                    </span>
                                  ) : (
                                    <span className="flex items-center gap-0.5 text-blue-800">
                                      <Globe className="h-3 w-3" aria-hidden="true" />
                                      <span>Online</span>
                                    </span>
                                  )}
                                </div>
                              );
                            })}
                          </div>

                          {/* Professor & Enrolled */}
                          <div className="flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
                            <span>Professor: <strong className="text-foreground">{professorDisplay}</strong></span>
                            <span>Enrolled: <strong className="font-mono text-foreground">{enrolledCapDisplay}</strong></span>
                          </div>
                        </div>

                        <div className="shrink-0">
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => onAddAlternative(alt)}
                            className="h-8 text-xs"
                          >
                            Add to Plan
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
