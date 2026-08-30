import { describe, expect, it } from "vitest";
import {
  MOTION_DURATION_MS,
  STAGGER_STEP_MS,
  MAX_STAGGER_STEPS,
  staggerDelayMs,
  staggerStyle,
  shouldArmHandoff,
  shouldLandBlock,
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

describe("shouldArmHandoff", () => {
  it("arms the ghost, which is the end of the transition that is easy to lose", () => {
    // `handoffKey` is armed only after the ghost has departed, so a ghost can
    // never match it by key. Dropping the `isGhost` arm leaves the committed
    // block carrying a `layoutId` with nothing registered under it to
    // animate from, and the handoff silently stops happening.
    expect(
      shouldArmHandoff({ isGhost: true, sectionKey: "564-737", handoffKey: null })
    ).toBe(true);
  });

  it("arms the section that just landed", () => {
    expect(
      shouldArmHandoff({ isGhost: false, sectionKey: "564-737", handoffKey: "564-737" })
    ).toBe(true);
  });

  it("leaves every other block a plain div", () => {
    // The cost this guards: `layoutId` on forty blocks is layout projection
    // on forty blocks, every time one of them moves.
    expect(
      shouldArmHandoff({ isGhost: false, sectionKey: "1-2", handoffKey: "564-737" })
    ).toBe(false);
    expect(
      shouldArmHandoff({ isGhost: false, sectionKey: "1-2", handoffKey: null })
    ).toBe(false);
  });
});

describe("shouldLandBlock", () => {
  it("lands an ordinary committed block", () => {
    expect(
      shouldLandBlock({ isConflicting: false, isGhost: false, isHandingOff: false })
    ).toBe(true);
  });

  it("never eases in a conflict (ADR-0009)", () => {
    expect(
      shouldLandBlock({ isConflicting: true, isGhost: false, isHandingOff: false })
    ).toBe(false);
  });

  it("never animates a ghost, which would replay on every hover", () => {
    expect(
      shouldLandBlock({ isConflicting: false, isGhost: true, isHandingOff: false })
    ).toBe(false);
  });

  it("yields to the handoff rather than running alongside it", () => {
    // Not merely redundant: a CSS animation outranks inline styles in the
    // cascade, so `block-land` would override the transform the layout
    // projection writes and replace the handoff with a generic landing.
    expect(
      shouldLandBlock({ isConflicting: false, isGhost: false, isHandingOff: true })
    ).toBe(false);
  });
});
