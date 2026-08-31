/**
 * Effect lifecycle tests (ticket 51) — the DOM harness.
 *
 * `renderToStaticMarkup` runs no effect and fires no handler, so every
 * subscription, timer, and cleanup in the app was unreachable by the suite
 * (ticket 51, finding 4). This file runs under happy-dom — chosen over
 * jsdom because it is lighter and everything these tests need is listener,
 * timer, and basic DOM lifecycle work — and asserts that the cleanups that
 * can strand a user actually run on unmount.
 *
 * @vitest-environment happy-dom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { CaptureSummary, PlanSection, ScheduleBlock } from "../adapters/ipc/types";
import { WeekGrid } from "./WeekGrid";
import { useCapture } from "./useCapture";
import { usePlanRefresh } from "./usePlanRefresh";
import { useSectionPicker } from "./useSectionPicker";

const unlisten = {
  refreshProgress: vi.fn(),
  captureUpdated: vi.fn(),
  captureFailed: vi.fn(),
};

vi.mock("../adapters/ipc/client", () => ({
  // usePlanRefresh
  getMissingSections: vi.fn(() => Promise.resolve([])),
  onRefreshProgress: vi.fn(() => Promise.resolve(unlisten.refreshProgress)),
  // useCapture and useSectionPicker share the capture:updated bridge, so
  // they share one unlisten spy.
  getCaptureSummary: vi.fn(() => Promise.resolve(summaryOf(7, 155))),
  onCaptureUpdated: vi.fn(() => Promise.resolve(unlisten.captureUpdated)),
  onCaptureFailed: vi.fn(() => Promise.resolve(unlisten.captureFailed)),
  // useSectionPicker
  listCapturedCourses: vi.fn(() => Promise.resolve([])),
  listCapturedSections: vi.fn(() => Promise.resolve([])),
}));

function summaryOf(campusId: number, sessionId: number): CaptureSummary {
  return { campusId, sessionId, courseCount: 1, sectionCount: 2 };
}

/** Renders one hook call and hands back the live result box. */
function renderHook<T>(useHook: () => T): {
  result: { current?: T };
  rerender: () => void;
  unmount: () => void;
} {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const result: { current?: T } = {};
  const rootBox: { root: Root | null } = { root: null };
  const Probe = () => {
    result.current = useHook();
    return null;
  };
  act(() => {
    rootBox.root = createRoot(container);
    rootBox.root.render(<Probe />);
  });
  return {
    result,
    rerender: () => {
      act(() => {
        rootBox.root?.render(<Probe />);
      });
    },
    unmount: () => {
      act(() => {
        rootBox.root?.unmount();
        container.remove();
      });
    },
  };
}

/** Lets effect-established subscriptions settle before the assertions. */
async function flushSubscriptions() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function makeBlock(day: ScheduleBlock["day"], startMin: number, endMin: number): ScheduleBlock {
  return { day, startMin, endMin, modality: "F2F", location: "L226" };
}

