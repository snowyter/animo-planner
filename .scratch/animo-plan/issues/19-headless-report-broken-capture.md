# 19 — [headless] Report-broken-capture payload and scrubber

**What to build:** When capture fails to parse, the app can assemble a bug report that is actually diagnosable — the parse error, the app and selector-config versions, and the specific fragment of DOM that failed — with every piece of student-identifying data stripped out first. The result is a pre-filled GitHub issue the student reviews before anything leaves their machine.

This yields better artifacts than telemetry would, and keeps the student in control of what they send. The app has no telemetry and no phone-home; see `SPEC.md` §8 and §9.

**Blocked by:** 10, 18

**Status:** ready-for-agent

- [ ] A command takes a parse failure and returns a report containing the error, the app version, the selector-config version, whether the config was remote or bundled, and the offending DOM fragment
- [ ] **The scrubber removes `hdnStudId`, `userID`, `IP_ADDRESS`, and `MAC_ADDRESS`** from the fragment, along with anything shaped like a MAC address or an IPv4 address, before the report is assembled
- [ ] The scrubber is tested directly against unscrubbed input containing each of those fields, and against the raw shape of the ticket-01 captures before scrubbing
- [ ] The fragment is trimmed to what is diagnostically useful rather than the whole page
- [ ] The report renders as a pre-filled GitHub issue URL that the student opens themselves. **The app never posts it**
- [ ] The scrubbed report text is returned in full so ticket 23 can show it to the student for review before submitting
- [ ] Nothing is transmitted anywhere by this command
