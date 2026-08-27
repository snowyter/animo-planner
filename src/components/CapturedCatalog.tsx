/**
 * What has been captured (ticket 46).
 *
 * Capture is the arrival surface, and until now it only held the way in: a
 * counter, Refresh, and Open Archer's Hub. It says nothing about *what*
 * landed, so a student who searched eight courses had to switch to Pick and
 * scroll a dropdown to find out.
 *
 * It is also where the catalog is *managed*, not merely listed: a course is
 * included or excluded here, and forgotten here.
 *
 * The list is the same loaded catalog the Pick tab browses — one fetch, one
 * array, passed down. Ticket 32 fixed a fetch-on-mount in one place and a
 * local patch in another disagreeing about this exact data; this component
 * owns no state and issues no calls, so it cannot reintroduce that.
 *
 * A quiet surface: flat, high-contrast, still. No per-row shadow or
 * transition — a term's capture is dozens of these rows.
 */

import { Button } from "./ui/button";
import { Skeleton } from "./ui/skeleton";
import type { CapturedCourse } from "../adapters/ipc/types";
import { formatCatalogFreshness } from "../core/capture";

export interface CapturedCatalogProps {
  courses: CapturedCourse[];
  isLoading?: boolean;
  /** Now, injected so the freshness line is not a clock read at render time. */
  now?: Date;
  isMutating?: boolean;
  onBrowseCourse?: (courseId: number) => void;
  /**
   * Opens the teacher ranking for this course (ticket 49). It is entered
   * from here because this is where the per-course data already lives, and
   * where the teacher names come from.
   */
  onRankTeachers?: (courseId: number) => void;
  onSetIncluded?: (courseId: number, included: boolean) => void;
  onRemoveCourse?: (courseId: number) => void;
}

export function CapturedCatalog({
  courses,
  isLoading = false,
  now,
  isMutating = false,
  onBrowseCourse,
  onRankTeachers,
  onSetIncluded,
  onRemoveCourse,
}: CapturedCatalogProps) {
  const totalSections = courses.reduce((sum, c) => sum + c.sectionCount, 0);
  const includedCount = courses.filter((c) => c.included).length;

  return (
    <div
      data-testid="captured-catalog"
      className="rounded-panel border border-border bg-card p-4 space-y-3"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
        <h4 className="text-micro font-bold uppercase tracking-wider text-muted-foreground">
          What has been captured
        </h4>
        {courses.length > 0 && (
          <span className="text-xs text-muted-foreground tabular-nums">
            {courses.length} {courses.length === 1 ? "course" : "courses"} ·{" "}
            {totalSections} {totalSections === 1 ? "section" : "sections"}
          </span>
        )}
      </div>

      {/* The checkbox is explained once, here, rather than on every row.
          Searching a course and intending to take it are different acts, and
          the solver used to treat every search as a course it had to fill. */}
      {courses.length > 0 && onSetIncluded && (
        <p className="text-nano leading-relaxed text-muted-foreground">
          Checked courses are the ones the solver fills and the Pick tab
          browses — {includedCount} of {courses.length}. Unchecking keeps a
          course captured; it just stops asking to be scheduled.
        </p>
      )}

      {isLoading ? (
        <div className="space-y-2" data-testid="captured-catalog-skeleton">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : courses.length === 0 ? (
        <p
          data-testid="captured-catalog-empty"
          className="text-xs text-muted-foreground leading-relaxed"
        >
          Nothing has landed yet. Open Archer&#39;s Hub above, sign in, and
          search a course in Course Finder — its sections are captured silently
          as the results render, and they appear here.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {courses.map((course) => (
            <li
              key={course.courseId}
              data-testid={`captured-course-${course.courseId}`}
              data-included={course.included ? "true" : "false"}
              className={`flex items-start gap-2 rounded-card border border-border px-3 py-2 ${
                course.included ? "bg-muted/40" : "bg-muted/20"
              }`}
            >
              {onSetIncluded && (
                <input
                  type="checkbox"
                  data-testid={`include-course-${course.courseId}`}
                  checked={course.included}
                  disabled={isMutating}
                  onChange={(e) => onSetIncluded(course.courseId, e.target.checked)}
                  aria-label={`Include ${course.code} in the solver and the section picker`}
                  className="mt-0.5 h-4 w-4 shrink-0 rounded-control border-slate-300 text-primary"
                />
              )}

              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2 min-w-0">
                  <span
                    className={`text-xs font-bold ${
                      course.included ? "text-foreground" : "text-muted-foreground"
                    }`}
                  >
                    {course.code}
                  </span>
                  <span className="text-xs text-muted-foreground truncate">
                    {course.title}
                  </span>
                </div>
                <div className="text-nano text-muted-foreground mt-0.5">
                  {course.sectionCount}{" "}
                  {course.sectionCount === 1 ? "section" : "sections"} ·{" "}
                  {formatCatalogFreshness(course, now)}
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-0.5">
                {onBrowseCourse && course.included && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => onBrowseCourse(course.courseId)}
                    className="h-7 px-2 text-micro text-muted-foreground hover:text-foreground"
                    title={`Browse ${course.code} in the Pick tab`}
                  >
                    Browse
                  </Button>
                )}

                {onRankTeachers && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => onRankTeachers(course.courseId)}
                    className="h-7 px-2 text-micro text-muted-foreground hover:text-foreground"
                    data-testid={`rank-teachers-${course.courseId}`}
                    title={`Rank the teachers of ${course.code}`}
                  >
                    Teachers
                  </Button>
                )}

                {/* Forgetting is destructive and irreversible from here, so it
                    is a ghost control and the confirmation lives with the
                    caller, which knows what plans the removal would touch
                    (tickets 29, 35, 36). */}
                {onRemoveCourse && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={isMutating}
                    onClick={() => onRemoveCourse(course.courseId)}
                    className="h-7 px-2 text-micro text-muted-foreground hover:bg-red-50 hover:text-red-700"
                    data-testid={`forget-course-${course.courseId}`}
                    title={`Remove ${course.code} from the captured catalog`}
                  >
                    Remove
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
