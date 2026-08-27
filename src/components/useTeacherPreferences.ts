/**
 * Loading and writing teacher preferences (ticket 49).
 *
 * Two shapes of the same data: the whole catalog's preferences, which is
 * what the Solve panel summarises and what the advisory notice is computed
 * from; and one course's ranking, which is what the drill-down edits.
 *
 * The decisions — zones, renumbering, the summary, the advisory — all live
 * in `src/core/teacherRanking.ts`. This file is plumbing: fetch, hold, save.
 */

import { useCallback, useEffect, useState } from "react";

import * as client from "../adapters/ipc/client";
import type { RankableTeacher, Section, TeacherPreference } from "../adapters/ipc/types";
import { formatErrorMessage } from "../core/error";
import type { RankingEntry, RankingZone } from "../core/teacherRanking";
import { buildRankingList, moveTeacher, toPreferenceWrite } from "../core/teacherRanking";

export interface PreferenceScope {
  campusId: number;
  sessionId: number;
}

/**
 * Every captured course's preferences, keyed by course.
 *
 * One read per course, because preferences are stored per course and the
 * summary counts courses. A course whose read fails is left out rather than
 * failing the whole roll-up: a summary is worth having incomplete, and the
 * alternative is the Solve panel losing a line because one course did.
 */
export async function fetchPreferencesForCourses(
  scope: PreferenceScope,
  courseIds: readonly number[]
): Promise<Map<number, TeacherPreference[]>> {
  const byCourse = new Map<number, TeacherPreference[]>();
  await Promise.all(
    courseIds.map(async (courseId) => {
      try {
        byCourse.set(courseId, await client.getCoursePreferences({ ...scope, courseId }));
      } catch {
        // Left out, not zeroed: absent is honest, empty would be a claim.
      }
    })
  );
  return byCourse;
}

/** The catalog-wide view: what the Solve panel and the advisory notice read. */
export function useTeacherPreferences(
  scope: PreferenceScope,
  courseIds: number[],
  /**
   * Test seam. The suite renders to static markup, so no effect ever runs
   * and nothing would ever be loaded — the same reason the workspace takes
   * `initialTab`.
   */
  initialPreferencesByCourse?: Map<number, TeacherPreference[]>
) {
  const [preferencesByCourse, setPreferencesByCourse] = useState<
    Map<number, TeacherPreference[]>
  >(() => initialPreferencesByCourse ?? new Map());

  // `courseIds` is a fresh array on every render of the workspace, so the
  // effect keys on its contents rather than its identity.
  const courseKey = courseIds.join(",");

  const reload = useCallback(async () => {
    if (!scope.campusId || !scope.sessionId) {
      return;
    }
    const ids = courseKey === "" ? [] : courseKey.split(",").map(Number);
    setPreferencesByCourse(await fetchPreferencesForCourses(scope, ids));
  }, [scope.campusId, scope.sessionId, courseKey]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { preferencesByCourse, reloadPreferences: reload };
}

export interface CourseRanking {
  entries: RankingEntry[];
  /** Section codes for the ids a rankable teacher carries. */
  sectionCodesById: Record<number, string>;
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  move: (key: string, zone: RankingZone, index: number) => Promise<void>;
}

/**
 * One course's ranking, as the drill-down edits it.
 *
 * A move is applied locally first and then written: the numbers have to
 * renumber under the student's hand, not a round-trip later. The store's
 * answer is authoritative — it is what says which entries went inactive —
 * so the write's return replaces the local list.
 */
export function useCourseRanking(
  scope: PreferenceScope,
  courseId: number | null
): CourseRanking {
  const [entries, setEntries] = useState<RankingEntry[]>([]);
  const [sectionCodesById, setSectionCodesById] = useState<Record<number, string>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { campusId, sessionId } = scope;

  useEffect(() => {
    if (!courseId || !campusId || !sessionId) {
      setEntries([]);
      return;
    }
    let cancelled = false;
    const args = { campusId, sessionId, courseId };

    setIsLoading(true);
    setError(null);
    Promise.all([
      client.listRankableTeachers(args) as Promise<RankableTeacher[]>,
      client.getCoursePreferences(args) as Promise<TeacherPreference[]>,
      client.listCapturedSections(args) as Promise<Section[]>,
    ])
      .then(([rankable, preferences, sections]) => {
        if (cancelled) {
          return;
        }
        setEntries(buildRankingList(rankable, preferences));
        setSectionCodesById(
          Object.fromEntries(sections.map((section) => [section.sectionId, section.sectionCode]))
        );
      })
      .catch((err) => {
        if (!cancelled) {
          setError(formatErrorMessage(err));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [campusId, sessionId, courseId]);

  const move = useCallback(
    async (key: string, zone: RankingZone, index: number) => {
      if (!courseId) {
        return;
      }
      const next = moveTeacher(entries, key, zone, index);
      setEntries(next);
      setIsSaving(true);
      setError(null);
      try {
        const written = await client.writeCoursePreferences({
          campusId,
          sessionId,
          courseId,
          ...toPreferenceWrite(next),
        });
        // Rebuilt from the store's answer, which is what knows whether an
        // entry is still listed on the course's latest snapshots.
        setEntries((current) =>
          buildRankingList(
            current
              .filter((entry) => entry.active)
              .map((entry) => ({
                key: entry.key,
                displayName: entry.displayName,
                sectionIds: entry.sectionIds,
              })),
            written
          )
        );
      } catch (err) {
        setError(formatErrorMessage(err));
      } finally {
        setIsSaving(false);
      }
    },
    [campusId, sessionId, courseId, entries]
  );

  return { entries, sectionCodesById, isLoading, isSaving, error, move };
}
