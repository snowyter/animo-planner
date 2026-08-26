# IPC Contract — Animo Plan

> **Amendment protocol (hard requirement).** This file is the single source of truth for the
> Tauri IPC seam. Any ticket that changes a signature must update the Rust command in
> `src-tauri/src/interface/commands.rs` **and** the TypeScript client in `src/adapters/ipc/`
> **in the same commit**, and must name the change in its PR description. UI tickets never call a
> command that is not declared here. If a screen needs something this contract lacks, the ticket
> stops and amends this file first. `npm run verify` type-checks the TypeScript client, so a
> drifted signature is a build failure rather than a runtime surprise.

## Wire conventions

- Command names are `snake_case`; arguments and return values are JSON objects keyed in
  `camelCase` (Tauri v2 convention).
- `null` is never used as a placeholder for "empty list" — empty collections are `[]`.
- All timestamps are ISO 8601 strings. Dates (`start_date`, `end_date`) are `YYYY-MM-DD`.
- IDs: `campus_id`, `session_id`, `course_id`, `section_id` are numbers; `plan_id`,
  `resume_token`, and `Solution.id` are strings.
- Times are minutes since midnight (`start_min`, `end_min`).
- **A blank `teacher` is `null`, meaning *unknown*.** `null` is never interpreted as "not this
  professor"; no filter may treat it as a mismatch (ADR-0007-adjacent rule, CONTEXT.md).
- **`remark` is opaque.** Stored and returned verbatim; never parsed or branched on.

## Events (Rust → main window)

| Event | Payload |
|---|---|
| `capture:updated` | `CaptureSummary` |
| `capture:failed` | `{ "error": string }` |
| `refresh:progress` | `{ "courseIndex": number, "courseTotal": number, "courseCode": string }` |

## Argument envelope

Every command that takes a payload declares it on the Rust side as a single
`args: XArgs` parameter, and **Tauri routes arguments by that parameter name**.
The client therefore sends the payload wrapped:

```ts
invoke("create_plan", { args: { name, campusId, sessionId } });
```

Passing the fields flat is rejected at runtime with
`command create_plan missing required key args`. Fields *inside* the envelope
are camelCase, matching `#[serde(rename_all = "camelCase")]` on each Args
struct. Commands taking no payload pass nothing at all.

Guarded by `wraps every command payload in the args envelope` in
`src/adapters/ipc/contract.test.ts`.

## Commands

### Options & app info

| Command | Arguments | Returns |
|---|---|---|
| `get_campus_options` | — | `CampusOption[]` |
| `get_session_options` | — | `SessionOption[]` |
| `get_app_info` | — | `AppInfo` |

### Plans

| Command | Arguments | Returns |
|---|---|---|
| `list_plans` | — | `PlanSummary[]` |
| `create_plan` | `{ name, campusId, sessionId }` | `PlanSummary` |
| `delete_plan` | `{ planId }` | `null` |
| `get_plan` | `{ planId }` | `Plan` |

### Captured catalog

| Command | Arguments | Returns |
|---|---|---|
| `list_captured_courses` | `{ campusId, sessionId }` | `CapturedCourse[]` |
| `list_captured_sections` | `{ campusId, sessionId, courseId }` | `Section[]` |
| `forget_captured_course` | `{ campusId, sessionId, courseId }` | `ForgetCourseOutcome` |
| `set_course_included` | `{ campusId, sessionId, courseId, included }` | `CapturedCourse[]` |

**Amended in ticket 35:** `forget_captured_course` removes one captured course — its
sections, blocks, and snapshots under exactly the given `(campusId, sessionId)` — and releases
any plan holding one of those sections, pinned or not, in the same transaction. It answers with
a `ForgetCourseOutcome`: the updated `CaptureSummary` plus the affected-plan report (which plan
lost how many sections), so the UI says what happened rather than leaving the student to
discover it. It no longer refuses with a "held by plans" error.

**Amended after ticket 46:** `set_course_included` marks whether the student intends to enrol
in a captured course. Searching a course and intending to take it are different acts, and the
solver previously treated every capture as a course it had to schedule — so browsing forty
courses produced a solve that insisted on filling all forty.

Excluding is **not** forgetting: nothing is deleted, no plan is released, and the capture counter
does not move. An excluded course stays in `list_captured_courses` (carrying `included: false`)
so the Capture tab can still show it and check it again; it is simply not offered by the section
picker and not a course `solve_plan` has to satisfy. A section already in a plan stays in that
plan — excluding its course only stops the solver treating it as a slot to fill.

