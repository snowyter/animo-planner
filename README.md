# Animo Plan

A read-only enlistment planner for DLSU Manila's Archer's Hub. It captures the sections a
student searches for, keeps them locally, and solves for conflict-free schedules. It never
enlists, never writes to Archer's Hub, and never stores credentials.

## Installing on Windows

The installer is **unsigned**. The first time you run it, Windows SmartScreen will show a
**"Windows protected your PC"** warning naming the publisher as unknown. This is the wall every
unsigned app hits, not a virus report. To run it:

1. Click **More info**.
2. Click **Run anyway**.

The same wall reappears after updates are installed automatically — this is expected until the
app ships a code-signed installer.

## Development

- `npm run dev` — Vite frontend dev server
- `npm run tauri dev` — desktop app in dev mode
- `npm run verify` — full check: typecheck, unit tests, lint, and Rust clippy + tests in **both**
  feature configurations

## Auto-updater

The app checks GitHub Releases for newer versions and installs them via `tauri-plugin-updater`,
with a static `latest.json` served from
`https://github.com/snowyter/animo-planner/releases/latest/download/latest.json`.

The whole updater lives behind the default Cargo feature `updater`. Producing a build without it
(for example a Microsoft Store submission, where self-updating is disallowed) is a config change:

```
cargo tauri build --no-default-features
```

That build contains no updater code at all. `npm run verify` compiles both configurations, so the
feature-off build cannot silently rot.

### Releasing an update

- The private signing key lives **outside the repo** and is ignored by git (`*.key`). The matching
  public key is embedded in `src-tauri/tauri.conf.json` under `plugins.updater.pubkey`.
- To create keypair: `npm run tauri signer generate -w ~/.tauri/animo-plan.key`
- To build signed update artifacts, provide the private key via the `TAURI_SIGNING_PRIVATE_KEY`
  environment variable, then run `npm run tauri build`. Upload the installers and the generated
  `latest.json` to a GitHub Release.
- If the private key is lost, existing installs can no longer be updated — generate a new keypair,
  but note that old installs will reject the new signatures.

## Layout

- `src/core/` — pure TypeScript domain logic and utilities (no I/O, no framework imports)
- `src/adapters/` — TypeScript IPC client stubs and Tauri bridge
- `src/components/` — React UI components and views
- `src-tauri/src/core/` — pure Rust parser, solver, and domain models (no I/O, no Tauri)
- `src-tauri/src/adapters/` — SQLite persistence and loopback HTTP listener
- `src-tauri/src/interface/` — Tauri IPC command handlers
- `.scratch/` — specs and tickets
- `docs/adr/` — decisions already made
- `CONTEXT.md` — domain glossary

## Disclaimer

Animo Plan is a student-built tool with no affiliation to, endorsement by, or connection with
De La Salle University. It never enlists, never modifies your records, and never stores your
credentials.
