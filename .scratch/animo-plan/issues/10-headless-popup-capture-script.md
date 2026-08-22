# 10 — [headless] Archer's Hub popup and injected capture script

**What to build:** A popup window opens on Archer's Hub where the student signs in manually and searches courses exactly as they normally would. Every time the results table renders, an injected script silently reads it and posts it to the loopback endpoint. The session persists across app restarts, and a command wipes it.

Capture is silent by design — a student searches roughly ten courses back to back, and a confirmation modal each time would be ten interruptions in the exact task the app exists to speed up. See `SPEC.md` §4.

This ticket is tagged headless despite being JavaScript: the injected script is DOM scraping, not interface work, and the risk in it is parsing, not presentation.

**Blocked by:** 09

**Status:** ready-for-agent

- [ ] A popup webview window opens on Archer's Hub, separate from the main window
- [ ] **Tauri IPC is not granted to the remote origin.** The injected script's only channel to Rust is the ticket-09 loopback endpoint with its bearer token
- [ ] The student signs in manually with their own credentials. **Nothing about the login is read, intercepted, autofilled, or stored** — no credential path exists in the codebase at all
- [ ] The browser profile persists, so signing in once survives an app restart
- [ ] A mutation observer on the results table body fires on each render and captures without prompting
- [ ] Course identity is read from the selected course-dropdown option at capture time and included in the payload — sections posted without it are orphaned and unrecoverable
- [ ] The posted payload carries the campus and session the plan is scoped to, so captures cannot be misfiled across terms
- [ ] A capture that fires twice for the same render does not produce two batches
- [ ] A "sign out / clear session" command wipes the persisted profile, and is visible to the student (ticket 23 surfaces the control)
- [ ] The script reads only the allowlisted fields. `hdnStudId`, `userID`, `IP_ADDRESS`, and `MAC_ADDRESS` are present in that DOM and are never touched
- [ ] Selectors used by the injected script come from the same config the parser uses, not from separate hardcoded strings
