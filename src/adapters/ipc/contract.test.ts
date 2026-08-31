/**
 * Guards the amendment protocol: `docs/ipc-contract.md` is the single source
 * of truth, and the typed client must expose exactly the commands and events
 * it declares — no more, no less. A drifted signature fails here instead of
 * surprising a UI ticket at runtime.
 */
import { describe, expect, it } from "vitest";
import contractSource from "../../../docs/ipc-contract.md?raw";
import clientSource from "./client.ts?raw";
import * as client from "./client";

function contractText(): string {
  return contractSource;
}

function commandsSection(text: string): string {
  const start = text.indexOf("## Commands");
  const end = text.indexOf("## Types");
  expect(start, "contract file must have a Commands section").toBeGreaterThan(-1);
  expect(end, "contract file must have a Types section").toBeGreaterThan(start);
  return text.slice(start, end);
}

function eventsSection(text: string): string {
  const start = text.indexOf("## Events");
  const end = text.indexOf("## Commands");
  expect(start, "contract file must have an Events section").toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return text.slice(start, end);
}

function declaredCommands(text: string): Set<string> {
  const names = new Set<string>();
  for (const line of commandsSection(text).split("\n")) {
    const name = /^\| `([a-z_0-9]+)` \|/.exec(line)?.[1];
    if (name) names.add(name);
  }
  expect(names.size, "no commands found in the contract file").toBeGreaterThan(0);
  return names;
}

function declaredEvents(text: string): Set<string> {
  const names = new Set<string>();
  for (const line of eventsSection(text).split("\n")) {
    const name = /^\| `([a-z_:0-9]+)` \|/.exec(line)?.[1];
    if (name) names.add(name);
  }
  expect(names.size, "no events found in the contract file").toBeGreaterThan(0);
  return names;
}

function camelToSnake(name: string): string {
  return name.replace(/([A-Z])/g, "_$1").toLowerCase();
}

const eventFns = new Map<string, string>([
  ["onCaptureUpdated", "capture:updated"],
  ["onCaptureFailed", "capture:failed"],
  ["onRefreshProgress", "refresh:progress"],
]);

describe("ipc contract", () => {
  it("states the amendment protocol at the top", () => {
    const text = contractText();
    const bodyStart = text.indexOf("## Wire conventions");
    expect(bodyStart).toBeGreaterThan(-1);
    const header = text.slice(0, bodyStart);
    // Markdown blockquotes wrap lines with "> " prefixes; flatten them so the
    // assertion does not depend on line breaks.
    const flattened = header
      .replace(/^> */gm, "")
      .replace(/\s+/g, " ")
      .trim();
    for (const required of [
      "single source of truth",
      "in the same commit",
      "PR description",
      "UI tickets never call a command that is not declared here",
      "build failure",
    ]) {
      expect(flattened, `amendment protocol must mention: ${required}`).toContain(
        required,
      );
    }
  });

  it("exposes exactly the declared commands", () => {
    const declared = declaredCommands(contractText());
    const exported = new Set(Object.keys(client));
    const clientCommands = new Set<string>();
    for (const name of exported) {
      if (eventFns.has(name)) continue;
      clientCommands.add(camelToSnake(name));
    }
    expect(clientCommands).toEqual(declared);
  });

  // Tauri routes a command's arguments by the Rust *parameter* name. Every
  // command that takes a payload declares it as `args: XArgs`, so the client
  // must wrap the payload in an `args` envelope. Sending the fields flat is
  // rejected at runtime with "missing required key args" -- which is what
  // shipped, because both sides were tested only against their own mocks and
  // nothing crossed the real serialization boundary.
  it("wraps every command payload in the args envelope", () => {
    const flat = [...clientSource.matchAll(/invoke\(("[a-z_0-9]+"), args\)/g)].map(
      (match) => match[1],
    );
    expect(
      flat,
      "these commands pass their payload flat; Rust will reject them with " +
        "\"missing required key args\" -- wrap them as invoke(name, { args })",
    ).toEqual([]);
  });

  it("exposes exactly the declared events", () => {
    const declared = declaredEvents(contractText());
    const exported = new Set(Object.keys(client));
    const clientEvents = new Set(
      [...exported].filter((name) => eventFns.has(name)),
    );
    expect(new Set([...clientEvents].map((name) => eventFns.get(name)!))).toEqual(
      declared,
    );
  });
});
