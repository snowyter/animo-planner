//! Headless parser for the Archer's Hub Course Finder results table.
//!
//! Pure logic: no database, no network, no Tauri. Given the HTML of a
//! rendered Course Finder results table plus the course identity read from
//! the page's course dropdown, this produces typed sections and their
//! schedule blocks â€” day, start time, end time, location, and derived
//! modality. Every selector and grammar rule arrives via [`SelectorConfig`],
//! never as a constant inside this module (ADR-0013).

use crate::core::ipc_types::{BlockModality, Day, SectionModality};
use chrono::{NaiveDate, NaiveTime, Timelike};
use scraper::{ElementRef, Html, Selector};
use serde::{Deserialize, Serialize};
use std::fmt;

/// The identity of the course whose results are being parsed.
///
/// Read from the selected `#ddlSelectCourse` option at capture time â€” the
/// results table has no course code column, so sections parsed without this
/// context would be orphaned.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CourseContext {
    pub course_id: i64,
    pub code: String,
    pub title: String,
}

/// DOM selectors and parse rules for the Course Finder page.
///
/// The bundled copy is [`SelectorConfig::default`]; ticket 18 replaces it
/// with a remote JSON config at startup.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectorConfig {
    /// Selector for the results table element.
    pub results_table: String,
    /// Selector for result rows, evaluated within the results table.
    pub result_row: String,
    /// Cell selectors, each evaluated within a result row.
    pub course_type_cell: String,
    /// The published `selector-config.json` shipped this as `teacherCell`
    /// before the app settled on *professor* as its word. The alias keeps a
    /// new build working against a config that still says `teacherCell`:
    /// without it the whole document fails to deserialize and the fetch
    /// falls back to the bundled copy, which is exactly the outage the
    /// remote config exists to prevent (ADR-0013).
    #[serde(alias = "teacherCell")]
    pub professor_cell: String,
    pub credits_cell: String,
    pub section_code_cell: String,
    pub schedule_cell: String,
    pub enroll_cap_cell: String,
    pub enrolled_cell: String,
    pub remark_cell: String,
    /// The trailing hidden cells carrying the numeric course and section ids.
    pub hidden_course_id_cell: String,
    pub hidden_section_id_cell: String,
    /// Row attributes carrying the section start and end dates.
    pub start_date_attr: String,
    pub end_date_attr: String,
    /// Selector for the course dropdown the capture script reads identity from.
    pub course_dropdown: String,
    /// Tag name that joins schedule blocks inside the schedule cell.
    pub block_join_tag: String,
    /// Brackets wrapping one schedule block.
    pub block_open: String,
    pub block_close: String,
    /// Separator between the day/time part and the location part of a block.
    pub location_separator: String,
    /// Separator between day, start time, and end time within a block.
    pub times_separator: String,
    /// Prefix that marks a room-code location.
    pub room_prefix: String,
    /// Literal that marks an online location.
    pub online_literal: String,
    /// `chrono` format for times like `02:30 PM`.
    pub time_format: String,
    /// `chrono` format for dates like `07/10/2026` (month/day/year).
    pub date_format: String,
    pub day_names: DayNames,
}

/// Upper-case day-name spellings as they appear in schedule blocks.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DayNames {
    pub monday: String,
    pub tuesday: String,
    pub wednesday: String,
    pub thursday: String,
    pub friday: String,
    pub saturday: String,
}

impl Default for DayNames {
    fn default() -> Self {
        Self {
            monday: "MONDAY".into(),
            tuesday: "TUESDAY".into(),
            wednesday: "WEDNESDAY".into(),
            thursday: "THURSDAY".into(),
            friday: "FRIDAY".into(),
            saturday: "SATURDAY".into(),
        }
    }
}

impl Default for SelectorConfig {
    fn default() -> Self {
        Self {
            results_table: "#tblCourseSelection".into(),
            result_row: "tbody tr".into(),
            course_type_cell: "td:nth-child(1)".into(),
            professor_cell: "td:nth-child(2)".into(),
            credits_cell: "td:nth-child(3)".into(),
            section_code_cell: "td:nth-child(4)".into(),
            schedule_cell: "td:nth-child(5)".into(),
            enroll_cap_cell: "td:nth-child(6)".into(),
            enrolled_cell: "td:nth-child(7)".into(),
            remark_cell: "td:nth-child(8)".into(),
            hidden_course_id_cell: "td[hidden]:nth-child(10)".into(),
            hidden_section_id_cell: "td[hidden]:nth-child(11)".into(),
            start_date_attr: "data-start-date".into(),
            end_date_attr: "data-end-date".into(),
            course_dropdown: "#ddlSelectCourse".into(),
            block_join_tag: "br".into(),
            block_open: "[".into(),
            block_close: "]".into(),
            location_separator: " : ".into(),
            times_separator: " - ".into(),
            room_prefix: "Room - ".into(),
            online_literal: "Online".into(),
            time_format: "%I:%M %p".into(),
            date_format: "%m/%d/%Y".into(),
            day_names: DayNames::default(),
        }
    }
}

/// A block's location slot, exactly as it appeared, classified.
///
/// A location that is neither a room code nor the online literal is kept in
/// a representable state â€” never dropped, never guessed at â€” and flagged
/// with a diagnostic by the parser.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ParsedLocation {
    /// `Room - <CODE>` â€” meets in a room on campus.
    Room(String),
    /// The online literal â€” meets online.
    Online,
    /// TBA, blank, or unrecognised â€” representable, flagged by a diagnostic.
    Unrecognized(String),
}

/// One meeting of a section on one day.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedBlock {
    pub day: Day,
    pub start_min: i64,
    pub end_min: i64,
    pub location: ParsedLocation,
}

impl ParsedBlock {
    /// Modality derived from the location slot, never read as a field.
    /// `None` only for locations the parser could not classify.
    pub fn modality(&self) -> Option<BlockModality> {
        match &self.location {
            ParsedLocation::Room(_) => Some(BlockModality::F2F),
            ParsedLocation::Online => Some(BlockModality::Online),
            ParsedLocation::Unrecognized(_) => None,
        }
    }
}

/// One scheduled offering of a course, as read from a single results row.
///
/// `professor: None` and `remark: None` mean *unknown* (the cell was blank),
/// never "not this professor".
#[derive(Debug, Clone, PartialEq)]
pub struct ParsedSection {
    pub course_id: i64,
    pub course_code: String,
    pub course_title: String,
    pub section_id: i64,
    pub section_code: String,
    pub course_type: Option<String>,
    pub credits: Option<f64>,
    pub enroll_cap: Option<i64>,
    pub enrolled: Option<i64>,
    pub professor: Option<String>,
    pub remark: Option<String>,
    pub start_date: Option<NaiveDate>,
    pub end_date: Option<NaiveDate>,
    pub blocks: Vec<ParsedBlock>,
}

