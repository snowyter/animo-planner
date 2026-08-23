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
    BlockModality, CaptureSummary, Conflict, Day, MissingSection, ScheduleBlock, Section,
    SectionModality, Snapshot,
};
use crate::core::parser::{ParsedBlock, ParsedSection};
use crate::core::refresh::RefreshCourse;
use chrono::NaiveDate;
use rusqlite::{Connection, OptionalExtension, Transaction};
use std::collections::HashSet;
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
    pub is_sample: bool,
    pub section_count: i64,
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

const MIGRATIONS: &[&str] = &[MIGRATION_V1, MIGRATION_V2, MIGRATION_V3, MIGRATION_V4];

/// Runs every migration not yet applied, tracked by `PRAGMA user_version`.
/// Idempotent: safe to run on a fresh database and on an existing one.
pub fn migrate(conn: &Connection) -> Result<(), StoreError> {
    let version: i64 = conn.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    for (index, migration) in MIGRATIONS.iter().enumerate() {
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
/// deliberate removal path is `undo_last_capture`, which reverses exactly
/// what the most recent batch introduced.
pub struct Store {
    /// Crate-visible so adapter modules and their tests can inspect rows;
    /// all writes go through `Store` methods.
    pub(crate) conn: Connection,
    /// Journal of the most recent capture batch, enough to reverse it.
    /// In-memory on purpose: undo targets only the most recent batch, and
    /// there is nothing to undo after a restart.
    last_batch: Option<CaptureBatch>,
}

/// Shared handle to the store: the loopback capture listener and the Tauri
/// commands both touch the same connection, serialized one call at a time.
pub type StoreHandle = Arc<Mutex<Store>>;

/// One schedule block exactly as stored, for restoring a section's prior
/// blocks when a batch is undone.
#[derive(Debug, Clone)]
struct StoredBlock {
    day: String,
    start_min: i64,
    end_min: i64,
    location: Option<String>,
    modality: Option<String>,
}

/// What one section of a batch changed, so the batch can be reversed.
struct BatchSectionRecord {
    section_fk: i64,
    /// False only for sections the batch itself inserted — those are
    /// removed on undo. Pre-existing sections are restored instead.
    existed_before: bool,
    prior_last_seen_at: Option<String>,
    prior_blocks: Vec<StoredBlock>,
    /// The snapshot row this batch appended for the section.
    appended_snapshot_id: i64,
}

/// Whether a course existed before the batch, so an introduced course can
/// be removed on undo.
struct BatchCourseRecord {
    campus_id: i64,
    session_id: i64,
    course_id: i64,
    existed_before: bool,
}

/// The journal of one capture batch: everything it introduced or changed.
struct CaptureBatch {
    sections: Vec<BatchSectionRecord>,
    courses: Vec<BatchCourseRecord>,
}

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
            last_batch: None,
        })
    }

    pub fn open_in_memory() -> Result<Self, StoreError> {
        let conn = Connection::open_in_memory()?;
        conn.pragma_update(None, "foreign_keys", true)?;
        migrate(&conn)?;
        Ok(Self {
            conn,
            last_batch: None,
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
    /// A journal of everything this batch introduced or changed is kept so
    /// `undo_last_capture` can reverse it. An empty batch changes nothing
    /// and does not become undoable.
    pub fn record_capture(
        &mut self,
        scope: &CaptureScope,
        sections: &[ParsedSection],
        captured_at: &str,
    ) -> Result<(), StoreError> {
        let tx = self.conn.transaction()?;
        let mut batch_sections: Vec<BatchSectionRecord> = Vec::new();
        let mut batch_courses: Vec<BatchCourseRecord> = Vec::new();
        for section in sections {
            record_course(&tx, scope, section, &mut batch_courses)?;
            let (section_fk, existed_before, prior_last_seen_at) =
                upsert_section(&tx, scope, section, captured_at)?;
            let prior_blocks = if existed_before {
                read_blocks(&tx, section_fk)?
            } else {
                Vec::new()
            };
            replace_blocks(&tx, section_fk, section)?;
            let appended_snapshot_id = append_snapshot(&tx, section_fk, section, captured_at)?;
            batch_sections.push(BatchSectionRecord {
                section_fk,
                existed_before,
                prior_last_seen_at,
                prior_blocks,
                appended_snapshot_id,
            });
        }
        tx.commit()?;
        if !sections.is_empty() {
            self.last_batch = Some(CaptureBatch {
                sections: batch_sections,
                courses: batch_courses,
            });
        }
        Ok(())
    }

    /// Reverses the most recent capture batch: sections and snapshots it
    /// introduced are removed, and sections it updated are restored to
    /// their prior blocks and `last_seen_at`. Safe to call when there is
    /// nothing to undo — it returns `false` and changes nothing.
    ///
    /// This is the one deliberate row-removal path in the codebase. ADR-0008
    /// protects sections from capture-side deletion; undo is an explicit
    /// user reversal of the batch that introduced them.
    pub fn undo_last_capture(&mut self) -> Result<bool, StoreError> {
        let Some(batch) = self.last_batch.take() else {
            return Ok(false);
        };
        match self.reverse_batch(&batch) {
            Ok(()) => Ok(true),
            Err(err) => {
                // Keep the journal so a failed undo can be retried rather
                // than silently losing the ability to reverse the batch.
                self.last_batch = Some(batch);
                Err(err)
            }
        }
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
            can_undo: self.last_batch.is_some(),
        })
    }

    fn reverse_batch(&self, batch: &CaptureBatch) -> Result<(), StoreError> {
        // The store is behind the shared handle's mutex, so this transaction
        // can never interleave with another caller's.
        let tx = self.conn.unchecked_transaction()?;
        for record in &batch.sections {
            tx.execute(
                "DELETE FROM snapshots WHERE id = ?1",
                [record.appended_snapshot_id],
            )?;
            if record.existed_before {
                tx.execute(
                    "DELETE FROM schedule_blocks WHERE section_fk = ?1",
                    [record.section_fk],
                )?;
                for block in &record.prior_blocks {
                    tx.execute(
                        "INSERT INTO schedule_blocks (section_fk, day, start_min, end_min, location, modality)
                         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                        rusqlite::params![
                            record.section_fk,
                            block.day,
                            block.start_min,
                            block.end_min,
                            block.location,
                            block.modality,
                        ],
                    )?;
                }
                if let Some(prior_last_seen_at) = &record.prior_last_seen_at {
                    tx.execute(
                        "UPDATE sections SET last_seen_at = ?1 WHERE id = ?2",
                        rusqlite::params![prior_last_seen_at, record.section_fk],
                    )?;
                }
            } else {
                tx.execute(
                    "DELETE FROM schedule_blocks WHERE section_fk = ?1",
                    [record.section_fk],
                )?;
                tx.execute("DELETE FROM sections WHERE id = ?1", [record.section_fk])?;
            }
        }
        for course in &batch.courses {
            if !course.existed_before {
                tx.execute(
                    "DELETE FROM courses WHERE campus_id = ?1 AND session_id = ?2 AND course_id = ?3",
                    rusqlite::params![course.campus_id, course.session_id, course.course_id],
                )?;
            }
        }
        tx.commit()?;
        Ok(())
    }

    pub fn create_plan(
        &mut self,
        id: &str,
        name: &str,
        scope: &CaptureScope,
        created_at: &str,
        is_sample: bool,
    ) -> Result<(), StoreError> {
        let tx = self.conn.transaction()?;
        insert_plan_tx(&tx, id, name, scope, created_at, is_sample)?;
        tx.commit()?;
        Ok(())
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
    /// Seeds the sample-data plan (ticket 07) in one transaction: records
    /// each capture, creates the plan flagged as sample data, and links
    /// every section into it. Idempotent — if the sample plan already
    /// exists, nothing is written and the existing plan is returned, so a
    /// repeat run never doubles sections or appends snapshots.
    ///
    /// The sample plan is an ordinary plan row distinguished only by
    /// `is_sample`, so it deletes like any other plan.
    pub fn seed_sample_plan(
        &mut self,
        scope: &CaptureScope,
        plan_id: &str,
        plan_name: &str,
        captures: &[&[ParsedSection]],
        captured_at: &str,
    ) -> Result<PlanSummaryRow, StoreError> {
        if let Some(existing_id) = find_sample_plan_id(&self.conn)? {
            return plan_summary_row(&self.conn, &existing_id);
        }

        let tx = self.conn.transaction()?;
        for capture in captures {
            record_capture_tx(&tx, scope, capture, captured_at)?;
        }
        insert_plan_tx(&tx, plan_id, plan_name, scope, captured_at, true)?;
        for section in captures.iter().flat_map(|capture| capture.iter()) {
            add_section_tx(&tx, plan_id, section.course_id, section.section_id)?;
        }
        tx.commit()?;

        plan_summary_row(&self.conn, plan_id)
    }

    /// The courses a refresh must re-run, in plan order: every course with
    /// at least one plan section, carrying the plan's section ids for that
    /// course so missing sections can be detected. Only courses in the plan
    /// are returned — refresh never walks the catalog.
    pub fn refresh_courses(&self, plan_id: &str) -> Result<Vec<RefreshCourse>, StoreError> {
        let _ = plan_scope(&self.conn, plan_id)?;
        let mut stmt = self.conn.prepare(
            "SELECT c.course_id, c.code, s.section_id
             FROM plan_sections ps
             JOIN sections s ON s.id = ps.section_fk
             JOIN courses c ON c.campus_id = s.campus_id AND c.session_id = s.session_id
                 AND c.course_id = s.course_id
             WHERE ps.plan_id = ?1
             ORDER BY c.course_id, s.section_id",
        )?;
        let rows = stmt.query_map([plan_id], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
            ))
        })?;
        let mut courses: Vec<RefreshCourse> = Vec::new();
        for row in rows {
            let (course_id, code, section_id) = row?;
            match courses.last_mut() {
                Some(last) if last.course_id == course_id => {
                    last.plan_section_ids.push(section_id);
                }
                _ => courses.push(RefreshCourse {
                    course_id,
                    code,
                    plan_section_ids: vec![section_id],
                }),
            }
        }
        Ok(courses)
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
    is_sample: bool,
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
        "INSERT INTO plans (id, name, campus_id, session_id, created_at, is_sample)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![
            id,
            name,
            scope.campus_id,
            scope.session_id,
            created_at,
            is_sample as i64,
        ],
    )?;
    Ok(())
}

