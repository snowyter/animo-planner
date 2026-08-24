# Captures reach the listener as a form submission, not fetch

Ticket 09 built the loopback endpoint expecting the injected script to `fetch` a JSON body with the per-launch token in an `Authorization: Bearer` header. Against the live Archer's Hub that never works, and it fails silently.

The page serves a Content-Security-Policy whose `connect-src` allowlist does not include loopback:

```
connect-src 'self' cdn.beacon.li spyder.beacon.li ... coreapi.mastersofterp.in ... app.tpstreams.com
```

The injected script runs in the page's own context, so it inherits that policy. The browser refuses the request **before it leaves the page**: nothing arrives at the listener, so no capture failure is ever announced and the student sees a page that renders normally and a counter that never moves. The fixtures could not reveal this — a saved HTML file carries no CSP header — so the whole pipeline tested green while capture was impossible.

Rewriting the header was the first choice and is not available: Tauri's `on_web_resource_request` is documented as "currently only implemented for the `tauri` URI protocol" and explicitly does not run for external URLs. Disabling web security through `additional_browser_args` would work and was rejected — that popup is where the student signs in to their university account, and switching off the same-origin policy there to save a scrape is the wrong trade for an app whose entire premise is that it holds nothing and touches nothing (ADR-0002, ADR-0003).

The same policy declares **no `form-action` directive**, and `form-action` is one of the few directives that does not inherit from `default-src`. Form submissions are therefore unrestricted where `fetch` is not. Verified against the live site before implementing.

## Consequences

- The injected script posts by building a hidden form, submitting it, and removing it. The payload travels as form fields.
- **The per-launch token travels as a form field**, because a form cannot set headers. It is the same secret over the same loopback-only socket, minted per launch and never persisted (ADR-0002 is unaffected).
- **The form path answers `204 No Content` to every outcome, success and failure alike.** A form submission is a navigation: any other status renders in the popup and throws the student off Course Finder, potentially mid-enlistment. A 204 aborts the navigation and leaves the page untouched. This is a structural requirement, not a convention — `every_form_failure_still_answers_204_so_the_page_is_never_navigated` asserts it across every failure mode.
- Nothing is swallowed by that. Failures are still announced on `capture:failed` and still retained for the broken-capture report (ticket 19); only the HTTP status is barred from carrying the news.
- The endpoint still exposes exactly one route. The JSON + bearer path remains for callers not subject to a page CSP, and its behaviour is unchanged.
- Refresh (ticket 26) rides the same route and is fixed by the same change.
- A `form-action` directive appearing in a future Archer's Hub CSP would break capture again. It would fail the same silent way, which is what the remote selector config and the report-broken-capture flow exist for (ADR-0013).
- Private Network Access is granted on the preflight for the JSON path: Chromium blocks a public origin from reaching loopback unless the preflight answers `Access-Control-Allow-Private-Network: true`. Form navigation is not preflighted, so this does not affect the form path.
