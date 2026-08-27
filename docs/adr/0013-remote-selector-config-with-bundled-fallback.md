# DOM selectors live in a remote config with a bundled fallback

The selectors and parse rules the capture path depends on are a small JSON file fetched from GitHub at startup, with the copy bundled in the binary as fallback. The parser and the injected script both take their rules from that config; neither hardcodes a selector.

This scraper will break when the university touches the page, and it will break for every installed copy simultaneously — possibly mid-enlistment, which is the only week the app matters. A remote config turns that from a release cycle that cannot complete inside the enlistment window into a two-minute commit.

## Consequences

- Startup must never block on the network, and a fetch that fails, times out, or returns something structurally invalid falls back silently to the bundled copy.
- The fetch must carry no identifying parameters, or it becomes telemetry (ADR-0004).
- Both the app version and the loaded selector-config version must be visible in-app, or bug reports cannot be diagnosed.
- **Renaming a config key is a two-sided compatibility problem, and both sides must be handled in the same change.** The published document is read by every installed copy, including ones built before the rename. A new build gets a `#[serde(alias = "...")]` for the old spelling so it still parses a config that has not been republished; the published document keeps *both* spellings so an older build still finds the one it knows. Unknown fields are ignored by design — there is no `deny_unknown_fields` — which is what makes carrying both safe. Get either side wrong and the failure is silent: the document fails to parse, the fetch falls back to the bundled copy, and the config stops being able to fix anything, which is the one outage this ADR exists to prevent. The `teacher` → `professor` rename is the worked example.
