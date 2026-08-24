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

import { useState, useEffect, useMemo } from "react";
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
  X,
} from "lucide-react";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Card, CardHeader, CardTitle, CardContent } from "./ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "./ui/dialog";
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
  initialConfirmingRemove?: boolean;
  onSelectCourse: (courseId: number) => void;
  onAddSection: (section: Section) => void;
  onRemoveSection: (section: Section) => void;
  onRemoveCourse?: (courseId: number) => void | Promise<void>;
  onTogglePin: (section: Section, pinned: boolean) => void;
  onHoverSection: (section: Section | null) => void;
  onDismissError?: () => void;
  onClose?: () => void;
  /**
   * Which half to render. The chrome -- title, course selector, and the
   * selected-course banner -- sits full width above the workspace, while the
   * section list sits in a column beside the week grid so the two line up
   * row for row. `"all"` renders both, which is what a single-column
   * context wants.
   */
  render?: "all" | "chrome" | "list";
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
  initialConfirmingRemove = false,
  render = "all",
  onSelectCourse,
  onAddSection,
  onRemoveSection,
  onRemoveCourse,
  onTogglePin,
  onHoverSection,
  onDismissError,
  onClose,
  className = "",
}: SectionPickerProps) {
  const [isConfirmingRemove, setIsConfirmingRemove] = useState<boolean>(
    () => initialConfirmingRemove
  );

  useEffect(() => {
    setIsConfirmingRemove(false);
  }, [selectedCourseId]);

  const selectedCourse = useMemo(() => {
    return courses.find((c) => c.courseId === selectedCourseId) ?? null;
  }, [courses, selectedCourseId]);

  return (
    <Card className={`w-full min-w-0 border-slate-200 bg-white shadow-xs ${className}`}>
      {render !== "list" && (
      <CardHeader className={render === "chrome" ? "pb-4" : "border-b border-slate-100 pb-4"}>
        {/* A plain block stack, deliberately. This card lives in the picking
            column (roughly 380-440px) and nested flex rows kept collapsing the
            title and description to a few characters wide, because Tailwind
            breakpoints key off the viewport rather than the container. Block
            flow cannot collapse like that. */}
        <div className="space-y-3">
          <div className="flex items-start justify-between gap-2">
            <CardTitle className="text-lg font-bold text-slate-900 flex items-center gap-2 min-w-0">
              <BookOpen className="h-5 w-5 text-emerald-700 shrink-0" />
              <span>Pick my own sections</span>
            </CardTitle>
            {onClose && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onClose}
                className="h-8 shrink-0 px-2 text-xs text-slate-500 hover:text-slate-900"
                title="Close section picker"
              >
                <X className="h-4 w-4 mr-1" />
                <span>Close</span>
              </Button>
            )}
          </div>

          <p className="text-xs text-slate-500">
            Browse captured sections course by course, preview ghosts on the week grid, and select sections manually.
          </p>

          {/* Label above the control, not beside it: a "Course:" label sharing
              a row with the select left the select too narrow to read a course
              title in. */}
          {courses.length > 0 && (
            <div className="space-y-1">
              <label
                htmlFor="course-select"
                className="block text-xs font-semibold text-slate-600 uppercase tracking-wider"
              >
                Course
              </label>
              <select
                id="course-select"
                data-testid="course-select"
                value={selectedCourseId ?? ""}
                onChange={(e) => onSelectCourse(Number(e.target.value))}
                disabled={isLoadingCourses || isLoadingSections}
                className="h-9 w-full min-w-0 truncate rounded-md border border-slate-200 bg-white px-3 py-1 text-sm font-medium text-slate-900 shadow-xs focus:border-emerald-600 focus:outline-hidden focus:ring-1 focus:ring-emerald-600"
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
          <div className="mt-3 flex flex-col items-start gap-2 rounded-lg bg-slate-50 px-3 py-2 border border-slate-100 text-xs">
            <div className="flex items-center gap-2">
              <span className="font-bold text-slate-900 text-sm">
                {selectedCourse.code}
              </span>
              <span className="text-slate-600">— {selectedCourse.title}</span>
            </div>
            <div className="flex w-full flex-wrap items-center justify-between gap-2">
              <div className="text-slate-500 font-medium">
                {sections.length} {sections.length === 1 ? "section available" : "sections available"}
              </div>
              {onRemoveCourse && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isMutating || isLoadingCourses || isLoadingSections}
                  onClick={() => setIsConfirmingRemove(true)}
                  className="h-7 px-2 text-xs border-red-200 text-red-700 hover:bg-red-50 hover:text-red-800 hover:border-red-300 flex items-center gap-1 shrink-0"
                  title={`Remove ${selectedCourse.code} from captured catalog`}
                  data-testid="remove-course-button"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>Remove course from catalog</span>
                </Button>
              )}
            </div>
          </div>
        )}
        {/* Confirmation dialog, beside the button that opens it: it lived in
           the list half while its trigger lived here, so the chrome-only
           render set the state with no dialog mounted to show. */}
        {selectedCourse && (
          <Dialog
            open={isConfirmingRemove}
            onOpenChange={setIsConfirmingRemove}
          >
            <DialogContent className="max-w-md p-6" data-testid="remove-course-dialog">
              <DialogHeader className="space-y-2 text-left">
                <div className="flex items-center gap-2 text-red-600">
                  <AlertTriangle className="h-5 w-5 shrink-0" />
                  <DialogTitle className="text-base font-bold text-slate-900">
                    Remove {selectedCourse.code} from catalog?
                  </DialogTitle>
                </div>
                <DialogDescription className="text-xs text-slate-600 leading-relaxed">
                  This will remove{" "}
                  <strong className="text-slate-900 font-semibold">
                    {selectedCourse.code} ({selectedCourse.title})
                  </strong>{" "}
                  and its{" "}
                  <strong className="text-slate-900 font-semibold">
                    {selectedCourse.sectionCount}{" "}
                    {selectedCourse.sectionCount === 1 ? "captured section" : "captured sections"}
                  </strong>{" "}
                  from your local database.
                  <br />
                  <br />
                  This action is destructive and removes captured sections from your catalog.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter className="flex flex-row items-center justify-end gap-2 pt-4 border-t border-slate-100">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={isMutating}
                  onClick={() => setIsConfirmingRemove(false)}
                  className="h-8 text-xs text-slate-600 hover:text-slate-900"
                  data-testid="cancel-remove-course"
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  disabled={isMutating}
                  onClick={async () => {
                    try {
                      await onRemoveCourse?.(selectedCourse.courseId);
                      setIsConfirmingRemove(false);
                    } catch {
                      setIsConfirmingRemove(false);
                    }
                  }}
                  className="h-8 text-xs bg-red-600 hover:bg-red-700 text-white flex items-center gap-1"
                  data-testid="confirm-remove-course"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>Remove course</span>
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </CardHeader>
      )}

      {render !== "chrome" && (
      <CardContent className="p-4 sm:p-5">
        {error && (
          <div
            className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700 flex items-start justify-between gap-2"
            role="alert"
          >
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
              <div className="space-y-0.5">
                <span className="font-semibold block">Notice</span>
                <span className="font-mono">{error}</span>
              </div>
            </div>
            {onDismissError && (
              <button
                type="button"
                onClick={onDismissError}
                className="text-red-500 hover:text-red-700 p-0.5 rounded-sm"
                aria-label="Dismiss notice"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
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

          /* Bounded and scrolled in two-column mode so a 42-section course
             cannot push the week grid off screen. Stacked, the grid sits
             above the list, so the list is free to run on. */
          <div
            data-testid="section-list"
            className="space-y-2 lg:max-h-[700px] lg:overflow-y-auto lg:pr-1"
          >
            {sections.map((section) => {
              const inPlan = isSectionInPlan(
                { courseId: section.courseId, sectionId: section.sectionId },
                planSections
              );
              const pinned = inPlan && isSectionPinned(
                { courseId: section.courseId, sectionId: section.sectionId },
                planSections
              );
              const isMissing = inPlan && planSections.some(
                (ps) => ps.courseId === section.courseId && ps.sectionId === section.sectionId && ps.missing
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
                  data-missing={isMissing ? "true" : "false"}
                  onMouseEnter={() => onHoverSection(section)}
                  onMouseLeave={() => onHoverSection(null)}
                  onFocus={() => onHoverSection(section)}
                  onBlur={() => onHoverSection(null)}
                  className={`rounded-xl border transition-all duration-150 p-3 ${
                    isMissing
                      ? "border-amber-300 bg-amber-50/40 shadow-xs"
                      : inPlan
                      ? "border-emerald-200 bg-emerald-50/40 shadow-xs"
                      : "border-slate-200 bg-white hover:border-slate-300 hover:shadow-xs"
                  }`}
                >
                  {/* Always stacked. This card sits in the picking column,
                      roughly 380-440px wide, and Tailwind's `lg:` keys off the
                      viewport -- so going horizontal here squeezed the schedule
                      blocks until "9:15 AM - 10:45 AM" broke across lines. */}
                  <div className="flex flex-col gap-2">
                    {/* Left: Identity, Modality, Blocks, Details */}
                    <div className="space-y-1.5 flex-1 min-w-0">
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

                        {isMissing && (
                          <Badge
                            variant="destructive"
                            className="bg-amber-100 text-amber-900 border border-amber-300 flex items-center gap-1 text-[11px]"
                          >
                            <AlertTriangle className="h-3 w-3 text-amber-700" />
                            <span>Missing</span>
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

                        {/* On the identity row, which has spare width, rather
                            than on a row of its own: a separate action row cost
                            about sixty vertical pixels per card and roughly a
                            third of what the list could show at once. */}
                  <div className="ml-auto flex shrink-0 items-center gap-1.5">
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

                      {/* Row 2: Schedule Blocks */}
                      <div className="flex flex-wrap items-center gap-1.5">
                        {section.blocks.map((block: ScheduleBlock, idx: number) => {
                          const isF2F = block.modality === "F2F";
                          return (
                            <div
                              key={`${block.day}-${block.startMin}-${idx}`}
                              className="flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50/80 px-2 py-0.5 text-xs font-medium text-slate-800"
                            >
                              <span className="font-bold text-slate-900">
                                {block.day}
                              </span>
                              <span className="text-slate-400">•</span>
                              <span className="font-mono text-[11px] text-slate-700 whitespace-nowrap">
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

                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
      )}
    </Card>
  );
}
