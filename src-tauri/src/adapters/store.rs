//! SQLite persistence for captured sections (ticket 05), plan membership
//! with conflict computation (ticket 08), and refresh with missing-section
//! flags (ticket 16).
//!
//! This is the storage layer for SPEC §5: parsed sections are upserted on
//! their natural key, every capture appends a point-in-time snapshot, and
//! plans are hard-scoped to one `(campus, session)`.
//!
//! ADR-0015: the spec named `tauri-plugin-sql`, but that plugin exists to
//! hand SQL to the frontend. Storage here is Rust-owned behind Tauri
//! commands, so this module uses `rusqlite` directly with Rust-side
//! migrations and tests.
//!
//! Schema notes versus SPEC §5:
//! - `sections` carries a surrogate `id INTEGER PRIMARY KEY` because §5
//!   references it with single-column `section_fk`s. The natural key
//!   `(campus_id, session_id, course_id, section_id)` stays unique.
//! - `teacher` and `remark` live on `snapshots`, not `sections` — their
//!   change over time is itself information (ADR-0006).
//! - A blank teacher is stored as SQL `NULL` (unknown), never as an empty
//!   string that later reads as a value.
//! - `schedule_blocks.location` is `NULL` exactly when the block is online;
//!   blocks the parser could not classify keep their raw location text and
//!   a `NULL` modality so nothing is dropped.
//! - Raw HTML can never reach a row: the API accepts only typed parsed
//!   sections, and the columns are typed via `STRICT` tables.
//!
//! What §5 deliberately omits is not persisted here: section start/end
//! dates. A later ticket can add them as a migration.

use crate::core::conflicts::{self, PlannedBlock, PlannedSection};
use crate::core::ics::{ExportBlock, ExportPlan, ExportSection};
use crate::core::ipc_types::{
    AffectedPlan, BlockModality, CapturedCourse, CaptureSummary, Conflict, Day,
    ForgetCourseOutcome, MissingSection, RankableTeacher, ScheduleBlock, Section, SectionModality,
    Snapshot, TeacherPreference,
};
use crate::core::parser::{ParsedBlock, ParsedSection};
use crate::core::refresh::RefreshCourse;
use crate::core::solver::{FixedSection, SolverCourse, SolverSection};
use chrono::NaiveDate;
use rusqlite::{Connection, OptionalExtension, Transaction};
use std::collections::{BTreeMap, HashSet};
use std::path::Path;
use std::sync::{Arc, Mutex};

/// Which campus and academic session a capture belongs to. Sections and
/// plans are both scoped by this pair; it can never be mixed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CaptureScope {
    pub campus_id: i64,
    pub session_id: i64,
}

/// File name of the app database inside the app data directory.
pub const DB_FILE_NAME: &str = "animo-plan.db";

/// One plan row plus its section count — the fields the UI shows as a
/// [`crate::core::ipc_types::PlanSummary`], minus the campus/session names
/// this storage layer does not know.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlanSummaryRow {
    pub id: String,
    pub name: String,
    pub campus_id: i64,
    pub session_id: i64,
    pub created_at: String,
    pub section_count: i64,
}

/// A plan and all its members as stored: the summary row plus each member
/// as a wire [`PlanSection`] (blocks, derived modality, latest snapshot,
/// pinned and missing flags). The campus/session *names* are attached by
/// the interface layer, which owns the option tables.
#[derive(Debug, Clone, PartialEq)]
pub struct PlanDetail {
    pub summary: PlanSummaryRow,
    pub sections: Vec<crate::core::ipc_types::PlanSection>,
}

#[derive(Debug)]
pub enum StoreError {
    Sql(rusqlite::Error),
    PlanNotFound { plan_id: String },
    PlanExists { plan_id: String },
    SectionNotFound { course_id: i64, section_id: i64 },
    /// A plan is hard-scoped to one `(campus, session)`; linking a section
    /// captured under a different scope is rejected here, at the storage
    /// layer, not left to the UI.
    ScopeMismatch {
        plan_id: String,
        plan_campus_id: i64,
        plan_session_id: i64,
        section_campus_id: i64,
        section_session_id: i64,
    },
    /// A pin request for a section that is not a member of the plan. Failing
    /// loudly here means pinned state can never silently fail to persist.
    SectionNotInPlan {
        plan_id: String,
        course_id: i64,
        section_id: i64,
    },
    /// Every section row is written with its first snapshot in the same
    /// transaction; a section row without any snapshot violates that
    /// invariant and cannot produce a wire `Section`.
    SectionHasNoSnapshots {
        course_id: i64,
        section_id: i64,
    },
    /// The section has no captured start/end dates, so a recurring event
    /// spanning its term cannot be produced. Exporting would silently drop
    /// the section's classes, so this fails instead (ticket 17).
    SectionDatesMissing { course_id: i64, section_id: i64 },
    /// Forget-course found neither a course row nor any section of it under
    /// the scope (ticket 29). Failing loudly means an unknown course can
    /// never read as a successful no-op removal.
    CourseNotFound {
        campus_id: i64,
        session_id: i64,
        course_id: i64,
    },
    /// A solution named one section for a course whose membership is pinned
    /// to another (ticket 42). A real solve always carries every pinned
    /// member, so this cannot come from the solver; failing loudly beats
    /// silently duplicating the plan's membership for that course.
    SolutionOverridesPinned {
        plan_id: String,
        course_id: i64,
        pinned_section_id: i64,
        solution_section_id: i64,
    },
    /// A solution named two different sections of the same course (ticket
    /// 42). A solution holds one section per course by definition, so this
    /// is malformed input; applying it would write duplicate course
    /// membership into the plan.
    SolutionSplitsCourse { plan_id: String, course_id: i64 },
}

impl std::fmt::Display for StoreError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            StoreError::Sql(err) => write!(f, "sqlite error: {err}"),
            StoreError::PlanNotFound { plan_id } => write!(f, "plan {plan_id:?} not found"),
            StoreError::PlanExists { plan_id } => {
                write!(f, "a plan with id {plan_id:?} already exists")
            }
            StoreError::SectionNotFound {
                course_id,
                section_id,
            } => write!(f, "section (course {course_id}, section {section_id}) not found"),
            StoreError::ScopeMismatch {
                plan_id,
                plan_campus_id,
                plan_session_id,
                section_campus_id,
                section_session_id,
            } => write!(
                f,
                "plan {plan_id:?} is scoped to campus {plan_campus_id} session {plan_session_id} \
                 but the section belongs to campus {section_campus_id} session \
                 {section_session_id}"
            ),
            StoreError::SectionNotInPlan {
                plan_id,
                course_id,
                section_id,
            } => write!(
                f,
                "section (course {course_id}, section {section_id}) is not in plan {plan_id:?}"
            ),
            StoreError::SectionHasNoSnapshots {
                course_id,
                section_id,
            } => write!(
                f,
                "section (course {course_id}, section {section_id}) has no snapshots and \
                 cannot be read"
            ),
            StoreError::SectionDatesMissing { course_id, section_id } => write!(
                f,
                "section (course {course_id}, section {section_id}) has no captured \
                 start/end dates — refresh the course and export again"
            ),
            StoreError::CourseNotFound {
                campus_id,
                session_id,
                course_id,
            } => write!(
                f,
                "no course {course_id} is captured under campus {campus_id} session \
                 {session_id}, so there is nothing to forget"
            ),
            StoreError::SolutionOverridesPinned {
                plan_id,
                course_id,
                pinned_section_id,
                solution_section_id,
            } => write!(
                f,
                "cannot apply section (course {course_id}, section {solution_section_id}): \
                 plan {plan_id:?} pins this course to section {pinned_section_id}; unpin it first"
            ),
            StoreError::SolutionSplitsCourse { plan_id, course_id } => write!(
                f,
                "cannot apply the solution: it names more than one section for course \
                 {course_id}, but a solution holds one section per course; plan is {plan_id:?}"
            ),
        }
    }
}

impl std::error::Error for StoreError {}

impl From<rusqlite::Error> for StoreError {
    fn from(err: rusqlite::Error) -> Self {
        StoreError::Sql(err)
    }
}

/// Migration 1: the SPEC §5 schema.
const MIGRATION_V1: &str = r#"
CREATE TABLE courses (
    campus_id  INTEGER NOT NULL,
    session_id INTEGER NOT NULL,
    course_id  INTEGER NOT NULL,
    code       TEXT    NOT NULL,
    title      TEXT    NOT NULL,
    PRIMARY KEY (campus_id, session_id, course_id)
) STRICT;

CREATE TABLE sections (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    campus_id     INTEGER NOT NULL,
    session_id    INTEGER NOT NULL,
    course_id     INTEGER NOT NULL,
    section_id    INTEGER NOT NULL,
    section_code  TEXT    NOT NULL,
    course_type   TEXT,
    credits       REAL,
    enroll_cap    INTEGER,
    first_seen_at TEXT    NOT NULL,
    last_seen_at  TEXT    NOT NULL,
    UNIQUE (campus_id, session_id, course_id, section_id),
    FOREIGN KEY (campus_id, session_id, course_id)
        REFERENCES courses (campus_id, session_id, course_id)
) STRICT;

CREATE TABLE schedule_blocks (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    section_fk INTEGER NOT NULL REFERENCES sections (id),
    day        TEXT    NOT NULL CHECK (day IN ('MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT')),
    start_min  INTEGER NOT NULL,
    end_min    INTEGER NOT NULL,
    location   TEXT,
    modality   TEXT CHECK (modality IN ('F2F', 'ONLINE') OR modality IS NULL),
    CHECK ((location IS NULL) = (modality = 'ONLINE') OR modality IS NULL)
) STRICT;

CREATE TABLE snapshots (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    section_fk  INTEGER NOT NULL REFERENCES sections (id),
    captured_at TEXT    NOT NULL,
    enrolled    INTEGER,
    teacher     TEXT,
    remark      TEXT
) STRICT;

CREATE TABLE plans (
    id         TEXT PRIMARY KEY,
    name       TEXT    NOT NULL,
    campus_id  INTEGER NOT NULL,
    session_id INTEGER NOT NULL,
    created_at TEXT    NOT NULL
) STRICT;

CREATE TABLE plan_sections (
    plan_id    TEXT    NOT NULL REFERENCES plans (id),
    section_fk INTEGER NOT NULL REFERENCES sections (id),
    pinned     INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
    PRIMARY KEY (plan_id, section_fk)
) STRICT;
"#;

/// Migration 2 (ticket 07): plans gain a sample-data marker so the seeded
/// "Explore with sample data" plan is distinguishable from a plan the
/// student captured themselves. Plans created before v2 default to `0`.
const MIGRATION_V2: &str = r#"
ALTER TABLE plans ADD COLUMN is_sample INTEGER NOT NULL DEFAULT 0 CHECK (is_sample IN (0, 1));
"#;

/// Migration 3 (ticket 16): plan membership gains a missing marker. Refresh
/// flags a plan section that no longer appears in its course's results —
/// never deletes it (ADR-0008). Memberships created before v3 default to
/// `0` (present).
const MIGRATION_V3: &str = r#"
ALTER TABLE plan_sections ADD COLUMN missing INTEGER NOT NULL DEFAULT 0 CHECK (missing IN (0, 1));
"#;

/// Migration 4 (ticket 17): sections gain their captured term span, so an
/// ICS export can recur each block across the section's start and end
/// dates. The dates arrive with every capture; rows from before this
/// migration stay NULL until their course is re-captured.
const MIGRATION_V4: &str = r#"
ALTER TABLE sections ADD COLUMN start_date TEXT;
ALTER TABLE sections ADD COLUMN end_date TEXT;
"#;

/// Migration 5 (ticket 27): legacy sample data leaves the real scope.
///
/// Databases written before ticket 27 seeded the fabricated captures under
/// the fixtures' real capture context — Manila / AY2026-27 T1 — where every
/// genuine plan in that scope read them out of the same catalog and the
/// capture counter counted them. This migration relocates what the seed
/// introduced into the reserved sample scope
/// ([`crate::core::options::SAMPLE_CAMPUS_ID`],
/// [`crate::core::options::SAMPLE_SESSION_ID`]):
///
/// - a course moves only when no non-sample plan claims any of its
///   sections; every section no non-sample plan claims then follows its
///   course. Courses relocate atomically, so a section's course is always
///   present in the scope the section points at;
/// - anything a student plan claims stays exactly where it is — dedupe can
///   have merged a real capture of GEARTAP or CSINTSY into the seeded rows,
///   and those rows are now genuine captures;
/// - the sample plan itself follows its data, so it renders as
///   "Sample Campus · Sample Term" instead of claiming Manila.
///
/// Nothing is deleted here or anywhere (ADR-0008). Residue of a seed whose
/// sample plan was already deleted carries no marker and stays put — it is
/// indistinguishable from a real capture by design of the old layout.
fn migration_v5() -> String {
    // The scope pre-ticket-27 builds seeded into: the fixtures' verified
    // capture context (SPEC §2). Restated here once, because they name
    // history — where old databases' rows sit — not current state.
    const LEGACY_CAMPUS_ID: i64 = 7;
    const LEGACY_SESSION_ID: i64 = 155;
    format!(
        r#"PRAGMA defer_foreign_keys = ON;

UPDATE courses SET campus_id = {sample_campus}, session_id = {sample_session}
WHERE campus_id = {legacy_campus} AND session_id = {legacy_session}
  AND NOT EXISTS (
      SELECT 1 FROM sections s
      JOIN plan_sections ps ON ps.section_fk = s.id
      JOIN plans p ON p.id = ps.plan_id
      WHERE s.campus_id = {legacy_campus} AND s.session_id = {legacy_session}
        AND s.course_id = courses.course_id
        AND p.id <> 'sample-plan'
  );

UPDATE sections SET campus_id = {sample_campus}, session_id = {sample_session}
WHERE campus_id = {legacy_campus} AND session_id = {legacy_session}
  AND id NOT IN (
      SELECT ps.section_fk FROM plan_sections ps
      JOIN plans p ON p.id = ps.plan_id
      WHERE p.id <> 'sample-plan'
  )
  AND course_id IN (
      SELECT c2.course_id FROM courses c2
      WHERE c2.campus_id = {sample_campus} AND c2.session_id = {sample_session}
  );

UPDATE plans SET campus_id = {sample_campus}, session_id = {sample_session}
WHERE id = 'sample-plan' AND is_sample = 1
  AND campus_id = {legacy_campus} AND session_id = {legacy_session};
"#,
        sample_campus = crate::core::options::SAMPLE_CAMPUS_ID,
        sample_session = crate::core::options::SAMPLE_SESSION_ID,
        legacy_campus = LEGACY_CAMPUS_ID,
        legacy_session = LEGACY_SESSION_ID,
    )
}

/// Migration 7: a captured course says whether the student intends to take
/// it, and whether a refresh has ever re-read it.
///
/// The solver filled every captured course in scope, so searching forty
/// courses to browse them produced a solve that insisted on scheduling all
/// forty. `included` separates the search from the intent. Courses captured
/// before this migration default to `1`: they were the only behaviour there
/// was, and silently dropping them out of the solve would empty a plan the
/// student had already built.
///
/// `last_refreshed_at` is NULL until a refresh writes the course. Both a
/// capture and a refresh advance `last_seen_at`, so it alone cannot say
/// which act produced the numbers on screen.
const MIGRATION_V7: &str = r#"
ALTER TABLE courses ADD COLUMN included INTEGER NOT NULL DEFAULT 1 CHECK (included IN (0, 1));
ALTER TABLE courses ADD COLUMN last_refreshed_at TEXT;
"#;

/// Migration 8 (ticket 47): teacher preferences — a normalized teacher
/// identity, a table of per-course preferences, and the IPC to read and
/// write them.
///
/// One row per `(campus_id, session_id, course_id, teacher_key)` carrying
/// either a rank or an avoid, never both (enforced by CHECK). The display
/// name is stored on the row so the student sees the name they ranked even
/// if the snapshot it came from is later superseded.
///
/// No foreign key to `courses`: `forget_course` deletes the course row
/// outright, and a preference must survive that — a dangling scope tuple is
/// the intended state, not a bug.
const MIGRATION_V8: &str = r#"
CREATE TABLE teacher_preferences (
    campus_id    INTEGER NOT NULL,
    session_id   INTEGER NOT NULL,
    course_id    INTEGER NOT NULL,
    teacher_key  TEXT    NOT NULL,
    display_name TEXT    NOT NULL,
    rank         INTEGER,
    avoid        INTEGER NOT NULL DEFAULT 0 CHECK (avoid IN (0, 1)),
    CHECK ((rank IS NULL) = (avoid = 1)),
    PRIMARY KEY (campus_id, session_id, course_id, teacher_key)
) STRICT;
"#;

fn migrations() -> Vec<String> {
    vec![
        MIGRATION_V1.to_string(),
        MIGRATION_V2.to_string(),
        MIGRATION_V3.to_string(),
        MIGRATION_V4.to_string(),
        migration_v5(),
        migration_v6(),
        MIGRATION_V7.to_string(),
        MIGRATION_V8.to_string(),
    ]
}

/// Migration 6: the sample-data feature is gone, so its rows go with it.
///
/// The seed is no longer offered and can never be created again, but a
/// database written before its removal still holds the seeded plan and the
/// fabricated catalog behind it. Left in place they would sit in the plan
/// list forever with no way to explain them — the confusion the feature was
/// removed for.
///
/// This only ever touches the reserved sample scope
/// ([`crate::core::options::SAMPLE_CAMPUS_ID`],
/// [`crate::core::options::SAMPLE_SESSION_ID`]), which migration 5
/// established as isolated from every real scope, plus plans flagged
/// `is_sample`. **Nothing a student captured is in reach**: a real capture
/// lives under an offered campus and session, and plan creation has always
/// refused the reserved ids.
///
/// `is_sample` itself stays on the table. Migrations are history, and a
/// column an older migration added is not removed because a later one
/// stopped using it.
fn migration_v6() -> String {
    format!(
        r#"
DELETE FROM plan_sections
 WHERE plan_id IN (SELECT id FROM plans WHERE is_sample = 1)
    OR section_fk IN (
        SELECT id FROM sections
         WHERE campus_id = {sample_campus} AND session_id = {sample_session}
    );

DELETE FROM plans WHERE is_sample = 1;

DELETE FROM snapshots
 WHERE section_fk IN (
     SELECT id FROM sections
      WHERE campus_id = {sample_campus} AND session_id = {sample_session}
 );

DELETE FROM schedule_blocks
 WHERE section_fk IN (
     SELECT id FROM sections
      WHERE campus_id = {sample_campus} AND session_id = {sample_session}
 );

DELETE FROM sections
 WHERE campus_id = {sample_campus} AND session_id = {sample_session};

DELETE FROM courses
 WHERE campus_id = {sample_campus} AND session_id = {sample_session};
"#,
        sample_campus = crate::core::options::SAMPLE_CAMPUS_ID,
        sample_session = crate::core::options::SAMPLE_SESSION_ID,
    )
}

/// Runs every migration not yet applied, tracked by `PRAGMA user_version`.
/// Idempotent: safe to run on a fresh database and on an existing one.
pub fn migrate(conn: &Connection) -> Result<(), StoreError> {
    let migrations = migrations();
    let version: i64 = conn.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    for (index, migration) in migrations.iter().enumerate() {
        let target = (index + 1) as i64;
        if version >= target {
            continue;
        }
        let tx = conn.unchecked_transaction()?;
        tx.execute_batch(migration)?;
        tx.pragma_update(None, "user_version", target)?;
        tx.commit()?;
    }
    Ok(())
}

/// Owns the connection and all write paths. No section row is ever removed
/// by a capture; see `record_capture` and `add_section_to_plan`. The one
/// deliberate removal path is `forget_course`, where the student names the
/// course to remove.
pub struct Store {
    /// Crate-visible so adapter modules and their tests can inspect rows;
    /// all writes go through `Store` methods.
    pub(crate) conn: Connection,
}

/// Shared handle to the store: the loopback capture listener and the Tauri
/// commands both touch the same connection, serialized one call at a time.
pub type StoreHandle = Arc<Mutex<Store>>;

fn day_to_db(day: Day) -> &'static str {
    match day {
        Day::Mon => "MON",
        Day::Tue => "TUE",
        Day::Wed => "WED",
        Day::Thu => "THU",
        Day::Fri => "FRI",
        Day::Sat => "SAT",
    }
}

/// Inverse of [`day_to_db`]; the schema CHECK constrains the stored values.
fn day_from_db(day: &str) -> Day {
    match day {
        "MON" => Day::Mon,
        "TUE" => Day::Tue,
        "WED" => Day::Wed,
        "THU" => Day::Thu,
        "FRI" => Day::Fri,
        "SAT" => Day::Sat,
        other => unreachable!("day column is constrained to MON..SAT, got {other:?}"),
    }
}

/// A term date stored as `YYYY-MM-DD`, or NULL when the capture had none.
fn date_to_db(date: Option<NaiveDate>) -> Option<String> {
    date.map(|date| date.format("%Y-%m-%d").to_string())
}

/// Inverse of [`date_to_db`]; `None` when unset.
fn date_from_db(raw: Option<String>) -> Option<NaiveDate> {
    raw.and_then(|raw| NaiveDate::parse_from_str(raw.trim(), "%Y-%m-%d").ok())
}

