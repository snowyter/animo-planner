/**
 * Ticket 33 — acceptance tests for the visual revision.
 *
 * Everything here renders to static markup with animation inert, which is the
 * standing constraint on this suite: a surface that renders empty without a
 * browser is not acceptable.
 */

import { describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { AboutDialog } from "./AboutDialog";
import { AppHeader } from "./AppHeader";
import { OnboardingDialog } from "./OnboardingDialog";
import { PlanList } from "./PlanList";
import { PlanWorkspace } from "./PlanWorkspace";
import { SectionPicker } from "./SectionPicker";
import { SolveDialog } from "./SolveDialog";
import { UpdateNotice } from "./UpdateNotice";
import { WeekGrid } from "./WeekGrid";
import type {
  Plan,
  PlanSection,
  PlanSummary,
  ScheduleBlock,
  Section,
  Solution,
  SolveResult,
} from "../adapters/ipc/types";

vi.mock("../adapters/ipc/client", () => ({
  listPlans: vi.fn(),
  getCampusOptions: vi.fn(),
  getSessionOptions: vi.fn(),
  createPlan: vi.fn(),
  deletePlan: vi.fn(),
  getPlan: vi.fn(),
  getCaptureSummary: vi.fn(),
  openCaptureWindow: vi.fn(),
  getAppInfo: vi.fn(),
  buildCaptureReport: vi.fn(),
  clearBrowserSession: vi.fn(),
  checkForUpdate: vi.fn(),
  installUpdate: vi.fn(),
  onCaptureUpdated: vi.fn(),
  onCaptureFailed: vi.fn(),
  listCapturedCourses: vi.fn(),
  listSectionsForCourse: vi.fn(),
  addSectionToPlan: vi.fn(),
  removeSectionFromPlan: vi.fn(),
  setSectionPinned: vi.fn(),
  forgetCourse: vi.fn(),
  solvePlan: vi.fn(),
  continueSolve: vi.fn(),
  cancelSolve: vi.fn(),
  applySolution: vi.fn(),
  refreshPlan: vi.fn(),
  resumeRefresh: vi.fn(),
  listMissingSections: vi.fn(),
  exportPlanIcs: vi.fn(),
}));

const planSummary: PlanSummary = {
  id: "p1",
  name: "T1 Target Schedule",
  campusId: 7,
  campusName: "Manila",
  sessionId: 155,
  sessionName: "AY2026-27 T1",
  createdAt: "2026-08-22T00:00:00Z",
  sectionCount: 0,
};

const emptyPlan: Plan = { ...planSummary, sections: [] };

const planSection: PlanSection = {
  courseId: 2923,
  sectionId: 384,
  courseCode: "GEARTAP",
  courseTitle: "Great Works",
  sectionCode: "S11",
  modality: "F2F",
  pinned: false,
  missing: false,
  blocks: [
    { day: "MON", startMin: 450, endMin: 540, location: "L226", modality: "F2F" },
  ],
  latestSnapshot: {
    capturedAt: "2026-08-22T00:00:00Z",
    enrolled: 42,
    teacher: "",
    remark: null,
  },
};

function solution(id: string, score: number): Solution {
  return {
    id,
    score,
    breakdown: [{ label: "campus days", points: 2 }],
    warnings: [],
    sections: [
      {
        courseId: 2923,
        sectionId: 384,
        courseCode: "GEARTAP",
        sectionCode: "S11",
        pinned: false,
        blocks: planSection.blocks,
      },
    ],
  };
}

describe("ambient surfaces", () => {
  it("gives the plan list an ambient wash behind opaque content", () => {
    const html = renderToStaticMarkup(
      React.createElement(PlanList, {
        plans: [],
        isLoading: false,
        error: null,
        onOpenCreate: vi.fn(),
        onOpenPlan: vi.fn(),
        onDeletePlan: vi.fn(),
        onRetry: vi.fn(),
      })
    );

    expect(html).toContain('data-testid="ambient-wash"');
    // Decoration is never announced.
    expect(html).toMatch(/data-testid="ambient-wash"[^>]*aria-hidden="true"/);
    // Content sits above it on its own layer so text contrast is unaffected.
    expect(html).toContain("ambient-content");
  });

  it("gives onboarding an ambient wash", () => {
    const html = renderToStaticMarkup(
      React.createElement(OnboardingDialog, {
        open: true,
        onOpenChange: vi.fn(),
        campusOptions: [{ id: 7, name: "Manila" }],
        sessionOptions: [{ id: 155, name: "AY2026-27 T1" }],
        onCreatePlan: vi.fn(),
        onOpenCapture: vi.fn(),
        onSelectPlan: vi.fn(),
        onComplete: vi.fn(),
      })
    );

    expect(html).toContain('data-testid="ambient-wash"');
  });

  it("gives About an ambient wash", () => {
    const html = renderToStaticMarkup(
      React.createElement(AboutDialog, {
        open: true,
        onOpenChange: vi.fn(),
        initialAppInfo: {
          appVersion: "0.2.0",
          selectorConfigVersion: "1",
          selectorConfigSource: "bundled",
        },
      })
    );

    expect(html).toContain('data-testid="ambient-wash"');
  });

  it("keeps the plan workspace on a plain background", () => {
    // Hue on the week grid is load-bearing (ADR-0012). Any tint behind it
    // shifts the perceived colour of every block.
    const html = renderToStaticMarkup(
      React.createElement(PlanWorkspace, {
        planSummary,
        plan: emptyPlan,
        isLoading: false,
        error: null,
        onBack: vi.fn(),
        onRetry: vi.fn(),
      })
    );

    expect(html).not.toContain("ambient-wash");
    expect(html).not.toContain("ambient-host");
  });
});

describe("loading states", () => {
  it("renders a section-list skeleton in the shape of the incoming rows, not a spinner", () => {
    const html = renderToStaticMarkup(
      React.createElement(SectionPicker, {
        render: "list",
        courses: [],
        selectedCourseId: null,
        sections: [],
        planSections: [],
        isLoadingCourses: true,
        onSelectCourse: vi.fn(),
        onAddSection: vi.fn(),
        onRemoveSection: vi.fn(),
        onTogglePin: vi.fn(),
        onHoverSection: vi.fn(),
      })
    );

    expect(html).toContain('data-testid="section-list-skeleton"');
    expect(html).toContain("skeleton");
    expect(html).not.toContain("animate-spin");
  });

  it("renders a week-grid skeleton that keeps the Mon-Sat shape", () => {
    const html = renderToStaticMarkup(
      React.createElement(WeekGrid, {
        sections: [],
        isLoading: true,
      })
    );

    expect(html).toContain('data-testid="week-grid-skeleton"');
    expect(html).toContain("skeleton");
    expect(html).toContain("Mon");
    expect(html).toContain("Sat");
    expect(html).not.toContain("animate-spin");
  });

  it("shows the week-grid skeleton while plan details load", () => {
    const html = renderToStaticMarkup(
      React.createElement(PlanWorkspace, {
        planSummary,
        plan: null,
        isLoading: true,
        error: null,
        onBack: vi.fn(),
        onRetry: vi.fn(),
      })
    );

    expect(html).toContain('data-testid="week-grid-skeleton"');
    expect(html).not.toContain("animate-spin");
  });
});

describe("empty states say what to do next", () => {
  it("no plans yet", () => {
    const html = renderToStaticMarkup(
      React.createElement(PlanList, {
        plans: [],
        isLoading: false,
        error: null,
        onOpenCreate: vi.fn(),
        onOpenPlan: vi.fn(),
        onDeletePlan: vi.fn(),
        onRetry: vi.fn(),
      })
    );

    expect(html).toContain("No saved plans yet");
    expect(html).toContain("Create your first plan");
    expect(html).toMatch(/campus and academic session/i);
  });

  it("no captured courses names the next action", () => {
    const html = renderToStaticMarkup(
      React.createElement(SectionPicker, {
        render: "list",
        courses: [],
        selectedCourseId: null,
        sections: [],
        planSections: [],
        onSelectCourse: vi.fn(),
        onAddSection: vi.fn(),
        onRemoveSection: vi.fn(),
        onTogglePin: vi.fn(),
        onHoverSection: vi.fn(),
      })
    );

    expect(html).toContain("No captured courses");
    expect(html).toMatch(/Course Finder/);
    expect(html).toMatch(/Open Archer/i);
  });

  it("a plan with no sections", () => {
    const html = renderToStaticMarkup(
      React.createElement(WeekGrid, { sections: [] })
    );

    expect(html).toContain('data-testid="week-grid-empty"');
    expect(html).toMatch(/no sections yet/i);
    // The grid is still drawn behind it: the shape is part of the answer.
    expect(html).toContain("Mon");
    expect(html).toContain("Sat");
  });

  it("a solve with no results", () => {
    const result: SolveResult = {
      status: "unsatisfiable",
      solutions: [],
      unsatisfiableCourses: [
        { courseId: 2923, code: "GEARTAP", reason: "no_valid_section" },
      ],
      excludedFullCount: 0,
      snapshotTakenAt: null,
      resumeToken: null,
    };

    const html = renderToStaticMarkup(
      React.createElement(SolveDialog, {
        open: true,
        onOpenChange: vi.fn(),
        planId: "p1",
        initialResult: result,
      })
    );

    expect(html).toContain("No conflict-free schedules found");
    expect(html).toMatch(/GEARTAP/);
    expect(html).toMatch(/relax|unpin/i);
  });
});

describe("solve results read as a ranking", () => {
  const result: SolveResult = {
    status: "complete",
    solutions: [solution("a", 92), solution("b", 71), solution("c", 55)],
    unsatisfiableCourses: [],
    excludedFullCount: 0,
    snapshotTakenAt: null,
    resumeToken: null,
  };

  const html = renderToStaticMarkup(
    React.createElement(SolveDialog, {
      open: true,
      onOpenChange: vi.fn(),
      planId: "p1",
      initialResult: result,
    })
  );

  it("marks the top result as first among equals", () => {
    expect(html).toContain('data-rank="1"');
    expect(html).toMatch(/data-top-result="true"/);
    expect(html).toMatch(/Best match/i);
    // Only one of them.
    expect(html.match(/data-top-result="true"/g)).toHaveLength(1);
  });

  it("shows the score as a bar as well as a number", () => {
    expect(html).toContain('data-testid="score-bar"');
    expect(html).toContain("92");
  });

  it("staggers the cards from CSS rather than per-item JS state", () => {
    expect(html).toContain("stagger-rise");
    expect(html).toContain("--stagger-delay");
  });
});

describe("identity and icon restraint", () => {
  it("signs the app with the wordmark, not a glyph tile", () => {
    const html = renderToStaticMarkup(
      React.createElement(AppHeader, {
        activePlan: null,
        onBackToPlans: vi.fn(),
        onOpenAbout: vi.fn(),
        onOpenTour: vi.fn(),
      })
    );

    expect(html).toContain("Animo Plan");
    expect(html).toContain('data-testid="wordmark"');
    // No stock glyph standing in for a logo, and no icon beside a word that
    // already says the same thing.
    expect(html).not.toContain("lucide-book-open");
    expect(html).not.toContain("lucide-info");
    expect(html).not.toContain("lucide-circle-question-mark");

    // The trust claim is not decoration and is not a candidate for the cull.
    expect(html).toContain("Read-only");
    expect(html).toContain("No credentials stored");
  });

  it("keeps the load-bearing glyphs on the grid", () => {
    const conflicting: PlanSection[] = [
      { ...planSection, pinned: true },
      {
        ...planSection,
        courseId: 564,
        sectionId: 737,
        courseCode: "CSINTSY",
        sectionCode: "Z01",
        blocks: [
          { day: "MON", startMin: 450, endMin: 540, location: null, modality: "ONLINE" },
        ],
      },
    ];

    const html = renderToStaticMarkup(
      React.createElement(WeekGrid, { sections: conflicting })
    );

    // Modality (ADR-0007), conflict (ADR-0009), and pin state are information,
    // not chrome — hue is already spent on course identity (ADR-0012).
    expect(html).toContain("lucide-building2");
    expect(html).toContain("lucide-globe");
    expect(html).toContain("lucide-triangle-alert");
    expect(html).toContain("lucide-pin");
  });

  it("never lets a conflict indicator animate", () => {
    // ADR-0009: a conflict is displayed the instant it exists. No animation
    // may delay or soften it.
    const conflicting: PlanSection[] = [
      planSection,
      {
        ...planSection,
        courseId: 564,
        sectionId: 737,
        courseCode: "CSINTSY",
        sectionCode: "Z01",
      },
    ];

    const html = renderToStaticMarkup(
      React.createElement(WeekGrid, { sections: conflicting })
    );

    expect(html).toContain('data-conflicting="true"');
    expect(html).not.toContain("animate-pulse");
    expect(html).not.toContain("transition");
  });
});

describe("the newer surfaces", () => {
  it("keeps the update notice quiet and dismissible", () => {
    const html = renderToStaticMarkup(
      React.createElement(UpdateNotice, {
        updateCheck: {
          status: "available",
          currentVersion: "0.1.0",
          availableVersion: "0.2.0",
          notes: null,
          failureReason: null,
          failureDetail: null,
        },
        onOpenAbout: vi.fn(),
        onDismiss: vi.fn(),
      })
    );

    expect(html).toContain("0.2.0");
    expect(html).toMatch(/aria-label="Dismiss update notice"/);
    // It must not compete with the plan for attention: no primary-coloured
    // surface, no glyph badge.
    expect(html).not.toContain("lucide-sparkles");
    expect(html).not.toContain("bg-emerald-50");
  });
});

describe("the ghost-into-place handoff", () => {
  const ghost = {
    ...planSection,
    courseId: 564,
    sectionId: 737,
    courseCode: "CSINTSY",
    sectionCode: "Z01",
    blocks: [
      { day: "WED", startMin: 660, endMin: 750, location: null, modality: "ONLINE" },
    ],
  } as PlanSection;

  /** Attribute order is not content; the text a student reads is. */
  const textOf = (html: string) => html.replace(/<[^>]*>/g, "|");

  it("renders the same assertable content whether or not the handoff is armed", () => {
    // The suite renders with animation inert. A surface that renders empty
    // without a browser is not acceptable, and arming `layoutId` must not
    // change what the markup says.
    const idle = renderToStaticMarkup(
      React.createElement(WeekGrid, { sections: [planSection, ghost] })
    );
    const handingOff = renderToStaticMarkup(
      React.createElement(WeekGrid, {
        sections: [planSection, ghost],
        initialHandoffKey: "564-737",
      })
    );

    expect(handingOff).toContain("CSINTSY");
    expect(handingOff).toContain("Z01");
    expect(handingOff).toContain("GEARTAP");
    expect(textOf(handingOff)).toBe(textOf(idle));
  });

  it("arms the handoff for one section and leaves the rest as plain blocks", () => {
    // Layout projection on all forty blocks is the thing this must never
    // become, so only the section that just landed is animated.
    const html = renderToStaticMarkup(
      React.createElement(WeekGrid, {
        sections: [planSection, ghost],
        initialHandoffKey: "564-737",
      })
    );

    // Both still render as ordinary grid blocks with their data attributes
    // intact — the handoff is invisible without a browser, by design.
    expect(html.match(/data-ghost="false"/g)).toHaveLength(2);
  });

  it("keeps the hovered preview inert and out of the way", () => {
    const html = renderToStaticMarkup(
      React.createElement(WeekGrid, {
        sections: [planSection],
        ghostSection: ghost,
      })
    );

    const ghostTag = html.slice(html.indexOf('data-ghost="true"'));
    const ghostOpenTag = ghostTag.slice(0, ghostTag.indexOf(">"));

    expect(html).toContain('data-ghost="true"');
    // A ghost is never focusable and never opens the context menu.
    expect(ghostOpenTag).toContain("pointer-events-none");
    expect(ghostOpenTag).not.toContain('tabindex="0"');
    expect(ghostOpenTag).not.toContain('aria-haspopup');
  });
});

describe("Clear schedule sits with the thing it clears", () => {
  const planWithSections: Plan = {
    ...planSummary,
    sectionCount: 1,
    sections: [planSection],
  };

  const html = renderToStaticMarkup(
    React.createElement(PlanWorkspace, {
      planSummary,
      plan: planWithSections,
      isLoading: false,
      error: null,
      onBack: vi.fn(),
      onRetry: vi.fn(),
    })
  );

  it("lives in the Weekly Schedule header, not in the plan banner", () => {
    const scheduleHeading = html.indexOf("Weekly Schedule");
    const clearButton = html.indexOf('data-testid="clear-schedule-button"');

    expect(scheduleHeading).toBeGreaterThan(-1);
    expect(clearButton).toBeGreaterThan(-1);
    // A destructive action belongs beside the artifact it destroys, where the
    // student can see what they are about to lose.
    expect(clearButton).toBeGreaterThan(scheduleHeading);

    // And no longer up in the plan-scope banner, which now carries only the
    // plan's identity, its counts, and Export.
    const captureBar = html.indexOf("Capture Sections");
    expect(clearButton).toBeGreaterThan(captureBar);
  });

  it("appears exactly once", () => {
    expect(html.match(/data-testid="clear-schedule-button"/g)).toHaveLength(1);
  });

  it("keeps its confirmation dialog mounted alongside it", () => {
    const confirming = renderToStaticMarkup(
      React.createElement(PlanWorkspace, {
        planSummary,
        plan: planWithSections,
        isLoading: false,
        error: null,
        initialConfirmingClear: true,
        onBack: vi.fn(),
        onRetry: vi.fn(),
      })
    );

    expect(confirming).toContain('data-testid="clear-schedule-dialog"');
    expect(confirming).toContain('data-testid="confirm-clear-schedule"');
  });
});

describe("the section row says what it collides with", () => {
  const online = (day: ScheduleBlock["day"]): ScheduleBlock => ({
    day,
    startMin: 555,
    endMin: 645,
    modality: "ONLINE",
    location: null,
  });

  const catalogSection = (
    courseId: number,
    sectionId: number,
    courseCode: string,
    sectionCode: string,
    blocks: ScheduleBlock[]
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
    enrollCap: 45,
    startDate: "2026-07-10",
    endDate: "2026-12-09",
    firstSeenAt: "2026-08-22T00:00:00Z",
    lastSeenAt: "2026-08-22T00:00:00Z",
    modality: "ONLINE",
    blocks,
    latestSnapshot: {
      capturedAt: "2026-08-22T00:00:00Z",
      enrolled: 45,
      teacher: null,
      remark: null,
    },
  });

  const inPlanSection = (
    courseId: number,
    sectionId: number,
    courseCode: string,
    sectionCode: string,
    blocks: ScheduleBlock[]
  ): PlanSection => ({
    courseId,
    courseCode,
    courseTitle: `${courseCode} Title`,
    sectionId,
    sectionCode,
    pinned: false,
    missing: false,
    modality: "ONLINE",
    blocks,
    latestSnapshot: {
      capturedAt: "2026-08-22T00:00:00Z",
      enrolled: 45,
      teacher: null,
      remark: null,
    },
  });

  function renderPicker(sections: Section[], planSections: PlanSection[]) {
    return renderToStaticMarkup(
      React.createElement(SectionPicker, {
        render: "list",
        courses: [
          {
            courseId: 1,
            code: "GESTSOC",
            title: "GESTSOC Title",
            sectionCount: sections.length,
            firstSeenAt: "2026-08-22T00:00:00Z",
            lastSeenAt: "2026-08-22T00:00:00Z",
          },
        ],
        selectedCourseId: 1,
        sections,
        planSections,
        onSelectCourse: vi.fn(),
        onAddSection: vi.fn(),
        onRemoveSection: vi.fn(),
        onTogglePin: vi.fn(),
        onHoverSection: vi.fn(),
      })
    );
  }

  it("names the section, not a day count", () => {
    const html = renderPicker(
      [catalogSection(1, 10, "GESTSOC", "E06", [online("MON"), online("THU")])],
      [inPlanSection(2, 20, "CSOPESY", "S03", [online("MON")])]
    );

    expect(html).toContain("Conflicts with CSOPESY S03");
    // A quantity the student cannot act on is not what this row is for.
    expect(html).not.toMatch(/Conflict \(\d+ days?\)/);
  });

  it("drops the course code when the collision is a sibling section", () => {
    const html = renderPicker(
      [catalogSection(1, 10, "GESTSOC", "E06", [online("MON"), online("THU")])],
      [inPlanSection(1, 11, "GESTSOC", "Z16", [online("MON"), online("THU")])]
    );

    // The picker is already showing GESTSOC; repeating it says nothing.
    expect(html).toContain("Conflicts with Z16");
    expect(html).not.toContain("Conflicts with GESTSOC Z16");
  });

  it("says nothing when a section is clear", () => {
    const html = renderPicker(
      [catalogSection(1, 10, "GESTSOC", "E06", [online("TUE")])],
      [inPlanSection(2, 20, "CSOPESY", "S03", [online("MON")])]
    );

    expect(html).not.toContain("Conflicts with");
  });
});

