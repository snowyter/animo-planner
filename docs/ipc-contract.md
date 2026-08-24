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
| `seed_sample_plan` | — | `PlanSummary` |

### Captured catalog

| Command | Arguments | Returns |
|---|---|---|
| `list_captured_courses` | `{ campusId, sessionId }` | `CapturedCourse[]` |
| `list_captured_sections` | `{ campusId, sessionId, courseId }` | `Section[]` |

### Plan membership

| Command | Arguments | Returns |
|---|---|---|
| `add_section_to_plan` | `{ planId, courseId, sectionId }` | `Plan` |
| `remove_section_from_plan` | `{ planId, courseId, sectionId }` | `Plan` |
| `set_section_pinned` | `{ planId, courseId, sectionId, pinned }` | `Plan` |
| `get_plan_conflicts` | `{ planId }` | `Conflict[]` |
| `apply_solution` | `{ planId, sections }` | `Plan` |

### Capture window & undo

| Command | Arguments | Returns |
|---|---|---|
| `open_capture_window` | `{ campusId, sessionId }` | `null` |
| `get_capture_summary` | `{ campusId, sessionId }` | `CaptureSummary` |
| `undo_last_capture` | `{ campusId, sessionId }` | `CaptureSummary` |
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
  "sectionCount": 12, "isSample": false }
```

A plan carries **exactly one** `campusId` and `sessionId`; mixing terms is rejected at write time.

### `Plan`

`PlanSummary` fields plus `sections: PlanSection[]`.

```json
{ "id": "uuid", "name": "T1 load", "campusId": 7, "campusName": "Manila",
  "sessionId": 155, "sessionName": "AY2026-27 T1", "createdAt": "ISO",
  "sectionCount": 12, "isSample": false, "sections": [] }
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
  "latestEndMin": null, "excludeFull": false, "resultLimit": 12 }
```

`preset`: `"fewest_campus_days" | "no_early_mornings" | "most_online"`.
`dayBlacklist`: `Day[]`. `earliestStartMin` / `latestEndMin`: `number | null`.

### `SolveResult`

```json
{ "status": "complete", "solutions": [], "resumeToken": null, "unsatisfiableCourses": [] }
```

`status`: `"complete" | "partial" | "cancelled" | "unsatisfiable"`.
`resumeToken` is present iff `status === "partial"`; pass it to `continue_solve`.
`unsatisfiableCourses: { courseId, code }[]` names courses with no valid section.

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
{ "campusId": 7, "sessionId": 155, "sectionCount": 42, "courseCount": 8, "canUndo": true }
```

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

## Ownership notes

- Onboarding tour state ("don't run again", replay via `?`) is frontend-owned
  (localStorage); it is deliberately **not** a command.
- The loopback capture endpoint (ticket 09) is HTTP, **not** Tauri IPC; it is out of scope
  for this file.
- Solver cancellation: `cancel_solve` makes the in-flight `solve_plan`/`continue_solve`
  resolve with `status: "cancelled"` rather than hanging or rejecting.
