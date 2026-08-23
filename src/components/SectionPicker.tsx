/**
 * SectionPicker component.
 *
 * SPEC §7, ADR-0007, ADR-0008, ADR-0009, ADR-0012, ADR-0014:
 * - Course-by-course browser listing every captured section for a course.
 * - Each row shows schedule blocks, per-block modality, room, teacher, and enrolled/cap.
 * - Blank teacher displays as "Unknown", never as absent or a dash.
 * - Remark displays verbatim when present.
 * - Hovering ghosts its blocks onto the week grid; leaving clears the ghost.
 * - Clicking adds the section to the plan at full weight.
 * - Sections with conflicts can still be added (adding is never blocked).
 * - Sections in the plan can be pinned/unpinned or removed.
 */

import { useMemo } from "react";
import {
  Building2,
  Globe,
  Plus,
  Trash2,
  Pin,
  PinOff,
  AlertTriangle,
  BookOpen,
  User,
  Users,
  MessageSquare,
  Check,
  Search,
} from "lucide-react";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Card, CardHeader, CardTitle, CardContent } from "./ui/card";
import type {
  CapturedCourse,
  PlanSection,
  ScheduleBlock,
  Section,
} from "../adapters/ipc/types";
import {
  formatTeacher,
  formatEnrolledCap,
  isSectionInPlan,
  isSectionPinned,
  findCandidateConflicts,
} from "../core/section";
import { formatMinutesToTime12 } from "../core/grid";

export interface SectionPickerProps {
  courses: CapturedCourse[];
  selectedCourseId: number | null;
  sections: Section[];
  planSections: PlanSection[];
  isLoadingCourses?: boolean;
  isLoadingSections?: boolean;
  isMutating?: boolean;
  error?: string | null;
  onSelectCourse: (courseId: number) => void;
  onAddSection: (section: Section) => void;
  onRemoveSection: (section: Section) => void;
  onTogglePin: (section: Section, pinned: boolean) => void;
  onHoverSection: (section: Section | null) => void;
  className?: string;
}

