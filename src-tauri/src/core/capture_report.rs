//! Assembling the broken-capture bug report (ticket 19).
//!
//! Pure composition only: inputs are the parse error, the *raw* fragment
//! retained Rust-side by the capture listener, and the versions the About
//! surface already reports. The fragment is scrubbed and trimmed here,
//! before the report is assembled — raw DOM never enters the wire types.
//! The result renders as a pre-filled GitHub issue URL the student opens
//! themselves; nothing in this module transmits anything (SPEC §8, §9).

use crate::core::ipc_types::{CaptureReport, SelectorConfigSource};
use crate::core::scrub::{
    diagnostic_fragment, find_scrub_violations, MAX_DIAGNOSTIC_FRAGMENT_CHARS, REDACTED_FIELD,
    TRUNCATED_MARK,
};

/// The pre-filled issue targets the same public repo the selector config
/// ships from (ADR-0013). The app only ever *opens* this URL — posting is
/// the student's own click (SPEC §9).
pub const ISSUE_URL: &str = "https://github.com/snowyter/animo-planner/issues/new";

/// Titles stay scannable in the issue list even when the parse error runs long.
pub const MAX_TITLE_CHARS: usize = 100;

/// The title when the parse error itself fails the privacy audit. The error
/// can quote site text (`ParseError::SelectedCourseUnreadable` embeds the
/// dropdown option verbatim), and the title is headed for a public issue
/// list, so a failing error is named, never quoted.
const WITHHELD_TITLE: &str = "Broken capture: (parse error withheld by the privacy audit)";

/// Everything [`build_capture_report`] needs. `fragment` is the raw HTML as
/// retained Rust-side at the failure site; it never leaves this module.
pub struct CaptureReportInput<'a> {
    pub error: &'a str,
    pub fragment: Option<&'a str>,
    pub app_version: &'a str,
    pub selector_config_version: &'a str,
    pub selector_config_source: SelectorConfigSource,
}

impl SelectorConfigSource {
    fn label(self) -> &'static str {
        match self {
            SelectorConfigSource::Remote => "remote",
            SelectorConfigSource::Bundled => "bundled",
        }
    }
}

/// Builds the full report: a reviewable body (returned in full so ticket 23
/// can show it) plus the pre-filled issue URL rendering that exact text.
///
/// Both inputs that can carry site text — the parse error and the DOM
/// fragment — are audited by [`find_scrub_violations`] before they enter,
/// as a real branch that runs in every build profile. A failed audit
/// withholds that input with an honest note; a report is never returned
/// carrying a hazard, because its body goes to the clipboard and on to a
/// public GitHub issue.
pub fn build_capture_report(input: CaptureReportInput) -> CaptureReport {
    let error = input.error.trim_end();
    let error_is_clean = find_scrub_violations(error).is_empty();
    let title = if error_is_clean {
        build_title(input.error)
    } else {
        WITHHELD_TITLE.to_string()
    };

    let mut body = String::with_capacity(1024);
    body.push_str("## Broken capture\n\n");
    body.push_str(
        "This report was assembled locally by Animo Plan after a failed capture. \
         Nothing was sent anywhere. Please review everything below before \
         opening the issue.\n\n",
    );
    body.push_str(&format!("- Animo Plan version: {}\n", input.app_version));
    body.push_str(&format!(
        "- selector config: v{} ({})\n",
        input.selector_config_version,
        input.selector_config_source.label(),
    ));

    if error_is_clean {
        body.push_str("\n### Parse error\n\n```text\n");
        body.push_str(error);
        body.push_str("\n```\n");
    } else {
        body.push_str(
            "\n### Parse error\n\nThe parse error was withheld: it failed the \
             privacy audit, so its text is not included.\n\n",
        );
    }

    if let Some(raw_fragment) = input.fragment {
        body.push_str(&fragment_section(&diagnostic_fragment(raw_fragment)));
    }

    let issue_url = format!(
        "{ISSUE_URL}?title={}&body={}",
        percent_encode(&title),
        percent_encode(&body),
    );
    CaptureReport { title, body, issue_url }
}

