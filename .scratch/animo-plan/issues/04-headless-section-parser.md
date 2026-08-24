# 04 — [headless] Section parser

**What to build:** Given the HTML of a rendered Course Finder results table plus the course identity read from the page's course dropdown, produce typed sections and their schedule blocks — day, start time, end time, location, and derived modality. Pure logic: no database, no network, no Tauri. Verifiable entirely against the fixtures from ticket 01.

This is the load-bearing piece of the whole app. `SPEC.md` §2 is the specification; treat every regularity listed there as observed-but-not-guaranteed unless it is marked settled.

**Selectors and parse rules arrive in a config struct passed to the parser, never as constants inside it.** Ticket 18 will fetch that config from GitHub at startup; writing the parser to accept it from the beginning is what keeps ticket 18 additive instead of a change that touches every call site.

**Blocked by:** 01

**Status:** done — merged to main in `e3f637b`

- [ ] Both fixtures parse to the expected counts — 5 sections for CSINTSY, 42 for GEARTAP, with 84 total schedule blocks across the GEARTAP sections
- [ ] Course code and title come from the selected course-dropdown option, never from the table, which has no course code column. A row parsed without that context is an error, not an orphaned section
- [ ] Schedule cells split into one block per meeting day, and each block yields day, start time, and end time
- [ ] The location slot parses as either a room code or the literal `Online`, and **modality is derived from that** — it is never read as a scraped field. A section's overall modality (F2F / Online / Hybrid) is computed from the mix of its blocks
- [ ] Block count per section is never assumed. A section with one block, three blocks, or none parses without panicking, even though every GEARTAP section had exactly two
- [ ] A location that is neither a room code nor `Online` — TBA, blank, unrecognised — parses into a representable state and raises a diagnostic, rather than being dropped or guessed at
- [ ] Times parse to minutes so they compare directly. The 7-slot lattice is not hardcoded as a closed set, since a section off the lattice must still parse
- [ ] Blank `teacher` parses as *unknown*, distinct from any value; blank `remark` likewise. `remark` is captured verbatim and never parsed or branched on
- [ ] Section start and end dates are parsed. When a row's dates differ from the others in the same result set, a diagnostic warning is raised and parsing continues — date-range conflict logic is out of scope for v1
- [ ] The parser reads only the fields in `SPEC.md` §5. `hdnStudId`, `userID`, `IP_ADDRESS`, and `MAC_ADDRESS` are never read, and no test asserts on them
- [ ] Every selector and grammar rule arrives via the config struct with a bundled default. No selector string is hardcoded at a call site
