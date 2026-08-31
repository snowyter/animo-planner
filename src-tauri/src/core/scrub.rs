//! Scrubbing of failing-capture DOM fragments (ticket 19).
//!
//! Course Finder DOM carries `hdnStudId`, `userID`, `IP_ADDRESS`, and
//! `MAC_ADDRESS` (SPEC §2 "Privacy hazard"). Before any fragment is embedded
//! in a bug report, those field names and anything shaped like an IPv4 or a
//! MAC address are replaced with visible redaction markers, and the result
//! is trimmed to what is diagnostically useful. The patterns mirror the
//! ticket-01 fixture guard in `src/core/scrub.ts`.
//!
//! Scrubbing always runs before trimming: truncation could otherwise cut a
//! hazard in half, leaving a partial token that no shape rule recognizes.
//! It also runs again *after* trimming, because stripping a block whole
//! splices its surroundings together and can join two harmless halves into
//! a hazard that never existed in the raw text.

/// Visible marker replacing a student-identifying *field name*.
pub const REDACTED_FIELD: &str = "[redacted-field]";

/// Visible marker replacing an identifying *value* (IPv4 / MAC shaped).
pub const REDACTED_VALUE: &str = "[redacted-value]";

/// Appended when the diagnostic fragment was capped.
pub const TRUNCATED_MARK: &str = "…[truncated]";

/// Upper bound on the fragment embedded in a report. Large enough to carry
/// a results-table skeleton, small enough for an issue body.
pub const MAX_DIAGNOSTIC_FRAGMENT_CHARS: usize = 2000;

const FIELD_NAMES: [&str; 4] = ["hdnStudId", "userID", "IP_ADDRESS", "MAC_ADDRESS"];

/// A hazard span found in the raw text, and what replaces it.
struct Hazard {
    start: usize,
    end: usize,
    replacement: &'static str,
}

fn is_word_char(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'_'
}

fn is_hex(byte: u8) -> bool {
    byte.is_ascii_hexdigit()
}

fn byte_at(bytes: &[u8], index: usize) -> u8 {
    bytes.get(index).copied().unwrap_or(b'\0')
}

/// Finds every case-insensitive occurrence of one of [`FIELD_NAMES`] and
/// expands it to its *enclosing tag* (`<` … `>`). These fields carry their
/// payload in sibling attributes or adjacent text of the same element
/// (`<input ... value="2299999">`), so removing only the name would leak
/// the student id anyway.
fn field_name_hazards(lower: &str, out: &mut Vec<Hazard>) {
    let bytes = lower.as_bytes();
    for name in FIELD_NAMES {
        let needle = name.to_ascii_lowercase();
        let mut from = 0;
        while let Some(found) = lower[from..].find(&needle) {
            let matched = from + found;
            let mut start = matched;
            while start > 0 && bytes[start] != b'<' {
                start -= 1;
            }
            let mut end = matched + needle.len();
            while end < bytes.len() && bytes[end - 1] != b'>' {
                end += 1;
            }
            out.push(Hazard {
                start,
                end,
                replacement: REDACTED_FIELD,
            });
            from = matched + needle.len();
        }
    }
}

/// Matches a maximal run of ASCII digits, rejecting leading zeros the way
/// the ticket-01 guard's octet alternation did (`01` is not an octet).
fn read_octet(bytes: &[u8], start: usize) -> Option<(u32, usize)> {
    let mut end = start;
    while end < bytes.len() && bytes[end].is_ascii_digit() && end - start < 3 {
        end += 1;
    }
    if end == start {
        return None;
    }
    let digits = std::str::from_utf8(&bytes[start..end]).ok()?;
    if digits.len() > 1 && digits.starts_with('0') {
        return None;
    }
    let value: u32 = digits.parse().ok()?;
    if value > 255 {
        return None;
    }
    Some((value, end))
}

/// IPv4-shaped value: four valid octets joined by dots, bounded by
/// non-word characters (mirrors `\b` in the ticket-01 guard).
fn ipv4_hazards(bytes: &[u8], out: &mut Vec<Hazard>) {
    for start in 0..bytes.len() {
        if !bytes[start].is_ascii_digit() {
            continue;
        }
        if start > 0 && is_word_char(bytes[start - 1]) {
            continue;
        }
        let mut cursor = start;
        let mut ok = true;
        for group in 0..4 {
            if group > 0 {
                if byte_at(bytes, cursor) != b'.' {
                    ok = false;
                    break;
                }
                cursor += 1;
            }
            match read_octet(bytes, cursor) {
                Some((_value, next)) => cursor = next,
                None => {
                    ok = false;
                    break;
                }
            }
        }
        if !ok || is_word_char(byte_at(bytes, cursor)) {
            continue;
        }
        out.push(Hazard {
            start,
            end: cursor,
            replacement: REDACTED_VALUE,
        });
    }
}

