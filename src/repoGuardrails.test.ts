/**
 * Repo guardrails (ticket 51).
 *
 * Finding 0: `.codebuddy/` was in `.gitignore` but not in eslint's ignores,
 * eslint linted an agent-tool file, and — because `verify` chains with `&&`
 * — the failing lint step silently swallowed the entire Rust half of
 * `npm run verify`. Everything still looked fine. These tests pin the two
 * invariants that would have caught it: the ignore lists cannot drift, and
 * the verify chain cannot lose its last link.
 *
 * The rule for "directory entry" is syntactic: a trailing slash, a `*` in
 * the final segment, or no `.` in the final segment. That deliberately
 * skips file entries (`.env`, `*.key`, the raw capture HTML) — eslint never
 * lints them — and cannot tell the directory `.idea` from the file `.env`;
 * a hidden directory named without a wildcard is out of the rule's reach
 * and must be ignored in eslint.config.js by hand if it ever matters.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

function readRepoFile(name: string): string {
  return readFileSync(new URL(`../${name}`, import.meta.url), "utf8");
}

/** A `.gitignore` entry that names a directory rather than a file. */
function namesDirectory(entry: string): boolean {
  const withoutTrailingSlash = entry.replace(/\/+$/, "");
  if (entry.endsWith("/")) return true;
  const finalSegment = withoutTrailingSlash.split("/").pop() ?? "";
  return !finalSegment.includes(".");
}

/** The top-level path a gitignore entry is anchored at. */
function anchorSegment(entry: string): string {
  return entry.replace(/\/+$/, "").split("/")[0] ?? entry;
}

const gitignoreEntries = readRepoFile(".gitignore")
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line.length > 0 && !line.startsWith("#") && !line.startsWith("!"));

const eslintIgnoresSource = /ignores:\s*\[([^\]]*)\]/.exec(readRepoFile("eslint.config.js"))?.[1];
if (!eslintIgnoresSource) {
  throw new Error("eslint.config.js must declare an ignores array");
}
const eslintIgnores: string[] = [...eslintIgnoresSource.matchAll(/"([^"]+)"/g)].map(
  (match) => match[1] ?? ""
);

describe("the ignore lists stay in step (ticket 51)", () => {
  it("carries both sides", () => {
    expect(gitignoreEntries.length).toBeGreaterThan(0);
    expect(eslintIgnores.length).toBeGreaterThan(0);
  });

  it("eslint ignores every directory .gitignore ignores", () => {
    const directories = gitignoreEntries.filter(namesDirectory);
    expect(directories.length).toBeGreaterThan(0);

    for (const entry of directories) {
      const anchor = anchorSegment(entry);
      const covered = eslintIgnores.some(
        (ignore) => ignore === anchor || ignore.startsWith(`${anchor}/`)
      );
      expect(covered, `${entry} (anchored at ${anchor}) must be eslint-ignored`).toBe(
        true
      );
    }
  });
});

describe("npm run verify reaches the Rust half (ticket 51)", () => {
  const pkg = JSON.parse(readRepoFile("package.json")) as { scripts: Record<string, string> };
  const verify = pkg.scripts.verify;
  if (!verify) throw new Error("package.json must define a verify script");

  it("chains verify:rust after the web steps with no swallowed failures", () => {
    const steps = verify.split("&&").map((step) => step.trim());
    expect(steps, "verify must chain its steps with &&").toContain("npm run verify:rust");
    for (const step of steps) {
      expect(step, `no step may swallow its own failure: ${step}`).not.toContain("||");
    }
  });

  it("verify:rust runs clippy and the tests in both feature configurations", () => {
    const rust = pkg.scripts["verify:rust"];
    if (!rust) throw new Error("package.json must define a verify:rust script");
    expect(rust).toContain("cargo clippy");
    expect(rust).toContain("cargo test");
    expect(rust).toContain("--no-default-features");
  });
});
