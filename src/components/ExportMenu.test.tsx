import { describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ExportMenu } from "./ExportMenu";
import type {
  Conflict,
  IcsExport,
  Plan,
  PlanSection,
  PlanSummary,
  ScheduleBlock,
} from "../adapters/ipc/types";
import { isAbortError } from "../core/export";


/** Unwraps a fixture value the literals above guarantee exists. */
function mustExist<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("fixture value must exist");
  return value;
}

/**
 * Unwraps a capture group an assertion above guarantees was matched —
 * the proof that no non-null assertion is needed anywhere in this suite.
 */
function matchGroup(match: RegExpExecArray | RegExpMatchArray | null, index: number): string {
  if (!match?.[index]) throw new Error("expected a regexp match");
  return match[index] as string;
}

describe("ExportMenu", () => {
  const mockPlanSummary: PlanSummary = {
    id: "plan-123",
    name: "T1 Target Schedule",
    campusId: 7,
    campusName: "Manila",
    sessionId: 155,
    sessionName: "AY2026-27 T1",
    createdAt: "2026-08-22T00:00:00Z",
    sectionCount: 2,
  };

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
      enrolled: 42,
      professor: "Prof X",
      remark: null,
    },
  });

  const sectionA = makeSection(2923, 384, "GEARTAP", "S11", [
    makeBlock("MON", 450, 540, "F2F", "L226"),
    makeBlock("THU", 450, 540, "ONLINE"),
  ]);

  const sectionB = makeSection(564, 737, "CSINTSY", "Z01", [
    makeBlock("MON", 480, 570, "ONLINE"),
  ]);

  const mockPlan: Plan = {
    ...mockPlanSummary,
    sections: [sectionA, sectionB],
  };

  const mockConflicts: Conflict[] = [
    {
      a: { courseId: 2923, sectionId: 384 },
      b: { courseId: 564, sectionId: 737 },
      day: "MON",
      startMin: 480,
      endMin: 540,
    },
  ];

  it("renders export trigger button in closed state", () => {
    const html = renderToStaticMarkup(
      React.createElement(ExportMenu, {
        planSummary: mockPlanSummary,
        plan: mockPlan,
        conflicts: mockConflicts,
      })
    );

    expect(html).toContain("Export");
  });

  it("renders dropdown menu options when open", () => {
    const html = renderToStaticMarkup(
      React.createElement(ExportMenu, {
        planSummary: mockPlanSummary,
        plan: mockPlan,
        conflicts: mockConflicts,
        defaultOpen: true,
      })
    );

    expect(html).toContain("Export Plan");
    expect(html).toContain("Calendar file (.ics)");
    expect(html).toContain("Schedule image (.png)");
  });

  it("renders export image header with only the academic year and term as title, omitting plan name, campus, and section count", () => {
    const html = renderToStaticMarkup(
      React.createElement(ExportMenu, {
        planSummary: mockPlanSummary,
        plan: mockPlan,
        conflicts: mockConflicts,
      })
    );

    // Extract export-canvas HTML substring
    const canvasHtml = html.substring(html.indexOf('data-testid="export-canvas"'));

    // Title is the session name
    expect(canvasHtml).toContain("AY2026-27 T1");

    // Grid contents are present
    expect(canvasHtml).toContain("GEARTAP");
    expect(canvasHtml).toContain("CSINTSY");

    // Chrome is removed: plan name, campus, section count, app tag
    expect(canvasHtml).not.toContain("T1 Target Schedule");
    expect(canvasHtml).not.toContain("Manila");
    expect(canvasHtml).not.toContain("Animo Plan");
    expect(canvasHtml).not.toContain("DLSU Enlistment Schedule");
    expect(canvasHtml).not.toContain("2 sections");
  });

  it("renders section remarks in exported PNG canvas element for disambiguation", () => {
    const peSectionA: PlanSection = {
      ...sectionA,
      courseCode: "PETHREE",
      sectionCode: "Y16H",
      latestSnapshot: {
        capturedAt: "2026-08-28T00:00:00Z",
        enrolled: 42,
        professor: "Prof Coach",
        remark: "PICKLEBALL",
      },
    };

    const peSectionB: PlanSection = {
      ...sectionB,
      courseCode: "PETHREE",
      sectionCode: "Y07K",
      latestSnapshot: {
        capturedAt: "2026-08-28T00:00:00Z",
        enrolled: 45,
        professor: "Prof Swimmer",
        remark: "SWIMMING",
      },
    };

    const pePlan: Plan = {
      ...mockPlanSummary,
      sections: [peSectionA, peSectionB],
    };

    const html = renderToStaticMarkup(
      React.createElement(ExportMenu, {
        planSummary: mockPlanSummary,
        plan: pePlan,
        conflicts: [],
      })
    );

    const canvasHtml = html.substring(html.indexOf('data-testid="export-canvas"'));
    expect(canvasHtml).toContain("PICKLEBALL");
    expect(canvasHtml).toContain("SWIMMING");
    expect(canvasHtml).toContain("PETHREE");
  });

  it("renders conflict warning in exported image when conflicts exist", () => {
    const html = renderToStaticMarkup(
      React.createElement(ExportMenu, {
        planSummary: mockPlanSummary,
        plan: mockPlan,
        conflicts: mockConflicts,
      })
    );

    const canvasHtml = html.substring(html.indexOf('data-testid="export-canvas"'));
    expect(canvasHtml).toContain("1 conflict");

    const multiConflicts: Conflict[] = [
      mustExist(mockConflicts[0]),
      {
        a: { courseId: 1, sectionId: 2 },
        b: { courseId: 3, sectionId: 4 },
        day: "TUE",
        startMin: 450,
        endMin: 540,
      },
    ];
    const multiHtml = renderToStaticMarkup(
      React.createElement(ExportMenu, {
        planSummary: mockPlanSummary,
        plan: mockPlan,
        conflicts: multiConflicts,
      })
    );
    const multiCanvasHtml = multiHtml.substring(multiHtml.indexOf('data-testid="export-canvas"'));
    expect(multiCanvasHtml).toContain("2 conflicts");
  });

  it("omits conflict warning completely in exported image when plan has no conflicts", () => {
    const html = renderToStaticMarkup(
      React.createElement(ExportMenu, {
        planSummary: mockPlanSummary,
        plan: mockPlan,
        conflicts: [],
      })
    );

    const canvasHtml = html.substring(html.indexOf('data-testid="export-canvas"'));
    expect(canvasHtml).not.toMatch(/\b\d+\s+conflicts?\b/);
    expect(canvasHtml).not.toContain("No conflicts");
  });

  it("renders long session name as title in exported image without extra chrome", () => {
    const longSummary: PlanSummary = {
      ...mockPlanSummary,
      sessionName: "Academic Year 2026-2027 Trimester 1 (Undergraduate Regular Session)",
    };

    const html = renderToStaticMarkup(
      React.createElement(ExportMenu, {
        planSummary: longSummary,
        plan: { ...mockPlan, sessionName: longSummary.sessionName },
        conflicts: [],
      })
    );

    const canvasHtml = html.substring(html.indexOf('data-testid="export-canvas"'));
    expect(canvasHtml).toContain("Academic Year 2026-2027 Trimester 1 (Undergraduate Regular Session)");
    expect(canvasHtml).not.toContain("T1 Target Schedule");
    expect(canvasHtml).not.toContain("Manila");
    expect(canvasHtml).not.toContain("No conflicts");
  });

  it("isolates off-screen positioning on wrapper and keeps export canvas statically positioned without negative coordinates", () => {
    const html = renderToStaticMarkup(
      React.createElement(ExportMenu, {
        planSummary: mockPlanSummary,
        plan: mockPlan,
        conflicts: mockConflicts,
      })
    );

    // Wrapper carries off-screen positioning and accessibility hiding
    expect(html).toMatch(/data-testid="export-wrapper"[^>]*style="[^"]*position:\s*fixed/);
    expect(html).toMatch(/data-testid="export-wrapper"[^>]*style="[^"]*left:\s*-9999px/);
    expect(html).toMatch(/data-testid="export-wrapper"[^>]*aria-hidden="true"/);

    // Canvas element handed to image library must have fixed 1200px width and light theme,
    // but NO off-screen positioning or negative coordinates so cloned computed styles stay in frame
    const canvasMatch = html.match(/<div[^>]*data-testid="export-canvas"[^>]*style="([^"]*)"/);
    expect(canvasMatch).not.toBeNull();
    const canvasStyle = matchGroup(canvasMatch, 1);
    expect(canvasStyle).toMatch(/width:\s*1200px/);
    expect(canvasStyle).toMatch(/background-color:\s*#ffffff/);
    expect(canvasStyle).not.toContain("fixed");
    expect(canvasStyle).not.toContain("absolute");
    expect(canvasStyle).not.toContain("-9999px");

    // Canvas is nested inside the offscreen wrapper
    const wrapperIndex = html.indexOf('data-testid="export-wrapper"');
    const canvasIndex = html.indexOf('data-testid="export-canvas"');
    expect(wrapperIndex).toBeGreaterThan(-1);
    expect(canvasIndex).toBeGreaterThan(wrapperIndex);
  });

  it("renders readable export container for an empty plan with only title and empty grid", () => {
    const emptyPlan: Plan = {
      ...mockPlanSummary,
      sectionCount: 0,
      sections: [],
    };

    const html = renderToStaticMarkup(
      React.createElement(ExportMenu, {
        planSummary: { ...mockPlanSummary, sectionCount: 0 },
        plan: emptyPlan,
        conflicts: [],
      })
    );

    const canvasHtml = html.substring(html.indexOf('data-testid="export-canvas"'));
    expect(canvasHtml).toContain("AY2026-27 T1");
    expect(canvasHtml).not.toContain("T1 Target Schedule");
    expect(canvasHtml).not.toContain("Manila");
    expect(canvasHtml).not.toContain("0 sections");
    expect(canvasHtml).not.toContain("No conflicts");
    expect(canvasHtml).not.toContain("Animo Plan");
  });

  it("calls calendar export with sensible default filename derived from plan name and term", async () => {
    const onExportIcs = vi.fn().mockResolvedValue({
      fileName: "T1 Target Schedule.ics",
      contents: "BEGIN:VCALENDAR\nEND:VCALENDAR",
    } as IcsExport);

    const onSaveFile = vi.fn().mockResolvedValue(undefined);

    const result = await onExportIcs(mockPlan.id);
    expect(result.contents).toContain("BEGIN:VCALENDAR");
    expect(onExportIcs).toHaveBeenCalledWith("plan-123");

    await onSaveFile({
      suggestedName: "T1 Target Schedule - AY2026-27 T1.ics",
      blob: new Blob([result.contents]),
      types: [{ description: "iCalendar File (.ics)", accept: { "text/calendar": [".ics"] } }],
    });

    expect(onSaveFile).toHaveBeenCalledWith(
      expect.objectContaining({
        suggestedName: "T1 Target Schedule - AY2026-27 T1.ics",
      })
    );
  });

  it("calls image export with sensible default filename derived from plan name and term", async () => {
    const onGenerateImage = vi.fn().mockResolvedValue(new Blob(["dummy-png-data"], { type: "image/png" }));
    const onSaveFile = vi.fn().mockResolvedValue(undefined);

    const dummyElement = {} as HTMLElement;
    const blob = await onGenerateImage(dummyElement);
    expect(blob).not.toBeNull();

    await onSaveFile({
      suggestedName: "T1 Target Schedule - AY2026-27 T1.png",
      blob:       mustExist(blob),
      types: [{ description: "PNG Image (.png)", accept: { "image/png": [".png"] } }],
    });

    expect(onSaveFile).toHaveBeenCalledWith(
      expect.objectContaining({
        suggestedName: "T1 Target Schedule - AY2026-27 T1.png",
      })
    );
  });

  it("handles image generation failure when onGenerateImage returns null without saving file", async () => {
    const onGenerateImage = vi.fn().mockResolvedValue(null);
    const onSaveFile = vi.fn().mockResolvedValue(undefined);

    const dummyElement = {} as HTMLElement;
    const blob = await onGenerateImage(dummyElement);
    expect(blob).toBeNull();

    let errorThrown = false;
    if (!blob) {
      errorThrown = true;
    } else {
      await onSaveFile({
        suggestedName: "T1 Target Schedule - AY2026-27 T1.png",
        blob,
        types: [{ description: "PNG Image (.png)", accept: { "image/png": [".png"] } }],
      });
    }

    expect(errorThrown).toBe(true);
    expect(onSaveFile).not.toHaveBeenCalled();
  });

  it("handles image generation failure when onGenerateImage throws without saving file", async () => {
    const onGenerateImage = vi.fn().mockRejectedValue(new Error("Canvas allocation failed"));
    const onSaveFile = vi.fn().mockResolvedValue(undefined);

    const dummyElement = {} as HTMLElement;
    let caughtError: unknown = null;
    try {
      await onGenerateImage(dummyElement);
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).toBeInstanceOf(Error);
    expect((caughtError as Error).message).toBe("Canvas allocation failed");
    expect(onSaveFile).not.toHaveBeenCalled();
  });

  it("handles cancel in file picker quietly without surfacing error", async () => {
    const abortErr = new DOMException("The user aborted a request.", "AbortError");
    expect(isAbortError(abortErr)).toBe(true);

    const onSaveFile = vi.fn().mockRejectedValue(abortErr);

    let caughtError: unknown = null;
    try {
      await onSaveFile({
        suggestedName: "test.ics",
        blob: new Blob([]),
        types: [],
      });
    } catch (e) {
      if (!isAbortError(e)) {
        caughtError = e;
      }
    }

    expect(caughtError).toBeNull();
  });

  it("identifies real non-abort errors as not suppressed", async () => {
    const realErr = new Error("Disk full");
    expect(isAbortError(realErr)).toBe(false);

    const onSaveFile = vi.fn().mockRejectedValue(realErr);

    let caughtError: unknown = null;
    try {
      await onSaveFile({
        suggestedName: "test.ics",
        blob: new Blob([]),
        types: [],
      });
    } catch (e) {
      if (!isAbortError(e)) {
        caughtError = e;
      }
    }

    expect(caughtError).toBe(realErr);
  });

  it("renders export week grid with interactive=false and no menu affordances", () => {
    const html = renderToStaticMarkup(
      React.createElement(ExportMenu, {
        planSummary: mockPlanSummary,
        plan: mockPlan,
        conflicts: mockConflicts,
      })
    );

    // Image export container does not have focusable interactive blocks or context menus
    expect(html).not.toContain('data-testid="grid-context-menu"');
  });
});

