# 05 — What folds away in the calm workspace, and what does the next-step card say?

Type: prototype
Lane: HITL
Status: resolved
Blocked by: 04
Map: [map.md](../map.md)

## Question

The workspace stays, but a student should never face every feature at once. In the chosen direction (ticket 04):

- **The inventory.** List every control the plan workspace shows today (tool panel tabs, capture counter, Refresh, Open Archer's Hub, captured catalog actions, solve constraints — presets, priority, exclude-full, day blacklist, avoided professors, professor ranking — Export, Clear schedule, pin, banners). For each: always visible, shown when relevant, or folded behind a disclosure — and the trigger for "relevant".
- **The next-step card.** For each plan state — no captures; captures but no included courses; courses but nothing picked; partial plan; conflicts; complete plan; session expired mid-refresh; a section missing from the catalog — what the card says, its one action, and when it steps aside. How it coexists with the banners that must render above the tab strip (`docs/design-system.md` § Tabs).
- **Top-level destinations.** Confirm the ≤3 rule against the actual app (Plans · Plan · …?), and where About/Report/Tour go.
- **The sidebar and the narrow window.** Ticket 04 put plans and courses in a collapsible sidebar and the tools in a right-hand panel. Decide whether the sidebar starts open or closed when a plan opens (the tool panel starts folded today, `docs/design-system.md` § Tabs), whether the choice is remembered, and what folds at the 1024px minimum width — sidebar, tools panel, or both.

Prototype it clickably enough to walk the states; the human reacts. Record the inventory table and the card's copy per state.

## Answer

**Banners fold into the next-step strip, which becomes a queue. The tools panel starts open and is remembered. Below 1280px the sidebar floats.** The prototype is on branch `prototype/calm-workspace`, file `docs/prototypes/calm-workspace.html` (commit `d4b31bc`, local only). It walks 18 plan states at 1400×900 and at 1024×640, in light and dark. The left rail shows the live queue and a shown / hidden / folded / moved table for every control. The logic is one pure block (`stepQueue`, `visibility`, `layout`) written to lift into `src/core`. The human accepted every call below and the copy as written.

### The next-step strip

- **One slot, a queue.** The strip shows the most urgent item. "Then:" names the second item, and "+N more" counts the rest. When the head is resolved, the next item takes the slot. Every old banner renders here: session expired, refresh failed, offline, capture unreadable, missing section, now full, avoided professor, and plan failed to load. The strip sits above the week card, outside the tools panel, so it stays visible on every tab and with the panel folded. This keeps the intent of `docs/design-system.md` § Tabs ("state that must never be hidden renders above the tab strip"). The wording of that rule changes.
- **Tones.** **warn** (amber): something outside changed or broke. **quiet** (plain card): work is in progress and there is nothing to do. **go** (Archer Green): your move, including a conflict you created. **done** (green, check). Red stays reserved for conflict glyphs and Clear.
- **One action, at most.** A dismiss ✕ appears only on items the student can safely ignore: capture unreadable, refresh failed, offline, complete.
- **Shrinks when its target is on screen.** When the tab or course the strip points at is already open, the strip drops to one line: its title, then "In Pick →". It shows no body and no button.
- **Priority order.** Plan failed to load → session expired → capture unreadable → refresh failed → offline → refreshing → missing section → now full → avoided professor → conflict → capturing → one guidance step (start / include / fill / partial) → complete.

| State | Tone | Title | Body | Action | Steps aside when |
|---|---|---|---|---|---|
| Nothing captured | go | Search your courses in Archer's Hub | Sign in there, then search each course you might take in Course Finder. Every section you look at is kept here. | Open Archer's Hub | the popup opens |
| Popup open, no search yet | quiet | Waiting for your first search | Sign in, open Course Finder, and search a course. Its sections land here as the results appear. | — | the first capture lands |
| Captures landing | quiet | Capturing from Archer's Hub | {n} courses · {m} sections so far. Search every course you might take, then come back here. | Review courses → Capture | the popup closes |
| Captured, none included | go | Choose the courses you'll take | You've captured {n} courses and none is included. Switch on the ones you mean to enrol in; the rest stay captured. | Choose courses → Capture | a course is included |
| Included, nothing picked | go | Fill your week | {k} courses to schedule. Solve finds conflict-free weeks for you, or pick sections one course at a time. | Solve → Solve | a section is in the plan |
| Partial | go | {k} courses still need a section / {code} still needs a section | {list}. Solve fills them around what you've chosen and never moves a pinned section. | Solve the rest → Solve | every included course has a section |
| Conflict | go | {move} overlaps {keep} on {Day} | {move} {sec} and {keep} {sec} both meet {time}. {alt} has room and fits your week. / No other {move} section fits yet. | Preview {alt} / Show {move} sections | the conflict is gone |
| Complete | done | Your week is complete | {k} courses, no conflicts, {d} campus days. Refresh before enlistment to catch sections that fill. | Export (+ ✕) | dismissed; a "Complete" chip stays in the week header until something changes |
| Refreshing | quiet | Refreshing enrolment numbers | {course} · {i} of {n} courses. Your plan doesn't change while the numbers update. | — | the refresh ends |
| Session expired mid-refresh | warn | Archer's Hub signed you out | Refresh stopped after {i} of {n} courses. Sign in again, then resume where it stopped. | Sign in again, then Resume refresh | the refresh resumes |
| Section missing from the catalog | warn | {code} {sec} is no longer listed | It stopped appearing in Course Finder on the last refresh. It stays in your plan until you replace it. {alt} has room and fits your week. | Preview {alt} / Show {code} sections | the section is replaced or removed |
| Section now full | warn | {code} {sec} just filled up | {cap} of {cap} at the {time} refresh. It stays in your plan. {alt} has room and fits your week. | Preview {alt} / Show {code} sections | the section is replaced or removed |
| Avoided professor appeared | warn | {code} {sec} now lists a professor you avoid | {professor} appeared on the last refresh. The section stays in your plan until you change it. | Preview {alt} / Show {code} sections | the section is replaced or removed |
| Capture unreadable | warn | A search couldn't be read | Course Finder sent a page Animo Plan didn't recognise, so nothing from it was kept. Search again. If it keeps happening, send a report. | Send a report (+ ✕) | dismissed |
| Refresh failed | warn | Refresh stopped | Archer's Hub didn't answer. The numbers from before are kept. | Try again (+ ✕) | dismissed or retried |
| Offline | quiet | You're offline | Refresh needs Archer's Hub. Everything you've captured is still here. | — (✕) | dismissed or back online |
| Plan failed to load | warn | This plan didn't load | Your plans and captures are still on this computer. Try loading it again. | Try again | the plan loads |

- **Which course a conflict moves.** The strip moves the side that isn't pinned. If neither side is pinned, it moves the side that has somewhere to go. `{alt}` is the first section of that course that has room and fits the current week (`bestAlternative`).
- **Resume copy** comes from the existing `formatExpiryMessage`. The implementation keeps its facts and uses this wording.

### The inventory

| Control | Visibility | Trigger |
|---|---|---|
| Plan name, campus, term | Always | Toolbar |
| Freshness ("refreshed 4 min ago") | When relevant | Once anything is captured |
| Refresh | When relevant | Once anything is captured; reads "Refreshing…" while it runs |
| Export | When relevant | Once the plan holds a section |
| Archer's Hub | Always | Toolbar; it is the way in |
| Tools panel toggle | Always | Trailing edge of the toolbar, before the caption buttons |
| Read-only • No credentials stored | Always | Sidebar foot, or the toolbar when the sidebar is closed |
| Plans | Always | Sidebar; its heading opens the plan list |
| Courses in this plan | When relevant | Once a course is included. Each row shows the section code or "Needs a section", a pin glyph, a conflict glyph, and "· Unlisted" or "· Full" |
| New plan · About | Always | Sidebar foot |
| Tour · Report a broken capture | Moved | Inside About. Report also rides the capture-unreadable strip. The header's Tour and About buttons go |
| Update available | When relevant | A small row in the sidebar foot, only when an update exists; no longer a global notice |
| Next-step strip | When relevant | Whenever the queue is non-empty |
| Week chips: "N of M courses", conflict, campus days, "Complete" | When relevant | Course count once a course is included; conflict only while one exists; campus days once the plan holds a section; "Complete" once every included course fits |
| Clear | When relevant | Once the plan holds a section (hidden, not disabled) |
| Pin, remove, other sections | Folded | The block's menu (right-click, Menu key), as today |
| Capture counter | Always | Capture tab |
| Captured course rows, with an include switch | When relevant | Once anything is captured. Clicking the row opens it in Pick, which replaces Browse |
| Professors | Folded | On row hover or focus, or as a "3 ranked" chip once ranked |
| Forget course | Folded | Row hover, under More |
| Open Archer's Hub, Refresh in the Capture tab | Moved | To the toolbar |
| Presets | Always | Solve tab |
| Priority (Schedule / Professors / Hybrid) | When relevant | Only once a professor ranking exists; the ADR-0021 no-op warning still applies inside that |
| Constraints: days off, start after, end by, exclude full | Folded | One disclosure with an "N on" chip |
| "Your plan sections" pinning list | Moved | One line: "{pinned} is pinned and won't move. {n} other sections may move." Pinning lives on the grid and the sidebar |
| Avoided professors | When relevant | One line in Solve, only when any exist |
| Solve | Always | Disabled with the reason ("Include a course in Capture first") until a course is included |
| Keep searching | When relevant | Only after a solve that was cut short |
| Course selector, section cards | When relevant | Pick tab, once a course is included; card anatomy per ticket 04 |

### Destinations

Three:

1. **Plans**, the plan list.
2. **A plan**, the workspace. The professor ranking drill-down is a place inside it, not a destination.
3. **About**, a sheet or dialog per the "Dialogs as sheets" fog. It holds the version and update, Tour, and Report, and is the natural home for Appearance, which ticket 07 decides.

The sidebar keeps Plans one click away from anywhere.

### The sidebar and the narrow window

- **At 1280px and wider,** the sidebar and the tools panel both dock. Each has its own toggle and is remembered across launches. Both default to open.
- **Below 1280px,** only the tools panel docks, at 320px wide at 1024. The sidebar collapses. Its toggle, at the start of the toolbar, opens it as an overlay over the week, which closes on pick, Esc, or a click outside. The tools panel is the one kept docked because the ghost preview must land on a visible grid (tickets 28, 32, 46). The trust line moves into the toolbar while the sidebar is closed.
- **At 1024×640,** the week gets about 640px wide. A 90-minute block is about 50px tall there, so it fits two lines, and the time line drops below about 54px of block height. The implementing ticket must check this in the real grid.

### The capture flow this assumes, and what changes if it does

**Today:**
1. The student opens Archer's Hub from the app and signs in.
2. They search one course at a time in Course Finder.
3. Each search's results are captured silently into the catalog.

Every course in the catalog got there because the student searched it. It arrives included (the `included` column defaults to 1), so a search counts as a hint of intent.

**The human's intended future flow:** once the student signs in, the app reads every course and section for the plan's campus and term on its own. The student no longer has to search each one. This is ruled out of scope for this map (see the map's **Out of scope**). It changes what the capture path requests, so it needs its own map, and that map must settle it against ADR-0001 ("every request it makes is one the student's own click would have made") and ADR-0003 first.

This design is built so that change stays contained. Only these parts assume capture-by-search:

| Part | Today (search-driven) | If capture becomes automatic at sign-in |
|---|---|---|
| Strip: Nothing captured | "Search your courses in Archer's Hub … search each course you might take" | Becomes "Sign in to Archer's Hub"; the body says the whole term is read once you're in |
| Strip: Popup open, no search yet | "Waiting for your first search" | Becomes a sign-in wait; then a progress item ("Reading the term's courses · 120 of 480") in the quiet tone, like Refreshing |
| Strip: Captures landing | Counts courses as searches land; "Search every course you might take" | Replaced by the progress item above |
| Strip: Captured, none included | Rare: only if the student switches everything off | Becomes the **normal first step**. Nothing the app reads on its own says what the student intends, so courses must arrive **excluded**, and "Choose the courses you'll take" is where every plan starts |
| `included` default | 1 (a search is intent) | 0 for courses read automatically; a migration question for courses already captured |
| Capture tab list | A handful of courses the student searched; an include switch per row | Hundreds of courses; needs search and filtering ahead of the switches, and likely the list shows included courses first |
| Capture counter copy | "Captured from your Course Finder searches." | "Read from Archer's Hub at {time}." |
| Strip: Capture unreadable | "A search couldn't be read … Search again." | "Part of the term couldn't be read"; the action becomes retrying the read, not searching again |
| Refresh | Re-runs the captured catalog (ADR-0019), a few courses | Would re-run every course in the term; its cost and whether it narrows to included courses must be decided |
| Tab name "Capture" | The act the student performs | May become "Courses", since the student no longer captures anything by hand |

**Unaffected:** the queue model, its tones and priority order, the plan-problem items (missing, full, avoided professor, conflict, plan load), the guidance steps from "Fill your week" on, the rest of the control inventory, the destinations, and the sidebar and narrow-window rules.

In the prototype's `stepQueue`, the capture-dependent copy is exactly the `capturing`/`waiting`/`start`/`include` branch and the `capfail` item. The implementation should keep them together in one place, so the flow can change without touching the rest of the queue.

### Surfaced for later tickets

- **→ 07:** dark tokens for the amber warn strip and the quiet strip. Appearance's home, given About is the third destination.
- **→ 08:** motion for the strip's queue advancing, its shrink to one line, and the narrow-window sidebar overlay.
- **→ 09:** `stepQueue`, `visibility`, and `layout` become tested `src/core` modules. `docs/design-system.md` § Tabs changes in two places: the panel no longer starts folded, and the banners move into the strip. The capture-dependent strip items stay in one place, per "The capture flow this assumes" above.
