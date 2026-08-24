# 09 — [headless] Loopback capture endpoint and undo

**What to build:** A local HTTP listener that accepts exactly one kind of write — a batch of captured section rows — authenticates it with a token minted fresh each launch, runs it through the parser, and stores it. Plus an undo that reverses the most recent batch.

This endpoint is the only channel between the remote Archer's Hub page and the Rust core. `SPEC.md` §3 explains why: Tauri IPC is never granted to the remote origin, because Tauri has shipped an origin-check bypass and an XSS on the university site would otherwise reach Rust commands on every installed copy.

**Blocked by:** 05

**Status:** done — merged to main in `da58611`

- [ ] A listener binds to `127.0.0.1` on a random free port at launch and is never reachable from another machine
- [ ] A bearer token is generated per launch, is not persisted anywhere, and is required on every request. A request without it, or with a stale one from a previous launch, is rejected
- [ ] The endpoint exposes exactly one write route and nothing else. There is no read route, no listing, no health endpoint that leaks state
- [ ] A posted batch flows through the ticket-04 parser and the ticket-05 store, deduping on `(campus, session, courseId, sectionId)`
- [ ] **Raw HTML is never persisted.** Only the allowlisted fields in `SPEC.md` §5 survive parsing; everything else is discarded
- [ ] A malformed or unparseable payload is rejected with a diagnostic and stores nothing partial
- [ ] Undo reverses the most recent capture batch — the sections and snapshots it introduced — and is safe to call when there is nothing to undo
- [ ] A running count of captured sections and distinct courses is queryable, for the counter in ticket 12
- [ ] Tests post fixture payloads to a live listener and assert: happy path, missing token rejected, wrong token rejected, malformed payload rejected with nothing written, repeat post deduping, and undo restoring the prior state
