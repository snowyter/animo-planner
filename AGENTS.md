# archers-hub-schedule-maker

> Purpose: A read-only enlistment planner for DLSU Manila's Archer's Hub. It captures the sections a student searches for, keeps them locally, and solves for conflict-free schedules. It never enlists, never writes to Archer's Hub, and never stores credentials.

## Commands
- `npm run verify` — full verify (TS typecheck + Vitest + ESLint + Clippy + Cargo Test)
- `npm run verify:web` — TS typecheck + Vitest + ESLint
- `npm run verify:watch` — Vitest unit tests in watch mode
- `npm run dev` — Vite frontend dev server
- `npm run tauri dev` — Tauri desktop app in dev mode
- `cargo test --manifest-path src-tauri/Cargo.toml` — single Rust test suite
- `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings` — Rust linting

## Layout
- `src/core/` — pure TypeScript domain logic and utilities (no I/O, no framework imports)
- `src/adapters/` — TypeScript IPC client stubs and Tauri bridge
- `src/components/` — React UI components and views
- `src-tauri/src/core/` — pure Rust parser, solver, and domain models (no I/O, no Tauri)
- `src-tauri/src/adapters/` — SQLite persistence and loopback HTTP listener
- `src-tauri/src/interface/` — Tauri IPC command handlers
- `.scratch/` — specs and tickets. Read for context; never edit while implementing.
- `docs/adr/` — decisions already made. Do not relitigate.
- `CONTEXT.md` — domain glossary. Use these exact terms.

## Rules
- Every module of core logic gets a colocated test.
- Core logic stays free of I/O and framework imports.
- No new dependencies without asking, except the pre-approved set in `docs/agents/dependencies.md`.
- Never edit files under `.scratch/` while implementing.
- If stuck after three red-green cycles, stop and name what's ambiguous. Do not guess.
- Never write to Archer's Hub (ADR-0001).
- No credential storage in memory or on disk (ADR-0002).
- Remote origin communicates via loopback bearer token only; never grant Tauri IPC to remote origin (ADR-0003).
- No telemetry or phone-home pings (ADR-0004).
- Modality is derived per-block from location, never parsed as a field (ADR-0007).
- Sections are never hard-deleted (ADR-0008).
- Conflicts are displayed and never prevented (ADR-0009).
- Hand-rolled CSS grid for week view — no external calendar libraries (ADR-0011).
- Hue encodes course identity only, never modality (ADR-0012).

## Agent skills

### Issue tracker

Issues live as markdown files under `.scratch/<feature-slug>/`. See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context: `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
