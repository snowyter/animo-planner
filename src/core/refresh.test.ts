import { describe, expect, it } from "vitest";
import {
  formatRefreshProgress,
  formatExpiryMessage,
  formatOfflineMessage,
  formatCompleteMessage,
  getMissingSections,
} from "./refresh";
import type { PlanSection, RefreshOutcome, RefreshProgress, ScheduleBlock } from "../adapters/ipc/types";

describe("core/refresh", () => {
  describe("formatRefreshProgress", () => {
    it("formats progress showing current course, 1-based index of total, and remaining count", () => {
      const progress: RefreshProgress = {
        courseIndex: 0,
        courseTotal: 3,
        courseCode: "CSINTSY",
      };
      expect(formatRefreshProgress(progress)).toBe("Refreshing CSINTSY (1 of 3, 2 remaining)");
    });

    it("formats progress when on the last course", () => {
      const progress: RefreshProgress = {
        courseIndex: 2,
        courseTotal: 3,
        courseCode: "GEARTAP",
      };
      expect(formatRefreshProgress(progress)).toBe("Refreshing GEARTAP (3 of 3, 0 remaining)");
    });

    it("formats progress for a single course plan", () => {
      const progress: RefreshProgress = {
        courseIndex: 0,
        courseTotal: 1,
        courseCode: "CSINTSY",
      };
      expect(formatRefreshProgress(progress)).toBe("Refreshing CSINTSY (1 of 1, 0 remaining)");
    });
  });

  describe("formatExpiryMessage", () => {
    it("formats message when session expired mid-run after some courses", () => {
      const outcome: RefreshOutcome = {
        status: "session_expired",
        refreshedCourses: 2,
        totalCourses: 3,
        haltedAfterCourseCode: "GEARTAP",
      };
      const formatted = formatExpiryMessage(outcome);
      expect(formatted.title).toBe("Session expired — sign in to continue");
      expect(formatted.description).toContain("Refreshed 2 of 3 courses (halted after GEARTAP)");
      expect(formatted.description).toContain("Sign in to Archer's Hub and click Resume to continue");
    });

    it("formats message when session expired on the very first course", () => {
      const outcome: RefreshOutcome = {
        status: "session_expired",
        refreshedCourses: 0,
        totalCourses: 3,
        haltedAfterCourseCode: null,
      };
      const formatted = formatExpiryMessage(outcome);
      expect(formatted.title).toBe("Session expired — sign in to continue");
      expect(formatted.description).toContain("Sign in to Archer's Hub and click Resume to start the refresh");
    });
  });

  describe("formatOfflineMessage", () => {
    it("formats plain offline message stating plan was not changed", () => {
      const message = formatOfflineMessage();
      expect(message).toContain("No network connection");
      expect(message).toContain("plan was not changed");
    });
  });

  describe("formatCompleteMessage", () => {
    it("formats complete outcome message", () => {
      expect(formatCompleteMessage(3, 3)).toBe("Refreshed 3 of 3 courses successfully.");
    });
  });

  describe("getMissingSections", () => {
    const makeSection = (
      courseId: number,
      sectionId: number,
      sectionCode: string,
      missing: boolean
    ): PlanSection => ({
      courseId,
      courseCode: "CSINTSY",
      courseTitle: "Intro to AI",
      sectionId,
      sectionCode,
      pinned: false,
      missing,
      modality: "F2F",
      blocks: [
        {
          day: "MON",
          startMin: 450,
          endMin: 540,
          modality: "F2F",
          location: "L226",
        } as ScheduleBlock,
      ],
      latestSnapshot: {
        capturedAt: "2026-08-24T00:00:00Z",
        enrolled: 40,
        teacher: "Prof A",
        remark: null,
      },
    });

    it("filters and returns only missing sections", () => {
      const s1 = makeSection(1, 101, "S01", false);
      const s2 = makeSection(1, 102, "S02", true);
      const s3 = makeSection(2, 201, "S11", false);
      const s4 = makeSection(2, 202, "S12", true);

      const missing = getMissingSections([s1, s2, s3, s4]);
      expect(missing).toEqual([s2, s4]);
    });

    it("returns empty array when no sections are missing", () => {
      const s1 = makeSection(1, 101, "S01", false);
      expect(getMissingSections([s1])).toEqual([]);
    });
  });
});
