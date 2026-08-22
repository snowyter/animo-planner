# 22 — [ui] Export menu

**What to build:** A student can save their plan as a calendar file to import the moment enlistment succeeds, and can save the week grid as an image — which is how the app actually spreads between students.

See `SPEC.md` §7 (export).

**Blocked by:** 11, 17

**Status:** ready-for-agent

- [ ] An export control on the plan offers calendar file and image
- [ ] Calendar export calls the ticket-17 command and saves through a native file dialog, with a sensible default filename derived from the plan name and term
- [ ] Image export renders the week grid to a PNG at a resolution that stays legible when shared in a chat app
- [ ] The exported image includes the plan name, campus, and term, so a screenshot passed between students is self-describing
- [ ] The exported image uses the same visual encoding as the on-screen grid, including modality borders, enrolment labels, and hatched conflicts
- [ ] The image renders correctly regardless of the theme the app is currently in, and is not cut off for a plan whose blocks span the full Mon–Sat week
- [ ] Both exports work with no network connection
- [ ] Cancelling the file dialog leaves the plan untouched and shows no error
