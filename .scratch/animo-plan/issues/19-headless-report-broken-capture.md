# 19 — [headless] Report-broken-capture payload and scrubber

**What to build:** When capture fails to parse, the app can assemble a bug report that is actually diagnosable — the parse error, the app and selector-config versions, and the specific fragment of DOM that failed — with every piece of student-identifying data stripped out first. The result is a pre-filled GitHub issue the student reviews before anything leaves their machine.

This yields better artifacts than telemetry would, and keeps the student in control of what they send. The app has no telemetry and no phone-home; see `SPEC.md` §8 and §9.

**Decided before dispatch — where the fragment is scrubbed.** Nothing currently supplies the failing DOM. At the parse-failure site in `adapters/capture.rs` the offending `payload.html` is in scope, but `reject` propagates only a message: the `capture:failed` event carries `{ error }` and the TypeScript listener is typed to match. Closing that gap by emitting the raw fragment to the webview was considered and **rejected** — unscrubbed DOM carrying `hdnStudId`, `userID`, `IP_ADDRESS`, and `MAC_ADDRESS` would then sit in the frontend, where devtools or a crash log can reach it. **Scrub in Rust at the failure site and keep the fragment Rust-side**, so raw DOM never leaves the core. This is the reading `SPEC.md` §8 and the "before the report is assembled" criterion below already imply.

The practical consequence is that `BuildCaptureReportArgs.fragment` — declared in ticket 02 when the caller was assumed to hold the DOM — may no longer be the right shape, since the fragment now comes from Rust rather than from the UI. Changing it is allowed but is a contract amendment: update the Rust command and `src/adapters/ipc/` in the same commit and name the change in the PR description, per ticket 02.

**Blocked by:** 10, 18

**Status:** done — merged to main in `e2e18f3`

- [ ] A command takes a parse failure and returns a report containing the error, the app version, the selector-config version, whether the config was remote or bundled, and the offending DOM fragment
- [ ] **The scrubber removes `hdnStudId`, `userID`, `IP_ADDRESS`, and `MAC_ADDRESS`** from the fragment, along with anything shaped like a MAC address or an IPv4 address, before the report is assembled
- [ ] The scrubber is tested directly against unscrubbed input containing each of those fields, and against the raw shape of the ticket-01 captures before scrubbing
- [ ] The fragment is trimmed to what is diagnostically useful rather than the whole page
- [ ] The report renders as a pre-filled GitHub issue URL that the student opens themselves. **The app never posts it**
- [ ] The scrubbed report text is returned in full so ticket 23 can show it to the student for review before submitting
- [ ] Nothing is transmitted anywhere by this command
- [ ] **The failing DOM never crosses into the webview unscrubbed.** The fragment is captured and scrubbed on the Rust side of the capture-failure path; whatever the frontend receives is already stripped
- [ ] A capture that fails to parse still surfaces to the UI as a visible, non-blocking notice with a route into this report flow, as ticket 12 requires — adding the fragment must not turn a failed capture into a silent one
