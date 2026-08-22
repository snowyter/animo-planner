# No telemetry, no phone-home

The app sends nothing anywhere except to Archer's Hub and a static fetch of the selector config. No crash reporting, no usage counters, no failure pings — not even anonymous ones.

The app's entire trust story is "it only talks to Archer's Hub", and a failure counter would spend that for less than it is worth. The thing telemetry would buy — knowing when capture breaks — is bought instead by the report-broken-capture flow, which yields a scrubbed DOM snippet and a parse error that the student reviews and submits themselves. That is a strictly better artifact than a counter, and it keeps the student in control of what leaves their machine.

## Consequences

- Breakage is discovered when a student reports it, so in-app version and selector-config version must always be visible or reports are undiagnosable.
- The selector-config fetch must be a plain read with no identifying query parameters, or it becomes telemetry by accident.
