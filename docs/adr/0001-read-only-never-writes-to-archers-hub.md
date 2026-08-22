# Read-only: the app never writes to Archer's Hub

Animo Plan solves the planning problem, not the enlistment problem. It never auto-enlists, never clicks Add, and never submits a form on the student's behalf; enlistment stays a manual action the student takes themselves. Refresh re-runs the same read the page makes on a normal click, sequentially and rate-limited, and only ever because the student asked — never on a timer and never in the background.

The trade-off is real: auto-enlistment is the feature students would ask for first. It is refused because a tool that acts on a student's academic record without them is one bug away from doing something unrecoverable during the only window in which it matters, and because background traffic against the university's ERP is exactly what gets a student-built tool blocked for everyone.

## Consequences

- There is no write path to build later without reopening this decision.
- Refresh must be explicitly triggered, which means partial-failure recovery is a first-class UI concern rather than something a retry loop hides.
