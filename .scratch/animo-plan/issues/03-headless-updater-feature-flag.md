# 03 — [headless] Auto-updater behind a Cargo feature flag

**What to build:** A shipped build checks GitHub Releases for a newer version and can install it, unsigned. The whole updater sits behind a Cargo feature flag, so producing a build without it — for a Microsoft Store submission, where a self-updater is disallowed — stays a config change rather than a refactor.

See `SPEC.md` §9. This ticket has no dependencies and is deliberately available as filler whenever the headless lane is waiting on something else.

**Blocked by:** None — can start immediately.

**Status:** done — merged to main in `4e97653`

- [ ] `tauri-plugin-updater` is configured against GitHub Releases
- [ ] The updater compiles in and out cleanly behind a Cargo feature, and the feature-off build contains no updater code
- [ ] The verify command builds both feature configurations, so the Store-shaped build cannot silently rot
- [ ] The app version is readable at runtime by the UI, since the About screen will display it
- [ ] The README documents the SmartScreen "unrecognized app" wall that an unsigned binary produces — it is the first thing a student installing this will hit
