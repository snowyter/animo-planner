# 51 — [headless] The guardrails that would have caught the last three bugs

**What to build:** Close the gaps that let defects through a green suite. An audit on **2026-08-30** of 36,089 lines found no live crash — it found that the checks which would catch one are switched off. The release build compiles out its own privacy audit, no effect or event handler in the app is ever executed by a test, and the two lint rules that catch stale closures and unguarded indexing are absent.

**Blocked by:** None — can start immediately

**Status:** ready-for-agent

## Why

The suite is green once it can run at all — see finding 0. Measured on 2026-08-30: 684 TS tests across 57 files, 430 Rust tests (425 with `--no-default-features`), clippy clean both ways, `npm audit` reports 0 vulnerabilities. The codebase is genuinely tidy — the audit found **no** `TODO`/`FIXME`/`HACK`, **no** `@ts-ignore` or `eslint-disable`, **no** `.skip`/`.only`/`#[ignore]`, **no** stray `console.*`, **no** `any`, **no** non-null assertions, and **no** `#[allow]` in Rust. All 16 non-test panic sites in Rust were read: every one is either const-evaluated at compile time or guarded by a schema `CHECK` or a just-established invariant.

That is exactly the problem. Green means little here, because the three defects found in the last two sessions — fabricated session ids, a shared-element transition with one end missing, a component whose comment described a mechanism it did not implement — were all invisible to this suite by construction. The findings below are the reasons why.

### 0. `npm run verify` was failing, and the Rust half had stopped running — **fixed 2026-08-30**

Found while establishing a baseline for this audit. `npm run verify` exited **1**, not 0. `.codebuddy/workflows/audit-review.js` is an agent-tool file that landed in the working tree; it was added to `.gitignore` but **not** to the `ignores` array in `eslint.config.js`, so `eslint .` linted it and reported 21 `no-undef` errors. Because `verify` chains with `&&`, eslint's failure short-circuited the command and **`npm run verify:rust` never executed** — no clippy, no `cargo test`.

Fixed by adding `.codebuddy/**` to the `ignores` array. `npm run verify` now exits 0 with the whole pipeline running, and the Rust numbers above are measured rather than assumed.

Left in the ticket because it is the thesis in miniature: a guardrail stopped running, everything still looked fine, and the two ignore lists that must agree had no test that they do. Worth considering whether `eslint.config.js` should derive its ignores from `.gitignore` rather than restate them.

### 1. The privacy audit is compiled out of the shipped build

`src-tauri/src/core/capture_report.rs:67`:

```rust
debug_assert!(find_scrub_violations(&fragment).is_empty());
```

`src-tauri/Cargo.toml` has **no `[profile.release]` section**, so cargo's default applies and `debug-assertions = false` in release. In the app the user actually runs, that line does nothing.

**This is not a leak today.** `diagnostic_fragment` still runs and still scrubs. But the report body goes to the user's clipboard and on to a public GitHub issue, and the only runtime verification that it carries no `hdnStudId`, `userID`, `IP_ADDRESS`, or `MAC_ADDRESS` is a statement the release compiler deletes. If `diagnostic_fragment` ever regresses, nothing in the shipped binary notices. This is the one finding with a blast radius outside the repo, so it is first.

### 2. The privacy audit exists twice, and nothing proves the two agree

| | lines | how |
|---|---|---|
| `src-tauri/src/core/scrub.rs` | 527 | byte scanner, hazard spans sorted and overlap-resolved, false-positive tests for times/dates/long digit runs |
| `src/core/scrub.ts` | 30 | five module-level regexes |

The Rust one is the authority. The **TypeScript one is what the user sees**: `ReportBrokenCaptureDialog.tsx:156` calls `findScrubViolations(body)` to decide whether to warn before the report is copied. Two implementations of one privacy invariant, no shared fixture, no test that runs both over the same input. `MAC_BARE_PATTERN` (`/\b[0-9a-f]{12}\b/gi`) will flag any twelve-hex run; Rust has a named test that this exact class of false positive does not fire. They already differ.

