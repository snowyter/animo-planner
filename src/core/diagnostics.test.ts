import { describe, expect, it } from "vitest";
import {
  DISCLAIMER_TEXT,
  PUBLIC_SOURCE_REPO_URL,
  SCRUBBED_FIELDS_NOTICE,
  formatSelectorConfigSource,
  buildIssueUrl,
  buildDraftReportBody,
  buildIssueTitle,
} from "./diagnostics";

describe("diagnostics domain logic", () => {
  it("contains the verbatim disclaimer text", () => {
    expect(DISCLAIMER_TEXT).toBe(
      "Animo Plan is a student-built tool with no affiliation to, endorsement by, or connection with De La Salle University. It never enlists, never modifies your records, and never stores your credentials."
    );
    expect(DISCLAIMER_TEXT).toMatch(/student-built tool with no affiliation to, endorsement by, or connection with/i);
    expect(DISCLAIMER_TEXT).toMatch(/never enlists, never modifies (?:your )?records, and never stores (?:your )?credentials/i);
  });

  it("points to the public source repository URL", () => {
    expect(PUBLIC_SOURCE_REPO_URL).toBe("https://github.com/snowyter/animo-planner");
  });

  it("formats selector config source accurately for remote and bundled", () => {
    expect(formatSelectorConfigSource("remote")).toMatch(/remote/i);
    expect(formatSelectorConfigSource("bundled")).toMatch(/bundled/i);
  });

  it("states plainly which student-identifying fields and patterns are scrubbed", () => {
    expect(SCRUBBED_FIELDS_NOTICE).toContain("hdnStudId");
    expect(SCRUBBED_FIELDS_NOTICE).toContain("userID");
    expect(SCRUBBED_FIELDS_NOTICE).toContain("IP_ADDRESS");
    expect(SCRUBBED_FIELDS_NOTICE).toContain("MAC_ADDRESS");
    expect(SCRUBBED_FIELDS_NOTICE).toMatch(/IP|IPv4/);
    expect(SCRUBBED_FIELDS_NOTICE).toMatch(/MAC/);
  });

  it("builds a pre-filled GitHub issue URL with percent-encoded title and body", () => {
    const title = "Broken capture: table not found";
    const body = "## Broken capture\n\n- Version: 0.1.0\n- Config: v1 (bundled)";
    const url = buildIssueUrl(title, body);

    expect(url).toContain("https://github.com/snowyter/animo-planner/issues/new");
    expect(url).toContain("title=Broken%20capture%3A%20table%20not%20found");
    expect(url).toContain("body=");
    expect(url).toContain("Version%3A%200.1.0");
  });

  it("builds a concise title capped to scannable length", () => {
    const shortTitle = buildIssueTitle("Table not found in Course Finder");
    expect(shortTitle).toBe("Broken capture: Table not found in Course Finder");

    const longError = "A".repeat(200);
    const cappedTitle = buildIssueTitle(longError);
    expect(cappedTitle.length).toBeLessThanOrEqual(100);
    expect(cappedTitle.endsWith("…")).toBe(true);
  });

  it("builds draft report body when assembling a local report", () => {
    const body = buildDraftReportBody({
      appVersion: "0.1.0",
      selectorConfigVersion: "1",
      selectorConfigSource: "bundled",
      error: "Could not locate course selection table",
    });

    expect(body).toContain("Animo Plan version: 0.1.0");
    expect(body).toContain("selector config: v1 (bundled)");
    expect(body).toContain("Could not locate course selection table");
    expect(body).toContain("Nothing was sent anywhere");
  });
});
