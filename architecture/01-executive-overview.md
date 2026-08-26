# Level 1 — Executive Overview

> **Who this is for:** anyone. No programming knowledge needed.
> For deeper detail, continue to Levels 2–5 in this folder.

## What Animo Plan is

Animo Plan is a **desktop planner app for Windows** that helps DLSU students put together
their class schedule before enlistment. It is a helper that sits *beside* the university's
student portal ("Archer's Hub") — it watches while you browse, remembers what you looked at,
and does the schedule math for you.

It is **not** a bot and **not** an auto-enroller. You do all the clicking on the university's
website yourself; the app just plans.

## The problem it solves

Archer's Hub shows classes for **one course at a time**, with no way to compare choices
across courses or spot time clashes. Students end up juggling spreadsheets or paper.
Animo Plan turns "browse the site normally" into "a finished, clash-free schedule."

## How it works, in one picture

```
        YOU (the student)
         │  you sign in yourself and search courses
         │  exactly like you normally would
         ▼
┌──────────────────────────┐       ┌───────────────────────────────┐
│   Archer's Hub window    │       │     Animo Plan window         │
│  (the university's real  │       │     (your planner)            │
│   website, opened by     │       │                               │
│   the app, you control   │       │  • remembers every section    │
│   it)                    │       │    you looked at              │
└────────────┬─────────────┘       │  • paints them on a weekly    │
             │                     │    timetable (always on       │
             │  quietly copies     │    screen)                    │
             │  what you searched  │  • you tick the courses you   │
             │  (READ-ONLY)        │    actually intend to take —  │
             └────────────────────▶│    browsing the rest is free  │
                                   │  • computes clash-free        │
                                   │    combinations               │
                                   │  • ranks your best options    │
                                   │  • exports to Google Calendar │
                                   │    or a shareable image       │
                                   └───────────────┬───────────────┘
                                                   │  everything stays on
                                                   │  YOUR computer
                                                   ▼
                                   You go back to Archer's Hub and
                                   enlist in your chosen sections —
                                   yourself, by hand.
```

## The promises this app is built around

These are not features that can be toggled off — they are hard rules baked into the design:

| Promise | What it means for you |
|---|---|
| **Never writes to Archer's Hub** | It cannot enlist, drop, click "Add," or change anything. Every request it makes is one your own click would have made. |
| **Never stores your password** | You type your credentials only into the university's own login page. The app has no code path that reads or saves them. |
| **No spying** | No telemetry, no analytics, no phone-home. Nothing leaves your machine except reads from Archer's Hub and one settings-file check. |
| **Private IDs ignored** | Student IDs, IP and MAC addresses visible on the portal are never read, stored, or included in bug reports. |
| **Local first** | Everything works offline from your last snapshot, except the moment you are actively browsing or refreshing. |

## The workflow a student experiences

1. **Create a plan** — name it, pick campus + school term.
2. **Browse** — the app opens Archer's Hub in its own window; you sign in and search
   courses like always. Sections you view are remembered automatically. Nothing is
   ever deleted behind your back; you remove a course from your saved list yourself.
3. **Mark your intent** — searching a course and planning to take it are different things.
   You tick the courses you intend to enrol in; the rest stay saved and browsable but are
   kept out of the schedule math until you change your mind.
4. **Pick or solve** — the week grid is always on screen. Choose sections yourself, or let
   the planner fill the rest around your must-haves, then preview each ranked result
   directly on the grid.
5. **Refresh numbers** — before deciding, update seat counts for everything you saved
   (only when you ask).
6. **Export** — send the winning schedule to Google Calendar (.ics) or save it as an image.
7. **Enlist yourself** on Archer's Hub.

## Document map

| File | Audience | Contents |
|---|---|---|
| `01-executive-overview.md` | Everyone | This file |
| `02-system-overview.md` | Semi-technical | The moving parts and how data flows between them |
| `03-application-architecture.md` | Developers | Layers, communication channels, key flows |
| `04-domain-and-data.md` | Developers | The information model, database schema, business rules |
| `05-technical-deep-dive.md` | Engineers | Code-level internals, algorithms, security mechanics |
