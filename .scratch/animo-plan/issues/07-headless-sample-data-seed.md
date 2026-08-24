# 07 — [headless] Sample-data seed

**What to build:** A single command loads the scrubbed CSINTSY and GEARTAP captures into a real, fully-populated plan, so the entire app is explorable with no ERP credentials and no network. A student deciding whether to install should not have to hand over their credentials to find out what the app does.

This also unblocks the UI lane: the week grid and section picker become demoable on real data before capture works.

See `SPEC.md` §7 (onboarding — "Explore with sample data" is an equal-weight option on the first screen).

**Blocked by:** 04, 05

**Status:** done — merged to main in `65bd657`

- [ ] One command seeds a plan from the ticket-01 fixtures, going through the real parser and the real storage layer — not through a separate hand-written insert path that could drift from production behaviour
- [ ] The seeded plan contains all 47 sections across the two courses, with their schedule blocks and derived modalities intact
- [ ] The seeded plan is visibly marked as sample data, and is distinguishable from a plan the student captured themselves
- [ ] Seeding is idempotent — running it twice does not double the sections
- [ ] The sample plan can be deleted like any other plan
- [ ] Seeding works with no network connection