/// The `(campus, session)` a plan is hard-scoped to, or `PlanNotFound`.
fn plan_scope(conn: &Connection, plan_id: &str) -> Result<(i64, i64), StoreError> {
    conn.query_row(
        "SELECT campus_id, session_id FROM plans WHERE id = ?1",
        [plan_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )
    .optional()?
    .ok_or_else(|| StoreError::PlanNotFound {
        plan_id: plan_id.to_string(),
    })
}

/// The `sections.id` of the section captured under the plan's scope, or
/// `None` when no such section exists (captured elsewhere or never).
fn scoped_section_fk(
    conn: &Connection,
    plan_campus_id: i64,
    plan_session_id: i64,
    course_id: i64,
    section_id: i64,
) -> Result<Option<i64>, StoreError> {
    Ok(conn
        .query_row(
            "SELECT id FROM sections
             WHERE campus_id = ?1 AND session_id = ?2 AND course_id = ?3 AND section_id = ?4",
            rusqlite::params![plan_campus_id, plan_session_id, course_id, section_id],
            |row| row.get::<_, i64>(0),
        )
        .optional()?)
}

impl Store {
    pub fn open(path: &Path) -> Result<Self, StoreError> {
        let conn = Connection::open(path)?;
        conn.pragma_update(None, "foreign_keys", true)?;
        migrate(&conn)?;
        Ok(Self {
            conn,
        })
    }

    pub fn open_in_memory() -> Result<Self, StoreError> {
        let conn = Connection::open_in_memory()?;
        conn.pragma_update(None, "foreign_keys", true)?;
        migrate(&conn)?;
        Ok(Self {
            conn,
        })
    }

    /// Records one parsed result set: upserts the course and each section,
    /// replaces each section's schedule blocks, and appends one snapshot
    /// per section. Capturing the same course twice yields the same section
    /// rows with `last_seen_at` advanced and one more snapshot per section.
    ///
    /// Sections not present in this capture are never touched, let alone
    /// deleted (ADR-0008); ticket 16 surfaces them.
    ///
    pub fn record_capture(
        &mut self,
        scope: &CaptureScope,
        sections: &[ParsedSection],
        captured_at: &str,
    ) -> Result<(), StoreError> {
        let tx = self.conn.transaction()?;
        for section in sections {
            upsert_course(&tx, scope, section)?;
            let (section_fk, _, _) = upsert_section(&tx, scope, section, captured_at)?;
            replace_blocks(&tx, section_fk, section)?;
            append_snapshot(&tx, section_fk, section, captured_at)?;
        }
        tx.commit()?;
        Ok(())
    }

    /// Removes one captured course — the course row and every section,
    /// schedule block, and snapshot it owns, under exactly one
    /// `(campus, session)` (ticket 29). The student names one course, and only
    /// what they named is removed. ADR-0008 is untouched — that rule bars capture-side
    /// inference deletes; this is a direct user instruction.
    ///
    /// Plans holding the course's sections are released instead of blocking
    /// (ticket 35): each membership goes with the sections it points at, and
    /// the outcome reports every affected plan and how many sections it
    /// lost, so the student's agreement is followed by an explanation, not
    /// by silent gutting. Pinning protects a section from the solver, not
    /// from a removal the student asked for.
    ///
    /// The whole removal is one transaction, and a pending undo batch whose
    /// rows went away is dropped rather than left dangling. Returns a
    /// [`ForgetCourseOutcome`]: the updated [`CaptureSummary`] so the
    /// counter re-renders from one source of truth, plus the affected-plan
    /// Marks whether the student intends to enrol in a captured course.
    ///
    /// Excluding is not forgetting (ADR-0008 and ticket 29 own that): the
    /// course keeps its sections, its snapshots, and its place in the
    /// catalog. It simply stops being a course the solver has to satisfy,
    /// which is what makes capturing forty courses to browse them survivable.
    ///
    /// Loud rather than a silent no-op when the course is not in this scope,
    /// matching `forget_course`.
    pub fn set_course_included(
        &mut self,
        scope: &CaptureScope,
        course_id: i64,
        included: bool,
    ) -> Result<(), StoreError> {
        let changed = self.conn.execute(
            "UPDATE courses SET included = ?4
             WHERE campus_id = ?1 AND session_id = ?2 AND course_id = ?3",
            rusqlite::params![
                scope.campus_id,
                scope.session_id,
                course_id,
                i64::from(included)
            ],
        )?;

        if changed == 0 {
            return Err(StoreError::CourseNotFound {
                campus_id: scope.campus_id,
                session_id: scope.session_id,
                course_id,
            });
        }

        Ok(())
    }


    /// report.
    pub fn forget_course(
        &mut self,
        scope: &CaptureScope,
        course_id: i64,
    ) -> Result<ForgetCourseOutcome, StoreError> {
        // The section row ids this removal will take, collected up front so
        // the membership release and the journal check agree on the same set.
        let section_fks: Vec<i64> = {
            let mut stmt = self.conn.prepare(
                "SELECT id FROM sections
                 WHERE campus_id = ?1 AND session_id = ?2 AND course_id = ?3",
            )?;
            let rows = stmt.query_map(
                rusqlite::params![scope.campus_id, scope.session_id, course_id],
                |row| row.get::<_, i64>(0),
            )?;
            rows.collect::<Result<Vec<i64>, _>>()?
        };

        // Loud rather than a silent no-op when nothing under this scope
        // matches — consistent with delete_plan, unlike the deliberately
        // idempotent remove_section_from_plan.
        let course_exists: bool = self.conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM courses
             WHERE campus_id = ?1 AND session_id = ?2 AND course_id = ?3)",
            rusqlite::params![scope.campus_id, scope.session_id, course_id],
            |row| row.get(0),
        )?;
        if !course_exists && section_fks.is_empty() {
            return Err(StoreError::CourseNotFound {
                campus_id: scope.campus_id,
                session_id: scope.session_id,
                course_id,
            });
        }

        // One transaction: the membership release first (the section rows
        // cannot go while a plan_sections row points at them), then the
        // sections' children, then the sections, then the course row. Any
        // failure part-way rolls the whole removal back.
        let tx = self.conn.transaction()?;
        let affected_plans: Vec<AffectedPlan> = {
            let mut stmt = tx.prepare(
                "SELECT ps.plan_id, COUNT(*)
                 FROM plan_sections ps
                 JOIN sections s ON s.id = ps.section_fk
                 WHERE s.campus_id = ?1 AND s.session_id = ?2 AND s.course_id = ?3
                 GROUP BY ps.plan_id
                 ORDER BY ps.plan_id",
            )?;
            let rows = stmt.query_map(
                rusqlite::params![scope.campus_id, scope.session_id, course_id],
                |row| {
                    Ok(AffectedPlan {
                        plan_id: row.get(0)?,
                        removed_sections: row.get(1)?,
                    })
                },
            )?;
            rows.collect::<Result<Vec<AffectedPlan>, _>>()?
        };
        tx.execute(
            "DELETE FROM plan_sections
             WHERE section_fk IN (SELECT id FROM sections
                                  WHERE campus_id = ?1 AND session_id = ?2 AND course_id = ?3)",
            rusqlite::params![scope.campus_id, scope.session_id, course_id],
        )?;
        for &section_fk in &section_fks {
            tx.execute("DELETE FROM snapshots WHERE section_fk = ?1", [section_fk])?;
            tx.execute("DELETE FROM schedule_blocks WHERE section_fk = ?1", [section_fk])?;
        }
        tx.execute(
            "DELETE FROM sections WHERE campus_id = ?1 AND session_id = ?2 AND course_id = ?3",
            rusqlite::params![scope.campus_id, scope.session_id, course_id],
        )?;
        tx.execute(
            "DELETE FROM courses WHERE campus_id = ?1 AND session_id = ?2 AND course_id = ?3",
            rusqlite::params![scope.campus_id, scope.session_id, course_id],
        )?;
        tx.commit()?;

        Ok(ForgetCourseOutcome {
            summary: self.capture_summary(scope)?,
            affected_plans,
        })
    }

    /// Running counts for the capture counter: sections and distinct
    /// courses captured under the given `(campus, session)`, plus whether
    /// a batch is available to undo.
    pub fn capture_summary(&self, scope: &CaptureScope) -> Result<CaptureSummary, StoreError> {
        let section_count: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM sections WHERE campus_id = ?1 AND session_id = ?2",
            rusqlite::params![scope.campus_id, scope.session_id],
            |row| row.get(0),
        )?;
        let course_count: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM courses WHERE campus_id = ?1 AND session_id = ?2",
            rusqlite::params![scope.campus_id, scope.session_id],
            |row| row.get(0),
        )?;
        Ok(CaptureSummary {
            campus_id: scope.campus_id,
            session_id: scope.session_id,
            section_count,
            course_count,
        })
    }

    pub fn create_plan(
        &mut self,
        id: &str,
        name: &str,
        scope: &CaptureScope,
        created_at: &str,
    ) -> Result<(), StoreError> {
        let tx = self.conn.transaction()?;
        insert_plan_tx(&tx, id, name, scope, created_at)?;
        tx.commit()?;
        Ok(())
    }

    /// Every saved plan row with its section count, in creation order
    /// (created_at, then id). The sample plan is listed like any other.
    pub fn list_plans(&self) -> Result<Vec<PlanSummaryRow>, StoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT p.id FROM plans p
             ORDER BY p.created_at, p.id",
        )?;
        let ids = stmt
            .query_map([], |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<String>, _>>()?;
        ids.iter().map(|id| plan_summary_row(&self.conn, id)).collect()
    }

    /// One plan and all its members as the UI renders them: each member
    /// carries its schedule blocks, derived per-block modality, the values
    /// of its latest snapshot, and its pinned / missing flags. Members come
    /// back in `(course_id, section_id)` order.
    pub fn get_plan(&self, plan_id: &str) -> Result<PlanDetail, StoreError> {
        let summary = plan_summary_row(&self.conn, plan_id)?;
        let mut stmt = self.conn.prepare(
            "SELECT ps.section_fk, ps.pinned, ps.missing
             FROM plan_sections ps
             JOIN sections s ON s.id = ps.section_fk
             WHERE ps.plan_id = ?1
             ORDER BY s.course_id, s.section_id",
        )?;
        let rows = stmt.query_map([plan_id], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, i64>(1)? != 0,
                row.get::<_, i64>(2)? != 0,
            ))
        })?;
        let mut sections = Vec::new();
        for row in rows {
            let (section_fk, pinned, missing) = row?;
            sections.push(plan_section_view(
                section_view(&self.conn, section_fk)?,
                pinned,
                missing,
            ));
        }
        Ok(PlanDetail { summary, sections })
    }

    /// Deletes a plan: its row and its membership rows, and nothing else.
    /// Captured section rows, blocks, and snapshots survive — deleting a
    /// plan is never a section delete (ADR-0008). The sample plan deletes
    /// like any other plan.
    pub fn delete_plan(&mut self, plan_id: &str) -> Result<(), StoreError> {
        let tx = self.conn.transaction()?;
        // Fails loudly when the plan does not exist rather than silently
        // deleting nothing.
        plan_scope(&tx, plan_id)?;
        tx.execute("DELETE FROM plan_sections WHERE plan_id = ?1", [plan_id])?;
        tx.execute("DELETE FROM plans WHERE id = ?1", [plan_id])?;
        tx.commit()?;
        Ok(())
    }

    /// The distinct courses captured under one `(campus, session)`, each
    /// with how many sections it has and when it was first and last seen,
    /// ordered by course code. Another term's rows never leak in.
    pub fn captured_courses(&self, scope: &CaptureScope) -> Result<Vec<CapturedCourse>, StoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT c.course_id, c.code, c.title,
                    COUNT(s.id), MIN(s.first_seen_at), MAX(s.last_seen_at),
                    c.included, c.last_refreshed_at
             FROM courses c
             JOIN sections s ON s.campus_id = c.campus_id AND s.session_id = c.session_id
                           AND s.course_id = c.course_id
             WHERE c.campus_id = ?1 AND c.session_id = ?2
             GROUP BY c.course_id, c.code, c.title
             ORDER BY c.code, c.course_id",
        )?;
        let rows = stmt.query_map(
            rusqlite::params![scope.campus_id, scope.session_id],
            |row| {
                Ok(CapturedCourse {
                    course_id: row.get(0)?,
                    code: row.get(1)?,
                    title: row.get(2)?,
                    section_count: row.get(3)?,
                    first_seen_at: row.get(4)?,
                    last_seen_at: row.get(5)?,
                    included: row.get::<_, i64>(6)? != 0,
                    last_refreshed_at: row.get(7)?,
                })
            },
        )?;
        rows.collect::<Result<Vec<_>, _>>().map_err(StoreError::from)
    }

    /// Every captured section of one course under a `(campus, session)`:
    /// blocks, derived modality, room, and the latest snapshot's teacher,
    /// enrolment, and remark. A blank teacher arrives as `None` (unknown),
    /// and `remark` verbatim. Scoped exactly like [`Store::captured_courses`].
    pub fn captured_sections(
        &self,
        scope: &CaptureScope,
        course_id: i64,
    ) -> Result<Vec<Section>, StoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT id FROM sections
             WHERE campus_id = ?1 AND session_id = ?2 AND course_id = ?3
             ORDER BY section_id",
        )?;
        let rows = stmt.query_map(
            rusqlite::params![scope.campus_id, scope.session_id, course_id],
            |row| row.get::<_, i64>(0),
        )?;
        let section_fks = rows.collect::<Result<Vec<i64>, _>>()?;
        section_fks
            .iter()
            .map(|section_fk| section_view(&self.conn, *section_fk))
            .collect()
    }

    /// Applies the solver's answer by **reconciling** the plan to it
    /// (ticket 42): pinned members are untouched, an unpinned member whose
    /// course the solution filled with a different section is removed, and
    /// every solution section lands as an ordinary unpinned member. One
    /// transaction — either the whole reconciliation lands or nothing does.
    /// Membership is never duplicated for a solution course, and a solution
    /// that would override a pinned member of another section is refused.
    /// Courses the solution does not mention are not the solve's to touch.
    /// Conflict is never enforced here (ADR-0009).
    pub fn apply_solution(
        &mut self,
        plan_id: &str,
        sections: &[crate::core::ipc_types::SectionRef],
    ) -> Result<(), StoreError> {
        let tx = self.conn.transaction()?;
        // Loud even for an empty list, so an unknown plan can never look
        // like a successful no-op apply.
        plan_scope(&tx, plan_id)?;

        // Resolve every solution section against the plan's scope first:
        // any rejection happens before a single membership row moves.
        let mut resolved: Vec<(i64, i64, i64)> = Vec::new();
        for reference in sections {
            let section_fk =
                resolve_scoped_section_tx(&tx, plan_id, reference.course_id, reference.section_id)?;
            resolved.push((reference.course_id, section_fk, reference.section_id));
        }

        // A solution holds one section per course by definition; a caller
        // naming two for the same course is malformed, and applying it
        // would write duplicate course membership.
        let mut seen_courses: HashSet<i64> = HashSet::new();
        for &(course_id, _, _) in &resolved {
            if !seen_courses.insert(course_id) {
                return Err(StoreError::SolutionSplitsCourse {
                    plan_id: plan_id.to_string(),
                    course_id,
                });
            }
        }

        // A real solve carries every pinned member as chosen; a solution
        // naming a different section of a pinned course cannot be one.
        for &(course_id, section_fk, section_id) in &resolved {
            let pinned: Option<(i64, i64)> = tx
                .query_row(
                    "SELECT ps.section_fk, s.section_id
                     FROM plan_sections ps
                     JOIN sections s ON s.id = ps.section_fk
                     WHERE ps.plan_id = ?1 AND ps.pinned != 0 AND s.course_id = ?2",
                    rusqlite::params![plan_id, course_id],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .optional()?;
            if let Some((pinned_fk, pinned_section_id)) = pinned {
                if pinned_fk != section_fk {
                    return Err(StoreError::SolutionOverridesPinned {
                        plan_id: plan_id.to_string(),
                        course_id,
                        pinned_section_id,
                        solution_section_id: section_id,
                    });
                }
            }
        }

        // Reconcile each solution course's membership: unpinned members the
        // solution replaced are gone; surviving rows keep their pin state.
        // A BTreeMap keeps the per-course walk in a deterministic order.
        let mut keeps: BTreeMap<i64, HashSet<i64>> = BTreeMap::new();
        for &(course_id, section_fk, _) in &resolved {
            keeps.entry(course_id).or_default().insert(section_fk);
        }
        for (course_id, keep) in &keeps {
            let mut stmt = tx.prepare(
                "SELECT ps.section_fk FROM plan_sections ps
                 JOIN sections s ON s.id = ps.section_fk
                 WHERE ps.plan_id = ?1 AND ps.pinned = 0 AND s.course_id = ?2",
            )?;
            let members = stmt
                .query_map(rusqlite::params![plan_id, course_id], |row| row.get::<_, i64>(0))?
                .collect::<Result<Vec<i64>, _>>()?;
            drop(stmt);
            for member_fk in members {
                if !keep.contains(&member_fk) {
                    // Plan-membership removal is never a hard delete (ADR-0008).
                    tx.execute(
                        "DELETE FROM plan_sections WHERE plan_id = ?1 AND section_fk = ?2",
                        rusqlite::params![plan_id, member_fk],
                    )?;
                }
            }
        }

        // Add what the solution brings that membership lacks. The insert is
        // a no-op for rows that survived reconciliation, so their pin state
        // is never rewritten.
        for &(_, section_fk, _) in &resolved {
            tx.execute(
                "INSERT INTO plan_sections (plan_id, section_fk, pinned) VALUES (?1, ?2, 0)
                 ON CONFLICT (plan_id, section_fk) DO NOTHING",
                rusqlite::params![plan_id, section_fk],
            )?;
        }

        tx.commit()?;
        Ok(())
    }

    /// The plan's members as solver input (ticket 14): identity, codes,
    /// schedule blocks, and the pin state the solve obeys (ticket 42).
    /// Only members are returned; the solve fills everything else around
    /// them.
    pub fn plan_fixed_sections(&self, plan_id: &str) -> Result<Vec<FixedSection>, StoreError> {
        plan_scope(&self.conn, plan_id)?;
        let mut stmt = self.conn.prepare(
            "SELECT s.id, s.course_id, c.code, s.section_id, s.section_code, ps.pinned
             FROM plan_sections ps
             JOIN sections s ON s.id = ps.section_fk
             JOIN courses c ON c.campus_id = s.campus_id AND c.session_id = s.session_id
                           AND c.course_id = s.course_id
             WHERE ps.plan_id = ?1
             ORDER BY s.course_id, s.section_id",
        )?;
        let rows = stmt.query_map([plan_id], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, i64>(5)? != 0,
            ))
        })?;
        let mut fixed = Vec::new();
        for row in rows {
            let (section_fk, course_id, course_code, section_id, section_code, pinned) = row?;
            fixed.push(FixedSection {
                course_id,
                course_code,
                section_id,
                section_code,
                blocks: read_wire_blocks(&self.conn, section_fk)?,
                pinned,
                teacher: None, // teacher is read from snapshots, not the plan
            });
        }
        Ok(fixed)
    }

    /// Every captured course under the scope as solver candidate input:
    /// all captured sections with their blocks and the live numbers the
    /// exclude-full constraint needs. Unknown values stay `None` — never a
    /// fabricated zero that could read as full or empty.
    pub fn solver_courses(&self, scope: &CaptureScope) -> Result<Vec<SolverCourse>, StoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT s.id, s.course_id, c.code
             FROM courses c
             JOIN sections s ON s.campus_id = c.campus_id AND s.session_id = c.session_id
                           AND s.course_id = c.course_id
             WHERE c.campus_id = ?1 AND c.session_id = ?2 AND c.included = 1
             ORDER BY c.course_id, s.section_id",
        )?;
        let rows = stmt.query_map(
            rusqlite::params![scope.campus_id, scope.session_id],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?, row.get::<_, String>(2)?)),
        )?;
        let mut catalog: Vec<SolverCourse> = Vec::new();
        for row in rows {
            let (section_fk, course_id, code) = row?;
            let section = solver_section_view(&self.conn, section_fk)?;
            match catalog.last_mut() {
                Some(last) if last.course_id == course_id => last.sections.push(section),
                _ => catalog.push(SolverCourse {
                    course_id,
                    code,
                    sections: vec![section],
                }),
            }
        }
        Ok(catalog)
    }

    /// The freshest snapshot timestamp under a `(campus, session)` scope,
    /// or `None` when nothing is captured there (ticket 34). The solve
    /// result carries it so the student can judge how old the enrolment
    /// numbers behind an exclusion are. Timestamps are ISO 8601 UTC, so the
    /// lexicographic maximum is the chronological one.
    pub fn latest_snapshot_at(&self, scope: &CaptureScope) -> Result<Option<String>, StoreError> {
        self.conn
            .query_row(
                "SELECT MAX(sn.captured_at) FROM snapshots sn
                 JOIN sections s ON s.id = sn.section_fk
                 WHERE s.campus_id = ?1 AND s.session_id = ?2",
                rusqlite::params![scope.campus_id, scope.session_id],
                |row| row.get(0),
            )
            .map_err(StoreError::from)
    }

    /// Links a captured section into a plan. The lookup is scoped to the
    /// plan's `(campus, session)`, so a section captured under any other
    /// scope is rejected here — the constraint is never left to the UI.
    pub fn add_section_to_plan(
        &mut self,
        plan_id: &str,
        course_id: i64,
        section_id: i64,
    ) -> Result<(), StoreError> {
        let tx = self.conn.transaction()?;
        add_section_tx(&tx, plan_id, course_id, section_id)?;
        tx.commit()?;
        Ok(())
    }

    /// Removes a section's membership in a plan. The captured section row
    /// itself is untouched — plan membership removal is not a hard delete
    /// (ADR-0008). Idempotent: removing a section that is not a member
    /// succeeds and changes nothing.
    pub fn remove_section_from_plan(
        &mut self,
        plan_id: &str,
        course_id: i64,
        section_id: i64,
    ) -> Result<(), StoreError> {
        let (plan_campus, plan_session) = plan_scope(&self.conn, plan_id)?;
        if let Some(section_fk) = scoped_section_fk(
            &self.conn,
            plan_campus,
            plan_session,
            course_id,
            section_id,
        )? {
            self.conn.execute(
                "DELETE FROM plan_sections WHERE plan_id = ?1 AND section_fk = ?2",
                rusqlite::params![plan_id, section_fk],
            )?;
        }
        Ok(())
    }

    /// Pins or unpins a section that is already a member of the plan. A pin
    /// request for a non-member fails loudly: silently ignoring it would let
    /// pinned state silently fail to persist.
    pub fn set_section_pinned(
        &mut self,
        plan_id: &str,
        course_id: i64,
        section_id: i64,
        pinned: bool,
    ) -> Result<(), StoreError> {
        let (plan_campus, plan_session) = plan_scope(&self.conn, plan_id)?;
        let Some(section_fk) = scoped_section_fk(
            &self.conn,
            plan_campus,
            plan_session,
            course_id,
            section_id,
        )? else {
            return Err(StoreError::SectionNotInPlan {
                plan_id: plan_id.to_string(),
                course_id,
                section_id,
            });
        };
        let updated = self.conn.execute(
            "UPDATE plan_sections SET pinned = ?3 WHERE plan_id = ?1 AND section_fk = ?2",
            rusqlite::params![plan_id, section_fk, pinned],
        )?;
        if updated == 0 {
            return Err(StoreError::SectionNotInPlan {
                plan_id: plan_id.to_string(),
                course_id,
                section_id,
            });
        }
        Ok(())
    }

    /// Returns every overlapping block pair among the plan's members: which
    /// two sections clash, on which day, over which time range. Conflict is
    /// a query over a plan, never a constraint on membership (ADR-0009), and
    /// detection runs per block (ADR-0007), so a hybrid section conflicts
    /// only on the day that actually overlaps.
    pub fn conflicts_in_plan(&self, plan_id: &str) -> Result<Vec<Conflict>, StoreError> {
        let _ = plan_scope(&self.conn, plan_id)?;
        let mut stmt = self.conn.prepare(
            "SELECT s.course_id, s.section_id, b.day, b.start_min, b.end_min
             FROM plan_sections ps
             JOIN sections s ON s.id = ps.section_fk
             JOIN schedule_blocks b ON b.section_fk = ps.section_fk
             WHERE ps.plan_id = ?1
             ORDER BY s.course_id, s.section_id, b.id",
        )?;
        let rows = stmt.query_map([plan_id], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, i64>(4)?,
            ))
        })?;

        // Rows arrive grouped by section; fold each run into one member.
        let mut members: Vec<PlannedSection> = Vec::new();
        for row in rows {
            let (course_id, section_id, day, start_min, end_min) = row?;
            let block = PlannedBlock {
                day: day_from_db(&day),
                start_min,
                end_min,
            };
            match members.last_mut() {
                Some(last) if last.course_id == course_id && last.section_id == section_id => {
                    last.blocks.push(block);
                }
                _ => members.push(PlannedSection {
                    course_id,
                    section_id,
                    blocks: vec![block],
                }),
            }
        }
        Ok(conflicts::find_conflicts(&members))
    }

    /// Loads everything the ICS exporter needs about one plan (ticket 17):
    /// the plan name and every member section with its blocks, term dates,
    /// and the teacher/remark of the latest snapshot.
    ///
    /// A member without captured term dates is a loud
    /// [`StoreError::SectionDatesMissing`], never a silent skip: exporting
    /// would otherwise drop that section's classes without a trace.
    pub fn load_plan_ics_export(&self, plan_id: &str) -> Result<ExportPlan, StoreError> {
        let plan_name: String = self
            .conn
            .query_row(
                "SELECT name FROM plans WHERE id = ?1",
                [plan_id],
                |row| row.get(0),
            )
            .optional()?
            .ok_or_else(|| StoreError::PlanNotFound {
                plan_id: plan_id.to_string(),
            })?;

        let mut stmt = self.conn.prepare(
            "SELECT s.id, s.course_id, s.section_id, c.code, s.section_code,
                    sn.teacher, sn.remark, s.start_date, s.end_date
             FROM plan_sections ps
             JOIN sections s ON s.id = ps.section_fk
             JOIN courses c ON c.campus_id = s.campus_id AND c.session_id = s.session_id
                           AND c.course_id = s.course_id
             LEFT JOIN snapshots sn ON sn.id = (
                     SELECT id FROM snapshots WHERE section_fk = s.id ORDER BY id DESC LIMIT 1)
             WHERE ps.plan_id = ?1
             ORDER BY s.course_id, s.section_id",
        )?;
        let rows = stmt.query_map([plan_id], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, Option<String>>(5)?,
                row.get::<_, Option<String>>(6)?,
                row.get::<_, Option<String>>(7)?,
                row.get::<_, Option<String>>(8)?,
            ))
        })?;

        let mut sections = Vec::new();
        for row in rows {
            let (
                row_id,
                course_id,
                section_id,
                course_code,
                section_code,
                teacher,
                remark,
                start_date,
                end_date,
            ) = row?;
            let Some(start_date) = date_from_db(start_date) else {
                return Err(StoreError::SectionDatesMissing {
                    course_id,
                    section_id,
                });
            };
            let Some(end_date) = date_from_db(end_date) else {
                return Err(StoreError::SectionDatesMissing {
                    course_id,
                    section_id,
                });
            };
            sections.push(ExportSection {
                course_id,
                section_id,
                course_code,
                section_code,
                teacher,
                remark,
                start_date,
                end_date,
                blocks: self.load_blocks_for_export(row_id)?,
            });
        }

        Ok(ExportPlan {
            name: plan_name,
            sections,
        })
    }

    /// A member's blocks as exported: `location` is `None` exactly for the
    /// online blocks, per the storage invariant.
    fn load_blocks_for_export(&self, section_row_id: i64) -> Result<Vec<ExportBlock>, StoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT day, start_min, end_min, location
             FROM schedule_blocks WHERE section_fk = ?1
             ORDER BY day, start_min, id",
        )?;
        let rows = stmt.query_map([section_row_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, Option<String>>(3)?,
            ))
        })?;
        rows.map(|row| {
            let (day, start_min, end_min, location) = row?;
            Ok(ExportBlock {
                day: day_from_db(&day),
                start_min,
                end_min,
                location,
            })
        })
        .collect()
    }
    /// The courses a refresh must re-run, ordered by course id: **every course
    /// captured under the plan's scope**, each carrying the plan's section ids
    /// for that course so missing sections can be detected.
    ///
    /// Refreshing only the courses already chosen left every candidate in the
    /// picker showing whatever enrolment number it happened to be captured
    /// with — and those are exactly the numbers a student is comparing before
    /// choosing, and the ones exclude-full solves against. A course with no
    /// plan membership simply carries no section ids, so there is nothing of
    /// it to flag missing (ADR-0008).
    ///
    /// This still never walks the catalog: it re-runs only what the student
    /// already searched for, inside the one `(campus, session)` the plan is
    /// hard-scoped to.
    ///
    /// Courses already in the plan come first. A run can halt part-way on an
    /// expired session and keep its partial result (SPEC §4), so the numbers
    /// the student has actually committed to are the ones that land before a
    /// halt can take the rest.
    pub fn refresh_courses(&self, plan_id: &str) -> Result<Vec<RefreshCourse>, StoreError> {
        let (campus_id, session_id) = plan_scope(&self.conn, plan_id)?;
        let mut stmt = self.conn.prepare(
            "SELECT c.course_id, c.code, member.section_id
             FROM courses c
             LEFT JOIN (
                 SELECT s.campus_id, s.session_id, s.course_id, s.section_id
                 FROM plan_sections ps
                 JOIN sections s ON s.id = ps.section_fk
                 WHERE ps.plan_id = ?1
             ) AS member
                 ON member.campus_id = c.campus_id
                 AND member.session_id = c.session_id
                 AND member.course_id = c.course_id
             WHERE c.campus_id = ?2 AND c.session_id = ?3
             ORDER BY (member.section_id IS NULL), c.course_id, member.section_id",
        )?;
        let rows = stmt.query_map(rusqlite::params![plan_id, campus_id, session_id], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<i64>>(2)?,
            ))
        })?;
        let mut courses: Vec<RefreshCourse> = Vec::new();
        for row in rows {
            let (course_id, code, section_id) = row?;
            match courses.last_mut() {
                Some(last) if last.course_id == course_id => {
                    if let Some(section_id) = section_id {
                        last.plan_section_ids.push(section_id);
                    }
                }
                _ => courses.push(RefreshCourse {
                    course_id,
                    code,
                    plan_section_ids: section_id.into_iter().collect(),
                }),
            }
        }
        Ok(courses)
    }

    /// The `(campus, session)` a plan is hard-scoped to — the scope a
    /// refresh run is routed by (ticket 26): the loopback endpoint delivers
    /// posted batches to the run whose plan scope matches.
    pub fn plan_scope_of(&self, plan_id: &str) -> Result<CaptureScope, StoreError> {
        let (campus_id, session_id) = plan_scope(&self.conn, plan_id)?;
        Ok(CaptureScope {
            campus_id,
            session_id,
        })
    }

    /// Records one refreshed course: appends snapshots for every section in
    /// the fresh results (deduped on the natural key, history preserved) and
    /// flags plan sections of this course that no longer appear as missing.
    /// Sections are never deleted — vanishing only flips the flag (ADR-0008).
    ///
    /// The whole step is one transaction, so snapshots and missing flags can
    /// never disagree. Refresh deliberately does not join the undo journal:
    /// undo reverses capture batches, never an explicit refresh.
    pub fn apply_refresh(
        &mut self,
        plan_id: &str,
        course_id: i64,
        sections: &[ParsedSection],
        captured_at: &str,
    ) -> Result<(), StoreError> {
        let (plan_campus, plan_session) = plan_scope(&self.conn, plan_id)?;
        let scope = CaptureScope {
            campus_id: plan_campus,
            session_id: plan_session,
        };
        let tx = self.conn.transaction()?;
        record_capture_tx(&tx, &scope, sections, captured_at)?;

        // A refresh is an act the student pressed, and the catalog says so.
        // `last_seen_at` advances on a capture too, so it alone cannot tell
        // the two apart on screen.
        tx.execute(
            "UPDATE courses SET last_refreshed_at = ?4
             WHERE campus_id = ?1 AND session_id = ?2 AND course_id = ?3",
            rusqlite::params![scope.campus_id, scope.session_id, course_id, captured_at],
        )?;

        let present: HashSet<i64> = sections.iter().map(|section| section.section_id).collect();
        let members: Vec<(i64, i64)> = {
            let mut stmt = tx.prepare(
                "SELECT ps.section_fk, s.section_id
                 FROM plan_sections ps
                 JOIN sections s ON s.id = ps.section_fk
                 WHERE ps.plan_id = ?1 AND s.course_id = ?2",
            )?;
            let rows = stmt.query_map(rusqlite::params![plan_id, course_id], |row| {
                Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?))
            })?;
            rows.collect::<Result<Vec<_>, _>>()?
        };
        for (section_fk, section_id) in members {
            tx.execute(
                "UPDATE plan_sections SET missing = ?3 WHERE plan_id = ?1 AND section_fk = ?2",
                rusqlite::params![plan_id, section_fk, i64::from(!present.contains(&section_id))],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    /// Every plan section flagged missing, with the alternatives the banner
    /// will surface: other captured sections of the same course under the
    /// plan's scope, excluding the missing section itself (ticket 21).
    pub fn missing_sections(&self, plan_id: &str) -> Result<Vec<MissingSection>, StoreError> {
        let (campus_id, session_id) = plan_scope(&self.conn, plan_id)?;
        let missing_rows: Vec<(i64, i64, String)> = {
            let mut stmt = self.conn.prepare(
                "SELECT s.course_id, s.section_id, s.section_code
                 FROM plan_sections ps
                 JOIN sections s ON s.id = ps.section_fk
                 WHERE ps.plan_id = ?1 AND ps.missing = 1
                 ORDER BY s.course_id, s.section_id",
            )?;
            let rows = stmt.query_map([plan_id], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })?;
            rows.collect::<Result<Vec<_>, _>>()?
        };
        let mut result = Vec::new();
        for (course_id, section_id, section_code) in missing_rows {
            let alternatives =
                self.alternatives_for(campus_id, session_id, course_id, section_id)?;
            result.push(MissingSection {
                course_id,
                section_id,
                section_code,
                alternatives,
            });
        }
        Ok(result)
    }

    /// Other captured sections of the same course under the plan's scope,
    /// excluding the missing section itself — the options the banner
    /// surfaces so the student can act rather than just be informed.
    fn alternatives_for(
        &self,
        campus_id: i64,
        session_id: i64,
        course_id: i64,
        missing_section_id: i64,
    ) -> Result<Vec<Section>, StoreError> {
        let section_fks: Vec<i64> = {
            let mut stmt = self.conn.prepare(
                "SELECT id FROM sections
                 WHERE campus_id = ?1 AND session_id = ?2 AND course_id = ?3
                   AND section_id != ?4
                 ORDER BY section_id",
            )?;
            let rows = stmt.query_map(
                rusqlite::params![campus_id, session_id, course_id, missing_section_id],
                |row| row.get::<_, i64>(0),
            )?;
            rows.collect::<Result<Vec<_>, _>>()?
        };
        section_fks
            .iter()
            .map(|section_fk| section_view(&self.conn, *section_fk))
            .collect()
    }

    /// The distinct teachers on the latest snapshot of each of a course's
    /// sections, keyed and de-duplicated, each with a display name and the
    /// sections they are listed on. Latest only — a teacher who has been
    /// replaced cannot be assigned, so ranking them is noise.
    ///
    /// A blank teacher has no key and never produces a rankable entry.
    pub fn rankable_teachers(
        &self,
        scope: &CaptureScope,
        course_id: i64,
    ) -> Result<Vec<RankableTeacher>, StoreError> {
        use crate::core::teachers::teacher_key;
        use std::collections::BTreeMap;

        // Get every section of this course under the scope.
        let section_fks: Vec<(i64, i64)> = {
            let mut stmt = self.conn.prepare(
                "SELECT id, section_id FROM sections
                 WHERE campus_id = ?1 AND session_id = ?2 AND course_id = ?3
                 ORDER BY section_id",
            )?;
            let rows = stmt.query_map(
                rusqlite::params![scope.campus_id, scope.session_id, course_id],
                |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
            )?;
            rows.collect::<Result<Vec<_>, _>>()?
        };

        // For each section, read the latest snapshot's teacher.
        let mut by_key: BTreeMap<String, (String, Vec<i64>)> = BTreeMap::new();
        for (section_fk, section_id) in section_fks {
            let teacher: Option<String> = self
                .conn
                .query_row(
                    "SELECT teacher FROM snapshots WHERE section_fk = ?1
                     ORDER BY captured_at DESC, id DESC LIMIT 1",
                    [section_fk],
                    |row| row.get(0),
                )
                .optional()?
                .flatten();
            if let Some(name) = teacher {
                if let Some(key) = teacher_key(&name) {
                    by_key
                        .entry(key.clone())
                        .or_insert_with(|| (name, Vec::new()))
                        .1
                        .push(section_id);
                }
            }
        }

        Ok(by_key
            .into_iter()
            .map(|(key, (display_name, section_ids))| RankableTeacher {
                key,
                display_name,
                section_ids,
            })
            .collect())
    }

    /// A course's stored preferences, including entries whose teacher no
    /// longer appears in the latest-snapshot set. Those are **inactive**:
    /// kept, returned, flagged, and scoring nothing.
    pub fn course_preferences(
        &self,
        scope: &CaptureScope,
        course_id: i64,
    ) -> Result<Vec<TeacherPreference>, StoreError> {
        // Build the set of currently-active teacher keys from latest snapshots.
        let rankable = self.rankable_teachers(scope, course_id)?;
        let active_keys: std::collections::HashSet<String> =
            rankable.iter().map(|t| t.key.clone()).collect();

        let mut stmt = self.conn.prepare(
            "SELECT teacher_key, display_name, rank, avoid
             FROM teacher_preferences
             WHERE campus_id = ?1 AND session_id = ?2 AND course_id = ?3
             ORDER BY rank, teacher_key",
        )?;
        let rows = stmt.query_map(
            rusqlite::params![scope.campus_id, scope.session_id, course_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<i64>>(2)?,
                    row.get::<_, i64>(3)?,
                ))
            },
        )?;
        let mut prefs = Vec::new();
        for row in rows {
            let (key, display_name, rank, avoid) = row?;
            prefs.push(TeacherPreference {
                teacher_key: key.clone(),
                display_name,
                rank,
                avoid: avoid != 0,
                active: active_keys.contains(&key),
            });
        }
        Ok(prefs)
    }

    /// Writes a course's preferences as a whole ordered list plus an avoid
    /// set — one call replacing the course's rows in a transaction. A
    /// drag-reorder is one write, not n.
    ///
    /// Ranks are contiguous from 1 within a course — the store owns that
    /// invariant. Whatever the caller sends, what lands is `1..n` with no
    /// gaps and no ties.
    pub fn write_course_preferences(
        &mut self,
        scope: &CaptureScope,
        course_id: i64,
        ranked: &[(String, String)],
        avoided: &[(String, String)],
    ) -> Result<(), StoreError> {
        let tx = self.conn.transaction()?;
        // Delete existing preferences for this course under this scope.
        tx.execute(
            "DELETE FROM teacher_preferences
             WHERE campus_id = ?1 AND session_id = ?2 AND course_id = ?3",
            rusqlite::params![scope.campus_id, scope.session_id, course_id],
        )?;
        // Insert ranked teachers with contiguous ranks.
        for (rank, (key, display_name)) in ranked.iter().enumerate() {
            tx.execute(
                "INSERT INTO teacher_preferences
                 (campus_id, session_id, course_id, teacher_key, display_name, rank, avoid)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0)",
                rusqlite::params![
                    scope.campus_id,
                    scope.session_id,
                    course_id,
                    key,
                    display_name,
                    (rank + 1) as i64,
                ],
            )?;
        }
        // Insert avoided teachers. An avoided teacher carries a display
        // name exactly as a ranked one does: the key is case-folded, and a
        // student who avoided "Bryant Lee" must never be shown "bryant lee".
        for (key, display_name) in avoided {
            tx.execute(
                "INSERT INTO teacher_preferences
                 (campus_id, session_id, course_id, teacher_key, display_name, rank, avoid)
                 VALUES (?1, ?2, ?3, ?4, ?5, NULL, 1)",
                rusqlite::params![
                    scope.campus_id,
                    scope.session_id,
                    course_id,
                    key,
                    display_name,
                ],
            )?;
        }
        tx.commit()?;
        Ok(())
    }
}

