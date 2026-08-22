# 02 — [headless] IPC contract and typed TS client stubs

**What to build:** Every Tauri command the v1 app will ever call exists with its real name, arguments, and return type, mirrored by a typed TypeScript client that the React side imports. The bodies throw "unimplemented". Nothing works yet, but both implementation lanes now have a fixed seam to build against, and the UI lane can start before any Rust logic exists.

Derive the command set from `SPEC.md` §5 (data model), §6 (solver), §7 (UI surfaces), and §4 (capture and refresh). The types mirror the data model exactly — a plan is scoped to one `(campus, session)`, modality is per block, and `teacher` / `remark` / `enrolled` live on snapshots rather than on sections.

**This ticket is the headless/UI seam.** It exists so the two implementation lanes can run in parallel. Its entire value is in staying authoritative, so the amendment protocol below is a hard requirement, not a nicety.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] Every v1 command is declared on the Rust side with its final signature and registered with Tauri
- [ ] A typed TypeScript client exposes one function per command, with argument and return types matching the Rust types
- [ ] Every stub fails loudly and identifiably at runtime. A stub never returns empty or plausible-looking data — that would let a UI ticket be declared finished against a command that does nothing
- [ ] The types encode the invariants rather than leaving them to convention: modality belongs to a schedule block, a plan carries exactly one campus and one session, and a blank `teacher` is representable as *unknown* distinctly from "not this professor"
- [ ] The contract file states the amendment protocol at the top: this file is the single source of truth; any ticket that changes a signature updates the Rust command and the TypeScript client **in the same commit** and names the change in its PR description; UI tickets never call a command that is not declared here
- [ ] The verify command type-checks the TypeScript client, so a drifted signature is a build failure rather than a runtime surprise
