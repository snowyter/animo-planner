//! The update commands (ticket 38): `check_for_update` answers what a
//! GitHub Releases check found — availability, both versions, release notes
//! — and `install_update` downloads, verifies against the configured pubkey,
//! installs, and restarts into it. Nothing installs unless the latter is
//! called, and every failure mode is an ordinary answer rather than an IPC
//! error.
//!
//! Amendment protocol: `docs/ipc-contract.md` is the single source of truth;
//! these two commands and their TypeScript client functions move together
//! with that file.

use crate::adapters::update_service::SharedGateway;
use crate::core::update_check::{
    check_answer, install_answer, InstallUpdateOutcome, UpdateCheck,
};

/// Managed state wrapping the production gateway: the plugin-backed one when
/// the updater feature is compiled in, the unavailable stub otherwise.
pub struct UpdateService(SharedGateway);

impl UpdateService {
    pub fn new(gateway: SharedGateway) -> Self {
        UpdateService(gateway)
    }

    fn gateway(&self) -> &dyn crate::adapters::update_service::UpdateGateway {
        self.0.as_ref()
    }
}

/// Checks GitHub Releases for a newer version and reports what it found.
/// Offline, a 404, a malformed document, or a bad signature each resolve to
/// `status: "failed"` plus a distinguishable reason — an ordinary answer the
/// UI may show quietly (the app stays fully usable offline).
#[tauri::command]
pub async fn check_for_update(
    app: tauri::AppHandle,
    service: tauri::State<'_, UpdateService>,
) -> Result<UpdateCheck, String> {
    let current_version = app.package_info().version.to_string();
    Ok(check_for_update_impl(current_version, service.gateway()).await)
}

/// Installs the update the check found and restarts the app into it. Nothing
/// installs without this being called; when nothing is available it answers
/// `nothing_to_install`, and a signature that does not verify aborts as a
/// failed outcome — never an install.
#[tauri::command]
pub async fn install_update(
    service: tauri::State<'_, UpdateService>,
) -> Result<InstallUpdateOutcome, String> {
    Ok(install_update_impl(service.gateway()).await)
}

async fn check_for_update_impl(
    current_version: String,
    gateway: &dyn crate::adapters::update_service::UpdateGateway,
) -> UpdateCheck {
    check_answer(&current_version, gateway.check().await)
}