fn add_section_tx(
    tx: &Transaction<'_>,
    plan_id: &str,
    course_id: i64,
    section_id: i64,
) -> Result<(), StoreError> {
    let (plan_campus, plan_session) = plan_scope(tx, plan_id)?;
    let section_fk = match scoped_section_fk(tx, plan_campus, plan_session, course_id, section_id)? {
        Some(section_fk) => section_fk,
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
            return match elsewhere {
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
            };
        }
    };

    tx.execute(
        "INSERT INTO plan_sections (plan_id, section_fk, pinned) VALUES (?1, ?2, 0)
         ON CONFLICT (plan_id, section_fk) DO NOTHING",
        rusqlite::params![plan_id, section_fk],
    )?;
    Ok(())
}

/// The id of the existing sample plan, if any. At most one is ever seeded
/// (the seed uses a reserved id), but the query stays deterministic anyway.
fn find_sample_plan_id(conn: &Connection) -> Result<Option<String>, StoreError> {
    conn.query_row(
        "SELECT id FROM plans WHERE is_sample = 1 ORDER BY created_at LIMIT 1",
        [],
        |row| row.get(0),
    )
    .optional()
    .map_err(StoreError::from)
}

/// Reads one plan row plus its section count.
fn plan_summary_row(conn: &Connection, plan_id: &str) -> Result<PlanSummaryRow, StoreError> {
    conn.query_row(
        "SELECT p.id, p.name, p.campus_id, p.session_id, p.created_at, p.is_sample,
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
                is_sample: row.get::<_, i64>(5)? != 0,
                section_count: row.get(6)?,
            })
        },
    )
    .optional()?
    .ok_or_else(|| StoreError::PlanNotFound {
        plan_id: plan_id.to_string(),
    })
}

