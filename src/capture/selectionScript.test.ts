/**
 * Behavioral tests for the popup-selection script (ticket 26).
 *
 * The script body is a static JS function expression included in the Rust
 * build (`src-tauri/src/adapters/selection_script.js`); these tests execute
 * the exact same source against a minimal fake DOM to pin the only page
 * interaction a refresh is allowed to make: selecting one course so the
 * page actually searches — select2 included — and nothing else.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import scriptBody from "../../src-tauri/src/adapters/selection_script.js?raw";

const FORCE_FLAG = "__animoPlanForceNextCapture";

interface SelectionTask {
  dropdownSelector: string;
  courseId: number;
  forceFlag: string;
}

class FakeOption {
  constructor(
    public value: string,
    public text: string,
  ) {}
}

class FakeDropdown {
  options: FakeOption[] = [];
  selectedIndex = -1;
  dispatched: Event[] = [];

  dispatchEvent(event: Event): boolean {
    this.dispatched.push(event);
    return true;
  }
}

interface Page {
  document: { querySelector: (selector: string) => FakeDropdown | null };
  dropdown: FakeDropdown;
}

function courseFinderPage(options?: {
  selector?: string;
  optionValues?: string[];
}): Page {
  const selector = options?.selector ?? "#ddlSelectCourse";
  const dropdown = new FakeDropdown();
  dropdown.options = (options?.optionValues ?? ["2923", "564", "301"]).map(
    (value) => new FakeOption(value, `C${value} - TITLE ${value}`),
  );
  const document = {
    querySelector: (queried: string) =>
      queried === selector ? dropdown : null,
  };
  vi.stubGlobal("document", document);
  return { document, dropdown };
}

function run(task: SelectionTask): void {
  const factory = new Function(
    "return (" + scriptBody + ");",
  )() as (task: SelectionTask) => void;
  factory(task);
}

let fakeWindow: Record<string, unknown>;

beforeEach(() => {
  fakeWindow = {};
  vi.stubGlobal("window", fakeWindow);
});

afterEach(() => {
  vi.unstubAllGlobals();
});
function task(overrides?: Partial<SelectionTask>): SelectionTask {
  return {
    dropdownSelector: "#ddlSelectCourse",
    courseId: 564,
    forceFlag: FORCE_FLAG,
    ...overrides,
  };
}

describe("selection script behavior", () => {
  it("selects the requested course and fires a bubbling change event", () => {
    const page = courseFinderPage();

    run(task());

    expect(page.dropdown.selectedIndex).toBe(1);
    expect(page.dropdown.dispatched).toHaveLength(1);
    const [event] = page.dropdown.dispatched;
    if (!event) throw new Error("a change event was dispatched");
    expect(event.type).toBe("change");
    expect(event.bubbles).toBe(true);
  });

  it("fires change even when that course is already selected, so the page re-searches", () => {
    // The stale-table hazard: a silent no-op selection would leave the
    // previous course on screen looking like a fresh response.
    const page = courseFinderPage();
    page.dropdown.selectedIndex = 1;

    run(task({ courseId: 564 }));

    expect(page.dropdown.selectedIndex).toBe(1);
    expect(page.dropdown.dispatched).toHaveLength(1);
    const [event] = page.dropdown.dispatched;
    if (!event) throw new Error("a change event was dispatched");
    expect(event.type).toBe("change");
  });

  it("forces the next capture through before firing, so an identical re-render still lands", () => {
    const page = courseFinderPage();

    run(task({ courseId: 2923 }));

    expect(fakeWindow[FORCE_FLAG]).toBe(true);
    expect(page.dropdown.selectedIndex).toBe(0);
  });

  it("leaves the page untouched when the course has no option", () => {
    const page = courseFinderPage();

    run(task({ courseId: 999999 }));

    expect(page.dropdown.selectedIndex).toBe(-1);
    expect(page.dropdown.dispatched).toHaveLength(0);
    expect(fakeWindow[FORCE_FLAG]).toBeUndefined();
  });

  it("leaves the page untouched when the dropdown is missing", () => {
    const page = courseFinderPage({ selector: "#somethingElse" });

    run(task());

    expect(page.dropdown.selectedIndex).toBe(-1);
    expect(page.dropdown.dispatched).toHaveLength(0);
    expect(fakeWindow[FORCE_FLAG]).toBeUndefined();
  });

  it("queries the interpolated selector from its task, not a hardcoded string", () => {
    let queried: string | null = null;
    const dropdown = new FakeDropdown();
    dropdown.options = [new FakeOption("7", "C7 - TITLE")];
    vi.stubGlobal("document", {
      querySelector: (selector: string) => {
        queried = selector;
        return selector === "#customPicker" ? dropdown : null;
      },
    });

    run(task({ dropdownSelector: "#customPicker", courseId: 7 }));

    expect(queried).toBe("#customPicker");
    expect(dropdown.selectedIndex).toBe(0);
  });});