export function SectionPicker({
  courses,
  selectedCourseId,
  sections,
  planSections,
  isLoadingCourses = false,
  isLoadingSections = false,
  isMutating = false,
  error = null,
  onSelectCourse,
  onAddSection,
  onRemoveSection,
  onTogglePin,
  onHoverSection,
  className = "",
}: SectionPickerProps) {
  const selectedCourse = useMemo(() => {
    return courses.find((c) => c.courseId === selectedCourseId) ?? null;
  }, [courses, selectedCourseId]);

  return (
    <Card className={`border-slate-200 bg-white shadow-xs ${className}`}>
      <CardHeader className="border-b border-slate-100 pb-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <CardTitle className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <BookOpen className="h-5 w-5 text-emerald-700" />
              <span>Pick my own sections</span>
            </CardTitle>
            <p className="text-xs text-slate-500 mt-0.5">
              Browse captured sections course by course, preview ghosts on the week grid, and select sections manually.
            </p>

          </div>


          {/* Course Selector Dropdown / Switcher */}
          {courses.length > 0 && (
            <div className="flex items-center gap-2">
              <label
                htmlFor="course-select"
                className="text-xs font-semibold text-slate-600 uppercase tracking-wider shrink-0"
              >
                Course:
              </label>
              <select
                id="course-select"
                data-testid="course-select"
                value={selectedCourseId ?? ""}
                onChange={(e) => onSelectCourse(Number(e.target.value))}
                disabled={isLoadingCourses || isLoadingSections}
                className="h-9 rounded-md border border-slate-200 bg-white px-3 py-1 text-sm font-medium text-slate-900 shadow-xs focus:border-emerald-600 focus:outline-hidden focus:ring-1 focus:ring-emerald-600"
              >
                {courses.map((c) => (
                  <option key={c.courseId} value={c.courseId}>
                    {c.code} — {c.title} ({c.sectionCount} {c.sectionCount === 1 ? "section" : "sections"})
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Selected Course Header Banner */}
        {selectedCourse && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 border border-slate-100 text-xs">
            <div className="flex items-center gap-2">
              <span className="font-bold text-slate-900 text-sm">
                {selectedCourse.code}
              </span>
              <span className="text-slate-600">— {selectedCourse.title}</span>
            </div>
            <div className="text-slate-500 font-medium">
              {sections.length} {sections.length === 1 ? "section available" : "sections available"}
            </div>
          </div>
        )}
      </CardHeader>

      <CardContent className="p-4 sm:p-5">
        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
            {error}
          </div>
        )}

        {isLoadingCourses ? (
          <div className="flex min-h-[200px] flex-col items-center justify-center space-y-2 py-8 text-center text-slate-400">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-emerald-600 border-t-transparent" />
            <p className="text-xs">Loading captured courses...</p>
          </div>
        ) : courses.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-8 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400 mb-3">
              <Search className="h-6 w-6" />
            </div>
            <h3 className="text-base font-semibold text-slate-900">
              No captured courses
            </h3>
            <p className="mt-1 text-sm text-slate-500 max-w-md">
              No courses have been captured for this campus and term yet. Search
              courses in Course Finder to automatically capture them.
            </p>
          </div>
        ) : isLoadingSections ? (
          <div className="flex min-h-[200px] flex-col items-center justify-center space-y-2 py-8 text-center text-slate-400">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-emerald-600 border-t-transparent" />
            <p className="text-xs">Loading captured sections...</p>
          </div>
        ) : sections.length === 0 ? (
          <div className="flex min-h-[160px] flex-col items-center justify-center p-6 text-center text-slate-400">
            <p className="text-sm font-medium text-slate-600">
              No sections captured for this course
            </p>
          </div>
        ) : (

          <div className="space-y-3">
            {sections.map((section) => {
              const inPlan = isSectionInPlan(
                { courseId: section.courseId, sectionId: section.sectionId },
                planSections
              );
              const pinned = inPlan && isSectionPinned(
                { courseId: section.courseId, sectionId: section.sectionId },
                planSections
              );
              const candidateConflicts = !inPlan
                ? findCandidateConflicts(section, planSections)
                : [];
              const hasConflict = candidateConflicts.length > 0;
              const teacherDisplay = formatTeacher(
                section.latestSnapshot?.teacher
              );
              const enrolledCapDisplay = formatEnrolledCap(
                section.latestSnapshot?.enrolled ?? 0,
                section.enrollCap
              );
              const remark = section.latestSnapshot?.remark;

              return (
                <div
                  key={`${section.courseId}-${section.sectionId}`}
                  data-testid={`section-row-${section.sectionCode}`}
                  data-in-plan={inPlan ? "true" : "false"}
                  data-pinned={pinned ? "true" : "false"}
                  onMouseEnter={() => onHoverSection(section)}
                  onMouseLeave={() => onHoverSection(null)}
                  onFocus={() => onHoverSection(section)}
                  onBlur={() => onHoverSection(null)}
                  className={`rounded-xl border transition-all duration-150 p-4 ${
                    inPlan
                      ? "border-emerald-200 bg-emerald-50/40 shadow-xs"
                      : "border-slate-200 bg-white hover:border-slate-300 hover:shadow-xs"
                  }`}
                >
                  <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                    {/* Left: Identity, Modality, Blocks, Details */}
                    <div className="space-y-2.5 flex-1 min-w-0">
                      {/* Row 1: Section Code, Modality, Type, Credits, In-Plan / Conflict Badges */}
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-bold text-base text-slate-900">
                          {section.sectionCode}
                        </span>

                        <Badge
                          variant={
                            section.modality === "ONLINE"
                              ? "session"
                              : section.modality === "HYBRID"
                              ? "secondary"
                              : "campus"
                          }
                          className="text-[11px] font-semibold"
                        >
                          {section.modality}
                        </Badge>

                        {section.courseType && (
                          <span className="text-xs text-slate-500 font-medium">
                            • {section.courseType}
                          </span>
                        )}

                        {section.credits !== null && section.credits !== undefined && (
                          <span className="text-xs text-slate-500 font-medium">
                            • {section.credits} {section.credits === 1 ? "credit" : "credits"}
                          </span>
                        )}

                        {inPlan && (
                          <Badge
                            variant="default"
                            className="bg-emerald-600 text-white flex items-center gap-1 text-[11px]"
                          >
                            <Check className="h-3 w-3" />
                            <span>In Plan</span>
                          </Badge>
                        )}

                        {pinned && (
                          <Badge
                            variant="secondary"
                            className="bg-slate-200 text-slate-800 flex items-center gap-1 text-[11px]"
                          >
                            <Pin className="h-3 w-3" />
                            <span>Pinned</span>
                          </Badge>
                        )}

                        {hasConflict && !inPlan && (
                          <Badge
                            variant="destructive"
                            className="bg-amber-100 text-amber-800 border border-amber-300 flex items-center gap-1 text-[11px]"
                          >
                            <AlertTriangle className="h-3 w-3 text-amber-600" />
                            <span>
                              Conflict ({candidateConflicts.length}{" "}
                              {candidateConflicts.length === 1 ? "day" : "days"})
                            </span>
                          </Badge>
                        )}
                      </div>

                      {/* Row 2: Schedule Blocks */}
                      <div className="flex flex-wrap items-center gap-2">
                        {section.blocks.map((block: ScheduleBlock, idx: number) => {
                          const isF2F = block.modality === "F2F";
                          return (
                            <div
                              key={`${block.day}-${block.startMin}-${idx}`}
                              className="flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50/80 px-2.5 py-1 text-xs font-medium text-slate-800"
                            >
                              <span className="font-bold text-slate-900">
                                {block.day}
                              </span>
                              <span className="text-slate-400">•</span>
                              <span className="font-mono text-[11px] text-slate-700">
                                {formatMinutesToTime12(block.startMin)} –{" "}
                                {formatMinutesToTime12(block.endMin)}
                              </span>
                              <span className="text-slate-400">•</span>
                              {isF2F ? (
                                <span className="flex items-center gap-1 text-emerald-700 font-semibold">
                                  <Building2 className="h-3 w-3 shrink-0" />
                                  <span>{block.location ?? "Room"}</span>
                                </span>
                              ) : (
                                <span className="flex items-center gap-1 text-blue-700 font-semibold">
                                  <Globe className="h-3 w-3 shrink-0" />
                                  <span>Online</span>
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>

                      {/* Row 3: Teacher, Enrolled / Cap, Remark */}
                      <div className="flex flex-wrap items-center gap-y-1 gap-x-4 text-xs text-slate-600">
                        {/* Teacher: Blank teacher displays as Unknown (never absent or a dash) */}
                        <div className="flex items-center gap-1.5">
                          <User className="h-3.5 w-3.5 text-slate-400" />
                          <span>
                            Teacher:{" "}
                            <span
                              className={`font-medium ${
                                teacherDisplay === "Unknown"
                                  ? "text-slate-500 italic"
                                  : "text-slate-900"
                              }`}
                            >
                              {teacherDisplay}
                            </span>
                          </span>
                        </div>

                        {/* Enrolled / Cap */}
                        <div className="flex items-center gap-1.5">
                          <Users className="h-3.5 w-3.5 text-slate-400" />
                          <span>
                            Enrolled:{" "}
                            <span className="font-mono font-semibold text-slate-900">
                              {enrolledCapDisplay}
                            </span>
                          </span>
                        </div>

                        {/* Remark: verbatim opaque display when present */}
                        {remark && (
                          <div className="flex items-center gap-1.5 text-slate-500">
                            <MessageSquare className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                            <span className="truncate max-w-sm" title={remark}>
                              {remark}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Right: Actions */}
                    <div className="flex items-center gap-2 shrink-0 pt-2 lg:pt-0 border-t lg:border-t-0 border-slate-100">
                      {inPlan ? (
                        <>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={isMutating}
                            onClick={() => onTogglePin(section, !pinned)}
                            className="h-8 text-xs flex items-center gap-1"
                            title={pinned ? "Unpin section" : "Pin section"}
                          >
                            {pinned ? (
                              <>
                                <PinOff className="h-3.5 w-3.5 text-slate-500" />
                                <span>Unpin</span>
                              </>
                            ) : (
                              <>
                                <Pin className="h-3.5 w-3.5 text-slate-500" />
                                <span>Pin</span>
                              </>
                            )}
                          </Button>

                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={isMutating}
                            onClick={() => onRemoveSection(section)}
                            className="h-8 text-xs border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700 flex items-center gap-1"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            <span>Remove</span>
                          </Button>
                        </>
                      ) : (
                        <Button
                          type="button"
                          variant="default"
                          size="sm"
                          disabled={isMutating}
                          onClick={() => onAddSection(section)}
                          className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white flex items-center gap-1 shadow-xs"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          <span>Add to Plan</span>
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