`src/core/scrub.ts` is also the **only** module in `src/core/` with no module doc comment — a small thing, but it is the file that most needs to say which side of the boundary it is on.

### 3. Conflict detection exists twice, both live, defended differently

`src-tauri/src/adapters/store.rs:1265` computes conflicts and serves them over IPC. `src/core/conflicts.ts` computes them again in `PlanWorkspace.tsx:191`, `WeekGrid.tsx:314`, and `section.ts:95`. Same contract, two implementations, and they do not agree on defence:

- `conflicts.ts:33-38` explicitly skips a section compared against itself.
- `conflicts.rs:38-42` has no such guard — it relies on `sections[i + 1..]` and on the caller passing distinct sections.

The Rust doc comment at `conflicts.rs:33-36` states *"A section is never compared with itself, so it cannot conflict with itself."* The code does not enforce that; the caller happens to satisfy it. Today the caller does: the query orders by `s.course_id, s.section_id, b.id` and `sections` carries `UNIQUE (campus_id, session_id, course_id, section_id)`, so the fold at `store.rs:1246` cannot split a section. **This is a latent asymmetry, not a live bug** — but it is the same shape as the session-id defect: a property asserted in prose, satisfied by coincidence, with no test that would notice if the coincidence ended.

### 4. No effect and no handler in this application is ever executed by a test

`vite.config.ts` sets no `environment`, so vitest runs in **node**. There is no `jsdom`, no `happy-dom`, no `@testing-library/*` in `package.json` — zero files import one. All 22 component test files use `renderToStaticMarkup`, which runs no effect and fires no handler.

What that leaves dark:

- **23 `useEffect` bodies** across 15 modules: `App.tsx`, `AboutDialog` (2), `ExportMenu`, `OnboardingDialog` (2), `ReportBrokenCaptureDialog` (2), `SectionPicker`, `SolvePanel` (2), `useCapture` (2), `useOptions`, `usePlanDetail`, `usePlanRefresh` (2), `usePlans`, `useProfessorPreferences` (2), `useSectionPicker` (3), `WeekGrid` (2)
- **128 event handler props** (106 `onClick`, 13 `onChange`, 3 `onSubmit`, 2 `onFocus`, 2 `onBlur`, 1 `onMouseMove`, 1 `onKeyDown`)
- **42 `useCallback` and 25 `useMemo`** dependency arrays

Every subscription, every cleanup, every fetch-on-mount, every stale-closure risk in the app is unverified. This is the structural reason the dead ghost→block handoff survived a full review: the suite renders markup, and the bug was in behaviour.

### 5. The two lint rules that would cover part of that are not installed

`eslint.config.js` is `js.configs.recommended` plus `tseslint.configs.recommended` and nothing else. **`eslint-plugin-react-hooks` is absent** — so `exhaustive-deps` and `rules-of-hooks` never run over those 23 effects and 67 memoised callbacks. For a React codebase this is the single cheapest guardrail available and it is missing.

`tsconfig.json` sets `strict`, `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch` — good — but **not `noUncheckedIndexedAccess`**. Turning it on yields **106 errors**: 46 in source, 60 in tests. Concentrations: `solver.test.ts` (25), `options.ts` (14), `WeekGrid.test.tsx` (11), `conflicts.ts` (10).

Every source site sampled is in fact guarded — `palette.ts:208` is a modulo, `onboarding.ts:63` checks the index first, `solver.ts:89` checks the length. **The finding is not that these are broken. It is that the compiler cannot tell them apart from one that is**, so the first unguarded index lands silently, in `conflicts.ts` and `options.ts` above all — the two modules that have already produced a defect.

`src-tauri/Cargo.toml` likewise has no `[lints]` section, so clippy runs the default set only.

## Decided before dispatch

**Nothing here is a rewrite.** The duplication in findings 2 and 3 is not automatically a defect to collapse — the TS copies exist so the UI can compute without a round trip, and ADR-0014 is not being reopened. **The deliverable is agreement, not deletion:** a shared fixture and a test that runs both implementations over it. If a divergence is deliberate, write the reason down in both files.

**Do not soften a doc comment to match weaker code.** Where prose and code disagree (`conflicts.rs:33-36`), make the code true. This is the rule that produced the right fix on SpotlightCard.