function makeSection(courseId: number, sectionId: number): PlanSection {
  return {
    courseId,
    courseCode: "GEARTAP",
    courseTitle: "Art Appreciation",
    sectionId,
    sectionCode: "S11",
    pinned: false,
    missing: false,
    modality: "F2F",
    blocks: [makeBlock("MON", 450, 540)],
    latestSnapshot: {
      capturedAt: "2026-08-22T00:00:00Z",
      enrolled: 38,
      professor: null,
      remark: null,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("usePlanRefresh effects", () => {
  it("fetches the missing sections on mount", async () => {
    const client = await import("../adapters/ipc/client");
    const { result, unmount } = renderHook(() =>
      usePlanRefresh({ planId: "p1" })
    );
    await flushSubscriptions();

    expect(vi.mocked(client.getMissingSections)).toHaveBeenCalledWith({
      planId: "p1",
    });
    expect(result.current?.missingSections).toEqual([]);
    unmount();
  });

  it("subscribes to refresh progress once and unsubscribes on unmount", async () => {
    const client = await import("../adapters/ipc/client");
    // Held stable across renders, as a caller with a memoised options
    // object would: a fresh object every render is what would churn the
    // subscription.
    const options = { planId: "p1" };
    const { rerender, unmount } = renderHook(() => usePlanRefresh(options));
    await flushSubscriptions();

    expect(vi.mocked(client.onRefreshProgress)).toHaveBeenCalledTimes(1);
    rerender();
    await flushSubscriptions();
    // A re-render alone must not resubscribe.
    expect(vi.mocked(client.onRefreshProgress)).toHaveBeenCalledTimes(1);

    unmount();
    expect(unlisten.refreshProgress).toHaveBeenCalledTimes(1);
  });
});

describe("useCapture effects", () => {
  it("subscribes to both capture events and unsubscribes both on unmount", async () => {
    const client = await import("../adapters/ipc/client");
    const { unmount } = renderHook(() => useCapture(7, 155));
    await flushSubscriptions();

    expect(vi.mocked(client.onCaptureUpdated)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(client.onCaptureFailed)).toHaveBeenCalledTimes(1);

    unmount();
    expect(unlisten.captureUpdated).toHaveBeenCalledTimes(1);
    expect(unlisten.captureFailed).toHaveBeenCalledTimes(1);
  });

  it("applies a capture update only for the active scope", async () => {
    const client = await import("../adapters/ipc/client");
    const { result, unmount } = renderHook(() => useCapture(7, 155));
    await flushSubscriptions();

    const listener = vi.mocked(client.onCaptureUpdated).mock.calls[0]?.[0];
    if (!listener) throw new Error("the capture listener was registered");

    await act(async () => {
      listener(summaryOf(999, 999));
      await Promise.resolve();
    });
    expect(result.current?.summary?.campusId).toBe(7);

    await act(async () => {
      listener(summaryOf(7, 155));
      await Promise.resolve();
    });
    expect(result.current?.summary?.campusId).toBe(7);
    expect(result.current?.summary?.sessionId).toBe(155);

    unmount();
  });
});

describe("useSectionPicker effects", () => {
  it("re-syncs the course list when a capture lands for the active scope", async () => {
    const client = await import("../adapters/ipc/client");
    vi.mocked(client.listCapturedCourses).mockResolvedValue([
      {
        courseId: 2923,
        code: "GEARTAP",
        title: "Art Appreciation",
        sectionCount: 2,
        firstSeenAt: "2026-08-20T09:00:00Z",
        lastSeenAt: "2026-08-22T09:00:00Z",
        included: true,
        lastRefreshedAt: null,
      },
    ]);

    const options = { campusId: 7, sessionId: 155, planId: "p1" };
    const { unmount } = renderHook(() => useSectionPicker(options));
    await flushSubscriptions();

    const listener = vi.mocked(client.onCaptureUpdated).mock.calls[0]?.[0];
    if (!listener) throw new Error("the picker capture listener was registered");

    const callsAfterMount = vi.mocked(client.listCapturedCourses).mock.calls.length;
    await act(async () => {
      listener(summaryOf(7, 155));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(vi.mocked(client.listCapturedCourses).mock.calls.length).toBeGreaterThan(
      callsAfterMount
    );

    // A capture from another scope must not trigger a re-sync.
    const callsBeforeForeign = vi.mocked(client.listCapturedCourses).mock.calls.length;
    await act(async () => {
      listener(summaryOf(999, 999));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(vi.mocked(client.listCapturedCourses).mock.calls.length).toBe(
      callsBeforeForeign
    );

    unmount();
    expect(unlisten.captureUpdated).toHaveBeenCalledTimes(1);
  });
});

describe("WeekGrid effects", () => {
  it("closes the context menu on Escape and on a mousedown outside it", () => {
    const section = makeSection(2923, 384);
    const [block] = section.blocks;
    if (!block) throw new Error("fixture carries a block");

    const container = document.createElement("div");
    document.body.appendChild(container);
    let root: Root | null = null;
    act(() => {
      root = createRoot(container);
      root.render(
        <WeekGrid sections={[section]} initialMenu={{ section, block }} />
      );
    });
    expect(
      document.querySelector('[data-testid="grid-context-menu"]')
    ).not.toBeNull();

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(
      document.querySelector('[data-testid="grid-context-menu"]')
    ).toBeNull();

    act(() => {
      root?.unmount();
      container.remove();
    });
  });

  it("removes its document and window listeners on unmount", () => {
    const removeDocument = vi.spyOn(document, "removeEventListener");
    const removeWindow = vi.spyOn(window, "removeEventListener");

    const section = makeSection(2923, 384);
    const [block] = section.blocks;
    if (!block) throw new Error("fixture carries a block");

    const container = document.createElement("div");
    document.body.appendChild(container);
    let root: Root | null = null;
    act(() => {
      root = createRoot(container);
      root.render(
        <WeekGrid sections={[section]} initialMenu={{ section, block }} />
      );
    });

    act(() => {
      root?.unmount();
      container.remove();
    });

    expect(removeDocument).toHaveBeenCalledWith("mousedown", expect.any(Function));
    expect(removeDocument).toHaveBeenCalledWith("keydown", expect.any(Function));
    expect(removeWindow).toHaveBeenCalledWith("scroll", expect.any(Function), true);
    expect(removeWindow).toHaveBeenCalledWith("resize", expect.any(Function));

    removeDocument.mockRestore();
    removeWindow.mockRestore();
  });

  it("clears the handoff timer on unmount", () => {
    const clearTimeoutSpy = vi.spyOn(window, "clearTimeout");
    const section = makeSection(2923, 384);

    const container = document.createElement("div");
    document.body.appendChild(container);
    let root: Root | null = null;
    const renderWith = (preview: PlanSection[] | null) => {
      act(() => {
        root?.render(
          <WeekGrid sections={[section]} previewSections={preview} />
        );
      });
    };
    act(() => {
      root = createRoot(container);
      root.render(<WeekGrid sections={[section]} previewSections={[section]} />);
    });
    // The ghost departs while its section is in the plan: the handoff arms
    // and schedules its disarm timer.
    renderWith(null);
    expect(clearTimeoutSpy).not.toHaveBeenCalled();

    act(() => {
      root?.unmount();
      container.remove();
    });
    expect(clearTimeoutSpy).toHaveBeenCalled();

    clearTimeoutSpy.mockRestore();
  });
});
