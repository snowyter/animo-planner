import { describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SectionPicker } from "./SectionPicker";
import type { CapturedCourse, PlanSection, ScheduleBlock, Section } from "../adapters/ipc/types";

describe("SectionPicker", () => {
  const mockCourses: CapturedCourse[] = [
    {
      courseId: 2923,
      code: "GEARTAP",
      title: "Art Appreciation",
      sectionCount: 2,
      firstSeenAt: "2026-08-22T00:00:00Z",
      lastSeenAt: "2026-08-22T00:00:00Z",
    },
    {
      courseId: 564,
      code: "CSINTSY",
      title: "Intro to Intelligent Systems",
      sectionCount: 1,
      firstSeenAt: "2026-08-22T00:00:00Z",
      lastSeenAt: "2026-08-22T00:00:00Z",
    },
  ];

  const makeBlock = (
    day: ScheduleBlock["day"],
    startMin: number,
    endMin: number,
    modality: "F2F" | "ONLINE" = "F2F",
    location: string | null = modality === "F2F" ? "L226" : null
  ): ScheduleBlock => {
    if (modality === "F2F") {
      return {
        day,
        startMin,
        endMin,
        modality: "F2F",
        location: location ?? "L226",
      };
    }
    return {
      day,
      startMin,
      endMin,
      modality: "ONLINE",
      location: null,
    };
  };

  const makeSection = (
    courseId: number,
    sectionId: number,
    courseCode: string,
    sectionCode: string,
    blocks: ScheduleBlock[],
    teacher: string | null = null,
    enrolled = 35,
    enrollCap = 45,
    remark: string | null = null
  ): Section => ({
    campusId: 7,
    sessionId: 155,
    courseId,
    courseCode,
    courseTitle: `${courseCode} Title`,
    sectionId,
    sectionCode,
    courseType: "Lecture",
    credits: 3,
    enrollCap,
    startDate: "2026-07-10",
    endDate: "2026-12-09",
    firstSeenAt: "2026-08-22T00:00:00Z",
    lastSeenAt: "2026-08-22T00:00:00Z",
    modality: blocks.some((b) => b.modality === "ONLINE")
      ? blocks.some((b) => b.modality === "F2F")
        ? "HYBRID"
        : "ONLINE"
      : "F2F",
    blocks,
    latestSnapshot: {
      capturedAt: "2026-08-22T00:00:00Z",
      enrolled,
      teacher,
      remark,
    },
  });

  const makePlanSection = (
    courseId: number,
    sectionId: number,
    courseCode: string,
    sectionCode: string,
    blocks: ScheduleBlock[],
    pinned = false
  ): PlanSection => ({
    courseId,
    courseCode,
    courseTitle: `${courseCode} Title`,
    sectionId,
    sectionCode,
    pinned,
    missing: false,
    modality: blocks.some((b) => b.modality === "ONLINE")
      ? blocks.some((b) => b.modality === "F2F")
        ? "HYBRID"
        : "ONLINE"
      : "F2F",
    blocks,
    latestSnapshot: {
      capturedAt: "2026-08-22T00:00:00Z",
      enrolled: 40,
      teacher: "Prof X",
      remark: null,
    },
  });

  const sampleSections: Section[] = [
    makeSection(
      2923,
      384,
      "GEARTAP",
      "S11",
      [
        makeBlock("TUE", 870, 960, "F2F", "L226"),
        makeBlock("FRI", 870, 960, "ONLINE"),
      ],
      null, // Blank teacher
      42,
      45,
      "Special section for CLA"
    ),
    makeSection(
      2923,
      385,
      "GEARTAP",
      "S12",
      [makeBlock("MON", 450, 540, "F2F", "Y603")],
      "DELA CRUZ, JUAN",
      30,
      45,
      null
    ),
  ];

  it("renders course-by-course switcher and lists sections for selected course", () => {
    const html = renderToStaticMarkup(
      React.createElement(SectionPicker, {
        courses: mockCourses,
        selectedCourseId: 2923,
        sections: sampleSections,
        planSections: [],
        isLoadingCourses: false,
        isLoadingSections: false,
        isMutating: false,
        error: null,
        onSelectCourse: vi.fn(),
        onAddSection: vi.fn(),
        onRemoveSection: vi.fn(),
        onTogglePin: vi.fn(),
        onHoverSection: vi.fn(),
      })
    );

    expect(html).toContain("GEARTAP");
    expect(html).toContain("CSINTSY");
    expect(html).toContain("S11");
    expect(html).toContain("S12");
  });

  it("displays schedule blocks, modality, room, teacher, and enrolled/cap for each section", () => {
    const html = renderToStaticMarkup(
      React.createElement(SectionPicker, {
        courses: mockCourses,
        selectedCourseId: 2923,
        sections: sampleSections,
        planSections: [],
        isLoadingCourses: false,
        isLoadingSections: false,
        isMutating: false,
        error: null,
        onSelectCourse: vi.fn(),
        onAddSection: vi.fn(),
        onRemoveSection: vi.fn(),
        onTogglePin: vi.fn(),
        onHoverSection: vi.fn(),
      })
    );

    // Schedule blocks & room
    expect(html).toContain("L226");
    expect(html).toContain("Online");
    // Enrolled over cap
    expect(html).toContain("42/45");
    expect(html).toContain("30/45");
  });

  it("displays blank teacher as 'Unknown', never as empty or a dash", () => {
    const html = renderToStaticMarkup(
      React.createElement(SectionPicker, {
        courses: mockCourses,
        selectedCourseId: 2923,
        sections: sampleSections,
        planSections: [],
        isLoadingCourses: false,
        isLoadingSections: false,
        isMutating: false,
        error: null,
        onSelectCourse: vi.fn(),
        onAddSection: vi.fn(),
        onRemoveSection: vi.fn(),
        onTogglePin: vi.fn(),
        onHoverSection: vi.fn(),
      })
    );

    // S11 has null teacher -> must display Unknown
    expect(html).toContain("Unknown");
    // S12 has DELA CRUZ, JUAN
    expect(html).toContain("DELA CRUZ, JUAN");
  });

  it("displays remark verbatim when present", () => {
    const html = renderToStaticMarkup(
      React.createElement(SectionPicker, {
        courses: mockCourses,
        selectedCourseId: 2923,
        sections: sampleSections,
        planSections: [],
        isLoadingCourses: false,
        isLoadingSections: false,
        isMutating: false,
        error: null,
        onSelectCourse: vi.fn(),
        onAddSection: vi.fn(),
        onRemoveSection: vi.fn(),
        onTogglePin: vi.fn(),
        onHoverSection: vi.fn(),
      })
    );

    expect(html).toContain("Special section for CLA");
  });

  it("shows in-plan status, pin toggle, and remove button when section is in plan", () => {
    const planSection = makePlanSection(
      2923,
      384,
      "GEARTAP",
      "S11",
      [
        makeBlock("TUE", 870, 960, "F2F", "L226"),
        makeBlock("FRI", 870, 960, "ONLINE"),
      ],
      true
    );

    const html = renderToStaticMarkup(
      React.createElement(SectionPicker, {
        courses: mockCourses,
        selectedCourseId: 2923,
        sections: sampleSections,
        planSections: [planSection],
        isLoadingCourses: false,
        isLoadingSections: false,
        isMutating: false,
        error: null,
        onSelectCourse: vi.fn(),
        onAddSection: vi.fn(),
        onRemoveSection: vi.fn(),
        onTogglePin: vi.fn(),
        onHoverSection: vi.fn(),
      })
    );

    expect(html).toContain("In Plan");
    expect(html).toContain("Remove");
    expect(html).toContain("Unpin");
  });

  it("displays conflict indicator when candidate section conflicts with plan, without disabling add button", () => {
    const conflictingPlanSection = makePlanSection(
      564,
      737,
      "CSINTSY",
      "Z01",
      [makeBlock("MON", 480, 570, "F2F", "Y603")] // Overlaps S12 on MON (450-540)
    );

    const html = renderToStaticMarkup(
      React.createElement(SectionPicker, {
        courses: mockCourses,
        selectedCourseId: 2923,
        sections: sampleSections,
        planSections: [conflictingPlanSection],
        isLoadingCourses: false,
        isLoadingSections: false,
        isMutating: false,
        error: null,
        onSelectCourse: vi.fn(),
        onAddSection: vi.fn(),
        onRemoveSection: vi.fn(),
        onTogglePin: vi.fn(),
        onHoverSection: vi.fn(),
      })
    );

    // Shows conflict indicator
    expect(html).toContain("Conflict");
    // Add button is still present and not disabled
    expect(html).toContain("Add to Plan");
  });

  it("renders empty state when no courses have been captured", () => {
    const html = renderToStaticMarkup(
      React.createElement(SectionPicker, {
        courses: [],
        selectedCourseId: null,
        sections: [],
        planSections: [],
        isLoadingCourses: false,
        isLoadingSections: false,
        isMutating: false,
        error: null,
        onSelectCourse: vi.fn(),
        onAddSection: vi.fn(),
        onRemoveSection: vi.fn(),
        onTogglePin: vi.fn(),
        onHoverSection: vi.fn(),
      })
    );

    expect(html).toContain("No captured courses");
  });

  it("displays missing badge when a plan section is marked missing", () => {
    const missingPlanSection = makePlanSection(
      2923,
      384,
      "GEARTAP",
      "S11",
      [
        makeBlock("TUE", 870, 960, "F2F", "L226"),
        makeBlock("FRI", 870, 960, "ONLINE"),
      ],
      false
    );
    missingPlanSection.missing = true;

    const html = renderToStaticMarkup(
      React.createElement(SectionPicker, {
        courses: mockCourses,
        selectedCourseId: 2923,
        sections: sampleSections,
        planSections: [missingPlanSection],
        isLoadingCourses: false,
        isLoadingSections: false,
        isMutating: false,
        error: null,
        onSelectCourse: vi.fn(),
        onAddSection: vi.fn(),
        onRemoveSection: vi.fn(),
        onTogglePin: vi.fn(),
        onHoverSection: vi.fn(),
      })
    );

    expect(html).toContain("Missing");
    expect(html).toContain("Remove");
  });

  it("renders close button when onClose is provided", () => {
    const html = renderToStaticMarkup(
      React.createElement(SectionPicker, {
        courses: mockCourses,
        selectedCourseId: 2923,
        sections: sampleSections,
        planSections: [],
        isLoadingCourses: false,
        isLoadingSections: false,
        isMutating: false,
        error: null,
        onSelectCourse: vi.fn(),
        onAddSection: vi.fn(),
        onRemoveSection: vi.fn(),
        onTogglePin: vi.fn(),
        onHoverSection: vi.fn(),
        onClose: vi.fn(),
      })
    );

    expect(html).toContain("Close");
  });

  // The picker sits in a ~380-440px column while Tailwind's `sm:` keys off
  // the viewport, so a `sm:flex-row` header went sideways inside a narrow
  // column: the description wrapped one word per line and the course
  // dropdown overlapped the title.
  it("stacks its header so it survives the narrow picking column", () => {
    const html = renderToStaticMarkup(
      React.createElement(SectionPicker, {
        courses: mockCourses,
        selectedCourseId: 2923,
        sections: sampleSections,
        planSections: [],
        isLoadingCourses: false,
        isLoadingSections: false,
        isMutating: false,
        error: null,
        onSelectCourse: vi.fn(),
        onAddSection: vi.fn(),
        onRemoveSection: vi.fn(),
        onTogglePin: vi.fn(),
        onHoverSection: vi.fn(),
      })
    );

    expect(html).not.toMatch(/sm:flex-row/);
    expect(html).toMatch(/flex flex-col gap-3/);
  });

  it("offers exactly one close control", () => {
    const html = renderToStaticMarkup(
      React.createElement(SectionPicker, {
        courses: mockCourses,
        selectedCourseId: 2923,
        sections: sampleSections,
        planSections: [],
        isLoadingCourses: false,
        isLoadingSections: false,
        isMutating: false,
        error: null,
        onSelectCourse: vi.fn(),
        onAddSection: vi.fn(),
        onRemoveSection: vi.fn(),
        onTogglePin: vi.fn(),
        onHoverSection: vi.fn(),
        onClose: vi.fn(),
      })
    );

    expect(
      (html.match(/Close section picker/g) ?? []).length,
      "the stacked header keeps one Close, not the wide layout's second copy",
    ).toBe(1);
  });

  // A 42-section course must not push the week grid off screen beside it.
  it("bounds and scrolls the section list in two-column mode", () => {
    const html = renderToStaticMarkup(
      React.createElement(SectionPicker, {
        courses: mockCourses,
        selectedCourseId: 2923,
        sections: sampleSections,
        planSections: [],
        isLoadingCourses: false,
        isLoadingSections: false,
        isMutating: false,
        error: null,
        onSelectCourse: vi.fn(),
        onAddSection: vi.fn(),
        onRemoveSection: vi.fn(),
        onTogglePin: vi.fn(),
        onHoverSection: vi.fn(),
      })
    );

    expect(html).toContain('data-testid="section-list"');
    expect(html).toMatch(/lg:max-h-\[600px\]/);
    expect(html).toMatch(/lg:overflow-y-auto/);
  });

  it("renders a remove course from catalog button for the selected course, distinct from plan section removal", () => {
    const html = renderToStaticMarkup(
      React.createElement(SectionPicker, {
        courses: mockCourses,
        selectedCourseId: 2923,
        sections: sampleSections,
        planSections: [],
        isLoadingCourses: false,
        isLoadingSections: false,
        isMutating: false,
        error: null,
        onSelectCourse: vi.fn(),
        onAddSection: vi.fn(),
        onRemoveSection: vi.fn(),
        onRemoveCourse: vi.fn(),
        onTogglePin: vi.fn(),
        onHoverSection: vi.fn(),
      })
    );

    expect(html).toContain("Remove course from catalog");
    expect(html).toContain('data-testid="remove-course-button"');
  });

  it("renders confirmation dialog naming the course and how many sections go with it when confirming removal", () => {
    const html = renderToStaticMarkup(
      React.createElement(SectionPicker, {
        courses: mockCourses,
        selectedCourseId: 2923,
        sections: sampleSections,
        planSections: [],
        isLoadingCourses: false,
        isLoadingSections: false,
        isMutating: false,
        error: null,
        initialConfirmingRemove: true,
        onSelectCourse: vi.fn(),
        onAddSection: vi.fn(),
        onRemoveSection: vi.fn(),
        onRemoveCourse: vi.fn(),
        onTogglePin: vi.fn(),
        onHoverSection: vi.fn(),
      })
    );

    expect(html).toContain("Remove GEARTAP from catalog?");
    expect(html).toContain("Art Appreciation");
    expect(html).toContain("2 captured sections");
    expect(html).toContain("Cancel");
    expect(html).toContain("Remove course");
    expect(html).toContain('data-testid="confirm-remove-course"');
    expect(html).toContain('data-testid="cancel-remove-course"');
  });

  it("displays refusal error notice naming the blocking plans when course removal is refused", () => {
    const refusalError =
      'course 2923 under campus 7 session 155 is still held by plans ["T1 Target Schedule"] — remove its sections from those plans first';

    const html = renderToStaticMarkup(
      React.createElement(SectionPicker, {
        courses: mockCourses,
        selectedCourseId: 2923,
        sections: sampleSections,
        planSections: [],
        isLoadingCourses: false,
        isLoadingSections: false,
        isMutating: false,
        error: refusalError,
        onSelectCourse: vi.fn(),
        onAddSection: vi.fn(),
        onRemoveSection: vi.fn(),
        onRemoveCourse: vi.fn(),
        onTogglePin: vi.fn(),
        onHoverSection: vi.fn(),
      })
    );

    expect(html).toContain("course 2923 under campus 7 session 155 is still held by plans");
    expect(html).toContain("remove its sections from those plans first");
    expect(html).toContain("&quot;T1 Target Schedule&quot;");
  });
});
