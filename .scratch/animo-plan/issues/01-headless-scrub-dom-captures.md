# 01 — [headless] Scrub and commit the DOM captures as fixtures

**What to build:** The two live Course Finder captures (`CSINTSY`, 5 sections; `GEARTAP`, 42 sections) exist in the repo as test fixtures with every piece of student-identifying data removed, so the parser can be developed against real DOM and the repo can go public without leaking anyone's records.

Every downstream parser, sample-data, and report-scrubbing ticket reads these. See `SPEC.md` §2 (verified facts), §8 (privacy hazard), §9 (distribution).

> The raw captures are **not yet in the repo**. They must be supplied before this ticket can start.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] Both captures are committed as fixture files under the project's test-fixture convention
- [ ] `hdnStudId`, `userID`, `IP_ADDRESS`, and `MAC_ADDRESS` are removed or replaced with obvious placeholders in both files
- [ ] An automated test scans every fixture for those four field names and for any value shaped like a MAC address or an IPv4 address, and fails if one is found
- [ ] That test runs as part of the verify command, so a future contributor cannot add an unscrubbed fixture without CI catching it
- [ ] The fixtures still contain the full `#tblCourseSelection` markup, the `data-start-date` / `data-end-date` attributes, the hidden courseId and sectionId cells, and the `data-key` attributes — scrubbing must not remove anything the parser depends on
- [ ] The course dropdown is preserved in each fixture with its selected option intact, since course identity is only readable there
