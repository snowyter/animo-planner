# SQLite for local storage, not JSON files

Local state lives in SQLite via `tauri-plugin-sql`, not in JSON files on disk.

A flat file would be simpler for the plan itself, but the interesting queries are time-series: how fast a section is filling, what a teacher assignment looked like last week, how this term's demand compares to a prior one. Snapshots accumulate on every capture and are never overwritten, so the store is append-heavy and query-shaped from day one. Rewriting a JSON blob per capture would be the wrong shape by the second feature.

## Consequences

- `teacher`, `remark`, and `enrolled` live on `snapshots` rather than on `sections`, because their change over time is itself information.
- Migrations are a real concern and must run idempotently against an existing student's database.
