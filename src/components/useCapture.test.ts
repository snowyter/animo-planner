import { beforeEach, describe, expect, it, vi } from "vitest";
import * as client from "../adapters/ipc/client";
import { useCaptureState } from "./useCapture";
import type { CaptureSummary } from "../adapters/ipc/types";

vi.mock("../adapters/ipc/client", () => ({
  getCaptureSummary: vi.fn(),
  openCaptureWindow: vi.fn(),
  undoLastCapture: vi.fn(),
  onCaptureUpdated: vi.fn(),
  onCaptureFailed: vi.fn(),
}));

describe("useCaptureState logic", () => {
  const scope = { campusId: 7, sessionId: 155 };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches capture summary on demand", async () => {
    const mockSummary: CaptureSummary = {
      campusId: 7,
      sessionId: 155,
      sectionCount: 42,
      courseCount: 8,
      canUndo: true,
    };

    vi.mocked(client.getCaptureSummary).mockResolvedValue(mockSummary);

    const state = useCaptureState(scope);
    expect(state.summary).toBeNull();
    expect(state.isLoading).toBe(false);

    await state.fetchSummary();

    expect(client.getCaptureSummary).toHaveBeenCalledWith(scope);
    expect(state.summary).toEqual(mockSummary);
    expect(state.isLoading).toBe(false);
    expect(state.error).toBeNull();
  });

  it("surfaces identifiable error when getCaptureSummary fails with unimplemented", async () => {
    vi.mocked(client.getCaptureSummary).mockRejectedValue("unimplemented: get_capture_summary");

    const state = useCaptureState(scope);
    await state.fetchSummary();

    expect(state.error).toBe("unimplemented: get_capture_summary");
    expect(state.summary).toBeNull();
    expect(state.isLoading).toBe(false);
  });

  it("calls openCaptureWindow with plan's scope", async () => {
    vi.mocked(client.openCaptureWindow).mockResolvedValue(undefined);

    const state = useCaptureState(scope);
    await state.openCapture();

    expect(client.openCaptureWindow).toHaveBeenCalledWith(scope);
    expect(state.error).toBeNull();
  });

  it("surfaces error when openCaptureWindow fails", async () => {
    vi.mocked(client.openCaptureWindow).mockRejectedValue("Failed to open capture window");

    const state = useCaptureState(scope);
    await expect(state.openCapture()).rejects.toBe("Failed to open capture window");
    expect(state.error).toBe("Failed to open capture window");
  });

  it("executes undo and updates capture summary", async () => {
    const afterUndoSummary: CaptureSummary = {
      campusId: 7,
      sessionId: 155,
      sectionCount: 0,
      courseCount: 0,
      canUndo: false,
    };

    vi.mocked(client.undoLastCapture).mockResolvedValue(afterUndoSummary);

    const state = useCaptureState(scope);
    await state.undoLast();

    expect(client.undoLastCapture).toHaveBeenCalledWith(scope);
    expect(state.summary).toEqual(afterUndoSummary);
    expect(state.error).toBeNull();
  });

  it("surfaces error when undoLastCapture fails", async () => {
    vi.mocked(client.undoLastCapture).mockRejectedValue("Nothing to undo");

    const state = useCaptureState(scope);
    await expect(state.undoLast()).rejects.toBe("Nothing to undo");
    expect(state.error).toBe("Nothing to undo");
  });

  it("updates summary live when capture:updated event is received for matching scope", () => {
    const state = useCaptureState(scope);
    const updatedSummary: CaptureSummary = {
      campusId: 7,
      sessionId: 155,
      sectionCount: 42,
      courseCount: 8,
      canUndo: true,
    };

    state.handleCaptureUpdated(updatedSummary);
    expect(state.summary).toEqual(updatedSummary);
  });

  it("ignores capture:updated event for a different scope", () => {
    const state = useCaptureState(scope);
    const otherScopeSummary: CaptureSummary = {
      campusId: 8,
      sessionId: 156,
      sectionCount: 10,
      courseCount: 2,
      canUndo: true,
    };

    state.handleCaptureUpdated(otherScopeSummary);
    expect(state.summary).toBeNull();
  });

  it("records and dismisses non-blocking capture failure notices", () => {
    const state = useCaptureState(scope);
    expect(state.captureFailure).toBeNull();

    state.handleCaptureFailed({ error: "Failed to parse section table: malformed row at index 3" });
    expect(state.captureFailure).toBe("Failed to parse section table: malformed row at index 3");

    state.dismissFailure();
    expect(state.captureFailure).toBeNull();
  });
});