impl ParsedSection {
    /// Overall modality derived from the mix of the section's blocks.
    /// `None` only when no block's location could be classified.
    pub fn modality(&self) -> Option<SectionModality> {
        let mut saw_f2f = false;
        let mut saw_online = false;
        for block in &self.blocks {
            match block.modality() {
                Some(BlockModality::F2F) => saw_f2f = true,
                Some(BlockModality::Online) => saw_online = true,
                None => {}
            }
        }
        match (saw_f2f, saw_online) {
            (true, true) => Some(SectionModality::Hybrid),
            (true, false) => Some(SectionModality::F2F),
            (false, true) => Some(SectionModality::Online),
            (false, false) => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DiagnosticSeverity {
    Warning,
    Error,
}

/// A parse-time problem attached to a specific result row (1-based).
///
/// Diagnostics never stop the parse: the row is kept where representable
/// and only skipped when it cannot be identified.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Diagnostic {
    pub severity: DiagnosticSeverity,
    pub row: usize,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ParseResult {
    pub sections: Vec<ParsedSection>,
    pub diagnostics: Vec<Diagnostic>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ParseError {
    ResultsTableNotFound,
    InvalidSelector { selector: String, detail: String },
    CourseDropdownNotFound,
    SelectedCourseUnreadable { detail: String },
}

impl fmt::Display for ParseError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ParseError::ResultsTableNotFound => {
                write!(f, "results table not found in the given HTML")
            }
            ParseError::InvalidSelector { selector, detail } => {
                write!(f, "invalid selector {selector:?}: {detail}")
            }
            ParseError::CourseDropdownNotFound => {
                write!(f, "course dropdown not found in the given HTML")
            }
            ParseError::SelectedCourseUnreadable { detail } => {
                write!(f, "selected course cannot be read from the dropdown: {detail}")
            }
        }
    }
}

impl DayNames {
    /// Maps a day spelling from a schedule block to its [`Day`], ignoring
    /// case. Returns `None` for spellings this config does not know.
    fn parse_day(&self, raw: &str) -> Option<Day> {
        let raw = raw.trim();
        for (name, day) in [
            (self.monday.as_str(), Day::Mon),
            (self.tuesday.as_str(), Day::Tue),
            (self.wednesday.as_str(), Day::Wed),
            (self.thursday.as_str(), Day::Thu),
            (self.friday.as_str(), Day::Fri),
            (self.saturday.as_str(), Day::Sat),
        ] {
            if raw.eq_ignore_ascii_case(name) {
                return Some(day);
            }
        }
        None
    }
}

/// All cell selectors compiled once per parse, so a bad config fails fast.
struct CompiledSelectors {
    course_type_cell: Selector,
    professor_cell: Selector,
    credits_cell: Selector,
    section_code_cell: Selector,
    schedule_cell: Selector,
    enroll_cap_cell: Selector,
    enrolled_cell: Selector,
    remark_cell: Selector,
    hidden_course_id_cell: Selector,
    hidden_section_id_cell: Selector,
}

impl CompiledSelectors {
    fn compile(config: &SelectorConfig) -> Result<Self, ParseError> {
        fn compile(selector: &str) -> Result<Selector, ParseError> {
            Selector::parse(selector).map_err(|detail| ParseError::InvalidSelector {
                selector: selector.to_string(),
                detail: detail.to_string(),
            })
        }
        Ok(Self {
            course_type_cell: compile(&config.course_type_cell)?,
            professor_cell: compile(&config.professor_cell)?,
            credits_cell: compile(&config.credits_cell)?,
            section_code_cell: compile(&config.section_code_cell)?,
            schedule_cell: compile(&config.schedule_cell)?,
            enroll_cap_cell: compile(&config.enroll_cap_cell)?,
            enrolled_cell: compile(&config.enrolled_cell)?,
            remark_cell: compile(&config.remark_cell)?,
            hidden_course_id_cell: compile(&config.hidden_course_id_cell)?,
            hidden_section_id_cell: compile(&config.hidden_section_id_cell)?,
        })
    }
}

fn warn(diagnostics: &mut Vec<Diagnostic>, row: usize, message: String) {
    diagnostics.push(Diagnostic {
        severity: DiagnosticSeverity::Warning,
        row,
        message,
    });
}

fn error(diagnostics: &mut Vec<Diagnostic>, row: usize, message: String) {
    diagnostics.push(Diagnostic {
        severity: DiagnosticSeverity::Error,
        row,
        message,
    });
}

/// Cell text, or `None` when the configured cell selector matches nothing.
fn cell_text(row: &ElementRef<'_>, selector: &Selector) -> Option<String> {
    row.select(selector)
        .next()
        .map(|cell| cell.text().collect::<String>())
}

/// Blank cell text parses as `None` (unknown); otherwise the trimmed value.
fn blank_to_none(text: Option<String>) -> Option<String> {
    match text {
        Some(text) if text.trim().is_empty() => None,
        Some(text) => Some(text.trim().to_string()),
        None => None,
    }
}

/// Parses an optional cell value: absent or blank means `None`; a present
/// value that fails to parse is returned as `Err(raw)` so the caller can
/// diagnose it instead of guessing.
fn optional_number<T: std::str::FromStr>(text: Option<String>) -> Result<Option<T>, String> {
    match text {
        None => Ok(None),
        Some(raw) if raw.trim().is_empty() => Ok(None),
        Some(raw) => raw.trim().parse::<T>().map(Some).map_err(|_| raw),
    }
}

/// Splits a schedule cell's inner HTML into one fragment per block, treating
/// the configured join tag (`<br>`, `<br/>`, `<br />`, any case) as the
/// separator.
fn split_block_fragments(inner_html: &str, join_tag: &str) -> Vec<String> {
    const SENTINEL: char = '\u{0}';
    let lower = inner_html.to_ascii_lowercase();
    let tag = join_tag.to_ascii_lowercase();
    let variants = [
        format!("<{tag}>"),
        format!("<{tag}/>"),
        format!("<{tag} />"),
    ];
    let mut normalized = String::with_capacity(inner_html.len());
    let mut offset = 0;
    while offset < lower.len() {
        let matched = variants
            .iter()
            .filter_map(|variant| {
                lower[offset..]
                    .find(variant.as_str())
                    .map(|index| (offset + index, variant.len()))
            })
            .min_by_key(|(index, _)| *index);
        match matched {
            Some((index, length)) => {
                normalized.push_str(&inner_html[offset..index]);
                normalized.push(SENTINEL);
                offset = index + length;
            }
            None => {
                normalized.push_str(&inner_html[offset..]);
                break;
            }
        }
    }
    normalized.split(SENTINEL).map(str::to_string).collect()
}

/// `text` prefixed with `prefix`, ignoring ASCII case. The prefix is ASCII,
/// so a match guarantees the cut lands on a character boundary.
fn strip_prefix_ignore_case<'a>(text: &'a str, prefix: &str) -> Option<&'a str> {
    if text
        .get(..prefix.len())
        .is_some_and(|head| head.eq_ignore_ascii_case(prefix))
    {
        text.get(prefix.len()..)
    } else {
        None
    }
}

/// Classifies a location slot: the online literal, a room code behind the
/// room prefix, or an unrecognised value kept verbatim.
fn classify_location(raw: &str, config: &SelectorConfig) -> ParsedLocation {
    if raw.eq_ignore_ascii_case(&config.online_literal) {
        ParsedLocation::Online
    } else if let Some(rest) = strip_prefix_ignore_case(raw, &config.room_prefix) {
        let code = rest.trim();
        if code.is_empty() {
            ParsedLocation::Unrecognized(raw.to_string())
        } else {
            ParsedLocation::Room(code.to_string())
        }
    } else {
        ParsedLocation::Unrecognized(raw.to_string())
    }
}