/// MAC-shaped value in one spelling: `groups` pairs of hex digits joined by
/// `separator`, or — with `separator == None` — exactly twelve hex digits.
/// Both ends must sit at a word boundary, mirroring `\b`.
fn mac_hazards(bytes: &[u8], separator: Option<u8>, groups: usize, out: &mut Vec<Hazard>) {
    let pair = 2usize;
    let group_len = |index: usize| -> usize {
        if index == 0 || separator.is_none() {
            pair
        } else {
            pair + 1 // separator plus the pair
        }
    };
    let total_len: usize = (0..groups).map(group_len).sum();
    if bytes.len() < total_len {
        return;
    }
    for start in 0..=bytes.len() - total_len {
        if !is_hex(bytes[start]) {
            continue;
        }
        if start > 0 && is_word_char(bytes[start - 1]) {
            continue;
        }
        let end = start + total_len;
        if is_word_char(byte_at(bytes, end)) {
            continue;
        }
        let mut ok = true;
        let mut cursor = start;
        for group in 0..groups {
            if group > 0 {
                if let Some(sep) = separator {
                    if byte_at(bytes, cursor) == sep {
                        cursor += 1;
                    } else {
                        ok = false;
                        break;
                    }
                }
            }
            if !(is_hex(bytes[cursor]) && is_hex(bytes[cursor + 1])) {
                ok = false;
                break;
            }
            cursor += 2;
        }
        if ok {
            out.push(Hazard {
                start,
                end,
                replacement: REDACTED_VALUE,
            });
        }
    }
}

/// Collects every hazard span in `html`, ascending left-to-right with
/// overlapping spans resolved in favour of the earlier/longer match.
fn hazards_in(html: &str) -> Vec<Hazard> {
    let lower = html.to_ascii_lowercase();
    let bytes = lower.as_bytes();
    let mut hazards = Vec::new();
    field_name_hazards(&lower, &mut hazards);
    ipv4_hazards(bytes, &mut hazards);
    mac_hazards(bytes, Some(b':'), 6, &mut hazards);
    mac_hazards(bytes, Some(b'-'), 6, &mut hazards);
    mac_hazards(bytes, None, 6, &mut hazards); // bare form
    hazards.sort_by(|a, b| a.start.cmp(&b.start).then(b.end.cmp(&a.end)));
    let mut resolved = Vec::with_capacity(hazards.len());
    let mut last_end = 0;
    for hazard in hazards {
        if hazard.start >= last_end {
            last_end = hazard.end;
            resolved.push(hazard);
        }
    }
    resolved
}

/// Lists the student-identifying hazards still present in `html` — the same
/// audit the ticket-01 fixture guard performs, usable on scrubbed output to
/// prove it is clean.
pub fn find_scrub_violations(html: &str) -> Vec<String> {
    hazards_in(html)
        .into_iter()
        .map(|hazard| match hazard.replacement {
            REDACTED_FIELD => format!(
                "student-identifying field name {:?}",
                &html[hazard.start..hazard.end]
            ),
            _ => format!("identifying-shaped value {:?}", &html[hazard.start..hazard.end]),
        })
        .collect()
}

/// Replaces every hazard with its visible redaction marker.
pub fn scrub_fragment(html: &str) -> String {
    let mut out = String::with_capacity(html.len());
    let mut copied = 0;
    for hazard in hazards_in(html) {
        out.push_str(&html[copied..hazard.start]);
        out.push_str(hazard.replacement);
        copied = hazard.end;
    }
    out.push_str(&html[copied..]);
    out
}

/// Removes `<tag ...>…</tag>` blocks whole (markup *and* contents) for each
/// noise tag. An unterminated block swallows the rest — it is all noise.
fn strip_block(html: &str, tag: &str) -> String {
    let lower = html.to_ascii_lowercase();
    let open = format!("<{tag}");
    let close = format!("</{tag}>");
    let lower_bytes = lower.as_bytes();
    let mut out = String::with_capacity(html.len());
    let mut cursor = 0;
    while let Some(at) = lower[cursor..].find(&open) {
        let start = cursor + at;
        let after_open = start + open.len();
        let next = byte_at(lower_bytes, after_open);
        if !(next == b'>' || next.is_ascii_whitespace()) {
            // A different tag merely prefixed by this name.
            cursor = start + 1;
            continue;
        }
        out.push_str(&html[cursor..start]);
        match lower[start..].find(&close) {
            Some(relative) => cursor = start + relative + close.len(),
            None => return out,
        }
    }
    out.push_str(&html[cursor..]);
    out
}

