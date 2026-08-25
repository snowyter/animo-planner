//! Wire types for the update check/install seam (ticket 38).
//!
//! The updater answers through ordinary IPC values, never errors: an
//! offline machine, a 404, a malformed `latest.json`, or a signature that
//! does not verify each resolve to `status: "failed"` with a distinguishable
//! reason, so the UI can say something quiet instead of crashing. A build
//! with the updater compiled out answers `"unavailable"`. The student
//! decides: nothing installs unless `install_update` is called.
//!
//! This module is pure data — the network lives in
//! `crate::adapters::update_service`.

use serde::{Deserialize, Serialize};

/// What a check found on the endpoint, decoupled from the updater plugin's
/// own types.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UpdateOffer {
    pub version: String,
    pub notes: Option<String>,
}

/// Why a check or an install did not succeed. `reason` is coarse and stable
/// enough for a UI to switch on; `detail` carries the underlying message.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UpdateFailure {
    pub reason: UpdateFailureReason,
    pub detail: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UpdateFailureReason {
    Network,
    Endpoint,
    Malformed,
    Signature,
    Unknown,
}

/// What a gateway's check produced, before it becomes wire data.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum UpdateCheckAnswer {
    Offered(UpdateOffer),
    UpToDate,
    Failed(UpdateFailure),
    /// The updater is compiled out of this build.
    Unavailable,
}

/// What a gateway's install produced, before it becomes wire data. A real
/// install ends with the process restarting; `Installed` answers only in the
/// window before that.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum InstallUpdateAnswer {
    Installed,
    NothingToInstall,
    Failed(UpdateFailure),
    Unavailable,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UpdateCheckStatus {
    Available,
    UpToDate,
    Failed,
    Unavailable,
}

/// The answer of `check_for_update`: whether one is available, the version
/// offered, the version running, and the release notes if the endpoint
/// carries them. Failures are ordinary answers (`status: "failed"` plus a
/// distinguishable `failure_reason`), never IPC errors.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheck {
    pub status: UpdateCheckStatus,
    pub current_version: String,
    pub available_version: Option<String>,
    pub notes: Option<String>,
    pub failure_reason: Option<UpdateFailureReason>,
    pub failure_detail: Option<String>,
}

impl UpdateCheck {
    pub fn available(
        current_version: impl Into<String>,
        offered_version: impl Into<String>,
        notes: Option<String>,
    ) -> Self {
        UpdateCheck {
            status: UpdateCheckStatus::Available,
            current_version: current_version.into(),
            available_version: Some(offered_version.into()),
            notes,
            failure_reason: None,
            failure_detail: None,
        }
    }

    pub fn up_to_date(current_version: impl Into<String>) -> Self {
        UpdateCheck {
            status: UpdateCheckStatus::UpToDate,
            current_version: current_version.into(),
            available_version: None,
            notes: None,
            failure_reason: None,
            failure_detail: None,
        }
    }

    pub fn failed(
        current_version: impl Into<String>,
        reason: UpdateFailureReason,
        detail: impl Into<String>,
    ) -> Self {
        UpdateCheck {
            status: UpdateCheckStatus::Failed,
            current_version: current_version.into(),
            available_version: None,
            notes: None,
            failure_reason: Some(reason),
            failure_detail: Some(detail.into()),
        }
    }

    pub fn unavailable(current_version: impl Into<String>) -> Self {
        UpdateCheck {
            status: UpdateCheckStatus::Unavailable,
            current_version: current_version.into(),
            available_version: None,
            notes: None,
            failure_reason: None,
            failure_detail: None,
        }
    }
}

