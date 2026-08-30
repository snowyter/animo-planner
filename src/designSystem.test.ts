/**
 * Foundation guard for ticket 33.
 *
 * The design foundation is CSS and therefore invisible to a suite that
 * renders to static markup. These assertions are the ticket-40-style guard
 * that keeps it from silently rotting: the token layer has to exist, the app
 * has to stay light-only, and reduced motion has to be handled once, at the
 * root, rather than per component.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** Every TypeScript source in `src/`, as raw text, read through Vite. */
const SOURCES = import.meta.glob("./**/*.{ts,tsx}", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

// Vite's CSS pipeline processes stylesheets before `?raw` can see them, so
// the token layer is read from disk. Vitest runs from the project root.
const APP_CSS = readFileSync("src/App.css", "utf8");

const SOURCE_FILES = Object.keys(SOURCES).sort();

function offenders(pattern: RegExp, isExempt: (path: string) => boolean = () => false) {
  return SOURCE_FILES.filter(
    (path) => !isExempt(path) && pattern.test(SOURCES[path])
  );
}

const isTest = (path: string) => /\.test\.tsx?$/.test(path);

describe("design foundation", () => {
  it("records one token set for type, spacing, radii, elevation, and motion", () => {
    // Type scale
    expect(APP_CSS).toMatch(/--text-nano:/);
    expect(APP_CSS).toMatch(/--text-micro:/);
    expect(APP_CSS).toMatch(/--text-wordmark:/);

    // Radii
    expect(APP_CSS).toMatch(/--radius-control:/);
    expect(APP_CSS).toMatch(/--radius-card:/);
    expect(APP_CSS).toMatch(/--radius-panel:/);

    // Elevation
    expect(APP_CSS).toMatch(/--shadow-raised:/);
    expect(APP_CSS).toMatch(/--shadow-lifted:/);
    expect(APP_CSS).toMatch(/--shadow-overlay:/);

    // Layout rhythm
    expect(APP_CSS).toMatch(/--spacing-section:/);
    expect(APP_CSS).toMatch(/--spacing-panel:/);

    // Motion durations and easings
    expect(APP_CSS).toMatch(/--motion-quick:/);
    expect(APP_CSS).toMatch(/--motion-base:/);
    expect(APP_CSS).toMatch(/--motion-stagger:/);
    expect(APP_CSS).toMatch(/--ease-quiet:/);
  });

  it("adopts the shadcn variable set as real utilities rather than leaving it as a decoy", () => {
    // The variables existed but nothing consumed them, because they were
    // declared as bare HSL triplets outside Tailwind's theme.
    expect(APP_CSS).toMatch(/@theme\b/);
    expect(APP_CSS).toMatch(/--color-background:/);
    expect(APP_CSS).toMatch(/--color-foreground:/);
    expect(APP_CSS).toMatch(/--color-muted-foreground:/);
    expect(APP_CSS).toMatch(/--color-border:/);
    expect(APP_CSS).toMatch(/--color-primary:/);

    // No orphaned bare-triplet declarations left behind.
    expect(APP_CSS).not.toMatch(/--background:\s*0\s+0%\s+100%/);
    expect(APP_CSS).not.toMatch(/--radius:\s*0\.5rem/);
  });

  it("establishes a single reduced-motion pattern at the root", () => {
    expect(APP_CSS).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/);

    // One place, not many: no component reaches for its own handling.
    expect(
      offenders(
        /prefers-reduced-motion/,
        (path) => path === "./App.css" || path === "./designSystem.test.ts"
      )
    ).toEqual([]);
  });

  it("stays light-only: no dark variants anywhere in src", () => {
    expect(
      offenders(/\bdark:[a-z-]/, (path) => path === "./designSystem.test.ts")
    ).toEqual([]);
  });

  it("keeps an idle app free of forever-looping decoration", () => {
    // `animate-spin` and `animate-pulse` are the two utilities that loop
    // without end. Skeletons replace spinners, and the conflict indicator
    // must never pulse (ADR-0009: a conflict is shown, not softened).
    expect(offenders(/animate-spin|animate-pulse/, isTest)).toEqual([]);
  });

  it("wires motion once at the root, lazily, and never ships the full component", () => {
    const appTsx = SOURCES["./App.tsx"];

    // LazyMotion + `m`, so the whole feature set is not pulled in to play a fade.
    expect(appTsx).toMatch(/LazyMotion/);
    expect(appTsx).toMatch(/strict/);
    // The single reduced-motion pattern for everything `motion` drives.
    expect(appTsx).toMatch(/MotionConfig/);
    expect(appTsx).toMatch(/reducedMotion="user"/);

    // The full `motion` component pulls the entire feature set into the
    // initial bundle. `m` is the only component allowed.
    //
    // Matched only where `motion.` is used as a value — `<motion.div>` or
    // `motion.span` — and never inside an import specifier: `../core/motion.ts`
    // and `motion/react-m` both contain "motion." and are not the component.
    expect(offenders(/(?<!["'`/])motion\.[a-z]/, isTest)).toEqual([]);
  });

  it("leaves no transform behind after a screen or stagger animation settles", () => {
    // `animation-fill-mode: forwards` / `both` retains the final keyframe
    // forever. A retained `transform` is a permanent stacking context AND a
    // permanent containing block for `position: fixed` descendants — which is
    // exactly what trapped the grid context menu (ticket 45) and what would
    // mis-place the off-screen PNG export wrapper (ticket 40).
    const settling = [
      ".screen-enter",
      ".stagger-rise",
      ".menu-enter",
      ".ambient-wash",
      ".enter-rise",
      ".enter-fade",
      ".enter-slide-left",
      ".block-land",
      ".enter-scale",
    ];
    for (const selector of settling) {
      const rule = APP_CSS.slice(APP_CSS.indexOf(selector));
      const decl = rule.slice(0, rule.indexOf("}"));
      const fillMode = /animation:[^;]*?\s(forwards|backwards|both);/.exec(decl)?.[1];
      expect(fillMode, `${selector} must settle back to its natural style`).toBe(
        "backwards"
      );
    }
  });

  it("animates a repeated element with a CSS animation, never a per-item motion component", () => {
    // The grid's ~40 blocks are the densest repeated surface in the app. The
    // entrance is a plain CSS animation so it costs no layout projection and
    // no per-element measurement, and it settles with `backwards` so no
    // `transform` survives on a block or a day column — a retained transform
    // there is the containing block for the portalled, `position: fixed`
    // context menu (tickets 41 and 45).
    expect(APP_CSS).toMatch(/\.block-land\s*\{[^}]*animation:/);
  });

  it("never restates a centering offset inside an entrance keyframe", () => {
    // Tailwind v4 compiles `translate-x-[-50%]` to the `translate` property,
    // not to `transform`. The two compose — `translate` applies first, then
    // `transform` — so a keyframe that repeats the -50% centering offset
    // double-applies it and throws the dialog up and to the left by half its
    // own size. Keyframes animate the delta only; centering stays on the
    // element's own utilities.
    const keyframes = APP_CSS.split("@keyframes").slice(1);
    for (const frame of keyframes) {
      const name = frame.trim().split(/\s/)[0];
      const body = frame.slice(0, frame.lastIndexOf("}"));
      expect(body, `@keyframes ${name} must not restate a centering offset`).not.toMatch(
        /-\s*50%/
      );
    }
  });

  it("keeps a conflict instant: no animation, no transition on the hatch", () => {
    // ADR-0009 is intact. A conflict is displayed, never softened, and it
    // appears the moment it exists — so no entrance animation and no
    // transition may attach to it, even while everything around it animates.
    const conflictRule = APP_CSS.slice(APP_CSS.indexOf(".conflict-hatch"));
    const decl = conflictRule.slice(0, conflictRule.indexOf("}"));
    expect(decl).not.toMatch(/animation/);
    expect(decl).not.toMatch(/transition/);
  });

  it("keeps backdrop-filter off large, scrolling, and repeated surfaces", () => {
    // Frosted glass forces a repaint of everything behind it. It is allowed
    // on a dialog overlay and nowhere else.
    expect(
      offenders(
        /backdrop-blur|backdrop-filter/,
        (path) => isTest(path) || path === "./components/ui/dialog.tsx"
      )
    ).toEqual([]);
  });

  it("never branches on the remark value (ticket 50, CONTEXT.md invariant)", () => {
    // CONTEXT.md & ticket 50: `remark` is opaque, verbatim text. It is never
    // parsed, never branched on, and never matched against literals (e.g. no
    // swimming icon map, no activity-specific styling).
    const branchingPatterns = [
      /\bremark\s*(?:===|!==|==|!=)\s*["'`][^"'`]+["'`]/,
      /["'`][^"'`]+["'`]\s*(?:===|!==|==|!=)\s*\bremark\b/,
      /\bremark\.(?:includes|startsWith|endsWith|indexOf|match)\s*\(/,
      /\/(?:PICKLEBALL|SWIMMING|SOCDANCE|BASKETBALL|VOLLEYBALL)\/[i]?\.(?:test|exec)\s*\(/,
      /\bswitch\s*\([^)]*remark[^)]*\)/,
      /\b(?:REMARK_|remarkMap|activityMap|activityIcon)\b/,
    ];

    for (const pattern of branchingPatterns) {
      expect(
        offenders(pattern, isTest),
        `no production source may branch on remark with pattern ${pattern}`
      ).toEqual([]);
    }
  });
});
