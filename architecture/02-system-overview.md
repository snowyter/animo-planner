# Level 2 — System Overview

> **Who this is for:** semi-technical readers (PMs, QAs, new contributors).
> Plain language first; some technical names introduced. Deeper detail in Levels 3–5.

## The three moving parts

Animo Plan is one desktop program (built with **Tauri**) containing three cooperating parts:

```
┌────────────────────────────────────────────────────────────────────┐
│                        ANIMO PLAN (one app)                        │
│                                                                    │
│  ┌───────────────┐         ┌──────────────────────────────────┐   │
│  │ MAIN WINDOW    │        │ CAPTURE POPUP                    │   │
│  │ "The Planner"  │        │ "The Browser"                    │   │
│  │                │        │                                  │   │
│  │ React UI:      │        │ The real Archer's Hub website,   │
│  │ a week grid    │        │ opened inside the app so you can │
│  │ that is always │        │ sign in and search normally.     │
│  │ on screen,     │        │ A small watcher script is        │
│  │ plus three     │        │ attached to remember searches.   │
│  │ tools beside   │        │                                  │
│  │ it: Capture,   │        │                                  │
│  │ Solve, Pick    │        │                                  │
│  └───────┬───────┘         └──────────────┬───────────────────┘   │
│          │ requests & answers             │ ONE narrow channel    │
│          ▼                                ▼                       │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │ RUST ENGINE ("the brain")                                 │    │
│  │  • parses what the popup saw                              │    │
│  │  • stores it                                              │    │
│  │  • computes conflicts and clash-free schedules            │    │
│  │  • exports calendar files                                 │    │
│  └──────────────────────────┬───────────────────────────────┘    │
│                             ▼                                     │
│              ┌──────────────────────────────┐                     │
│              │ LOCAL DATABASE               │                     │
│              │ animo-plan.db — a private    │                     │
│              │ file in your user folder     │                     │
│              └──────────────────────────────┘                     │
└────────────────────────────────────────────────────────────────────┘
```

- **Main window** — everything you see and click as a planner.
- **Capture popup** — Archer's Hub itself. You log in there manually; the app never sees
  your password. It attaches a tiny watcher that copies course results as they render.
- **Rust engine + local database** — the memory and the calculator. Nothing here talks to
  the internet except the three deliberate exceptions below.

## The only three doors to the outside world

```
   Animo Plan                          Internet
      │
      ├──(1) READ Archer's Hub ───────▶ archershub.dlsu.edu.ph
      │       Only when YOU search or press Refresh.
      │       Same reads your browser would do. Never writes.
      │
      ├──(2) FETCH settings file ─────▶ GitHub (static JSON)
      │       "Which page elements should we watch?" — so a website
      │       redesign can be fixed without reinstalling the app.
      │       Falls back to a built-in copy when offline.
      │
      └──(3) CHECK for updates ───────▶ GitHub Releases (static file)
              One anonymous look at a version number. Only an update
              you explicitly approve is ever downloaded/installed.
```

That's all. No analytics, no crash reporting, no other servers.

## How data travels through the system

The life story of a section (a class offering), from website to exported calendar:

```
 Archer's Hub          Capture popup           Rust engine              Local DB
──────────────        ──────────────          ──────────────          ─────────────
 You search a   ──▶   Watcher script sees  ──▶ Parses the table    ──▶ Saved once per
 course. The          the results table        into clean typed       unique section,
 table renders.       render, copies just      records: days,         plus a dated
                      the useful fields,       times, rooms, seats,   snapshot of its
                      discards everything      teacher…               seat count /
                      else (including any-                            teacher history
                      thing identifying
                      you)

                                           You mark which captured courses you intend
                                           to enrol in (include/exclude). Excluded
                                           courses stay saved and browsable — they
                                           just drop out of the schedule math.

                                           Plans reference saved sections ◀── you pick

                                           Solver combines the options   ──▶ ranked, clash-
                                           of the courses you marked         free schedule
                                           as intended                      choices

                                           Exporter turns the     ──▶ .ics / PNG file
                                           winning plan               you keep
```

Key idea: **raw web pages are parsed and thrown away immediately.** Only an allowlist of
fields ever touches storage.

## Trust walls (who may talk to whom)

This app carries university login traffic inside it, so its plumbing is deliberately
asymmetric:

```
   Main window  ══════ full command channel ═════▶  Rust engine
   (trusted, app-owned UI)          (can ask anything)

   Capture popup ── one narrow pipe ──────────────▶  Rust engine
   (shows untrusted university      (exactly ONE action accepted:
    website content)                 "here are search results,"
                                     guarded by a secret key
                                     minted fresh every launch)

   Capture popup ──────────── ✗ NO channel ✗ ──────▶ main window commands
   Even if the university site were compromised, it could not
   reach the planner's controls.
```

Why so strict? If the university's site were ever hacked or served malicious code inside
that popup, the damage is contained: that content has no way to give orders to the rest of
the app. It can only post search results to the one guarded endpoint — nothing else accepts
its traffic.

## What runs where at a glance

| Concern | Lives in | Notes |
|---|---|---|
| Screens, buttons, week grid | Main window (web tech: React) | Presentation only |
| Schedule math (conflicts, solving) | Rust engine | Runs off the UI thread; window never freezes |
| Memory of sections/seats/history | Local SQLite database | Survives restarts; yours alone |
| Login & browsing | Capture popup | Your credentials never touch app code |
| Watching for search results | Tiny script inside popup | Reports to the engine via the guarded pipe |
| Update delivery | GitHub Releases | Explicit install only |