The command answers with the whole updated catalog rather than an acknowledgement, so the tab
that toggles and the tab that browses read one loaded list (ticket 32).

`CapturedCourse` gained two fields with this command: `included`, and `lastRefreshedAt` — the
instant a refresh last re-read the course, or `null`. Both a capture and a refresh advance
`lastSeenAt`, so it alone cannot say which act produced the numbers on screen. Courses captured
before this migration read as `included: true`, which is the behaviour that already existed.

### Plan membership

| Command | Arguments | Returns |
|---|---|---|
| `add_section_to_plan` | `{ planId, courseId, sectionId }` | `Plan` |
| `remove_section_from_plan` | `{ planId, courseId, sectionId }` | `Plan` |
| `set_section_pinned` | `{ planId, courseId, sectionId, pinned }` | `Plan` |
| `get_plan_conflicts` | `{ planId }` | `Conflict[]` |
| `apply_solution` | `{ planId, sections }` | `Plan` |

### Capture window

| Command | Arguments | Returns |
|---|---|---|
| `open_capture_window` | `{ campusId, sessionId }` | `null` |
| `get_capture_summary` | `{ campusId, sessionId }` | `CaptureSummary` |
| `clear_browser_session` | — | `null` |

### Solver (async — never blocks the UI thread)

| Command | Arguments | Returns |
|---|---|---|
| `solve_plan` | `{ planId, options }` | `SolveResult` |
| `continue_solve` | `{ planId, resumeToken }` | `SolveResult` |
| `cancel_solve` | — | `null` |

### Refresh (async — never blocks the UI thread)

| Command | Arguments | Returns |
|---|---|---|
| `start_refresh` | `{ planId }` | `RefreshOutcome` |
| `resume_refresh` | `{ planId }` | `RefreshOutcome` |
| `get_missing_sections` | `{ planId }` | `MissingSection[]` |

### Export & diagnostics

| Command | Arguments | Returns |
|---|---|---|
| `export_plan_ics` | `{ planId }` | `IcsExport` |
| `build_capture_report` | `{ error }` | `CaptureReport` |

**Amended in ticket 19:** the arguments no longer carry a `fragment`. The failing DOM is
retained Rust-side at the capture-failure site and scrubbed there before any report is
assembled, so raw DOM never crosses into the webview; the command matches `error` against
the failures this launch announced and rejects if none match.

### Updates

| Command | Arguments | Returns |
|---|---|---|
| `check_for_update` | — | `UpdateCheck` |
| `install_update` | — | `InstallUpdateOutcome` |

