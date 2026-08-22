//! SQLite persistence for captured sections (ticket 05).
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

use crate::core::ipc_types::{CaptureSummary, Day};
use crate::core::parser::{ParsedBlock, ParsedSection};
use rusqlite::{Connection, OptionalExtension, Transaction};
use std::path::Path;
use std::sync::{Arc, Mutex};

/// Which campus and academic session a capture belongs to. Sections and
/// plans are both scoped by this pair; it can never be mixed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CaptureScope {
    pub campus_id: i64,
    pub session_id: i64,
}

#[derive(Debug)]
pub enum StoreError {
    Sql(rusqlite::Error),
    PlanNotFound { plan_id: String },
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
}

impl std::fmt::Display for StoreError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            StoreError::Sql(err) => write!(f, "sqlite error: {err}"),
            StoreError::PlanNotFound { plan_id } => write!(f, "plan {plan_id:?} not found"),
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

const MIGRATIONS: &[&str] = &[MIGRATION_V1];

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
    conn: Connection,
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
    ) -> Result<(), StoreError> {
        self.conn.execute(
            "INSERT INTO plans (id, name, campus_id, session_id, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![id, name, scope.campus_id, scope.session_id, created_at],
        )?;
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
        let (plan_campus, plan_session) = tx
            .query_row(
                "SELECT campus_id, session_id FROM plans WHERE id = ?1",
                [plan_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?
            .ok_or_else(|| StoreError::PlanNotFound {
                plan_id: plan_id.to_string(),
            })?;

        let scoped = tx
            .query_row(
                "SELECT id FROM sections
                 WHERE campus_id = ?1 AND session_id = ?2 AND course_id = ?3 AND section_id = ?4",
                rusqlite::params![plan_campus, plan_session, course_id, section_id],
                |row| row.get::<_, i64>(0),
            )
            .optional()?;
        let section_fk = match scoped {
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
        tx.commit()?;
        Ok(())
    }
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
                               course_type, credits, enroll_cap, first_seen_at, last_seen_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
         ON CONFLICT (campus_id, session_id, course_id, section_id) DO UPDATE SET
             section_code = excluded.section_code,
             course_type  = excluded.course_type,
             credits      = excluded.credits,
             enroll_cap   = excluded.enroll_cap,
             last_seen_at = excluded.last_seen_at",
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::ipc_types::BlockModality;
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
        assert_eq!(version, 1);
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
                &["id", "name", "campus_id", "session_id", "created_at"],
            ),
            (
                "plan_sections",
                &["plan_id", "section_fk", "pinned"],
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
}
