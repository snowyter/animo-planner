/**
 * A section in the plan has acquired an avoided teacher (ticket 49).
 *
 * `Teacher` populates over the term — SPEC §2 saw it empty in 42 of 42
 * GEARTAP rows — so the common event is not a student choosing an avoided
 * section. It is a section they chose weeks ago acquiring a name on a
 * refresh. This says so, and does nothing else: nothing is removed, nothing
 * is re-solved (ADR-0009, and SPEC's "never discards existing choices").
 * Avoid filters what a solve *offers*; a section on the grid is the
 * student's own (ADR-0020).
 *
 * Modelled on `MissingSectionBanner` — the same family, the same restraint,
 * and the same refusal to look like an error. It lives with the global
 * notices, outside the tabs (ticket 46), because a student on Pick needs to
 * see it as much as one on Capture.
 */

import { Button } from "./ui/button";
import type { AvoidedTeacherAdvisory } from "../core/teacherRanking";
import { formatAvoidedTeacherAdvisory } from "../core/teacherRanking";

export interface AvoidedTeacherNoticeProps {
  advisories: AvoidedTeacherAdvisory[];
  /** Opens the course's ranking, which is the only thing there is to do. */
  onOpenRanking?: (courseId: number) => void;
}

export function AvoidedTeacherNotice({
  advisories,
  onOpenRanking,
}: AvoidedTeacherNoticeProps) {
  if (advisories.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3" data-testid="avoided-teacher-notice">
      {advisories.map((advisory) => {
        const copy = formatAvoidedTeacherAdvisory(advisory);
        return (
          <div
            key={`avoided-${advisory.courseId}-${advisory.sectionId}`}
            className="rounded-panel border border-amber-300 bg-amber-50/80 p-panel"
          >
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div className="space-y-1">
                <h4 className="text-base font-bold text-amber-950">{copy.title}</h4>
                <p className="text-xs leading-relaxed text-amber-900">
                  {copy.description}
                </p>
              </div>

              {onOpenRanking && (
                <div className="shrink-0">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => onOpenRanking(advisory.courseId)}
                    data-testid={`review-ranking-${advisory.courseId}`}
                    className="h-8 border-amber-300 bg-white text-xs text-amber-900 hover:bg-amber-100/50"
                  >
                    Review {advisory.courseCode} ranking
                  </Button>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