/// Parses a clock time into minutes since midnight.
fn parse_minutes(raw: &str, format: &str) -> Result<i64, String> {
    let raw = raw.trim();
    let time = NaiveTime::parse_from_str(raw, format)
        .map_err(|detail| format!("{raw:?} does not match time format {format:?}: {detail}"))?;
    Ok(i64::from(time.hour()) * 60 + i64::from(time.minute()))
}

fn parse_date(raw: &str, format: &str) -> Result<NaiveDate, String> {
    let raw = raw.trim();
    NaiveDate::parse_from_str(raw, format)
        .map_err(|detail| format!("{raw:?} does not match date format {format:?}: {detail}"))
}

/// Parses one `[ DAY - START - END : LOCATION ]` fragment into a block.
/// The block is kept whenever the day and times parse; an unrecognised
/// location keeps the block representable and is diagnosed, never dropped.
fn parse_block_fragment(
    fragment: &str,
    config: &SelectorConfig,
    row_number: usize,
    diagnostics: &mut Vec<Diagnostic>,
) -> Option<ParsedBlock> {
    let mut inner = fragment.trim();
    if let Some(stripped) = inner.strip_prefix(&config.block_open) {
        inner = stripped;
    } else {
        warn(
            diagnostics,
            row_number,
            format!("schedule block {fragment:?} is missing its opening bracket"),
        );
    }
    if let Some(stripped) = inner.strip_suffix(&config.block_close) {
        inner = stripped;
    } else {
        warn(
            diagnostics,
            row_number,
            format!("schedule block {fragment:?} is missing its closing bracket"),
        );
    }

    let (times_part, location_part) = match inner.split_once(&config.location_separator) {
        Some((times, location)) => (times, location.trim()),
        None => {
            warn(
                diagnostics,
                row_number,
                format!("schedule block {fragment:?} has no location slot"),
            );
            (inner, "")
        }
    };

    let parts: Vec<&str> = times_part
        .split(&config.times_separator)
        .map(str::trim)
        .collect();
    if parts.len() != 3 {
        error(
            diagnostics,
            row_number,
            format!(
                "schedule block {fragment:?} does not match the DAY{sep}START{sep}END grammar",
                sep = config.times_separator
            ),
        );
        return None;
    }

    let Some(day) = config.day_names.parse_day(parts[0]) else {
        error(
            diagnostics,
            row_number,
            format!("unrecognised day {:?} in schedule block", parts[0]),
        );
        return None;
    };

    let start_min = match parse_minutes(parts[1], &config.time_format) {
        Ok(minutes) => minutes,
        Err(detail) => {
            error(diagnostics, row_number, detail);
            return None;
        }
    };
    let end_min = match parse_minutes(parts[2], &config.time_format) {
        Ok(minutes) => minutes,
        Err(detail) => {
            error(diagnostics, row_number, detail);
            return None;
        }
    };

    let location = classify_location(location_part, config);
    if matches!(location, ParsedLocation::Unrecognized(_)) {
        warn(
            diagnostics,
            row_number,
            format!(
                "location {:?} is neither a room code behind {:?} nor {:?}",
                location_part, config.room_prefix, config.online_literal
            ),
        );
    }

    Some(ParsedBlock {
        day,
        start_min,
        end_min,
        location,
    })
}

/// Parses the schedule cell into one block per meeting day.
fn parse_schedule_cell(
    cell: ElementRef<'_>,
    config: &SelectorConfig,
    row_number: usize,
    diagnostics: &mut Vec<Diagnostic>,
) -> Vec<ParsedBlock> {
    split_block_fragments(&cell.inner_html(), &config.block_join_tag)
        .iter()
        .filter_map(|fragment| {
            let fragment = fragment.trim();
            if fragment.is_empty() {
                None
            } else {
                parse_block_fragment(fragment, config, row_number, diagnostics)
            }
        })
        .collect()
}

/// Parses one results row into a section, or `None` when the row cannot be
/// identified with the selected course (diagnosed, never orphaned).
fn parse_row(
    row: ElementRef<'_>,
    context: &CourseContext,
    config: &SelectorConfig,
    selectors: &CompiledSelectors,
    row_number: usize,
    diagnostics: &mut Vec<Diagnostic>,
) -> Option<ParsedSection> {
    let course_id = match cell_text(&row, &selectors.hidden_course_id_cell)
        .and_then(|text| text.trim().parse::<i64>().ok())
    {
        Some(course_id) => course_id,
        None => {
            error(
                diagnostics,
                row_number,
                "row cannot be associated with the selected course: hidden course id cell \
                 is missing or not numeric"
                    .to_string(),
            );
            return None;
        }
    };
    if course_id != context.course_id {
        error(
            diagnostics,
            row_number,
            format!(
                "row carries course id {course_id} but the selected course is {} ({}) â€” \
                 refusing to orphan this row",
                context.course_id, context.code
            ),
        );
        return None;
    }

    let section_id = match cell_text(&row, &selectors.hidden_section_id_cell)
        .and_then(|text| text.trim().parse::<i64>().ok())
    {
        Some(section_id) => section_id,
        None => {
            error(
                diagnostics,
                row_number,
                "row has no section id and cannot be captured".to_string(),
            );
            return None;
        }
    };

    let credits = match optional_number::<f64>(cell_text(&row, &selectors.credits_cell)) {
        Ok(credits) => credits,
        Err(raw) => {
            error(
                diagnostics,
                row_number,
                format!("credits {raw:?} is not a number"),
            );
            None
        }
    };
    let enroll_cap = match optional_number::<i64>(cell_text(&row, &selectors.enroll_cap_cell)) {
        Ok(enroll_cap) => enroll_cap,
        Err(raw) => {
            error(
                diagnostics,
                row_number,
                format!("enroll cap {raw:?} is not a number"),
            );
            None
        }
    };
    let enrolled = match optional_number::<i64>(cell_text(&row, &selectors.enrolled_cell)) {
        Ok(enrolled) => enrolled,
        Err(raw) => {
            error(
                diagnostics,
                row_number,
                format!("enrolled count {raw:?} is not a number"),
            );
            None
        }
    };

    let start_date = match row.value().attr(&config.start_date_attr) {
        Some(raw) => match parse_date(raw, &config.date_format) {
            Ok(date) => Some(date),
            Err(detail) => {
                error(diagnostics, row_number, format!("start date: {detail}"));
                None
            }
        },
        None => None,
    };
    let end_date = match row.value().attr(&config.end_date_attr) {
        Some(raw) => match parse_date(raw, &config.date_format) {
            Ok(date) => Some(date),
            Err(detail) => {
                error(diagnostics, row_number, format!("end date: {detail}"));
                None
            }
        },
        None => None,
    };

    let blocks = match row.select(&selectors.schedule_cell).next() {
        Some(cell) => parse_schedule_cell(cell, config, row_number, diagnostics),
        None => {
            warn(
                diagnostics,
                row_number,
                "schedule cell not found in row".to_string(),
            );
            Vec::new()
        }
    };

    let remark = match cell_text(&row, &selectors.remark_cell) {
        Some(text) if text.trim().is_empty() => None,
        Some(text) => Some(text),
        None => None,
    };

    Some(ParsedSection {
        course_id: context.course_id,
        course_code: context.code.clone(),
        course_title: context.title.clone(),
        section_id,
        section_code: blank_to_none(cell_text(&row, &selectors.section_code_cell))
            .unwrap_or_default(),
        course_type: blank_to_none(cell_text(&row, &selectors.course_type_cell)),
        credits,
        enroll_cap,
        enrolled,
        professor: blank_to_none(cell_text(&row, &selectors.professor_cell)),
        remark,
        start_date,
        end_date,
        blocks,
    })
}

