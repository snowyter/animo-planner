# Animo Plan — Specification

An unofficial, student-built, **read-only** enlistment planner for DLSU Manila's Archer's Hub.

> **Disclaimer (ships in README + About screen):** Animo Plan is a student-built tool with no
> affiliation to, endorsement by, or connection with De La Salle University. It never enlists,
> never modifies your records, and never stores your credentials.

---

## 1. Problem

Archer's Hub's Course Finder returns sections for **one course at a time**, and offers no way to
compare sections across courses or check them for time conflicts. Students plan enlistment in
spreadsheets or on paper. Animo Plan captures the sections a student actually cares about, keeps
them locally, and solves for conflict-free schedules.

### Non-goals

- **Never writes to Archer's Hub.** No auto-enlistment, no clicking Add. Enlistment stays manual.
- **No credential storage**, in memory or on disk. (See §8.)
- **No catalog scraping.** The dropdown holds 2,300 courses; we capture only what the student searches.
- **No background polling.** Refresh is always an explicit user action.

---

## 2. Verified facts about Archer's Hub

Established from two live Course Finder DOM captures (`CSINTSY`, 5 sections; `GEARTAP`, 42 sections)
and the public login page. **These are load-bearing — re-verify before changing anything downstream.**

### Platform

- MasterSoft ERP (iitms.co.in), ASP.NET + jQuery + select2. Finder logic in `/Scripts/CourseFinder.js`.
- Login offers **"Username / Email" + "Password/OTP"** *and* "Continue with Google".
  The credential form is what we depend on — Google OAuth is frequently blocked inside embedded
  webviews (`disallowed_useragent`). The `Password/OTP` label implies a second factor may be in play.
- Page runs `Inactivity.js`; sessions time out.

### Selects

| Element | Contents |
|---|---|
| `#ddlSelectCampus` | Manila=7, Laguna=8, Rufino=9, + combined-campus options |
| `#ddlSelectAcadSession` | AY2026-27 T1=155, T2=156, T3=157, Annual=144, SHS=161 |
| `#ddlSelectCourse` | **2,300 options**, `value` = numeric course id, text = `"CODE - TITLE"` |

### Results table `#tblCourseSelection`

Columns: Course Type · Teacher · Credits · Section · Schedules · Enroll Cap · Enrolled · Remark · Action

Each `<tr>` also carries:

- `data-start-date` / `data-end-date` (e.g. `07/10/2026` / `12/09/2026`)
- a trailing `<td hidden>` pair holding **courseId** and **sectionId**
- `data-key="2923%7C384%7C"` → decoded `2923|384|`

> **The table has no course code column.** Course identity must be read from the selected
> `#ddlSelectCourse` option at capture time, or sections are orphaned.

### Schedule cell grammar

`<br>`-joined blocks, one per meeting day:

```
[ TUESDAY - 02:30 PM - 04:00 PM : Room - L226 ]
[ FRIDAY  - 02:30 PM - 04:00 PM : Online ]
```

The location slot is **either** `Room - <CODE>` **or** the literal `Online`.

- **Modality is per-block (per-day), and is never a scraped field — it is derived.**
  A section is `F2F` / `Online` / `Hybrid` based on the mix of its blocks.
- GEARTAP: 84 blocks over 42 sections — 38 in rooms, 46 online.

### Structural regularities observed

- **Time lattice**, all 90 min with 15-min breaks:
  `07:30 · 09:15 · 11:00 · 12:45 · 14:30 · 16:15 · 18:00`
- **Day pairs**: MON/THU, TUE/FRI, **WED/SAT**. The grid is **Mon–Sat**, not Mon–Fri.
- Every GEARTAP section had exactly 2 blocks. *Do not hardcode this.*
- All rows shared identical start/end dates → **sections span the full term**. Date-range conflict
  logic is not implemented; a mismatch raises a diagnostic warning instead.