**Amended in ticket 38:** two commands reach the updater plugin that ticket 03 configured,
Rust-side behind the existing seam rather than through a JS plugin — no new frontend
dependency and no `updater:*` capability granted to the webview. `check_for_update` reads
the static `latest.json` from GitHub Releases with no identifying parameters or headers
(the app's third static read; ADR-0017, extending ADR-0004). A failed or unreachable check
is an ordinary answer — `status: "failed"` plus a distinguishable `failureReason` — never a
rejected promise: offline, a 404, a malformed document, and an unverifiable signature all
resolve this way, and the app stays fully usable offline. When the updater is compiled out
(`--no-default-features`) both commands exist with the same signature and answer
`status: "unavailable"`. Nothing installs unless `install_update` is called; it downloads,
verifies against the pubkey in `tauri.conf.json`, installs, and restarts into the new
version. A signature that does not verify is a failed install, never a prompt.

## Types

### `CampusOption`

```json
{ "id": 7, "name": "Manila" }
```

### `SessionOption`

```json
{ "id": 155, "name": "AY2026-27 T1" }
```

### `AppInfo`

```json
{ "appVersion": "0.1.0", "selectorConfigVersion": "1", "selectorConfigSource": "bundled" }
```

`selectorConfigSource` is `"remote"` or `"bundled"`.

### `PlanSummary`

```json
{ "id": "uuid", "name": "T1 load", "campusId": 7, "campusName": "Manila",
  "sessionId": 155, "sessionName": "AY2026-27 T1", "createdAt": "ISO",
  "sectionCount": 12 }
```

A plan carries **exactly one** `campusId` and `sessionId`; mixing terms is rejected at write time.

### `Plan`

`PlanSummary` fields plus `sections: PlanSection[]`.

```json
{ "id": "uuid", "name": "T1 load", "campusId": 7, "campusName": "Manila",
  "sessionId": 155, "sessionName": "AY2026-27 T1", "createdAt": "ISO",
  "sectionCount": 12, "sections": [] }
```

### `PlanSection`

```json
{ "courseId": 2923, "courseCode": "GEARTAP", "courseTitle": "Art Appreciation",
  "sectionId": 384, "sectionCode": "Y31", "pinned": false, "missing": false,
  "modality": "HYBRID", "blocks": [], "latestSnapshot": {} }
```

`modality` is section-level (`F2F` / `ONLINE` / `HYBRID`), **derived** from the mix of
`blocks` — never parsed as a field (ADR-0007).

### `CapturedCourse`

```json
{ "courseId": 2923, "code": "GEARTAP", "title": "Art Appreciation",
  "sectionCount": 42, "firstSeenAt": "ISO", "lastSeenAt": "ISO" }
```

### `Section`

```json
{ "campusId": 7, "sessionId": 155, "courseId": 2923, "courseCode": "GEARTAP",
  "courseTitle": "Art Appreciation", "sectionId": 384, "sectionCode": "Y31",
  "courseType": "Lecture", "credits": 3, "enrollCap": 45,
  "startDate": "2026-07-10", "endDate": "2026-12-09",
  "firstSeenAt": "ISO", "lastSeenAt": "ISO",
  "modality": "HYBRID", "blocks": [], "latestSnapshot": {} }
```

`courseType` and `credits` are `string | null` / `number | null` when absent.
`enrolled` lives on `latestSnapshot`, never on the section (§5).

### `ScheduleBlock`

Modality belongs to a **block**, never to a section, and the location/modality pair is
enforced by the type itself:

```ts
type ScheduleBlock =
  | { day: Day; startMin: number; endMin: number; modality: "F2F"; location: string }
  | { day: Day; startMin: number; endMin: number; modality: "ONLINE"; location: null };
```

### `Snapshot`

```json
{ "capturedAt": "ISO", "enrolled": 39, "teacher": null, "remark": null }
```

`teacher: string | null` — `null` is *unknown*, never "not-X".

### `Day`

`"MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT"` — the week is **Mon–Sat**, not Mon–Fri.

### `Conflict`

```json
{ "a": { "courseId": 2923, "sectionId": 384 },
  "b": { "courseId": 2931, "sectionId": 401 },
  "day": "TUE", "startMin": 510, "endMin": 585 }
```

`startMin`/`endMin` are the overlapping range. `SectionRef = { courseId, sectionId }`.

### `SolveOptions`

```json
{ "preset": "fewest_campus_days", "dayBlacklist": [], "earliestStartMin": null,
  "latestEndMin": null, "excludeFull": true, "resultLimit": 12 }
```

`preset`: `"fewest_campus_days" | "no_early_mornings" | "most_online"`.
`dayBlacklist`: `Day[]`. `earliestStartMin` / `latestEndMin`: `number | null`.

**Amended in ticket 34:** `excludeFull` defaults to `true` when omitted — a section at capacity
cannot be enlisted into, so a fresh solve never builds around one. The student can still turn it
off in secondary constraints.

### `SolveResult`

```json
{ "status": "complete", "solutions": [], "resumeToken": null,
  "unsatisfiableCourses": [], "excludedFullCount": 0, "snapshotTakenAt": "ISO" }
```

`status`: `"complete" | "partial" | "cancelled" | "unsatisfiable"`.
`resumeToken` is present iff `status === "partial"`; pass it to `continue_solve`.

**Amended in ticket 34:** `unsatisfiableCourses` entries carry a `reason` —
`"all_sections_full"` when exclude-full removed every remaining section of that course,
`"no_valid_section"` otherwise — so `"unsatisfiable"` never appears without saying why.
`excludedFullCount` reports how many candidate sections exclude-full removed across the solve,
and `snapshotTakenAt` is the latest snapshot timestamp of the plan's scope (`null` when nothing
is captured there): how old the enrolment numbers behind any exclusion are. The UI surfaces both
next to the results so a stale-looking exclusion can be turned off and re-solved.

### `Solution`

```json
{ "id": "uuid", "score": 42.5,
  "breakdown": [{ "label": "campus days", "points": 30 }],
  "warnings": [], "sections": [] }
```

