# archers-hub-schedule-maker

> Purpose: TBD — filled in after grilling.

## Commands
TBD — filled in by BOOTSTRAP Track A.

## Layout
- `.scratch/` — specs and tickets. Read for context; never edit while implementing.
- `docs/adr/` — decisions already made. Do not relitigate.
- `CONTEXT.md` — domain glossary. Use these exact terms.

## Rules
- Every module of core logic gets a colocated test.
- Core logic stays free of I/O and framework imports.
- No new dependencies without asking.
- Never edit files under `.scratch/` while implementing.
- If stuck after three red-green cycles, stop and name what's ambiguous. Do not guess.
