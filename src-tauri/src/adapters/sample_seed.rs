//! Sample-data seed orchestration (ticket 07).
//!
//! One call turns the bundled fixtures into a fully-populated plan that is
//! visibly marked as sample data, by pushing the fixtures through the real
//! parser ([`crate::core::sample_data`]) and the real storage layer
//! ([`Store`]). The storage-level seed is transactional and idempotent, and
//! the whole path performs no network I/O — the fixtures are embedded.

use crate::adapters::store::{CaptureScope, PlanSummaryRow, Store, StoreError};
use crate::core::ipc_types::PlanSummary;
use crate::core::parser::{ParseError, SelectorConfig};
use crate::core::sample_data;

/// The scope the sample plan is hard-scoped to: the reserved sample
/// campus and session (ticket 27) — ids that are not Archer's Hub ids and
/// are never offered, so no real plan can ever read this catalog.
pub const SAMPLE_SCOPE: CaptureScope = CaptureScope {
    campus_id: sample_data::SAMPLE_CAMPUS_ID,
    session_id: sample_data::SAMPLE_SESSION_ID,
};

#[derive(Debug)]
pub enum SeedError {
    Store(StoreError),
    Parse(ParseError),
}

impl std::fmt::Display for SeedError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SeedError::Store(err) => write!(f, "sample-data seed failed: {err}"),
            SeedError::Parse(err) => write!(f, "sample-data seed failed: {err}"),
        }
    }
}

impl std::error::Error for SeedError {}

impl From<StoreError> for SeedError {
    fn from(err: StoreError) -> Self {
        SeedError::Store(err)
    }
}

impl From<ParseError> for SeedError {
    fn from(err: ParseError) -> Self {
        SeedError::Parse(err)
    }
}

/// Seeds the sample plan: parses the embedded fixtures and stores them via
/// `Store::seed_sample_plan`, then returns the plan as the UI expects it.
/// Idempotent — a repeat call returns the existing plan untouched.
pub fn seed_sample_plan(store: &mut Store, captured_at: &str) -> Result<PlanSummary, SeedError> {
    let captures = sample_data::parse_sample_captures(&SelectorConfig::default())?;
    let capture_refs: Vec<&[crate::core::parser::ParsedSection]> =
        captures.iter().map(Vec::as_slice).collect();
    let row = store.seed_sample_plan(
        &SAMPLE_SCOPE,
        sample_data::SAMPLE_PLAN_ID,
        sample_data::SAMPLE_PLAN_NAME,
        &capture_refs,
        captured_at,
    )?;
    Ok(summary_from_row(row))
}

