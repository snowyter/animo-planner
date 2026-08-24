//! Bundled sample data for the "Explore with sample data" seed (ticket 07).
//!
//! The two scrubbed Course Finder captures from ticket 01 are embedded at
//! compile time, so seeding works with no network connection and no ERP
//! credentials. Parsing runs through the real parser (ticket 04); nothing
//! here invents section rows. Since ticket 27 the seed lands under a
//! reserved scope (see [`SAMPLE_CAMPUS_ID`]) so the fabricated captures can
//! never be mistaken for data captured from Archer's Hub.

use crate::core::options;
use crate::core::parser::{self, ParseError, ParsedSection, SelectorConfig};

/// The campus and session the sample data is seeded under (ticket 27):
/// reserved ids from [`crate::core::options`] that are not Archer's Hub
/// ids and are never offered, so nothing captured from the live site can
/// land in the sample scope and `create_plan` can never target it. The
/// *names* are not restated here — they come from
/// [`crate::core::options`], the single source (ticket 25), so a rename
/// cannot drift between surfaces.
pub use crate::core::options::{SAMPLE_CAMPUS_ID, SAMPLE_SESSION_ID};
pub const SAMPLE_CAMPUS_NAME: &str = match options::campus_name(SAMPLE_CAMPUS_ID) {
    Some(name) => name,
    None => panic!("the reserved sample campus id must resolve to a name"),
};
pub const SAMPLE_SESSION_NAME: &str = match options::session_name(SAMPLE_SESSION_ID) {
    Some(name) => name,
    None => panic!("the reserved sample session id must resolve to a name"),
};

/// Reserved plan id and display name for the seeded sample plan.
pub const SAMPLE_PLAN_ID: &str = "sample-plan";
pub const SAMPLE_PLAN_NAME: &str = "Sample data (GEARTAP + CSINTSY)";

const CSINTSY_HTML: &str =
    include_str!("../../tests/fixtures/ArchersHub-Course-Finder-CSINTSY.html");
const GEARTAP_HTML: &str =
    include_str!("../../tests/fixtures/ArchersHub-Course-Finder-GEARTAP.html");

const SAMPLE_FIXTURES: [&str; 2] = [CSINTSY_HTML, GEARTAP_HTML];

/// Parses the bundled fixtures into one result set per course, exactly as
/// two Course Finder searches would arrive through the real parser: course
/// identity read from each page's dropdown, rows parsed from the table.
pub fn parse_sample_captures(
    config: &SelectorConfig,
) -> Result<Vec<Vec<ParsedSection>>, ParseError> {
    SAMPLE_FIXTURES
        .iter()
        .map(|html| {
            let context = parser::course_context_from_html(html, config)?;
            let result = parser::parse_results_table(html, &context, config)?;
            Ok(result.sections)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sample_captures_parse_through_the_real_parser() {
        let captures =
            parse_sample_captures(&SelectorConfig::default()).expect("both fixtures must parse");

        assert_eq!(captures.len(), 2, "one result set per fixture");
        assert_eq!(captures[0].len(), 5, "CSINTSY has 5 sections");
        assert_eq!(captures[1].len(), 42, "GEARTAP has 42 sections");

        let section_count: usize = captures.iter().map(Vec::len).sum();
        assert_eq!(section_count, 47, "the sample plan holds all 47 sections");

        let block_count: usize = captures
            .iter()
            .flatten()
            .map(|section| section.blocks.len())
            .sum();
        assert_eq!(block_count, 94, "CSINTSY's 10 blocks + GEARTAP's 84 blocks");

        // Identity came from each fixture's dropdown, not hardcoded here.
        let csintsy = &captures[0][0];
        assert_eq!(
            (csintsy.course_id, csintsy.course_code.as_str()),
            (2923, "CSINTSY")
        );
        assert_eq!(csintsy.course_title, "INTRODUCTION TO INTELLIGENT SYSTEMS");
        let geartap = &captures[1][0];
        assert_eq!((geartap.course_id, geartap.course_code.as_str()), (564, "GEARTAP"));

        // Every block's location classified, so every section carries a
        // derived modality.
        for section in captures.iter().flatten() {
            assert!(
                !section.blocks.is_empty(),
                "{} must have schedule blocks",
                section.section_code
            );
            assert!(
                section.modality().is_some(),
                "{} must derive a modality",
                section.section_code
            );
        }
    }

    #[test]
    fn sample_scope_is_reserved_never_a_real_capture_context() {
        // Ticket 27: the fixtures were captured under Manila / AY2026-27 T1,
        // but the seed must live under ids that are NOT that real scope, or
        // every real plan in Manila / AY2026-27 T1 reads the sample rows out
        // of the same catalog. The reserved ids come from core::options,
        // which resolves them to explicitly sample-flavoured names.
        assert_eq!(SAMPLE_CAMPUS_ID, options::SAMPLE_CAMPUS_ID);
        assert_eq!(SAMPLE_SESSION_ID, options::SAMPLE_SESSION_ID);
        assert_ne!(
            (SAMPLE_CAMPUS_ID, SAMPLE_SESSION_ID),
            (7, 155),
            "the sample scope must not be the verified Manila / AY2026-27 T1 scope"
        );
        // Names are derived from core::options, never restated here.
        assert_eq!(SAMPLE_CAMPUS_NAME, "Sample Campus");
        assert_eq!(SAMPLE_SESSION_NAME, "Sample Term");
    }
}
