# 11 — [ui] Week grid

**What to build:** A plan renders as a week at a glance — six day columns, the seven time-lattice rows, and each section's meeting blocks placed where they fall. A student scanning it can answer "where does GEARTAP sit", "which of these are on campus", and "how full is this section" without clicking anything. Demoable immediately against the sample-data plan from ticket 07.

**Hand-rolled as a CSS grid with absolutely positioned blocks — do not reach for a calendar library.** `SPEC.md` §7 explains why: calendar libraries fight overlap highlighting, ghost previews, and per-block modality badges, all three of which this app needs. It is roughly 150 lines, fully owned.

**Blocked by:** 06, 07, 08

**Status:** ready-for-agent

- [ ] The grid is **Mon–Sat**, six columns. Not Mon–Fri — the observed day pairs include WED/SAT
- [ ] Seven lattice rows at 07:30, 09:15, 11:00, 12:45, 14:30, 16:15, 18:00, with blocks positioned by their actual start and end times rather than snapped to a row index, so an off-lattice section still renders in the right place
- [ ] **Hue encodes course identity and nothing else.** A hybrid section's two blocks share one hue — encoding modality in hue would render a hybrid section as two blocks that look like unrelated courses, inverting the thing the grid exists to show
- [ ] Modality reads from a left-border style plus an icon, per block
- [ ] Enrolled-over-cap shows as a small numeric label — the precise value matters more than the gist
- [ ] Pinned versus tentative reads from border weight or opacity: visible, not loud
- [ ] **Overlapping blocks render hatched**, and a persistent conflict count sits in the plan header. Conflicts are displayed, never prevented
- [ ] The palette is categorical, stays distinguishable at eight or more courses, is accessible, and is correct in both light and dark themes
- [ ] The grid renders correctly for a plan with one section, with a section whose blocks are all online, and with a plan whose sections conflict on multiple days