/// Trims an already-scrubbed fragment to the diagnostically useful part:
/// script/style/noscript blocks dropped whole, whitespace collapsed, output
/// capped at [`MAX_DIAGNOSTIC_FRAGMENT_CHARS`] characters.
pub fn trim_fragment(scrubbed: &str) -> String {
    let mut without_noise = scrubbed.to_string();
    for tag in ["script", "style", "noscript"] {
        without_noise = strip_block(&without_noise, tag);
    }
    let collapsed = collapse_whitespace(&without_noise);
    if collapsed.chars().count() <= MAX_DIAGNOSTIC_FRAGMENT_CHARS {
        return collapsed;
    }
    let mut capped: String = collapsed
        .chars()
        .take(MAX_DIAGNOSTIC_FRAGMENT_CHARS)
        .collect();
    capped.push_str(TRUNCATED_MARK);
    capped
}

fn collapse_whitespace(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut pending_space = false;
    for character in text.chars() {
        if character.is_whitespace() {
            pending_space = true;
        } else {
            if pending_space && !out.is_empty() {
                out.push(' ');
            }
            pending_space = false;
            out.push(character);
        }
    }
    if pending_space {
        out.push(' ');
    }
    out
}

/// The full failure-site pipeline: scrub, trim, and scrub again. This is
/// the only form in which a failing fragment may travel anywhere near the
/// webview. The second scrub exists because trimming strips blocks *whole*:
/// splicing the surviving text can join two harmless halves into a hazard —
/// a field name or a MAC split across a stripped `<script>` block — so the
/// pre-trim scrub alone cannot prove the result clean.
pub fn diagnostic_fragment(raw_html: &str) -> String {
    scrub_fragment(&trim_fragment(&scrub_fragment(raw_html)))
}

#[cfg(test)]
mod tests {
    use super::*;

    // ---------- agreement with the TypeScript scanner (ticket 51) ----------

    /// The shared contract with `src/core/scrub.ts`: same inputs, same
    /// violation counts. See the fixture's `description` for what is
    /// deliberately out of contract (overlapping-hazard counts) and what is
    /// shared behaviour rather than divergence (the bounded twelve-hex run).
    #[test]
    fn the_shared_fixture_holds_for_the_rust_scanner() {
        let fixture = include_str!("../../tests/fixtures/scrub-agreement.json");
        let parsed: serde_json::Value = serde_json::from_str(fixture).expect("valid fixture json");
        let cases = parsed["cases"].as_array().expect("cases array");
        assert!(!cases.is_empty(), "the fixture carries cases");
        for case in cases {
            let name = case["name"].as_str().expect("case name");
            let input = case["input"].as_str().expect("case input");
            let expected = case["violations"].as_u64().expect("case count") as usize;
            assert_eq!(
                find_scrub_violations(input).len(),
                expected,
                "case {name}: {input}"
            );
        }
    }

    /// The TypeScript suite audits the committed captures through its glob;
    /// this is the same input on the Rust side of the contract.
    #[test]
    fn the_committed_captures_audit_clean_on_the_rust_side_too() {
        for capture in [
            include_str!("../../tests/fixtures/ArchersHub-Course-Finder-CSINTSY.html"),
            include_str!("../../tests/fixtures/ArchersHub-Course-Finder-GEARTAP.html"),
        ] {
            assert!(
                find_scrub_violations(capture).is_empty(),
                "a committed capture must audit clean"
            );
        }
    }

    // ---------- the four student-identifying field names ----------

    #[test]
    fn scrubbing_removes_each_of_the_four_field_names() {
        for name in FIELD_NAMES {
            let raw = format!("<input type=\"hidden\" id=\"{name}\" value=\"x\">");
            let scrubbed = scrub_fragment(&raw);
            assert!(
                !scrubbed.contains(name),
                "{name} must not survive scrubbing: {scrubbed}"
            );
            assert!(
                scrubbed.contains(REDACTED_FIELD),
                "the redaction must be visible, got: {scrubbed}"
            );
            assert!(find_scrub_violations(&scrubbed).is_empty(), "{scrubbed}");
        }
    }

    #[test]
    fn a_field_name_takes_its_containing_tag_with_it_so_values_leave_too() {
        // MasterSoft carries the identity in `value=` attributes of the same
        // hidden input; removing only the attribute name would leak it.
        let raw = "<input type=\"hidden\" name=\"hdnStudId\" id=\"hdnStudId\" value=\"2299999\">";
        let scrubbed = scrub_fragment(raw);
        assert!(!scrubbed.contains("hdnStudId"));
        assert!(!scrubbed.contains("2299999"), "{scrubbed}");
        assert!(scrubbed.contains(REDACTED_FIELD));
    }