**Fixing the 106 index errors must not add non-null assertions.** `!` does not appear anywhere in this codebase today and must not start here — narrow, guard, or destructure with a default. If a site is provably safe, the guard should read as the proof.

**The DOM harness is additive.** `renderToStaticMarkup` tests stay as they are; nothing already passing gets rewritten. The new environment is for what the old one cannot reach.

## Acceptance criteria

### The release build audits itself

- [ ] `find_scrub_violations` runs in release, not only under `debug_assertions` — either promote the check at `capture_report.rs:67` to a real branch, or add `[profile.release] debug-assertions = true` to `src-tauri/Cargo.toml` and say in a comment why the release build needs them
- [ ] Decide and record what happens when the audit **fails** in release. A `debug_assert!` had no answer because it never fired in production. The report must not reach the clipboard carrying a hazard
- [ ] A test that builds a report from a fragment containing `hdnStudId` and proves the shipped path catches it

### The two scrub implementations agree

- [ ] One fixture set, exercised by both `scrub.test.ts` and `scrub.rs` tests — same inputs, same expected violation count
- [ ] The bare-MAC false positive is resolved: either `scrub.ts` gains the same false-positive defence Rust has, or the difference is deliberate and documented in both files
- [ ] `src/core/scrub.ts` gets a module doc comment, in the style of the rest of `src/core/`, naming `scrub.rs` as the authority and saying what this copy is for

### The two conflict implementations agree

- [ ] `conflicts.rs` either enforces the property its doc comment claims, or the comment is rewritten to name the caller invariant it actually depends on — with the `UNIQUE` constraint and the `ORDER BY` cited
- [ ] A shared fixture: the same set of planned sections through `findConflicts` and `find_conflicts`, asserting the same conflicts in the same order
- [ ] Include the duplicate-section input. Today the two implementations return different answers for it

### The effects and handlers become reachable

- [ ] A DOM test environment is added (`jsdom` or `happy-dom` — pick one and record why in the ticket comments; **it is a new dependency, so confirm against `docs/agents/dependencies.md` and ask if it is not pre-approved**)
- [ ] `eslint-plugin-react-hooks` installed and wired into `eslint.config.js`, with `npm run verify` still exiting 0. Report the violation count before fixing — if it is large, fix what is real and record the rest here rather than blanket-disabling
- [ ] Cover the effects that can actually strand a user, not all 23. Start with the ones holding subscriptions or timers: `usePlanRefresh`, `useCapture`, `useSectionPicker`, `WeekGrid`. **A cleanup that never runs is the target** — assert unsubscribe/clear on unmount
- [ ] `noUncheckedIndexedAccess` enabled in `tsconfig.json` and all 106 errors resolved, no `!` anywhere
- [ ] Consider a `[lints]` section in `src-tauri/Cargo.toml`. Pedantic clippy on 21k lines of Rust will be noisy — if the noise outweighs the catch, say so here and close that line rather than leaving it open

### The ignore lists stay in step

- [ ] `eslint.config.js` and `.gitignore` no longer drift — either derive one from the other, or add a test that every `.gitignore` directory entry is also eslint-ignored. Finding 0 cost the Rust half of `verify` silently
- [ ] A check that `npm run verify` actually reaches `verify:rust`. Today nothing notices when an earlier link in the `&&` chain swallows it

### Dependencies

- [ ] `npm audit` still reports 0 vulnerabilities
- [ ] 7 packages are behind: `@types/react-dom`, `eslint`, `typescript-eslint`, `lucide-react` are patch/minor and safe; `@vitejs/plugin-react` 4→6, `vite` 7→8, `typescript` 5.8→7 are majors. **Do not take the majors in this ticket.** Note them for a separate one

## Testing

- [ ] Every guard added here must be **proved to bite**: break the thing deliberately, watch the test go red, restore it. A guard that has never failed is not known to work — this is how the SpotlightCard source guard was validated and it is not optional
- [ ] The scrub-agreement and conflict-agreement tests must fail if either side is changed alone. Verify by changing one side alone
- [ ] `npm run verify` exits 0 at the end, with the Rust and TS counts stated in the comments so the next audit has a baseline

