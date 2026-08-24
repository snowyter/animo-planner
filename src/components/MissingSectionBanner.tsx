/**
 * Persistent banner for sections in the plan that have gone missing.
 *
 * SPEC §5 (ADR-0008: Sections are never hard-deleted; missing sections
 * raise a persistent banner naming them and surface alternatives).
 */

import { AlertTriangle, Building2, Globe, Plus, Trash2, User, Users } from "lucide-react";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import type { MissingSection, PlanSection, ScheduleBlock, Section } from "../adapters/ipc/types";
import { formatTeacher, formatEnrolledCap } from "../core/section";
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
            className="rounded-xl border border-amber-300 bg-amber-50/80 p-5 shadow-xs"
          >
            <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <div className="flex h-7 w-7 items-center justify-center rounded-md bg-amber-100 text-amber-800 shrink-0">
                    <AlertTriangle className="h-4 w-4" />
                  </div>
                  <h4 className="text-base font-bold text-amber-950">
                    Section {courseCode} {missing.sectionCode} is missing from the catalog
                  </h4>
                </div>
                <p className="text-xs text-amber-900/90 pl-9">
                  This section was not found during refresh. Sections are never silently removed; it remains in your plan, but you can swap to an available alternative below.
                </p>
              </div>

              <div className="shrink-0 pl-9 md:pl-0">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => onRemoveMissingSection(missing.courseId, missing.sectionId)}
                  className="h-8 text-xs border-amber-300 text-amber-900 bg-white hover:bg-amber-100/50 flex items-center gap-1.5"
                >
                  <Trash2 className="h-3.5 w-3.5 text-amber-700" />
                  <span>Remove from plan</span>
                </Button>
              </div>
            </div>

            {/* Alternatives section */}
            <div className="mt-4 pt-4 border-t border-amber-200/70 pl-0 md:pl-9 space-y-3">
              <div className="text-xs font-semibold text-amber-950 uppercase tracking-wider">
                Available alternatives ({missing.alternatives.length}):
              </div>

              {missing.alternatives.length === 0 ? (
                <p className="text-xs text-amber-800 italic">
                  No other sections of {courseCode} are currently captured.
                </p>
              ) : (
                <div className="space-y-2.5">
                  {missing.alternatives.map((alt) => {
                    const teacherDisplay = formatTeacher(alt.latestSnapshot?.teacher);
                    const enrolledCapDisplay = formatEnrolledCap(
                      alt.latestSnapshot?.enrolled ?? 0,
                      alt.enrollCap
                    );

                    return (
                      <div
                        key={`alt-${alt.courseId}-${alt.sectionId}`}
                        className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-lg border border-amber-200 bg-white p-3 shadow-2xs"
                      >
                        <div className="space-y-1.5 min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-bold text-sm text-slate-900">
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
                              className="text-[10px]"
                            >
                              {alt.modality}
                            </Badge>
                            {alt.courseType && (
                              <span className="text-xs text-slate-500">• {alt.courseType}</span>
                            )}
                          </div>

                          {/* Meeting Blocks */}
                          <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-700">
                            {alt.blocks.map((block: ScheduleBlock, idx: number) => {
                              const isF2F = block.modality === "F2F";
                              return (
                                <div
                                  key={`alt-block-${block.day}-${block.startMin}-${idx}`}
                                  className="flex items-center gap-1 rounded bg-slate-50 border border-slate-200 px-2 py-0.5 text-[11px]"
                                >
                                  <span className="font-semibold text-slate-800">{block.day}</span>
                                  <span className="text-slate-400">•</span>
                                  <span className="font-mono">
                                    {formatMinutesToTime12(block.startMin)} –{" "}
                                    {formatMinutesToTime12(block.endMin)}
                                  </span>
                                  <span className="text-slate-400">•</span>
                                  {isF2F ? (
                                    <span className="flex items-center gap-0.5 text-emerald-700">
                                      <Building2 className="h-3 w-3" />
                                      <span>{block.location ?? "Room"}</span>
                                    </span>
                                  ) : (
                                    <span className="flex items-center gap-0.5 text-blue-700">
                                      <Globe className="h-3 w-3" />
                                      <span>Online</span>
                                    </span>
                                  )}
                                </div>
                              );
                            })}
                          </div>

                          {/* Teacher & Enrolled */}
                          <div className="flex flex-wrap items-center gap-x-3 text-xs text-slate-500">
                            <div className="flex items-center gap-1">
                              <User className="h-3 w-3 text-slate-400" />
                              <span>Teacher: <strong className="text-slate-700">{teacherDisplay}</strong></span>
                            </div>
                            <div className="flex items-center gap-1">
                              <Users className="h-3 w-3 text-slate-400" />
                              <span>Enrolled: <strong className="font-mono text-slate-700">{enrolledCapDisplay}</strong></span>
                            </div>
                          </div>
                        </div>

                        <div className="shrink-0">
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => onAddAlternative(alt)}
                            className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white flex items-center gap-1 shadow-xs"
                          >
                            <Plus className="h-3.5 w-3.5" />
                            <span>Add to Plan</span>
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
