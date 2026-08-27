import { beforeEach, describe, expect, it, vi } from "vitest";

import * as client from "../adapters/ipc/client";
import { fetchPreferencesForCourses } from "./useTeacherPreferences";
import type { TeacherPreference } from "../adapters/ipc/types";

vi.mock("../adapters/ipc/client", () => ({
  getCoursePreferences: vi.fn(),
  listRankableTeachers: vi.fn(),
  listCapturedSections: vi.fn(),
  writeCoursePreferences: vi.fn(),
}));

const preference = (teacherKey: string, fields: Partial<TeacherPreference> = {}): TeacherPreference => ({
  teacherKey,
  displayName: teacherKey,
  rank: null,
  avoid: false,
  active: true,
  ...fields,
});

describe("fetchPreferencesForCourses", () => {
  const scope = { campusId: 7, sessionId: 155 };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reads every course in the catalog and keys the answers by course", async () => {
    vi.mocked(client.getCoursePreferences).mockImplementation(async ({ courseId }) =>
      courseId === 2923 ? [preference("bryant lee", { avoid: true })] : []
    );

    const byCourse = await fetchPreferencesForCourses(scope, [2923, 3001]);

    expect(client.getCoursePreferences).toHaveBeenCalledTimes(2);
    expect(client.getCoursePreferences).toHaveBeenCalledWith({ ...scope, courseId: 2923 });
    expect(byCourse.get(2923)).toEqual([preference("bryant lee", { avoid: true })]);
    expect(byCourse.get(3001)).toEqual([]);
  });

  it("keeps the courses that answered when one course fails", async () => {
    vi.mocked(client.getCoursePreferences).mockImplementation(async ({ courseId }) => {
      if (courseId === 2923) {
        throw "unimplemented: get_course_preferences";
      }
      return [preference("nina cruz", { rank: 1 })];
    });

    const byCourse = await fetchPreferencesForCourses(scope, [2923, 3001]);

    expect(byCourse.has(2923)).toBe(false);
    expect(byCourse.get(3001)).toEqual([preference("nina cruz", { rank: 1 })]);
  });

  it("asks nothing of the store when the catalog is empty", async () => {
    const byCourse = await fetchPreferencesForCourses(scope, []);

    expect(client.getCoursePreferences).not.toHaveBeenCalled();
    expect(byCourse.size).toBe(0);
  });
});
