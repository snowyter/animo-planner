# Modality is derived per schedule block, never a scraped field

Archer's Hub does not publish a modality column. Each schedule block's location slot is either `Room - <CODE>` or the literal `Online`, and modality is computed from that, per block. A section's overall modality (F2F / Online / Hybrid) is in turn derived from the mix of its blocks — it is not stored as a section attribute.

This is written down because the obvious "fix" is to add a `modality` column to `sections` and populate it at capture time. That flattens hybrids, which are common: of 84 GEARTAP blocks across 42 sections, 38 were in rooms and 46 online. A per-section modality would make `minimize-campus-days` and `no-lone-F2F-day` uncomputable, since both need to know *which day* the student is physically on campus.

## Consequences

- Conflict detection, campus-day counting, and the transition warnings all operate on blocks, not sections.
- The grid renders a hybrid section as two blocks with different modality borders but the same hue (see ADR-0012).
