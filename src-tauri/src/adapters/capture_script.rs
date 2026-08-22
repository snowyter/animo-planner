//! Builds the initialization script injected into the Archer's Hub popup
//! (ticket 10).
//!
//! The popup's remote origin is never granted Tauri IPC (ADR-0003). The only
//! thing the injected script can do is read the results table and the course
//! dropdown, and POST one JSON payload to the ticket-09 loopback endpoint
//! with its per-launch bearer token. The script body is static JavaScript;
//! this module only interpolates the endpoint, token, plan scope, and the
//! parser's own selector config, so the script can never drift from the
//! parser (ADR-0013).

use crate::core::parser::SelectorConfig;

/// The static JavaScript half of the injected script. It is a single
/// function expression taking the boot config this module interpolates, so
/// the same source can be executed by tests without duplicating the Rust
/// prelude.
pub const CAPTURE_SCRIPT_BODY: &str = include_str!("capture_script.js");

/// Builds the initialization script for the capture popup: the static body
/// invoked with the endpoint, token, plan scope, hub host, and the parser's
/// own selectors (ADR-0013 — the script never carries hardcoded selectors).
pub fn build_capture_script(
    config: &SelectorConfig,
    endpoint: &str,
    token: &str,
    campus_id: i64,
    session_id: i64,
    hub_host: &str,
) -> String {
    let boot = serde_json::json!({
        "endpoint": endpoint,
        "token": token,
        "campusId": campus_id,
        "sessionId": session_id,
        "hubHost": hub_host,
        "selectors": {
            "resultsTable": config.results_table,
            "resultsBody": format!("{} tbody", config.results_table),
            "courseDropdown": config.course_dropdown,
            "resultRow": config.result_row,
        },
    });
    format!("({CAPTURE_SCRIPT_BODY})({boot});")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn default_config() -> SelectorConfig {
        SelectorConfig::default()
    }

    fn build() -> String {
        build_capture_script(
            &default_config(),
            "http://127.0.0.1:52134/capture",
            "deadbeef0123",
            7,
            155,
            "archershub.dlsu.edu.ph",
        )
    }

    #[test]
    fn script_carries_the_endpoint_token_and_plan_scope() {
        let script = build();

        assert!(
            script.contains("http://127.0.0.1:52134/capture"),
            "the endpoint URL must be interpolated: {script}"
        );
        assert!(
            script.contains("deadbeef0123"),
            "the bearer token must be interpolated: {script}"
        );
        assert!(
            script.contains("\"campusId\":7"),
            "the campus must be interpolated: {script}"
        );
        assert!(
            script.contains("\"sessionId\":155"),
            "the session must be interpolated: {script}"
        );
    }

    #[test]
    fn selectors_come_from_the_parser_config_not_hardcoded_strings() {
        let custom = SelectorConfig {
            results_table: "#myTable".into(),
            course_dropdown: "#myDropdown".into(),
            result_row: "tbody tr".into(),
            ..SelectorConfig::default()
        };
        let script = build_capture_script(
            &custom,
            "http://127.0.0.1:9/capture",
            "token",
            7,
            155,
            "archershub.dlsu.edu.ph",
        );

        assert!(
            script.contains("#myTable"),
            "the results table selector must come from the parser config: {script}"
        );
        assert!(
            script.contains("#myDropdown"),
            "the course dropdown selector must come from the parser config: {script}"
        );
        assert!(
            !script.contains("#tblCourseSelection"),
            "the default table selector must not be hardcoded into the script: {script}"
        );
        assert!(
            !script.contains("#ddlSelectCourse"),
            "the default dropdown selector must not be hardcoded into the script: {script}"
        );
    }

    #[test]
    fn script_touches_none_of_the_privacy_hazard_fields_or_credentials() {
        let script = build();

        for forbidden in [
            "hdnStudId",
            "userID",
            "IP_ADDRESS",
            "MAC_ADDRESS",
            "Password",
            "password",
            "OTP",
        ] {
            assert!(
                !script.contains(forbidden),
                "the script must never read {forbidden}: {script}"
            );
        }
    }

    #[test]
    fn script_grants_no_tauri_ipc_to_the_remote_origin() {
        let script = build();

        for marker in ["__TAURI__", "window.__TAURI_INTERNALS__", "invoke("] {
            assert!(
                !script.contains(marker),
                "the script must not reference Tauri IPC ({marker}): {script}"
            );
        }
    }

    #[test]
    fn script_observes_the_results_table_body_and_dedupes_before_posting() {
        let script = build();

        assert!(
            script.contains("MutationObserver"),
            "the capture path is an observer on the table body: {script}"
        );
        assert!(
            script.contains("fetch("),
            "the script's only channel is the loopback endpoint: {script}"
        );
        assert!(
            script.contains("lastHash"),
            "the script must dedupe on the rendered content before posting: {script}"
        );
    }

    #[test]
    fn script_guards_itself_to_the_hub_origin() {
        let script = build();

        assert!(
            script.contains("archershub.dlsu.edu.ph"),
            "the hub host must be interpolated: {script}"
        );
        assert!(
            script.contains("window.location.hostname"),
            "the script must only run on the hub origin: {script}"
        );
    }
}
