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
