import type { SelectorConfigSource } from "../adapters/ipc/types";

export const DISCLAIMER_TEXT =
  "Animo Plan is a student-built tool with no affiliation to, endorsement by, or connection with De La Salle University. It never enlists, never modifies your records, and never stores your credentials.";

export const PUBLIC_SOURCE_REPO_URL = "https://github.com/snowyter/animo-planner";

export const ISSUE_URL = "https://github.com/snowyter/animo-planner/issues/new";

export const SCRUBBED_FIELDS_NOTICE =
  "Student-identifying field names (`hdnStudId`, `userID`, `IP_ADDRESS`, `MAC_ADDRESS`) and anything shaped like an IP or MAC address have been removed.";

export const MAX_TITLE_CHARS = 100;

export function formatSelectorConfigSource(source: SelectorConfigSource): string {
  return source === "remote" ? "remote" : "bundled";
}

export function buildIssueTitle(error: string): string {
  const firstLine = error.split("\n")[0]?.trim() ?? "parse failed";
  const prefix = "Broken capture: ";
  let title = `${prefix}${firstLine}`;
  if (title.length > MAX_TITLE_CHARS) {
    const stemBudget = Math.max(0, MAX_TITLE_CHARS - (prefix.length + 1));
    const stem = firstLine.slice(0, stemBudget);
    title = `${prefix}${stem}…`;
  }
  return title;
}

export function buildIssueUrl(title: string, body: string): string {
  return `${ISSUE_URL}?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
}

export interface DraftReportInput {
  appVersion: string;
  selectorConfigVersion: string;
  selectorConfigSource: SelectorConfigSource;
  error?: string;
}

export function buildDraftReportBody(input: DraftReportInput): string {
  const lines: string[] = [
    "## Broken capture",
    "",
    "This report was assembled locally by Animo Plan after a failed capture. Nothing was sent anywhere. Please review everything below before opening the issue.",
    "",
    `- Animo Plan version: ${input.appVersion}`,
    `- selector config: v${input.selectorConfigVersion} (${formatSelectorConfigSource(input.selectorConfigSource)})`,
  ];

  if (input.error) {
    lines.push("", "### Parse error", "", "```text", input.error.trimEnd(), "```");
  }

  return lines.join("\n");
}