## Worth knowing before starting

Every core module already has a colocated test except `src/adapters/ipc/types.ts` and the seven shadcn primitives under `src/components/ui/` — those are vendored and out of scope.

Existing source-level guards to imitate rather than reinvent: `src/components/ui/spotlightCard.test.tsx`, `src/core/scrub.test.ts`, and `src/designSystem.test.ts` use `import.meta.glob(..., { query: "?raw", eager: true })`; the Rust side uses `include_str!` the same way in nine modules.

Two hazards in `WeekGrid.tsx` are not in scope to change and must survive: the context menu is portalled to `document.body` and positioned `fixed`, so no `transform`, `filter`, or `backdrop-filter` may land on an ancestor; and `.block-land` is mutually exclusive with the shared-element handoff because animations outrank inline `style` in the cascade. Adding a DOM environment will make these testable for the first time — that is a bonus, not the job.

**Do not touch `.scratch/` while implementing.** Findings go in this file's `## Comments` section when the work is done.

## Comments

### 2026-08-31 — implemented

`npm run verify` exits **0**: **723 TS tests across 59 files** (baseline 684/57), **438 Rust tests** (baseline 430), **433 with `--no-default-features`** (baseline 425), clippy clean both ways, `npm audit` 0 vulnerabilities. One environment hiccup at baseline: the first `cargo` link died with `link.exe` exit `0xc0000142` (transient Windows DLL-init fault under parallel linking); retried with `-j 2`, linked clean, and every later build was fine.

#### Finding 1 — the release build audits itself

- Promoted the `debug_assert!` at `capture_report.rs:67` to a **real branch** (over `[profile.release] debug-assertions = true`, which would have kept the tests vacuous and left the failure path undecided). Decided failure path, recorded in the code: **a failed audit withholds the offending input with an honest note; it is never embedded and never quoted** (quoting the violation text would carry the hazard). `fragment_section` is the fragment gate; the parse error — which is *also* site-derived (see below) — gets its own gate, and the title falls back to `WITHHELD_TITLE`.
- The audit is exercised end-to-end in **both** profiles; the fixture test passes under `cargo test --release`.

**Two holes the ticket did not predict, both fixed:**

1. **The trim can splice a hazard into existence.** `strip_block` removes `<script>…</script>` whole and joins the surviving text, so `hdn` + `<script>x</script>` + `StudId` becomes `hdnStudId`, and `60:45:BD:1B:5` + `5:13` becomes a full MAC — *after* the pre-trim scrub ran. Proven before fixing: test profile → the `debug_assert!` panicked (a live crash in debug builds); **release profile → the report body embedded `hdnStudId` and `60:45:BD:1B:55:13` verbatim**, headed for the clipboard and a public GitHub issue. That run is this finding, demonstrated. Fix: `diagnostic_fragment` is now **scrub → trim → scrub again** (one extra pass over ≤2 KB; the second pass cannot itself manufacture hazards because replacements insert non-word marker text at the splice point).
2. **The parse error can carry site text.** `ParseError::SelectedCourseUnreadable` (parser.rs:877) embeds the dropdown option text verbatim; that flows into the title and the parse-error section — outside the fragment audit entirely. Fix: the error text is audited like the fragment; on failure the section is withheld and the title is a safe constant, while a clean fragment is still embedded (independent gates).

**Proved to bite:** each guard was broken deliberately and its test went red — post-trim scrub removed (2 red: the splice test on the surviving hazard; the end-to-end test also lost diagnostics to the withhold branch), withhold branch short-circuited (`| true`, red), error gate forced `true ||` (red). All restored.

#### Finding 2 — the two scrub implementations agree

Ran **both implementations over 28 candidate inputs before deciding anything** (throwaway probe harness, deleted afterwards). Results:

