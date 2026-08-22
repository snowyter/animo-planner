# 18 — [headless] Remote selector config

**What to build:** The DOM selectors and parse rules the scraper depends on are fetched from a small JSON file on GitHub at startup, with the bundled copy as fallback. When the university changes their page, fixing every installed copy becomes a two-minute commit instead of a release cycle that cannot complete inside the enlistment window.

This scraper *will* break, and it will break for every installed copy at once, possibly mid-enlistment. See `SPEC.md` §9.

Ticket 04 already made the parser take its rules from a config struct, so this ticket only adds fetching, fallback, and versioning — it should not need to touch parsing logic.

**Blocked by:** 04

**Status:** ready-for-agent

- [ ] Selector rules load from a remote JSON file at startup
- [ ] The bundled copy is used when the fetch fails, times out, or returns something unparseable. **Startup never blocks on the network** and the app is fully usable offline
- [ ] A remote config that parses but is structurally invalid is rejected in favour of the bundled copy, rather than being loaded and breaking capture
- [ ] The config carries a version, and both the app version and the loaded selector-config version are readable at runtime for the About screen and for bug reports
- [ ] Which config is in use — remote or bundled fallback — is readable, so a student reporting a broken capture can say which one they were running
- [ ] The fetch is a plain read of a static file. **No identifying information is sent with it** — no telemetry, no query parameters carrying app or student state
- [ ] Tests cover: successful remote load, network failure falling back, malformed JSON falling back, and structurally invalid config falling back
