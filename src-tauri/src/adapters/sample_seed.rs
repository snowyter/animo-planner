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

/// The scope the sample plan is hard-scoped to: the captures' campus and
/// session (Manila, AY2026-27 T1).
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
/// always scoped to the sample capture.
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
        assert_eq!(summary.campus_name, "Manila");
        assert_eq!(summary.session_name, "AY2026-27 T1");
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
    fn the_sample_plan_differs_from_student_plans_only_by_the_marker() {
        let mut store = store();
        seed_sample_plan(&mut store, T1).expect("seed");
        store
            .create_plan("student-plan", "T1 load", &SAMPLE_SCOPE, T1, false)
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
}