    #[test]
    fn field_names_are_matched_case_insensitively() {
        let raw = "<script>var UserID = 2299999; var HDNSTUDID = 2299999;</script>";
        // Both spellings are caught (they may share one enclosing element).
        let violations = find_scrub_violations(raw).join("\n");
        assert!(violations.to_lowercase().contains("userid"));
        assert!(violations.to_lowercase().contains("hdnstudid"));
        assert!(find_scrub_violations(&scrub_fragment(raw)).is_empty());
    }

    // ---------- IPv4-shaped values ----------

    #[test]
    fn scrubbing_removes_ipv4_shaped_values() {
        let scrubbed = scrub_fragment("<td>IP: 149.30.146.213</td>");
        assert!(!scrubbed.contains("149.30.146.213"));
        assert!(find_scrub_violations(&scrubbed).is_empty());
    }

    #[test]
    fn invalid_octets_and_version_like_dots_are_not_touched() {
        for safe in [
            "256.1.1.1",
            "fullcalendar@6.1.14",
            "22/08/2026 05:17:36",
            "1.2.3",
        ] {
            let raw = format!("<p>{safe}</p>");
            assert!(
                find_scrub_violations(&raw).is_empty(),
                "{safe} is not identifying"
            );
            assert_eq!(scrub_fragment(&raw), raw, "{safe} must survive verbatim");
        }
    }

    // ---------- MAC-shaped values ----------

    #[test]
    fn scrubbing_removes_mac_addresses_in_all_three_spellings() {
        for mac in ["60:45:BD:1B:55:13", "60-45-BD-1B-55-13", "6045BD1B5513"] {
            let raw = format!("<td>{mac}</td>");
            assert_eq!(find_scrub_violations(&raw).len(), 1, "{mac}");
            let scrubbed = scrub_fragment(&raw);
            assert!(!scrubbed.contains(mac), "{mac} must be redacted");
            assert!(find_scrub_violations(&scrubbed).is_empty());
        }
    }

    #[test]
    fn times_dates_and_long_digit_runs_are_not_mistaken_for_macs_or_ips() {
        for safe in [
            "05:17:36",
            "22/08/2026 05:17:36",
            "08202025065710966",
            "data-key=\"2923%7C384%7C\"",
        ] {
            let raw = format!("<p>{safe}</p>");
            assert!(
                find_scrub_violations(&raw).is_empty(),
                "{safe} must not be flagged"
            );
            assert_eq!(scrub_fragment(&raw), raw);
        }
    }

    // ---------- the raw shape of the ticket-01 captures ----------

    /// What a live Course Finder page carried before ticket 01 scrubbed it:
    /// hidden identity inputs, inline scripts holding ids, and network
    /// fingerprints — around the parser-relevant table markup.
    const RAW_CAPTURE_SHAPE: &str = r#"<html><head>
<script src="/scripts/jquery.min.js"></script>
<script>var userID = 2299999; var hdnStudId = 2299999; var IP_ADDRESS = '149.30.146.213';</script>
</head><body>
<form>
<input type="hidden" name="hdnStudId" id="hdnStudId" value="2299999">
<input type="hidden" name="userID" id="userID" value="2299999">
<input type="hidden" name="MAC_ADDRESS" id="MAC_ADDRESS" value="60:45:BD:1B:55:13">
<input type="hidden" name="IP_ADDRESS" id="IP_ADDRESS" value="149.30.146.213">
<table id="tblCourseSelection"><tbody>
<tr data-start-date="07/10/2026" data-end-date="12/09/2026" data-key="2923%7C384%7C">
<td>Lecture</td><td></td><td>3</td><td>S01</td><td>[ MONDAY - 02:30 PM - 04:00 PM : Room - L226 ]</td>
<td>45</td><td>42</td><td></td><td></td>
<td hidden>2923</td><td hidden>384</td>
</tr>
</tbody></table>
</form></body></html>"#;

