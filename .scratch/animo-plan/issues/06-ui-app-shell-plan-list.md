# 06 — [ui] App shell, plan list, and campus/session picker

**What to build:** The app opens to a window where a student can see their saved plans, create a new one, name it, and scope it to a single campus and academic session. Choosing a campus and term is the first thing that happens, because everything downstream is scoped by it.

This is the first UI ticket and it builds entirely against the stubs from ticket 02 — the commands it calls will throw until the matching headless tickets land. That is expected; the screens, routing, and state wiring are the deliverable.

See `SPEC.md` §2 (the campus and session option sets), §5 (plan scoping rule), §7 (UI stack).

**Blocked by:** 02

**Status:** ready-for-agent

- [ ] The Tauri window opens to a plan list, with an empty state that leads into creating the first plan
- [ ] Creating a plan asks for a name, a campus, and an academic session, and all three are required
- [ ] Campus and session options come from the app rather than being typed by the student, and cover the values in `SPEC.md` §2
- [ ] **A plan is hard-scoped to one `(campus, session)`.** There is no UI affordance to change or mix them after creation — mixing terms produces a schedule that cannot exist, so it is rejected rather than warned about
- [ ] The plan's campus and session are visible on every screen that operates on it, so the student always knows which term they are editing
- [ ] All backend access goes through the typed client from ticket 02. No command is invented here; if a screen needs something the contract lacks, the ticket stops and names it
- [ ] A command that throws "unimplemented" surfaces as a visible, identifiable error state rather than an infinite spinner or a blank panel
- [ ] shadcn components are copied into the repo rather than pulled at runtime