/// Maps a gateway check answer onto the wire shape, stamping the running
/// version into every outcome.
pub fn check_answer(current_version: &str, answer: UpdateCheckAnswer) -> UpdateCheck {
    match answer {
        UpdateCheckAnswer::Offered(offer) => {
            UpdateCheck::available(current_version, offer.version, offer.notes)
        }
        UpdateCheckAnswer::UpToDate => UpdateCheck::up_to_date(current_version),
        UpdateCheckAnswer::Failed(failure) => {
            UpdateCheck::failed(current_version, failure.reason, failure.detail)
        }
        UpdateCheckAnswer::Unavailable => UpdateCheck::unavailable(current_version),
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum InstallUpdateStatus {
    Installed,
    NothingToInstall,
    Failed,
    Unavailable,
}

/// The answer of `install_update`. Nothing installs unless this command is
/// called; a signature that does not verify surfaces here as `failed` with
/// reason `"signature"`, never as a successful install.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallUpdateOutcome {
    pub status: InstallUpdateStatus,
    pub failure_reason: Option<UpdateFailureReason>,
    pub failure_detail: Option<String>,
}

impl InstallUpdateOutcome {
    pub fn installed() -> Self {
        InstallUpdateOutcome {
            status: InstallUpdateStatus::Installed,
            failure_reason: None,
            failure_detail: None,
        }
    }

    pub fn nothing_to_install() -> Self {
        InstallUpdateOutcome {
            status: InstallUpdateStatus::NothingToInstall,
            failure_reason: None,
            failure_detail: None,
        }
    }

    pub fn failed(failure: UpdateFailure) -> Self {
        InstallUpdateOutcome {
            status: InstallUpdateStatus::Failed,
            failure_reason: Some(failure.reason),
            failure_detail: Some(failure.detail),
        }
    }

    pub fn unavailable() -> Self {
        InstallUpdateOutcome {
            status: InstallUpdateStatus::Unavailable,
            failure_reason: None,
            failure_detail: None,
        }
    }
}

/// Maps a gateway install answer onto the wire shape.
pub fn install_answer(answer: InstallUpdateAnswer) -> InstallUpdateOutcome {
    match answer {
        InstallUpdateAnswer::Installed => InstallUpdateOutcome::installed(),
        InstallUpdateAnswer::NothingToInstall => InstallUpdateOutcome::nothing_to_install(),
        InstallUpdateAnswer::Failed(failure) => InstallUpdateOutcome::failed(failure),
        InstallUpdateAnswer::Unavailable => InstallUpdateOutcome::unavailable(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ---------- UpdateCheck ----------

    #[test]
    fn an_available_check_serializes_both_versions_and_notes_camelcased() {
        let check = UpdateCheck::available("0.1.0", "0.2.0", Some("what's new".into()));
        let json = serde_json::to_value(&check).unwrap();
        assert_eq!(json["status"], "available");
        assert_eq!(json["currentVersion"], "0.1.0");
        assert_eq!(json["availableVersion"], "0.2.0");
        assert_eq!(json["notes"], "what's new");
        assert_eq!(json["failureReason"], serde_json::Value::Null);
        assert_eq!(json["failureDetail"], serde_json::Value::Null);
    }

    #[test]
    fn an_available_check_without_release_notes_leaves_them_null() {
        let check = UpdateCheck::available("0.1.0", "0.2.0", None);
        let json = serde_json::to_value(&check).unwrap();
        assert_eq!(json["notes"], serde_json::Value::Null);
    }

    #[test]
    fn an_up_to_date_check_carries_no_offer() {
        let check = UpdateCheck::up_to_date("0.2.0");
        let json = serde_json::to_value(&check).unwrap();
        assert_eq!(json["status"], "up_to_date");
        assert_eq!(json["currentVersion"], "0.2.0");
        assert_eq!(json["availableVersion"], serde_json::Value::Null);
        assert_eq!(json["notes"], serde_json::Value::Null);
    }

    #[test]
    fn a_failed_check_names_a_distinguishable_reason_and_detail() {
        let check = UpdateCheck::failed(
            "0.1.0",
            UpdateFailureReason::Network,
            "error connecting to github.com",
        );
        let json = serde_json::to_value(&check).unwrap();
        assert_eq!(json["status"], "failed");
        assert_eq!(json["currentVersion"], "0.1.0");
        assert_eq!(json["failureReason"], "network");
        assert_eq!(json["failureDetail"], "error connecting to github.com");
        assert_eq!(json["availableVersion"], serde_json::Value::Null);
    }

    #[test]
    fn an_unavailable_check_reports_the_compiled_out_updater() {
        let check = UpdateCheck::unavailable("0.2.0");
        let json = serde_json::to_value(&check).unwrap();
        assert_eq!(json["status"], "unavailable");
        assert_eq!(json["currentVersion"], "0.2.0");
        assert_eq!(json["availableVersion"], serde_json::Value::Null);
        assert_eq!(json["failureReason"], serde_json::Value::Null);
    }

    // ---------- answer mapping ----------

    #[test]
    fn every_check_answer_maps_to_its_wire_shape() {
        let current = "0.1.0";
        let offered = UpdateCheckAnswer::Offered(UpdateOffer {
            version: "0.2.0".into(),
            notes: Some("notes".into()),
        });
        match check_answer(current, offered.clone()) {
            UpdateCheck {
                status: UpdateCheckStatus::Available,
                available_version: Some(version),
                ref notes,
                ..
            } => {
                assert_eq!(version, "0.2.0");
                assert_eq!(notes.as_deref(), Some("notes"));
            }
            other => panic!("an offer must map to available, got {other:?}"),
        }

        assert_eq!(
            check_answer(current, UpdateCheckAnswer::UpToDate).status,
            UpdateCheckStatus::UpToDate
        );
        let failed = check_answer(
            current,
            UpdateCheckAnswer::Failed(UpdateFailure {
                reason: UpdateFailureReason::Endpoint,
                detail: "HTTP 404".into(),
            }),
        );
        assert_eq!(failed.status, UpdateCheckStatus::Failed);
        assert_eq!(failed.failure_reason, Some(UpdateFailureReason::Endpoint));
        assert_eq!(failed.failure_detail.as_deref(), Some("HTTP 404"));
        assert_eq!(
            check_answer(current, UpdateCheckAnswer::Unavailable).status,
            UpdateCheckStatus::Unavailable
        );

        // The offer itself round-trips as plain data.
        assert_eq!(offered, UpdateCheckAnswer::Offered(UpdateOffer {
            version: "0.2.0".into(),
            notes: Some("notes".into()),
        }));
    }

    // ---------- InstallUpdateOutcome ----------

    #[test]
    fn install_outcomes_serialize_their_status_snake_cased() {
        for (outcome, expected) in [
            (
                InstallUpdateOutcome::installed(),
                "installed",
            ),
            (
                InstallUpdateOutcome::nothing_to_install(),
                "nothing_to_install",
            ),
            (
                InstallUpdateOutcome::failed(UpdateFailure {
                    reason: UpdateFailureReason::Signature,
                    detail: "signature rejected".into(),
                }),
                "failed",
            ),
            (InstallUpdateOutcome::unavailable(), "unavailable"),
        ] {
            let json = serde_json::to_value(&outcome).unwrap();
            assert_eq!(json["status"], expected);
        }
    }

    #[test]
    fn a_failed_install_carries_its_reason_and_detail() {
        let outcome = InstallUpdateOutcome::failed(UpdateFailure {
            reason: UpdateFailureReason::Signature,
            detail: "signature rejected".into(),
        });
        let json = serde_json::to_value(&outcome).unwrap();
        assert_eq!(json["failureReason"], "signature");
        assert_eq!(json["failureDetail"], "signature rejected");
    }

    #[test]
    fn every_install_answer_maps_to_its_wire_shape() {
        assert_eq!(
            install_answer(InstallUpdateAnswer::Installed).status,
            InstallUpdateStatus::Installed
        );
        assert_eq!(
            install_answer(InstallUpdateAnswer::NothingToInstall).status,
            InstallUpdateStatus::NothingToInstall
        );
        let failed = install_answer(InstallUpdateAnswer::Failed(UpdateFailure {
            reason: UpdateFailureReason::Network,
            detail: "download failed".into(),
        }));
        assert_eq!(failed.status, InstallUpdateStatus::Failed);
        assert_eq!(failed.failure_reason, Some(UpdateFailureReason::Network));
        assert_eq!(
            install_answer(InstallUpdateAnswer::Unavailable).status,
            InstallUpdateStatus::Unavailable
        );
    }
}
