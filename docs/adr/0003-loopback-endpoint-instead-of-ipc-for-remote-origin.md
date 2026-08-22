# Loopback endpoint, not Tauri IPC, for the remote origin

The injected capture script runs inside a webview on `archershub.dlsu.edu.ph`. It is **never** granted Tauri IPC. Its only channel to the Rust core is an HTTP endpoint bound to `127.0.0.1` on a random port, carrying a bearer token minted fresh each launch, exposing exactly one write route and no reads.

Granting IPC to a remote origin would mean an XSS on the university's site could reach Rust commands on every installed copy at once. That is not hypothetical: Tauri has shipped an origin-check bypass (GHSA-57fm-592m-34r7), and CSP handling for external URLs is still unresolved upstream (tauri-apps/tauri#8476). The loopback endpoint reduces the blast radius of a compromised page to "can post section rows", which the page could do anyway by being the page.

## Considered options

- **Tauri IPC with an origin allowlist** — rejected; the allowlist is the thing that has already been bypassed once.
- **Loopback with no token** — rejected; any local process could then write to the database.