describe("plan-state badges are edge-aligned with their controls", () => {
  it("keeps In Plan in the same right-aligned stack as Remove", () => {
    const html = renderToStaticMarkup(
      React.createElement(SectionPicker, {
        render: "list",
        courses: [
          {
            courseId: 2923,
            code: "GEARTAP",
            title: "Great Works",
            sectionCount: 1,
            firstSeenAt: "2026-08-22T00:00:00Z",
            lastSeenAt: "2026-08-22T00:00:00Z",
          },
        ],
        selectedCourseId: 2923,
        sections: [
          {
            campusId: 7,
            sessionId: 155,
            courseId: 2923,
            courseCode: "GEARTAP",
            courseTitle: "Great Works",
            sectionId: 384,
            sectionCode: "S11",
            courseType: "Lecture",
            credits: 3,
            enrollCap: 45,
            startDate: "2026-07-10",
            endDate: "2026-12-09",
            firstSeenAt: "2026-08-22T00:00:00Z",
            lastSeenAt: "2026-08-22T00:00:00Z",
            modality: "F2F",
            blocks: planSection.blocks,
            latestSnapshot: planSection.latestSnapshot,
          },
        ],
        planSections: [planSection],
        onSelectCourse: vi.fn(),
        onAddSection: vi.fn(),
        onRemoveSection: vi.fn(),
        onTogglePin: vi.fn(),
        onHoverSection: vi.fn(),
      })
    );

    // Inline, the badge was stranded mid-row whenever the identity line
    // wrapped and pushed the buttons onto their own line. Sharing one
    // right-aligned column is what makes their edges line up.
    const clusterStart = html.indexOf("items-end");
    expect(clusterStart).toBeGreaterThan(-1);

    const cluster = html.slice(clusterStart);
    const badge = cluster.indexOf("In Plan");
    const remove = cluster.indexOf("Remove");
    expect(badge).toBeGreaterThan(-1);
    expect(remove).toBeGreaterThan(badge);
  });
});

describe("pinned columns clear the app header", () => {
  // AppHeader is `sticky top-0` and `h-16`. Anything else that pins with a
  // smaller offset slides underneath it and loses its top edge — for the week
  // grid column that is the whole "Weekly Schedule / Clear schedule / Export"
  // row.
  it("pins the week grid column below the header, not behind it", () => {
    const html = renderToStaticMarkup(
      React.createElement(PlanWorkspace, {
        planSummary,
        plan: emptyPlan,
        isLoading: false,
        error: null,
        onBack: vi.fn(),
        onRetry: vi.fn(),
      })
    );

    const sticky = html.match(/class="[^"]*lg:sticky[^"]*"/g) ?? [];
    expect(sticky.length).toBeGreaterThan(0);
    for (const cls of sticky) {
      const offset = cls.match(/lg:top-(\d+)/);
      expect(offset, `a pinned column must declare an offset: ${cls}`).not.toBeNull();
      expect(Number(offset![1])).toBeGreaterThanOrEqual(16);
    }
  });
});
