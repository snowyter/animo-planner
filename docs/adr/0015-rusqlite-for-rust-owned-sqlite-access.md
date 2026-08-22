# rusqlite for Rust-owned SQLite access, not tauri-plugin-sql

SPEC §5 and ADR-0006 name `tauri-plugin-sql` as the SQLite mechanism. Ticket 05 used `rusqlite` (bundled SQLite) instead.

`tauri-plugin-sql` exists to hand SQL strings from the frontend to a plugin-managed connection. This app's storage is deliberately Rust-owned: every write path is a Tauri command with Rust-side migrations, validation, and tests, and the frontend never sees SQL. The plugin's shape fights that split — it adds a frontend SQL surface we would then have to firewall off, while giving nothing back to the Rust side.

## Consequences

- `rusqlite` with the `bundled` feature is a direct dependency; migrations and all write paths live in `src-tauri/src/adapters/store.rs` with colocated tests running against temporary databases.
- Schema and write invariants (upsert dedupe, snapshot append, plan scope, no hard deletes) are enforced in Rust and tested there, not delegated to the frontend.
- No SQL string ever crosses the Tauri IPC boundary.
- Section start/end dates are deliberately not persisted in migration 1: SPEC §5 omits them. A later ticket can add them as a migration.
