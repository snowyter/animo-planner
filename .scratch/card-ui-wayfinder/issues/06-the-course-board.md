# 06 — What is the course board, and how does it live beside the week grid?

Type: prototype
Lane: HITL
Status: open
Blocked by: 04
Map: [map.md](../map.md)

## Question

The map adds a **course board** — included courses as columns, their sections as cards — as a further way to view courses. The week grid is permanent and visible, and the ghost preview must land on a visible grid while a section is hovered (tickets 28, 32, 46). Decide:

- **Where it lives.** A tool-panel tab replacing or beside Pick; a wider mode that narrows the grid; a full-width view with the grid collapsed to a strip; something else. Which keeps the hover-to-ghost interaction.
- **What a column is.** One per **included course**? Order? What the column header carries (code, title, section count, picked section, conflict).
- **What a card does.** Click/Enter to choose (replacing the course's section in the plan), hover to ghost, pin — and whether **dragging** means anything, since a student takes exactly one section per course. If drag earns its place, dnd-kit's approval (ticket 49 only) is a new question for the human.
- **Scale.** A course with 42 sections in one column, 8 courses across; horizontal scroll vs fit; keeping repeated cards cheap (`docs/design-system.md` § Performance).
- **Picker overlap.** Whether the board supersedes the Pick tab's list or both survive.

Prototype it in the ticket-04 direction; the human reacts. Record the shape and the reasons.