- **`Teacher` was empty in 42/42 GEARTAP rows** and 3/5 CSINTSY rows. It populates over time.
  (The site's column is labelled *Teacher*; the app calls the person a **professor** — see `CONTEXT.md`.)
- **`Remark` was empty in all 47 rows observed.** Contents unknown → opaque passthrough.
- Enrolled counts are live and non-zero well before enlistment (42/45, 39/45, 38/40 seen).
- Section-code prefixes (`Y`, `Z`, `S`, `C`, `A`, `E`, `L`, `V`) may encode college eligibility.
  **Deliberately disregarded in v1**; noted as a future filter.

### Privacy hazard

Course Finder DOM contains `userID`, `hdnStudId`, `IP_ADDRESS`, and **`MAC_ADDRESS`**.
Raw HTML is never persisted, and any HTML used as a test fixture must be scrubbed first.

---

## 3. Architecture

```
┌─ Tauri v2 app ────────────────────────────────────────────┐
│                                                            │
│  React + TS + Vite + Tailwind + shadcn/ui   (main window)  │
│                          ▲                                 │
│                     Tauri IPC                              │
│                          ▼                                 │
│  Rust core: parser · SQLite · solver · loopback listener   │
│                          ▲                                 │
│              POST  127.0.0.1:<random>                      │
│              Authorization: Bearer <per-launch token>      │
│                          │                                 │
│  ┌─ popup WebviewWindow ─┴──────────────────────────────┐  │
│  │  archershub.dlsu.edu.ph  (student signs in manually) │  │
│  │  + initialization_script: MutationObserver capture   │  │
│  └──────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────┘
```

**Tauri IPC is never granted to the remote origin.** The injected script's only channel to Rust is a
loopback HTTP endpoint holding a per-launch bearer token. Rationale: Tauri has shipped an
origin-check bypass (GHSA-57fm-592m-34r7), external-URL CSP handling is unresolved
(tauri-apps/tauri#8476), and granting IPC would mean an XSS on DLSU's site could reach Rust commands
on every installed copy. The loopback endpoint exposes exactly one write.

---

## 4. Capture pipeline

1. Student picks campus + academic session in-app; app opens the popup to Archer's Hub.
2. Student signs in **manually** (ERP credentials). WebView2 profile is persisted, so the session
   survives restarts. A visible **Sign out / clear session** control wipes it.
3. Student navigates to Course Finder and searches courses normally.
4. `MutationObserver` on `#tblCourseSelection tbody` fires on each render. The script reads the
   selected `#ddlSelectCourse` option for identity, parses rows, POSTs JSON to the loopback endpoint.
5. Rust dedupes on `(campus, session, courseId, sectionId)`, writes a snapshot, and the main window
   shows a running counter ("42 sections from 8 courses") plus **Undo**.

Capture is **silent** — no per-search prompt. A student searches ~10 courses back to back; a modal
each time is 10 interruptions in the exact task being sped up.

**Allowlist parsing only.** Extract the fields in §5 and discard everything else. Never persist raw HTML.

### Refresh

Explicit user action. The app re-selects **every course already captured** under the plan's
(campus, session), sequentially, ~1.5 s apart, with the courses already in the plan going first.
This is the same request the page makes on a normal click, and it is read-only. Never on a timer,
never in the background.

This is deliberately wider than "the courses in the plan" (ADR-0019): the enrolment numbers a
student is comparing before choosing, and the ones `exclude-full` solves against, belong to
sections that are *not* in the plan yet. It is still never a catalog walk — only what the student
already searched for.

**Session expiry mid-refresh:** halt immediately, **keep the partial result**, show
"Session expired — sign in to continue" with a **Resume** button. Detect by asserting the table
exists *and* the selected course matches the requested course — not by checking the URL. A
stale-but-present table is the failure mode that would silently write course 5's counts onto course 6.

Silent re-auth is explicitly **not built** (§8).

---

## 5. Data model

SQLite via `tauri-plugin-sql`. Chosen over JSON files because fill-velocity and cross-term priors
are time-series queries.

```
courses(campus_id, session_id, course_id, code, title)
    PK (campus_id, session_id, course_id)

sections(campus_id, session_id, course_id, section_id, section_code,
         course_type, credits, enroll_cap, first_seen_at, last_seen_at)
    PK (campus_id, session_id, course_id, section_id)

schedule_blocks(section_fk, day, start_min, end_min, location, modality)
    modality ∈ {F2F, ONLINE}   -- derived: 'Online' literal vs 'Room - X'
    location  = room code, or NULL when online

snapshots(section_fk, captured_at, enrolled, professor, remark)
    -- professor and remark live HERE, not on sections: both are mutable,
    -- and their change over time is itself information

plans(id, name, campus_id, session_id, created_at)
plan_sections(plan_id, section_fk, pinned)
```

### Rules

- A plan is **hard-scoped** to one `(campus, session)`. Mixing terms produces a schedule that cannot
  exist, so it is rejected rather than warned about.
- **Sections are never hard-deleted.** If a section in a saved plan stops appearing, raise a
  persistent banner naming it and surface its alternatives. Silent removal during enlistment week is
  the worst available failure mode.
- **Blank `professor` means unknown, never "not-X".** A "prefer Prof X" filter that treats blank as a
  mismatch silently deletes 42 valid GEARTAP sections and returns an empty solve with no explanation.
- `remark` is stored and displayed verbatim. Never parsed, never branched on.
- **A plan may legally hold conflicting sections.** `plan_sections` carries no validity constraint;
  conflict is computed and displayed, never enforced at write time. See §7.

---

## 6. Solver

**Full enumeration is not viable.** GEARTAP alone has 42 sections; seven courses at that scale is
~42⁷ ≈ 2×10¹¹ combinations.

**Algorithm:** backtracking with constraint propagation, in Rust, off the UI thread.

- Order courses by fewest remaining valid sections first (MRV).
- Place one section at a time; prune the moment a time conflict appears. The fixed 7-slot lattice
  means most pairs conflict outright, so the live search tree is a small fraction of nominal space.
- Keep the best N in a bounded max-heap.
- **Node-count cap** with a "Keep searching" button, so a pathological input degrades to a partial
  answer rather than hanging.

### Constraints (v1)

`pin` (lock a section, re-solve around it) · day blacklist · earliest-start / latest-end ·
exclude-full · **minimize-campus-days** (exactly computable now that modality is per-day) ·
**no-lone-F2F-day** (don't commute for a single 90-minute class)

The solver is always **seeded from the current plan**: a **pinned** section is fixed; an
**unpinned** one is its course's starting point, which the solve keeps when it can and otherwise
swaps for another section of the same course — preferring existing choices wherever that costs
nothing, and never dropping a course the plan holds. There is no "solve from scratch" that
discards your work — starting empty is just the degenerate case of the same operation.

> **Amended in ticket 42:** this paragraph used to say "anything already chosen is treated as
> pinned", which made the pin flag decorative. CONTEXT.md's definition of **Pin** — fixed, with
> the solve filling only around it — is the controlling one.

### Warnings (advisory, not filters)

- **F2F → Online back-to-back** — 15 minutes, and nowhere to sit and connect.
- **F2F → F2F back-to-back in different buildings** — `J112 → V501` is not a 15-minute walk.

### Presentation

Three presets — **Fewest campus days** / **No early mornings** / **Most online**. Results render as
compact week-grid thumbnails with visible score breakdowns, sorted by score. Advanced weight sliders
are deferred; presets are what people use, sliders are what they ask for and never touch.

---

## 7. UI

**React + TypeScript + Vite + Tailwind + shadcn/ui.** shadcn components are copied into the repo
rather than pulled at runtime — nothing to break offline, no version churn. WebView2 ships with
Windows and the binary is dominated by the Rust side, so framework weight is not a real constraint.

### Plan surface

**The plan is the artifact.** One object, edited two ways — the picker and the solver both write to
the same `plan_sections`. There are not two schedule-building UIs.

On starting a plan the student chooses an entry point:

- **Pick my own sections** — the default. A course-by-course section browser listing every captured
  section with its schedule blocks, modality, room, professor, and `enrolled/cap`. Selecting one adds
  it to the plan and paints it onto the grid; hovering shows it as a ghost block first.
- **Let the solver build it** — runs §6 against the whole plan.

**This fork is an entry point, never a mode.** A student who picked manually can hit
**"Solve the rest"** at any time and get the remaining courses filled around their choices; a student
who solved can swap any section by hand afterward. Locking either choice in would recreate the two
divergent UIs this design exists to avoid — and pinning already is manual picking under another name.

### Week grid

**Hand-rolled** as a CSS grid: 6 day columns (Mon–Sat) × 7 lattice rows, blocks absolutely
positioned. Calendar libraries fight overlap highlighting, ghost previews of candidate sections, and
per-block modality badges — all of which this app needs. ~150 lines, fully owned.

**Visual encoding.** Roughly one channel reads at a glance, and four attributes compete for it:

| Attribute | Channel | Why |
|---|---|---|
| **Course identity** | **Hue** | Highest-cardinality thing being tracked; "where does GEARTAP sit" is the actual scanning task |
| Modality (F2F / Online) | Left-border style + icon | Binary per block, reads fine without hue |
| Fill (`enrolled/cap`) | Small numeric label | Precise value matters more than gist |
| Pinned vs tentative | Border weight / opacity | Binary state, needs to be visible but not loud |

Hue must not encode modality: a hybrid section would then render as two blocks that look like
unrelated courses, which inverts the thing the grid exists to show. Palette selection (categorical,
accessible, distinguishable at ~8 courses, correct in both themes) is deferred to implementation.

**Conflicts are displayed, never prevented.** Manually picking an overlapping section is allowed —
the common move is placing a must-have section first and then seeing what it costs. Overlapping
blocks render hatched with a persistent conflict count in the plan header. The solver only ever
emits conflict-free sets, so any conflict in a plan is user-authored and never a surprise.

### Onboarding

Skippable three-step first run: pick campus + term → sign in → search your first course.
A persistent `?` replays the tour.

> **Removed after release 0.2.0:** the first screen used to offer "Explore with sample data" as an
> equal-weight option, backed by the anonymized GEARTAP + CSINTSY captures, so a student evaluating
> the app did not have to sign in to see what it does. In use it did the opposite — a seeded plan
> sitting beside real ones, in a scope that was not a real campus or term, read as confusion rather
> than a demo. The README's walkthrough now carries that job. The fixtures remain in the repo as
> parser and solver test data.

### Export

`.ics` (drops the plan into Google Calendar the moment enlistment succeeds) and PNG of the week grid
(how the app actually spreads between students).

### Offline

Everything except **capture** and **refresh** works with no network, off the last snapshot.

---

## 8. Security & privacy

- **No credential storage, in any form.** Silent re-auth was considered and rejected: the
  `Password/OTP` field label implies a second factor that stored credentials couldn't satisfy anyway;
  a public MIT repo containing a credential-capture path is a ready-made template for a lookalike
  phishing fork; and persisted session cookies already solve the actual annoyance. Expiry costs one
  click, rarely, on a screen the student is already looking at.
- **No Tauri IPC for the remote origin.** Loopback + per-launch bearer token only.
- **No telemetry, no phone-home.** The app's trust story is "it only talks to Archer's Hub," and
  a failure-counter ping would spend that for less than it's worth.
- **Allowlist parsing.** `hdnStudId`, `userID`, `IP_ADDRESS`, `MAC_ADDRESS` are never read or stored.
- **Public source.** Students are being asked to type ERP credentials into a window this binary
  controls; "read the source" is the only honest answer to "why should I trust this."

---

## 9. Distribution

- **Public GitHub repo, MIT.** The realistic fork is another DLSU student adapting it — keep that
  frictionless. **Scrub both HTML dumps of student ID / IP / MAC before the repo goes public.**
- **GitHub Releases + `tauri-plugin-updater`**, unsigned. SmartScreen's "unrecognized app" wall is
  documented in the README. Microsoft Store is out of scope; keep the updater behind a Cargo feature
  flag so a Store build stays a config change rather than a refactor.
- **Remote selector config.** DOM selectors and parse rules live in a small JSON fetched from GitHub
  at startup, with the bundled copy as fallback. This scraper *will* break when DLSU touches the
  page, and it breaks for every installed copy at once — possibly mid-enlistment. This turns that
  into a 2-minute commit instead of a release cycle that can't complete inside the enlistment window.
- **"Report broken capture"** in-app: opens a pre-filled GitHub issue containing the parse error and
  a **scrubbed** DOM snippet, which the student reviews before submitting. Yields better artifacts
  than telemetry would, and keeps the student in control of what leaves their machine. In-app version
  and selector-config version are always visible so reports are diagnosable.

---

## 10. Scope

### v1

Tauri + React shell · popup with manual ERP login and persisted session · silent DOM auto-capture
with dedupe + undo · SQLite with snapshot history · **course-by-course section picker (default
entry point)** · **"Solve the rest" from any partial plan** · Mon–Sat week grid with hue-by-course
encoding, modality borders, and hatched conflict display · backtracking solver with pin / day
blacklist / time bounds / exclude-full / minimize-campus-days /
no-lone-F2F-day · transition warnings · three ranking presets · named plans scoped to
(campus, session) · manual refresh with partial-failure recovery · `.ics` + PNG export · skippable
onboarding · GitHub Releases + auto-updater + remote selector config ·
report-broken-capture.

### v1.1+

**Per-course fallback chains** (pull forward if enlistment is near — it's the difference between
useful *during* enlistment and only before it) · contingency re-solve · fill-velocity risk scoring
with manual high-demand flags · cross-term priors · advanced weight sliders · professor filters ·
plan diff view.

---

## 11. Known unknowns

| Unknown | Impact | Resolution |
|---|---|---|
| `Remark` contents | Cosmetic only — treated as opaque | Observe in the wild |
| Whether full sections stay listed | Confirmed: **they stay**, so enrolled/cap is reliable | Settled |
| Course Finder XHR shape | Would give cleaner data than DOM | Log opportunistically in debug builds; possible v2 upgrade |
| Section-prefix semantics | Potentially the highest-value filter in the app | Deferred by decision |
| Sections with ≠2 blocks, TBA rooms | Parser robustness | Parser must not assume block count; capture more courses |