async fn install_update_impl(
    gateway: &dyn crate::adapters::update_service::UpdateGateway,
) -> InstallUpdateOutcome {
    install_answer(gateway.install().await)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::adapters::update_service::UpdateGateway;
    use crate::core::update_check::{
        InstallUpdateAnswer, InstallUpdateStatus, UpdateCheckAnswer, UpdateCheckStatus,
        UpdateFailure, UpdateFailureReason, UpdateOffer,
    };
    use std::collections::VecDeque;
    use std::sync::Mutex;

    /// Test-only gateway replaying scripted answers, standing in for the
    /// plugin-backed production one.
    struct ScriptedGateway {
        check_answers: Mutex<VecDeque<UpdateCheckAnswer>>,
        install_answers: Mutex<VecDeque<InstallUpdateAnswer>>,
    }

    impl ScriptedGateway {
        fn with_check(answer: UpdateCheckAnswer) -> Self {
            ScriptedGateway {
                check_answers: Mutex::new(VecDeque::from([answer])),
                install_answers: Mutex::new(VecDeque::from([])),
            }
        }

        fn with_install(answer: InstallUpdateAnswer) -> Self {
            ScriptedGateway {
                check_answers: Mutex::new(VecDeque::from([])),
                install_answers: Mutex::new(VecDeque::from([answer])),
            }
        }
    }

    impl UpdateGateway for ScriptedGateway {
        fn check(
            &self,
        ) -> std::pin::Pin<
            Box<dyn std::future::Future<Output = UpdateCheckAnswer> + Send + '_>,
        > {
            Box::pin(async move {
                self.check_answers
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner())
                    .pop_front()
                    .expect("test scripted a check answer")
            })
        }

        fn install(
            &self,
        ) -> std::pin::Pin<
            Box<dyn std::future::Future<Output = InstallUpdateAnswer> + Send + '_>,
        > {
            Box::pin(async move {
                self.install_answers
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner())
                    .pop_front()
                    .expect("test scripted an install answer")
            })
        }
    }

    const CURRENT: &str = "0.1.0";

    fn network_failure() -> UpdateFailure {
        UpdateFailure {
            reason: UpdateFailureReason::Network,
            detail: "error connecting to github.com".into(),
        }
    }

    #[tokio::test]
    async fn an_available_check_reports_both_versions_and_notes() {
        let gateway = ScriptedGateway::with_check(UpdateCheckAnswer::Offered(UpdateOffer {
            version: "0.2.0".into(),
            notes: Some("release notes".into()),
        }));
        let check = check_for_update_impl(CURRENT.into(), &gateway).await;
        assert_eq!(check.status, UpdateCheckStatus::Available);
        assert_eq!(check.current_version, CURRENT);
        assert_eq!(check.available_version.as_deref(), Some("0.2.0"));
        assert_eq!(check.notes.as_deref(), Some("release notes"));
        assert_eq!(check.failure_reason, None);

        // The wire shape is camelCased for the client.
        let json = serde_json::to_value(&check).unwrap();
        assert_eq!(json["currentVersion"], CURRENT);
        assert_eq!(json["availableVersion"], "0.2.0");
    }

    #[tokio::test]
    async fn an_up_to_date_check_answers_without_an_offer() {
        let gateway = ScriptedGateway::with_check(UpdateCheckAnswer::UpToDate);
        let check = check_for_update_impl("0.2.0".into(), &gateway).await;
        assert_eq!(check.status, UpdateCheckStatus::UpToDate);
        assert_eq!(check.available_version, None);
    }

    #[tokio::test]
    async fn a_failed_check_is_an_ordinary_answer_not_an_error() {
        let gateway =
            ScriptedGateway::with_check(UpdateCheckAnswer::Failed(network_failure()));
        let check = check_for_update_impl(CURRENT.into(), &gateway).await;
        assert_eq!(check.status, UpdateCheckStatus::Failed);
        assert_eq!(check.failure_reason, Some(UpdateFailureReason::Network));
        assert_eq!(
            check.failure_detail.as_deref(),
            Some("error connecting to github.com")
        );
    }

    #[tokio::test]
    async fn a_compiled_out_updater_reports_unavailable_through_the_command_seam() {
        let gateway = ScriptedGateway::with_check(UpdateCheckAnswer::Unavailable);
        let check = check_for_update_impl(CURRENT.into(), &gateway).await;
        assert_eq!(check.status, UpdateCheckStatus::Unavailable);
    }

    #[tokio::test]
    async fn a_successful_install_answers_installed() {
        let gateway = ScriptedGateway::with_install(InstallUpdateAnswer::Installed);
        let outcome = install_update_impl(&gateway).await;
        assert_eq!(outcome.status, InstallUpdateStatus::Installed);
    }

    #[tokio::test]
    async fn nothing_to_install_is_an_ordinary_answer() {
        let gateway = ScriptedGateway::with_install(InstallUpdateAnswer::NothingToInstall);
        let outcome = install_update_impl(&gateway).await;
        assert_eq!(outcome.status, InstallUpdateStatus::NothingToInstall);
    }

    #[tokio::test]
    async fn a_signature_failure_answers_failed_never_installed() {
        let gateway = ScriptedGateway::with_install(InstallUpdateAnswer::Failed(UpdateFailure {
            reason: UpdateFailureReason::Signature,
            detail: "signature verification failed".into(),
        }));
        let outcome = install_update_impl(&gateway).await;
        assert_eq!(outcome.status, InstallUpdateStatus::Failed);
        assert_eq!(
            outcome.failure_reason,
            Some(UpdateFailureReason::Signature),
            "a rejected signature is a failed install, never an installed one"
        );
        let json = serde_json::to_value(&outcome).unwrap();
        assert_eq!(json["status"], "failed");
        assert_eq!(json["failureReason"], "signature");
    }

    #[tokio::test]
    async fn an_unavailable_updater_cannot_install_either() {
        let gateway = ScriptedGateway::with_install(InstallUpdateAnswer::Unavailable);
        let outcome = install_update_impl(&gateway).await;
        assert_eq!(outcome.status, InstallUpdateStatus::Unavailable);
    }
}
