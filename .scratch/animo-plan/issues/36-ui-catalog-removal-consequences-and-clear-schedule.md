# 36 — [ui] Say what removal will do, put plan sections first, and add Clear schedule

**What to build:** Three changes to the picker and the plan surface, all about the student seeing and controlling what is in their plan.

**Blocked by:** 35 (for the first item only; the other two can start immediately)

**Status:** ready-for-agent

## 1. Removing a course says what it will do to the plan

Ticket 35 makes `forget_course` remove the course's sections from any plan holding them instead of refusing. That is only safe if the confirmation says so **before** the student agrees.

- [ ] The remove-course confirmation names the course, how many sections go with it, and — when a plan holds any — **which plans lose sections and how many**. Not a generic "this cannot be undone"
- [ ] When no plan is affected, the dialog stays as short as it is today. The warning appears because it applies, not always
- [ ] After removal, a **visible, non-blocking notice** reports what happened to the plans, so the change is not silent even though it was agreed to
- [ ] The refusal notice from ticket 30 is **removed** along with the path that produced it

## 2. Sections already in the plan sort to the top

Scrolling a 42-section list to find the one already chosen is the common case, and it is currently the hardest one.

- [ ] Sections in the plan render **first in the list**, before the rest
- [ ] Within that group, **pinned sections come first**
- [ ] The remaining sections keep their existing order — this ticket adds a grouping, it does not re-sort the catalog
- [ ] The boundary between the two groups is **visible**, so the top of the list does not look like an arbitrary reordering of the same thing
- [ ] Adding or removing a section **moves it between the groups** without a reload

## 3. Clear schedule

- [ ] The plan surface gains a **Clear schedule** action that removes every section from the plan at once
- [ ] It **asks first**, naming how many sections will be removed
- [ ] It is **disabled when the plan is empty**, rather than present and inert
- [ ] It removes **plan membership only**. Nothing leaves the captured catalog, no section row is deleted, and the plan itself survives (ADR-0008)
- [ ] Pinned sections are cleared too — the student asked to clear everything — and the confirmation says so when any are pinned
- [ ] The week grid, conflict count, and section counter all update from the returned plan, not from local state

## Throughout

- [ ] Nothing here changes hue, modality, or conflict rendering (ADR-0009, ADR-0011, ADR-0012)
- [ ] Tests cover: the consequence-aware confirmation with and without affected plans, plan sections grouped ahead of the rest with pinned first, a section changing groups when added, Clear schedule confirming and emptying the plan, Clear schedule disabled on an empty plan, and the catalog being untouched by it
