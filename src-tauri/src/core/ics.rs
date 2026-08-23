//! Headless ICS export (ticket 17).
//!
//! Serialises a plan into an RFC 5545 calendar file that imports cleanly
//! into Google Calendar: one recurring weekly event per schedule block,
//! spanning the section's start and end dates.
//!
//! Domain rules this module upholds:
//! - Every event is anchored to the campus time zone ([`EXPORT_TIMEZONE`]),
//!   never floating, so events do not drift for a student whose machine is
//!   set to another zone. DLSU campuses sit in Philippine time, a fixed
//!   +08:00 offset with no daylight saving, so weekly recurrences keep
//!   their wall-clock time.
//! - Event summaries carry the course code and section code; descriptions
//!   carry the block modality and, when present, the teacher and remark.
//! - Online blocks are distinguishable from room-based ones in the event
//!   location: online exports `Online`, rooms export the room code.
//! - Conflicts are never prevented (ADR-0009): overlapping sections simply
//!   produce overlapping events, which every calendar accepts.
//!
//! Pure logic: no I/O, no network, no Tauri — the export works with no
//! network connection.

use crate::core::ipc_types::{Day, IcsExport};
use chrono::{DateTime, Datelike, NaiveDate, NaiveTime, Utc};
use icalendar::{Calendar, CalendarDateTime, Component, Event, EventLike, Property};

/// The time zone every exported event is anchored to.
pub const EXPORT_TIMEZONE: &str = "Asia/Manila";

/// One schedule block as exported: day, times, and the location slot, where
/// `None` means the block meets online.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExportBlock {
    pub day: Day,
    pub start_min: i64,
    pub end_min: i64,
    pub location: Option<String>,
}

/// One planned section as exported.
///
/// `teacher: None` and `remark: None` mean unknown — they are omitted from
/// the description rather than rendered as blanks.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExportSection {
    pub course_id: i64,
    pub section_id: i64,
    pub course_code: String,
    pub section_code: String,
    pub teacher: Option<String>,
    pub remark: Option<String>,
    /// First day of the term span; the recurrence starts on this week.
    pub start_date: NaiveDate,
    /// Last day of the term span; no occurrence may land after it.
    pub end_date: NaiveDate,
    pub blocks: Vec<ExportBlock>,
}

/// Everything the exporter needs about one plan: its name and each member
/// section in full.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExportPlan {
    pub name: String,
    pub sections: Vec<ExportSection>,
}

/// Serialises a plan into an `.ics` calendar file.
///
/// Each schedule block becomes one weekly recurring event anchored in
/// [`EXPORT_TIMEZONE`]. The output is deterministic for identical input, so
/// re-exporting a changed plan updates the same events on re-import instead
/// of duplicating them.
pub fn export_plan_ics(
    plan_name: &str,
    sections: &[ExportSection],
    generated_at: DateTime<Utc>,
) -> IcsExport {
    let trimmed_name = plan_name.trim();
    let mut calendar = Calendar::empty();
    calendar
        .append_property(Property::new("VERSION", "2.0"))
        .append_property(Property::new("PRODID", "-//Animo Plan//ICS Export//EN"))
        .append_property(Property::new("CALSCALE", "GREGORIAN"))
        .append_property(Property::new("METHOD", "PUBLISH"));
    if !trimmed_name.is_empty() {
        calendar.name(trimmed_name);
    }
    calendar.append_property(Property::new("X-WR-TIMEZONE", EXPORT_TIMEZONE));
    for section in sections {
        for block in &section.blocks {
            calendar.push(block_event(section, block, generated_at));
        }
    }
    IcsExport {
        file_name: file_name_for(trimmed_name),
        contents: calendar.to_string(),
    }
}

/// The RFC 5545 BYDAY token for a schedule-block day. The week is Mon–Sat;
/// Sunday is not representable in the domain.
fn byday(day: Day) -> &'static str {
    match day {
        Day::Mon => "MO",
        Day::Tue => "TU",
        Day::Wed => "WE",
        Day::Thu => "TH",
        Day::Fri => "FR",
        Day::Sat => "SA",
    }
}

