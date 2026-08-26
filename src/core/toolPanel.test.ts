/**
 * Ticket 46 — the tool panel's pure part.
 *
 * The tabs' identity, their order, and the signal a tab carries when the
 * catalog behind it is empty are decisions, not markup. They live here so the
 * panel and its triggers cannot disagree about them.
 */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_TOOL_TAB,
  TOOL_TABS,
  formatEmptyCatalogSignal,
  formatEmptyCatalogHint,
  isToolTab,
  resolveToolTab,
} from "./toolPanel";

describe("tool tabs", () => {
  it("orders the tools the way the work happens: capture, then solve, then pick", () => {
    expect(TOOL_TABS.map((t) => t.tab)).toEqual(["capture", "solve", "pick"]);
  });

  it("labels each tab with the word the ticket names it by", () => {
    expect(TOOL_TABS.map((t) => t.label)).toEqual(["Capture", "Solve", "Pick"]);
  });

  it("opens on Capture, the arrival surface", () => {
    expect(DEFAULT_TOOL_TAB).toBe("capture");
  });

  it("recognises exactly the three tabs", () => {
    expect(isToolTab("capture")).toBe(true);
    expect(isToolTab("solve")).toBe(true);
    expect(isToolTab("pick")).toBe(true);
    expect(isToolTab("grid")).toBe(false);
    expect(isToolTab("")).toBe(false);
  });

  it("falls back to the default rather than blanking the panel on an unknown tab", () => {
    expect(resolveToolTab("pick")).toBe("pick");
    expect(resolveToolTab("grid")).toBe(DEFAULT_TOOL_TAB);
    expect(resolveToolTab(undefined)).toBe(DEFAULT_TOOL_TAB);
  });
});

describe("the empty-catalog signal", () => {
  // Tabs hide state. A student sitting on Pick with nothing captured must be
  // told which tab fixes it, and the Capture tab must say so from its trigger.
  it("marks the Capture trigger while the catalog is empty", () => {
    expect(formatEmptyCatalogSignal(0)).toBe("Empty");
  });

  it("says nothing once a course has landed", () => {
    expect(formatEmptyCatalogSignal(1)).toBeNull();
    expect(formatEmptyCatalogSignal(8)).toBeNull();
  });

  it("points an empty Pick tab at the tab that fixes it, by name", () => {
    const hint = formatEmptyCatalogHint();
    expect(hint).toContain("Capture");
    expect(hint).toMatch(/Archer/i);
  });
});
