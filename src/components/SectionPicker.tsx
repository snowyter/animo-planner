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
 *
 * Ticket 33 — a *working* surface, and the second-densest in the app after
 * the grid. It is treated as quiet: flat, high-contrast, still. The modality
 * glyphs stay because modality is derived data that is displayed (ADR-0007)
 * and hue is already spent on course identity (ADR-0012); every icon that sat
 * beside a word repeating it went. Repeated rows carry no transition and no
 * shadow — a 42-section course is 42 of these.
 */

import { useState, useEffect, useMemo } from "react";
import { Building2, Globe, AlertTriangle } from "lucide-react";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Card, CardHeader, CardTitle, CardContent } from "./ui/card";
import { Skeleton } from "./ui/skeleton";
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
  formatCandidateConflictLabel,
  groupSectionsForPicker,
} from "../core/section";
import { formatMinutesToTime12 } from "../core/grid";

export interface SectionPickerProps {
  courses: CapturedCourse[];
  selectedCourseId: number | null;
  sections: Section[];
  planSections: PlanSection[];
  planName?: string;
  isLoadingCourses?: boolean;
  isLoadingSections?: boolean;
  isMutating?: boolean;
  error?: string | null;
  notice?: string | null;
  initialConfirmingRemove?: boolean;
  onSelectCourse: (courseId: number) => void;
  onAddSection: (section: Section) => void;
  onRemoveSection: (section: Section) => void;
  onRemoveCourse?: (courseId: number) => void | Promise<void>;
  onTogglePin: (section: Section, pinned: boolean) => void;
  onHoverSection: (section: Section | null) => void;
  onDismissError?: () => void;
  onDismissNotice?: () => void;
  onClose?: () => void;
  /**
   * Which half to render. The chrome -- title, course selector, and the
   * selected-course banner -- sits full width above the workspace, while the
   * section list sits in a column beside the week grid so the two line up
   * row for row. `"all"` renders both, which is what a single-column
   * context wants.
   */
  render?: "all" | "chrome" | "list";
  /**
   * What actually scrolls around this picker (ticket 46).
   *
   * Two of the picker's decisions were made for a page that scrolled: the
   * course selector pins below the app header, and the section list bounds
   * itself so a 42-section course cannot push the week grid off screen. Both
   * are wrong inside a bounded tool panel, which is its own scroll container
   * — the header offset leaves the bar floating in a 64px gap, and the list's
   * own bound nests a second scrollbar inside the first.
   */
  scrollContext?: "page" | "panel";
  className?: string;
}

/**
 * The shape of the rows that are coming: identity line, block chips, and the
 * teacher/enrolment line. A spinner said none of that, and it was an animation
 * running at exactly the moment the machine was busiest.
 */
function SectionListSkeleton() {
  return (
    <div data-testid="section-list-skeleton" className="space-y-2">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="rounded-card border border-border bg-card p-3 space-y-2">
          <div className="flex items-center gap-2">
            <Skeleton className="h-5 w-16" />
            <Skeleton className="h-5 w-14" />
            <Skeleton className="ml-auto h-8 w-24" />
          </div>
          <div className="flex gap-1.5">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-5 w-40" />
          </div>
          <Skeleton className="h-3 w-56" />
        </div>
      ))}
    </div>
  );
}