/// Upserts the course and notes whether it pre-existed, so undo can remove
/// a course this batch introduced.
fn record_course(
    tx: &Transaction<'_>,
    scope: &CaptureScope,
    section: &ParsedSection,
    journal: &mut Vec<BatchCourseRecord>,
) -> Result<(), StoreError> {
    let existed_before: i64 = tx.query_row(
        "SELECT COUNT(*) FROM courses WHERE campus_id = ?1 AND session_id = ?2 AND course_id = ?3",
        rusqlite::params![scope.campus_id, scope.session_id, section.course_id],
        |row| row.get(0),
    )?;
    upsert_course(tx, scope, section)?;
    journal.push(BatchCourseRecord {
        campus_id: scope.campus_id,
        session_id: scope.session_id,
        course_id: section.course_id,
        existed_before: existed_before > 0,
    });
    Ok(())
}

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

/// Reads a section's stored blocks, for restoring them on undo.
fn read_blocks(tx: &Transaction<'_>, section_fk: i64) -> Result<Vec<StoredBlock>, StoreError> {
    let mut stmt = tx.prepare(
        "SELECT day, start_min, end_min, location, modality
         FROM schedule_blocks WHERE section_fk = ?1 ORDER BY day, start_min",
    )?;
    let rows = stmt.query_map([section_fk], |row| {
        Ok(StoredBlock {
            day: row.get(0)?,
            start_min: row.get(1)?,
            end_min: row.get(2)?,
            location: row.get(3)?,
            modality: row.get(4)?,
        })
    })?;
    rows.collect::<Result<Vec<_>, _>>().map_err(StoreError::Sql)
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
            ]
        );
    }

    #[test]
    fn migration_is_idempotent_on_an_existing_database() {
        let store = store();
        migrate(&store.conn).expect("re-migration must not error");
        migrate(&store.conn).expect("a third migration must not error");
        let tables = table_names(&store.conn);
        assert_eq!(tables.len(), 6, "no tables may be created twice");
        let version: i64 = store
            .conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .expect("user_version must be readable");
        assert_eq!(version, 4, "all four migrations apply exactly once");
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
                &["campus_id", "session_id", "course_id", "code", "title"],
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
            .create_plan("p1", "T1 load", &SCOPE, T1, false)
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
            .create_plan("p1", "T1 load", &SCOPE, T1, false)
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
            .create_plan("p1", "T1 load", &SCOPE, T1, false)
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

    // ---------- sample-data seed (ticket 07) ----------

    #[test]
    fn migration_two_adds_the_is_sample_flag_to_plans() {
        let store = store();
        let version: i64 = store
            .conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .expect("user_version must be readable");
        assert_eq!(version, 4, "a fresh database runs all four migrations");
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
        assert_eq!(version, 4, "a fresh database runs all four migrations");
        assert!(
            column_names(&store.conn, "plan_sections").contains(&"missing".to_string()),
            "plan_sections must carry the missing marker"
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
        assert_eq!(version, 4);
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
        assert_eq!(version, 4);
        let missing: i64 = conn
            .query_row("SELECT missing FROM plan_sections", [], |row| row.get(0))
            .expect("missing must be readable");
        assert_eq!(missing, 0, "memberships created before v3 are not missing");
    }

    #[test]
    fn create_plan_marks_sample_plans_explicitly() {
        let mut store = store();
        store.create_plan("normal", "Normal", &SCOPE, T1, false).expect("normal plan");
        store.create_plan("sample", "Sample", &SCOPE, T1, true).expect("sample plan");

        let mut stmt = store
            .conn
            .prepare("SELECT id, is_sample FROM plans ORDER BY id")
            .expect("prepare");
        let flags: Vec<(String, i64)> = stmt
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .expect("query")
            .map(|row| row.expect("row"))
            .collect();
        assert_eq!(
            flags,
            vec![("normal".to_string(), 0), ("sample".to_string(), 1)],
            "only the seeded plan carries the sample marker"
        );
    }

    #[test]
    fn seeding_a_sample_plan_is_transactional_and_idempotent() {
        let mut store = store();
        let sections = [
            parsed_section(2923, 384, "S01", None, Some(10), vec![online_block(Day::Mon, 450, 540)]),
            parsed_section(564, 737, "Y11", None, Some(10), vec![
                room_block(Day::Tue, 870, 960, "L226"),
                online_block(Day::Fri, 870, 960),
            ]),
        ];

        let first = store
            .seed_sample_plan(&SCOPE, "sample-plan", "Sample data", &[&sections[..]], T1)
            .expect("first seed");
        assert!(first.is_sample, "the seeded plan is visibly marked as sample data");
        assert_eq!(first.section_count, 2);

        // Running the seed again must change nothing: no duplicate sections,
        // no extra snapshots, no second plan.
        let again = store
            .seed_sample_plan(&SCOPE, "sample-plan", "Sample data", &[&sections[..]], T2)
            .expect("second seed must not fail");
        assert_eq!(again.id, first.id, "the second seed returns the existing plan");
        assert_eq!(count(&store.conn, "SELECT COUNT(*) FROM plans"), 1);
        assert_eq!(count(&store.conn, "SELECT COUNT(*) FROM sections"), 2);
        assert_eq!(count(&store.conn, "SELECT COUNT(*) FROM plan_sections"), 2);
        assert_eq!(
            count(&store.conn, "SELECT COUNT(*) FROM snapshots"),
            2,
            "a repeat seed must not re-capture"
        );
    }

    #[test]
    fn a_failed_seed_leaves_no_partial_plan() {
        let mut store = store();
        let sections = [parsed_section(2923, 384, "S01", None, Some(10), vec![])];
        // A plan with the reserved id already exists: the seed's create step
        // fails, and nothing from the seed may remain behind.
        store.create_plan("sample-plan", "taken", &SCOPE, T1, false).expect("existing plan");

        let err = store
            .seed_sample_plan(&SCOPE, "sample-plan", "Sample data", &[&sections[..]], T2)
            .expect_err("a taken plan id must fail the seed");
        assert!(!matches!(err, StoreError::Sql(_)), "got {err:?}");
        assert_eq!(count(&store.conn, "SELECT COUNT(*) FROM sections"), 0);
        assert_eq!(count(&store.conn, "SELECT COUNT(*) FROM snapshots"), 0);
        assert_eq!(
            count(&store.conn, "SELECT COUNT(*) FROM plans"),
            1,
            "the existing plan is the only plan"
        );
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
        store.create_plan("p1", "T1 load", &SCOPE, T1, false).expect("plan");
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
        store.create_plan("p1", "T1 load", &SCOPE, T1, false).expect("plan");
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
        store.create_plan("p1", "T1 load", &SCOPE, T1, false).expect("plan");
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
        store.create_plan("p1", "T1 load", &SCOPE, T1, false).expect("plan");
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
        store.create_plan("p1", "T1 load", &SCOPE, T1, false).expect("plan");
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
        store.create_plan("p1", "T1 load", &SCOPE, T1, false).expect("plan");
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
        store.create_plan("p1", "T1 load", &SCOPE, T1, false).expect("plan");
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
        store.create_plan("p1", "T1 load", &SCOPE, T1, false).expect("plan");
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
        store.create_plan("p1", "T1 load", &SCOPE, T1, false).expect("plan");
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
            store.create_plan("p1", "T1 load", &SCOPE, T1, false).expect("plan");
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
        store.create_plan("p1", "T1 load", &SCOPE, T1, false).expect("plan");
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
        store.create_plan("p1", "T1 load", &SCOPE, T1, false).expect("plan");
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
        store.create_plan("p1", "T1 load", &SCOPE, T1, false).expect("plan");
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
        assert!(summary.can_undo, "a real batch is undoable");

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

    // ---------- undo ----------

    #[test]
    fn undo_reverses_the_most_recent_batch_removing_what_it_introduced() {
        let mut store = store();
        store
            .record_capture(&SCOPE, &[parsed_section(2923, 384, "S01", None, Some(10), vec![])], T1)
            .expect("first batch");
        store
            .record_capture(&SCOPE, &[parsed_section(2999, 400, "S01", None, Some(5), vec![])], T2)
            .expect("second batch");

        assert!(store.undo_last_capture().expect("undo"), "undo must reverse a batch");

        assert_eq!(count(&store.conn, "SELECT COUNT(*) FROM sections"), 1);
        assert_eq!(count(&store.conn, "SELECT COUNT(*) FROM courses"), 1);
        assert_eq!(count(&store.conn, "SELECT COUNT(*) FROM snapshots"), 1);
        assert_eq!(count(&store.conn, "SELECT COUNT(*) FROM schedule_blocks"), 0);
        assert_eq!(
            section_rows(&store.conn),
            vec![(7, 155, 2923, 384, "S01".into(), T1.into(), T1.into())],
            "the first batch's section survives untouched"
        );
        assert!(
            !store.capture_summary(&SCOPE).expect("summary").can_undo,
            "undo consumes the most recent batch"
        );
    }

    #[test]
    fn undo_restores_prior_state_of_pre_existing_sections() {
        let mut store = store();
        let first = parsed_section(2923, 384, "S01", None, Some(10), vec![
            online_block(Day::Mon, 450, 540),
        ]);
        let second = parsed_section(2923, 384, "S01", Some("Bryant Lee"), Some(42), vec![
            room_block(Day::Tue, 870, 960, "L226"),
        ]);
        store.record_capture(&SCOPE, &[first], T1).expect("first batch");
        store.record_capture(&SCOPE, &[second], T2).expect("second batch");

        assert!(store.undo_last_capture().expect("undo"));

        let rows = section_rows(&store.conn);
        assert_eq!(rows.len(), 1, "the section itself pre-existed and survives");
        assert_eq!(rows[0].5, T1, "first_seen_at stays at first capture");
        assert_eq!(rows[0].6, T1, "last_seen_at is restored to the prior capture");
        assert_eq!(
            snapshot_rows(&store.conn),
            vec![(384, T1.to_string(), Some(10), None)],
            "the batch's snapshot is removed; the earlier one stays readable"
        );
        assert_eq!(
            block_rows(&store.conn),
            vec![(384, "MON".into(), 450, 540, None, Some("ONLINE".into()))],
            "blocks are restored to the prior capture"
        );
    }

    #[test]
    fn undo_is_safe_when_there_is_nothing_to_undo() {
        let mut store = store();
        assert!(
            !store.undo_last_capture().expect("undo of nothing must not error"),
            "nothing to undo on a fresh store"
        );
        assert!(!store.undo_last_capture().expect("a repeat call is still safe"));

        store
            .record_capture(&SCOPE, &[parsed_section(2923, 384, "S01", None, Some(10), vec![])], T1)
            .expect("capture");
        assert!(store.undo_last_capture().expect("undo"));
        assert!(
            !store.undo_last_capture().expect("double undo must be a no-op"),
            "undo never undoes twice"
        );
        assert_eq!(
            count(&store.conn, "SELECT COUNT(*) FROM sections"),
            0,
            "the second undo changed nothing"
        );
    }

    #[test]
    fn an_empty_batch_changes_nothing_and_is_not_undoable() {
        let mut store = store();
        store.record_capture(&SCOPE, &[], T1).expect("empty capture");
        let summary = store.capture_summary(&SCOPE).expect("summary");
        assert_eq!(summary.section_count, 0);
        assert_eq!(summary.course_count, 0);
        assert!(!summary.can_undo, "an empty batch must not enable undo");
        assert!(!store.undo_last_capture().expect("undo is safe"));
    }

    #[test]
    fn undo_of_a_hybrid_batch_keeps_untouched_sections_intact() {
        let mut store = store();
        // Batch 1 introduces two sections of the same course.
        let batch1 = vec![
            parsed_section(2923, 384, "S01", None, Some(10), vec![]),
            parsed_section(2923, 385, "S02", None, Some(20), vec![]),
        ];
        // Batch 2 re-captures only S01; S02 stays untouched by the batch.
        let batch2 = vec![parsed_section(2923, 384, "S01", None, Some(11), vec![])];
        store.record_capture(&SCOPE, &batch1, T1).expect("batch 1");
        store.record_capture(&SCOPE, &batch2, T2).expect("batch 2");

        assert!(store.undo_last_capture().expect("undo"));

        assert_eq!(count(&store.conn, "SELECT COUNT(*) FROM sections"), 2);
        assert_eq!(count(&store.conn, "SELECT COUNT(*) FROM courses"), 1);
        // S02's single snapshot survives; S01's second snapshot is gone.
        assert_eq!(snapshot_rows(&store.conn), vec![(384, T1.to_string(), Some(10), None), (385, T1.to_string(), Some(20), None)]);
        let rows = section_rows(&store.conn);
        let s01 = rows.iter().find(|r| r.3 == 384).expect("S01");
        assert_eq!(s01.6, T1, "S01 last_seen_at restored");
        assert_eq!(s01.5, T1, "S01 first_seen_at untouched");
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
    fn refresh_courses_returns_only_plan_courses_with_their_section_ids_in_order() {
        let mut store = store();
        store.create_plan("p1", "T1 load", &SCOPE, T1, false).expect("plan");
        let mut geartap_y11 = parsed_section(564, 737, "Y11", None, Some(10), vec![]);
        geartap_y11.course_code = "GEARTAP".into();
        let mut geartap_y12 = parsed_section(564, 738, "Y12", None, Some(10), vec![]);
        geartap_y12.course_code = "GEARTAP".into();
        // Captured out of order so course-id ordering is what is asserted.
        let catalog = vec![
            parsed_section(2923, 384, "S01", None, Some(10), vec![]),
            parsed_section(2923, 385, "S02", None, Some(20), vec![]),
            geartap_y11,
            geartap_y12,
            // A captured course with no plan membership must not appear.
            parsed_section(999, 500, "X01", None, Some(5), vec![]),
        ];
        store.record_capture(&SCOPE, &catalog, T1).expect("capture");
        store.add_section_to_plan("p1", 2923, 385).expect("add S02");
        store.add_section_to_plan("p1", 564, 737).expect("add Y11");
        store.add_section_to_plan("p1", 2923, 384).expect("add S01");

        let courses = store.refresh_courses("p1").expect("refresh courses");
        assert_eq!(courses.len(), 2, "only courses in the plan are refreshed");
        assert_eq!(courses[0].course_id, 564, "courses are ordered by course id");
        assert_eq!(courses[0].code, "GEARTAP");
        assert_eq!(courses[0].plan_section_ids, vec![737]);
        assert_eq!(courses[1].course_id, 2923);
        assert_eq!(courses[1].code, "CSINTSY");
        assert_eq!(courses[1].plan_section_ids, vec![384, 385]);
    }

    #[test]
    fn refresh_courses_is_empty_for_an_empty_plan() {
        let mut store = store();
        store.create_plan("p1", "T1 load", &SCOPE, T1, false).expect("plan");
        assert!(store.refresh_courses("p1").expect("refresh courses").is_empty());
    }

    #[test]
    fn apply_refresh_appends_snapshots_and_marks_a_vanished_section_missing() {
        let mut store = store();
        store.create_plan("p1", "T1 load", &SCOPE, T1, false).expect("plan");
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
        store.create_plan("p1", "T1 load", &SCOPE, T1, false).expect("plan");
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
        store.create_plan("p1", "T1 load", &SCOPE, T1, false).expect("plan");
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
        store.create_plan("p1", "T1 load", &SCOPE, T1, false).expect("plan");
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
        store.create_plan("p1", "T1 load", &SCOPE, T1, false).expect("plan");
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
}
