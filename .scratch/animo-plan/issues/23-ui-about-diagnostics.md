# 23 — [ui] About and diagnostics

**What to build:** A screen that answers "what is this thing and should I trust it". It carries the disclaimer, both version numbers, a link to the public source, a control to sign out and wipe the stored session, and the flow for reporting a broken capture — where the student reads the scrubbed report themselves before deciding to send it.

Students are being asked to type university credentials into a window this binary controls. "Read the source" is the only honest answer to "why should I trust this", and this screen is where that answer lives. See `SPEC.md` §8 and §9.

**Blocked by:** 12, 19

**Status:** ready-for-agent

- [ ] The disclaimer appears verbatim: a student-built tool with no affiliation to, endorsement by, or connection with the university; it never enlists, never modifies records, and never stores credentials
- [ ] The app version and the selector-config version are both visible, along with whether the config in use is the remote one or the bundled fallback — bug reports are undiagnosable without these
- [ ] A link opens the public source repository
- [ ] **Sign out / clear session** wipes the persisted browser profile, confirms before doing it, and states what it will and will not remove — captured sections stay
- [ ] Report-broken-capture opens a dialog showing the **full scrubbed report text** the student is about to send
- [ ] The student can read and edit that text before submitting, and submitting opens a pre-filled issue in their browser. **The app never posts on their behalf**
- [ ] The dialog says plainly what was stripped out, so the student can verify rather than take it on faith
- [ ] The report flow is reachable from a failed capture notice as well as from this screen