fn record_capture_tx(
    tx: &Transaction<'_>,
    scope: &CaptureScope,
    sections: &[ParsedSection],
    captured_at: &str,
) -> Result<(), StoreError> {
    for section in sections {
        upsert_course(tx, scope, section)?;
        let (section_fk, _, _) = upsert_section(tx, scope, section, captured_at)?;
        replace_blocks(tx, section_fk, section)?;
        append_snapshot(tx, section_fk, section, captured_at)?;
    }
    Ok(())
}

fn insert_plan_tx(
    tx: &Transaction<'_>,
    id: &str,
    name: &str,
    scope: &CaptureScope,
    created_at: &str,
) -> Result<(), StoreError> {
    let exists: bool = tx.query_row(
        "SELECT EXISTS(SELECT 1 FROM plans WHERE id = ?1)",
        [id],
        |row| row.get(0),
    )?;
    if exists {
        return Err(StoreError::PlanExists {
            plan_id: id.to_string(),
        });
    }
    tx.execute(
        "INSERT INTO plans (id, name, campus_id, session_id, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![id, name, scope.campus_id, scope.session_id, created_at],
    )?;
    Ok(())
}

fn resolve_scoped_section_tx(
    tx: &Transaction<'_>,
    plan_id: &str,
    course_id: i64,
    section_id: i64,
) -> Result<i64, StoreError> {
    let (plan_campus, plan_session) = plan_scope(tx, plan_id)?;
    match scoped_section_fk(tx, plan_campus, plan_session, course_id, section_id)? {
        Some(section_fk) => Ok(section_fk),
        None => {
            // Distinguish "captured under another scope" from "never
            // captured": both fail, but the error names the real cause.
            let elsewhere = tx
                .query_row(
                    "SELECT campus_id, session_id FROM sections
                     WHERE course_id = ?1 AND section_id = ?2",
                    rusqlite::params![course_id, section_id],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .optional()?;
            match elsewhere {
                Some((section_campus, section_session)) => Err(StoreError::ScopeMismatch {
                    plan_id: plan_id.to_string(),
                    plan_campus_id: plan_campus,
                    plan_session_id: plan_session,
                    section_campus_id: section_campus,
                    section_session_id: section_session,
                }),
                None => Err(StoreError::SectionNotFound {
                    course_id,
                    section_id,
                }),
            }
        }
    }
}

fn add_section_tx(
    tx: &Transaction<'_>,
    plan_id: &str,
    course_id: i64,
    section_id: i64,
) -> Result<(), StoreError> {
    let section_fk = resolve_scoped_section_tx(tx, plan_id, course_id, section_id)?;

    tx.execute(
        "INSERT INTO plan_sections (plan_id, section_fk, pinned) VALUES (?1, ?2, 0)
         ON CONFLICT (plan_id, section_fk) DO NOTHING",
        rusqlite::params![plan_id, section_fk],
    )?;
    Ok(())
}

/// Reads one plan row plus its section count.
fn plan_summary_row(conn: &Connection, plan_id: &str) -> Result<PlanSummaryRow, StoreError> {
    conn.query_row(
        "SELECT p.id, p.name, p.campus_id, p.session_id, p.created_at,
                (SELECT COUNT(*) FROM plan_sections ps WHERE ps.plan_id = p.id)
         FROM plans p WHERE p.id = ?1",
        [plan_id],
        |row| {
            Ok(PlanSummaryRow {
                id: row.get(0)?,
                name: row.get(1)?,
                campus_id: row.get(2)?,
                session_id: row.get(3)?,
                created_at: row.get(4)?,
                section_count: row.get(5)?,
            })
        },
    )
    .optional()?
    .ok_or_else(|| StoreError::PlanNotFound {
        plan_id: plan_id.to_string(),
    })
}

/// One section row as solver candidate input (ticket 14): identity, blocks,
/// and the latest snapshot's live numbers. `enrolled` / `enroll_cap` /
/// `teacher` of `None` mean *unknown* — the solver never treats unknown
/// data as full, and never reads teacher at all.
fn solver_section_view(conn: &Connection, section_fk: i64) -> Result<SolverSection, StoreError> {
    let (section_id, section_code, enroll_cap): (i64, String, Option<i64>) = conn.query_row(
        "SELECT section_id, section_code, enroll_cap FROM sections WHERE id = ?1",
        [section_fk],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    )?;
    let latest: Option<(Option<i64>, Option<String>)> = conn
        .query_row(
            "SELECT enrolled, teacher FROM snapshots WHERE section_fk = ?1
             ORDER BY captured_at DESC, id DESC LIMIT 1",
            [section_fk],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    let (enrolled, teacher) = latest.unwrap_or((None, None));
    Ok(SolverSection {
        section_id,
        section_code,
        blocks: read_wire_blocks(conn, section_fk)?,
        enrolled,
        enroll_cap,
        teacher,
    })
}

/// A section row read for plan display: the wire [`Section`] view plus the
/// membership flags. Everything except the flags is shared with
/// [`section_view`], never duplicated.
fn plan_section_view(
    section: Section,
    pinned: bool,
    missing: bool,
) -> crate::core::ipc_types::PlanSection {
    crate::core::ipc_types::PlanSection {
        course_id: section.course_id,
        course_code: section.course_code,
        course_title: section.course_title,
        section_id: section.section_id,
        section_code: section.section_code,
        pinned,
        missing,
        modality: section.modality,
        blocks: section.blocks,
        latest_snapshot: section.latest_snapshot,
    }
}

/// Upserts the course and notes whether it pre-existed, so undo can remove
/// a course this batch introduced.
fn upsert_course(
    tx: &Transaction<'_>,
    scope: &CaptureScope,
    section: &ParsedSection,
) -> Result<(), StoreError> {
    tx.execute(
        "INSERT INTO courses (campus_id, session_id, course_id, code, title)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT (campus_id, session_id, course_id) DO UPDATE SET
             code = excluded.code,
             title = excluded.title",
        rusqlite::params![
            scope.campus_id,
            scope.session_id,
            section.course_id,
            section.course_code,
            section.course_title,
        ],
    )?;
    Ok(())
}

/// Upserts the section and reports its prior state — whether it already
/// existed and its previous `last_seen_at` — so undo can restore it.
fn upsert_section(
    tx: &Transaction<'_>,
    scope: &CaptureScope,
    section: &ParsedSection,
    captured_at: &str,
) -> Result<(i64, bool, Option<String>), StoreError> {
    let prior = tx
        .query_row(
            "SELECT id, last_seen_at FROM sections
             WHERE campus_id = ?1 AND session_id = ?2 AND course_id = ?3 AND section_id = ?4",
            rusqlite::params![
                scope.campus_id,
                scope.session_id,
                section.course_id,
                section.section_id
            ],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()?;
    let existed_before = prior.is_some();
    tx.execute(
        "INSERT INTO sections (campus_id, session_id, course_id, section_id, section_code,
                               course_type, credits, enroll_cap, first_seen_at, last_seen_at,
                               start_date, end_date)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
         ON CONFLICT (campus_id, session_id, course_id, section_id) DO UPDATE SET
             section_code = excluded.section_code,
             course_type  = excluded.course_type,
             credits      = excluded.credits,
             enroll_cap   = excluded.enroll_cap,
             last_seen_at = excluded.last_seen_at,
             start_date   = excluded.start_date,
             end_date     = excluded.end_date",
        rusqlite::params![
            scope.campus_id,
            scope.session_id,
            section.course_id,
            section.section_id,
            section.section_code,
            section.course_type,
            section.credits,
            section.enroll_cap,
            captured_at,
            captured_at,
            date_to_db(section.start_date),
            date_to_db(section.end_date),
        ],
    )?;
    let section_fk = tx.query_row(
        "SELECT id FROM sections
         WHERE campus_id = ?1 AND session_id = ?2 AND course_id = ?3 AND section_id = ?4",
        rusqlite::params![
            scope.campus_id,
            scope.session_id,
            section.course_id,
            section.section_id
        ],
        |row| row.get(0),
    )?;
    Ok((section_fk, existed_before, prior.map(|(_, last_seen)| last_seen)))
}

fn replace_blocks(
    tx: &Transaction<'_>,
    section_fk: i64,
    section: &ParsedSection,
) -> Result<(), StoreError> {
    tx.execute(
        "DELETE FROM schedule_blocks WHERE section_fk = ?1",
        [section_fk],
    )?;
    for block in &section.blocks {
        insert_block(tx, section_fk, block)?;
    }
    Ok(())
}

fn insert_block(
    tx: &Transaction<'_>,
    section_fk: i64,
    block: &ParsedBlock,
) -> Result<(), StoreError> {
    let (location, modality): (Option<String>, Option<&str>) = match block.modality() {
        Some(crate::core::ipc_types::BlockModality::F2F) => {
            (block_location_text(block), Some("F2F"))
        }
        Some(crate::core::ipc_types::BlockModality::Online) => (None, Some("ONLINE")),
        None => (block_location_text(block), None),
    };
    tx.execute(
        "INSERT INTO schedule_blocks (section_fk, day, start_min, end_min, location, modality)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![
            section_fk,
            day_to_db(block.day),
            block.start_min,
            block.end_min,
            location,
            modality,
        ],
    )?;
    Ok(())
}

/// The stored location: `NULL` for online blocks, the room code for F2F
/// blocks, and the raw text for blocks the parser could not classify.
fn block_location_text(block: &ParsedBlock) -> Option<String> {
    use crate::core::parser::ParsedLocation;
    match &block.location {
        ParsedLocation::Room(code) => Some(code.clone()),
        ParsedLocation::Online => None,
        ParsedLocation::Unrecognized(raw) => Some(raw.clone()),
    }
}

/// Appends the batch's snapshot for a section and returns its row id, so
/// undo can remove exactly this snapshot.
fn append_snapshot(
    tx: &Transaction<'_>,
    section_fk: i64,
    section: &ParsedSection,
    captured_at: &str,
) -> Result<i64, StoreError> {
    tx.execute(
        "INSERT INTO snapshots (section_fk, captured_at, enrolled, teacher, remark)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![
            section_fk,
            captured_at,
            section.enrolled,
            section.teacher,
            section.remark,
        ],
    )?;
    Ok(tx.last_insert_rowid())
}

