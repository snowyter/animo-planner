# 12 — [ui] Capture launch, running counter, and undo

**What to build:** From the main window a student opens Archer's Hub, signs in, and searches courses. As they search, the main window shows a live count climbing — "42 sections from 8 courses" — so they can see the app is working without being interrupted. If a search captures something they did not want, one Undo removes it.

This closes the capture tracer bullet: after this ticket, a real student can get their real sections into the app.

See `SPEC.md` §4.

**Blocked by:** 06, 10

**Status:** done — merged to main in `2c6b88b`

- [ ] A control on the plan screen opens the Archer's Hub popup, scoped to the plan's campus and session
- [ ] The counter updates live as captures arrive and reads in the form "N sections from M courses"
- [ ] **No prompt, modal, or confirmation appears per search.** Capture is silent
- [ ] Undo reverses the most recent capture batch and is discoverable next to the counter
- [ ] Undo is disabled, not broken, when there is nothing to undo
- [ ] The student is told plainly, before the popup opens, that they are signing in to the university's own site and that the app never stores credentials
- [ ] A capture that fails to parse surfaces as a visible, non-blocking notice with a route to the report flow (ticket 23), rather than being swallowed
