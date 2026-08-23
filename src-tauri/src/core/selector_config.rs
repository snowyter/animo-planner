//! Loading a versioned selector-config JSON document.
//!
//! The remote document is flat: every field of [`SelectorConfig`]'s own
//! camelCase serialization plus one `version` key, so the file published on
//! GitHub is a drop-in superset of the config the parser already accepts
//! (ADR-0013). A document that is not JSON, is missing or has unknown
//! fields, carries empty rules, or holds selectors that do not compile is
//! rejected as a whole — never half-loaded and never allowed to break
//! capture. Pure logic: text in, validated config out; the network lives in
//! the adapter layer.

use crate::core::parser::SelectorConfig;
use scraper::Selector;
use serde::Deserialize;
use std::fmt;

/// A selector-config document with the version its publisher declared.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VersionedSelectorConfig {
    pub version: String,
    pub config: SelectorConfig,
}

/// Why a remote document was rejected.
///
/// `MalformedJson` covers bodies that are not JSON at all (an HTML error
/// page, a truncated response); `InvalidStructure` covers documents that
/// parse but must not be loaded — wrong shape, missing or unknown fields,
/// blank rules, or selectors this app cannot compile.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RemoteConfigError {
    MalformedJson(String),
    InvalidStructure(String),
}

impl fmt::Display for RemoteConfigError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            RemoteConfigError::MalformedJson(detail) => {
                write!(f, "selector config is not valid JSON: {detail}")
            }
            RemoteConfigError::InvalidStructure(detail) => {
                write!(f, "selector config is structurally invalid: {detail}")
            }
        }
    }
}

impl std::error::Error for RemoteConfigError {}

fn structure_error(detail: impl fmt::Display) -> RemoteConfigError {
    RemoteConfigError::InvalidStructure(detail.to_string())
}

/// The field names a well-formed document carries: exactly the fields of the
/// bundled default's own serialization plus `version`. Deriving the list
/// from the struct keeps the loader in sync with [`SelectorConfig`] even if
/// ticket 04's struct grows a field later.
fn expected_field_names() -> Vec<String> {
    let mut names: Vec<String> = serde_json::to_value(SelectorConfig::default())
        .expect("the bundled default serializes")
        .as_object()
        .expect("it serializes to an object")
        .keys()
        .cloned()
        .collect();
    names.push("version".to_string());
    names.sort();
    names
}

/// Every string anywhere in the document is non-empty: a rule this app
/// cannot read is worse than a document it rejects.
fn reject_empty_strings(value: &serde_json::Value, path: &str) -> Result<(), RemoteConfigError> {
    match value {
        serde_json::Value::String(text) => {
            if text.trim().is_empty() {
                Err(structure_error(format!("field {path:?} is empty")))
            } else {
                Ok(())
            }
        }
        serde_json::Value::Array(items) => {
            for (index, item) in items.iter().enumerate() {
                reject_empty_strings(item, &format!("{path}[{index}]"))?;
            }
            Ok(())
        }
        serde_json::Value::Object(map) => {
            for (key, item) in map {
                reject_empty_strings(item, &format!("{path}.{key}"))?;
            }
            Ok(())
        }
        _ => Ok(()),
    }
}

/// Compiles every CSS selector in the loaded config, so a typo published to
/// the remote file is rejected here instead of breaking capture on every
/// installed copy.
fn reject_uncompilable_selectors(config: &SelectorConfig) -> Result<(), RemoteConfigError> {
    let selectors = [
        ("results_table", &config.results_table),
        ("result_row", &config.result_row),
        ("course_type_cell", &config.course_type_cell),
        ("teacher_cell", &config.teacher_cell),
        ("credits_cell", &config.credits_cell),
        ("section_code_cell", &config.section_code_cell),
        ("schedule_cell", &config.schedule_cell),
        ("enroll_cap_cell", &config.enroll_cap_cell),
        ("enrolled_cell", &config.enrolled_cell),
        ("remark_cell", &config.remark_cell),
        ("hidden_course_id_cell", &config.hidden_course_id_cell),
        ("hidden_section_id_cell", &config.hidden_section_id_cell),
        ("course_dropdown", &config.course_dropdown),
    ];
    for (name, raw) in selectors {
        Selector::parse(raw)
            .map_err(|detail| structure_error(format!("selector {name:?} ({raw:?}): {detail}")))?;
    }
    Ok(())
}