/// The first date on or after `from` whose weekday matches the block's day.
fn first_occurrence(from: NaiveDate, day: Day) -> NaiveDate {
    let target = i64::from(match day {
        Day::Mon => 0,
        Day::Tue => 1,
        Day::Wed => 2,
        Day::Thu => 3,
        Day::Fri => 4,
        Day::Sat => 5,
    });
    let current = i64::from(from.weekday().num_days_from_monday());
    let ahead = (target - current).rem_euclid(7);
    from + chrono::Duration::days(ahead)
}

/// A campus-zone DATE-TIME at `date` plus `minutes` since midnight.
///
/// Explicitly zoned, never floating: the value carries its [`EXPORT_TIMEZONE`]
/// reference so it means the same instant everywhere.
fn campus_time(date: NaiveDate, minutes: i64) -> CalendarDateTime {
    let seconds = u32::try_from(minutes * 60).expect("times of day are non-negative");
    let time = NaiveTime::from_num_seconds_from_midnight_opt(seconds, 0)
        .expect("minutes since midnight are a valid wall-clock time");
    CalendarDateTime::WithTimezone {
        date_time: date.and_time(time),
        tzid: EXPORT_TIMEZONE.to_string(),
    }
}

/// One weekly recurring event for one schedule block.
///
/// The recurrence spans the term: the first occurrence is the block's first
/// weekday on or after the section's start date, and `UNTIL` is set to the
/// last instant of the section's end date (in UTC, as RFC 5545 requires when
/// DTSTART carries a TZID), so every occurrence up to and including the end
/// date recurs and none after it does.
fn block_event(
    section: &ExportSection,
    block: &ExportBlock,
    generated_at: DateTime<Utc>,
) -> Event {
    let first_day = first_occurrence(section.start_date, block.day);
    let mut event = Event::new();
    event
        .uid(&event_uid(section, block))
        .timestamp(generated_at)
        .summary(&format!("{} {}", section.course_code, section.section_code))
        .description(&event_description(section, block))
        .starts(campus_time(first_day, block.start_min))
        .ends(campus_time(first_day, block.end_min))
        .location(&location_text(block));
    event.append_property(Property::new(
        "RRULE",
        format!(
            "FREQ=WEEKLY;BYDAY={};UNTIL={}",
            byday(block.day),
            section.end_date.format("%Y%m%dT235959Z")
        ),
    ));
    event
}

/// Online blocks read `Online`; room-based blocks carry the room code, so
/// the two modalities are distinguishable at a glance in the calendar.
fn location_text(block: &ExportBlock) -> String {
    match &block.location {
        Some(room) => room.clone(),
        None => "Online".to_string(),
    }
}

/// The modality line plus, when known, the teacher and remark. Unknown
/// values are omitted, never rendered as blanks.
fn event_description(section: &ExportSection, block: &ExportBlock) -> String {
    let mut lines = vec![match block.location {
        None => "Modality: Online".to_string(),
        Some(_) => "Modality: On campus".to_string(),
    }];
    if let Some(teacher) = &section.teacher {
        lines.push(format!("Teacher: {teacher}"));
    }
    if let Some(remark) = &section.remark {
        lines.push(format!("Remark: {remark}"));
    }
    lines.join("\n")
}

/// A deterministic UID per (section, block): re-importing a fresh export of
/// the same plan updates the existing events instead of duplicating them.
fn event_uid(section: &ExportSection, block: &ExportBlock) -> String {
    format!(
        "{}-{}-{}-{}@animo-plan",
        section.course_id,
        section.section_id,
        byday(block.day),
        block.start_min
    )
}