/// Reads one section row into the wire [`Section`] view: course identity,
/// schedule blocks with per-block modality, and the latest snapshot.
///
/// Start/end dates are deliberately not persisted (ticket 05), so they
/// surface as `None`. The wire type's `enroll_cap` and snapshot `enrolled`
/// are plain numbers, so blank (unknown) values surface as `0` — the
/// alternative would be amending the IPC contract.
fn section_view(conn: &Connection, section_fk: i64) -> Result<Section, StoreError> {
    let (campus_id, session_id, course_id, course_code, course_title, section_id, section_code,
         course_type, credits, enroll_cap, first_seen_at, last_seen_at) = conn.query_row(
        "SELECT s.campus_id, s.session_id, s.course_id, c.code, c.title, s.section_id,
                s.section_code, s.course_type, s.credits, s.enroll_cap,
                s.first_seen_at, s.last_seen_at
         FROM sections s
         JOIN courses c ON c.campus_id = s.campus_id AND c.session_id = s.session_id
             AND c.course_id = s.course_id
         WHERE s.id = ?1",
        [section_fk],
        |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, i64>(5)?,
                row.get::<_, String>(6)?,
                row.get::<_, Option<String>>(7)?,
                row.get::<_, Option<f64>>(8)?,
                row.get::<_, Option<i64>>(9)?,
                row.get::<_, String>(10)?,
                row.get::<_, String>(11)?,
            ))
        },
    )?;

    let blocks = read_wire_blocks(conn, section_fk)?;
    let modality = derive_section_modality(&blocks);
    let latest_snapshot = latest_snapshot(conn, section_fk)?.ok_or_else(|| {
        StoreError::SectionHasNoSnapshots {
            course_id,
            section_id,
        }
    })?;

    Ok(Section {
        campus_id,
        session_id,
        course_id,
        course_code,
        course_title,
        section_id,
        section_code,
        course_type,
        credits,
        enroll_cap: enroll_cap.unwrap_or(0),
        start_date: None,
        end_date: None,
        first_seen_at,
        last_seen_at,
        modality,
        blocks,
        latest_snapshot,
    })
}

/// A section's blocks in insertion order (the parser's order).
fn read_wire_blocks(
    conn: &Connection,
    section_fk: i64,
) -> Result<Vec<ScheduleBlock>, StoreError> {
    let mut stmt = conn.prepare(
        "SELECT day, start_min, end_min, location, modality
         FROM schedule_blocks WHERE section_fk = ?1 ORDER BY id",
    )?;
    let rows = stmt.query_map([section_fk], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, i64>(1)?,
            row.get::<_, i64>(2)?,
            row.get::<_, Option<String>>(3)?,
            row.get::<_, Option<String>>(4)?,
        ))
    })?;
    rows.map(|row| {
        let (day, start_min, end_min, location, modality) = row?;
        Ok(wire_block(day_from_db(&day), start_min, end_min, location, modality))
    })
    .collect::<Result<Vec<_>, StoreError>>()
}

/// Stored block → wire block. Online blocks store NULL location; F2F blocks
/// store the room code. Blocks the parser could not classify keep their raw
/// location text and NULL modality, and surface as F2F because the wire
/// modality is binary — the raw text is what disambiguates, and conflict
/// detection never branches on modality.
fn wire_block(
    day: Day,
    start_min: i64,
    end_min: i64,
    location: Option<String>,
    modality: Option<String>,
) -> ScheduleBlock {
    let (modality, location) = match modality.as_deref() {
        Some("ONLINE") => (BlockModality::Online, None),
        _ => (BlockModality::F2F, location),
    };
    ScheduleBlock {
        day,
        start_min,
        end_min,
        location,
        modality,
    }
}

/// Section-level modality derived from the mix of the section's blocks
/// (ADR-0007). A section whose schedule could not be read at all defaults
/// to F2F — the representable choice for the binary wire type.
fn derive_section_modality(blocks: &[ScheduleBlock]) -> SectionModality {
    let mut f2f = false;
    let mut online = false;
    for block in blocks {
        match block.modality {
            BlockModality::F2F => f2f = true,
            BlockModality::Online => online = true,
        }
    }
    match (f2f, online) {
        (true, true) => SectionModality::Hybrid,
        (true, false) => SectionModality::F2F,
        (false, true) => SectionModality::Online,
        (false, false) => SectionModality::F2F,
    }
}

