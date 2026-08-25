//! The update gateway seam (ticket 38): whatever the update commands use to
//! check GitHub Releases and to install. Production uses
//! [`PluginGateway`] when the updater feature is compiled in and
//! [`DisabledGateway`] otherwise; tests script their own.

use crate::core::update_check::{InstallUpdateAnswer, UpdateCheckAnswer};
#[cfg(feature = "updater")]
use crate::core::update_check::{UpdateFailure, UpdateFailureReason, UpdateOffer};
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

pub type SharedGateway = Arc<dyn UpdateGateway>;

/// One check/install channel behind the IPC seam. Answers are ordinary
/// values — failures arrive as [`UpdateCheckAnswer::Failed`], never as
/// panics or errors, so the UI can show them quietly.
pub trait UpdateGateway: Send + Sync {
    fn check(&self) -> Pin<Box<dyn Future<Output = UpdateCheckAnswer> + Send + '_>>;
    fn install(&self) -> Pin<Box<dyn Future<Output = InstallUpdateAnswer> + Send + '_>>;
}

/// The compiled-out build's gateway: the same commands exist and answer
/// `"unavailable"` rather than failing to build or panicking.
#[derive(Debug, Clone, Copy, Default)]
pub struct DisabledGateway;

impl UpdateGateway for DisabledGateway {
    fn check(&self) -> Pin<Box<dyn Future<Output = UpdateCheckAnswer> + Send + '_>> {
        Box::pin(std::future::ready(UpdateCheckAnswer::Unavailable))
    }

    fn install(&self) -> Pin<Box<dyn Future<Output = InstallUpdateAnswer> + Send + '_>> {
        Box::pin(std::future::ready(InstallUpdateAnswer::Unavailable))
    }
}

/// Maps an updater-plugin failure onto the coarse, stable reason set the
/// contract declares, preserving the underlying message as detail. A
/// rejected signature lands here too — during install — and becomes a
/// failed outcome, never an install.
#[cfg(feature = "updater")]
pub fn classify_plugin_failure(error: &tauri_plugin_updater::Error) -> UpdateFailure {
    let reason = match error {
        // The endpoint answered but not with something usable for this
        // target: 404 on latest.json, a missing platform entry, no
        // endpoints configured.
        tauri_plugin_updater::Error::ReleaseNotFound
        | tauri_plugin_updater::Error::TargetNotFound(_)
        | tauri_plugin_updater::Error::TargetsNotFound(_)
        | tauri_plugin_updater::Error::EmptyEndpoints => UpdateFailureReason::Endpoint,
        // The endpoint answered with a document we could not read.
        tauri_plugin_updater::Error::Serialization(_)
        | tauri_plugin_updater::Error::Semver(_) => UpdateFailureReason::Malformed,
        // The artifact's signature did not verify against the configured
        // pubkey — a failed install, never a prompt.
        tauri_plugin_updater::Error::Minisign(_)
        | tauri_plugin_updater::Error::Base64(_)
        | tauri_plugin_updater::Error::SignatureUtf8(_) => UpdateFailureReason::Signature,
        // Everything transport-shaped: offline, DNS, TLS, timeouts.
        tauri_plugin_updater::Error::Reqwest(_)
        | tauri_plugin_updater::Error::Http(_)
        | tauri_plugin_updater::Error::Io(_)
        | tauri_plugin_updater::Error::Network(_)
        | tauri_plugin_updater::Error::UrlParse(_)
        | tauri_plugin_updater::Error::InsecureTransportProtocol => UpdateFailureReason::Network,
        _ => UpdateFailureReason::Unknown,
    };
    UpdateFailure {
        reason,
        detail: error.to_string(),
    }
}

/// The production gateway: `tauri-plugin-updater` behind the existing IPC
/// seam (ticket 38). The plugin verifies every download against the pubkey
/// in `tauri.conf.json` before installing; an install ends with the app
/// restarting into the new version.
#[cfg(feature = "updater")]
pub struct PluginGateway {
    app: tauri::AppHandle,
}

#[cfg(feature = "updater")]
impl PluginGateway {
    pub fn new(app: tauri::AppHandle) -> Self {
        PluginGateway { app }
    }
}

