# 09 — Write the spec and the implementation tickets

Type: task
Lane: HITL
Status: open
Blocked by: 05, 06, 07, 08 (and any tickets graduated from the map's fog before then)
Map: [map.md](../map.md)

## Question

Nothing left to decide — turn the resolved map into the destination:

- `.scratch/card-ui/spec.md`, gathering every decision on this map (linking, not restating, the resolved tickets where detail lives).
- One file per implementation ticket at `.scratch/card-ui/issues/NN-<ui|headless>-<slug>.md`, numbered in dependency order, following `docs/agents/issue-tracker.md` (`Status:`, `**Blocked by:**`, `[ui]`/`[headless]` in the heading), each sized to one agent session with acceptance criteria.
- Each ticket carries `Lane: Attended` or `Lane: Detached` per the map's Notes, and the split is reviewed with the human before it is final.
- Order so every merge leaves the app shippable and visually consistent — foundations (tokens, type, theme mechanism, motion presets, guard tests) first.

Resolved when the files exist and the human has signed off on the lane split.