/// The most recent snapshot by capture time; later ids break ties. Every
/// section row is created with its first snapshot in the same transaction,
/// so `None` here means that invariant is broken — the caller turns it into
/// a loud error rather than fabricating a snapshot.
fn latest_snapshot(conn: &Connection, section_fk: i64) -> Result<Option<Snapshot>, StoreError> {
    conn.query_row(
        "SELECT captured_at, enrolled, teacher, remark
         FROM snapshots WHERE section_fk = ?1
         ORDER BY captured_at DESC, id DESC LIMIT 1",
        [section_fk],
        |row| {
            Ok(Snapshot {
                captured_at: row.get(0)?,
                enrolled: row.get::<_, Option<i64>>(1)?.unwrap_or(0),
                teacher: row.get(2)?,
                remark: row.get(3)?,
            })
        },
    )
    .optional()
    .map_err(StoreError::Sql)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::ipc_types::{BlockModality, Conflict, SectionRef};
    use crate::core::parser::{ParsedLocation, ParsedSection};

    const SCOPE: CaptureScope = CaptureScope {
        campus_id: 7,
        session_id: 155,
    };

    const OTHER_SCOPE: CaptureScope = CaptureScope {
        campus_id: 8,
        session_id: 156,
    };

    const T1: &str = "2026-08-22T10:00:00Z";
    const T2: &str = "2026-08-22T11:00:00Z";

    fn store() -> Store {
        Store::open_in_memory().expect("in-memory store must open")
    }

    fn parsed_section(
        course_id: i64,
        section_id: i64,
        section_code: &str,
        teacher: Option<&str>,
        enrolled: Option<i64>,
        blocks: Vec<ParsedBlock>,
    ) -> ParsedSection {
        ParsedSection {
            course_id,
            course_code: "CSINTSY".into(),
            course_title: "INTRODUCTION TO INTELLIGENT SYSTEMS".into(),
            section_id,
            section_code: section_code.into(),
            course_type: Some("Lecture".into()),
            credits: Some(3.0),
            enroll_cap: Some(45),
            enrolled,
            teacher: teacher.map(str::to_string),
            remark: None,
            start_date: None,
            end_date: None,
            blocks,
        }
    }

    fn room_block(day: Day, start_min: i64, end_min: i64, room: &str) -> ParsedBlock {
        ParsedBlock {
            day,
            start_min,
            end_min,
            location: ParsedLocation::Room(room.into()),
        }
    }

    fn online_block(day: Day, start_min: i64, end_min: i64) -> ParsedBlock {
        ParsedBlock {
            day,
            start_min,
            end_min,
            location: ParsedLocation::Online,
        }
    }

    fn table_names(conn: &Connection) -> Vec<String> {
        let mut stmt = conn
            .prepare(
                "SELECT name FROM sqlite_master
                 WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
            )
            .expect("table listing must prepare");
        stmt.query_map([], |row| row.get(0))
            .expect("table listing must run")
            .map(|name| name.expect("table name"))
            .collect()
    }

    fn column_names(conn: &Connection, table: &str) -> Vec<String> {
        let mut stmt = conn
            .prepare(&format!("PRAGMA table_info({table})"))
            .expect("table_info must prepare");
        stmt.query_map([], |row| row.get::<_, String>(1))
            .expect("table_info must run")
            .map(|name| name.expect("column name"))
            .collect()
    }

    fn count(conn: &Connection, sql: &str) -> i64 {
        conn.query_row(sql, [], |row| row.get(0))
            .expect("count query must run")
    }

    type SectionRow = (i64, i64, i64, i64, String, String, String);
    type SnapshotRow = (i64, String, Option<i64>, Option<String>);
    type BlockRow = (i64, String, i64, i64, Option<String>, Option<String>);

    fn section_rows(conn: &Connection) -> Vec<SectionRow> {
        let mut stmt = conn
            .prepare(
                "SELECT campus_id, session_id, course_id, section_id, section_code,
                        first_seen_at, last_seen_at
                 FROM sections ORDER BY section_id",
            )
            .expect("sections select must prepare");
        stmt.query_map([], |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
                row.get(5)?,
                row.get(6)?,
            ))
        })
        .expect("sections select must run")
        .map(|row| row.expect("section row"))
        .collect()
    }

    fn snapshot_rows(conn: &Connection) -> Vec<SnapshotRow> {
        let mut stmt = conn
            .prepare(
                "SELECT s.section_id, sn.captured_at, sn.enrolled, sn.teacher
                 FROM snapshots sn JOIN sections s ON s.id = sn.section_fk
                 ORDER BY s.section_id, sn.captured_at, sn.id",
            )
            .expect("snapshots select must prepare");
        stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)))
            .expect("snapshots select must run")
            .map(|row| row.expect("snapshot row"))
            .collect()
    }

    fn block_rows(conn: &Connection) -> Vec<BlockRow> {
        let mut stmt = conn
            .prepare(
                "SELECT s.section_id, b.day, b.start_min, b.end_min, b.location, b.modality
                 FROM schedule_blocks b JOIN sections s ON s.id = b.section_fk
                 ORDER BY s.section_id, b.day, b.start_min",
            )
            .expect("blocks select must prepare");
        stmt.query_map([], |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
                row.get(5)?,
            ))
        })
        .expect("blocks select must run")
        .map(|row| row.expect("block row"))
        .collect()
    }

    // ---------- migrations ----------

    #[test]
    fn fresh_database_gets_exactly_the_spec_tables() {
        let store = store();
        let tables = table_names(&store.conn);
        assert_eq!(
            tables,
            vec![
                "courses",
                "plan_sections",
                "plans",
                "schedule_blocks",
                "sections",
                "snapshots",
                "teacher_preferences",
            ]
        );
    }

    #[test]
    fn migration_is_idempotent_on_an_existing_database() {
        let store = store();
        migrate(&store.conn).expect("re-migration must not error");
        migrate(&store.conn).expect("a third migration must not error");
        let tables = table_names(&store.conn);
        assert_eq!(tables.len(), 7, "no tables may be created twice");
        let version: i64 = store
            .conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .expect("user_version must be readable");
        assert_eq!(version, 8, "every migration applies exactly once");
    }

    #[test]
    fn reopening_an_existing_database_file_runs_cleanly() {
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("store.db");
        {
            let mut store = Store::open(&path).expect("fresh file must open and migrate");
            store
                .record_capture(&SCOPE, &[parsed_section(2923, 384, "S01", None, Some(10), vec![])], T1)
                .expect("capture must succeed");
        }
        let mut reopened = Store::open(&path).expect("existing file must reopen");
        reopened
            .record_capture(&SCOPE, &[parsed_section(2923, 384, "S01", None, Some(11), vec![])], T2)
            .expect("capture on reopened store must succeed");
        assert_eq!(section_rows(&reopened.conn).len(), 1, "dedupe across reopen");
        assert_eq!(count(&reopened.conn, "SELECT COUNT(*) FROM snapshots"), 2);
    }

    #[test]
    fn schema_columns_match_the_spec_allowlist_exactly() {
        let store = store();
        let expected: Vec<(&str, &[&str])> = vec![
            (
                "courses",
                &[
                    "campus_id",
                    "session_id",
                    "course_id",
                    "code",
                    "title",
                    "included",
                    "last_refreshed_at",
                ],
            ),
            (
                "sections",
                &[
                    "id",
                    "campus_id",
                    "session_id",
                    "course_id",
                    "section_id",
                    "section_code",
                    "course_type",
                    "credits",
                    "enroll_cap",
                    "first_seen_at",
                    "last_seen_at",
                    "start_date",
                    "end_date",
                ],
            ),
            (
                "schedule_blocks",
                &[
                    "id",
                    "section_fk",
                    "day",
                    "start_min",
                    "end_min",
                    "location",
                    "modality",
                ],
            ),
            (
                "snapshots",
                &["id", "section_fk", "captured_at", "enrolled", "teacher", "remark"],
            ),
            (
                "plans",
                &["id", "name", "campus_id", "session_id", "created_at", "is_sample"],
            ),
            (
                "plan_sections",
                &["plan_id", "section_fk", "pinned", "missing"],
            ),
            (
                "teacher_preferences",
                &["campus_id", "session_id", "course_id", "teacher_key",
                  "display_name", "rank", "avoid"],
            ),
        ];
        for (table, columns) in expected {
            assert_eq!(
                column_names(&store.conn, table),
                columns,
                "column allowlist for {table}"
            );
        }
        // No column anywhere is shaped to hold raw HTML.
        for table in table_names(&store.conn) {
            for column in column_names(&store.conn, &table) {
                assert!(
                    !column.to_lowercase().contains("html"),
                    "no column may hold raw HTML, found {table}.{column}"
                );
            }
        }
    }

    // ---------- capture upsert and dedupe ----------

    #[test]
    fn capturing_the_same_course_twice_keeps_the_row_count_and_advances_last_seen() {
        let mut store = store();
        let sections = vec![
            parsed_section(2923, 384, "S01", None, Some(10), vec![online_block(Day::Mon, 450, 540)]),
            parsed_section(2923, 385, "S02", Some("Bryant Lee"), Some(42), vec![]),
        ];
        store.record_capture(&SCOPE, &sections, T1).expect("first capture");
        store.record_capture(&SCOPE, &sections, T2).expect("repeat capture");

        assert_eq!(section_rows(&store.conn).len(), 2, "no duplicate sections");
        for (_, _, _, _, _, first_seen, last_seen) in section_rows(&store.conn) {
            assert_eq!(first_seen, T1, "first_seen_at must stay at first capture");
            assert_eq!(last_seen, T2, "last_seen_at must advance on re-capture");
        }
        assert_eq!(count(&store.conn, "SELECT COUNT(*) FROM courses"), 1);
    }

    // ---------- snapshots ----------

    #[test]
    fn every_capture_appends_a_snapshot_and_earlier_snapshots_stay_readable() {
        let mut store = store();
        let first = parsed_section(2923, 384, "S01", None, Some(10), vec![]);
        let second = parsed_section(2923, 384, "S01", Some("Bryant Lee"), Some(42), vec![]);
        store.record_capture(&SCOPE, &[first], T1).expect("first capture");
        store.record_capture(&SCOPE, &[second], T2).expect("second capture");

        assert_eq!(
            snapshot_rows(&store.conn),
            vec![
                (384, T1.to_string(), Some(10), None),
                (384, T2.to_string(), Some(42), Some("Bryant Lee".into())),
            ],
            "two captures produce two snapshots; the earlier one stays readable"
        );
    }

    #[test]
    fn unknown_teacher_round_trips_as_sql_null_never_an_empty_string() {
        let mut store = store();
        let unknown = parsed_section(2923, 384, "S01", None, Some(10), vec![]);
        store.record_capture(&SCOPE, &[unknown], T1).expect("capture");

        let teacher_is_null: i64 = store
            .conn
            .query_row(
                "SELECT COUNT(*) FROM snapshots WHERE teacher IS NULL",
                [],
                |row| row.get(0),
            )
            .expect("null teacher count");
        let teacher_is_blank: i64 = store
            .conn
            .query_row(
                "SELECT COUNT(*) FROM snapshots WHERE teacher = ''",
                [],
                |row| row.get(0),
            )
            .expect("blank teacher count");
        assert_eq!(teacher_is_null, 1, "blank teacher means unknown, stored as NULL");
        assert_eq!(teacher_is_blank, 0, "an empty string would later read as a value");
    }

    // ---------- schedule blocks ----------

    #[test]
    fn blocks_are_stored_per_day_with_modality_and_null_location_when_online() {
        let mut store = store();
        let hybrid = parsed_section(
            2923,
            384,
            "S01",
            None,
            Some(10),
            vec![
                room_block(Day::Tue, 870, 960, "L226"),
                online_block(Day::Fri, 870, 960),
            ],
        );
        store.record_capture(&SCOPE, &[hybrid], T1).expect("capture");

        assert_eq!(
            block_rows(&store.conn),
            vec![
                // Day order in the query is textual: FRI before TUE.
                (384, "FRI".into(), 870, 960, None, Some("ONLINE".into())),
                (384, "TUE".into(), 870, 960, Some("L226".into()), Some("F2F".into())),
            ],
            "each meeting day is its own block; online blocks store NULL location"
        );
    }

    #[test]
    fn re_capture_replaces_blocks_without_duplicating_them() {
        let mut store = store();
        let two_blocks = parsed_section(
            2923,
            384,
            "S01",
            None,
            Some(10),
            vec![
                room_block(Day::Tue, 870, 960, "L226"),
                online_block(Day::Fri, 870, 960),
            ],
        );
        let one_block = parsed_section(2923, 384, "S01", None, Some(11), vec![
            online_block(Day::Wed, 450, 540),
        ]);
        store.record_capture(&SCOPE, &[two_blocks], T1).expect("first capture");
        store.record_capture(&SCOPE, &[one_block], T2).expect("second capture");

        assert_eq!(
            block_rows(&store.conn),
            vec![(384, "WED".into(), 450, 540, None, Some("ONLINE".into()))],
            "blocks reflect the latest capture, exactly once"
        );
    }

    // ---------- sections are never hard-deleted ----------

    #[test]
    fn a_section_missing_from_a_later_capture_keeps_its_row_and_history() {
        let mut store = store();
        let both = vec![
            parsed_section(2923, 384, "S01", None, Some(10), vec![]),
            parsed_section(2923, 385, "S02", None, Some(20), vec![]),
        ];
        let only_first = vec![parsed_section(2923, 384, "S01", None, Some(11), vec![])];
        store.record_capture(&SCOPE, &both, T1).expect("first capture");
        store.record_capture(&SCOPE, &only_first, T2).expect("second capture");

        assert_eq!(section_rows(&store.conn).len(), 2, "S02 must keep its row");
        assert_eq!(count(&store.conn, "SELECT COUNT(*) FROM snapshots"), 3);
        let s02_snapshots: i64 = store
            .conn
            .query_row(
                "SELECT COUNT(*) FROM snapshots sn JOIN sections s ON s.id = sn.section_fk
                 WHERE s.section_id = 385",
                [],
                |row| row.get(0),
            )
            .expect("S02 snapshot count");
        assert_eq!(s02_snapshots, 1, "S02 keeps its history");
    }

    // ---------- plan scope ----------

    #[test]
    fn a_plan_cannot_link_a_section_outside_its_campus_and_session() {
        let mut store = store();
        store
            .create_plan("p1", "T1 load", &SCOPE, T1)
            .expect("plan must be created");
        store
            .record_capture(
                &SCOPE,
                &[parsed_section(2923, 384, "S01", None, Some(10), vec![])],
                T1,
            )
            .expect("in-scope capture");
        store
            .record_capture(
                &OTHER_SCOPE,
                &[parsed_section(2923, 999, "S99", None, Some(5), vec![])],
                T1,
            )
            .expect("other-scope capture");

        store
            .add_section_to_plan("p1", 2923, 384)
            .expect("an in-scope section links cleanly");

        let err = store
            .add_section_to_plan("p1", 2923, 999)
            .expect_err("an out-of-scope section must be rejected at the storage layer");
        match err {
            StoreError::ScopeMismatch {
                plan_id,
                plan_campus_id,
                plan_session_id,
                section_campus_id,
                section_session_id,
            } => {
                assert_eq!(plan_id, "p1");
                assert_eq!((plan_campus_id, plan_session_id), (7, 155));
                assert_eq!((section_campus_id, section_session_id), (8, 156));
            }
            other => panic!("expected ScopeMismatch, got {other:?}"),
        }
        assert_eq!(count(&store.conn, "SELECT COUNT(*) FROM plan_sections"), 1);
    }

    #[test]
    fn linking_a_known_section_to_an_unknown_plan_is_a_plan_error() {
        let mut store = store();
        store
            .record_capture(
                &SCOPE,
                &[parsed_section(2923, 384, "S01", None, Some(10), vec![])],
                T1,
            )
            .expect("capture");
        let err = store
            .add_section_to_plan("missing", 2923, 384)
            .expect_err("an unknown plan must error");
        assert!(matches!(err, StoreError::PlanNotFound { .. }), "got {err:?}");
    }

    #[test]
    fn linking_an_unknown_section_to_a_plan_is_a_section_error() {
        let mut store = store();
        store
            .create_plan("p1", "T1 load", &SCOPE, T1)
            .expect("plan must be created");
        let err = store
            .add_section_to_plan("p1", 2923, 4242)
            .expect_err("an unknown section must error");
        assert!(
            matches!(err, StoreError::SectionNotFound { course_id: 2923, section_id: 4242 }),
            "got {err:?}"
        );
    }

    #[test]
    fn unknown_location_blocks_stay_representable_in_the_store() {
        let mut store = store();
        let tba = parsed_section(
            2923,
            384,
            "S01",
            None,
            Some(10),
            vec![ParsedBlock {
                day: Day::Sat,
                start_min: 660,
                end_min: 750,
                location: ParsedLocation::Unrecognized("TBA".into()),
            }],
        );
        store.record_capture(&SCOPE, &[tba], T1).expect("capture");
        assert_eq!(
            block_rows(&store.conn),
            vec![(384, "SAT".into(), 660, 750, Some("TBA".into()), None)],
            "an unclassifiable block keeps its raw location and NULL modality"
        );
    }

    #[test]
    fn remark_is_stored_verbatim_on_the_snapshot() {
        let mut store = store();
        let mut section = parsed_section(2923, 384, "S01", None, Some(10), vec![]);
        section.remark = Some(" See note  about  TBA ".into());
        store.record_capture(&SCOPE, &[section], T1).expect("capture");
        let remark: String = store
            .conn
            .query_row("SELECT remark FROM snapshots", [], |row| row.get(0))
            .expect("remark must be stored");
        assert_eq!(remark, " See note  about  TBA ", "remark is verbatim");
    }

    #[test]
    fn mixed_scope_plan_rejection_happens_before_any_row_is_written() {
        let mut store = store();
        store
            .create_plan("p1", "T1 load", &SCOPE, T1)
            .expect("plan must be created");
        let err = store
            .add_section_to_plan("p1", 2923, 4242)
            .expect_err("a section that does not exist anywhere must error");
        assert!(matches!(err, StoreError::SectionNotFound { .. }), "got {err:?}");
        assert_eq!(count(&store.conn, "SELECT COUNT(*) FROM plan_sections"), 0);
    }

    #[test]
    fn capture_does_not_modify_existing_unrelated_scopes() {
        let mut store = store();
        store
            .record_capture(
                &SCOPE,
                &[parsed_section(2923, 384, "S01", None, Some(10), vec![])],
                T1,
            )
            .expect("scope A capture");
        store
            .record_capture(
                &OTHER_SCOPE,
                &[parsed_section(2923, 384, "S01", None, Some(20), vec![])],
                T2,
            )
            .expect("scope B capture of the same section ids");

        let rows = section_rows(&store.conn);
        assert_eq!(rows.len(), 2, "different scopes are different sections");
        let scope_a = rows
            .iter()
            .filter(|(campus, session, ..)| (*campus, *session) == (7, 155))
            .count();
        let scope_b = rows
            .iter()
            .filter(|(campus, session, ..)| (*campus, *session) == (8, 156))
            .count();
        assert_eq!(scope_a, 1, "scope A row must keep its scope");
        assert_eq!(scope_b, 1, "scope B row must keep its scope");
        // Scope A's own data is untouched by the scope B capture.
        let (_, _, _, _, _, first_seen, last_seen) = rows
            .iter()
            .find(|(campus, session, ..)| (*campus, *session) == (7, 155))
            .expect("scope A row");
        assert_eq!(first_seen, T1);
        assert_eq!(last_seen, T1, "a capture in another scope must not advance last_seen_at");
    }

    #[test]
    fn modality_derivation_uses_block_modality_not_section_modality() {
        // A hybrid section stores one ONLINE and one F2F block: modality is
        // per-block (ADR-0007), never a section-level field.
        let mut store = store();
        let hybrid = parsed_section(
            2923,
            384,
            "S01",
            None,
            Some(10),
            vec![
                room_block(Day::Mon, 450, 540, "A1103"),
                online_block(Day::Thu, 450, 540),
            ],
        );
        store.record_capture(&SCOPE, &[hybrid], T1).expect("capture");
        let modalities: Vec<String> = store
            .conn
            .prepare("SELECT modality FROM schedule_blocks ORDER BY day")
            .expect("prepare")
            .query_map([], |row| row.get::<_, String>(0))
            .expect("query")
            .map(|m| m.expect("modality"))
            .collect();
        assert_eq!(modalities, vec!["F2F".to_string(), "ONLINE".to_string()]);
    }

    #[test]
    fn helper_block_modality_matches_parser_derivation() {
        // The store's stored modality comes from ParsedBlock::modality, the
        // same derivation the parser uses.
        assert_eq!(room_block(Day::Mon, 450, 540, "A1103").modality(), Some(BlockModality::F2F));
        assert_eq!(online_block(Day::Mon, 450, 540).modality(), Some(BlockModality::Online));
    }

    // ---------- schema migrations ----------

    #[test]
    fn migration_two_adds_the_is_sample_flag_to_plans() {
        let store = store();
        let version: i64 = store
            .conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .expect("user_version must be readable");
        assert_eq!(version, 8, "a fresh database runs every migration");
        assert!(
            column_names(&store.conn, "plans").contains(&"is_sample".to_string()),
            "plans must carry the sample-data marker"
        );
    }

    #[test]
    fn migration_three_adds_the_missing_flag_to_plan_sections() {
        let store = store();
        let version: i64 = store
            .conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .expect("user_version must be readable");
        assert_eq!(version, 8, "a fresh database runs every migration");
        assert!(
            column_names(&store.conn, "plan_sections").contains(&"missing".to_string()),
            "plan_sections must carry the missing marker"
        );
    }

    /// Migration 6 removes the sample-plan feature's leftovers. It deletes
    /// rows from databases students already have, so what it must *not*
    /// reach matters more than what it removes.
    #[test]
    fn migration_six_removes_sample_data_and_leaves_every_real_row_alone() {
        let conn = Connection::open_in_memory().expect("in-memory connection");
        for migration in migrations().iter().take(5) {
            conn.execute_batch(migration).expect("migration must apply");
        }
        conn.pragma_update(None, "user_version", 5).expect("user_version");

        let sample_campus = crate::core::options::SAMPLE_CAMPUS_ID;
        let sample_session = crate::core::options::SAMPLE_SESSION_ID;
        conn.execute_batch(&format!(
            "INSERT INTO courses (campus_id, session_id, course_id, code, title) VALUES
                 ({sample_campus}, {sample_session}, 2923, 'GEARTAP', 'Sample'),
                 (7, 155, 564, 'CSINTSY', 'Real');
             INSERT INTO sections (campus_id, session_id, course_id, section_id, section_code,
                                   course_type, credits, enroll_cap, first_seen_at, last_seen_at)
             VALUES ({sample_campus}, {sample_session}, 2923, 384, 'S11', NULL, NULL, 40, 't', 't'),
                    (7, 155, 564, 737, 'Z01', NULL, NULL, 40, 't', 't');
             INSERT INTO schedule_blocks (section_fk, day, start_min, end_min, location)
             VALUES (1, 'MON', 450, 540, 'L226'), (2, 'TUE', 450, 540, 'L226');
             INSERT INTO snapshots (section_fk, captured_at, enrolled, teacher, remark)
             VALUES (1, 't', 5, NULL, NULL), (2, 't', 5, NULL, NULL);
             INSERT INTO plans (id, name, campus_id, session_id, created_at, is_sample) VALUES
                 ('sample-plan', 'Sample data', {sample_campus}, {sample_session}, 't', 1),
                 ('real-plan', 'T1 load', 7, 155, 't', 0);
             INSERT INTO plan_sections (plan_id, section_fk) VALUES
                 ('sample-plan', 1), ('real-plan', 2);"
        ))
        .expect("seed a pre-removal database");

        migrate(&conn).expect("migration six must apply");

        let plans: Vec<String> = conn
            .prepare("SELECT id FROM plans ORDER BY id")
            .expect("prepare")
            .query_map([], |row| row.get(0))
            .expect("query")
            .collect::<Result<_, _>>()
            .expect("rows");
        assert_eq!(plans, vec!["real-plan".to_string()], "only the sample plan goes");

        let count = |sql: &str| -> i64 {
            conn.query_row(sql, [], |row| row.get(0)).expect("count")
        };
        assert_eq!(
            count(&format!(
                "SELECT COUNT(*) FROM sections WHERE campus_id = {sample_campus}"
            )),
            0,
            "the fabricated catalog goes with it"
        );
        assert_eq!(count("SELECT COUNT(*) FROM sections WHERE campus_id = 7"), 1);
        assert_eq!(
            count("SELECT COUNT(*) FROM schedule_blocks"),
            1,
            "only the sample section's blocks are removed"
        );
        assert_eq!(count("SELECT COUNT(*) FROM snapshots"), 1);
        assert_eq!(count("SELECT COUNT(*) FROM courses WHERE campus_id = 7"), 1);
        assert_eq!(
            count("SELECT COUNT(*) FROM plan_sections"),
            1,
            "the real plan keeps its membership"
        );
    }

    #[test]
    fn upgrading_a_version_one_database_defaults_is_sample_off() {
        let conn = Connection::open_in_memory().expect("in-memory connection");
        conn.execute_batch(MIGRATION_V1).expect("v1 schema must apply");
        conn.pragma_update(None, "user_version", 1).expect("user_version");
        conn.execute(
            "INSERT INTO plans (id, name, campus_id, session_id, created_at)
             VALUES ('p1', 'T1', 7, 155, 't')",
            [],
        )
        .expect("a v1 plan row");

        migrate(&conn).expect("later migrations must run on the existing database");

        let version: i64 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .expect("user_version");
        assert_eq!(version, 8);
        let is_sample: i64 = conn
            .query_row("SELECT is_sample FROM plans WHERE id = 'p1'", [], |row| row.get(0))
            .expect("is_sample must be readable");
        assert_eq!(is_sample, 0, "plans created before v2 are student plans, not sample data");
    }

    #[test]
    fn upgrading_a_version_two_database_defaults_missing_off() {
        let conn = Connection::open_in_memory().expect("in-memory connection");
        conn.execute_batch(MIGRATION_V1).expect("v1 schema must apply");
        conn.execute_batch(MIGRATION_V2).expect("v2 schema must apply");
        conn.pragma_update(None, "user_version", 2).expect("user_version");
        conn.execute_batch(
            "INSERT INTO courses (campus_id, session_id, course_id, code, title)
             VALUES (7, 155, 2923, 'CSINTSY', 'TITLE');
             INSERT INTO sections (campus_id, session_id, course_id, section_id, section_code,
                                   first_seen_at, last_seen_at)
             VALUES (7, 155, 2923, 384, 'S01', 't', 't');
             INSERT INTO plans (id, name, campus_id, session_id, created_at)
             VALUES ('p1', 'T1', 7, 155, 't');",
        )
        .expect("v2 rows");
        conn.execute(
            "INSERT INTO plan_sections (plan_id, section_fk, pinned) VALUES ('p1', 1, 0)",
            [],
        )
        .expect("a v2 membership row");

        migrate(&conn).expect("the v3 migration must run on the existing database");

        let version: i64 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .expect("user_version");
        assert_eq!(version, 8);
        let missing: i64 = conn
            .query_row("SELECT missing FROM plan_sections", [], |row| row.get(0))
            .expect("missing must be readable");
        assert_eq!(missing, 0, "memberships created before v3 are not missing");
    }

    #[test]
    fn upgrading_a_version_four_database_moves_legacy_sample_rows_to_the_reserved_scope() {
        use crate::core::options::{SAMPLE_CAMPUS_ID, SAMPLE_SESSION_ID};

        let conn = Connection::open_in_memory().expect("in-memory connection");
        conn.execute_batch(MIGRATION_V1).expect("v1 schema must apply");
        conn.execute_batch(MIGRATION_V2).expect("v2 schema must apply");
        conn.execute_batch(MIGRATION_V3).expect("v3 schema must apply");
        conn.execute_batch(MIGRATION_V4).expect("v4 schema must apply");
        conn.pragma_update(None, "user_version", 4).expect("user_version");

        // A pre-ticket-27 database: the fabricated captures were seeded into
        // the real Manila / AY2026-27 T1 scope. Alongside them sit a genuine
        // capture of another course, and GEARTAP captured for real too — its
        // row is shared by the sample plan and a student plan, because dedupe
        // merges captures on the natural key.
        conn.execute_batch(
            "INSERT INTO courses (campus_id, session_id, course_id, code, title) VALUES
                (7, 155, 2923, 'CSINTSY', 'INTRODUCTION TO INTELLIGENT SYSTEMS'),
                (7, 155, 564,  'GEARTAP', 'GENERAL ENGINEERING ARTICULATION TRACK'),
                (7, 155, 3000, 'REALC',   'A REAL CAPTURE');
             INSERT INTO sections (campus_id, session_id, course_id, section_id, section_code,
                                   first_seen_at, last_seen_at) VALUES
                (7, 155, 2923, 384, 'S01', 't', 't'),
                (7, 155, 564,  737, 'Y11', 't', 't'),
                (7, 155, 3000, 400, 'S01', 't', 't');
             INSERT INTO plans (id, name, campus_id, session_id, created_at, is_sample) VALUES
                ('sample-plan', 'Sample data', 7, 155, 't', 1),
                ('p1',          'T1 load',     7, 155, 't', 0);
             INSERT INTO plan_sections (plan_id, section_fk, pinned, missing) VALUES
                ('sample-plan', 1, 0, 0),
                ('sample-plan', 2, 0, 0),
                ('p1',          2, 0, 0),
                ('p1',          3, 0, 0);
             INSERT INTO snapshots (section_fk, captured_at, enrolled, teacher) VALUES
                (1, 't', 10, NULL),
                (2, 't', 20, 'X'),
                (3, 't', 30, NULL);",
        )
        .expect("legacy rows");

        // Migration 5 in isolation, deliberately not through `migrate`:
        // migration 6 deletes the reserved-scope rows this one relocates, so
        // running the whole chain here would assert nothing about the move.
        // The end state after every migration is
        // `migration_six_removes_sample_data_and_leaves_every_real_row_alone`.
        // In a transaction, like `migrate` runs it: migration 5 opens with
        // `PRAGMA defer_foreign_keys = ON`, which is a no-op outside one, and
        // it relocates courses before the sections pointing at them.
        {
            let tx = conn.unchecked_transaction().expect("transaction");
            tx.execute_batch(&migration_v5())
                .expect("the v5 migration must run on the existing database");
            tx.pragma_update(None, "user_version", 5).expect("user_version");
            tx.commit().expect("commit");
        }

        let version: i64 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .expect("user_version");
        assert_eq!(version, 5);

        // The old sample plan follows its data into the reserved scope, so
        // it renders as Sample Campus / Sample Term instead of claiming
        // Manila / AY2026-27 T1 — never a plan the student cannot explain.
        let mut stmt = conn
            .prepare("SELECT id, campus_id, session_id FROM plans ORDER BY id")
            .expect("prepare");
        let plans: Vec<(String, i64, i64)> = stmt
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
            .expect("query")
            .map(|row| row.expect("row"))
            .collect();
        assert_eq!(
            plans,
            vec![
                ("p1".to_string(), 7, 155),
                ("sample-plan".to_string(), SAMPLE_CAMPUS_ID, SAMPLE_SESSION_ID),
            ],
        );

        // Sample-only rows moved; anything a student plan claims stays.
        let mut stmt = conn
            .prepare(
                "SELECT campus_id, session_id, course_id, section_id
                 FROM sections ORDER BY id",
            )
            .expect("prepare");
        let sections: Vec<(i64, i64, i64, i64)> = stmt
            .query_map([], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
            })
            .expect("query")
            .map(|row| row.expect("row"))
            .collect();
        assert_eq!(
            sections,
            vec![
                (SAMPLE_CAMPUS_ID, SAMPLE_SESSION_ID, 2923, 384),
                (7, 155, 564, 737),
                (7, 155, 3000, 400),
            ],
            "only rows exclusively owned by the sample plan relocate"
        );

        // The course emptied by the move follows; the others stay.
        let mut stmt = conn
            .prepare("SELECT campus_id, session_id, course_id FROM courses ORDER BY course_id")
            .expect("prepare");
        let courses: Vec<(i64, i64, i64)> = stmt
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
            .expect("query")
            .map(|row| row.expect("row"))
            .collect();
        assert_eq!(
            courses,
            vec![
                (7, 155, 564),
                (SAMPLE_CAMPUS_ID, SAMPLE_SESSION_ID, 2923),
                (7, 155, 3000),
            ],
        );

        // Nothing is hard-deleted in the process (ADR-0008).
        assert_eq!(
            count(&conn, "SELECT COUNT(*) FROM sections"),
            3,
            "every section survives the relocation"
        );
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM snapshots"), 3);
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM plan_sections"), 4);

        // After the relocation the real Manila / AY2026-27 T1 catalog holds
        // only what the student actually captured: one course, two sections.
        let summary_sections: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sections WHERE campus_id = 7 AND session_id = 155",
                [],
                |row| row.get(0),
            )
            .expect("real-scope count");
        assert_eq!(summary_sections, 2);
    }

    // ---------- plan membership and conflicts (ticket 08) ----------

    fn plan_membership_rows(conn: &Connection) -> Vec<(i64, i64, i64)> {
        let mut stmt = conn
            .prepare(
                "SELECT s.course_id, s.section_id, ps.pinned
                 FROM plan_sections ps JOIN sections s ON s.id = ps.section_fk
                 ORDER BY s.course_id, s.section_id",
            )
            .expect("plan membership select must prepare");
        stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
            .expect("plan membership select must run")
            .map(|row| row.expect("membership row"))
            .collect()
    }

    fn pinned_flag(conn: &Connection, section_id: i64) -> i64 {
        conn.query_row(
            "SELECT ps.pinned FROM plan_sections ps
             JOIN sections s ON s.id = ps.section_fk
             WHERE ps.plan_id = 'p1' AND s.section_id = ?1",
            [section_id],
            |row| row.get(0),
        )
        .expect("pinned flag must be readable")
    }

    fn overlap_fixture() -> Vec<ParsedSection> {
        vec![
            parsed_section(
                2923,
                384,
                "S01",
                None,
                Some(10),
                vec![
                    room_block(Day::Mon, 450, 540, "A1103"),
                    room_block(Day::Thu, 450, 540, "A1103"),
                ],
            ),
            parsed_section(
                2923,
                385,
                "S02",
                None,
                Some(20),
                vec![
                    room_block(Day::Mon, 480, 570, "G207"),
                    room_block(Day::Fri, 480, 570, "G207"),
                ],
            ),
        ]
    }

    #[test]
    fn adding_overlapping_sections_to_a_plan_is_legal() {
        let mut store = store();
        store.create_plan("p1", "T1 load", &SCOPE, T1).expect("plan");
        store
            .record_capture(&SCOPE, &overlap_fixture(), T1)
            .expect("capture");
        store.add_section_to_plan("p1", 2923, 384).expect("first add");
        store
            .add_section_to_plan("p1", 2923, 385)
            .expect("membership carries no validity constraint (ADR-0009)");
        assert_eq!(count(&store.conn, "SELECT COUNT(*) FROM plan_sections"), 2);
    }

    #[test]
    fn conflicts_in_plan_reports_the_overlapping_pair_day_and_range() {
        let mut store = store();
        store.create_plan("p1", "T1 load", &SCOPE, T1).expect("plan");
        store
            .record_capture(&SCOPE, &overlap_fixture(), T1)
            .expect("capture");
        store.add_section_to_plan("p1", 2923, 384).expect("add");
        store.add_section_to_plan("p1", 2923, 385).expect("add");

        assert_eq!(
            store.conflicts_in_plan("p1").expect("conflicts query"),
            vec![Conflict {
                a: SectionRef { course_id: 2923, section_id: 384 },
                b: SectionRef { course_id: 2923, section_id: 385 },
                day: Day::Mon,
                start_min: 480,
                end_min: 540,
            }],
            "Monday overlaps; Thursday and Friday are clear"
        );
    }

    #[test]
    fn conflicts_in_plan_is_clear_when_blocks_touch_without_overlapping() {
        let mut store = store();
        store.create_plan("p1", "T1 load", &SCOPE, T1).expect("plan");
        let touching = vec![
            parsed_section(2923, 384, "S01", None, Some(10), vec![
                room_block(Day::Mon, 450, 540, "A1103"),
            ]),
            parsed_section(2923, 385, "S02", None, Some(20), vec![
                room_block(Day::Mon, 540, 630, "G207"),
            ]),
        ];
        store.record_capture(&SCOPE, &touching, T1).expect("capture");
        store.add_section_to_plan("p1", 2923, 384).expect("add");
        store.add_section_to_plan("p1", 2923, 385).expect("add");
        assert!(
            store.conflicts_in_plan("p1").expect("conflicts query").is_empty(),
            "a 15-minute break between blocks is not a conflict"
        );
    }

    #[test]
    fn conflicts_in_plan_never_reports_a_section_against_itself() {
        let mut store = store();
        store.create_plan("p1", "T1 load", &SCOPE, T1).expect("plan");
        let self_overlapping = vec![parsed_section(2923, 384, "S01", None, Some(10), vec![
            room_block(Day::Mon, 450, 540, "A1103"),
            room_block(Day::Mon, 480, 570, "A1103"),
        ])];
        store
            .record_capture(&SCOPE, &self_overlapping, T1)
            .expect("capture");
        store.add_section_to_plan("p1", 2923, 384).expect("add");
        assert!(
            store.conflicts_in_plan("p1").expect("conflicts query").is_empty(),
            "a section is never compared with itself"
        );
    }

    #[test]
    fn blocks_with_unrecognized_locations_still_participate_in_conflicts() {
        let mut store = store();
        store.create_plan("p1", "T1 load", &SCOPE, T1).expect("plan");
        let mixed = vec![
            parsed_section(2923, 384, "S01", None, Some(10), vec![
                room_block(Day::Mon, 450, 540, "A1103"),
            ]),
            parsed_section(2923, 385, "S02", None, Some(20), vec![ParsedBlock {
                day: Day::Mon,
                start_min: 480,
                end_min: 570,
                location: ParsedLocation::Unrecognized("TBA".into()),
            }]),
        ];
        store.record_capture(&SCOPE, &mixed, T1).expect("capture");
        store.add_section_to_plan("p1", 2923, 384).expect("add");
        store.add_section_to_plan("p1", 2923, 385).expect("add");
        assert_eq!(
            store.conflicts_in_plan("p1").expect("conflicts query").len(),
            1,
            "conflict detection depends on times, never on modality"
        );
    }

    #[test]
    fn remove_section_from_plan_removes_membership_and_keeps_the_section_row() {
        let mut store = store();
        store.create_plan("p1", "T1 load", &SCOPE, T1).expect("plan");
        store
            .record_capture(&SCOPE, &overlap_fixture(), T1)
            .expect("capture");
        store.add_section_to_plan("p1", 2923, 384).expect("add");
        store.add_section_to_plan("p1", 2923, 385).expect("add");

        store
            .remove_section_from_plan("p1", 2923, 385)
            .expect("removal must succeed");

        assert_eq!(
            plan_membership_rows(&store.conn),
            vec![(2923, 384, 0)],
            "only the removed membership disappears"
        );
        assert_eq!(
            count(&store.conn, "SELECT COUNT(*) FROM sections WHERE section_id = 385"),
            1,
            "removing from a plan never hard-deletes the section (ADR-0008)"
        );
        assert!(
            store.conflicts_in_plan("p1").expect("conflicts query").is_empty(),
            "the conflicting partner is gone, so the conflict is gone"
        );
    }

    #[test]
    fn removing_a_section_not_in_the_plan_is_a_no_op() {
        let mut store = store();
        store.create_plan("p1", "T1 load", &SCOPE, T1).expect("plan");
        store
            .record_capture(&SCOPE, &overlap_fixture(), T1)
            .expect("capture");
        store.add_section_to_plan("p1", 2923, 384).expect("add");

        store
            .remove_section_from_plan("p1", 2923, 385)
            .expect("removing a non-member is not an error");

        assert_eq!(
            plan_membership_rows(&store.conn),
            vec![(2923, 384, 0)],
            "membership is unchanged"
        );
    }

    #[test]
    fn pinned_state_can_be_set_and_unset() {
        let mut store = store();
        store.create_plan("p1", "T1 load", &SCOPE, T1).expect("plan");
        store
            .record_capture(&SCOPE, &overlap_fixture(), T1)
            .expect("capture");
        store.add_section_to_plan("p1", 2923, 384).expect("add");

        assert_eq!(pinned_flag(&store.conn, 384), 0, "new members start unpinned");

        store.set_section_pinned("p1", 2923, 384, true).expect("pin");
        assert_eq!(pinned_flag(&store.conn, 384), 1, "pinned state persists");

        store.set_section_pinned("p1", 2923, 384, false).expect("unpin");
        assert_eq!(pinned_flag(&store.conn, 384), 0, "unpinning restores the default");
    }

    #[test]
    fn set_pinned_on_a_section_not_in_the_plan_is_an_error() {
        let mut store = store();
        store.create_plan("p1", "T1 load", &SCOPE, T1).expect("plan");
        store
            .record_capture(&SCOPE, &overlap_fixture(), T1)
            .expect("capture");
        store.add_section_to_plan("p1", 2923, 384).expect("add");

        let err = store
            .set_section_pinned("p1", 2923, 385, true)
            .expect_err("pinning a non-member must fail loudly");
        assert!(
            matches!(
                err,
                StoreError::SectionNotInPlan { course_id: 2923, section_id: 385, .. }
            ),
            "got {err:?}"
        );
        assert_eq!(plan_membership_rows(&store.conn).len(), 1, "nothing was written");
    }

    #[test]
    fn removing_or_pinning_in_an_unknown_plan_is_a_plan_error() {
        let mut store = store();
        let remove_err = store
            .remove_section_from_plan("missing", 2923, 384)
            .expect_err("removing in an unknown plan must error");
        assert!(matches!(remove_err, StoreError::PlanNotFound { .. }), "got {remove_err:?}");

        let pin_err = store
            .set_section_pinned("missing", 2923, 384, true)
            .expect_err("pinning in an unknown plan must error");
        assert!(matches!(pin_err, StoreError::PlanNotFound { .. }), "got {pin_err:?}");
    }

    #[test]
    fn membership_pinned_state_and_conflicts_survive_a_restart() {
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("store.db");
        {
            let mut store = Store::open(&path).expect("fresh file must open");
            store.create_plan("p1", "T1 load", &SCOPE, T1).expect("plan");
            store
                .record_capture(&SCOPE, &overlap_fixture(), T1)
                .expect("capture");
            store.add_section_to_plan("p1", 2923, 384).expect("add");
            store.add_section_to_plan("p1", 2923, 385).expect("add");
            store.set_section_pinned("p1", 2923, 384, true).expect("pin");
        }

        let mut reopened = Store::open(&path).expect("existing file must reopen");
        assert_eq!(
            plan_membership_rows(&reopened.conn),
            vec![(2923, 384, 1), (2923, 385, 0)],
            "membership and pinned state survive the restart"
        );
        assert_eq!(
            reopened.conflicts_in_plan("p1").expect("conflicts query").len(),
            1,
            "conflicts remain computable after the restart"
        );

        reopened
            .remove_section_from_plan("p1", 2923, 385)
            .expect("removal works after the restart");
        assert!(reopened.conflicts_in_plan("p1").expect("conflicts query").is_empty());

        reopened
            .set_section_pinned("p1", 2923, 384, false)
            .expect("unpinning works after the restart");
        assert_eq!(pinned_flag(&reopened.conn, 384), 0);
    }

    // ---------- ICS export data path (ticket 17) ----------

    /// The term span every real capture carries (`data-start-date` /
    /// `data-end-date` on the results row).
    fn dated_section(
        course_id: i64,
        section_id: i64,
        section_code: &str,
        teacher: Option<&str>,
        blocks: Vec<ParsedBlock>,
    ) -> ParsedSection {
        let mut section = parsed_section(course_id, section_id, section_code, teacher, Some(10), blocks);
        section.remark = Some("Bring laptop".into());
        section.start_date = Some(chrono::NaiveDate::from_ymd_opt(2026, 7, 10).expect("start"));
        section.end_date = Some(chrono::NaiveDate::from_ymd_opt(2026, 12, 9).expect("end"));
        section
    }

    #[test]
    fn captures_persist_the_sections_term_dates() {
        let mut store = store();
        store
            .record_capture(&SCOPE, &[dated_section(2923, 384, "S01", None, vec![])], T1)
            .expect("capture with dates");
        assert_eq!(
            store
                .conn
                .query_row(
                    "SELECT start_date, end_date FROM sections WHERE section_id = 384",
                    [],
                    |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
                )
                .expect("dates must be stored"),
            ("2026-07-10".into(), "2026-12-09".into()),
            "the term span survives into storage as ISO dates"
        );

        // A later capture without dates replaces them: the store keeps what
        // the latest capture said, exactly like it does for blocks.
        let undated = parsed_section(2923, 384, "S01", None, Some(11), vec![]);
        store.record_capture(&SCOPE, &[undated], T2).expect("re-capture");
        assert_eq!(
            store
                .conn
                .query_row(
                    "SELECT COUNT(*) FROM sections WHERE section_id = 384 AND start_date IS NULL",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .expect("null date count"),
            1,
            "a re-capture without dates overwrites them"
        );
    }

    #[test]
    fn loading_a_plan_export_returns_the_plan_name_and_every_member_in_full() {
        let mut store = store();
        store.create_plan("p1", "T1 load", &SCOPE, T1).expect("plan");
        let hybrid = dated_section(
            2923,
            384,
            "S01",
            Some("Bryant Lee"),
            vec![
                room_block(Day::Mon, 975, 1065, "A1103"),
                online_block(Day::Thu, 975, 1065),
            ],
        );
        let online = dated_section(
            564,
            737,
            "Y11",
            None,
            vec![online_block(Day::Sat, 660, 750)],
        );
        store.record_capture(&SCOPE, &[hybrid], T1).expect("capture");
        store.record_capture(&SCOPE, &[online], T1).expect("capture");
        store.add_section_to_plan("p1", 2923, 384).expect("add");
        store.add_section_to_plan("p1", 564, 737).expect("add");

        let export = store.load_plan_ics_export("p1").expect("export input");

        assert_eq!(export.name, "T1 load");
        // Ordered by course id: 564 < 2923.
        assert_eq!(
            export
                .sections
                .iter()
                .map(|s| (s.course_code.as_str(), s.section_code.as_str()))
                .collect::<Vec<_>>(),
            vec![("CSINTSY", "Y11"), ("CSINTSY", "S01")],
            "members come back deterministically ordered"
        );
        let s01 = &export.sections[1];
        assert_eq!(s01.course_id, 2923);
        assert_eq!(s01.section_id, 384);
        assert_eq!(
            s01.teacher.as_deref(),
            Some("Bryant Lee"),
            "teacher comes from the latest snapshot"
        );
        assert_eq!(s01.remark.as_deref(), Some("Bring laptop"));
        assert_eq!(
            (s01.start_date, s01.end_date),
            (
                chrono::NaiveDate::from_ymd_opt(2026, 7, 10).unwrap(),
                chrono::NaiveDate::from_ymd_opt(2026, 12, 9).unwrap()
            ),
        );
        assert_eq!(
            s01.blocks,
            vec![
                ExportBlock {
                    day: Day::Mon,
                    start_min: 975,
                    end_min: 1065,
                    location: Some("A1103".into()),
                },
                ExportBlock {
                    day: Day::Thu,
                    start_min: 975,
                    end_min: 1065,
                    location: None,
                },
            ],
            "blocks keep day, times, and the online/room distinction"
        );
        let y11 = &export.sections[0];
        assert_eq!(y11.course_id, 564);
        assert_eq!(y11.section_id, 737);
        assert_eq!(y11.teacher, None);
        assert_eq!(y11.blocks.len(), 1);
        assert_eq!(y11.blocks[0].day, Day::Sat);
        assert_eq!(y11.blocks[0].location, None);
    }

    #[test]
    fn the_export_carries_the_teacher_from_the_latest_snapshot_not_the_first() {
        let mut store = store();
        store.create_plan("p1", "T1 load", &SCOPE, T1).expect("plan");
        store
            .record_capture(
                &SCOPE,
                &[dated_section(2923, 384, "S01", None, vec![])],
                T1,
            )
            .expect("first capture: no teacher yet");
        store.add_section_to_plan("p1", 2923, 384).expect("add");

        let before = store.load_plan_ics_export("p1").expect("export input");
        assert_eq!(before.sections[0].teacher, None);

        store
            .record_capture(
                &SCOPE,
                &[dated_section(2923, 384, "S01", Some("Bryant Lee"), vec![])],
                T2,
            )
            .expect("second capture: teacher populated");
        let after = store.load_plan_ics_export("p1").expect("export input");
        assert_eq!(
            after.sections[0].teacher.as_deref(),
            Some("Bryant Lee"),
            "the newest snapshot wins; earlier ones stay history"
        );
    }

    #[test]
    fn a_member_without_captured_dates_is_a_loud_error_never_a_silent_skip() {
        let mut store = store();
        store.create_plan("p1", "T1 load", &SCOPE, T1).expect("plan");
        store
            .record_capture(
                &SCOPE,
                &[parsed_section(2923, 384, "S01", None, Some(10), vec![])],
                T1,
            )
            .expect("capture without dates");
        store.add_section_to_plan("p1", 2923, 384).expect("add");

        let err = store
            .load_plan_ics_export("p1")
            .expect_err("missing term dates must fail loudly");
        assert!(
            matches!(
                err,
                StoreError::SectionDatesMissing { course_id: 2923, section_id: 384 }
            ),
            "got {err:?}"
        );
    }

    #[test]
    fn loading_an_ics_export_of_an_unknown_plan_is_a_plan_error() {
        let store = store();
        let err = store
            .load_plan_ics_export("missing")
            .expect_err("an unknown plan must error");
        assert!(matches!(err, StoreError::PlanNotFound { .. }), "got {err:?}");
    }

    // ---------- capture summary ----------

    // ---------- undo ----------

    // ---------- forget a captured course (ticket 29) ----------

    #[test]
    fn forgetting_a_course_removes_its_sections_blocks_snapshots_and_nothing_else() {
        let mut store = store();
        store
            .record_capture(
                &SCOPE,
                &[
                    parsed_section(2923, 384, "S01", None, Some(10), vec![online_block(Day::Mon, 450, 540)]),
                    parsed_section(2923, 385, "S02", Some("Bryant Lee"), Some(20), vec![
                        room_block(Day::Tue, 870, 960, "L226"),
                    ]),
                ],
                T1,
            )
            .expect("capture the course to forget");
        store
            .record_capture(
                &SCOPE,
                &[parsed_section(564, 737, "Y11", None, Some(30), vec![room_block(Day::Wed, 450, 540, "V501")])],
                T2,
            )
            .expect("capture a course that stays");

        let outcome = store.forget_course(&SCOPE, 2923).expect("forget must succeed");

        assert!(
            outcome.affected_plans.is_empty(),
            "a course no plan holds reports no affected plans, got {:?}",
            outcome.affected_plans
        );
        assert_eq!(
            (outcome.summary.campus_id, outcome.summary.session_id),
            (7, 155),
            "the summary describes the scope the removal ran in"
        );
        assert_eq!(outcome.summary.section_count, 1, "only the surviving section is counted");
        assert_eq!(outcome.summary.course_count, 1, "only the surviving course is counted");

        assert_eq!(
            section_rows(&store.conn),
            vec![(7, 155, 564, 737, "Y11".into(), T2.into(), T2.into())],
            "every row of the forgotten course goes; the other course keeps its rows"
        );
        assert_eq!(
            snapshot_rows(&store.conn),
            vec![(737, T2.to_string(), Some(30), None)],
            "the forgotten sections' snapshots go with them"
        );
        assert_eq!(
            block_rows(&store.conn),
            vec![(737, "WED".into(), 450, 540, Some("V501".into()), Some("F2F".into()))],
            "the forgotten sections' blocks go with them; others stay"
        );
        let listed = store.captured_courses(&SCOPE).expect("captured courses");
        assert_eq!(
            listed.iter().map(|course| course.course_id).collect::<Vec<_>>(),
            vec![564],
            "list_captured_courses reflects the removal immediately"
        );
    }

    #[test]
    fn forgetting_a_held_course_releases_its_sections_from_every_holding_plan_and_reports_what_each_lost() {
        let mut store = store();
        store.create_plan("p1", "First", &SCOPE, T1).expect("plan p1");
        store.create_plan("p2", "Second", &SCOPE, T1).expect("plan p2");
        store
            .record_capture(
                &SCOPE,
                &[
                    parsed_section(2923, 384, "S01", None, Some(10), vec![]),
                    parsed_section(2923, 385, "S02", None, Some(20), vec![]),
                    parsed_section(564, 737, "Y11", None, Some(30), vec![]),
                ],
                T1,
            )
            .expect("capture");
        store.add_section_to_plan("p1", 2923, 384).expect("p1 holds S01");
        store.set_section_pinned("p1", 2923, 384, true).expect("pin p1's S01");
        store
            .add_section_to_plan("p1", 564, 737)
            .expect("p1 holds a section of another course");
        store.add_section_to_plan("p2", 2923, 385).expect("p2 holds S02");

        let outcome = store
            .forget_course(&SCOPE, 2923)
            .expect("a held course is released from its plans, not refused");

        assert_eq!(
            outcome.affected_plans,
            vec![
                AffectedPlan { plan_id: "p1".into(), removed_sections: 1 },
                AffectedPlan { plan_id: "p2".into(), removed_sections: 1 },
            ],
            "the report names every affected plan and how many sections each lost"
        );

        // Membership of the forgotten course is gone everywhere, pinned or
        // not; the only surviving membership is the other course's.
        assert_eq!(count(&store.conn, "SELECT COUNT(*) FROM plan_sections"), 1);
        let remaining: (String, i64, i64) = store
            .conn
            .query_row(
                "SELECT ps.plan_id, s.course_id, s.section_id FROM plan_sections ps
                 JOIN sections s ON s.id = ps.section_fk",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("the surviving membership must be readable");
        assert_eq!(
            remaining,
            ("p1".into(), 564, 737),
            "only the named course's sections leave a plan; the rest is untouched"
        );

        // The catalog lost exactly the named course.
        assert_eq!(section_rows(&store.conn).len(), 1);
        assert_eq!(snapshot_rows(&store.conn).len(), 1);
        assert_eq!(count(&store.conn, "SELECT COUNT(*) FROM courses"), 1);

        // Both plans survive; p1 keeps its other section, p2 is empty but
        // still a plan — never deleted as a side effect.
        let p1 = store.get_plan("p1").expect("p1 survives the removal");
        let p2 = store.get_plan("p2").expect("p2 survives the removal");
        assert_eq!(p1.sections.len(), 1);
        assert_eq!(p1.sections[0].section_id, 737);
        assert!(p2.sections.is_empty(), "a plan emptied by the removal is still a plan");

        assert_eq!(
            outcome.summary,
            store.capture_summary(&SCOPE).expect("summary"),
            "the returned summary is the same source of truth the counter reads"
        );
        assert_eq!(
            (outcome.summary.section_count, outcome.summary.course_count),
            (1, 1)
        );
    }

    #[test]
    fn a_failure_part_way_through_forgetting_rolls_everything_back() {
        let mut store = store();
        store.create_plan("p1", "First", &SCOPE, T1).expect("plan p1");
        store
            .record_capture(
                &SCOPE,
                &[
                    parsed_section(
                        2923,
                        384,
                        "S01",
                        None,
                        Some(10),
                        vec![online_block(Day::Mon, 450, 540)],
                    ),
                    parsed_section(
                        564,
                        737,
                        "Y11",
                        None,
                        Some(30),
                        vec![online_block(Day::Tue, 450, 540)],
                    ),
                ],
                T1,
            )
            .expect("capture");
        store.add_section_to_plan("p1", 2923, 384).expect("p1 holds S01");
        store
            .conn
            .execute_batch(
                "CREATE TRIGGER fail_block_delete BEFORE DELETE ON schedule_blocks
                 BEGIN SELECT RAISE(ABORT, 'injected failure'); END;",
            )
            .expect("the failing trigger installs");

        let err = store
            .forget_course(&SCOPE, 2923)
            .expect_err("a failure part-way must surface as an error");
        assert!(
            err.to_string().contains("injected failure"),
            "the injected failure is what surfaced, got: {err}"
        );

        // Everything is exactly as it was: membership, sections, snapshots,
        // blocks, and the course row.
        assert_eq!(count(&store.conn, "SELECT COUNT(*) FROM plan_sections"), 1);
        assert_eq!(count(&store.conn, "SELECT COUNT(*) FROM sections"), 2);
        assert_eq!(count(&store.conn, "SELECT COUNT(*) FROM snapshots"), 2);
        assert_eq!(count(&store.conn, "SELECT COUNT(*) FROM schedule_blocks"), 2);
        assert_eq!(count(&store.conn, "SELECT COUNT(*) FROM courses"), 2);

        // With the trigger gone the same removal completes.
        store
            .conn
            .execute_batch("DROP TRIGGER fail_block_delete;")
            .expect("the failing trigger drops");
        let outcome = store
            .forget_course(&SCOPE, 2923)
            .expect("the removal succeeds once the trigger is gone");
        assert_eq!(
            outcome.affected_plans,
            vec![AffectedPlan { plan_id: "p1".into(), removed_sections: 1 }]
        );
    }

    #[test]
    fn forgetting_in_one_scope_leaves_the_same_course_id_in_another_scope_alone() {
        let mut store = store();
        store
            .record_capture(&SCOPE, &[parsed_section(2923, 384, "S01", None, Some(10), vec![])], T1)
            .expect("scope A capture");
        store
            .record_capture(
                &OTHER_SCOPE,
                &[parsed_section(2923, 384, "S01", Some("Elsewhere"), Some(20), vec![])],
                T1,
            )
            .expect("scope B capture of the same course id");
        store.create_plan("pb", "Other term", &OTHER_SCOPE, T1).expect("other plan");
        store.add_section_to_plan("pb", 2923, 384).expect("the other plan holds its scope's section");

        store.forget_course(&SCOPE, 2923).expect("forget in scope A");

        let rows = section_rows(&store.conn);
        assert_eq!(rows.len(), 1, "only the named scope's rows went");
        assert_eq!(
            rows[0],
            (8, 156, 2923, 384, "S01".into(), T1.into(), T1.into()),
            "the same course id under another campus/session is untouched"
        );
        let summary = store.capture_summary(&OTHER_SCOPE).expect("other-scope summary");
        assert_eq!((summary.section_count, summary.course_count), (1, 1));
    }

    #[test]
    fn a_plan_of_any_scope_holding_a_section_loses_that_membership_and_is_reported() {
        // add_section_to_plan can never produce this state — membership is
        // always scope-checked — but the removal must not depend on that: it
        // keys on the section rows being removed, so a plan of any scope
        // holding one of them is released and named in the report, never
        // FK-crashed.
        let mut store = store();
        store
            .record_capture(&SCOPE, &[parsed_section(2923, 384, "S01", None, Some(10), vec![])], T1)
            .expect("capture");
        store.create_plan("pb", "Other term", &OTHER_SCOPE, T1).expect("other-scope plan");
        let section_fk: i64 = store
            .conn
            .query_row("SELECT id FROM sections WHERE section_id = 384", [], |row| row.get(0))
            .expect("section row");
        store
            .conn
            .execute(
                "INSERT INTO plan_sections (plan_id, section_fk, pinned) VALUES ('pb', ?1, 0)",
                [section_fk],
            )
            .expect("the out-of-band membership");

        let outcome = store.forget_course(&SCOPE, 2923).expect("any holder is released, not refused");
        assert_eq!(
            outcome.affected_plans,
            vec![AffectedPlan { plan_id: "pb".into(), removed_sections: 1 }]
        );
        assert_eq!(count(&store.conn, "SELECT COUNT(*) FROM sections"), 0, "the catalog went");
        assert_eq!(count(&store.conn, "SELECT COUNT(*) FROM plan_sections"), 0, "the membership went too");
        assert_eq!(count(&store.conn, "SELECT COUNT(*) FROM plans"), 1, "the plan survives");
    }

    #[test]
    fn forgetting_an_unknown_course_is_a_loud_error() {
        let mut store = store();
        let err = store
            .forget_course(&SCOPE, 2923)
            .expect_err("there is nothing to forget");
        assert!(
            matches!(
                err,
                StoreError::CourseNotFound {
                    campus_id: 7,
                    session_id: 155,
                    course_id: 2923
                }
            ),
            "got {err:?}"
        );
        assert!(err.to_string().contains("2923"));
    }

    // ---------- refresh (ticket 16) ----------

    fn missing_flag(conn: &Connection, section_id: i64) -> i64 {
        conn.query_row(
            "SELECT ps.missing FROM plan_sections ps
             JOIN sections s ON s.id = ps.section_fk
             WHERE ps.plan_id = 'p1' AND s.section_id = ?1",
            [section_id],
            |row| row.get(0),
        )
        .expect("missing flag must be readable")
    }

    #[test]
    fn refresh_courses_covers_every_captured_course_in_scope_carrying_plan_section_ids() {
        let mut store = store();
        store.create_plan("p1", "T1 load", &SCOPE, T1).expect("plan");
        let mut geartap_y11 = parsed_section(564, 737, "Y11", None, Some(10), vec![]);
        geartap_y11.course_code = "GEARTAP".into();
        let mut geartap_y12 = parsed_section(564, 738, "Y12", None, Some(10), vec![]);
        geartap_y12.course_code = "GEARTAP".into();
        let mut spare = parsed_section(999, 500, "X01", None, Some(5), vec![]);
        spare.course_code = "SPARE".into();
        // Captured out of order so course-id ordering is what is asserted.
        let catalog = vec![
            parsed_section(2923, 384, "S01", None, Some(10), vec![]),
            parsed_section(2923, 385, "S02", None, Some(20), vec![]),
            geartap_y11,
            geartap_y12,
            spare,
        ];
        store.record_capture(&SCOPE, &catalog, T1).expect("capture");
        store.add_section_to_plan("p1", 2923, 385).expect("add S02");
        store.add_section_to_plan("p1", 564, 737).expect("add Y11");
        store.add_section_to_plan("p1", 2923, 384).expect("add S01");

        let courses = store.refresh_courses("p1").expect("refresh courses");
        assert_eq!(
            courses.len(),
            3,
            "every captured course is refreshed, not only the ones already chosen"
        );
        // Plan courses first, each ordered by course id, then the rest. A run
        // can halt on an expired session and keep what it got, so the numbers
        // the student has committed to land before a halt can take the rest.
        assert_eq!(courses[0].course_id, 564, "plan courses come first, by course id");
        assert_eq!(courses[0].code, "GEARTAP");
        assert_eq!(courses[0].plan_section_ids, vec![737]);
        assert_eq!(courses[1].course_id, 2923);
        assert_eq!(courses[1].code, "CSINTSY");
        assert_eq!(courses[1].plan_section_ids, vec![384, 385]);
        // A course the student is still weighing carries no plan sections, so
        // nothing of it can be flagged missing — its numbers still refresh.
        assert_eq!(courses[2].course_id, 999, "courses not yet chosen come last");
        assert_eq!(courses[2].code, "SPARE");
        assert!(
            courses[2].plan_section_ids.is_empty(),
            "a course with no plan membership has nothing to flag missing"
        );
    }

    #[test]
    fn refresh_courses_stays_inside_the_plan_scope() {
        // A plan is hard-scoped to one (campus, session). Widening refresh to
        // the captured catalog must not widen it across scopes.
        let mut store = store();
        store.create_plan("p1", "T1 load", &SCOPE, T1).expect("plan");
        store
            .record_capture(&SCOPE, &[parsed_section(2923, 384, "S01", None, Some(10), vec![])], T1)
            .expect("in-scope capture");
        store
            .record_capture(
                &OTHER_SCOPE,
                &[parsed_section(777, 100, "Q01", None, Some(10), vec![])],
                T1,
            )
            .expect("out-of-scope capture");

        let courses = store.refresh_courses("p1").expect("refresh courses");
        assert_eq!(courses.len(), 1, "only the plan's own scope is refreshed");
        assert_eq!(courses[0].course_id, 2923);
    }

    #[test]
    fn plan_scope_of_exposes_the_scope_a_refresh_run_is_routed_by() {
        let mut store = store();
        store.create_plan("p1", "T1 load", &SCOPE, T1).expect("plan");
        assert_eq!(
            store.plan_scope_of("p1").expect("scope"),
            SCOPE,
            "the run is scoped to the plan being refreshed"
        );
        let err = store
            .plan_scope_of("missing")
            .expect_err("an unknown plan cannot scope a run");
        assert!(err.to_string().contains("not found"), "got: {err}");
    }

    #[test]
    fn refresh_courses_is_empty_when_nothing_is_captured_in_scope() {
        let mut store = store();
        store.create_plan("p1", "T1 load", &SCOPE, T1).expect("plan");
        assert!(store.refresh_courses("p1").expect("refresh courses").is_empty());
    }

    #[test]
    fn refresh_courses_still_covers_the_catalog_when_the_plan_is_empty() {
        // Enrolment numbers on candidate sections are what the picker shows
        // and what exclude-full solves against. An empty plan is exactly when
        // those numbers matter most.
        let mut store = store();
        store.create_plan("p1", "T1 load", &SCOPE, T1).expect("plan");
        store
            .record_capture(&SCOPE, &[parsed_section(2923, 384, "S01", None, Some(10), vec![])], T1)
            .expect("capture");

        let courses = store.refresh_courses("p1").expect("refresh courses");
        assert_eq!(courses.len(), 1);
        assert_eq!(courses[0].course_id, 2923);
        assert!(courses[0].plan_section_ids.is_empty());
    }

    #[test]
    fn apply_refresh_appends_snapshots_and_marks_a_vanished_section_missing() {
        let mut store = store();
        store.create_plan("p1", "T1 load", &SCOPE, T1).expect("plan");
        let initial = vec![
            parsed_section(2923, 384, "S01", None, Some(10), vec![online_block(Day::Mon, 450, 540)]),
            parsed_section(2923, 385, "S02", Some("Bryant Lee"), Some(20), vec![]),
        ];
        store.record_capture(&SCOPE, &initial, T1).expect("initial capture");
        store.add_section_to_plan("p1", 2923, 384).expect("add S01");
        store.add_section_to_plan("p1", 2923, 385).expect("add S02");

        // The refresh finds only S01: S02 has vanished from the results.
        let refreshed = vec![
            parsed_section(2923, 384, "S01", None, Some(11), vec![online_block(Day::Mon, 450, 540)]),
        ];
        store.apply_refresh("p1", 2923, &refreshed, T2).expect("refresh");

        assert_eq!(missing_flag(&store.conn, 384), 0, "S01 still appears");
        assert_eq!(missing_flag(&store.conn, 385), 1, "S02 vanished and is flagged");
        assert_eq!(
            count(&store.conn, "SELECT COUNT(*) FROM sections"),
            2,
            "no section is ever deleted (ADR-0008)"
        );
        assert_eq!(
            count(&store.conn, "SELECT COUNT(*) FROM snapshots"),
            3,
            "the refresh appends a snapshot; history stays readable"
        );
        let s02_snapshots = count(
            &store.conn,
            "SELECT COUNT(*) FROM snapshots sn JOIN sections s ON s.id = sn.section_fk
             WHERE s.section_id = 385",
        );
        assert_eq!(s02_snapshots, 1, "S02 keeps its history");
        let s01_rows = section_rows(&store.conn)
            .into_iter()
            .find(|row| row.3 == 384)
            .expect("S01 row");
        assert_eq!(s01_rows.6, T2, "S01's last_seen_at advances on refresh");
    }

    #[test]
    fn a_later_refresh_finding_the_section_again_clears_the_missing_flag() {
        let mut store = store();
        store.create_plan("p1", "T1 load", &SCOPE, T1).expect("plan");
        let initial = vec![
            parsed_section(2923, 384, "S01", None, Some(10), vec![]),
            parsed_section(2923, 385, "S02", None, Some(20), vec![]),
        ];
        store.record_capture(&SCOPE, &initial, T1).expect("initial capture");
        store.add_section_to_plan("p1", 2923, 384).expect("add S01");
        store.add_section_to_plan("p1", 2923, 385).expect("add S02");

        store
            .apply_refresh("p1", 2923, &[initial[0].clone()], T2)
            .expect("first refresh");
        assert_eq!(missing_flag(&store.conn, 385), 1, "S02 flagged missing");

        store.apply_refresh("p1", 2923, &initial, T2).expect("second refresh");
        assert_eq!(missing_flag(&store.conn, 385), 0, "S02 reappears: flag cleared");
        assert_eq!(missing_flag(&store.conn, 384), 0);
    }

    #[test]
    fn missing_sections_returns_the_vanished_section_with_alternatives() {
        let mut store = store();
        store.create_plan("p1", "T1 load", &SCOPE, T1).expect("plan");
        let catalog = vec![
            parsed_section(2923, 384, "S01", None, Some(10), vec![
                online_block(Day::Mon, 450, 540),
            ]),
            parsed_section(2923, 385, "S02", Some("Bryant Lee"), Some(20), vec![
                room_block(Day::Tue, 870, 960, "L226"),
                online_block(Day::Fri, 870, 960),
            ]),
            parsed_section(2923, 386, "S03", None, Some(30), vec![
                room_block(Day::Wed, 660, 750, "A1103"),
            ]),
        ];
        store.record_capture(&SCOPE, &catalog, T1).expect("catalog capture");
        store.add_section_to_plan("p1", 2923, 384).expect("the plan holds S01 only");

        // The refresh finds only S02 and S03: S01 has vanished.
        let refreshed = vec![catalog[1].clone(), catalog[2].clone()];
        store.apply_refresh("p1", 2923, &refreshed, T2).expect("refresh");

        let missing = store.missing_sections("p1").expect("missing query");
        assert_eq!(missing.len(), 1);
        assert_eq!(missing[0].course_id, 2923);
        assert_eq!(missing[0].section_id, 384);
        assert_eq!(missing[0].section_code, "S01");

        let alternatives = &missing[0].alternatives;
        assert_eq!(
            alternatives.iter().map(|s| s.section_code.as_str()).collect::<Vec<_>>(),
            vec!["S02", "S03"],
            "alternatives are the other sections of the same course"
        );
        assert_eq!(alternatives[0].course_code, "CSINTSY");
        assert_eq!(alternatives[0].latest_snapshot.teacher.as_deref(), Some("Bryant Lee"));
        assert_eq!(alternatives[0].latest_snapshot.enrolled, 20);
        assert_eq!(alternatives[0].modality, SectionModality::Hybrid);
        assert_eq!(alternatives[0].blocks.len(), 2);
        assert_eq!(alternatives[0].blocks[0].modality, BlockModality::F2F);
        assert_eq!(alternatives[0].blocks[0].location.as_deref(), Some("L226"));
        assert_eq!(alternatives[0].blocks[1].modality, BlockModality::Online);
        assert_eq!(alternatives[0].blocks[1].location, None);
        assert_eq!(alternatives[1].modality, SectionModality::F2F);

        // The vanished section's row is untouched — only the flag changed.
        assert_eq!(
            count(&store.conn, "SELECT COUNT(*) FROM sections WHERE section_id = 384"),
            1,
            "the missing section is never removed"
        );
    }

    #[test]
    fn missing_sections_is_empty_when_nothing_is_missing() {
        let mut store = store();
        store.create_plan("p1", "T1 load", &SCOPE, T1).expect("plan");
        let sections = vec![parsed_section(2923, 384, "S01", None, Some(10), vec![])];
        store.record_capture(&SCOPE, &sections, T1).expect("capture");
        store.add_section_to_plan("p1", 2923, 384).expect("add");

        store.apply_refresh("p1", 2923, &sections, T2).expect("refresh");
        assert!(store.missing_sections("p1").expect("missing query").is_empty());
    }

    #[test]
    fn apply_refresh_in_an_unknown_plan_is_a_plan_error() {
        let mut store = store();
        let err = store
            .apply_refresh("missing", 2923, &[], T1)
            .expect_err("refreshing an unknown plan must error");
        assert!(matches!(err, StoreError::PlanNotFound { .. }), "got {err:?}");
    }

    #[test]
    fn unclassified_blocks_surface_in_alternatives_with_their_raw_location() {
        let mut store = store();
        store.create_plan("p1", "T1 load", &SCOPE, T1).expect("plan");
        let catalog = vec![
            parsed_section(2923, 384, "S01", None, Some(10), vec![]),
            parsed_section(2923, 385, "S02", None, Some(20), vec![ParsedBlock {
                day: Day::Sat,
                start_min: 660,
                end_min: 750,
                location: ParsedLocation::Unrecognized("TBA".into()),
            }]),
        ];
        store.record_capture(&SCOPE, &catalog, T1).expect("capture");
        store.add_section_to_plan("p1", 2923, 384).expect("add S01");

        store
            .apply_refresh("p1", 2923, &[catalog[1].clone()], T2)
            .expect("refresh");
        let missing = store.missing_sections("p1").expect("missing query");
        assert_eq!(missing.len(), 1);
        let alternatives = &missing[0].alternatives;
        assert_eq!(alternatives.len(), 1);
        assert_eq!(
            alternatives[0].blocks[0].location.as_deref(),
            Some("TBA"),
            "the raw location text survives into the wire view"
        );
    }

    // ---------- plan lifecycle queries (ticket 25) ----------

    #[test]
    fn list_plans_returns_every_saved_plan_with_its_section_count() {
        let mut store = store();
        store.create_plan("p1", "First", &SCOPE, T1).expect("plan");
        store.create_plan("p2", "Second", &OTHER_SCOPE, T2)
            .expect("second plan");
        store
            .record_capture(&SCOPE, &[parsed_section(2923, 384, "S01", None, Some(10), vec![])], T1)
            .expect("capture");
        store.add_section_to_plan("p1", 2923, 384).expect("add");

        let rows = store.list_plans().expect("list plans");
        assert_eq!(rows.len(), 2, "every saved plan is listed");
        assert_eq!(
            rows.iter().map(|row| row.id.as_str()).collect::<Vec<_>>(),
            vec!["p1", "p2"],
            "plans come back in creation order"
        );
        let second = &rows[1];
        assert_eq!(second.name, "Second");
        assert_eq!((second.campus_id, second.session_id), (8, 156));
        assert_eq!(second.created_at, T2);
        assert_eq!(first_of(&rows).section_count, 1, "membership is counted");
    }

    fn first_of(rows: &[PlanSummaryRow]) -> &PlanSummaryRow {
        &rows[0]
    }

    #[test]
    fn get_plan_returns_every_member_with_flags_blocks_modality_and_latest_snapshot() {
        let mut store = store();
        store.create_plan("p1", "T1 load", &SCOPE, T1).expect("plan");
        let hybrid = parsed_section(
            564,
            737,
            "Y11",
            Some("Bryant Lee"),
            Some(39),
            vec![
                room_block(Day::Tue, 870, 960, "L226"),
                online_block(Day::Fri, 870, 960),
            ],
        );
        let plain = parsed_section(2923, 384, "S01", None, Some(10), vec![
            room_block(Day::Mon, 450, 540, "A1103"),
        ]);
        store.record_capture(&SCOPE, &[hybrid, plain], T1).expect("capture");
        store.add_section_to_plan("p1", 564, 737).expect("add hybrid");
        store.add_section_to_plan("p1", 2923, 384).expect("add plain");
        store.set_section_pinned("p1", 564, 737, true).expect("pin");

        // The refresh no longer sees S01, flagging it missing.
        store
            .apply_refresh("p1", 2923, &[parsed_section(2923, 999, "S99", None, Some(5), vec![])], T2)
            .expect("refresh flags the vanished member");

        let plan = store.get_plan("p1").expect("get plan");
        assert_eq!(plan.summary.id, "p1");
        assert_eq!(plan.summary.section_count, 2);

        let sections: Vec<(i64, bool, bool)> = plan
            .sections
            .iter()
            .map(|s| (s.section_id, s.pinned, s.missing))
            .collect();
        assert_eq!(
            sections,
            vec![(737, true, false), (384, false, true)],
            "members in (course, section) order carrying their pinned and missing flags"
        );

        let y11 = &plan.sections[0];
        assert_eq!(y11.course_code, "CSINTSY");
        assert_eq!(y11.course_title, "INTRODUCTION TO INTELLIGENT SYSTEMS");
        assert_eq!(y11.section_code, "Y11");
        assert_eq!(y11.modality, SectionModality::Hybrid, "modality derives from blocks");
        assert_eq!(y11.blocks.len(), 2, "per-block schedule crosses the seam");
        assert_eq!(y11.blocks[0].day, Day::Tue);
        assert_eq!(y11.blocks[0].modality, BlockModality::F2F);
        assert_eq!(y11.blocks[0].location.as_deref(), Some("L226"));
        assert_eq!(y11.blocks[1].modality, BlockModality::Online);
        assert_eq!(y11.blocks[1].location, None);
        assert_eq!(y11.latest_snapshot.teacher.as_deref(), Some("Bryant Lee"));
        assert_eq!(y11.latest_snapshot.enrolled, 39);
    }

    #[test]
    fn get_plan_of_an_empty_or_unknown_plan_behaves_loudly() {
        let mut store = store();
        let err = store.get_plan("missing").expect_err("unknown plan must error");
        assert!(matches!(err, StoreError::PlanNotFound { .. }), "got {err:?}");

        store.create_plan("empty", "Empty", &SCOPE, T1).expect("plan");
        let plan = store.get_plan("empty").expect("an empty plan still loads");
        assert_eq!(plan.summary.section_count, 0);
        assert!(plan.sections.is_empty(), "no members means an empty list, never null");
    }

    #[test]
    fn delete_plan_removes_the_plan_and_memberships_but_keeps_captured_sections() {
        let mut store = store();
        store.create_plan("p1", "T1 load", &SCOPE, T1).expect("plan");
        store
            .record_capture(&SCOPE, &overlap_fixture(), T1)
            .expect("capture");
        store.add_section_to_plan("p1", 2923, 384).expect("add");
        store.add_section_to_plan("p1", 2923, 385).expect("add");

        store.delete_plan("p1").expect("delete must succeed");

        assert_eq!(count(&store.conn, "SELECT COUNT(*) FROM plans"), 0, "the plan row is gone");
        assert_eq!(
            count(&store.conn, "SELECT COUNT(*) FROM plan_sections"),
            0,
            "its membership rows are gone too"
        );
        assert_eq!(
            count(&store.conn, "SELECT COUNT(*) FROM sections"),
            2,
            "captured sections survive — deleting a plan is not a section delete (ADR-0008)"
        );
        assert_eq!(
            count(&store.conn, "SELECT COUNT(*) FROM snapshots"),
            2,
            "snapshot history survives untouched"
        );
        assert!(store.list_plans().expect("list plans").is_empty());
        let err = store
            .conflicts_in_plan("p1")
            .expect_err("a deleted plan cannot answer queries any more");
        assert!(matches!(err, StoreError::PlanNotFound { .. }), "got {err:?}");
    }

    #[test]
    fn deleting_a_plan_leaves_other_plans_and_their_memberships_intact() {
        let mut store = store();
        store.create_plan("p1", "Keep", &SCOPE, T1).expect("plan");
        store.create_plan("p2", "Drop", &SCOPE, T2).expect("plan");
        store
            .record_capture(&SCOPE, &[parsed_section(2923, 384, "S01", None, Some(10), vec![])], T1)
            .expect("capture");
        store.add_section_to_plan("p1", 2923, 384).expect("add to keep");
        store.add_section_to_plan("p2", 2923, 384).expect("add to drop");

        store.delete_plan("p2").expect("delete p2");

        let remaining = store.list_plans().expect("list plans");
        assert_eq!(remaining.iter().map(|row| row.id.as_str()).collect::<Vec<_>>(), vec!["p1"]);
        assert_eq!(
            count(&store.conn, "SELECT COUNT(*) FROM plan_sections WHERE plan_id = 'p1'"),
            1,
            "the surviving plan keeps its membership"
        );
    }

    #[test]
    fn deleting_an_unknown_plan_is_a_plan_error() {
        let mut store = store();
        let err = store.delete_plan("missing").expect_err("unknown plan must error");
        assert!(matches!(err, StoreError::PlanNotFound { .. }), "got {err:?}");
    }

    // ---------- captured catalog queries (ticket 25) ----------

    #[test]
    fn captured_courses_lists_each_distinct_course_once_with_counts_and_first_last_seen() {
        let mut store = store();
        let csintsy = vec![
            parsed_section(2923, 384, "S01", None, Some(10), vec![]),
            parsed_section(2923, 385, "S02", None, Some(20), vec![]),
        ];
        store.record_capture(&SCOPE, &csintsy, T1).expect("first capture");
        // A re-capture advances last seen but must not duplicate the course.
        store
            .record_capture(&SCOPE, &[csintsy[0].clone()], T2)
            .expect("re-capture");
        let geartap = {
            let mut section = parsed_section(564, 737, "Y11", None, Some(10), vec![]);
            section.course_code = "GEARTAP".into();
            section
        };
        store.record_capture(&SCOPE, &[geartap], T2).expect("second course");
        // Another term's capture of the same course id must not leak in.
        store
            .record_capture(
                &OTHER_SCOPE,
                &[{
                    let mut section = parsed_section(564, 737, "Y11", None, Some(3), vec![]);
                    section.course_code = "GEARTAP".into();
                    section
                }],
                T1,
            )
            .expect("other-scope capture");

        let courses = store.captured_courses(&SCOPE).expect("captured courses");
        assert_eq!(
            courses.iter().map(|course| course.code.as_str()).collect::<Vec<_>>(),
            vec!["CSINTSY", "GEARTAP"],
            "one row per distinct course under the scope, ordered by code"
        );
        let csintsy_row = &courses[0];
        assert_eq!(csintsy_row.course_id, 2923);
        assert_eq!(csintsy_row.title, "INTRODUCTION TO INTELLIGENT SYSTEMS");
        assert_eq!(csintsy_row.section_count, 2);
        assert_eq!(csintsy_row.first_seen_at, T1);
        assert_eq!(csintsy_row.last_seen_at, T2, "last seen is the newest capture");
        let geartap_row = &courses[1];
        assert_eq!(geartap_row.section_count, 1);
        assert_eq!(geartap_row.first_seen_at, T2);
        assert_eq!(
            store.captured_courses(&OTHER_SCOPE).expect("other scope").len(),
            1,
            "queries are scoped to one term and never leak another term's rows"
        );
    }

    #[test]
    fn capture_summary_counts_sections_and_distinct_courses_per_scope() {
        let mut store = store();
        store
            .record_capture(
                &SCOPE,
                &[
                    parsed_section(2923, 384, "S01", None, Some(10), vec![]),
                    parsed_section(2923, 385, "S02", None, Some(20), vec![]),
                ],
                T1,
            )
            .expect("first course capture");
        store
            .record_capture(&SCOPE, &[parsed_section(2999, 400, "S01", None, Some(5), vec![])], T2)
            .expect("second course capture");

        let summary = store.capture_summary(&SCOPE).expect("summary");
        assert_eq!(summary.campus_id, 7);
        assert_eq!(summary.session_id, 155);
        assert_eq!(summary.section_count, 3, "sections across both courses");
        assert_eq!(summary.course_count, 2, "distinct courses");

        // A capture under another scope never leaks into this scope's counts.
        store
            .record_capture(
                &OTHER_SCOPE,
                &[parsed_section(2923, 999, "S99", None, Some(5), vec![])],
                T2,
            )
            .expect("other-scope capture");
        let summary = store.capture_summary(&SCOPE).expect("summary");
        assert_eq!(summary.section_count, 3, "other scopes do not count here");
        assert_eq!(summary.course_count, 2);
    }

    #[test]
    fn captured_courses_is_empty_when_nothing_was_captured_under_the_scope() {
        let store = store();
        let courses = store.captured_courses(&SCOPE).expect("captured courses");
        assert!(courses.is_empty(), "an empty catalog is [], never an error or null");
    }

    #[test]
    fn captured_sections_returns_every_section_of_one_course_with_snapshot_values() {
        let mut store = store();
        let named = {
            let mut section = parsed_section(
                2923,
                385,
                "S02",
                Some("Bryant Lee"),
                Some(39),
                vec![
                    room_block(Day::Tue, 870, 960, "L226"),
                    online_block(Day::Fri, 870, 960),
                ],
            );
            section.remark = Some(" Bring laptop ".into());
            section
        };
        let unnamed = parsed_section(2923, 384, "S01", None, Some(10), vec![
            online_block(Day::Mon, 450, 540),
        ]);
        store.record_capture(&SCOPE, &[named, unnamed], T1).expect("capture");
        store
            .record_capture(
                &OTHER_SCOPE,
                &[parsed_section(2923, 384, "S01", Some("Elsewhere"), Some(1), vec![])],
                T1,
            )
            .expect("same course captured under another scope");

        let sections = store
            .captured_sections(&SCOPE, 2923)
            .expect("captured sections");
        assert_eq!(
            sections.iter().map(|section| section.section_id).collect::<Vec<_>>(),
            vec![384, 385],
            "every captured section of exactly the requested course, in section order"
        );

        let s01 = &sections[0];
        assert_eq!(s01.section_code, "S01");
        assert_eq!(s01.course_code, "CSINTSY");
        assert_eq!(s01.modality, SectionModality::Online);
        assert_eq!(
            s01.latest_snapshot.teacher, None,
            "a blank teacher crosses the seam as unknown, never as an empty string"
        );
        assert_eq!(s01.latest_snapshot.enrolled, 10);

        let s02 = &sections[1];
        assert_eq!(s02.modality, SectionModality::Hybrid, "per-block modality derives");
        assert_eq!(s02.blocks.len(), 2);
        assert_eq!(s02.blocks[0].location.as_deref(), Some("L226"));
        assert_eq!(s02.blocks[1].modality, BlockModality::Online);
        assert_eq!(s02.latest_snapshot.teacher.as_deref(), Some("Bryant Lee"));
        assert_eq!(
            s02.latest_snapshot.remark.as_deref(),
            Some(" Bring laptop "),
            "remark crosses verbatim and is never parsed"
        );
    }

    #[test]
    fn captured_sections_of_an_uncaptured_course_is_empty() {
        let mut store = store();
        store.create_plan("p1", "T1", &SCOPE, T1).expect("plan");
        let sections = store.captured_sections(&SCOPE, 9999).expect("no sections");
        assert!(sections.is_empty());
    }

    // ---------- apply_solution (ticket 25) ----------

    #[test]
    fn apply_solution_writes_the_chosen_sections_into_the_plan_as_ordinary_members() {
        let mut store = store();
        store.create_plan("p1", "T1 load", &SCOPE, T1).expect("plan");
        store
            .record_capture(
                &SCOPE,
                &[parsed_section(2923, 384, "S01", None, Some(10), vec![])],
                T1,
            )
            .expect("capture");

        store
            .apply_solution(
                "p1",
                &[SectionRef { course_id: 2923, section_id: 384 }],
            )
            .expect("apply must succeed");

        let plan = store.get_plan("p1").expect("reload");
        assert_eq!(plan.sections.len(), 1);
        assert!(!plan.sections[0].pinned, "an applied section starts unpinned");
        assert_eq!(
            count(&store.conn, "SELECT COUNT(*) FROM plan_sections"),
            1,
            "exactly one membership row was written"
        );
    }

    #[test]
    fn applied_sections_stay_individually_removable_and_unpinnable_afterwards() {
        let mut store = store();
        store.create_plan("p1", "T1 load", &SCOPE, T1).expect("plan");
        store
            .record_capture(
                &SCOPE,
                &[
                    parsed_section(2923, 384, "S01", None, Some(10), vec![]),
                    parsed_section(564, 737, "Y11", None, Some(10), vec![]),
                ],
                T1,
            )
            .expect("capture two courses");
        store
            .apply_solution(
                "p1",
                &[
                    SectionRef { course_id: 2923, section_id: 384 },
                    SectionRef { course_id: 564, section_id: 737 },
                ],
            )
            .expect("apply both");

        store.set_section_pinned("p1", 2923, 384, true).expect("pin after apply");
        store.remove_section_from_plan("p1", 564, 737).expect("remove after apply");

        let plan = store.get_plan("p1").expect("reload");
        assert_eq!(plan.sections.len(), 1);
        assert!(plan.sections[0].pinned);
    }

    #[test]
    fn apply_solution_replaces_an_unpinned_member_without_duplication() {
        // Ticket 42: applying must reconcile, not accumulate. The old S01
        // of the solved course goes; the new one arrives; the pinned member
        // of an untouched course stays exactly as chosen.
        let mut store = store();
        store.create_plan("p1", "T1 load", &SCOPE, T1).expect("plan");
        store
            .record_capture(
                &SCOPE,
                &[
                    parsed_section(2923, 384, "S01", None, Some(10), vec![]),
                    parsed_section(564, 737, "Y11", None, Some(10), vec![]),
                    parsed_section(564, 738, "Y12", None, Some(10), vec![]),
                ],
                T1,
            )
            .expect("capture two courses with alternatives");
        store.add_section_to_plan("p1", 2923, 384).expect("choose pinned");
        store.set_section_pinned("p1", 2923, 384, true).expect("pin");
        store.add_section_to_plan("p1", 564, 737).expect("choose replaceable");

        store
            .apply_solution(
                "p1",
                &[
                    SectionRef { course_id: 2923, section_id: 384 },
                    SectionRef { course_id: 564, section_id: 738 },
                ],
            )
            .expect("apply reconciles");

        let plan = store.get_plan("p1").expect("reload");
        assert_eq!(
            plan.sections
                .iter()
                .map(|section| (section.course_id, section.section_id, section.pinned))
                .collect::<Vec<_>>(),
            // Members come back ordered by course id, and 564 < 2923.
            vec![(564, 738, false), (2923, 384, true)],
            "pinned untouched, replaced gone, new added"
        );
        assert_eq!(
            count(&store.conn, "SELECT COUNT(*) FROM plan_sections"),
            2,
            "no duplicate course membership was written"
        );
    }

    #[test]
    fn apply_solution_preserves_pin_state_of_surviving_members() {
        // Applying a solution never silently pins or unpins anything: a
        // section the student pinned is still pinned afterwards.
        let mut store = store();
        store.create_plan("p1", "T1 load", &SCOPE, T1).expect("plan");
        store
            .record_capture(&SCOPE, &[parsed_section(564, 737, "Y11", None, Some(10), vec![])], T1)
            .expect("capture");
        store.add_section_to_plan("p1", 564, 737).expect("choose");
        store.set_section_pinned("p1", 564, 737, true).expect("pin");

        store
            .apply_solution("p1", &[SectionRef { course_id: 564, section_id: 737 }])
            .expect("re-apply the very section that is pinned");

        assert_eq!(pinned_flag(&store.conn, 737), 1, "pin state survived the apply");
        assert_eq!(count(&store.conn, "SELECT COUNT(*) FROM plan_sections"), 1);
    }

    #[test]
    fn apply_solution_refuses_to_override_a_pinned_member_and_writes_nothing() {
        // A real solve always carries every pinned member, so a solution
        // naming a different section of a pinned course cannot come from
        // the solver — failing loudly beats silently duplicating membership.
        let mut store = store();
        store.create_plan("p1", "T1 load", &SCOPE, T1).expect("plan");
        store
            .record_capture(
                &SCOPE,
                &[
                    parsed_section(2923, 384, "S01", None, Some(10), vec![]),
                    parsed_section(2923, 385, "S02", None, Some(10), vec![]),
                ],
                T1,
            )
            .expect("capture alternatives");
        store.add_section_to_plan("p1", 2923, 384).expect("choose");
        store.set_section_pinned("p1", 2923, 384, true).expect("pin");

        let err = store
            .apply_solution("p1", &[SectionRef { course_id: 2923, section_id: 385 }])
            .expect_err("a solution may not override a pinned member");
        let message = err.to_string();
        assert!(
            message.contains("pins this course") && message.contains("384"),
            "the error names the pin it would override, got: {message}"
        );
        assert_eq!(
            count(&store.conn, "SELECT COUNT(*) FROM plan_sections"),
            1,
            "a refused apply writes nothing"
        );
        assert_eq!(pinned_flag(&store.conn, 384), 1);
    }

    #[test]
    fn apply_solution_leaves_courses_outside_the_solution_alone() {
        // Reconciliation speaks only about courses the solution names: an
        // unpinned member of any other course is not the solve's to remove.
        let mut store = store();
        store.create_plan("p1", "T1 load", &SCOPE, T1).expect("plan");
        store
            .record_capture(
                &SCOPE,
                &[
                    parsed_section(2923, 384, "S01", None, Some(10), vec![]),
                    parsed_section(564, 737, "Y11", None, Some(10), vec![]),
                ],
                T1,
            )
            .expect("capture two courses");
        store.add_section_to_plan("p1", 2923, 384).expect("manual pick");
        store.add_section_to_plan("p1", 564, 737).expect("manual pick");

        store
            .apply_solution("p1", &[SectionRef { course_id: 564, section_id: 737 }])
            .expect("apply covers one course only");

        let plan = store.get_plan("p1").expect("reload");
        assert_eq!(plan.sections.len(), 2, "nothing outside the solution was touched");
    }

    #[test]
    fn apply_solution_rejects_a_solution_naming_two_sections_of_one_course() {
        // A solution holds one section per course by definition; a caller
        // sending two of the same course is malformed, and applying it must
        // never write duplicate course membership (ticket 42).
        let mut store = store();
        store.create_plan("p1", "T1 load", &SCOPE, T1).expect("plan");
        store
            .record_capture(
                &SCOPE,
                &[
                    parsed_section(2923, 384, "S01", None, Some(10), vec![]),
                    parsed_section(2923, 385, "S02", None, Some(10), vec![]),
                ],
                T1,
            )
            .expect("capture two sections of one course");

        let err = store
            .apply_solution(
                "p1",
                &[
                    SectionRef { course_id: 2923, section_id: 384 },
                    SectionRef { course_id: 2923, section_id: 385 },
                ],
            )
            .expect_err("a solution may not name two sections of one course");
        assert!(
            err.to_string().contains("one section per course"),
            "the error names the violation, got: {err}"
        );
        assert_eq!(
            count(&store.conn, "SELECT COUNT(*) FROM plan_sections"),
            0,
            "a refused apply writes nothing"
        );
    }

    #[test]
    fn apply_solution_rejects_out_of_scope_or_unknown_sections_and_writes_nothing() {
        let mut store = store();
        store.create_plan("p1", "T1 load", &SCOPE, T1).expect("plan");
        store
            .record_capture(&OTHER_SCOPE, &[parsed_section(2923, 999, "S99", None, Some(5), vec![])], T1)
            .expect("out-of-scope capture");

        let err = store
            .apply_solution(
                "p1",
                &[SectionRef { course_id: 2923, section_id: 999 }],
            )
            .expect_err("a different-term section must be rejected with the mismatch named");
        assert!(matches!(err, StoreError::ScopeMismatch { .. }), "got {err:?}");
        assert_eq!(
            count(&store.conn, "SELECT COUNT(*) FROM plan_sections"),
            0,
            "a failed apply writes nothing"
        );

        let err = store
            .apply_solution(
                "p1",
                &[SectionRef { course_id: 2923, section_id: 384 }],
            )
            .expect_err("a never-captured section must be rejected too");
        assert!(matches!(err, StoreError::SectionNotFound { .. }), "got {err:?}");

        let err = store
            .apply_solution("missing", &[])
            .expect_err("applying to an unknown plan must error even when empty");
        assert!(matches!(err, StoreError::PlanNotFound { .. }), "got {err:?}");
    }

    // ---------- solve inputs (ticket 25) ----------

    #[test]
    fn solve_inputs_split_the_plan_into_fixed_sections_and_a_full_candidate_catalog() {
        let mut store = store();
        store.create_plan("p1", "T1 load", &SCOPE, T1).expect("plan");
        let chosen = parsed_section(
            2923,
            384,
            "S01",
            None,
            Some(45),
            vec![room_block(Day::Mon, 450, 540, "A1103")],
        );
        let alternative = parsed_section(2923, 385, "S02", Some("Bryant Lee"), Some(20), vec![
            online_block(Day::Tue, 450, 540),
        ]);
        let geartap = {
            let mut section = parsed_section(564, 737, "Y11", None, Some(42), vec![]);
            section.course_code = "GEARTAP".into();
            section.enroll_cap = Some(45);
            section
        };
        store
            .record_capture(&SCOPE, &[chosen.clone(), alternative, geartap], T1)
            .expect("capture");
        store.add_section_to_plan("p1", 2923, 384).expect("choose S01");

        let fixed = store.plan_fixed_sections("p1").expect("fixed sections");
        assert_eq!(fixed.len(), 1, "only members are fixed");
        assert_eq!(fixed[0].course_id, 2923);
        assert_eq!(fixed[0].section_id, 384);
        assert_eq!(fixed[0].blocks.len(), 1);
        assert_eq!(fixed[0].blocks[0].day, Day::Mon);

        let catalog = store.solver_courses(&SCOPE).expect("catalog");
        assert_eq!(catalog.len(), 2, "every captured course is a candidate source");
        let csintsy = catalog.iter().find(|c| c.course_id == 2923).expect("CSINTSY");
        assert_eq!(csintsy.code, "CSINTSY");
        assert_eq!(csintsy.sections.len(), 2, "all captured sections stay candidates");
        let s02 = csintsy.sections.iter().find(|s| s.section_id == 385).expect("S02");
        assert_eq!(s02.teacher.as_deref(), Some("Bryant Lee"));
        assert_eq!(s02.enrolled, Some(20));
        assert_eq!(s02.enroll_cap, Some(45), "cap comes from the section row");
        let s01 = csintsy.sections.iter().find(|s| s.section_id == 384).expect("S01");
        assert_eq!(s01.enrolled, Some(45));
        let geartap_course = catalog.iter().find(|c| c.course_id == 564).expect("GEARTAP");
        assert_eq!(geartap_course.sections.len(), 1);

        let err = store
            .plan_fixed_sections("missing")
            .expect_err("an unknown plan cannot seed a solve");
        assert!(matches!(err, StoreError::PlanNotFound { .. }), "got {err:?}");
    }

    #[test]
    fn latest_snapshot_at_reports_the_freshest_enrolment_number_in_the_scope() {
        // Ticket 34: a student deciding whether to trust an exclusion needs
        // to know how old the numbers are, so the solve carries the latest
        // snapshot timestamp of the plan's scope.
        let mut store = store();
        assert_eq!(
            store.latest_snapshot_at(&SCOPE).expect("empty scope"),
            None,
            "nothing captured yet — there is no age to report"
        );

        store
            .record_capture(
                &SCOPE,
                &[parsed_section(
                    2923,
                    384,
                    "S01",
                    None,
                    Some(20),
                    vec![online_block(Day::Mon, 450, 540)],
                )],
                T1,
            )
            .expect("first capture");
        assert_eq!(
            store.latest_snapshot_at(&SCOPE).expect("one capture"),
            Some(T1.to_string())
        );

        // A later capture of another section moves the stamp forward.
        let earlier = parsed_section(2923, 385, "S02", None, Some(30), vec![
            online_block(Day::Tue, 450, 540),
        ]);
        store
            .record_capture(&SCOPE, &[earlier], T2)
            .expect("second capture");
        assert_eq!(
            store.latest_snapshot_at(&SCOPE).expect("two captures"),
            Some(T2.to_string()),
            "the freshest snapshot wins"
        );

        // Another scope's snapshots never leak in.
        store
            .record_capture(
                &OTHER_SCOPE,
                &[parsed_section(2923, 999, "S99", None, Some(1), vec![])],
                "2026-08-24T00:00:00Z",
            )
            .expect("other-scope capture");
        assert_eq!(
            store.latest_snapshot_at(&SCOPE).expect("scoped read"),
            Some(T2.to_string()),
            "the stamp is scoped to (campus, session)"
        );
    }

    /// Ticket 46 follow-up: a captured course carries whether the student
    /// actually intends to enrol in it.
    ///
    /// The solver filled *every* captured course in scope, so a student who
    /// searched forty courses to browse them got a solve that insisted on
    /// scheduling all forty. Capturing and intending are different acts, and
    /// this is the second one.
    #[test]
    fn a_captured_course_is_included_until_the_student_says_otherwise() {
        let mut store = store();
        store
            .record_capture(
                &SCOPE,
                &[parsed_section(
                    2923,
                    384,
                    "S11",
                    None,
                    Some(30),
                    vec![room_block(Day::Mon, 450, 540, "L226")],
                )],
                T1,
            )
            .expect("capture must record");

        let courses = store.captured_courses(&SCOPE).expect("courses must list");
        assert_eq!(courses.len(), 1);
        assert!(
            courses[0].included,
            "capturing a course is the student's own search: it counts until they say it does not"
        );
    }

    #[test]
    fn excluding_a_course_keeps_it_captured_and_takes_it_out_of_the_solve() {
        let mut store = store();
        for course_id in [2923, 564] {
            store
                .record_capture(
                    &SCOPE,
                    &[parsed_section(
                        course_id,
                        course_id * 10,
                        "S11",
                        None,
                        Some(30),
                        vec![room_block(Day::Mon, 450, 540, "L226")],
                    )],
                    T1,
                )
                .expect("capture must record");
        }

        store
            .set_course_included(&SCOPE, 564, false)
            .expect("exclusion must apply");

        // Still captured, still browsable, still counted.
        let courses = store.captured_courses(&SCOPE).expect("courses must list");
        assert_eq!(courses.len(), 2, "excluding is not forgetting");
        let excluded = courses
            .iter()
            .find(|c| c.course_id == 564)
            .expect("the excluded course stays in the catalog");
        assert!(!excluded.included);

        // But the solver stops trying to schedule it.
        let solver_courses = store.solver_courses(&SCOPE).expect("solver catalog");
        assert!(
            solver_courses.iter().all(|c| c.course_id != 564),
            "an excluded course must not be a course the solve has to satisfy"
        );
        assert!(
            solver_courses.iter().any(|c| c.course_id == 2923),
            "an included course stays a candidate"
        );
    }

    #[test]
    fn including_a_course_again_puts_it_back_in_the_solve() {
        let mut store = store();
        store
            .record_capture(
                &SCOPE,
                &[parsed_section(
                    2923,
                    384,
                    "S11",
                    None,
                    Some(30),
                    vec![room_block(Day::Mon, 450, 540, "L226")],
                )],
                T1,
            )
            .expect("capture must record");

        store
            .set_course_included(&SCOPE, 2923, false)
            .expect("exclusion must apply");
        store
            .set_course_included(&SCOPE, 2923, true)
            .expect("inclusion must apply");

        let solver_courses = store.solver_courses(&SCOPE).expect("solver catalog");
        assert!(solver_courses.iter().any(|c| c.course_id == 2923));
    }

    #[test]
    fn excluding_a_course_that_was_never_captured_is_a_loud_error() {
        let mut store = store();
        let err = store
            .set_course_included(&SCOPE, 9999, false)
            .expect_err("a course that is not in the catalog cannot be excluded");
        assert!(
            matches!(err, StoreError::CourseNotFound { .. }),
            "unexpected error: {err:?}"
        );
    }

    /// A capture and a refresh both advance `last_seen_at`, so the catalog
    /// could not say which one the student was looking at. Only refresh
    /// stamps `last_refreshed_at`.
    #[test]
    fn only_a_refresh_stamps_the_course_as_refreshed() {
        let mut store = store();
        store
            .record_capture(
                &SCOPE,
                &[parsed_section(
                    2923,
                    384,
                    "S11",
                    None,
                    Some(30),
                    vec![room_block(Day::Mon, 450, 540, "L226")],
                )],
                T1,
            )
            .expect("capture must record");

        let courses = store.captured_courses(&SCOPE).expect("courses must list");
        assert_eq!(
            courses[0].last_refreshed_at, None,
            "a course that has only ever been captured was never refreshed"
        );

        store
            .create_plan("p1", "T1 load", &SCOPE, T1)
            .expect("plan must create");
        store
            .apply_refresh(
                "p1",
                2923,
                &[parsed_section(
                    2923,
                    384,
                    "S11",
                    None,
                    Some(31),
                    vec![room_block(Day::Mon, 450, 540, "L226")],
                )],
                T2,
            )
            .expect("refresh must apply");

        let courses = store.captured_courses(&SCOPE).expect("courses must list");
        assert_eq!(
            courses[0].last_refreshed_at.as_deref(),
            Some(T2),
            "a refresh is what the student pressed, and the catalog says so"
        );
    }

    // ---------- teacher preferences (ticket 47) ----------

    #[test]
    fn migration_eight_creates_the_teacher_preferences_table() {
        let store = store();
        assert!(
            table_names(&store.conn).contains(&"teacher_preferences".to_string()),
            "teacher_preferences table must exist after migration"
        );
    }

    #[test]
    fn teacher_preferences_columns_match_the_spec() {
        let store = store();
        assert_eq!(
            column_names(&store.conn, "teacher_preferences"),
            vec!["campus_id", "session_id", "course_id", "teacher_key",
                 "display_name", "rank", "avoid"],
            "column allowlist for teacher_preferences"
        );
    }

    #[test]
    fn migration_eight_is_idempotent_on_an_existing_database() {
        let store = store();
        migrate(&store.conn).expect("re-migration must not error");
        let tables = table_names(&store.conn);
        let pref_count = tables.iter().filter(|t| *t == "teacher_preferences").count();
        assert_eq!(pref_count, 1, "teacher_preferences must not be created twice");
    }

    #[test]
    fn rankable_teachers_come_from_latest_snapshots_keyed_and_deduplicated() {
        let mut store = store();
        // Two sections with teachers that normalize to the same key.
        store.record_capture(&SCOPE, &[
            parsed_section(2923, 384, "S01", Some("Bryant Lee"), Some(10), vec![]),
            parsed_section(2923, 385, "S02", Some("BRYANT LEE"), Some(20), vec![]),
        ], T1).expect("capture");

        let teachers = store.rankable_teachers(&SCOPE, 2923).expect("rankable");
        assert_eq!(teachers.len(), 1, "same key deduplicates");
        assert_eq!(teachers[0].key, "bryant lee");
        assert_eq!(teachers[0].display_name, "Bryant Lee", "first seen display name");
        assert_eq!(teachers[0].section_ids, vec![384, 385]);
    }

    #[test]
    fn blank_teacher_never_produces_a_rankable_entry() {
        let mut store = store();
        store.record_capture(&SCOPE, &[
            parsed_section(2923, 384, "S01", None, Some(10), vec![]),
            parsed_section(2923, 385, "S02", Some("  "), Some(20), vec![]),
        ], T1).expect("capture");

        let teachers = store.rankable_teachers(&SCOPE, 2923).expect("rankable");
        assert!(teachers.is_empty(), "blank and whitespace-only teachers have no key");
    }

    #[test]
    fn rankable_teachers_only_come_from_latest_snapshots() {
        let mut store = store();
        // First capture: teacher A
        store.record_capture(&SCOPE, &[
            parsed_section(2923, 384, "S01", Some("Old Teacher"), Some(10), vec![]),
        ], T1).expect("first capture");
        // Second capture: teacher B replaces A on the same section
        store.record_capture(&SCOPE, &[
            parsed_section(2923, 384, "S01", Some("New Teacher"), Some(11), vec![]),
        ], T2).expect("second capture");

        let teachers = store.rankable_teachers(&SCOPE, 2923).expect("rankable");
        assert_eq!(teachers.len(), 1);
        assert_eq!(teachers[0].key, "new teacher", "only the latest snapshot counts");
    }

    #[test]
    fn rankable_teachers_is_empty_for_an_uncaptured_course() {
        let store = store();
        let teachers = store.rankable_teachers(&SCOPE, 9999).expect("rankable");
        assert!(teachers.is_empty());
    }

    #[test]
    fn rankable_teachers_stays_inside_the_scope() {
        let mut store = store();
        store.record_capture(&SCOPE, &[
            parsed_section(2923, 384, "S01", Some("Scoped Teacher"), Some(10), vec![]),
        ], T1).expect("scope A capture");
        store.record_capture(&OTHER_SCOPE, &[
            parsed_section(2923, 384, "S01", Some("Other Teacher"), Some(20), vec![]),
        ], T1).expect("scope B capture");

        let teachers = store.rankable_teachers(&SCOPE, 2923).expect("rankable");
        assert_eq!(teachers.len(), 1);
        assert_eq!(teachers[0].key, "scoped teacher");
    }

    #[test]
    fn write_course_preferences_stores_ranked_and_avoided_teachers() {
        let mut store = store();
        store.record_capture(&SCOPE, &[
            parsed_section(2923, 384, "S01", Some("Bryant Lee"), Some(10), vec![]),
            parsed_section(2923, 385, "S02", Some("Other Teacher"), Some(20), vec![]),
        ], T1).expect("capture");

        store.write_course_preferences(
            &SCOPE, 2923,
            &[
                ("bryant lee".into(), "Bryant Lee".into()),
                ("other teacher".into(), "Other Teacher".into()),
            ],
            &[],
        ).expect("write prefs");

        let prefs = store.course_preferences(&SCOPE, 2923).expect("read prefs");
        assert_eq!(prefs.len(), 2);
        assert_eq!(prefs[0].teacher_key, "bryant lee");
        assert_eq!(prefs[0].rank, Some(1));
        assert!(!prefs[0].avoid);
        assert_eq!(prefs[1].teacher_key, "other teacher");
        assert_eq!(prefs[1].rank, Some(2));
        assert!(!prefs[1].avoid);
    }

    #[test]
    fn write_course_preferences_stores_avoided_teachers() {
        let mut store = store();
        store.record_capture(&SCOPE, &[
            parsed_section(2923, 384, "S01", Some("Bryant Lee"), Some(10), vec![]),
            parsed_section(2923, 385, "S02", Some("Other Teacher"), Some(20), vec![]),
        ], T1).expect("capture");

        store.write_course_preferences(
            &SCOPE, 2923,
            &[],
            &[("other teacher".into(), "Other Teacher".into())],
        ).expect("write prefs");

        let prefs = store.course_preferences(&SCOPE, 2923).expect("read prefs");
        assert_eq!(prefs.len(), 1);
        assert_eq!(prefs[0].teacher_key, "other teacher");
        assert_eq!(prefs[0].rank, None);
        assert!(prefs[0].avoid);
        assert_eq!(
            prefs[0].display_name, "Other Teacher",
            "an avoided teacher is displayed by name, never by its case-folded key"
        );
    }

    #[test]
    fn an_avoided_teacher_is_never_displayed_as_its_key() {
        // The key is case-folded for matching. A student who avoided
        // "Bryant Lee" must not be shown "bryant lee" in the list they
        // dragged them into.
        let mut store = store();
        store.record_capture(&SCOPE, &[
            parsed_section(2923, 384, "S01", Some("Bryant Lee"), Some(10), vec![]),
        ], T1).expect("capture");

        store.write_course_preferences(
            &SCOPE, 2923,
            &[],
            &[("bryant lee".into(), "Bryant Lee".into())],
        ).expect("write prefs");

        let prefs = store.course_preferences(&SCOPE, 2923).expect("read prefs");
        assert_eq!(prefs[0].display_name, "Bryant Lee");
        assert_ne!(
            prefs[0].display_name, prefs[0].teacher_key,
            "the display name must not be the normalized key"
        );
    }

    #[test]
    fn write_course_preferences_replaces_previous_preferences() {
        let mut store = store();
        store.record_capture(&SCOPE, &[
            parsed_section(2923, 384, "S01", Some("A"), Some(10), vec![]),
            parsed_section(2923, 385, "S02", Some("B"), Some(20), vec![]),
            parsed_section(2923, 386, "S03", Some("C"), Some(30), vec![]),
        ], T1).expect("capture");

        // First write: A ranked 1, B ranked 2
        store.write_course_preferences(
            &SCOPE, 2923,
            &[("a".into(), "A".into()), ("b".into(), "B".into())],
            &[],
        ).expect("first write");

        // Second write: B ranked 1, C avoided — replaces everything
        store.write_course_preferences(
            &SCOPE, 2923,
            &[("b".into(), "B".into())],
            &[("c".into(), "C".into())],
        ).expect("second write");

        let prefs = store.course_preferences(&SCOPE, 2923).expect("read prefs");
        assert_eq!(prefs.len(), 2, "previous preferences are replaced");
        let b = prefs.iter().find(|p| p.teacher_key == "b").expect("B");
        assert_eq!(b.rank, Some(1));
        assert!(!b.avoid);
        let c = prefs.iter().find(|p| p.teacher_key == "c").expect("C");
        assert_eq!(c.rank, None);
        assert!(c.avoid);
        assert!(
            prefs.iter().all(|p| p.teacher_key != "a"),
            "A was removed by the replacement"
        );
    }

    #[test]
    fn ranks_are_contiguous_from_1_after_a_write() {
        let mut store = store();
        store.record_capture(&SCOPE, &[
            parsed_section(2923, 384, "S01", Some("A"), Some(10), vec![]),
            parsed_section(2923, 385, "S02", Some("B"), Some(20), vec![]),
            parsed_section(2923, 386, "S03", Some("C"), Some(30), vec![]),
        ], T1).expect("capture");

        store.write_course_preferences(
            &SCOPE, 2923,
            &[
                ("c".into(), "C".into()),
                ("a".into(), "A".into()),
                ("b".into(), "B".into()),
            ],
            &[],
        ).expect("write prefs");

        let prefs = store.course_preferences(&SCOPE, 2923).expect("read prefs");
        let ranks: Vec<Option<i64>> = prefs.iter().map(|p| p.rank).collect();
        assert_eq!(ranks, vec![Some(1), Some(2), Some(3)], "contiguous from 1");
    }

    #[test]
    fn the_mutual_exclusion_check_rejects_rank_and_avoid_on_the_same_row() {
        let store = store();
        let err = store.conn.execute(
            "INSERT INTO teacher_preferences
             (campus_id, session_id, course_id, teacher_key, display_name, rank, avoid)
             VALUES (7, 155, 2923, 'key', 'Name', 1, 1)",
            [],
        );
        assert!(err.is_err(), "the CHECK must reject rank + avoid on the same row");
    }

    #[test]
    fn preferences_survive_forget_course() {
        let mut store = store();
        store.record_capture(&SCOPE, &[
            parsed_section(2923, 384, "S01", Some("Bryant Lee"), Some(10), vec![]),
        ], T1).expect("capture");
        store.write_course_preferences(
            &SCOPE, 2923,
            &[("bryant lee".into(), "Bryant Lee".into())],
            &[],
        ).expect("write prefs");

        store.forget_course(&SCOPE, 2923).expect("forget");

        let prefs = store.course_preferences(&SCOPE, 2923).expect("prefs survive");
        assert_eq!(prefs.len(), 1, "preferences lie dormant after forget");
        assert_eq!(prefs[0].teacher_key, "bryant lee");
    }

    #[test]
    fn preferences_return_inactive_when_teacher_leaves_latest_snapshots() {
        let mut store = store();
        // Capture with teacher A
        store.record_capture(&SCOPE, &[
            parsed_section(2923, 384, "S01", Some("Old Teacher"), Some(10), vec![]),
        ], T1).expect("first capture");
        store.write_course_preferences(
            &SCOPE, 2923,
            &[("old teacher".into(), "Old Teacher".into())],
            &[],
        ).expect("write prefs");

        // Re-capture: teacher replaced
        store.record_capture(&SCOPE, &[
            parsed_section(2923, 384, "S01", Some("New Teacher"), Some(11), vec![]),
        ], T2).expect("second capture");

        let prefs = store.course_preferences(&SCOPE, 2923).expect("prefs");
        assert_eq!(prefs.len(), 1);
        assert_eq!(prefs[0].teacher_key, "old teacher");
        assert!(!prefs[0].active, "old teacher is no longer in latest snapshots");
    }

    #[test]
    fn two_capture_scopes_with_the_same_course_id_do_not_see_each_others_preferences() {
        let mut store = store();
        store.record_capture(&SCOPE, &[
            parsed_section(2923, 384, "S01", Some("Teacher A"), Some(10), vec![]),
        ], T1).expect("scope A capture");
        store.record_capture(&OTHER_SCOPE, &[
            parsed_section(2923, 384, "S01", Some("Teacher B"), Some(20), vec![]),
        ], T1).expect("scope B capture");

        store.write_course_preferences(
            &SCOPE, 2923,
            &[("teacher a".into(), "Teacher A".into())],
            &[],
        ).expect("write scope A prefs");

        let prefs_a = store.course_preferences(&SCOPE, 2923).expect("scope A prefs");
        assert_eq!(prefs_a.len(), 1);
        assert_eq!(prefs_a[0].teacher_key, "teacher a");

        let prefs_b = store.course_preferences(&OTHER_SCOPE, 2923).expect("scope B prefs");
        assert!(prefs_b.is_empty(), "scope B has no preferences yet");
    }

    #[test]
    fn course_preferences_is_empty_when_nothing_was_written() {
        let store = store();
        let prefs = store.course_preferences(&SCOPE, 2923).expect("prefs");
        assert!(prefs.is_empty());
    }

}
