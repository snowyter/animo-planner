# Public source, MIT licensed

The repository is public and MIT licensed from the start.

Students are being asked to type university credentials into a window this binary controls. "Read the source" is the only honest answer to "why should I trust this", and it only works if the source is actually there. MIT rather than a copyleft licence because the realistic fork is another student at another university adapting the scraper, and friction there costs more than it protects.

## Consequences

- Both captured HTML dumps must be scrubbed of student ID, IP, and MAC before the repo goes public — this is a release blocker, not a cleanup task.
- A public credential-capture path would be a phishing template, which is part of why ADR-0002 forbids one.
