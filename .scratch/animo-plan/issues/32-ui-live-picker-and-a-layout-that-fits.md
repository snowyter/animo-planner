# 32 — [ui] The picker keeps up with captures, and fits the window it ships in

**What to build:** Two defects found running the app, both in the section picker. The course dropdown goes stale, and the side-by-side layout from ticket 28 never engages at the app's own default window size — and breaks when it does.

**Blocked by:** None — can start immediately

**Status:** ready-for-agent

## Defect 1 — the course list goes stale

`useSectionPicker` loads captured courses once:

```ts
const fetchCourses = useCallback(async () => { … }, [options.campusId, options.sessionId]);
useEffect(() => { fetchCourses(); }, [fetchCourses]);
```

The scope never changes while a plan is open, so this runs on mount and never again. Nothing re-runs it when a capture lands from the popup, so **a course captured in Course Finder does not appear in the dropdown until the picker is remounted** — the counter updates, the dropdown does not.

`forgetCourse` patches `courses` locally instead (`setCourses(remainingCourses)`), so the two paths disagree about where the list comes from. The fix is one reload path both use, not a second patch.

The `capture:updated` event already carries the scope and already reaches `PlanWorkspace`, which passes an `onCaptureUpdated` callback *into* the picker for the opposite direction — the picker telling the workspace its summary changed. The inbound direction is what is missing.

## Defect 2 — the layout does not fit its own window

Ticket 28 put the picker and week grid side by side at the `xl:` breakpoint (1280px). **`tauri.conf.json` opens the window at 1200×800.** Every fresh install is therefore below the breakpoint, stacked, with the week grid scrolled out of view while hovering — precisely the problem ticket 28 was written to fix.

Stretching the window past 1280px does engage it, and the result is broken: `WeekGrid` carries `min-w-[760px]` and the picker column is `xl:w-[480px]`, so the row needs ~1264px of content before padding. The picker's own header — `flex flex-col sm:flex-row sm:items-start sm:justify-between` with the course `<select>` beside the title — was laid out for a full-width card and collapses at column width. The description wraps one word per line and the dropdown overlaps the heading.

## Decided before dispatch — the shape to build

From the report, and adopted as the design:

- **Side by side always**, not above a breakpoint. The default window must show it.
- **The week grid gets the larger share** — it is the artifact being built; the picker is the tool.
- **The section list scrolls inside its own bounded height** rather than growing the page. A 42-section course must not push anything off screen.
- **The number of sections is visible** so the student knows what is below the fold.

## Acceptance criteria

- [ ] **A capture landing from the popup makes the new course appear in the dropdown without a remount**, driven by the existing `capture:updated` event. Its sections are then browsable immediately
- [ ] Removing a course updates the same list through **the same reload path**, so the catalog has one source of truth rather than a fetch on mount and a local patch on removal
- [ ] A capture for a different `(campus, session)` than the open plan does not disturb the picker
- [ ] **The picker and the week grid are side by side at the window size the app actually opens at** (1200×800 per `tauri.conf.json`). Verify against that width, not against a wide desktop
- [ ] The week grid is given the larger share of the row and stays legible; `WeekGrid`'s `min-w-[760px]` and its own `overflow-x-auto` must be accounted for rather than fought
- [ ] **The section list scrolls within a bounded height**, so a course with many sections never pushes the week grid off screen and never grows the page
- [ ] The count of sections for the selected course is visible without scrolling
- [ ] **The picker's internal layout works at column width.** Its header, course dropdown, course summary row, and "Remove course from catalog" control must not overlap, and no text may wrap one word per line
- [ ] **The page never scrolls horizontally** at any window width from the default upward; wide content scrolls inside its own container
- [ ] Below the width where two columns genuinely stop fitting, the layout falls back to a single column with **the grid above the list**, as ticket 28 required
- [ ] The ghost preview still lands on a visible grid while hovering — the reason the layout exists (ADR-0011, ADR-0012 unchanged)
- [ ] Tests cover: a capture event adding a course to the dropdown, removal going through the same reload, scope isolation, the bounded scrolling list, and the two-column layout holding at the default window width
