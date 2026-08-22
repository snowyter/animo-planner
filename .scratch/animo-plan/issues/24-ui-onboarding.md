# 24 — [ui] Onboarding

**What to build:** A first run that gets a new student from opening the app to seeing their own sections on the grid, in three steps, skippable at any point — and an equally prominent way to explore the whole app on sample data without signing in to anything.

A student evaluating whether to install this should not have to hand over university credentials to find out what it does. That is why the sample-data path is an equal-weight option on the first screen rather than a link in a corner. See `SPEC.md` §7 (onboarding).

**Blocked by:** 07, 12, 13

**Status:** ready-for-agent

- [ ] First run presents two paths of equal visual weight: start a real plan, or **"Explore with sample data"**
- [ ] The sample-data path seeds the ticket-07 plan and drops the student straight onto the populated grid, with no sign-in and no network
- [ ] The real path is three steps: pick campus and term, sign in, search your first course
- [ ] Every step is skippable, and skipping leaves the student in a usable app rather than a half-configured one
- [ ] The tour does not run again after first completion or dismissal
- [ ] A persistent `?` replays the tour from anywhere
- [ ] The sign-in step states before opening the popup that the student is signing in on the university's own site and that the app stores no credentials
- [ ] The disclaimer is visible during first run, not only on the About screen
- [ ] Onboarding works end to end with no network as long as the student chooses the sample-data path
