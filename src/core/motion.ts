/**
 * Motion tokens, mirrored from the `--motion-*` custom properties in
 * `src/App.css`.
 *
 * Reduced motion is handled once at the root: a media query at the bottom of
 * `App.css` and `<MotionConfig reducedMotion="user">` in `App.tsx`. Nothing
 * here needs to know about it, and nothing here reads the environment — this
 * module is pure. See `docs/design-system.md`.
 */

export const MOTION_DURATION_MS = {
  instant: 90,
  quick: 140,
  base: 200,
  slow: 260,
} as const;

/** One step of the ranked stagger, matching `--motion-stagger`. */
export const STAGGER_STEP_MS = 40;

/**
 * How many steps the stagger is allowed to climb before it flattens.
 *
 * A solve returns up to twenty solutions. Un-capped, the last card would wait
 * eight hundred milliseconds to appear — long enough to read as a stall
 * rather than an ordering.
 */
export const MAX_STAGGER_STEPS = 8;

/** The delay for the item at `index`, capped at {@link MAX_STAGGER_STEPS}. */
export function staggerDelayMs(index: number): number {
  if (!Number.isFinite(index) || index <= 0) {
    return 0;
  }
  return Math.min(Math.floor(index), MAX_STAGGER_STEPS) * STAGGER_STEP_MS;
}

/**
 * The inline style that drives `.stagger-rise`.
 *
 * The delay is a CSS custom property rather than JS state, so a list of forty
 * cards costs one style attribute each and no per-item timers.
 */
export function staggerStyle(index: number): Record<string, string> {
  return { "--stagger-delay": `${staggerDelayMs(index)}ms` };
}

/**
 * Whether a grid block takes part in the ghost-to-block handoff.
 *
 * The preview and the committed block are the two ends of one shared-element
 * transition, and it is only a transition if *both* ends carry the
 * `layoutId`. The ghost is the end that is easy to lose: `handoffKey` is
 * armed by an effect that deliberately waits until the ghost has departed, so
 * a ghost can never match it by key and has to be recognised as a ghost.
 *
 * This lives here, as a pure decision, because the alternative is a condition
 * spelled inline in `WeekGrid` that no test can see: `layoutId` is not an
 * attribute, so a handoff that quietly stops happening renders byte-identical
 * markup and every static-markup assertion keeps passing.
 */
export function shouldArmHandoff(input: {
  isGhost: boolean;
  sectionKey: string;
  handoffKey: string | null;
}): boolean {
  return input.isGhost || input.handoffKey === input.sectionKey;
}

/**
 * Whether a grid block plays the shared CSS entrance.
 *
 * Three exclusions, each for its own reason:
 *
 * - A **conflicting** block is shown the instant the conflict exists
 *   (ADR-0009). A conflict is never eased in.
 * - A **ghost** is a preview of something that has not happened. It appears
 *   with the cursor and would be animating on every hover.
 * - A block **mid-handoff** already has an entrance, and a better one. It
 *   matters that this is an exclusion rather than a coexistence: a CSS
 *   animation outranks inline styles in the cascade, so `block-land` would
 *   override the `transform` the layout projection writes and replace the
 *   handoff with a generic landing for as long as it runs.
 */
export function shouldLandBlock(input: {
  isConflicting: boolean;
  isGhost: boolean;
  isHandingOff: boolean;
}): boolean {
  return !input.isConflicting && !input.isGhost && !input.isHandingOff;
}