/// Parses and validates a versioned selector-config document.
pub fn load_versioned_selector_config(
    json: &str,
) -> Result<VersionedSelectorConfig, RemoteConfigError> {
    let value: serde_json::Value = serde_json::from_str(json)
        .map_err(|err| RemoteConfigError::MalformedJson(err.to_string()))?;
    let map = value
        .as_object()
        .ok_or_else(|| {
            RemoteConfigError::MalformedJson("the document's root is not an object".into())
        })?;

    // Unknown keys mean a document written for a different schema — newer,
    // older, or tampered. Loading it half-blind could silently mis-parse;
    // rejecting it falls back to the bundled copy instead.
    let mut known: Vec<&String> = map.keys().collect();
    known.sort();
    let expected = expected_field_names();
    let unexpected: Vec<&&String> = known
        .iter()
        .filter(|key| !expected.binary_search_by(|probe| probe.as_str().cmp(key.as_str())).is_ok())
        .collect();
    if let Some(first) = unexpected.first() {
        return Err(structure_error(format!(
            "unknown field {:?}; this app expects {}",
            first,
            expected.join(", ")
        )));
    }

    let version_value = map
        .get("version")
        .ok_or_else(|| structure_error("the required field \"version\" is missing"))?;
    let version = version_value
        .as_str()
        .ok_or_else(|| structure_error("field \"version\" must be a string"))?;
    if version.trim().is_empty() {
        return Err(structure_error("field \"version\" is empty"));
    }

    reject_empty_strings(&value, "")?;

    #[derive(Deserialize)]
    struct Versionless {
        #[serde(flatten)]
        config: SelectorConfig,
    }
    let versionless: Versionless =
        serde_json::from_value(value.clone()).map_err(structure_error)?;

    reject_uncompilable_selectors(&versionless.config)?;

    Ok(VersionedSelectorConfig {
        version: version.to_string(),
        config: versionless.config,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::parser::DayNames;

    /// The default config serialized with a `version` added — the shape a
    /// well-formed remote document takes.
    fn valid_remote_json() -> String {
        let mut value =
            serde_json::to_value(SelectorConfig::default()).expect("default config serializes");
    value
        .as_object_mut()
        .expect("an object")
        .insert("version".into(), serde_json::json!("2"));
    serde_json::to_string(&value).expect("serializes back")
}

fn remote_with_config(config: &SelectorConfig) -> String {
    let mut value = serde_json::to_value(config).expect("config serializes");
    value
        .as_object_mut()
        .expect("an object")
        .insert("version".into(), serde_json::json!("7"));
    serde_json::to_string(&value).expect("serializes back")
}

// ---------- happy path ----------

#[test]
fn a_valid_remote_document_loads_with_its_version_and_values() {
    let custom = SelectorConfig {
        results_table: "#renamedTable".into(),
        online_literal: "Fully Online".into(),
        ..SelectorConfig::default()
    };
    let loaded =
        load_versioned_selector_config(&remote_with_config(&custom)).expect("must load");

    assert_eq!(loaded.version, "7");
    assert_eq!(loaded.config.results_table, "#renamedTable");
    assert_eq!(loaded.config.online_literal, "Fully Online");
    // Untouched fields keep their values.
    assert_eq!(loaded.config.result_row, SelectorConfig::default().result_row);
}

#[test]
fn the_bundled_default_round_trips_through_the_document_format() {
    let loaded =
        load_versioned_selector_config(&valid_remote_json()).expect("the default must load");
    assert_eq!(loaded.version, "2");
    assert_eq!(loaded.config, SelectorConfig::default());
}

// ---------- malformed JSON ----------

#[test]
fn text_that_is_not_json_is_rejected_as_malformed() {
    for body in ["", "<html>404 Not Found</html>", "{ not json }"] {
        let err = load_versioned_selector_config(body).expect_err("must be rejected");
        assert!(
            matches!(err, RemoteConfigError::MalformedJson(_)),
            "{body:?} must be MalformedJson, got {err:?}"
        );
    }
}

#[test]
fn a_non_object_root_is_malformed() {
    for body in [r#"[]"#, r#"42"#, r#""version""#, "null"] {
        let err = load_versioned_selector_config(body).expect_err("must be rejected");
        assert!(matches!(err, RemoteConfigError::MalformedJson(_)));
    }
}

// ---------- structurally invalid documents ----------

#[test]
fn a_missing_version_field_is_structurally_invalid() {
    let mut value = serde_json::from_str::<serde_json::Value>(&valid_remote_json()).unwrap();
    value.as_object_mut().unwrap().remove("version");
    let err = load_versioned_selector_config(&serde_json::to_string(&value).unwrap())
        .expect_err("a versionless document must be rejected");
    assert!(
        matches!(err, RemoteConfigError::InvalidStructure(_)),
        "got {err:?}"
    );
}

#[test]
fn an_empty_version_string_is_structurally_invalid() {
    let mut value = serde_json::from_str::<serde_json::Value>(&valid_remote_json()).unwrap();
    value.as_object_mut().unwrap()["version"] = serde_json::json!("  ");
    let err = load_versioned_selector_config(&serde_json::to_string(&value).unwrap())
        .expect_err("a blank version must be rejected");
    assert!(matches!(err, RemoteConfigError::InvalidStructure(_)));
}

#[test]
fn a_version_that_is_not_a_string_is_structurally_invalid() {
    let mut value = serde_json::from_str::<serde_json::Value>(&valid_remote_json()).unwrap();
    value.as_object_mut().unwrap()["version"] = serde_json::json!(3);
    let err = load_versioned_selector_config(&serde_json::to_string(&value).unwrap())
        .expect_err("a numeric version must be rejected");
    assert!(matches!(err, RemoteConfigError::InvalidStructure(_)));
}

#[test]
fn a_missing_config_field_is_structurally_invalid() {
    let mut value = serde_json::from_str::<serde_json::Value>(&valid_remote_json()).unwrap();
    value.as_object_mut().unwrap().remove("scheduleCell");
    let err = load_versioned_selector_config(&serde_json::to_string(&value).unwrap())
        .expect_err("a missing field must be rejected");
    assert!(matches!(err, RemoteConfigError::InvalidStructure(_)));
}

#[test]
fn an_unknown_field_is_structurally_invalid_not_silently_ignored() {
    let mut value = serde_json::from_str::<serde_json::Value>(&valid_remote_json()).unwrap();
    value
        .as_object_mut()
        .unwrap()
        .insert("newColumn".into(), serde_json::json!("#tblNew"));
    let err = load_versioned_selector_config(&serde_json::to_string(&value).unwrap())
        .expect_err("a field this app does not know must be rejected");
    match err {
        RemoteConfigError::InvalidStructure(detail) => {
            assert!(
                detail.contains("newColumn"),
                "the unknown field is named: {detail}"
            );
        }
        other => panic!("expected InvalidStructure, got {other:?}"),
    }
}

#[test]
fn an_empty_rule_string_is_structurally_invalid() {
    let config = SelectorConfig {
        room_prefix: String::new(),
        ..SelectorConfig::default()
    };
    let err = load_versioned_selector_config(&remote_with_config(&config))
        .expect_err("an empty rule must be rejected");
    assert!(matches!(err, RemoteConfigError::InvalidStructure(_)));

    let no_days = SelectorConfig {
        day_names: DayNames {
            saturday: "".into(),
            ..DayNames::default()
        },
        ..SelectorConfig::default()
    };
    let err = load_versioned_selector_config(&remote_with_config(&no_days))
        .expect_err("an empty day name must be rejected");
    assert!(matches!(err, RemoteConfigError::InvalidStructure(_)));
}

#[test]
fn a_selector_that_does_not_compile_is_structurally_invalid() {
    let config = SelectorConfig {
        results_table: "###not css###".into(),
        ..SelectorConfig::default()
    };
    let err = load_versioned_selector_config(&remote_with_config(&config))
        .expect_err("an uncompilable selector must be rejected");
    match err {
        RemoteConfigError::InvalidStructure(detail) => {
            assert!(
                detail.contains("results_table") || detail.contains("resultsTable"),
                "the offending selector is named: {detail}"
            );
        }
        other => panic!("expected InvalidStructure, got {other:?}"),
    }
}

#[test]
fn error_messages_are_identifiable() {
    let messages = [
        RemoteConfigError::MalformedJson("boom".into()).to_string(),
        RemoteConfigError::InvalidStructure("missing scheduleCell".into()).to_string(),
    ];
    for message in &messages {
        assert!(!message.is_empty());
        assert!(
            message.to_lowercase().contains("selector config"),
            "every error names what failed: {message}"
        );
    }
}
}

