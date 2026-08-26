# Domain Context

Animo Plan is a read-only enlistment planner for DLSU Manila's Archer's Hub. It captures the sections a student searched for, keeps them locally, and solves for conflict-free schedules. It never enlists.

## Glossary

### The source system

**Archer's Hub**:
The university's student portal, running MasterSoft ERP. The only external system this app talks to, and it is never written to.
_Avoid_: the portal, the ERP, DLSU site

**Course Finder**:
The page inside Archer's Hub that returns sections for one course at a time. The sole source of section data.

**Capture**:
Reading the currently rendered Course Finder results into local storage. Happens silently, triggered by the student's own search.
_Avoid_: scrape, sync, import

**Refresh**:
Re-running the searches for courses already in a plan to update their live numbers. Always an explicit student action, never scheduled.
_Avoid_: poll, auto-update, sync

### What gets captured

**Course**:
A subject offered in a term, identified by a numeric course id and a `CODE - TITLE` label. Read from the course dropdown, never from the results table.

**Section**:
One scheduled offering of a course, identified by a section id and a section code. What a student actually enlists in.
_Avoid_: class, offering, slot

**Schedule block**:
One meeting of a section on one day — a day, a start time, an end time, and a location. A section has one or more; the count is never assumed.
_Avoid_: meeting, timeslot, event

**Modality**:
Whether a schedule block meets in a room or online. **A property of a block, not of a section, and always derived** from the location rather than read as a field. A section is F2F, Online, or Hybrid based on the mix of its blocks.
_Avoid_: delivery mode, format, type

**Included course**:
A captured course the student says they intend to enrol in. Searching a course and intending to take it are different acts: the catalog holds everything the student looked at, and this is the subset the solver has to fill and the picker offers. **Excluding is not forgetting** — an excluded course keeps its sections, its snapshots, its place in the catalog, and its share of the capture counter; it simply stops asking to be scheduled. A section already in a plan stays there when its course is excluded.
_Avoid_: enabled, active, selected (selected is the picker's word for a section)

**Captured vs refreshed**:
Two acts write a course. A **capture** is the student searching it in Course Finder; a **refresh** is the student pressing Refresh to re-read enrolment counts. Both advance `lastSeenAt`, so the catalog records `lastRefreshedAt` separately and names whichever act was later. During enlistment week, which one produced the numbers on screen is what decides whether they are worth acting on.

**Snapshot**:
A point-in-time reading of a section's mutable values — enrolment count, teacher, remark. Appended on every capture, never overwritten, because the change over time is itself information.

**Time lattice**:
The seven observed 90-minute start times (07:30, 09:15, 11:00, 12:45, 14:30, 16:15, 18:00). A layout convenience for the week grid, never a parsing assumption.

### Planning

**Plan**:
The artifact. A named set of chosen sections, hard-scoped to exactly one campus and one academic session. The picker and the solver both write to this one object.
_Avoid_: schedule, timetable, cart

**Pin**:
Locking a section in a plan so a solve treats it as fixed and fills only around it.
_Avoid_: lock, freeze

**Conflict**:
Two schedule blocks in the same plan overlapping in time on the same day. Computed and displayed, never prevented.
_Avoid_: clash, collision, overlap

**Solve**:
Filling a plan's unassigned courses with a conflict-free set of sections, seeded from whatever is already chosen. Never discards existing choices.
_Avoid_: generate, build, optimise

**Campus day**:
A day carrying at least one F2F block. The unit that `minimize-campus-days` counts.

**Preset**:
One of the three named ranking strategies — fewest campus days, no early mornings, most online — that scores and sorts solve results.

**Selector config**:
The JSON of DOM selectors and parse rules the capture path depends on, fetched at startup with a bundled fallback.

## Invariants

Things that must always be true. Most of these are the subject of an ADR; violating one is a defect, not a tradeoff.

- **The app never writes to Archer's Hub.** No enlistment, no form submission, no background request. Every request it makes is one the student's own click would have made.
- **No credentials are stored, in memory or on disk.** No code path reads, intercepts, autofills, or persists them.
- **The remote origin is never granted Tauri IPC.** Its only channel to the core is the loopback endpoint with a per-launch bearer token.
- **Raw HTML is never persisted.** Only allowlisted fields survive parsing.
- **`hdnStudId`, `userID`, `IP_ADDRESS`, and `MAC_ADDRESS` are never read or stored**, and never leave the machine in a bug report.
- **Nothing is transmitted anywhere except to Archer's Hub** and the static selector-config fetch. No telemetry.
- **Modality is derived from a block's location, never read as a field.**
- **A plan holds exactly one campus and one academic session.** Mixing terms is rejected at write time.
- **Sections are never hard-deleted.** A section that stops appearing is flagged, never removed.
- **A plan may legally hold conflicting sections.** Conflict is reported, never enforced.
- **The solver only ever emits conflict-free sets.** Any conflict in a plan is user-authored.
- **A blank teacher means unknown, never "not this professor".** No filter may treat it as a mismatch.
- **`remark` is stored and displayed verbatim.** Never parsed, never branched on.
- **The week is Mon–Sat**, not Mon–Fri.
- **Hue encodes course identity only.** Never modality.
- **Refresh never runs on a timer or in the background.**
