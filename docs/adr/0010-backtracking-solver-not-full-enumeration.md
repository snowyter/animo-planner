# Backtracking with constraint propagation, not full enumeration

The solver is a backtracking search with constraint propagation, running in Rust off the interface thread: courses ordered by fewest remaining valid sections first, partial assignments pruned the moment a conflict appears, best N results kept in a bounded heap.

Full enumeration is not viable. GEARTAP alone has 42 sections, and seven courses at that scale is roughly 2×10¹¹ combinations. The fixed seven-slot time lattice means most section pairs conflict outright, so the live search tree is a small fraction of nominal space — but only if pruning happens during construction rather than after.

## Consequences

- A node-count cap is required, returning a partial answer with a "keep searching" affordance, so a pathological input degrades instead of hanging.
- Ranking is a scoring pass over surviving assignments, which is why presets are cheap and per-result score breakdowns are free.
