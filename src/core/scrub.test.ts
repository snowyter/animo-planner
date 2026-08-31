import { describe, expect, it } from "vitest";
import { findScrubViolations } from "./scrub";

const fixtures = import.meta.glob("../../src-tauri/tests/fixtures/*.html", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const agreementFixture = JSON.parse(
  import.meta.glob("../../src-tauri/tests/fixtures/scrub-agreement.json", {
    query: "?raw",
    import: "default",
    eager: true,
  })["../../src-tauri/tests/fixtures/scrub-agreement.json"] as string
) as {
  description: string;
  cases: { name: string; input: string; violations: number }[];
};

describe("scrub agreement with scrub.rs (ticket 51)", () => {
  it("carries the shared fixture", () => {
    expect(agreementFixture.cases.length).toBeGreaterThan(0);
  });

  it.each(agreementFixture.cases.map((c) => [c.name, c.input, c.violations] as const))(
    "%s",
    (_name, input, violations) => {
      expect(findScrubViolations(input)).toHaveLength(violations);
    }
  );
});

describe("findScrubViolations", () => {
  it("returns no violations for clean HTML", () => {
    expect(findScrubViolations("<p>fine</p>")).toEqual([]);
  });

  it("flags the four student-identifying field names", () => {
    for (const name of ["hdnStudId", "userID", "IP_ADDRESS", "MAC_ADDRESS"]) {
      expect(findScrubViolations(`<input id="${name}" value="x">`)).not.toEqual(
        []
      );
    }
  });

  it("flags an IPv4-shaped value", () => {
    expect(findScrubViolations("<p>149.30.146.213</p>")).not.toEqual([]);
  });

  it("flags MAC-shaped values in colon, hyphen, and bare forms", () => {
    for (const mac of [
      "60:45:BD:1B:55:13",
      "60-45-BD-1B-55-13",
      "6045BD1B5513",
    ]) {
      expect(findScrubViolations(`<p>${mac}</p>`)).not.toEqual([]);
    }
  });

  it("does not flag invalid octets or values that merely look dotted", () => {
    expect(findScrubViolations("<p>256.1.1.1</p>")).toEqual([]);
    expect(findScrubViolations("<p>fullcalendar@6.1.14</p>")).toEqual([]);
  });

  it("does not flag dates, separators, or long hex-free digit runs", () => {
    expect(findScrubViolations("<p>22/08/2026 05:17:36</p>")).toEqual([]);
    expect(findScrubViolations('<p data-key="2923%7C384%7C"></p>')).toEqual(
      []
    );
    expect(findScrubViolations("<p>08202025065710966</p>")).toEqual([]);
  });
});

describe("committed Course Finder fixtures", () => {
  const fixtureEntries = Object.entries(fixtures);

  it("contains both captures", () => {
    const names = fixtureEntries.map(([key]) => key);
    expect(names.some((key) => key.includes("CSINTSY"))).toBe(true);
    expect(names.some((key) => key.includes("GEARTAP"))).toBe(true);
  });

  it("contains no student-identifying data", () => {
    expect(fixtureEntries.length).toBeGreaterThan(0);
    for (const [key, html] of fixtureEntries) {
      expect(findScrubViolations(html), `violations in ${key}`).toEqual([]);
    }
  });

  it("keeps the parser-critical markup intact", () => {
    expect(fixtureEntries.length).toBeGreaterThan(0);
    for (const html of Object.values(fixtures)) {
      expect(html).toContain('id="tblCourseSelection"');
      expect(html).toContain('id="ddlSelectCourse"');
      expect(html).toContain("select2-ddlSelectCourse-container");
      expect(html).toContain("data-start-date");
      expect(html).toContain("data-end-date");
      expect(html).toContain("data-key=");
      expect(html).toContain("<td hidden");
    }
  });

  it("preserves the selected course identity in each capture", () => {
    expect(fixtureHtml("CSINTSY")).toContain(
      'title="CSINTSY - INTRODUCTION TO INTELLIGENT SYSTEMS"'
    );
    expect(fixtureHtml("GEARTAP")).toContain('title="GEARTAP - ART APPRECIATION"');
  });

  it("preserves every section row", () => {
    expect(rowCount("CSINTSY")).toBe(5);
    expect(rowCount("GEARTAP")).toBe(42);
  });
});

function fixtureHtml(course: string): string {
  const entry = Object.entries(fixtures).find(([key]) => key.includes(course));
  expect(entry, `fixture for ${course}`).toBeDefined();
  return entry?.[1] ?? "";
}

function rowCount(course: string): number {
  return (fixtureHtml(course).match(/<tr data-/g) ?? []).length;
}