- **No bare-MAC divergence exists.** Both flag a bounded 12-hex run identically (`6045BD1B5513` → 1/1; a 12-digit number → 1/1 — a *shared* deliberate over-detection; a 17-digit run and an 18-hex run → 0/0). The Rust false-positive tests pass on the TS side too. Documented as shared behaviour in both files rather than "fixed".
- **Real divergences: 3, one root cause.** TS counts every regex match; Rust merges hazards sharing one enclosing region into a single span (its spans drive replacement, so they must be disjoint): a field name twice in one tag (TS 2 / RS 1), a hazard-shaped value inside a field-name tag (TS 2 / RS 1), two field names in tag-less text (TS 2 / RS 1). On all 28 inputs the two agree on the *decision* (hazard vs none), which is what the dialog's warning depends on. Documented as deliberate in both `scrub.ts` and `scrub.rs`.
- My own static predictions were wrong three times; the probe caught each (e.g. TS does *not* flag back-to-back MACs — JS `\b` applies at the match end — so adjacent-hazard semantics agree after all).

Deliverables: `src-tauri/tests/fixtures/scrub-agreement.json` (24 cases + rationale), `the_shared_fixture_holds_for_the_rust_scanner` + committed-captures-audit-clean in `scrub.rs`, `it.each` agreement suite in `scrub.test.ts`, and the module doc on `scrub.ts` naming `scrub.rs` as the authority.

**Proved to bite:** TS bare pattern `{12}`→`{13}` alone → 4 red; Rust leading-zero defence disabled alone → red on `case leading-zero-ip`. Both restored.

#### Finding 3 — the two conflict implementations agree

- Test-first where it fails today: the duplicate-section input (same section twice) — `findConflicts` returned `[]`, `find_conflicts` manufactured a self-conflict → RED, then the `conflicts.ts` guard was added to `find_conflicts`, making the doc comment **true instead of softened**; it now states the skip is enforced and cites the `ORDER BY s.course_id, s.section_id, b.id` + `UNIQUE (campus_id, session_id, course_id, section_id)` caller invariant as the first line of defence → GREEN.
- Shared fixture `conflict-agreement.json`: one 5-section set, expected conflicts asserted **in order** on both sides (overlap on one day of two, per-block day specificity, back-to-back touch, the duplicate input, pair ordering).

**Proved to bite:** Rust guard removed alone → 2 red; TS guard removed alone → fixture test red (duplicate pair reorders the output). Both restored.

#### Finding 4 — the DOM harness

- **Dependencies approved by the human during dispatch.** `happy-dom` chosen over jsdom: lighter, and everything these tests need is listener/timer/DOM lifecycle work. Recorded in the harness file's header. `eslint-plugin-react-hooks@7.1.1`, `happy-dom@20.12.0`.
- New file `src/components/effectCleanup.test.tsx` (`@vitest-environment happy-dom` docblock; the 57 `renderToStaticMarkup` suites stay untouched in node). A ~40-line `renderHook` harness (`createRoot` + `act`), client module mocked.
- Coverage, per the acceptance line "cover the effects that can actually strand a user": `usePlanRefresh` (fetch-on-mount reachable; subscribes once; **unsubscribes on unmount**), `useCapture` (both subscriptions unsubscribed on unmount; scope filter applied), `useSectionPicker` (a capture landing for the active scope re-syncs the course list; a foreign scope does not; unsubscribes on unmount), `WeekGrid` (menu closes on Escape and outside mousedown; all four document/window listeners removed on unmount; the handoff timer is cleared on unmount).
- **Proved to bite:** dropped `unlistenUpdated` from `useCapture`'s cleanup → the unsubscribe test red. Restored.

#### Finding 5 — the two lint rules

**`eslint-plugin-react-hooks` violation count before fixing: 21** (16 `set-state-in-effect`, 4 `exhaustive-deps`, 1 `refs`) — modest, so no stop-and-ask. Disposition of every violation:

