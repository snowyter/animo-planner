# 02 — What is the smallest type stack that reads like SF on both platforms?

Type: research
Lane: AFK
Status: resolved
Blocked by: None — can start immediately
Map: [map.md](../map.md)

## Question

The chosen stack is `-apple-system` first, then a bundled Latin-subset **Inter** variable font (see the map's Notes). Pin down the facts that make it concrete:

- **Size.** The byte size of Inter Variable (roman, and whether italic is needed at all) as `woff2`, full vs Latin / Latin-Extended subset. Which subset covers Filipino names and every character Archer's Hub puts in course titles, professor names, and remarks (look at `docs/` fixtures and `src-tauri` parser tests for real strings — never at the raw `docs/ArchersHub-Course-Finder-*.html` captures, which are gitignored for privacy).
- **Where it comes from.** Official Inter release (rsms/inter) vs `@fontsource-variable/inter`; licence (SIL OFL 1.1) and what attribution it needs in a public MIT repo.
- **SF-likeness.** Which OpenType features (`cv11`, `ss01`, `tnum`, `case`, …) and tracking/optical-size settings bring Inter closest to SF Pro Text/Display, and which ones matter for the week grid's numbers (tabular figures).
- **Loading.** How to ship it through Vite with `@font-face` + `font-display` so there is no flash and no network request (ADR-0004); whether `unicode-range` helps.
- **macOS.** Whether `-apple-system` / `system-ui` resolves to SF Pro in Tauri's macOS WKWebView, and that Windows WebView2 ignores it and falls through to Inter.
- **Rendering on Windows.** Any known WebView2/DirectWrite issues with Inter at 10–11px (`text-nano`, `text-micro`).

Recommend the exact file, subset, feature settings, and `font-family` stack.

## Answer

**Official Inter 4.1 variable, roman only, Latin-1 subset, no alternates, stack `-apple-system, "Inter Animo", system-ui, sans-serif`.** Findings: branch `research/type-stack`, file `docs/research/type-stack.md` (commit `ec8a62b`, local only; it holds the exact `pyftsubset` command and SHA-256s).

- **Source.** Inter 4.1's own `web/InterVariable.woff2` — not `@fontsource-variable/inter`, whose files drop every `cv*`/`ss*`, `case`, `zero`, and the licence strings. Ship Inter's `LICENSE.txt` beside it: SIL OFL 1.1, no Reserved Font Name, compatible with the MIT repo. Keep all name records when subsetting (the default strips the licence fields).
- **Subset.** Roman, `wght` + `opsz` axes kept, unhinted: Fontsource's latin range plus → ≥ ≤ ≠ ₱ and a few combining marks — **72,496 B**. Pinning `opsz` gives 47,712 B at the cost of the display cut. Latin-1 covers Filipino (ñ, á–ú); committed fixtures are pure ASCII. **No italic file** — the three italic captions get a synthesised slant.
- **Features.** No alternates: Inter's defaults already match SF, and `cv11` would *un*-match it (single-storey a). `calt` already handles caps punctuation and time colons. `tabular-nums` only on times, the hour axis, and counts. No tracking tokens — at 10–14px Inter's formula and SF's table differ by ≤ ~0.1px/letter.
- **Stack and loading.** `-apple-system` first, then Inter, then `system-ui`. Measured in Edge 153 (the installed WebView2 build): Windows skips `-apple-system`, but `system-ui` resolves to Segoe UI, so placing it before Inter would hide Inter. `@font-face` with `font-display: block` and a matching `unicode-range`; Vite hashes it into `dist` — no network (ADR-0004).
- **Small sizes on Windows.** Unhinted avoids the hint-driven distortion at small sizes.
- **Watch.** Inter is ~10% wider than Segoe UI at 10px (8.6% at 11px) — the implementing ticket must re-check week-grid truncation at the 1024 minimum width.
- **Not verified here.** SF resolution on macOS WKWebView (docs only, no Mac), and ClearType crispness at 100–150% scaling (headless Edge renders grayscale) — a human eye check.
