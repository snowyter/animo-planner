# Hue encodes course identity, never modality

Roughly one visual channel reads at a glance, and four attributes compete for it. Hue goes to **course identity**. Modality gets a left-border style plus an icon, enrolment gets a small numeric label, and pinned-versus-tentative gets border weight.

Course identity wins the hue channel because it is the highest-cardinality thing being tracked and "where does GEARTAP sit" is the actual scanning task. Colouring by modality is the tempting alternative and it inverts the thing the grid exists to show: a hybrid section would render as two differently-coloured blocks that read as unrelated courses.

## Consequences

- A hybrid section's blocks share one hue and differ only in border and icon.
- The palette must stay categorical, accessible, and distinguishable at eight or more courses in both light and dark themes.