/// The DOM-fragment section of the report body. The audit here is a real
/// branch, not a `debug_assert!`: the report goes to the clipboard and on
/// to a public GitHub issue, so a fragment that still carries a hazard
/// after the pipeline is withheld — never embedded, and never quoted in
/// the note, which would carry the hazard itself.
fn fragment_section(fragment: &str) -> String {
    let mut section = String::from("\n### DOM fragment at the failure\n\n");
    if find_scrub_violations(fragment).is_empty() {
        if fragment.contains(REDACTED_FIELD) {
            section.push_str(
                "Student-identifying fields were found in the failing DOM and \
                 have been removed below.\n\n",
            );
        } else {
            section.push_str(
                "Student-identifying field names (`hdnStudId`, `userID`, \
                 `IP_ADDRESS`, `MAC_ADDRESS`) and anything shaped like an IP or \
                 MAC address have been removed.\n\n",
            );
        }
        section.push_str("```html\n");
        section.push_str(fragment.trim_end());
        section.push('\n');
        section.push_str("```\n");
        if fragment.ends_with(TRUNCATED_MARK) {
            section.push_str(&format!(
                "\n(The fragment was longer than the {MAX_DIAGNOSTIC_FRAGMENT_CHARS} characters above.)\n"
            ));
        }
    } else {
        section.push_str(
            "The DOM fragment was withheld: after scrubbing it still failed \
             the privacy audit, so nothing from the failing page is included.\n\n",
        );
    }
    section
}

fn build_title(error: &str) -> String {
    let first_line = error.lines().next().unwrap_or("parse failed").trim();
    let prefix = "Broken capture: ";
    let mut title: String = format!("{prefix}{first_line}");
    if title.chars().count() > MAX_TITLE_CHARS {
        let stem_budget = MAX_TITLE_CHARS.saturating_sub(prefix.len() + 1); // room for the marker
        let stem: String = first_line.chars().take(stem_budget).collect();
        title = format!("{prefix}{stem}…");
    }
    title
}

/// Percent-encodes everything outside RFC 3986's unreserved set, so the
/// pre-filled title/body survive as exactly the returned text.
fn percent_encode(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for byte in text.as_bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(*byte as char)
            }
            other => out.push_str(&format!("%{other:02X}")),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::ipc_types::SelectorConfigSource;
    use crate::core::scrub::{find_scrub_violations, REDACTED_FIELD};

    /// A raw, hazard-laden fragment as the failure site would retain it —
    /// the same shape the ticket-01 captures had before scrubbing.
    const RAW_FRAGMENT: &str = r#"<html><head><script>var userID = 2299999;</script></head>
