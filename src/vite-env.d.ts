/// <reference types="vite/client" />

/**
 * `src/designSystem.test.ts` reads `App.css` as text to guard the design
 * foundation. Vite's CSS pipeline processes stylesheets before `?raw` can see
 * them, so that one file is read from disk instead.
 *
 * Declared here rather than installing `@types/node`: the project adds no
 * dependency it does not need, and this is the only Node API in `src/`.
 */
declare module "node:fs" {
  export function readFileSync(path: string, encoding: "utf8"): string;
}