- **12 fixed with documented patterns (no behaviour softening):** prop-sync and reset-on-close effects became **adjust-state-during-render** with prev-comparison (AboutDialog ×2, OnboardingDialog ×2, ReportBrokenCaptureDialog ×2, SolvePanel, SectionPicker, `useCourseRanking`'s guard reset); `ReportBrokenCaptureDialog`'s ref write moved out of render into an effect (the `refs` violation); `PlanWorkspace`'s `currentSections` wrapped in `useMemo` (3 `exhaustive-deps` warnings, one root); `useProfessorPreferences` destructures `scope` so `reload` stops closing over the object identity (stale-closure class, the exact thing this rule exists for).
- **9 targeted suppressions, each with a one-line justification comment** — all the same shape: a one-shot fetch effect whose *synchronous prefix* raises a loading flag before the first paint (useCapture, usePlanRefresh, useOptions, usePlanDetail, usePlans, useSectionPicker, AboutDialog's app-info fetch, ReportBrokenCaptureDialog's report fetch, useCourseRanking's flags), plus `useProfessorPreferences`' `reload()` call whose setStates all sit after an `await` the rule cannot see through. The rule stays fully active; any new violation errors out.

That work **found and fixed a real bug**: `SectionPicker`'s mount-firing reset defeated `initialConfirmingRemove` — the prop never survived first paint in the running app; it only "worked" in tests because `renderToStaticMarkup` never runs effects (the finding-4 disease in miniature). The reset now fires only on a genuine course change, and the three tests that pin the prop pass again.

- **`noUncheckedIndexedAccess` enabled; all errors resolved with zero `!`.** 105 errors (one fewer than the audit's 106 — the OnboardingDialog restructure above had already removed one). Source fixes narrow or destructure so the guard *is* the proof (`conflicts.ts` now iterates `sections.slice(i + 1)`, mirroring Rust's `&sections[i + 1..]`; `options.ts` regex groups destructured; `palette.ts` throws a loud error if the palette is ever emptied, making the modulo lookup total). Test fixtures get a `mustExist`/`matchGroup` helper per file.
- **Found contrary to the audit: 46 pre-existing non-null assertions**, all `regexp.exec()![n]` in test files (App, CaptureBar, CapturedCatalog, ExportMenu, PlanWorkspace, SectionPicker, SolutionCard, SolvePanel, visualRevision, WeekGrid). Removed all 46; the "zero `!`" invariant is now actually true.

#### The ignore lists stay in step

- New `src/repoGuardrails.test.ts`: every directory-shaped `.gitignore` entry must be covered by an eslint ignore (syntactic rule documented in the file; it cannot distinguish the directory `.idea` from the file `.env` — noted there). **The test went red on its first run**: `dist-ssr` (and `.vscode`, `release-staging`) were gitignored but eslint-lintable — the finding-0 gap, found before it could bite. `eslint.config.js` now ignores all of them, with a comment naming the test that keeps the lists in step.
- Second test: `verify` must chain `verify:rust` after the web steps with `&&` and no `||` anywhere; `verify:rust` must run clippy and `cargo test` in both feature configurations.

**Proved to bite:** removed `.codebuddy/**` from eslint ignores → red with the exact finding-0 message; removed `verify:rust` from the verify chain → red. Both restored. (The new flag also bit its own author: `noUncheckedIndexedAccess` flagged `pkg.scripts.verify` in this very test file; guarded.)

#### [lints] for Cargo.toml — considered, closed

Pedantic clippy over ~21k lines of Rust would drown the signal: the default set already runs with `-D warnings` on both feature configurations and the audit found zero `#[allow]` to suggest suppressed noise. The marginal catch (needless_pass_by_value, significant-drop) is not worth a mass of exceptions. **Default set stays; this line is closed rather than left open.**

#### Dependencies

- New (human-approved during dispatch): `happy-dom`, `eslint-plugin-react-hooks` — dev-only, recorded above.
- `npm audit`: 0 vulnerabilities. 7 packages behind; **majors NOT taken here for a separate ticket**: `vite` 7→8, `typescript` 5.8→7, `@vitejs/plugin-react` 4→6. Patch/minor behind: `@types/react-dom`, `eslint`, `typescript-eslint`, `lucide-react`.

#### Baseline hiccup

The first `npm run verify` of the session died at the Rust link step (`link.exe` exit `0xc0000142`, a transient Windows toolchain fault under parallel linking). It is not a code issue; building with `-j 2` linked clean and the fault never recurred.
