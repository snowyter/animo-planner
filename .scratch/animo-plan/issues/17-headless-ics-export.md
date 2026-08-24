# 17 — [headless] ICS export

**What to build:** A plan serialises to a calendar file that imports cleanly into Google Calendar, so the moment enlistment succeeds the student's schedule is already in their calendar.

See `SPEC.md` §7 (export).

**Blocked by:** 08

**Status:** done — merged to main in `a020eae`

- [ ] A command returns a valid `.ics` for a given plan
- [ ] Each schedule block becomes a recurring weekly event spanning the section's start and end dates
- [ ] Event summaries carry the course code and section code; descriptions carry the modality and, when present, the teacher and remark
- [ ] Online blocks are distinguishable from room-based ones in the exported event location
- [ ] The file imports into Google Calendar without warnings, and events land on the correct days including Saturday
- [ ] Time zone handling is explicit rather than floating, so the events do not drift for a student whose machine is set to another zone
- [ ] Export works with no network connection
- [ ] A plan holding conflicting sections still exports — overlapping calendar events are valid and are the student's own choice
