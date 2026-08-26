/**
 * The `motion` feature bundle, isolated behind its own module so it can be
 * code-split.
 *
 * `LazyMotion` only pays off if the bundler actually moves the features out of
 * the initial chunk. Importing them from `motion/react` — the same specifier
 * the app statically imports `LazyMotion` and `MotionConfig` from — does not
 * achieve that: Rollup reports "dynamic import will not move module into
 * another chunk" and inlines the lot. Reaching them through this module gives
 * the dynamic import a distinct graph to split on.
 *
 * `domMax`, not `domAnimation`, because layout projection does not ship in the
 * smaller bundle and the week grid's ghost-to-block handoff is a `layoutId`
 * transition. That handoff is the reason `motion` was approved at all
 * (docs/agents/dependencies.md); nothing else here needs projection, and
 * nothing else may start using it without a new decision.
 */
export { domMax as default } from "motion/react";
