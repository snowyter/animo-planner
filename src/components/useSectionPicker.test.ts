import { describe, expect, it, vi, beforeEach } from "vitest";
import * as client from "../adapters/ipc/client";
import { useSectionPickerState } from "./useSectionPicker";
import type { CapturedCourse, Plan, Section } from "../adapters/ipc/types";

vi.mock("../adapters/ipc/client");

describe("useSectionPickerState", () => {
  const mockCourses: CapturedCourse[] = [
    {
      courseId: 2923,
      code: "GEARTAP",
      title: "Art Appreciation",
      sectionCount: 42,
      firstSeenAt: "2026-08-22T00:00:00Z",
      lastSeenAt: "2026-08-22T00:00:00Z",
    },
    {
      courseId: 564,
      code: "CSINTSY",
      title: "Intro to Intelligent Systems",
      sectionCount: 5,
      firstSeenAt: "2026-08-22T00:00:00Z",
      lastSeenAt: "2026-08-22T00:00:00Z",
    },
  ];

  const mockGeartapSections: Section[] = [
    {
      campusId: 7,
      sessionId: 155,
      courseId: 2923,
      courseCode: "GEARTAP",
      courseTitle: "Art Appreciation",
      sectionId: 384,
      sectionCode: "S11",
      courseType: "Lecture",
      credits: 3,
      enrollCap: 45,
      startDate: "2026-07-10",
      endDate: "2026-12-09",
      firstSeenAt: "2026-08-22T00:00:00Z",
      lastSeenAt: "2026-08-22T00:00:00Z",
      modality: "HYBRID",
      blocks: [
        {
          day: "TUE",
          startMin: 870,
          endMin: 960,
          modality: "F2F",
          location: "L226",
        },
        {
          day: "FRI",
          startMin: 870,
          endMin: 960,
          modality: "ONLINE",
          location: null,
        },
      ],
      latestSnapshot: {
        capturedAt: "2026-08-22T00:00:00Z",
        enrolled: 42,
        teacher: null,
        remark: null,
      },
    },
  ];

  const mockPlan: Plan = {
    id: "p1",
    name: "T1 load",
    campusId: 7,
    campusName: "Manila",
    sessionId: 155,
    sessionName: "AY2026-27 T1",
    createdAt: "2026-08-22T00:00:00Z",
    sectionCount: 1,
    isSample: false,
    sections: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads captured courses and automatically selects the first course", async () => {
    vi.mocked(client.listCapturedCourses).mockResolvedValue(mockCourses);
    vi.mocked(client.listCapturedSections).mockResolvedValue(mockGeartapSections);

    const state = useSectionPickerState({
      campusId: 7,
      sessionId: 155,
      planId: "p1",
    });

    await state.fetchCourses();

    expect(client.listCapturedCourses).toHaveBeenCalledWith({
      campusId: 7,
      sessionId: 155,
    });
    expect(state.courses).toEqual(mockCourses);
    expect(state.selectedCourseId).toBe(2923);
    expect(state.sections).toEqual(mockGeartapSections);
    expect(state.error).toBeNull();
  });

  it("handles course selection and loads its sections", async () => {
    vi.mocked(client.listCapturedCourses).mockResolvedValue(mockCourses);
    vi.mocked(client.listCapturedSections).mockResolvedValue([]);

    const state = useSectionPickerState({
      campusId: 7,
      sessionId: 155,
      planId: "p1",
    });

    await state.fetchCourses();
    await state.selectCourse(564);

    expect(client.listCapturedSections).toHaveBeenCalledWith({
      campusId: 7,
      sessionId: 155,
      courseId: 564,
    });
    expect(state.selectedCourseId).toBe(564);
  });

  it("captures error when listCapturedCourses fails", async () => {
    vi.mocked(client.listCapturedCourses).mockRejectedValue(
      new Error("unimplemented: list_captured_courses")
    );

    const state = useSectionPickerState({
      campusId: 7,
      sessionId: 155,
      planId: "p1",
    });

    await state.fetchCourses();

    expect(state.courses).toEqual([]);
    expect(state.error).toContain("unimplemented: list_captured_courses");
  });

  it("adds section to plan via client call", async () => {
    vi.mocked(client.addSectionToPlan).mockResolvedValue(mockPlan);

    const state = useSectionPickerState({
      campusId: 7,
      sessionId: 155,
      planId: "p1",
    });

    const updatedPlan = await state.addSection(mockGeartapSections[0]);

    expect(client.addSectionToPlan).toHaveBeenCalledWith({
      planId: "p1",
      courseId: 2923,
      sectionId: 384,
    });
    expect(updatedPlan).toEqual(mockPlan);
  });

  it("removes section from plan via client call", async () => {
    vi.mocked(client.removeSectionFromPlan).mockResolvedValue(mockPlan);

    const state = useSectionPickerState({
      campusId: 7,
      sessionId: 155,
      planId: "p1",
    });

    const updatedPlan = await state.removeSection(mockGeartapSections[0]);

    expect(client.removeSectionFromPlan).toHaveBeenCalledWith({
      planId: "p1",
      courseId: 2923,
      sectionId: 384,
    });
    expect(updatedPlan).toEqual(mockPlan);
  });

  it("pins/unpins section in plan via client call", async () => {
    vi.mocked(client.setSectionPinned).mockResolvedValue(mockPlan);

    const state = useSectionPickerState({
      campusId: 7,
      sessionId: 155,
      planId: "p1",
    });

    const updatedPlan = await state.togglePin(mockGeartapSections[0], true);

    expect(client.setSectionPinned).toHaveBeenCalledWith({
      planId: "p1",
      courseId: 2923,
      sectionId: 384,
      pinned: true,
    });
    expect(updatedPlan).toEqual(mockPlan);
  });

  // The picker loaded its course list once on mount and never again, so a
  // course captured in Course Finder stayed invisible in the dropdown until
  // the picker was remounted while the counter updated correctly.
  it("syncCourses picks up a newly captured course without a remount", async () => {
    vi.mocked(client.listCapturedCourses).mockResolvedValueOnce([mockCourses[0]]);
    vi.mocked(client.listCapturedSections).mockResolvedValue(mockGeartapSections);

    const state = useSectionPickerState({ campusId: 7, sessionId: 155, planId: "p1" });
    await state.fetchCourses();
    expect(state.courses).toHaveLength(1);

    // A capture lands: the catalog now holds a second course.
    vi.mocked(client.listCapturedCourses).mockResolvedValueOnce(mockCourses);
    await state.syncCourses();

    expect(state.courses).toHaveLength(2);
    expect(state.courses.map((course) => course.courseId)).toContain(564);
  });

  // Reloading must not yank the student out of the course they are reading.
  it("syncCourses keeps the current selection when that course still exists", async () => {
    vi.mocked(client.listCapturedCourses).mockResolvedValue(mockCourses);
    vi.mocked(client.listCapturedSections).mockResolvedValue(mockGeartapSections);

    const state = useSectionPickerState({ campusId: 7, sessionId: 155, planId: "p1" });
    await state.fetchCourses();
    await state.selectCourse(564);
    expect(state.selectedCourseId).toBe(564);

    await state.syncCourses();

    expect(
      state.selectedCourseId,
      "a capture elsewhere must not move the student off the course they are on",
    ).toBe(564);
  });

  // The selected course can disappear once it is removed from the catalog.
  it("syncCourses falls back to the first course when the selection is gone", async () => {
    vi.mocked(client.listCapturedCourses).mockResolvedValue(mockCourses);
    vi.mocked(client.listCapturedSections).mockResolvedValue(mockGeartapSections);

    const state = useSectionPickerState({ campusId: 7, sessionId: 155, planId: "p1" });
    await state.fetchCourses();
    await state.selectCourse(564);

    vi.mocked(client.listCapturedCourses).mockResolvedValue([mockCourses[0]]);
    await state.syncCourses();

    expect(state.selectedCourseId).toBe(2923);
  });

  it("syncCourses leaves an empty catalog in its ordinary empty state", async () => {
    vi.mocked(client.listCapturedCourses).mockResolvedValue(mockCourses);
    vi.mocked(client.listCapturedSections).mockResolvedValue(mockGeartapSections);

    const state = useSectionPickerState({ campusId: 7, sessionId: 155, planId: "p1" });
    await state.fetchCourses();

    vi.mocked(client.listCapturedCourses).mockResolvedValue([]);
    await state.syncCourses();

    expect(state.courses).toEqual([]);
    expect(state.selectedCourseId).toBeNull();
    expect(state.sections).toEqual([]);
    expect(state.error).toBeNull();
  });

  it("forgets captured course, updates course list and selects next course", async () => {
    vi.mocked(client.listCapturedCourses).mockResolvedValue(mockCourses);
    vi.mocked(client.listCapturedSections).mockResolvedValue(mockGeartapSections);
    const mockSummary = {
      campusId: 7,
      sessionId: 155,
      sectionCount: 5,
      courseCount: 1,
    };
    const mockOutcome = {
      summary: mockSummary,
      affectedPlans: [{ planId: "p1", removedSections: 1 }],
    };
    vi.mocked(client.forgetCapturedCourse).mockResolvedValue(mockOutcome);

    const onCaptureUpdated = vi.fn();
    const state = useSectionPickerState({
      campusId: 7,
      sessionId: 155,
      planId: "p1",
      onCaptureUpdated,
    });

    await state.fetchCourses();
    expect(state.courses).toHaveLength(2);
    expect(state.selectedCourseId).toBe(2923);

    const returnedOutcome = await state.forgetCourse(2923);

    expect(client.forgetCapturedCourse).toHaveBeenCalledWith({
      campusId: 7,
      sessionId: 155,
      courseId: 2923,
    });
    expect(returnedOutcome).toEqual(mockOutcome);
    expect(onCaptureUpdated).toHaveBeenCalledWith(mockSummary);
    expect(state.courses).toHaveLength(1);
    expect(state.courses[0].courseId).toBe(564);
    expect(state.selectedCourseId).toBe(564);
    expect(client.listCapturedSections).toHaveBeenCalledWith({
      campusId: 7,
      sessionId: 155,
      courseId: 564,
    });
  });

  it("removing the last course leaves ordinary empty state and no error", async () => {
    vi.mocked(client.listCapturedCourses).mockResolvedValue([mockCourses[0]]);
    vi.mocked(client.listCapturedSections).mockResolvedValue(mockGeartapSections);
    const mockOutcome = {
      summary: {
        campusId: 7,
        sessionId: 155,
        sectionCount: 0,
        courseCount: 0,
      },
      affectedPlans: [],
    };
    vi.mocked(client.forgetCapturedCourse).mockResolvedValue(mockOutcome);

    const state = useSectionPickerState({
      campusId: 7,
      sessionId: 155,
      planId: "p1",
    });

    await state.fetchCourses();
    expect(state.courses).toHaveLength(1);
    expect(state.selectedCourseId).toBe(2923);

    await state.forgetCourse(2923);

    expect(state.courses).toEqual([]);
    expect(state.selectedCourseId).toBeNull();
    expect(state.sections).toEqual([]);
    expect(state.error).toBeNull();
  });
});