`sections: SolutionSection[]` — every section in the solved plan, including pinned ones.

### `SolutionSection`

```json
{ "courseId": 2923, "courseCode": "GEARTAP", "sectionId": 384, "sectionCode": "Y31",
  "pinned": false, "blocks": [] }
```

### `TransitionWarning`

```json
{ "kind": "f2f_online_back_to_back", "day": "TUE", "startMin": 555, "endMin": 570,
  "from": { "courseId": 2923, "sectionId": 384 },
  "to": { "courseId": 2931, "sectionId": 401 } }
```

`kind`: `"f2f_online_back_to_back" | "f2f_f2f_different_buildings"`.

### `CaptureSummary`

```json
{ "campusId": 7, "sessionId": 155, "sectionCount": 42, "courseCount": 8 }
```

### `AffectedPlan`

```json
{ "planId": "plan-0a1b2c", "removedSections": 2 }
```

### `ForgetCourseOutcome`

```json
{ "summary": { "campusId": 7, "sessionId": 155, "sectionCount": 40, "courseCount": 7 },
  "affectedPlans": [{ "planId": "plan-0a1b2c", "removedSections": 2 }] }
```

`affectedPlans` names every plan the removed course released sections from and how many each
lost; it is empty when no plan held any. Plans emptied this way still exist — deleting a plan
is its own explicit act.

### `RefreshOutcome`

```json
{ "status": "complete", "refreshedCourses": 8, "totalCourses": 8,
  "haltedAfterCourseCode": null }
```

`status`: `"complete" | "session_expired" | "offline"`. On `"session_expired"` the partial
result is kept and `haltedAfterCourseCode` names where the run stopped; `resume_refresh`
continues from there. On `"offline"` nothing changed.

### `MissingSection`

```json
{ "courseId": 2923, "sectionId": 384, "sectionCode": "Y31",
  "alternatives": [] }
```

`alternatives: Section[]` — other sections of the same course.

### `IcsExport`

```json
{ "fileName": "T1 load.ics", "contents": "BEGIN:VCALENDAR..." }
```

### `CaptureReport`

```json
{ "title": "Broken capture", "body": "scrubbed report text", "issueUrl": "https://..." }
```

`body` is returned in full so the student can review exactly what would be submitted, and is
fully scrubbed (`hdnStudId`, `userID`, `IP_ADDRESS`, `MAC_ADDRESS` removed, along with
anything shaped like a MAC or IPv4 address); the app never posts it — the student reviews
and opens `issueUrl` themselves.

### `UpdateCheck`

```json
{ "status": "available", "currentVersion": "0.1.0", "availableVersion": "0.2.0",
  "notes": "release notes", "failureReason": null, "failureDetail": null }
```

`status`: `"available" | "up_to_date" | "failed" | "unavailable"`. `availableVersion` and
`notes` are non-null only when `status` is `"available"`; `notes` carries the release notes
when the endpoint has them. On `"failed"`, `failureReason` and `failureDetail` name why —
see `UpdateFailureReason`. On `"unavailable"` the updater was compiled out of this build.

### `UpdateFailureReason`

`"network" | "endpoint" | "malformed" | "signature" | "unknown"`.

`"network"` covers offline/DNS/TLS/timeouts; `"endpoint"` a 404 on `latest.json` or a
document missing this platform; `"malformed"` an unreadable or unparseable document;
`"signature"` an artifact whose signature did not verify against the configured pubkey.
The UI may show any of these quietly — none is a crash.

### `InstallUpdateOutcome`

```json
{ "status": "installed", "failureReason": null, "failureDetail": null }
```

`status`: `"installed" | "nothing_to_install" | "failed" | "unavailable"`. A real install
restarts the app into the new version, so `"installed"` is rarely observed by the caller.
`"nothing_to_install"` means the check found nothing newer. On `"failed"`,
`failureReason`/`failureDetail` say why — a signature that does not verify lands here as
`"signature"`, never as an install.

## Ownership notes

- Onboarding tour state ("don't run again", replay via `?`) is frontend-owned
  (localStorage); it is deliberately **not** a command.
- The loopback capture endpoint (ticket 09) is HTTP, **not** Tauri IPC; it is out of scope
  for this file.
- Solver cancellation: `cancel_solve` makes the in-flight `solve_plan`/`continue_solve`
  resolve with `status: "cancelled"` rather than hanging or rejecting.
