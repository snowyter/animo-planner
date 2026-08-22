# Sections are never hard-deleted

No code path removes a section row. A section that stops appearing in later captures keeps its row and its snapshot history, and is flagged as missing with its alternatives surfaced in a persistent banner.

The tempting behaviour is to reconcile on refresh — drop what the university no longer returns, so the plan reflects reality. During enlistment week that is the worst available failure mode: a student's must-have section quietly vanishing from their plan minutes before they enlist, with no record that it was ever there and no prompt to find a replacement. Being loudly wrong is recoverable; being silently empty is not.

## Consequences

- The plan surface must be able to render a section that no longer exists in the catalog.
- Storage grows monotonically, which is acceptable at the scale of one student's captured courses.