export function SectionPicker({
  courses,
  selectedCourseId,
  sections,
  planSections,
  planName,
  isLoadingCourses = false,
  isLoadingSections = false,
  isMutating = false,
  error = null,
  notice = null,
  initialConfirmingRemove = false,
  render = "all",
  scrollContext = "page",
  onSelectCourse,
  onAddSection,
  onRemoveSection,
  onRemoveCourse,
  onTogglePin,
  onHoverSection,
  onDismissError,
  onDismissNotice,
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

  const affectedPlanSectionsCount = useMemo(() => {
    if (!selectedCourse) return 0;
    return planSections.filter((ps) => ps.courseId === selectedCourse.courseId).length;
  }, [selectedCourse, planSections]);

  const groupedSections = useMemo(() => {
    return groupSectionsForPicker(sections, planSections);
  }, [sections, planSections]);

  const renderSectionRow = (section: Section) => {
    const inPlan = isSectionInPlan(
      { courseId: section.courseId, sectionId: section.sectionId },
      planSections
    );
    const pinned =
      inPlan &&
      isSectionPinned(
        { courseId: section.courseId, sectionId: section.sectionId },
        planSections
      );
    const isMissing =
      inPlan &&
      planSections.some(
        (ps) =>
          ps.courseId === section.courseId &&
          ps.sectionId === section.sectionId &&
          ps.missing
      );
    const candidateConflicts = !inPlan
      ? findCandidateConflicts(section, planSections)
      : [];
    const conflictLabel = formatCandidateConflictLabel(
      section,
      candidateConflicts,
      planSections
    );
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
        className={`rounded-card border p-3 ${
          isMissing
            ? "border-amber-300 bg-amber-50/40"
            : inPlan
            ? "border-emerald-300 bg-emerald-50/40"
            : "border-border bg-card hover:border-slate-300"
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
            {/* Identity flows on the left; plan state and the controls that
                change it stack on the right, edge-aligned with each other.
                The status badges used to sit inline, so when the row wrapped
                they were left stranded mid-row while the buttons went right. */}
            <div className="flex flex-wrap items-start justify-between gap-x-2 gap-y-1.5">
              <div className="flex flex-wrap items-center gap-2 min-w-0">
                <span className="font-bold text-base text-foreground">
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
                  className="font-semibold"
                >
                  {section.modality}
                </Badge>

                {section.courseType && (
                  <span className="text-xs text-muted-foreground font-medium">
                    • {section.courseType}
                  </span>
                )}

                {section.credits !== null && section.credits !== undefined && (
                  <span className="text-xs text-muted-foreground font-medium">
                    • {section.credits} {section.credits === 1 ? "credit" : "credits"}
                  </span>
                )}
              </div>

              {/* On the identity row, which has spare width, rather than on a
                  row of its own: a separate action row cost about sixty
                  vertical pixels per card and roughly a third of what the list
                  could show at once. */}
              <div className="ml-auto flex shrink-0 flex-col items-end gap-1.5">
                {(inPlan || pinned || isMissing) && (
                  <div className="flex flex-wrap items-center justify-end gap-1.5">
                    {inPlan && <Badge variant="default">In Plan</Badge>}

                    {pinned && <Badge variant="secondary">Pinned</Badge>}

                    {isMissing && (
                      <Badge
                        variant="destructive"
                        className="bg-amber-100 text-amber-900 border border-amber-300"
                      >
                        Missing
                      </Badge>
                    )}
                  </div>
                )}

                <div className="flex items-center gap-1.5">
                  {inPlan ? (
                    <>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={isMutating}
                        onClick={() => onTogglePin(section, !pinned)}
                        className="h-8 text-xs"
                        title={pinned ? "Unpin section" : "Pin section"}
                      >
                        {pinned ? "Unpin" : "Pin"}
                      </Button>

                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={isMutating}
                        onClick={() => onRemoveSection(section)}
                        className="h-8 text-xs border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
                      >
                        Remove
                      </Button>
                    </>
                  ) : (
                    <Button
                      type="button"
                      variant="default"
                      size="sm"
                      disabled={isMutating}
                      onClick={() => onAddSection(section)}
                      className="h-8 text-xs"
                    >
                      Add to Plan
                    </Button>
                  )}
                </div>
              </div>
            </div>

            {/* The conflict indicator keeps its glyph: it is the one thing on
                this row that a student scans for, and ADR-0009 makes it
                information rather than chrome. It names the section it
                collides with, because that is the one the student would swap;
                a day count was a quantity they could not act on. */}
            {conflictLabel && !inPlan && (
              <div
                data-testid={`section-conflict-${section.sectionCode}`}
                className="flex items-center gap-1.5 rounded-control border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-900"
              >
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-700" aria-hidden="true" />
                <span className="min-w-0 truncate">{conflictLabel}</span>
              </div>
            )}

            {/* Row 2: Schedule Blocks */}
            <div className="flex flex-wrap items-center gap-1.5">
              {section.blocks.map((block: ScheduleBlock, idx: number) => {
                const isF2F = block.modality === "F2F";
                return (
                  <div
                    key={`${block.day}-${block.startMin}-${idx}`}
                    className="flex items-center gap-1.5 rounded-control border border-border bg-muted/60 px-2 py-0.5 text-xs font-medium text-foreground"
                  >
                    <span className="font-bold text-foreground">
                      {block.day}
                    </span>
                    <span className="text-muted-foreground">•</span>
                    <span className="font-mono text-micro text-muted-foreground whitespace-nowrap">
                      {formatMinutesToTime12(block.startMin)} –{" "}
                      {formatMinutesToTime12(block.endMin)}
                    </span>
                    <span className="text-muted-foreground">•</span>
                    {/* Modality is derived per block and displayed (ADR-0007).
                        A bare room code does not say "on campus", so these
                        glyphs carry information the words do not. */}
                    {isF2F ? (
                      <span className="flex items-center gap-1 text-emerald-800 font-semibold">
                        <Building2 className="h-3 w-3 shrink-0" aria-hidden="true" />
                        <span>{block.location ?? "Room"}</span>
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-blue-800 font-semibold">
                        <Globe className="h-3 w-3 shrink-0" aria-hidden="true" />
                        <span>Online</span>
                      </span>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Row 3: Teacher, Enrolled / Cap, Remark */}
            <div className="flex flex-wrap items-center gap-y-1 gap-x-4 text-xs text-muted-foreground">
              {/* Teacher: Blank teacher displays as Unknown (never absent or a dash) */}
              <span>
                Teacher:{" "}
                <span
                  className={`font-medium ${
                    teacherDisplay === "Unknown"
                      ? "text-muted-foreground italic"
                      : "text-foreground"
                  }`}
                >
                  {teacherDisplay}
                </span>
              </span>

              {/* Enrolled / Cap */}
              <span>
                Enrolled:{" "}
                <span className="font-mono font-semibold text-foreground">
                  {enrolledCapDisplay}
                </span>
              </span>

              {/* Remark: verbatim opaque display when present */}
              {remark && (
                <span className="truncate max-w-sm" title={remark}>
                  Remark: {remark}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <Card className={`w-full min-w-0 ${className}`}>
      {render !== "list" && (
      <CardHeader className={render === "chrome" ? "pb-4" : "border-b border-border pb-4"}>
        {/* A plain block stack, deliberately. This card lives in the picking
            column (roughly 380-440px) and nested flex rows kept collapsing the
            title and description to a few characters wide, because Tailwind
            breakpoints key off the viewport rather than the container. Block
            flow cannot collapse like that. */}
        <div className="space-y-3">
          <div className="flex items-start justify-between gap-2">
            <CardTitle className="text-lg font-bold text-foreground min-w-0">
              Pick my own sections
            </CardTitle>
            {onClose && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onClose}
                className="h-8 shrink-0 px-2 text-xs text-muted-foreground hover:text-foreground"
                title="Close section picker"
              >
                Close
              </Button>
            )}
          </div>

          <p className="text-xs text-muted-foreground">
            Browse captured sections course by course, preview ghosts on the week grid, and select sections manually.
          </p>

        </div>

        {/* Selected Course Header Banner */}
        {selectedCourse && (
          <div className="mt-3 flex flex-col items-start gap-2 rounded-card bg-muted/60 px-3 py-2 border border-border text-xs">
            <div className="flex items-center gap-2">
              <span className="font-bold text-foreground text-sm">
                {selectedCourse.code}
              </span>
              <span className="text-muted-foreground">— {selectedCourse.title}</span>
            </div>
            <div className="flex w-full flex-wrap items-center justify-between gap-2">
              <div className="text-muted-foreground font-medium">
                {sections.length} {sections.length === 1 ? "section available" : "sections available"}
              </div>
              {onRemoveCourse && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isMutating || isLoadingCourses || isLoadingSections}
                  onClick={() => setIsConfirmingRemove(true)}
                  className="h-7 px-2 text-xs border-red-200 text-red-700 hover:bg-red-50 hover:text-red-800 hover:border-red-300 shrink-0"
                  title={`Remove ${selectedCourse.code} from captured catalog`}
                  data-testid="remove-course-button"
                >
                  Remove course from catalog
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
                <DialogTitle className="text-base font-bold text-foreground">
                  Remove {selectedCourse.code} from catalog?
                </DialogTitle>
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
                  {affectedPlanSectionsCount > 0 && (
                    <>
                      <br />
                      <br />
                      <span className="text-amber-800 font-medium">
                        {planName ? `"${planName}"` : "Your plan"} will lose {affectedPlanSectionsCount}{" "}
                        {affectedPlanSectionsCount === 1 ? "section" : "sections"}.
                      </span>
                    </>
                  )}
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
                  className="h-8 text-xs"
                  data-testid="confirm-remove-course"
                >
                  Remove course
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </CardHeader>
      )}

      {render !== "chrome" && (
      <CardContent className="p-4 sm:p-5">
        {/* The course switcher, pinned.
            It used to live in the chrome half, which sits full width above
            both columns — so scrolling into a forty-section list put it off
            screen and changing course meant scrolling back to the top of the
            page. It belongs with the sections it selects.

            `top-16` clears the app header rather than sliding under it. The
            option text carries the course code, title, and section count, so
            the pinned bar answers "which course am I in" as well as "take me
            to another one" — which is why the visible label could go and an
            `aria-label` took its place. */}
        {courses.length > 0 && (
          <div
            className={`sticky ${
              scrollContext === "panel" ? "top-0" : "top-16"
            } z-20 -mx-4 mb-4 border-b border-border bg-card px-4 pb-3 pt-4 sm:-mx-5 sm:px-5 sm:pt-5 ${
              // Only pull up to the card's own top edge when nothing is
              // rendered above it; with the chrome present that would ride
              // over the header's rule.
              render === "list" ? "-mt-4 sm:-mt-5" : ""
            }`}
          >
            <select
              id="course-select"
              data-testid="course-select"
              aria-label="Course to browse sections for"
              value={selectedCourseId ?? ""}
              onChange={(e) => onSelectCourse(Number(e.target.value))}
              disabled={isLoadingCourses || isLoadingSections}
              className="h-9 w-full min-w-0 truncate rounded-control border border-input bg-card px-3 py-1 text-sm font-medium text-foreground"
            >
              {courses.map((c) => (
                <option key={c.courseId} value={c.courseId}>
                  {c.code} — {c.title} ({c.sectionCount} {c.sectionCount === 1 ? "section" : "sections"})
                </option>
              ))}
            </select>
          </div>
        )}

        {notice && (
          <div
            data-testid="picker-notice"
            className="mb-4 rounded-card border border-emerald-300 bg-emerald-50 p-3 text-xs text-emerald-900 flex items-start justify-between gap-2"
            role="status"
          >
            <div className="space-y-0.5">
              <span className="font-semibold block">Notice</span>
              <span>{notice}</span>
            </div>
            {onDismissNotice && (
              <button
                type="button"
                onClick={onDismissNotice}
                className="shrink-0 rounded-control px-1.5 font-semibold text-emerald-800 hover:bg-emerald-100"
              >
                Dismiss
              </button>
            )}
          </div>
        )}

        {error && (
          <div
            className="mb-4 rounded-card border border-red-200 bg-red-50 p-3 text-xs text-red-800 flex items-start justify-between gap-2"
            role="alert"
          >
            <div className="space-y-0.5">
              <span className="font-semibold block">Notice</span>
              <span className="font-mono">{error}</span>
            </div>
            {onDismissError && (
              <button
                type="button"
                onClick={onDismissError}
                className="shrink-0 rounded-control px-1.5 font-semibold text-red-700 hover:bg-red-100"
              >
                Dismiss
              </button>
            )}
          </div>
        )}


        {isLoadingCourses || isLoadingSections ? (
          <SectionListSkeleton />
        ) : courses.length === 0 ? (
          /* The one empty state a first-run student is most likely to see, so
             it names the whole path rather than describing the hole. */
          <div className="flex flex-col items-center justify-center px-4 py-12 text-center">
            <h3 className="text-lg font-semibold text-foreground">
              No captured courses
            </h3>
            <p className="mt-2 max-w-md text-sm text-muted-foreground leading-relaxed">
              Nothing has been captured for this campus and term yet. Tabs
              hide state, so this one says where the hole is: go to the{" "}
              <strong className="font-semibold text-foreground">Capture tab</strong>
              , press Open Archer&#39;s Hub, sign in, and search a course in
              Course Finder — its sections are captured silently as the
              results render, and they appear here.
            </p>
          </div>
        ) : sections.length === 0 ? (
          <div className="flex min-h-[160px] flex-col items-center justify-center px-4 py-8 text-center">
            <p className="text-sm font-semibold text-foreground">
              No sections captured for this course
            </p>
            <p className="mt-1.5 max-w-sm text-xs text-muted-foreground leading-relaxed">
              Search this course again in Course Finder to capture its sections,
              or pick a different course above.
            </p>
          </div>
        ) : (

          /* Bounded and scrolled in two-column mode so a 42-section course
             cannot push the week grid off screen. Stacked, the grid sits
             above the list, so the list is free to run on — and inside a
             tool panel the panel is already the bound (ticket 46). */
          <div
            data-testid="section-list"
            className={`space-y-2 ${
              scrollContext === "panel" ? "" : "lg:max-h-[700px] lg:overflow-y-auto lg:pr-1"
            }`}
          >
            {groupedSections.inPlan.map(renderSectionRow)}
            {groupedSections.inPlan.length > 0 && groupedSections.other.length > 0 && (
              <div
                data-testid="picker-group-divider"
                className="relative my-3 flex items-center justify-center border-t border-border pt-2 text-micro font-semibold uppercase tracking-wider text-muted-foreground"
              >
                <span className="bg-card px-2">Other sections in catalog</span>
              </div>
            )}
            {groupedSections.other.map(renderSectionRow)}
          </div>
        )}
      </CardContent>
      )}
    </Card>
  );
}
