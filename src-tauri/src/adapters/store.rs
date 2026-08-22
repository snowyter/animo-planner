//! SQLite persistence for captured sections (ticket 05) and plan membership
//! with conflict computation (ticket 08).
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
use crate::core::ipc_types::{Conflict, Day};
use crate::core::parser::{ParsedBlock, ParsedSection};
use rusqlite::{Connection, OptionalExtension, Transaction};
use std::path::Path;

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
    /// A pin request for a section that is not a member of the plan. Failing
    /// loudly here means pinned state can never silently fail to persist.
    SectionNotInPlan {
        plan_id: String,
        course_id: i64,
        section_id: i64,
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
            StoreError::SectionNotInPlan {
                plan_id,
                course_id,
                section_id,
            } => write!(
                f,
                "section (course {course_id}, section {section_id}) is not in plan {plan_id:?}"
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

/// Owns the connection and all write paths. No section row is ever removed;
/// see `record_capture` and `add_section_to_plan`.
pub struct Store {
    conn: Connection,
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
        Ok(Self { conn })
    }

    pub fn open_in_memory() -> Result<Self, StoreError> {
        let conn = Connection::open_in_memory()?;
        conn.pragma_update(None, "foreign_keys", true)?;
        migrate(&conn)?;
        Ok(Self { conn })
    }

    /// Records one parsed result set: upserts the course and each section,
    /// replaces each section's schedule blocks, and appends one snapshot
    /// per section. Capturing the same course twice yields the same section
    /// rows with `last_seen_at` advanced and one more snapshot per section.
    ///
    /// Sections not present in this capture are never touched, let alone
    /// deleted (ADR-0008); ticket 16 surfaces them.
    pub fn record_capture(
        &mut self,
        scope: &CaptureScope,
        sections: &[ParsedSection],
        captured_at: &str,
    ) -> Result<(), StoreError> {
        let tx = self.conn.transaction()?;
        for section in sections {
            upsert_course(&tx, scope, section)?;
            let section_fk = upsert_section(&tx, scope, section, captured_at)?;
            replace_blocks(&tx, section_fk, section)?;
            append_snapshot(&tx, section_fk, section, captured_at)?;
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
        let (plan_campus, plan_session) = plan_scope(&tx, plan_id)?;
        let section_fk = match scoped_section_fk(
            &tx,
            plan_campus,
            plan_session,
            course_id,
            section_id,
        )? {
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

        // Membership carries no validity constraint (ADR-0009): adding a
        // section that overlaps something already in the plan succeeds.
        tx.execute(
            "INSERT INTO plan_sections (plan_id, section_fk, pinned) VALUES (?1, ?2, 0)
             ON CONFLICT (plan_id, section_fk) DO NOTHING",
            rusqlite::params![plan_id, section_fk],
        )?;
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

fn upsert_section(
    tx: &Transaction<'_>,
    scope: &CaptureScope,
    section: &ParsedSection,
    captured_at: &str,
) -> Result<i64, StoreError> {
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
    Ok(tx.query_row(
        "SELECT id FROM sections
         WHERE campus_id = ?1 AND session_id = ?2 AND course_id = ?3 AND section_id = ?4",
        rusqlite::params![
            scope.campus_id,
            scope.session_id,
            section.course_id,
            section.section_id
        ],
        |row| row.get(0),
    )?)
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

fn append_snapshot(
    tx: &Transaction<'_>,
    section_fk: i64,
    section: &ParsedSection,
    captured_at: &str,
) -> Result<(), StoreError> {
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
    Ok(())
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
}
