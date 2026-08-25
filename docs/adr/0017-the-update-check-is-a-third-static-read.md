# The update check is the third static read

This extends ADR-0004 rather than editing it. A reader checking the app's trust story
against that ADR's sentence — "it only talks to Archer's Hub and a static fetch of the
selector config" — deserves to find the update check named here instead of having to reason
it out of the updater's configuration.

The updater's check reads a static `latest.json` from the project's GitHub Releases with no
identifying query parameters and no headers carrying anything about who is asking. It is
the same character of request as the selector-config fetch at startup (ADR-0013): a fixed
URL on a host the app already contacts, revealing nothing it did not already reveal. This
is not telemetry; there is no counter, no ping, no report.

The student decides. A check may report that a newer version exists; only an explicit call
to `install_update` downloads anything, and nothing installs itself while a student is
mid-enlistment. Install verification runs against the pubkey in `tauri.conf.json` — that
key is the whole security model for this path — and a signature that does not verify is a
failed install, never a prompt asking to proceed anyway.

The commands live behind the same IPC seam as everything else in the app, Rust-side: the
webview gains no new capability and no new frontend dependency. When the updater feature is
compiled out, the same commands exist and answer "unavailable".

## Consequences

- The endpoint stays a static `latest.json` URL with no query parameters; any parameter or
  header carrying app or machine state turns this into telemetry and must be refused.
- Checks are always user-initiated; there is no timer and no startup check.
- A failed check is an ordinary answer the UI may show quietly — the app remains fully
  usable offline, exactly as ADR-0004 requires.
