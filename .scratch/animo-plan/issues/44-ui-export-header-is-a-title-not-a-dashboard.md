# 44 — [ui] The exported image needs a title, not a dashboard

**What to build:** Cut the PNG export's header down to the academic year and term as a title, with the week grid below it. Today it reproduces most of the app's plan header, and the session badge wraps out of its own box.

**Blocked by:** None — can start immediately

## What is wrong

Ticket 40 fixed the export being blank; this is what it revealed. The exported header currently carries: an "ANIMO PLAN" tag, "DLSU Enlistment Schedule", the plan name, a campus badge, a session badge, a section count, and a conflict status — seven pieces of chrome above the thing the student actually wants to share.

The session badge also **wraps inside its own pill**: "AY2026-27" on one line and "T1" on the next, breaking out of the rounded box. It reads as broken rather than dense.

## Decided before dispatch

**The term is the title.** Above the grid: the academic year and term, and nothing else. Everything else is chrome the student did not ask to share — they are sending someone a schedule, not a report.

**One exception, and it is deliberate.** If the plan has conflicts, the image must still say so. An exported schedule that quietly hides an overlap is misleading in the one direction that costs the student something, and conflicts are displayed, never hidden (ADR-0009). When there are no conflicts, nothing appears — silence is the clean state, not a green tick.

The plan name, campus, section count, and the "No conflicts" badge all go. If the plan name turns out to be wanted later, it is one line to restore; the wrapping badge is not coming back either way.

## Acceptance criteria

- [ ] **The exported image is: the academic year and term as a title, then the week grid.** Nothing else above the grid
- [ ] **The title never wraps or breaks out of its own box** at 1200px. Verify with a long session name, not only the current one
- [ ] **A plan with conflicts still says so** in the image, briefly, near the title. A plan without conflicts shows nothing about them
- [ ] The grid keeps everything it renders today — Mon–Sat, course hues, modality borders, conflict hatching (ADR-0012, ADR-0011)
- [ ] The export still renders at **1200px wide with explicit light-theme colours**, and the container keeps the ticket-40 shape: off-screen positioning on the wrapper, the captured node statically positioned. **Do not reintroduce positioning onto the captured node** — the guard test for that must keep passing
- [ ] An **empty plan** still exports a readable empty grid with its title
- [ ] The `.ics` export is untouched
- [ ] Tests cover: the title rendering the session name, the conflict line present with conflicts and absent without, and the ticket-40 positioning guard still holding

## Worth knowing

The in-app plan header is a different surface and is not in scope — it can afford chrome the exported image cannot. Change only the export container in `ExportMenu`.
