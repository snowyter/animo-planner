import { describe, expect, it } from "vitest";
import {
  formatCaptureCounter,
  formatCapturedAge,
  formatCatalogFreshness,
} from "./capture";

describe("capture core utilities", () => {
  describe("formatCaptureCounter", () => {
    it("formats 0 sections and 0 courses with plural nouns", () => {
      expect(formatCaptureCounter(0, 0)).toBe("0 sections from 0 courses");
    });

    it("formats singular section and course", () => {
      expect(formatCaptureCounter(1, 1)).toBe("1 section from 1 course");
    });

    it("formats plural sections and singular course", () => {
      expect(formatCaptureCounter(2, 1)).toBe("2 sections from 1 course");
      expect(formatCaptureCounter(42, 1)).toBe("42 sections from 1 course");
    });

    it("formats singular section and plural courses", () => {
      expect(formatCaptureCounter(1, 2)).toBe("1 section from 2 courses");
    });

    it("formats plural sections and plural courses matching SPEC §4 format", () => {
      expect(formatCaptureCounter(42, 8)).toBe("42 sections from 8 courses");
      expect(formatCaptureCounter(12, 3)).toBe("12 sections from 3 courses");
    });
  });

  /**
   * Ticket 46 — the Capture tab is the arrival surface: what landed, when,
   * how fresh. Enrolment counts move during enlistment week, so how old a
   * capture is decides whether it is worth trusting.
   */
  describe("formatCapturedAge", () => {
    const now = new Date("2026-08-22T12:00:00Z");

    it("reads a capture from the last minute as just now", () => {
      expect(formatCapturedAge("2026-08-22T11:59:30Z", now)).toBe("captured just now");
    });

    it("counts minutes inside the hour", () => {
      expect(formatCapturedAge("2026-08-22T11:45:00Z", now)).toBe("captured 15m ago");
      expect(formatCapturedAge("2026-08-22T11:59:00Z", now)).toBe("captured 1m ago");
    });

    it("counts hours inside the day", () => {
      expect(formatCapturedAge("2026-08-22T09:00:00Z", now)).toBe("captured 3h ago");
    });

    it("counts days beyond that", () => {
      expect(formatCapturedAge("2026-08-20T12:00:00Z", now)).toBe("captured 2d ago");
      expect(formatCapturedAge("2026-08-21T12:00:00Z", now)).toBe("captured 1d ago");
    });

    it("says the age is unknown rather than inventing one", () => {
      expect(formatCapturedAge("", now)).toBe("captured at an unknown time");
      expect(formatCapturedAge("not a date", now)).toBe("captured at an unknown time");
    });

    it("never reports a capture from the future as an age", () => {
      // Clock skew between the machine and a stored timestamp is not
      // information about freshness.
      expect(formatCapturedAge("2026-08-22T12:30:00Z", now)).toBe("captured just now");
    });
  });

  /**
   * A capture and a refresh both advance `lastSeenAt`, so the catalog could
   * not say which act produced the numbers on screen. The one the student
   * pressed is the one worth naming.
   */
  describe("formatCatalogFreshness", () => {
    const now = new Date("2026-08-22T12:00:00Z");

    it("says captured when the course has only ever been captured", () => {
      expect(
        formatCatalogFreshness(
          { lastSeenAt: "2026-08-22T11:55:00Z", lastRefreshedAt: null },
          now
        )
      ).toBe("captured 5m ago");
    });

    it("says refreshed when a refresh is the last thing that touched it", () => {
      expect(
        formatCatalogFreshness(
          {
            lastSeenAt: "2026-08-22T10:00:00Z",
            lastRefreshedAt: "2026-08-22T10:00:00Z",
          },
          now
        )
      ).toBe("refreshed 2h ago");
    });

    it("says captured again when a later capture followed the refresh", () => {
      // Searching the course again in Course Finder is a capture, and it is
      // the more recent act — naming the older refresh would be a lie about
      // where the numbers came from.
      expect(
        formatCatalogFreshness(
          {
            lastSeenAt: "2026-08-22T11:30:00Z",
            lastRefreshedAt: "2026-08-22T09:00:00Z",
          },
          now
        )
      ).toBe("captured 30m ago");
    });

    it("reports the age from the act it names, not from the other one", () => {
      expect(
        formatCatalogFreshness(
          {
            lastSeenAt: "2026-08-20T12:00:00Z",
            lastRefreshedAt: "2026-08-20T12:00:00Z",
          },
          now
        )
      ).toBe("refreshed 2d ago");
    });

    it("stays honest when the timestamp cannot be read", () => {
      expect(
        formatCatalogFreshness({ lastSeenAt: "", lastRefreshedAt: null }, now)
      ).toBe("captured at an unknown time");
    });
  });
});
