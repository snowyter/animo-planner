/**
 * Behavioral tests for the injected capture script (ticket 10).
 *
 * The script body is a static JS function expression included in the Rust
 * build (`src-tauri/src/adapters/capture_script.js`); these tests execute
 * the exact same source against a minimal fake DOM to pin its behavior:
 * observer wiring, silent capture, content-hash dedupe, and the payload it
 * posts to the loopback endpoint.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import scriptBody from "../../src-tauri/src/adapters/capture_script.js?raw";

interface BootConfig {
  endpoint: string;
  token: string;
  campusId: number;
  sessionId: number;
  hubHost: string;
  selectors: {
    resultsTable: string;
    resultsBody: string;
    courseDropdown: string;
    resultRow: string;
  };
}

const HUB_HOST = "archershub.dlsu.edu.ph";

const defaultConfig: BootConfig = {
  endpoint: "http://127.0.0.1:52134/capture",
  token: "test-token",
  campusId: 7,
  sessionId: 155,
  hubHost: HUB_HOST,
  selectors: {
    resultsTable: "#tblCourseSelection",
    resultsBody: "#tblCourseSelection tbody",
    courseDropdown: "#ddlSelectCourse",
    resultRow: "tbody tr",
  },
};

class FakeElement {
  attrs = new Map<string, string>();
  options: FakeElement[] = [];
  rows: FakeElement[] = [];
  text = "";
  html = "";

  set(attr: string, value: string): this {
    this.attrs.set(attr, value);
    return this;
  }

  get textContent(): string {
    return this.text;
  }

  get outerHTML(): string {
    return this.html;
  }

  getAttribute(name: string): string | null {
    return this.attrs.get(name) ?? null;
  }

  hasAttribute(name: string): boolean {
    return this.attrs.has(name);
  }

  querySelectorAll(selector: string): FakeElement[] {
    if (selector === "option") {
      return this.options;
    }
    if (selector === "tbody tr") {
      return this.rows;
    }
    return [];
  }
}

class FakeDocument {
  bySelector = new Map<string, FakeElement>();
  byId = new Map<string, FakeElement>();

  querySelector(selector: string): FakeElement | null {
    return this.bySelector.get(selector) ?? null;
  }

  getElementById(id: string): FakeElement | null {
    return this.byId.get(id) ?? null;
  }
}

class FakeMutationObserver {
  static instances: FakeMutationObserver[] = [];
  callback: () => void;
  target: unknown = null;
  disconnected = false;

  constructor(callback: () => void) {
    this.callback = callback;
    FakeMutationObserver.instances.push(this);
  }

  observe(target: unknown): void {
    this.target = target;
  }

  disconnect(): void {
    this.disconnected = true;
  }

  fire(): void {
    this.callback();
  }
}

function courseOption(id: number, text: string, selected = false): FakeElement {
  const option = new FakeElement();
  option.set("value", String(id));
  option.text = text;
  if (selected) {
    option.set("selected", "selected");
  }
  return option;
}

const CSINTSY_TEXT = "CSINTSY - INTRODUCTION TO INTELLIGENT SYSTEMS";

function row(html: string): FakeElement {
  const element = new FakeElement();
  element.html = html;
  return element;
}

interface PageParts {
  document: FakeDocument;
  table: FakeElement;
  tbody: FakeElement;
  dropdown: FakeElement;
}

function courseFinderPage(options?: {
  rows?: FakeElement[];
  options?: FakeElement[];
  containerText?: string | null;
  config?: BootConfig;
}): PageParts {
  const config = options?.config ?? defaultConfig;
  const document = new FakeDocument();

  const rows = options?.rows ?? [row("<tr>one row</tr>")];
  const table = new FakeElement();
  table.rows = rows;
  table.html = `<table>${rows.map((r) => r.html).join("")}</table>`;
  document.bySelector.set(config.selectors.resultsTable, table);

  const tbody = new FakeElement();
  document.bySelector.set(config.selectors.resultsBody, tbody);

  const dropdown = new FakeElement();
  dropdown.options =
    options?.options ?? [courseOption(2923, CSINTSY_TEXT)];
  document.bySelector.set(config.selectors.courseDropdown, dropdown);

  if (options?.containerText !== null) {
    // select2 names its rendered container after the select id, exactly
    // the derivation the parser and the script share.
    const dropdownId = config.selectors.courseDropdown.startsWith("#")
      ? config.selectors.courseDropdown.slice(1)
      : config.selectors.courseDropdown;
    const container = new FakeElement();
    container.text = options?.containerText ?? CSINTSY_TEXT;
    document.byId.set(`select2-${dropdownId}-container`, container);
  }

  return { document, table, tbody, dropdown };
}

let fetchMock: ReturnType<typeof vi.fn>;
let fakeWindow: { location: { hostname: string } };

function boot(config: BootConfig = defaultConfig): void {
  const factory = new Function(
    "return (" + scriptBody + ");",
  )() as (bootConfig: BootConfig) => void;
  factory(config);
}

function bootOnPage(config: BootConfig = defaultConfig): PageParts {
  const page = courseFinderPage({ config });
  vi.stubGlobal("document", page.document);
  boot(config);
  return page;
}

function tableObserver(): FakeMutationObserver | undefined {
  return FakeMutationObserver.instances.find((observer) => {
    return (
      !observer.disconnected && observer.target !== null && observer.target !== undefined
    );
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock = vi.fn().mockResolvedValue({ ok: true });
  fakeWindow = { location: { hostname: HUB_HOST } };
  FakeMutationObserver.instances = [];
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("window", fakeWindow);
  vi.stubGlobal("MutationObserver", FakeMutationObserver);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function lastFetchBody(): Record<string, unknown> {
  const calls = fetchMock.mock.calls;
  const call = calls[calls.length - 1];
  if (!call) {
    throw new Error("fetch was never called");
  }
  return JSON.parse(String(call[1]?.body)) as Record<string, unknown>;
}

describe("capture script behavior", () => {
  it("observes the results table body and captures the first render silently", async () => {
    const page = bootOnPage();

    await vi.advanceTimersByTimeAsync(300);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const observer = tableObserver();
    expect(observer).toBeDefined();
    expect(observer?.target).toBe(page.tbody);
  });

  it("posts the plan scope, course identity, and rendered html as the payload", async () => {
    bootOnPage();

    await vi.advanceTimersByTimeAsync(300);

    expect(fetchMock).toHaveBeenCalledWith(defaultConfig.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-token",
      },
      body: expect.any(String),
    });
    const body = lastFetchBody();
    expect(body.campusId).toBe(7);
    expect(body.sessionId).toBe(155);
    expect(body.courseId).toBe(2923);
    expect(body.courseCode).toBe("CSINTSY");
    expect(body.courseTitle).toBe("INTRODUCTION TO INTELLIGENT SYSTEMS");
    expect(body.html).toBe(
      "<table><tr>one row</tr></table>",
    );
  });

  it("debounces a burst of mutations for one render into a single batch", async () => {
    bootOnPage();

    const observer = tableObserver();
    expect(observer).toBeDefined();
    observer?.fire();
    observer?.fire();
    observer?.fire();
    await vi.advanceTimersByTimeAsync(300);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("never posts the same render twice", async () => {
    bootOnPage();
    const observer = tableObserver();
    expect(observer).toBeDefined();

    observer?.fire();
    await vi.advanceTimersByTimeAsync(300);
    observer?.fire();
    await vi.advanceTimersByTimeAsync(300);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("posts a new batch when the render actually changed", async () => {
    const page = bootOnPage();
    const observer = tableObserver();
    expect(observer).toBeDefined();

    observer?.fire();
    await vi.advanceTimersByTimeAsync(300);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    page.table.rows = [row("<tr>one row</tr>"), row("<tr>second row</tr>")];
    page.table.html =
      "<table><tr>one row</tr><tr>second row</tr></table>";
    observer?.fire();
    await vi.advanceTimersByTimeAsync(300);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(lastFetchBody().html).toContain("second row");
  });

  it("retries after a failed post instead of staying deduped forever", async () => {
    fetchMock.mockRejectedValueOnce(new Error("listener down"));
    bootOnPage();
    const observer = tableObserver();
    expect(observer).toBeDefined();

    observer?.fire();
    await vi.advanceTimersByTimeAsync(300);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    observer?.fire();
    await vi.advanceTimersByTimeAsync(300);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("posts nothing when the course selection is unreadable", async () => {
    const page = courseFinderPage({ options: [], containerText: null });
    vi.stubGlobal("document", page.document);
    boot();

    await vi.advanceTimersByTimeAsync(300);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts nothing when the results table has no rows", async () => {
    const page = courseFinderPage({ rows: [] });
    vi.stubGlobal("document", page.document);
    boot();

    await vi.advanceTimersByTimeAsync(300);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reads the selection from the selected option when the select2 container is absent", async () => {
    const page = courseFinderPage({
      containerText: null,
      options: [courseOption(564, "GEARTAP - ART APPRECIATION", true)],
    });
    vi.stubGlobal("document", page.document);
    boot();

    await vi.advanceTimersByTimeAsync(300);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = lastFetchBody();
    expect(body.courseId).toBe(564);
    expect(body.courseCode).toBe("GEARTAP");
  });

  it("does nothing on origins other than the hub", async () => {
    fakeWindow.location.hostname = "evil.example.com";
    const page = courseFinderPage();
    vi.stubGlobal("document", page.document);
    boot();

    await vi.advanceTimersByTimeAsync(300);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(FakeMutationObserver.instances).toHaveLength(0);
  });

  it("uses the selectors from its config, not hardcoded strings", async () => {
    const config: BootConfig = {
      ...defaultConfig,
      selectors: {
        resultsTable: "#customTable",
        resultsBody: "#customTable tbody",
        courseDropdown: "#customDropdown",
        resultRow: "tbody tr",
      },
    };
    const page = courseFinderPage({ config });
    vi.stubGlobal("document", page.document);
    boot(config);

    await vi.advanceTimersByTimeAsync(300);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(lastFetchBody().courseId).toBe(2923);
  });

  it("carries the campus and session the window was opened for", async () => {
    const config: BootConfig = { ...defaultConfig, campusId: 8, sessionId: 156 };
    const page = courseFinderPage({ config });
    vi.stubGlobal("document", page.document);
    boot(config);

    await vi.advanceTimersByTimeAsync(300);

    const body = lastFetchBody();
    expect(body.campusId).toBe(8);
    expect(body.sessionId).toBe(156);
  });
});