/// The storage row plus the scope names this seed knows — the sample plan is
/// always scoped to the reserved sample scope, whose explicitly
/// sample-flavoured names come from [`crate::core::options`] (ticket 27).
fn summary_from_row(row: PlanSummaryRow) -> PlanSummary {
    PlanSummary {
        id: row.id,
        name: row.name,
        campus_id: row.campus_id,
        campus_name: sample_data::SAMPLE_CAMPUS_NAME.to_string(),
        session_id: row.session_id,
        session_name: sample_data::SAMPLE_SESSION_NAME.to_string(),
        created_at: row.created_at,
        section_count: row.section_count,
        is_sample: row.is_sample,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const T1: &str = "2026-08-22T10:00:00Z";
    const T2: &str = "2026-08-22T11:00:00Z";

    fn store() -> Store {
        Store::open_in_memory().expect("in-memory store must open")
    }

    fn count(conn: &rusqlite::Connection, sql: &str) -> i64 {
        conn.query_row(sql, [], |row| row.get(0))
            .expect("count query must run")
    }

    #[test]
    fn seed_builds_a_complete_visibly_marked_sample_plan() {
        let mut store = store();
        let summary = seed_sample_plan(&mut store, T1).expect("seed must succeed");

        assert!(summary.is_sample, "the seeded plan must be visibly marked as sample data");
        assert_eq!(summary.id, sample_data::SAMPLE_PLAN_ID);
        assert_eq!(summary.name, sample_data::SAMPLE_PLAN_NAME);
        assert_eq!(summary.campus_name, "Sample Campus");
        assert_eq!(summary.session_name, "Sample Term");
        assert_eq!(summary.section_count, 47);

        assert_eq!(count(&store.conn, "SELECT COUNT(*) FROM plans"), 1);
        assert_eq!(count(&store.conn, "SELECT COUNT(*) FROM courses"), 2);
        assert_eq!(count(&store.conn, "SELECT COUNT(*) FROM sections"), 47);
        assert_eq!(count(&store.conn, "SELECT COUNT(*) FROM plan_sections"), 47);
        assert_eq!(count(&store.conn, "SELECT COUNT(*) FROM snapshots"), 47);
        assert_eq!(count(&store.conn, "SELECT COUNT(*) FROM schedule_blocks"), 94);

        // Every plan link is an ordinary unpinned row, so the sample plan
        // deletes like any other plan (ticket 08).
        assert_eq!(
            count(&store.conn, "SELECT COUNT(*) FROM plan_sections WHERE pinned = 0"),
            47
        );
        let is_sample: i64 = store
            .conn
            .query_row("SELECT is_sample FROM plans", [], |row| row.get(0))
            .expect("is_sample must be readable");
        assert_eq!(is_sample, 1);
    }

    #[test]
    fn seeded_blocks_keep_their_derived_modalities() {
        let mut store = store();
        seed_sample_plan(&mut store, T1).expect("seed");

        assert_eq!(
            count(
                &store.conn,
                "SELECT COUNT(*) FROM schedule_blocks WHERE modality IS NULL"
            ),
            0,
            "every stored block must carry a derived modality"
        );
        let f2f = count(&store.conn, "SELECT COUNT(*) FROM schedule_blocks WHERE modality = 'F2F'");
        let online =
            count(&store.conn, "SELECT COUNT(*) FROM schedule_blocks WHERE modality = 'ONLINE'");
        assert_eq!((f2f, online), (48, 46), "10 CSINTSY room blocks + GEARTAP's 38/46 mix");
    }

    #[test]
    fn seeding_twice_changes_nothing() {
        let mut store = store();
        let first = seed_sample_plan(&mut store, T1).expect("first seed");
        let second = seed_sample_plan(&mut store, T2).expect("second seed");

        assert_eq!(second.id, first.id, "the second seed returns the existing plan");
        assert_eq!(second.section_count, 47);
        assert_eq!(count(&store.conn, "SELECT COUNT(*) FROM plans"), 1);
        assert_eq!(count(&store.conn, "SELECT COUNT(*) FROM sections"), 47);
        assert_eq!(count(&store.conn, "SELECT COUNT(*) FROM plan_sections"), 47);
        assert_eq!(
            count(&store.conn, "SELECT COUNT(*) FROM snapshots"),
            47,
            "a repeat seed must not re-capture"
        );
    }

    #[test]
    fn the_seeded_sample_plan_exports_a_valid_ics_calendar() {
        // The full ticket-17 path over real captures: seed → load → serialise.
        let mut store = store();
        seed_sample_plan(&mut store, T1).expect("seed");

        let plan = store
            .load_plan_ics_export(sample_data::SAMPLE_PLAN_ID)
            .expect("every seeded section must carry its term dates");
        assert_eq!(plan.name, sample_data::SAMPLE_PLAN_NAME);
        assert_eq!(plan.sections.len(), 47);

        let out = crate::core::ics::export_plan_ics(
            &plan.name,
            &plan.sections,
            chrono::Utc::now(),
        );
        assert_eq!(
            out.contents.matches("BEGIN:VEVENT").count(),
            94,
            "one event per schedule block across all 47 sections"
        );
        assert!(
            out.contents.contains("BYDAY=SA"),
            "Saturday meetings recur on Saturday"
        );
        assert!(
            !out.contents.contains("\r\nDTSTART:"),
            "no floating event times"
        );
        assert!(out.contents.starts_with("BEGIN:VCALENDAR\r\n"));
    }

    #[test]
    fn the_sample_plan_differs_from_student_plans_only_by_the_marker() {
        let mut store = store();
        seed_sample_plan(&mut store, T1).expect("seed");
        // A student plan in the real Manila / AY2026-27 T1 scope — never the
        // reserved sample scope (ticket 27).
        store
            .create_plan("student-plan", "T1 load", &REAL_SCOPE, T1, false)
            .expect("a student plan");

        let mut stmt = store
            .conn
            .prepare("SELECT id, is_sample FROM plans ORDER BY id")
            .expect("prepare");
        let rows: Vec<(String, i64)> = stmt
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .expect("query")
            .map(|row| row.expect("row"))
            .collect();
        assert_eq!(
            rows,
            vec![("sample-plan".to_string(), 1), ("student-plan".to_string(), 0)],
            "both plans live in the same table; only the marker distinguishes them"
        );
    }

    /// The real Manila / AY2026-27 T1 scope the fixtures were captured under.
    const REAL_SCOPE: CaptureScope = CaptureScope { campus_id: 7, session_id: 155 };

    #[test]
    fn seeding_leaves_every_real_scope_catalog_empty() {
        // Ticket 27: captured courses and sections are keyed by
        // (campus_id, session_id). The seed must land in the reserved sample
        // scope so a genuine Manila / AY2026-27 T1 plan reads an empty
        // catalog while the sample plan is seeded.
        let mut store = store();
        let summary = seed_sample_plan(&mut store, T1).expect("seed");

        assert_eq!(summary.section_count, 47, "the sample plan itself is fully populated");
        assert_ne!(
            (summary.campus_id, summary.session_id),
            (REAL_SCOPE.campus_id, REAL_SCOPE.session_id),
            "the seed must not share the real scope"
        );

        let real_summary = store.capture_summary(&REAL_SCOPE).expect("real-scope summary");
        assert_eq!(
            (real_summary.section_count, real_summary.course_count),
            (0, 0),
            "a real scope must report zero captured sections and zero courses"
        );
        assert!(
            store.captured_courses(&REAL_SCOPE).expect("real courses").is_empty(),
            "no sample course may surface in a real scope's catalog"
        );
        assert!(
            store
                .captured_sections(&REAL_SCOPE, 2923)
                .expect("real sections")
                .is_empty(),
            "no sample section may be offered to a real plan"
        );
    }

    #[test]
    fn the_seeded_sample_plan_still_solves_conflict_free_and_exports() {
        // Ticket 27: isolating the seed into its reserved scope must leave
        // the sample plan's own end-to-end behaviour untouched — solve,
        // conflicts, and export all run through the ordinary paths.
        use crate::core::ipc_types::{Preset, SectionRef, SolveOptions, SolveStatus};
        use crate::core::solver::{FixedSection, Solver};

        let mut store = store();
        seed_sample_plan(&mut store, T1).expect("seed");

        // Trim to one chosen CSINTSY section, as a student mid-pick would,
        // so the solve has an unassigned course to fill.
        let detail = store.get_plan(sample_data::SAMPLE_PLAN_ID).expect("detail");
        let mut pinned: Option<(i64, i64)> = None;
        for section in &detail.sections {
            if pinned.is_none() && section.course_id == 2923 {
                pinned = Some((section.course_id, section.section_id));
            } else {
                store
                    .remove_section_from_plan(
                        sample_data::SAMPLE_PLAN_ID,
                        section.course_id,
                        section.section_id,
                    )
                    .expect("trim membership");
            }
        }

        // The solve inputs derive from the plan itself, exactly as
        // `begin_solve` does — including the scope read off the plan row.
        let detail = store.get_plan(sample_data::SAMPLE_PLAN_ID).expect("trimmed detail");
        assert_eq!(detail.sections.len(), 1, "one pinned section remains");
        let scope = CaptureScope {
            campus_id: detail.summary.campus_id,
            session_id: detail.summary.session_id,
        };
        assert_eq!(scope, SAMPLE_SCOPE, "the sample plan solves within its reserved scope");
        let fixed: Vec<FixedSection> = detail
            .sections
            .iter()
            .map(|section| FixedSection {
                course_id: section.course_id,
                course_code: section.course_code.clone(),
                section_id: section.section_id,
                section_code: section.section_code.clone(),
                blocks: section.blocks.clone(),
                pinned: true,
            })
            .collect();
        let catalog = store.solver_courses(&scope).expect("catalog");
        assert_eq!(catalog.len(), 2, "both sample courses remain candidates");

        let options = SolveOptions {
            preset: Preset::FewestCampusDays,
            day_blacklist: vec![],
            earliest_start_min: None,
            latest_end_min: None,
            exclude_full: false,
            result_limit: 12,
        };
        let outcome = Solver::new(catalog, fixed, options).run();
        assert_eq!(outcome.status, SolveStatus::Complete);
        assert!(
            !outcome.solutions.is_empty(),
            "GEARTAP must offer sections outside the chosen CSINTSY times"
        );

        // Applying the best solution keeps the plan conflict-free...
        let refs: Vec<SectionRef> = outcome.solutions[0]
            .sections
            .iter()
            .map(|section| SectionRef {
                course_id: section.course_id,
                section_id: section.section_id,
            })
            .collect();
        store
            .apply_solution(sample_data::SAMPLE_PLAN_ID, &refs)
            .expect("apply");
        assert!(
            store
                .conflicts_in_plan(sample_data::SAMPLE_PLAN_ID)
                .expect("conflicts")
                .is_empty(),
            "the solved sample plan is conflict-free"
        );

        // ...and it still exports a valid calendar (ticket 17 path).
        let plan = store
            .load_plan_ics_export(sample_data::SAMPLE_PLAN_ID)
            .expect("every applied section carries its term dates");
        let out = crate::core::ics::export_plan_ics(&plan.name, &plan.sections, chrono::Utc::now());
        assert!(
            out.contents.matches("BEGIN:VEVENT").count() >= 2,
            "pinned + solved sections each recur per block"
        );
    }
}
