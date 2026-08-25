# 38 — [headless] The updater is registered but nothing ever calls it

**What to build:** IPC commands that check GitHub Releases for a newer version and install one, so the plugin ticket 03 configured is actually reachable. Today the updater cannot work, because no code path in the app invokes it.

**Blocked by:** None — can start immediately

**Gates:** 39

**Status:** ready-for-agent

## What is actually missing

Ticket 03 delivered the flag and the configuration, and stopped there. What exists today:

- `tauri_plugin_updater::Builder::new().build()` is registered in `lib.rs`, behind `#[cfg(feature = "updater")]`
- `plugins.updater` in `tauri.conf.json` carries the pubkey and the `latest.json` endpoint
- `createUpdaterArtifacts: true`, so every build emits signed `.sig` files, and both v0.1.0 and v0.2.0 shipped them

What does not exist, verified by search across `src/` and `src-tauri/src/`:

- **No call to `check()` anywhere.** Not in Rust, not in TypeScript
- **No `@tauri-apps/plugin-updater`** in `package.json`, and nothing in `node_modules/@tauri-apps/` but `api`, `cli`, and `plugin-opener`
- **No `updater:*` permission** in `src-tauri/capabilities/default.json`, which lists only `core:default` and `opener:default`

So the plugin is loaded and inert. The signed artifacts on both releases have never been read by anything. "The updater does not work" is not a defect in the update path — there is no update path.

## Decided before dispatch

**Rust-side, behind the existing IPC seam — not the JS plugin.** `tauri-plugin-updater` exposes a Rust API (`app.updater()?.check()`, `update.download_and_install(..)`), which keeps this consistent with how everything else in this app works: logic in Rust, one typed seam, no new frontend dependency and no new capability granted to a webview. Adding `@tauri-apps/plugin-updater` plus an `updater:default` permission was the alternative and is rejected — it buys nothing here and widens the main window's permissions for a feature two buttons need.

**The student decides. Nothing installs itself.** A check may report; only an explicit action installs. An app that replaces itself under a student mid-enlistment is the wrong kind of surprise.

**This is not a phone-home (ADR-0004).** The endpoint is a static `latest.json` on GitHub Releases fetched with no identifying query parameters — the same character as the selector-config fetch that already runs at every startup (ADR-0013). The app therefore gains **no new destination and reveals nothing it did not already reveal**: it contacts GitHub on launch today. Say this explicitly somewhere durable — ADR-0004's text enumerates "Archer's Hub and a static fetch of the selector config", and a reader checking the app's trust story against that sentence deserves to find the update check named rather than having to reason it out. A short ADR extending 0004 is the right home; do not edit 0004's decision.

## Acceptance criteria

- [ ] **A command checks for an update** and answers with enough for a UI to say something useful: whether one is available, the version offered, the version running, and the release notes if the endpoint carries them
- [ ] **A command installs the update the check found**, and the app restarts into it. Nothing installs without this being called
- [ ] **A failed or unreachable check is an ordinary answer, never a crash and never a scary one.** Offline, a 404, a malformed `latest.json`, a signature that does not verify — each resolves to "no update available" plus a distinguishable reason the UI may show quietly. The app is fully usable offline and this must not change
- [ ] **A signature that does not verify never installs.** The pubkey in `tauri.conf.json` is the whole security model for this path; a rejected signature is a failed check, not a prompt
- [ ] **Both feature configurations compile and behave.** `npm run verify` builds with and without `--no-default-features`; the commands must exist in both, with the same signature, and report the updater as unavailable when it is compiled out rather than failing to build or panicking. `UPDATER_ENABLED` already exists for exactly this
- [ ] **Adding commands is a contract amendment** under ticket 02's protocol: `docs/ipc-contract.md` and `src/adapters/ipc/` change in the same commit, and the change is named in the PR description
- [ ] The client functions live in **`src/adapters/ipc/client.ts`**, not in a side module. `src/adapters/appVersion.ts` calls `get_app_version` from outside that file and so escapes the contract test's "exposes exactly the declared commands" guard — do not add a second escapee
- [ ] Nothing is sent about the machine or the student. No identifying query parameters, no headers carrying anything about who is asking (ADR-0004)
- [ ] A short ADR records the update check as the third static read, extending ADR-0004 rather than editing it
- [ ] Tests cover: an available update reported with both versions, no update when the running version is current, each failure mode resolving to a clean answer rather than an error, and the compiled-out build reporting unavailable

## Worth knowing before starting

**The update path has never run, in any build.** Treat the first successful check as a finding to verify rather than a step that obviously works. In particular the signature's trusted comment names the file as built — `Animo Plan_0.2.0_x64-setup.exe` — while the release asset is uploaded as `AnimoPlan_0.2.0_x64-setup.exe`, space removed. Verification is over the file's bytes, so this should not matter; if a check reaches the download and then rejects it, this is the first thing to look at, and the fix is the release naming rather than the code.

**v0.1.0 and v0.2.0 are both published and signed with the same key,** so a real end-to-end test is available: install 0.1.0, check, and expect 0.2.0 to be offered. Do not simulate this with a fixture and call it done.

## Explicitly out of scope

- Download progress reporting. The installer is under 5 MB; a spinner is enough, and a progress event is a contract addition for very little
- Any automatic or scheduled check. Ticket 39 decides when a check runs from the UI
- Changing how releases are built or named, unless the end-to-end test proves the naming is the blocker
