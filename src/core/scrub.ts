/**
 * The user-facing half of the privacy audit for broken-capture reports.
 *
 * `scrub.rs` is the authority: the Rust scanner redacts the failing DOM
 * fragment before a report body is assembled. This copy never redacts
 * anything — it re-runs the audit over report text the user is about to
 * copy or open (`ReportBrokenCaptureDialog`), so the dialog can warn before
 * a hazard leaves the machine.
 *
 * The shared contract with the Rust scanner lives in
 * `src-tauri/tests/fixtures/scrub-agreement.json`, exercised by
 * `scrub.test.ts` and the Rust `scrub.rs` tests alike: same inputs, same
 * violation counts, on every case with disjoint hazards. Two deliberate
 * divergences, neither of which changes whether text is judged hazardous:
 * this scanner reports every regex match, while the Rust scanner merges
 * hazards that share one enclosing region into a single span (its spans
 * drive replacement, so they must be disjoint) — counts differ only there.
 * And a bounded twelve-hex run is flagged by both implementations (see the
 * `twelve-digit-run` fixture): over-detection is the safe bias for a
 * privacy audit, on either side.
 */

const FIELD_NAME_PATTERN = /hdnStudId|userID|IP_ADDRESS|MAC_ADDRESS/gi;

const IPV4_PATTERN =
  /\b(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\b/g;

const MAC_COLON_PATTERN = /\b[0-9a-f]{2}(?::[0-9a-f]{2}){5}\b/gi;

const MAC_HYPHEN_PATTERN = /\b[0-9a-f]{2}(?:-[0-9a-f]{2}){5}\b/gi;

const MAC_BARE_PATTERN = /\b[0-9a-f]{12}\b/gi;

export function findScrubViolations(html: string): string[] {
  const violations: string[] = [];

  for (const match of html.matchAll(FIELD_NAME_PATTERN)) {
    violations.push(`student-identifying field name "${match[0]}"`);
  }

  for (const match of html.matchAll(IPV4_PATTERN)) {
    violations.push(`IPv4-shaped value "${match[0]}"`);
  }

  for (const pattern of [MAC_COLON_PATTERN, MAC_HYPHEN_PATTERN, MAC_BARE_PATTERN]) {
    for (const match of html.matchAll(pattern)) {
      violations.push(`MAC-shaped value "${match[0]}"`);
    }
  }

  return violations;
}
