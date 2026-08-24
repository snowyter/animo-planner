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
    isSample: false,
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
      teacher: "Prof X",
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

  it("renders self-describing export container with plan name, campus, term, and week grid", () => {
    const html = renderToStaticMarkup(
      React.createElement(ExportMenu, {
        planSummary: mockPlanSummary,
        plan: mockPlan,
        conflicts: mockConflicts,
      })
    );

    expect(html).toContain("T1 Target Schedule");
    expect(html).toContain("Manila");
    expect(html).toContain("AY2026-27 T1");
    expect(html).toContain("GEARTAP");
    expect(html).toContain("CSINTSY");
    expect(html).toContain("1 conflict");
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
      blob: blob!,
      types: [{ description: "PNG Image (.png)", accept: { "image/png": [".png"] } }],
    });

    expect(onSaveFile).toHaveBeenCalledWith(
      expect.objectContaining({
        suggestedName: "T1 Target Schedule - AY2026-27 T1.png",
      })
    );
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
});