/// The (start, end) date pair shared by the most sections in this result
/// set, counting only sections where both dates parsed. First-seen wins
/// ties so the outcome is deterministic.
fn majority_date_pair(sections: &[ParsedSection]) -> Option<(NaiveDate, NaiveDate)> {
    let mut counts: Vec<((NaiveDate, NaiveDate), usize)> = Vec::new();
    for section in sections {
        let Some(pair) = section.start_date.zip(section.end_date) else {
            continue;
        };
        if let Some(entry) = counts.iter_mut().find(|(existing, _)| *existing == pair) {
            entry.1 += 1;
        } else {
            counts.push((pair, 1));
        }
    }
    let mut best: Option<((NaiveDate, NaiveDate), usize)> = None;
    for entry in counts {
        if best.is_none_or(|(_, count)| entry.1 > count) {
            best = Some(entry);
        }
    }
    best.map(|(pair, _)| pair)
}

/// Parses the rendered Course Finder results table into typed sections.
///
/// `context` is the course identity read from the selected course-dropdown
/// option; rows whose hidden course id does not match it are errors, not
/// orphaned sections.
pub fn parse_results_table(
    html: &str,
    context: &CourseContext,
    config: &SelectorConfig,
) -> Result<ParseResult, ParseError> {
    let table_selector = Selector::parse(&config.results_table).map_err(|detail| {
        ParseError::InvalidSelector {
            selector: config.results_table.clone(),
            detail: detail.to_string(),
        }
    })?;
    let row_selector = Selector::parse(&config.result_row).map_err(|detail| {
        ParseError::InvalidSelector {
            selector: config.result_row.clone(),
            detail: detail.to_string(),
        }
    })?;
    let selectors = CompiledSelectors::compile(config)?;

    let document = Html::parse_document(html);
    let table = document
        .select(&table_selector)
        .next()
        .ok_or(ParseError::ResultsTableNotFound)?;

    let mut diagnostics = Vec::new();
    let mut sections = Vec::new();
    let mut section_rows = Vec::new();
    for (index, row) in table.select(&row_selector).enumerate() {
        let row_number = index + 1;
        if let Some(section) =
            parse_row(row, context, config, &selectors, row_number, &mut diagnostics)
        {
            sections.push(section);
            section_rows.push(row_number);
        }
    }

    // A row whose dates differ from the dates shared by the rest of the
    // result set raises a warning; date-range conflict logic is out of
    // scope for v1 (SPEC Â§2).
    if let Some(reference) = majority_date_pair(&sections) {
        for (section, row_number) in sections.iter().zip(&section_rows) {
            let Some(pair) = section.start_date.zip(section.end_date) else {
                continue;
            };
            if pair != reference {
                warn(
                    &mut diagnostics,
                    *row_number,
                    format!(
                        "section {} spans {}..{} which differs from the dates shared by \
                         the rest of the result set",
                        section.section_code, pair.0, pair.1
                    ),
                );
            }
        }
    }

    Ok(ParseResult {
        sections,
        diagnostics,
    })
}