#[cfg(feature = "updater")]
impl UpdateGateway for PluginGateway {
    fn check(&self) -> Pin<Box<dyn Future<Output = UpdateCheckAnswer> + Send + '_>> {
        let app = self.app.clone();
        Box::pin(async move {
            use tauri_plugin_updater::UpdaterExt;
            match app.updater() {
                Err(err) => UpdateCheckAnswer::Failed(classify_plugin_failure(&err)),
                Ok(updater) => match updater.check().await {
                    Ok(Some(update)) => UpdateCheckAnswer::Offered(UpdateOffer {
                        version: update.version.clone(),
                        notes: update.body.clone(),
                    }),
                    Ok(None) => UpdateCheckAnswer::UpToDate,
                    Err(err) => UpdateCheckAnswer::Failed(classify_plugin_failure(&err)),
                },
            }
        })
    }

    fn install(&self) -> Pin<Box<dyn Future<Output = InstallUpdateAnswer> + Send + '_>> {
        let app = self.app.clone();
        Box::pin(async move {
            use tauri_plugin_updater::UpdaterExt;
            match app.updater() {
                Err(err) => InstallUpdateAnswer::Failed(classify_plugin_failure(&err)),
                Ok(updater) => match updater.check().await {
                    Ok(Some(update)) => {
                        match update
                            .download_and_install(|_chunk: usize, _total: Option<u64>| {}, || {})
                            .await
                        {
                            Err(err) => {
                                InstallUpdateAnswer::Failed(classify_plugin_failure(&err))
                            }
                            // Restart into the installed release; `restart`
                            // never returns, so nothing below it runs.
                            Ok(()) => app.restart(),
                        }
                    }
                    Ok(None) => InstallUpdateAnswer::NothingToInstall,
                    Err(err) => InstallUpdateAnswer::Failed(classify_plugin_failure(&err)),
                },
            }
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ---------- the compiled-out build ----------

    #[tokio::test]
    async fn the_disabled_gateway_reports_unavailable_for_checks() {
        let answer = DisabledGateway.check().await;
        assert_eq!(answer, UpdateCheckAnswer::Unavailable);
    }

    #[tokio::test]
    async fn the_disabled_gateway_never_installs_anything() {
        let answer = DisabledGateway.install().await;
        assert_eq!(answer, InstallUpdateAnswer::Unavailable);
    }

    // ---------- plugin failure classification ----------

    #[cfg(feature = "updater")]
    mod plugin_failures {
        use super::*;
        use crate::core::update_check::UpdateFailureReason;
        use tauri_plugin_updater::Error as PluginError;

        fn classify_of(error: PluginError) -> UpdateFailureReason {
            classify_plugin_failure(&error).reason
        }

        fn serialization_error() -> serde_json::Error {
            serde_json::from_str::<serde_json::Value>("not json").unwrap_err()
        }

        #[test]
        fn connection_and_transport_failures_classify_as_network() {
            assert_eq!(
                classify_of(PluginError::Network("download failed".into())),
                UpdateFailureReason::Network
            );
            assert_eq!(
                classify_of(PluginError::InsecureTransportProtocol),
                UpdateFailureReason::Network
            );
        }

        #[test]
        fn a_malformed_latest_json_classifies_as_malformed() {
            assert_eq!(
                classify_of(PluginError::Serialization(serialization_error())),
                UpdateFailureReason::Malformed
            );
        }

        #[test]
        fn endpoint_shape_failures_classify_as_endpoint() {
            assert_eq!(
                classify_of(PluginError::ReleaseNotFound),
                UpdateFailureReason::Endpoint,
                "a 404 on latest.json is an endpoint failure"
            );
            assert_eq!(
                classify_of(PluginError::TargetNotFound("windows-x86_64".into())),
                UpdateFailureReason::Endpoint
            );
            assert_eq!(
                classify_of(PluginError::TargetsNotFound(vec![
                    "windows-x86_64".into()
                ])),
                UpdateFailureReason::Endpoint
            );
            assert_eq!(
                classify_of(PluginError::EmptyEndpoints),
                UpdateFailureReason::Endpoint
            );
        }

        #[test]
        fn signature_failures_classify_as_signature() {
            assert_eq!(
                classify_of(PluginError::SignatureUtf8("garbled".into())),
                UpdateFailureReason::Signature
            );
        }

        #[test]
        fn anything_else_stays_distinguishable_as_unknown_with_its_detail() {
            let failure = classify_plugin_failure(&PluginError::FormatDate);
            assert_eq!(failure.reason, UpdateFailureReason::Unknown);
            assert!(!failure.detail.is_empty(), "the detail is preserved");
        }
    }
}
