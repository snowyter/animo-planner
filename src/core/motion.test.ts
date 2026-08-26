import { describe, expect, it } from "vitest";
import {
  MOTION_DURATION_MS,
  STAGGER_STEP_MS,
  MAX_STAGGER_STEPS,
  staggerDelayMs,
  staggerStyle,
} from "./motion";

describe("motion tokens", () => {
  it("mirrors the recorded durations and keeps every one of them short", () => {
    expect(MOTION_DURATION_MS.instant).toBe(90);
    expect(MOTION_DURATION_MS.quick).toBe(140);
    expect(MOTION_DURATION_MS.base).toBe(200);
    expect(MOTION_DURATION_MS.slow).toBe(260);

    // Motion is allowed to soften a change, never to be something the student
    // waits for during enlistment.
    for (const ms of Object.values(MOTION_DURATION_MS)) {
      expect(ms).toBeLessThanOrEqual(260);
    }
  });
});

describe("staggerDelayMs", () => {
  it("steps the delay so a ranking reads as an ordering", () => {
    expect(staggerDelayMs(0)).toBe(0);
    expect(staggerDelayMs(1)).toBe(STAGGER_STEP_MS);
    expect(staggerDelayMs(3)).toBe(3 * STAGGER_STEP_MS);
  });

  it("caps the delay so the twentieth result is not still waiting", () => {
    const capped = MAX_STAGGER_STEPS * STAGGER_STEP_MS;
    expect(staggerDelayMs(MAX_STAGGER_STEPS)).toBe(capped);
    expect(staggerDelayMs(19)).toBe(capped);
    expect(staggerDelayMs(200)).toBe(capped);
  });

  it("treats a negative or non-finite index as the first item", () => {
    expect(staggerDelayMs(-1)).toBe(0);
    expect(staggerDelayMs(Number.NaN)).toBe(0);
  });
});

describe("staggerStyle", () => {
  it("emits the delay as the custom property the .stagger-rise class reads", () => {
    expect(staggerStyle(2)).toEqual({ "--stagger-delay": `${2 * STAGGER_STEP_MS}ms` });
  });
});
