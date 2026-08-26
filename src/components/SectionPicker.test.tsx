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
      included: true,
      lastRefreshedAt: null,
    },
    {
      courseId: 564,
      code: "CSINTSY",
      title: "Intro to Intelligent Systems",
      sectionCount: 1,
      firstSeenAt: "2026-08-22T00:00:00Z",
      lastSeenAt: "2026-08-22T00:00:00Z",
      included: true,
      lastRefreshedAt: null,
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
    // A block stack: block flow cannot collapse a child to a few characters
    // wide the way a nested flex row did.
    expect(html).toMatch(/class="space-y-3"/);
  });

  // Tailwind breakpoints key off the viewport, not the container. This card
  // always lives in the ~380-440px picking column, so any responsive
  // direction switch inside it fires on a wide viewport and lays the content
  // out sideways in a narrow column -- which squeezed the schedule blocks
  // until "9:15 AM - 10:45 AM" broke across four lines, and pushed the
  // course dropdown past the column edge.
  it("never switches to a horizontal layout on a viewport breakpoint", () => {
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

    expect(
      html,
      "a container this narrow must not go horizontal on a viewport breakpoint",
    ).not.toMatch(/(sm|md|lg|xl):flex-row/);
  });

  it("keeps a schedule time on one line and the course select inside the column", () => {
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

    // A time is one value; breaking it across lines makes it unreadable.
    expect(html).toMatch(/whitespace-nowrap/);
    // The select must shrink with the column instead of overflowing it.
    expect(html).toMatch(/data-testid="course-select"[^>]*class="[^"]*min-w-0/);
  });

  // The remove button lives in the chrome half. Its confirmation dialog lived
  // in the list half, so rendering chrome-only left the button setting state
  // with no dialog mounted -- the button simply did nothing.
  it("keeps the remove confirmation dialog in the same half as its trigger", () => {
    const chrome = renderToStaticMarkup(
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
        render: "chrome",
        onSelectCourse: vi.fn(),
        onAddSection: vi.fn(),
        onRemoveSection: vi.fn(),
        onRemoveCourse: vi.fn(),
        onTogglePin: vi.fn(),
        onHoverSection: vi.fn(),
      })
    );

    expect(chrome).toContain("remove-course-button");
    expect(
      chrome,
      "the dialog must render in whichever half holds the button",
    ).toContain("remove-course-dialog");
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
    // Bounded and scrollable is the property that matters; the exact height
    // is free to track the grid beside it.
    expect(html).toMatch(/lg:max-h-\[\d+px\]/);
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

  it("renders confirmation dialog naming the course and how many sections go with it when confirming removal without affected plans", () => {
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
    // When no plan is affected, stays short and does not warn about plan loss
    expect(html).not.toContain("will lose");
    expect(html).toContain("Cancel");
    expect(html).toContain("Remove course");
    expect(html).toContain('data-testid="confirm-remove-course"');
    expect(html).toContain('data-testid="cancel-remove-course"');
  });

  it("renders confirmation dialog naming affected plan and how many sections it loses when plan holds sections", () => {
    const planSection = makePlanSection(
      2923,
      384,
      "GEARTAP",
      "S11",
      [makeBlock("TUE", 870, 960)],
      false
    );

    const html = renderToStaticMarkup(
      React.createElement(SectionPicker, {
        courses: mockCourses,
        selectedCourseId: 2923,
        sections: sampleSections,
        planSections: [planSection],
        planName: "T1 Target Schedule",
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
    // Consequence stated explicitly
    expect(html).toContain("T1 Target Schedule");
    expect(html).toContain("1 section");
  });

  it("renders visible non-blocking notice when notice prop is provided", () => {
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
        notice: "Removed GEARTAP from catalog. Released 1 section from plan.",
        onSelectCourse: vi.fn(),
        onAddSection: vi.fn(),
        onRemoveSection: vi.fn(),
        onTogglePin: vi.fn(),
        onHoverSection: vi.fn(),
      })
    );

    expect(html).toContain("Removed GEARTAP from catalog. Released 1 section from plan.");
    expect(html).toContain('data-testid="picker-notice"');
  });

  it("renders sections in the plan first, with pinned first, before remaining catalog sections", () => {
    // 3 sections: S11 (in plan, unpinned), S12 (in catalog), S13 (in plan, pinned)
    const sec11 = makeSection(2923, 384, "GEARTAP", "S11", [makeBlock("TUE", 870, 960)]);
    const sec12 = makeSection(2923, 385, "GEARTAP", "S12", [makeBlock("MON", 450, 540)]);
    const sec13 = makeSection(2923, 386, "GEARTAP", "S13", [makeBlock("WED", 450, 540)]);

    const planSections = [
      makePlanSection(2923, 384, "GEARTAP", "S11", [makeBlock("TUE", 870, 960)], false),
      makePlanSection(2923, 386, "GEARTAP", "S13", [makeBlock("WED", 450, 540)], true),
    ];

    const html = renderToStaticMarkup(
      React.createElement(SectionPicker, {
        courses: mockCourses,
        selectedCourseId: 2923,
        sections: [sec11, sec12, sec13],
        planSections,
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

    const posS13 = html.indexOf('data-testid="section-row-S13"');
    const posS11 = html.indexOf('data-testid="section-row-S11"');
    const posS12 = html.indexOf('data-testid="section-row-S12"');

    expect(posS13).toBeGreaterThan(-1);
    expect(posS11).toBeGreaterThan(-1);
    expect(posS12).toBeGreaterThan(-1);

    // S13 is pinned in plan -> should come first
    // S11 is unpinned in plan -> should come second
    // S12 is not in plan -> should come last
    expect(posS13).toBeLessThan(posS11);
    expect(posS11).toBeLessThan(posS12);
  });

  it("renders a visible boundary between in-plan sections and remaining catalog sections", () => {
    const sec11 = makeSection(2923, 384, "GEARTAP", "S11", [makeBlock("TUE", 870, 960)]);
    const sec12 = makeSection(2923, 385, "GEARTAP", "S12", [makeBlock("MON", 450, 540)]);

    const planSections = [
      makePlanSection(2923, 384, "GEARTAP", "S11", [makeBlock("TUE", 870, 960)], false),
    ];

    const html = renderToStaticMarkup(
      React.createElement(SectionPicker, {
        courses: mockCourses,
        selectedCourseId: 2923,
        sections: [sec11, sec12],
        planSections,
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

    expect(html).toContain('data-testid="picker-group-divider"');
  });

  it("moves a section between groups dynamically when added to the plan", () => {
    const sec11 = makeSection(2923, 384, "GEARTAP", "S11", [makeBlock("TUE", 870, 960)]);
    const sec12 = makeSection(2923, 385, "GEARTAP", "S12", [makeBlock("MON", 450, 540)]);

    // Before adding: S11 in plan, S12 in catalog
    const planBefore = [
      makePlanSection(2923, 384, "GEARTAP", "S11", [makeBlock("TUE", 870, 960)], false),
    ];

    const htmlBefore = renderToStaticMarkup(
      React.createElement(SectionPicker, {
        courses: mockCourses,
        selectedCourseId: 2923,
        sections: [sec11, sec12],
        planSections: planBefore,
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

    const dividerPosBefore = htmlBefore.indexOf('data-testid="picker-group-divider"');
    const s12PosBefore = htmlBefore.indexOf('data-testid="section-row-S12"');
    expect(s12PosBefore).toBeGreaterThan(dividerPosBefore);

    // After adding S12 to plan: both in plan, no divider
    const planAfter = [
      makePlanSection(2923, 384, "GEARTAP", "S11", [makeBlock("TUE", 870, 960)], false),
      makePlanSection(2923, 385, "GEARTAP", "S12", [makeBlock("MON", 450, 540)], false),
    ];

    const htmlAfter = renderToStaticMarkup(
      React.createElement(SectionPicker, {
        courses: mockCourses,
        selectedCourseId: 2923,
        sections: [sec11, sec12],
        planSections: planAfter,
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

    expect(htmlAfter).not.toContain('data-testid="picker-group-divider"');
    const s11PosAfter = htmlAfter.indexOf('data-testid="section-row-S11"');
    const s12PosAfter = htmlAfter.indexOf('data-testid="section-row-S12"');
    expect(s11PosAfter).toBeGreaterThan(-1);
    expect(s12PosAfter).toBeGreaterThan(-1);
  });

  // The course selector used to live in the chrome half, which sits full
  // width above both columns. Scroll down into a long section list and it was
  // off screen -- changing course meant scrolling back to the top of the page.
  describe("changing course without leaving the list", () => {
    const listProps = {
      render: "list" as const,
      courses: mockCourses,
      selectedCourseId: 2923,
      sections: sampleSections,
      planSections: [],
      onSelectCourse: vi.fn(),
      onAddSection: vi.fn(),
      onRemoveSection: vi.fn(),
      onTogglePin: vi.fn(),
      onHoverSection: vi.fn(),
    };

    it("puts the course selector in the list half, where the sections are", () => {
      const html = renderToStaticMarkup(React.createElement(SectionPicker, listProps));
      expect(html).toContain('data-testid="course-select"');
    });

    it("pins it so it stays reachable as the list scrolls past", () => {
      const html = renderToStaticMarkup(React.createElement(SectionPicker, listProps));
      const bar = html.slice(0, html.indexOf('data-testid="course-select"'));
      // Below the app header, never behind it.
      expect(bar).toMatch(/sticky[^"]*top-16/);
    });

    it("does not leave a second selector behind in the chrome half", () => {
      const chrome = renderToStaticMarkup(
        React.createElement(SectionPicker, { ...listProps, render: "chrome" as const })
      );
      expect(chrome).not.toContain('data-testid="course-select"');
    });

    it("still offers exactly one selector when both halves render together", () => {
      const html = renderToStaticMarkup(
        React.createElement(SectionPicker, { ...listProps, render: "all" as const })
      );
      expect(html.match(/data-testid="course-select"/g)).toHaveLength(1);
    });

    it("names the control for screen readers now that its label is visual chrome", () => {
      const html = renderToStaticMarkup(React.createElement(SectionPicker, listProps));
      const select = html.match(/<select[^>]*data-testid="course-select"[^>]*>/);
      expect(select).not.toBeNull();
      expect(select![0]).toMatch(/aria-label="[^"]+"/);
    });
  });

  /**
   * Ticket 46 — the picker is a tab inside a bounded tool panel now, and the
   * panel is the scroll container. Both of the picker's own scrolling
   * decisions were made for a page that scrolled instead.
   */
  describe("inside a bounded tool panel", () => {
    const panelProps = {
      render: "list" as const,
      scrollContext: "panel" as const,
      courses: mockCourses,
      selectedCourseId: 2923,
      sections: sampleSections,
      planSections: [],
      onSelectCourse: vi.fn(),
      onAddSection: vi.fn(),
      onRemoveSection: vi.fn(),
      onTogglePin: vi.fn(),
      onHoverSection: vi.fn(),
    };

    it("sticks the course selector to the panel's top, not to the app header's", () => {
      const html = renderToStaticMarkup(React.createElement(SectionPicker, panelProps));
      const bar = html.slice(0, html.indexOf('data-testid="course-select"'));

      // `top-16` clears the app header, which is not what scrolls here — it
      // would leave the bar floating in a 64px gap.
      expect(bar).toMatch(/sticky[^"]*top-0/);
      expect(bar).not.toMatch(/sticky[^"]*top-16/);
    });

    it("lets the panel bound the list rather than nesting a second scroller", () => {
      const html = renderToStaticMarkup(React.createElement(SectionPicker, panelProps));
      const list = /<div[^>]*data-testid="section-list"[^>]*>/.exec(html);

      expect(list).not.toBeNull();
      expect(list![0]).not.toMatch(/max-h-/);
      expect(list![0]).not.toMatch(/overflow-y-auto/);
    });

    it("still bounds the list itself when the page is what scrolls", () => {
      const html = renderToStaticMarkup(
        React.createElement(SectionPicker, { ...panelProps, scrollContext: "page" as const })
      );
      const list = /<div[^>]*data-testid="section-list"[^>]*>/.exec(html);

      expect(list![0]).toMatch(/max-h-/);
      expect(list![0]).toMatch(/overflow-y-auto/);
    });
  });
});