/// A filesystem-safe default file name derived from the plan name.
fn file_name_for(plan_name: &str) -> String {
    const FORBIDDEN: [char; 9] = ['/', '\\', ':', '*', '?', '"', '<', '>', '|'];
    let stem: String = plan_name
        .chars()
        .map(|c| if FORBIDDEN.contains(&c) || c.is_control() { '-' } else { c })
        .collect::<String>()
        .trim()
        .to_string();
    if stem.is_empty() {
        return "plan.ics".to_string();
    }
    format!("{stem}.ics")
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    const TERM_START: &str = "2026-07-10";
    const TERM_END: &str = "2026-12-09";

    fn date(raw: &str) -> NaiveDate {
        NaiveDate::parse_from_str(raw, "%Y-%m-%d").expect("test dates must parse")
    }

    fn block(day: Day, start_min: i64, end_min: i64, location: Option<&str>) -> ExportBlock {
        ExportBlock {
            day,
            start_min,
            end_min,
            location: location.map(str::to_string),
        }
    }

    fn section(
        course_id: i64,
        section_id: i64,
        course_code: &str,
        section_code: &str,
        teacher: Option<&str>,
        remark: Option<&str>,
        blocks: Vec<ExportBlock>,
    ) -> ExportSection {
        ExportSection {
            course_id,
            section_id,
            course_code: course_code.to_string(),
            section_code: section_code.to_string(),
            teacher: teacher.map(str::to_string),
            remark: remark.map(str::to_string),
            start_date: date(TERM_START),
            end_date: date(TERM_END),
            blocks,
        }
    }

    fn generated_at() -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 8, 22, 10, 0, 0).unwrap()
    }

    fn export_named(plan_name: &str, sections: &[ExportSection]) -> IcsExport {
        export_plan_ics(plan_name, sections, generated_at())
    }

    // ---------- envelope ----------

    #[test]
    fn an_empty_plan_still_produces_a_valid_calendar_envelope() {
        let out = export_named("T1 load", &[]);
        assert_eq!(out.file_name, "T1 load.ics");
        assert!(out.contents.starts_with("BEGIN:VCALENDAR\r\n"), "{}", out.contents);
        assert!(out.contents.trim_end().ends_with("END:VCALENDAR"));
        assert!(out.contents.contains("\r\nVERSION:2.0\r\n"), "{}", out.contents);
        assert!(out.contents.contains("\r\nPRODID:"), "{}", out.contents);
        assert_eq!(
            out.contents.matches("BEGIN:VEVENT").count(),
            0,
            "an empty plan exports no events"
        );
    }

    // ---------- one recurring weekly event per block ----------

    #[test]
    fn each_block_becomes_one_weekly_recurring_event_spanning_the_term_dates() {
        let s01 = section(
            2923,
            384,
            "CSINTSY",
            "S01",
            None,
            None,
            vec![
                block(Day::Mon, 975, 1065, Some("A1103")),
                block(Day::Thu, 975, 1065, Some("G207")),
            ],
        );
        let out = export_named("T1 load", &[s01]);

        assert_eq!(
            out.contents.matches("BEGIN:VEVENT").count(),
            2,
            "one event per schedule block: {}",
            out.contents
        );
        // 2026-07-10 is a Friday, so the Monday block first meets Jul 13 and
        // the Thursday block first meets Jul 16.
        assert!(
            out.contents.contains("DTSTART;TZID=Asia/Manila:20260713T161500"),
            "{}",
            out.contents
        );
        assert!(
            out.contents.contains("DTEND;TZID=Asia/Manila:20260713T174500"),
            "{}",
            out.contents
        );
        assert!(
            out.contents.contains("DTSTART;TZID=Asia/Manila:20260716T161500"),
            "{}",
            out.contents
        );
        assert!(
            out.contents.contains("RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20261209T235959Z"),
            "{}",
            out.contents
        );
        assert!(
            out.contents.contains("RRULE:FREQ=WEEKLY;BYDAY=TH;UNTIL=20261209T235959Z"),
            "{}",
            out.contents
        );
    }

    #[test]
    fn the_first_occurrence_is_the_first_block_weekday_on_or_after_the_start_date() {
        let tuesday = section(
            2923,
            385,
            "CSINTSY",
            "S02",
            None,
            None,
            vec![block(Day::Tue, 450, 540, None)],
        );
        let out = export_named("T1 load", &[tuesday]);
        // Term starts Friday 2026-07-10; the first Tuesday is 2026-07-14.
        assert!(
            out.contents.contains("DTSTART;TZID=Asia/Manila:20260714T073000"),
            "{}",
            out.contents
        );
        assert!(
            out.contents.contains("DTEND;TZID=Asia/Manila:20260714T090000"),
            "{}",
            out.contents
        );
    }

    #[test]
    fn saturday_blocks_recur_on_saturday_not_friday() {
        let saturday = section(
            564,
            900,
            "GEARTAP",
            "S40",
            None,
            None,
            vec![block(Day::Sat, 660, 750, None)],
        );
        let out = export_named("T1 load", &[saturday]);
        // The first Saturday on or after Friday 2026-07-10 is 2026-07-11.
        assert!(
            out.contents.contains("DTSTART;TZID=Asia/Manila:20260711T110000"),
            "{}",
            out.contents
        );
        assert!(
            out.contents.contains("RRULE:FREQ=WEEKLY;BYDAY=SA;UNTIL=20261209T235959Z"),
            "{}",
            out.contents
        );
    }

    // ---------- summary, location, description ----------

    #[test]
    fn summaries_carry_the_course_code_and_section_code() {
        let y11 = section(
            564,
            737,
            "GEARTAP",
            "Y11",
            Some("Bryant Lee"),
            None,
            vec![block(Day::Tue, 870, 960, Some("L226"))],
        );
        let out = export_named("T1 load", &[y11]);
        assert!(out.contents.contains("SUMMARY:GEARTAP Y11"), "{}", out.contents);
    }

    #[test]
    fn room_and_online_blocks_are_distinguishable_in_the_event_location() {
        let hybrid = section(
            564,
            737,
            "GEARTAP",
            "Y11",
            None,
            None,
            vec![
                block(Day::Tue, 870, 960, Some("L226")),
                block(Day::Fri, 870, 960, None),
            ],
        );
        let out = export_named("T1 load", &[hybrid]);
        assert!(out.contents.contains("LOCATION:L226"), "{}", out.contents);
        assert!(out.contents.contains("LOCATION:Online"), "{}", out.contents);
    }

    #[test]
    fn descriptions_carry_the_modality_of_the_block() {
        let hybrid = section(
            564,
            737,
            "GEARTAP",
            "Y11",
            None,
            None,
            vec![
                block(Day::Tue, 870, 960, Some("L226")),
                block(Day::Fri, 870, 960, None),
            ],
        );
        let out = export_named("T1 load", &[hybrid]);
        assert!(out.contents.contains("Modality: On campus"), "{}", out.contents);
        assert!(out.contents.contains("Modality: Online"), "{}", out.contents);
    }

    #[test]
    fn descriptions_carry_teacher_and_remark_only_when_present() {
        let complete = section(
            2923,
            384,
            "CSINTSY",
            "S01",
            Some("Bryant Lee"),
            Some("Bring laptop"),
            vec![block(Day::Mon, 450, 540, None)],
        );
        let out = export_named("T1 load", &[complete]);
        assert!(out.contents.contains("Teacher: Bryant Lee"), "{}", out.contents);
        assert!(out.contents.contains("Remark: Bring laptop"), "{}", out.contents);

        let bare = section(
            2923,
            385,
            "CSINTSY",
            "S02",
            None,
            None,
            vec![block(Day::Mon, 450, 540, None)],
        );
        let out = export_named("T1 load", &[bare]);
        assert!(!out.contents.contains("Teacher:"), "{}", out.contents);
        assert!(!out.contents.contains("Remark:"), "{}", out.contents);
        assert!(out.contents.contains("Modality: Online"), "{}", out.contents);
    }

    // ---------- time zone ----------

    #[test]
    fn every_event_time_is_explicitly_tz_aware_never_floating() {
        let s01 = section(
            2923,
            384,
            "CSINTSY",
            "S01",
            None,
            None,
            vec![block(Day::Mon, 450, 540, None)],
        );
        let out = export_named("T1 load", &[s01]);
        assert!(
            !out.contents.contains("\r\nDTSTART:2026"),
            "no floating DTSTART: {}",
            out.contents
        );
        assert!(
            !out.contents.contains("\r\nDTEND:2026"),
            "no floating DTEND: {}",
            out.contents
        );
        assert_eq!(
            out.contents.matches(";TZID=Asia/Manila:").count(),
            2,
            "DTSTART and DTEND are anchored to the campus zone: {}",
            out.contents
        );
        assert!(
            out.contents.contains(&format!("X-WR-TIMEZONE:{EXPORT_TIMEZONE}")),
            "{}",
            out.contents
        );
    }

    // ---------- conflicting plans still export ----------

    #[test]
    fn a_conflicting_plan_still_exports_overlapping_events_included() {
        let s01 = section(
            2923,
            384,
            "CSINTSY",
            "S01",
            None,
            None,
            vec![
                block(Day::Mon, 450, 540, None),
                block(Day::Thu, 450, 540, None),
            ],
        );
        // Overlaps S01 on Monday 08:00–09:00 — user-authored, legal (ADR-0009).
        let s02 = section(
            2923,
            385,
            "CSINTSY",
            "S02",
            None,
            None,
            vec![block(Day::Mon, 480, 570, None)],
        );
        let out = export_named("T1 load", &[s01, s02]);
        assert_eq!(
            out.contents.matches("BEGIN:VEVENT").count(),
            3,
            "every block exports, including the overlapping ones: {}",
            out.contents
        );
    }

    // ---------- determinism and identity ----------

    #[test]
    fn exporting_twice_produces_identical_output_so_reimports_update_instead_of_duplicate() {
        let s01 = section(
            2923,
            384,
            "CSINTSY",
            "S01",
            Some("Bryant Lee"),
            None,
            vec![block(Day::Mon, 450, 540, None)],
        );
        let first = export_named("T1 load", std::slice::from_ref(&s01));
        let second = export_named("T1 load", &[s01]);
        assert_eq!(first.contents, second.contents);
        assert!(first.contents.contains("@animo-plan"), "{}", first.contents);
        assert!(
            first.contents.contains("DTSTAMP:20260822T100000Z"),
            "{}",
            first.contents
        );
    }

    #[test]
    fn the_serialized_output_is_rfc5545_shaped_end_to_end() {
        let s01 = section(
            2923,
            384,
            "CSINTSY",
            "S01",
            None,
            None,
            vec![block(Day::Mon, 450, 540, Some("A1103"))],
        );
        let out = export_named("T1 load", &[s01]);
        assert_eq!(out.contents, "BEGIN:VCALENDAR\r\n\
             VERSION:2.0\r\n\
             PRODID:-//Animo Plan//ICS Export//EN\r\n\
             CALSCALE:GREGORIAN\r\n\
             METHOD:PUBLISH\r\n\
             NAME:T1 load\r\n\
             X-WR-CALNAME:T1 load\r\n\
             X-WR-TIMEZONE:Asia/Manila\r\n\
             BEGIN:VEVENT\r\n\
             DESCRIPTION:Modality: On campus\r\n\
             DTEND;TZID=Asia/Manila:20260713T090000\r\n\
             DTSTAMP:20260822T100000Z\r\n\
             DTSTART;TZID=Asia/Manila:20260713T073000\r\n\
             LOCATION:A1103\r\n\
             RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20261209T235959Z\r\n\
             SUMMARY:CSINTSY S01\r\n\
             UID:2923-384-MO-450@animo-plan\r\n\
             END:VEVENT\r\n\
             END:VCALENDAR\r\n");
    }

    // ---------- file name ----------

    #[test]
    fn the_file_name_derives_from_the_plan_name_and_stays_filesystem_safe() {
        let simple = export_named("T1 load", &[]);
        assert_eq!(simple.file_name, "T1 load.ics");

        let hostile = export_named("a/b\\c:d*e?f\"g<h>i|j", &[]);
        for forbidden in ['/', '\\', ':', '*', '?', '"', '<', '>', '|'] {
            assert!(
                !hostile.file_name.contains(forbidden),
                "{:?} must not survive into {:?}",
                forbidden,
                hostile.file_name
            );
        }
        assert!(hostile.file_name.ends_with(".ics"));

        let blank = export_named("   ", &[]);
        assert_eq!(blank.file_name, "plan.ics", "a blank name falls back");
    }
}