/// Reads the course identity from a rendered Course Finder page the way the
/// capture script does: from the selected option of the course dropdown,
/// never from the results table, which has no course code column (SPEC §2).
///
/// The page renders select2 over the dropdown, and the selection shows up in
/// the select2 container (`select2-<select id>-container`) rather than as a
/// `selected` attribute on the option. The container text is read first and
/// matched against the dropdown options; when no container is present the
/// option carrying the `selected` attribute is used instead. Either way an
/// unreadable selection is an error — the caller must not guess an identity
/// and orphan the parsed sections.
pub fn course_context_from_html(
    html: &str,
    config: &SelectorConfig,
) -> Result<CourseContext, ParseError> {
    fn selector(raw: &str) -> Result<Selector, ParseError> {
        Selector::parse(raw).map_err(|detail| ParseError::InvalidSelector {
            selector: raw.to_string(),
            detail: detail.to_string(),
        })
    }

    let dropdown_selector = selector(&config.course_dropdown)?;
    let document = Html::parse_document(html);
    let dropdown = document
        .select(&dropdown_selector)
        .next()
        .ok_or(ParseError::CourseDropdownNotFound)?;

    // select2 names its rendered container after the select id.
    let select_id = config.course_dropdown.trim_start_matches('#');
    let container_id = format!("select2-{select_id}-container");
    let selected_text: Option<String> = document
        .select(&selector(&format!("#{container_id}"))?)
        .next()
        .map(|element| element.text().collect::<String>().trim().to_string())
        .filter(|text| !text.is_empty());

    let option_selector = selector("option")?;
    let option = match selected_text {
        Some(text) => dropdown
            .select(&option_selector)
            .find(|option| option.text().collect::<String>().trim() == text),
        None => dropdown
            .select(&option_selector)
            .find(|option| option.value().attr("selected").is_some()),
    }
    .ok_or_else(|| ParseError::SelectedCourseUnreadable {
        detail: "no selected course option found".to_string(),
    })?;

    let course_id = option
        .value()
        .attr("value")
        .and_then(|value| value.trim().parse::<i64>().ok())
        .ok_or_else(|| ParseError::SelectedCourseUnreadable {
            detail: "the selected option carries no numeric course id".to_string(),
        })?;

    let text: String = option.text().collect();
    let (code, title) = text
        .trim()
        .split_once(" - ")
        .ok_or_else(|| ParseError::SelectedCourseUnreadable {
            detail: format!("option text {text:?} does not match the CODE - TITLE grammar"),
        })?;

    Ok(CourseContext {
        course_id,
        code: code.trim().to_string(),
        title: title.trim().to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const CSINTSY_FIXTURE: &str =
        include_str!("../../tests/fixtures/ArchersHub-Course-Finder-CSINTSY.html");
    const GEARTAP_FIXTURE: &str =
        include_str!("../../tests/fixtures/ArchersHub-Course-Finder-GEARTAP.html");

    const S01_SCHEDULE: &str =
        "[ MONDAY - 04:15 PM - 05:45 PM : Room - A1103 ]<br>[ THURSDAY - 04:15 PM - 05:45 PM : Room - G207 ]";

    fn context(course_id: i64, code: &str) -> CourseContext {
        CourseContext {
            course_id,
            code: code.to_string(),
            title: "TITLE".to_string(),
        }
    }

    /// Reads the course identity the way the capture script does: from the
    /// selected course-dropdown option only, never from the results table.
    fn course_context_from_fixture(html: &str) -> CourseContext {
        let doc = Html::parse_document(html);
        let config = SelectorConfig::default();
        let rendered = doc
            .select(&Selector::parse("#select2-ddlSelectCourse-container").unwrap())
            .next()
            .expect("select2-rendered course text must be present");
        let selected_text: String =
            rendered.text().collect::<String>().trim().to_string();
        let dropdown = doc
            .select(&Selector::parse(&config.course_dropdown).unwrap())
            .next()
            .expect("course dropdown must be present");
        let option = dropdown
            .select(&Selector::parse("option").unwrap())
            .find(|option| option.text().collect::<String>().trim() == selected_text)
            .expect("the selected course option must be preserved in the dropdown");
        let course_id: i64 = option
            .value()
            .attr("value")
            .expect("selected option must carry a value")
            .trim()
            .parse()
            .expect("course id must be numeric");
        let (code, title) = selected_text
            .split_once(" - ")
            .expect("option text must be CODE - TITLE");
        CourseContext {
            course_id,
            code: code.to_string(),
            title: title.to_string(),
        }
    }

    fn results_page(rows: &str) -> String {
        format!(
            "<html><body>\
             <table id=\"tblCourseSelection\"><thead><tr><th>a</th></tr></thead>\
             <tbody>{rows}</tbody></table>\
             </body></html>"
        )
    }

    fn row(start_end_attrs: &str, cells: [&str; 12]) -> String {
        let mut rendered = format!("<tr {start_end_attrs}>");
        for (index, cell) in cells.iter().enumerate() {
            // The trailing identity cells are hidden, exactly like the page.
            let hidden = if index >= 9 { " hidden" } else { "" };
            rendered.push_str(&format!("<td{hidden}>{cell}</td>"));
        }
        rendered.push_str("</tr>");
        rendered
    }

    fn standard_row(section_code: &str, schedule: &str) -> String {
        row(
            "data-end-date=\"12/09/2026\" data-start-date=\"07/10/2026\"",
            [
                "Lecture",
                "",
                "3",
                section_code,
                schedule,
                "45",
                "10",
                "",
                "<button type=\"button\" data-key=\"x\">Add</button>",
                "2923",
                "384",
                "",
            ],
        )
    }

    fn parse_synthetic(rows: &str) -> ParseResult {
        parse_results_table(
            &results_page(rows),
            &context(2923, "CSINTSY"),
            &SelectorConfig::default(),
        )
        .expect("synthetic page must parse")
    }

    fn find_diagnostic(result: &ParseResult, severity: DiagnosticSeverity) -> Option<&Diagnostic> {
        result
            .diagnostics
            .iter()
            .find(|diagnostic| diagnostic.severity == severity)
    }

    // ---------- fixture acceptance tests ----------

    #[test]
    fn csintsy_fixture_parses_five_sections_with_dropdown_identity() {
        let context = course_context_from_fixture(CSINTSY_FIXTURE);
        assert_eq!(context.course_id, 2923);
        assert_eq!(context.code, "CSINTSY");
        assert_eq!(context.title, "INTRODUCTION TO INTELLIGENT SYSTEMS");

        let result = parse_results_table(
            CSINTSY_FIXTURE,
            &context,
            &SelectorConfig::default(),
        )
        .expect("CSINTSY fixture must parse");

        assert_eq!(result.sections.len(), 5, "CSINTSY has 5 sections");
        assert!(result.diagnostics.is_empty(), "no diagnostics: {:?}", result.diagnostics);
        for section in &result.sections {
            assert_eq!(section.course_id, 2923);
            assert_eq!(section.course_code, "CSINTSY");
            assert_eq!(section.course_title, "INTRODUCTION TO INTELLIGENT SYSTEMS");
            assert_eq!(section.blocks.len(), 2);
        }
    }

    #[test]
    fn geartap_fixture_parses_42_sections_and_84_blocks() {
        let context = course_context_from_fixture(GEARTAP_FIXTURE);
        assert_eq!(context.course_id, 564);
        assert_eq!(context.code, "GEARTAP");
        assert_eq!(context.title, "ART APPRECIATION");

        let result = parse_results_table(
            GEARTAP_FIXTURE,
            &context,
            &SelectorConfig::default(),
        )
        .expect("GEARTAP fixture must parse");

        assert_eq!(result.sections.len(), 42, "GEARTAP has 42 sections");
        assert!(result.diagnostics.is_empty(), "no diagnostics: {:?}", result.diagnostics);

        let block_count: usize = result.sections.iter().map(|s| s.blocks.len()).sum();
        assert_eq!(block_count, 84, "GEARTAP has 84 schedule blocks");

        let room_blocks = result
            .sections
            .iter()
            .flat_map(|s| &s.blocks)
            .filter(|b| matches!(b.location, ParsedLocation::Room(_)))
            .count();
        let online_blocks = result
            .sections
            .iter()
            .flat_map(|s| &s.blocks)
            .filter(|b| matches!(b.location, ParsedLocation::Online))
            .count();
        assert_eq!(room_blocks, 38, "38 blocks meet in rooms");
        assert_eq!(online_blocks, 46, "46 blocks meet online");

        let hybrid = result
            .sections
            .iter()
            .filter(|s| s.modality() == Some(SectionModality::Hybrid))
            .count();
        let online = result
            .sections
            .iter()
            .filter(|s| s.modality() == Some(SectionModality::Online))
            .count();
        let f2f = result
            .sections
            .iter()
            .filter(|s| s.modality() == Some(SectionModality::F2F))
            .count();
        assert_eq!(hybrid, 38);
        assert_eq!(online, 4);
        assert_eq!(f2f, 0);
    }

    #[test]
    fn fixture_sections_carry_known_values() {
        let csintsy = parse_results_table(
            CSINTSY_FIXTURE,
            &course_context_from_fixture(CSINTSY_FIXTURE),
            &SelectorConfig::default(),
        )
        .expect("parse");
        let s01 = csintsy
            .sections
            .iter()
            .find(|s| s.section_code == "S01")
            .expect("S01");
        assert_eq!(s01.section_id, 384);
        assert_eq!(s01.professor, None, "blank professor is unknown");
        assert_eq!(s01.remark, None);
        assert_eq!(s01.enrolled, Some(0));
        assert_eq!(s01.enroll_cap, Some(45));
        assert_eq!(s01.credits, Some(3.0));
        assert_eq!(s01.course_type.as_deref(), Some("Lecture"));
        assert_eq!(s01.start_date, chrono::NaiveDate::from_ymd_opt(2026, 7, 10));
        assert_eq!(s01.end_date, chrono::NaiveDate::from_ymd_opt(2026, 12, 9));
        assert_eq!(s01.modality(), Some(SectionModality::F2F));
        assert_eq!(s01.blocks.len(), 2);
        assert_eq!(s01.blocks[0].day, Day::Mon);
        assert_eq!((s01.blocks[0].start_min, s01.blocks[0].end_min), (975, 1065));
        assert_eq!(s01.blocks[0].location, ParsedLocation::Room("A1103".into()));
        assert_eq!(s01.blocks[0].modality(), Some(BlockModality::F2F));
        assert_eq!(s01.blocks[1].day, Day::Thu);
        assert_eq!(s01.blocks[1].location, ParsedLocation::Room("G207".into()));

        let s40a = csintsy
            .sections
            .iter()
            .find(|s| s.section_code == "S40A")
            .expect("S40A");
        assert_eq!(s40a.professor.as_deref(), Some("Bryant Lee"));
        assert_eq!(s40a.blocks[0].day, Day::Mon);
        assert_eq!((s40a.blocks[0].start_min, s40a.blocks[0].end_min), (450, 540));
        assert_eq!(s40a.blocks[1].day, Day::Thu);

        let geartap = parse_results_table(
            GEARTAP_FIXTURE,
            &course_context_from_fixture(GEARTAP_FIXTURE),
            &SelectorConfig::default(),
        )
        .expect("parse");
        let y11 = geartap
            .sections
            .iter()
            .find(|s| s.section_code == "Y11")
            .expect("Y11");
        assert_eq!(y11.section_id, 737);
        assert_eq!(y11.professor, None);
        assert_eq!(y11.enrolled, Some(0));
        assert_eq!(y11.modality(), Some(SectionModality::Hybrid));
        assert_eq!(y11.blocks[0].day, Day::Tue);
        assert_eq!((y11.blocks[0].start_min, y11.blocks[0].end_min), (870, 960));
        assert_eq!(y11.blocks[0].location, ParsedLocation::Room("L226".into()));
        assert_eq!(y11.blocks[1].day, Day::Fri);
        assert_eq!(y11.blocks[1].location, ParsedLocation::Online);
        assert_eq!(y11.blocks[1].modality(), Some(BlockModality::Online));

        let c49a = geartap
            .sections
            .iter()
            .find(|s| s.section_code == "C49A")
            .expect("C49A");
        assert_eq!(c49a.enrolled, Some(29));
        assert_eq!(c49a.enroll_cap, Some(45));

        let sat_block = geartap
            .sections
            .iter()
            .flat_map(|s| &s.blocks)
            .find(|b| b.day == Day::Sat && b.start_min == 660)
            .expect("the Saturday 11:00 AM block");
        assert_eq!((sat_block.start_min, sat_block.end_min), (660, 750));
        assert_eq!(sat_block.location, ParsedLocation::Online);
    }

    // ---------- course identity ----------

    #[test]
    fn a_row_without_matching_course_context_is_an_error_not_an_orphan() {
        let mismatched = row(
            "data-end-date=\"12/09/2026\" data-start-date=\"07/10/2026\"",
            [
                "Lecture", "", "3", "S01", S01_SCHEDULE, "45", "10", "",
                "<button>Add</button>", "9999", "384", "",
            ],
        );
        let result = parse_synthetic(&mismatched);
        assert!(result.sections.is_empty(), "mismatched row must not become a section");
        let error = find_diagnostic(&result, DiagnosticSeverity::Error)
            .expect("course mismatch must be an error");
        assert!(error.message.contains("course"), "got: {}", error.message);

        let missing = row(
            "data-end-date=\"12/09/2026\" data-start-date=\"07/10/2026\"",
            [
                "Lecture", "", "3", "S01", S01_SCHEDULE, "45", "10", "",
                "<button>Add</button>", "", "", "",
            ],
        );
        let result = parse_synthetic(&missing);
        assert!(result.sections.is_empty(), "row without course id must not become a section");
        assert!(find_diagnostic(&result, DiagnosticSeverity::Error).is_some());
    }

    #[test]
    fn a_row_without_a_section_id_is_an_error() {
        let row = row(
            "data-end-date=\"12/09/2026\" data-start-date=\"07/10/2026\"",
            [
                "Lecture", "", "3", "S01", S01_SCHEDULE, "45", "10", "",
                "<button>Add</button>", "2923", "", "",
            ],
        );
        let result = parse_synthetic(&row);
        assert!(result.sections.is_empty());
        assert!(find_diagnostic(&result, DiagnosticSeverity::Error).is_some());
    }

    #[test]
    fn missing_results_table_is_an_error() {
        let err = parse_results_table(
            "<html><body><p>nothing here</p></body></html>",
            &context(2923, "CSINTSY"),
            &SelectorConfig::default(),
        )
        .expect_err("no table must be an error");
        assert_eq!(err, ParseError::ResultsTableNotFound);
    }

    #[test]
    fn invalid_selector_in_config_is_an_error() {
        let config = SelectorConfig {
            results_table: "###not css###".into(),
            ..SelectorConfig::default()
        };
        let err = parse_results_table("<table></table>", &context(1, "X"), &config)
            .expect_err("invalid selector must be an error");
        assert!(matches!(err, ParseError::InvalidSelector { .. }));
    }

    // ---------- schedule blocks ----------

    #[test]
    fn block_count_is_never_assumed() {
        let one_block = standard_row(
            "S01",
            "[ MONDAY - 07:30 AM - 09:00 AM : Online ]",
        );
        let three_blocks = standard_row(
            "S02",
            "[ MONDAY - 07:30 AM - 09:00 AM : Online ]<br>\
             [ TUESDAY - 07:30 AM - 09:00 AM : Room - L226 ]<br>\
             [ WEDNESDAY - 07:30 AM - 09:00 AM : Online ]",
        );
        let no_blocks = standard_row("S03", "");
        let result = parse_synthetic(&format!("{one_block}{three_blocks}{no_blocks}"));
        assert!(result.diagnostics.is_empty(), "diagnostics: {:?}", result.diagnostics);
        assert_eq!(result.sections.len(), 3);
        assert_eq!(result.sections[0].blocks.len(), 1);
        assert_eq!(result.sections[0].modality(), Some(SectionModality::Online));
        assert_eq!(result.sections[1].blocks.len(), 3);
        assert_eq!(result.sections[1].modality(), Some(SectionModality::Hybrid));
        assert_eq!(result.sections[1].blocks[1].location, ParsedLocation::Room("L226".into()));
        assert_eq!(result.sections[2].blocks.len(), 0);
        assert_eq!(result.sections[2].modality(), None);
    }

    #[test]
    fn times_parse_to_minutes_including_off_lattice_times() {
        let row = standard_row(
            "S01",
            "[ MONDAY - 02:30 PM - 04:00 PM : Online ]<br>\
             [ TUESDAY - 06:00 PM - 07:30 PM : Online ]<br>\
             [ WEDNESDAY - 12:45 PM - 02:15 PM : Online ]",
        );
        let result = parse_synthetic(&row);
        let blocks = &result.sections[0].blocks;
        assert_eq!((blocks[0].start_min, blocks[0].end_min), (870, 960));
        assert_eq!((blocks[1].start_min, blocks[1].end_min), (1080, 1170));
        assert_eq!((blocks[2].start_min, blocks[2].end_min), (765, 855));

        let off_lattice = standard_row(
            "S02",
            "[ MONDAY - 08:00 AM - 08:45 AM : Online ]",
        );
        let result = parse_synthetic(&off_lattice);
        let blocks = &result.sections[0].blocks;
        assert_eq!((blocks[0].start_min, blocks[0].end_min), (480, 525));
    }

    #[test]
    fn online_and_room_locations_derive_modality_per_block() {
        let row = standard_row(
            "S01",
            "[ MONDAY - 07:30 AM - 09:00 AM : Online ]<br>\
             [ TUESDAY - 07:30 AM - 09:00 AM : Room - L226 ]",
        );
        let result = parse_synthetic(&row);
        assert!(result.diagnostics.is_empty(), "diagnostics: {:?}", result.diagnostics);
        let blocks = &result.sections[0].blocks;
        assert_eq!(blocks[0].location, ParsedLocation::Online);
        assert_eq!(blocks[0].modality(), Some(BlockModality::Online));
        assert_eq!(blocks[1].location, ParsedLocation::Room("L226".into()));
        assert_eq!(blocks[1].modality(), Some(BlockModality::F2F));
        assert_eq!(result.sections[0].modality(), Some(SectionModality::Hybrid));
    }

    #[test]
    fn unrecognized_locations_are_representable_and_diagnosed_not_dropped() {
        for (location, expected) in [
            ("TBA", "TBA"),
            ("See canvas", "See canvas"),
        ] {
            let row = standard_row(
                "S01",
                &format!("[ MONDAY - 07:30 AM - 09:00 AM : {location} ]"),
            );
            let result = parse_synthetic(&row);
            assert_eq!(result.sections.len(), 1, "row with {location:?} must parse");
            let block = &result.sections[0].blocks[0];
            assert_eq!(block.location, ParsedLocation::Unrecognized(expected.into()));
            assert_eq!(block.modality(), None);
            assert_eq!(result.sections[0].modality(), None);
            assert!(
                find_diagnostic(&result, DiagnosticSeverity::Warning).is_some(),
                "unrecognised location must raise a diagnostic"
            );
        }
    }

    #[test]
    fn blank_locations_are_representable_and_diagnosed_not_dropped() {
        let row = standard_row("S01", "[ MONDAY - 07:30 AM - 09:00 AM ]");
        let result = parse_synthetic(&row);
        assert_eq!(result.sections.len(), 1);
        assert_eq!(
            result.sections[0].blocks[0].location,
            ParsedLocation::Unrecognized(String::new())
        );
        assert!(find_diagnostic(&result, DiagnosticSeverity::Warning).is_some());

        let empty_room = standard_row("S02", "[ MONDAY - 07:30 AM - 09:00 AM : Room - ]");
        let result = parse_synthetic(&empty_room);
        assert_eq!(
            result.sections[0].blocks[0].location,
            ParsedLocation::Unrecognized("Room -".into())
        );
        assert!(find_diagnostic(&result, DiagnosticSeverity::Warning).is_some());
    }

    #[test]
    fn unknown_days_and_malformed_times_are_diagnosed_and_block_skipped() {
        let sunday = standard_row("S01", "[ SUNDAY - 07:30 AM - 09:00 AM : Online ]");
        let result = parse_synthetic(&sunday);
        assert_eq!(result.sections.len(), 1);
        assert!(result.sections[0].blocks.is_empty());
        let error = find_diagnostic(&result, DiagnosticSeverity::Error)
            .expect("unknown day must be an error");
        assert!(error.message.contains("SUNDAY"), "got: {}", error.message);

        let bad_time = standard_row("S02", "[ MONDAY - XX:30 AM - 09:00 AM : Online ]");
        let result = parse_synthetic(&bad_time);
        assert_eq!(result.sections.len(), 1);
        assert!(result.sections[0].blocks.is_empty());
        assert!(find_diagnostic(&result, DiagnosticSeverity::Error).is_some());
    }

    #[test]
    fn all_six_weekdays_parse_and_week_has_no_sunday() {
        let blocks: Vec<String> = [
            "MONDAY - 07:30 AM - 09:00 AM : Online",
            "TUESDAY - 07:30 AM - 09:00 AM : Online",
            "WEDNESDAY - 07:30 AM - 09:00 AM : Online",
            "THURSDAY - 07:30 AM - 09:00 AM : Online",
            "FRIDAY - 07:30 AM - 09:00 AM : Online",
            "SATURDAY - 07:30 AM - 09:00 AM : Online",
        ]
        .iter()
        .map(|b| format!("[ {b} ]"))
        .collect();
        let row = standard_row("S01", &blocks.join("<br>"));
        let result = parse_synthetic(&row);
        let days: Vec<Day> = result.sections[0].blocks.iter().map(|b| b.day).collect();
        assert_eq!(
            days,
            vec![Day::Mon, Day::Tue, Day::Wed, Day::Thu, Day::Fri, Day::Sat]
        );
    }

    // ---------- professor, remark, numbers ----------

    #[test]
    fn blank_professor_and_remark_parse_as_unknown() {
        let row = standard_row("S01", S01_SCHEDULE);
        let result = parse_synthetic(&row);
        assert_eq!(result.sections[0].professor, None);
        assert_eq!(result.sections[0].remark, None);
    }

    #[test]
    fn populated_professor_is_trimmed_and_remark_is_verbatim() {
        let row = row(
            "data-end-date=\"12/09/2026\" data-start-date=\"07/10/2026\"",
            [
                "Lecture", " Bryant Lee ", "3", "S01", S01_SCHEDULE, "45", "10",
                " See note  about  TBA ", "<button>Add</button>", "2923", "384", "",
            ],
        );
        let result = parse_synthetic(&row);
        assert_eq!(result.sections[0].professor.as_deref(), Some("Bryant Lee"));
        assert_eq!(
            result.sections[0].remark.as_deref(),
            Some(" See note  about  TBA "),
            "remark is captured verbatim"
        );
    }

    #[test]
    fn numeric_cells_parse_and_garbage_is_diagnosed_not_guessed() {
        let good = row(
            "data-end-date=\"12/09/2026\" data-start-date=\"07/10/2026\"",
            [
                "Lecture", "", "3.5", "S01", S01_SCHEDULE, "45", "42", "",
                "<button>Add</button>", "2923", "384", "",
            ],
        );
        let result = parse_synthetic(&good);
        assert!(result.diagnostics.is_empty(), "diagnostics: {:?}", result.diagnostics);
        assert_eq!(result.sections[0].credits, Some(3.5));
        assert_eq!(result.sections[0].enroll_cap, Some(45));
        assert_eq!(result.sections[0].enrolled, Some(42));

        let garbage = row(
            "data-end-date=\"12/09/2026\" data-start-date=\"07/10/2026\"",
            [
                "Lecture", "", "many", "S02", S01_SCHEDULE, "full", "soon", "",
                "<button>Add</button>", "2923", "385", "",
            ],
        );
        let result = parse_synthetic(&garbage);
        assert_eq!(result.sections[0].credits, None);
        assert_eq!(result.sections[0].enroll_cap, None);
        assert_eq!(result.sections[0].enrolled, None);
        let errors: Vec<_> = result
            .diagnostics
            .iter()
            .filter(|d| d.severity == DiagnosticSeverity::Error)
            .collect();
        assert_eq!(errors.len(), 3, "each unparseable number is its own error");
    }

    // ---------- dates ----------

    #[test]
    fn start_and_end_dates_parse_to_typed_dates() {
        let row = standard_row("S01", S01_SCHEDULE);
        let result = parse_synthetic(&row);
        assert_eq!(
            result.sections[0].start_date,
            chrono::NaiveDate::from_ymd_opt(2026, 7, 10)
        );
        assert_eq!(
            result.sections[0].end_date,
            chrono::NaiveDate::from_ymd_opt(2026, 12, 9)
        );
    }

    #[test]
    fn a_date_mismatch_raises_a_warning_and_parsing_continues() {
        let normal = standard_row("S01", S01_SCHEDULE);
        let odd = row(
            "data-end-date=\"12/10/2026\" data-start-date=\"07/10/2026\"",
            [
                "Lecture", "", "3", "S02", S01_SCHEDULE, "45", "10", "",
                "<button>Add</button>", "2923", "385", "",
            ],
        );
        let result = parse_synthetic(&format!("{normal}{odd}"));
        assert_eq!(result.sections.len(), 2, "both sections still parse");
        assert_eq!(
            result.sections[1].end_date,
            chrono::NaiveDate::from_ymd_opt(2026, 12, 10)
        );
        let warning = find_diagnostic(&result, DiagnosticSeverity::Warning)
            .expect("date mismatch must raise a warning");
        assert!(warning.message.contains("date"), "got: {}", warning.message);
        assert_eq!(warning.row, 2);
    }

    #[test]
    fn an_unparseable_date_is_an_error_and_parsing_continues() {
        let row = row(
            "data-end-date=\"not-a-date\" data-start-date=\"07/10/2026\"",
            [
                "Lecture", "", "3", "S01", S01_SCHEDULE, "45", "10", "",
                "<button>Add</button>", "2923", "384", "",
            ],
        );
        let result = parse_synthetic(&row);
        assert_eq!(result.sections.len(), 1, "the section still parses");
        assert_eq!(result.sections[0].start_date, chrono::NaiveDate::from_ymd_opt(2026, 7, 10));
        assert_eq!(result.sections[0].end_date, None);
        assert!(find_diagnostic(&result, DiagnosticSeverity::Error).is_some());
    }

    // ---------- config-driven parsing ----------

    #[test]
    fn every_selector_and_rule_arrives_via_the_config() {
        let page = results_page(&standard_row("S01", S01_SCHEDULE));
        let config = SelectorConfig::default();

        let no_rows = SelectorConfig {
            result_row: "tbody tr.missing".into(),
            ..config.clone()
        };
        let result = parse_results_table(&page, &context(2923, "CSINTSY"), &no_rows)
            .expect("parse");
        assert!(result.sections.is_empty());

        let other_cell = SelectorConfig {
            schedule_cell: "td:nth-child(9)".into(),
            ..config.clone()
        };
        let result = parse_results_table(&page, &context(2923, "CSINTSY"), &other_cell)
            .expect("parse");
        assert_eq!(result.sections.len(), 1);
        assert!(result.sections[0].blocks.is_empty());
        assert!(
            find_diagnostic(&result, DiagnosticSeverity::Warning).is_some(),
            "a missing schedule cell is diagnosed"
        );

        let other_day = SelectorConfig {
            day_names: DayNames {
                monday: "LUNES".into(),
                ..DayNames::default()
            },
            ..config.clone()
        };
        let result = parse_results_table(&page, &context(2923, "CSINTSY"), &other_day)
            .expect("parse");
        assert_eq!(result.sections.len(), 1);
        assert_eq!(
            result.sections[0].blocks.len(),
            1,
            "MONDAY no longer matches, only THURSDAY remains"
        );
        assert_eq!(result.sections[0].blocks[0].day, Day::Thu);
        assert!(
            find_diagnostic(&result, DiagnosticSeverity::Error).is_some(),
            "the MONDAY block is diagnosed"
        );

        let other_separator = SelectorConfig {
            times_separator: " | ".into(),
            ..config
        };
        let result = parse_results_table(&page, &context(2923, "CSINTSY"), &other_separator)
            .expect("parse");
        assert!(result.sections[0].blocks.is_empty(), "separator changed the grammar");
    }

    #[test]
    fn bundled_default_config_round_trips_through_json() {
        let config = SelectorConfig::default();
        let json = serde_json::to_string(&config).expect("config must serialize");
        let parsed: SelectorConfig =
            serde_json::from_str(&json).expect("config must deserialize");
        assert_eq!(config, parsed);
        assert_eq!(parsed.results_table, "#tblCourseSelection");
        assert_eq!(parsed.day_names.saturday, "SATURDAY");
    }

    // ---------- course identity from the page ----------

    #[test]
    fn course_context_reads_identity_from_the_dropdown_not_the_table() {
        let csintsy = course_context_from_html(CSINTSY_FIXTURE, &SelectorConfig::default())
            .expect("the fixture must carry a readable course dropdown");
        assert_eq!(csintsy.course_id, 2923);
        assert_eq!(csintsy.code, "CSINTSY");
        assert_eq!(csintsy.title, "INTRODUCTION TO INTELLIGENT SYSTEMS");

        let geartap = course_context_from_html(GEARTAP_FIXTURE, &SelectorConfig::default())
            .expect("the fixture must carry a readable course dropdown");
        assert_eq!(geartap.course_id, 564);
        assert_eq!(geartap.code, "GEARTAP");
        assert_eq!(geartap.title, "ART APPRECIATION");
    }

    #[test]
    fn course_context_falls_back_to_the_selected_attribute_without_select2() {
        let html = "<html><body>\
            <select id=\"ddlSelectCourse\">\
              <option value=\"0\">Please select</option>\
              <option value=\"2923\" selected>CSINTSY - INTRODUCTION TO INTELLIGENT SYSTEMS</option>\
            </select></body></html>";
        let context = course_context_from_html(html, &SelectorConfig::default())
            .expect("a selected option must be readable without a select2 container");
        assert_eq!(context.course_id, 2923);
        assert_eq!(context.code, "CSINTSY");
        assert_eq!(context.title, "INTRODUCTION TO INTELLIGENT SYSTEMS");
    }

    #[test]
    fn an_unreadable_course_identity_is_an_error_not_a_guess() {
        let missing = course_context_from_html(
            "<html><body><p>nothing</p></body></html>",
            &SelectorConfig::default(),
        )
        .expect_err("a page without the dropdown must error");
        assert_eq!(missing, ParseError::CourseDropdownNotFound);

        let unselected = "<html><body>\
            <select id=\"ddlSelectCourse\"><option value=\"0\">Please select</option></select>\
            </body></html>";
        let err = course_context_from_html(unselected, &SelectorConfig::default())
            .expect_err("a dropdown without a selection must error");
        assert!(matches!(err, ParseError::SelectedCourseUnreadable { .. }), "got {err:?}");

        let non_numeric = "<html><body>\
            <select id=\"ddlSelectCourse\">\
              <option value=\"abc\" selected>CSINTSY - INTRODUCTION TO INTELLIGENT SYSTEMS</option>\
            </select></body></html>";
        let err = course_context_from_html(non_numeric, &SelectorConfig::default())
            .expect_err("a non-numeric course id must error");
        assert!(matches!(err, ParseError::SelectedCourseUnreadable { .. }), "got {err:?}");

        let no_title = "<html><body>\
            <select id=\"ddlSelectCourse\"><option value=\"2923\" selected>CSINTSY</option></select>\
            </body></html>";
        let err = course_context_from_html(no_title, &SelectorConfig::default())
            .expect_err("an option text without CODE - TITLE must error");
        assert!(matches!(err, ParseError::SelectedCourseUnreadable { .. }), "got {err:?}");
    }

    // ---------- no student-identifying data is read ----------

    #[test]
    fn parser_ignores_student_identifying_fields_around_the_table() {
        // The page around the table is allowed to carry whatever it likes;
        // the parser reads only the allowlisted cells. This test pins that
        // unrelated markup cannot disturb a parse.
        let page = format!(
            "<html><body><input id=\"hdnStudId\" value=\"x\">\
             <input id=\"userID\" value=\"x\">\
             <input id=\"IP_ADDRESS\" value=\"x\">\
             <input id=\"MAC_ADDRESS\" value=\"x\">\
             <table id=\"tblCourseSelection\"><tbody>{}</tbody></table></body></html>",
            standard_row("S01", S01_SCHEDULE)
        );
        let result = parse_results_table(
            &page,
            &context(2923, "CSINTSY"),
            &SelectorConfig::default(),
        )
        .expect("parse");
        assert_eq!(result.sections.len(), 1);
        assert!(result.diagnostics.is_empty());
    }
}
