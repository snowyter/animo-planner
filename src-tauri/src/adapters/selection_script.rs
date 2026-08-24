//! Builds the popup-selection script for one refresh step (ticket 26).
//!
//! The page renders select2 over the course dropdown: setting the underlying
//! `<select>` value alone updates neither select2 nor the page's own change
//! handler, so the selection is driven exactly like the student's own click —
//! pick the option, then fire a bubbling `change` event the page's search
//! path listens for. The dropdown selector comes from the loaded selector
//! config (ticket 18), never from a hardcoded string.

use crate::core::parser::SelectorConfig;

/// Window property the script sets to force the capture script's very next
/// render through, even when the re-rendered table is byte-identical to the
/// previous one (the observer dedupes identical content; a refresh of the
/// course already on screen must still land).
pub const FORCE_NEXT_CAPTURE_FLAG: &str = "__animoPlanForceNextCapture";

/// The static JavaScript half of the selection script — a single function
/// expression taking the task this module interpolates, so behavioral tests
/// can execute the exact source against a fake DOM.
pub const SELECTION_SCRIPT_BODY: &str = include_str!("selection_script.js");

/// Builds the script that drives one course selection in the already-open
/// capture popup: find the course's option by value, force the very next
/// render through the observer's dedupe, set the selection, and fire a
/// bubbling `change` so select2 and the page's own search path run — the
/// same request the student's own click makes (ADR-0002), nothing more.
pub fn build_selection_script(config: &SelectorConfig, course_id: i64) -> String {
    let task = serde_json::json!({
        "dropdownSelector": config.course_dropdown,
        "courseId": course_id,
        "forceFlag": FORCE_NEXT_CAPTURE_FLAG,
    });
    format!("({SELECTION_SCRIPT_BODY})({task});")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_dropdown_selector_comes_from_the_config_never_a_hardcoded_string() {
        let custom = SelectorConfig {
            course_dropdown: "#myCoursePicker".into(),
            ..SelectorConfig::default()
        };
        let script = build_selection_script(&custom, 2923);

        assert!(
            script.contains("#myCoursePicker"),
            "the config's selector is interpolated: {script}"
        );
        assert!(
            !script.contains("ddlSelectCourse"),
            "no default selector leaks into the script: {script}"
        );
    }

    #[test]
    fn the_script_carries_the_course_to_select_and_forces_a_fresh_capture() {
        let script = build_selection_script(&SelectorConfig::default(), 564);

        assert!(
            script.contains("\"courseId\":564"),
            "the course id is interpolated: {script}"
        );
        assert!(
            script.contains(FORCE_NEXT_CAPTURE_FLAG),
            "the observer's dedupe must be bypassed for the driven render: {script}"
        );
    }

    #[test]
    fn the_script_fires_a_bubbling_change_event_so_select2_and_the_page_search_run() {
        let script = build_selection_script(&SelectorConfig::default(), 2923);

        assert!(
            script.contains("\"bubbles\":true") || script.contains("bubbles: true"),
            "the change event must bubble like a real click: {script}"
        );
        assert!(
            script.contains("dispatchEvent"),
            "the event is dispatched on the real element: {script}"
        );
        assert!(
            script.contains("selectedIndex"),
            "the underlying select is moved too: {script}"
        );
    }
}