<body>
<input type="hidden" name="hdnStudId" value="2299999">
<input type="hidden" name="MAC_ADDRESS" value="60:45:BD:1B:55:13">
<input type="hidden" name="IP_ADDRESS" value="149.30.146.213">
<table id="tblCourseSelection"><tbody>
<tr data-key="2923%7C384%7C"><td>S01</td></tr>
</tbody></table>
<script>var padding = '0000000000000000000000000000000000000000000000000000';</script>
</body></html>"#;

    fn input<'a>() -> CaptureReportInput<'a> {
        CaptureReportInput {
            error: "unparseable capture payload: results table not found in the given HTML",
            fragment: Some(RAW_FRAGMENT),
            app_version: "0.1.0",
            selector_config_version: "9",
            selector_config_source: SelectorConfigSource::Remote,
        }
    }

    #[test]
    fn the_report_names_the_error_and_both_versions_and_the_config_source() {
        let report = build_capture_report(input());
        assert!(report.body.contains(input().error), "the parse error: {}", report.body);
        assert!(report.body.contains("Animo Plan version: 0.1.0"));
        assert!(report.body.contains("selector config: v9"));
        assert!(report.body.contains("remote"));

        let bundled = CaptureReportInput {
            selector_config_source: SelectorConfigSource::Bundled,
            ..input()
        };
        let report = build_capture_report(bundled);
        assert!(report.body.contains("bundled"), "{}", report.body);
    }

    #[test]
    fn the_embedded_fragment_is_scrubbed_before_assembly() {
        let report = build_capture_report(input());
        for hazard in [
            "hdnStudId",
            "userID",
            "IP_ADDRESS",
            "MAC_ADDRESS",
            "2299999",
            "60:45:BD:1B:55:13",
            "149.30.146.213",
        ] {
            assert!(
                !report.body.contains(hazard),
                "{hazard} must not reach the report: {}",
                report.body
            );
        }
        assert!(
            !report.body.contains("<script"),
            "scripts are trimmed away: {}",
            report.body
        );
        assert!(
            find_scrub_violations(&report.body).is_empty(),
            "the assembled body audits clean"
        );
        // Identity tags carrying their values are removed whole; the visible
        // field-name marker is what remains of them.
        assert!(report.body.contains(REDACTED_FIELD));
        assert!(report.body.contains("tblCourseSelection"));
    }

    #[test]
    fn a_fragment_the_trim_can_splice_into_a_hazard_never_reaches_the_body() {
        // Half a field name and half a MAC on either side of a script
        // block: each half is harmless, but the block-stripping trim splices
        // them into hazards that did not exist in the raw text. This is a
        // fragment the shipped path must catch — and in the release build
        // there is no debug_assert! to do the catching.
        let splice_fragment = "<table id=\"tblCourseSelection\"><tr>\
             <td>hdn<script>noise</script>StudId \
             60:45:BD:1B:5<script>noise</script>5:13</td>\
             </tr></table>";
        let input = CaptureReportInput { fragment: Some(splice_fragment), ..input() };
        let report = build_capture_report(input);
        assert!(
            !report.body.contains("hdnStudId") && !report.body.contains("60:45:BD"),
            "the spliced hazards must not reach the report: {}",
            report.body
        );
        assert!(
            find_scrub_violations(&report.body).is_empty(),
            "the assembled body audits clean"
        );
        assert!(
            report.body.contains("tblCourseSelection"),
            "the diagnostic markup survives: {}",
            report.body
        );
    }

    #[test]
    fn a_parse_error_quoting_site_text_that_carries_a_hazard_is_withheld() {
        // SelectedCourseUnreadable embeds the dropdown option text
        // verbatim, so the error string itself can quote site text — this
        // hazard enters through the error, not the fragment. Neither the
        // title nor the parse error section may carry it into a report
        // headed for a public issue; the rest of the report is unaffected.
        let error = "selected course cannot be read from the dropdown: option text \
                     \"BROKEN hdnStudId 2299999\" does not match the CODE - TITLE grammar";
        let input = CaptureReportInput { error, ..input() };
        let report = build_capture_report(input);
        assert!(
            !report.body.contains("hdnStudId") && !report.title.contains("hdnStudId"),
            "the hazard must not reach the title or body: {} / {}",
            report.title,
            report.body
        );
        assert!(
            find_scrub_violations(&report.body).is_empty(),
            "the body audits clean: {}",
            report.body
        );
        assert!(
            report.title.contains("withheld"),
            "the title says the error was withheld: {}",
            report.title
        );
        assert!(
            report.body.contains("withheld"),
            "the body says the error was withheld: {}",
            report.body
        );
        assert!(
            report.body.contains("Animo Plan version: 0.1.0"),
            "the header survives: {}",
            report.body
        );
        // The fragment is audited independently: a clean fragment is still
        // embedded even when the error is withheld.
        assert!(
            report.body.contains("tblCourseSelection"),
            "a clean fragment is unaffected: {}",
            report.body
        );
    }

    #[test]
    fn the_scrubbed_report_text_is_returned_in_full_for_review() {
        let report = build_capture_report(input());
        // The body is what ticket 23 shows the student: it carries the whole
        // report, not a pointer or a summary.
        assert!(report.body.len() > 200, "a real report body");
        assert_eq!(
            query_pairs(&report.issue_url)
                .into_iter()
                .find(|(key, _)| key == "body")
                .map(|(_, value)| value),
            Some(report.body.clone()),
            "the issue body is exactly the returned report text"
        );
    }

    #[test]
    fn the_issue_url_is_a_prefilled_github_issue_in_this_repo() {
        let report = build_capture_report(input());

        let url = reqwest::Url::parse(&report.issue_url).expect("the issue url parses");
        assert_eq!(url.scheme(), "https");
        assert_eq!(url.host_str(), Some("github.com"));
        assert_eq!(
            url.path(),
            "/snowyter/animo-planner/issues/new",
            "same repo the selector config ships from"
        );
        assert!(!report.title.is_empty(), "the title is pre-filled too");

        let pairs = query_pairs(&report.issue_url);
        assert!(
            pairs.iter().any(|(key, value)| key == "title" && !value.is_empty()),
            "prefilled title: {pairs:?}"
        );
        let body = pairs.iter().find(|(key, _)| key == "body").expect("prefilled body");
        assert!(body.1.contains("tblCourseSelection"), "fragment included");
        assert!(!body.1.contains("hdnStudId"), "scrubbed before encoding");
    }

    #[test]
    fn a_scrubbed_fragment_that_still_fails_the_audit_is_withheld_not_embedded() {
        // Simulates a scrub regression: a fragment in the form
        // diagnostic_fragment hands over — nominally scrubbed — that still
        // carries a field name. The section builder withholds it rather
        // than embed it, and the note never quotes the violation itself.
        let section = fragment_section("<td>hdnStudId</td>");
        assert!(
            section.contains("withheld"),
            "the note is honest about the withholding: {section}"
        );
        assert!(
            !section.contains("hdnStudId"),
            "no hazard in the withheld section: {section}"
        );
        // A clean fragment is embedded as before.
        let clean = fragment_section("<td>S01</td>");
        assert!(clean.contains("```html") && clean.contains("S01"), "{clean}");
    }

    #[test]
    fn a_failure_without_a_retained_fragment_still_builds_an_honest_report() {
        let no_fragment = CaptureReportInput { fragment: None, ..input() };
        let report = build_capture_report(no_fragment);
        assert!(report.body.contains(input().error));
        assert!(!report.body.to_lowercase().contains("fragment"), "{}", report.body);
        assert!(reqwest::Url::parse(&report.issue_url).is_ok());
    }

    #[test]
    fn long_errors_are_kept_whole_but_titles_stay_scannable() {
        let long_error = format!(
            "unparseable capture payload: {}",
            vec!["detail"; 40].join(" ")
        );
        let input = CaptureReportInput { error: &long_error, ..input() };
        let report = build_capture_report(input);
        assert!(report.body.contains(&long_error), "the body keeps the full error");
        assert!(
            report.title.chars().count() <= MAX_TITLE_CHARS,
            "the title stays scannable: {:?}",
            report.title
        );
    }

    /// Decodes the `k=v` pairs of an URL-encoded query string.
    fn query_pairs(issue_url: &str) -> Vec<(String, String)> {
        let url = reqwest::Url::parse(issue_url).expect("issue url parses");
        url.query()
            .unwrap_or_default()
            .split('&')
            .map(|pair| pair.split_once('=').expect("k=v"))
            .map(|(key, value)| (key.to_string(), percent_decode(value)))
            .collect()
    }

    fn percent_decode(encoded: &str) -> String {
        let bytes = encoded.as_bytes();
        let mut out = Vec::with_capacity(bytes.len());
        let mut index = 0;
        while index < bytes.len() {
            match bytes[index] {
                b'%' if index + 3 <= bytes.len() => {
                    let hex = std::str::from_utf8(&bytes[index + 1..index + 3])
                        .ok()
                        .and_then(|text| u8::from_str_radix(text, 16).ok());
                    match hex {
                        Some(byte) => {
                            out.push(byte);
                            index += 3;
                        }
                        None => {
                            out.push(b'%');
                            index += 1;
                        }
                    }
                }
                byte => {
                    out.push(byte);
                    index += 1;
                }
            }
        }
        String::from_utf8(out).expect("decoded utf-8")
    }
}