    #[test]
    fn the_raw_ticket_01_capture_shape_scrubs_clean_while_keeping_table_markup() {
        // Hazards sharing an enclosing element merge into one span, so the
        // audit is checked by kind rather than by count.
        let violations = find_scrub_violations(RAW_CAPTURE_SHAPE).join("\n");
        for name in ["hdnStudId", "userID", "IP_ADDRESS", "MAC_ADDRESS"] {
            assert!(
                violations.to_lowercase().contains(&name.to_lowercase()),
                "the raw shape must flag {name}: {violations}"
            );
        }
        assert!(violations.contains("60:45:BD:1B:55:13"), "{violations}");
        assert!(violations.contains("149.30.146.213"), "{violations}");

        let scrubbed = scrub_fragment(RAW_CAPTURE_SHAPE);
        assert!(
            find_scrub_violations(&scrubbed).is_empty(),
            "every hazard must be gone: {scrubbed}"
        );
        // The identifying *values* ride inside the same tags as their field
        // names; they leave with the tag.
        assert!(
            !scrubbed.contains("2299999"),
            "the student id value must not survive: {scrubbed}"
        );
        // Nothing the parser depends on may be lost.
        assert!(scrubbed.contains("tblCourseSelection"));
        assert!(scrubbed.contains("data-start-date"));
        assert!(scrubbed.contains("data-key"));
        assert!(scrubbed.contains("<td hidden>2923</td>"));
        assert!(scrubbed.contains("Room - L226"));
    }

    #[test]
    fn clean_input_passes_through_scrubbing_verbatim_except_whitespace() {
        let clean = "<tr data-key=\"2923%7C384%7C\"><td>S01</td></tr>";
        assert!(find_scrub_violations(clean).is_empty());
        assert_eq!(scrub_fragment(clean), clean);
    }

    // ---------- trimming to the diagnostically useful part ----------

    #[test]
    fn trimming_strips_scripts_and_styles_but_keeps_table_markup() {
        let page = format!(
            "<html><head><style>body {{ color: red }}</style>\
             <script>var filler = '{}';</script></head>\
             <body><table id=\"tblCourseSelection\"><tbody><tr><td>S01</td></tr></tbody></table></body></html>",
            "x".repeat(5000)
        );
        let trimmed = trim_fragment(&page);
        assert!(!trimmed.contains("<script"), "scripts are noise: {trimmed}");
        assert!(!trimmed.contains("<style"), "styles are noise: {trimmed}");
        assert!(trimmed.contains("tblCourseSelection"));
        assert!(trimmed.len() < 1000, "the trim must actually shrink it");
    }

    #[test]
    fn trimming_caps_the_output_at_a_small_diagnostic_budget() {
        let row = "<tr><td>S01</td></tr>";
        let page = format!("<html><body>{}{row}</body></html>", "y".repeat(100_000));
        let trimmed = trim_fragment(&page);
        assert!(
            trimmed.chars().count() <= MAX_DIAGNOSTIC_FRAGMENT_CHARS + TRUNCATED_MARK.chars().count(),
            "the fragment stays small, got {} chars",
            trimmed.chars().count()
        );
        assert!(trimmed.ends_with(TRUNCATED_MARK), "truncation is announced");
    }

    #[test]
    fn trimming_never_splits_a_hazard_in_half_so_scrubbing_runs_first() {
        // A MAC address past the truncation point would be cut into a
        // partial token if trimming ran before scrubbing; after scrubbing
        // there is nothing left to cut.
        let mut page = String::from("<table><tbody>");
        page.push_str(&"<tr><td>S01</td></tr>".repeat(200));
        page.push_str("<td>60:45:BD:1B:55:13</td></tbody></table>");
        let fragment = diagnostic_fragment(&page);
        assert!(
            find_scrub_violations(&fragment).is_empty(),
            "no hazard survives the full pipeline: {fragment}"
        );
        assert!(!fragment.contains("60:45:BD"), "not even partially");
    }

    #[test]
    fn trimming_can_splice_a_hazard_back_together_so_the_pipeline_scrubs_again() {
        // Each half here is harmless on its own and the script blocks
        // between them are exactly what the trim removes — splicing the
        // halves into a field name and a MAC that never existed in the raw
        // text, so the pre-trim scrub cannot see them. The pipeline
        // therefore scrubs once more after trimming, and the diagnostic
        // markup survives.
        let raw = "<table id=\"tblCourseSelection\"><tr>\
                   <td>hdn<script>noise</script>StudId \
                   60:45:BD:1B:5<script>noise</script>5:13</td>\
                   </tr></table>";
        let fragment = diagnostic_fragment(raw);
        assert!(
            find_scrub_violations(&fragment).is_empty(),
            "no hazard may survive the full pipeline: {fragment}"
        );
        assert!(!fragment.contains("hdnStudId"), "{fragment}");
        assert!(!fragment.contains("60:45:BD:1B:55:13"), "{fragment}");
        assert!(
            fragment.contains("tblCourseSelection"),
            "diagnostics survive the second scrub: {fragment}"
        );
    }
}
