//! The Archer's Hub capture popup (ticket 10).
//!
//! A separate webview window opens on Archer's Hub where the student signs
//! in manually and searches courses normally. Its initialization script
//! (ticket 10, [`crate::adapters::capture_script`]) captures every results
//! render to the ticket-09 loopback endpoint. The window's WebView profile
//! lives in a dedicated data directory under the app data dir so that
//! "sign out / clear session" can wipe it — and only it — without touching
//! anything else the app persists.
//!
//! The remote origin is never granted Tauri IPC (ADR-0003): this module
//! never enables remote domain access or capabilities for the popup.

use crate::adapters::capture::CaptureListener;
use crate::adapters::capture_script::build_capture_script;
use crate::adapters::store::CaptureScope;
use crate::core::parser::SelectorConfig;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, Url, WebviewUrl, WebviewWindowBuilder};

/// Label of the capture window, shared by open and clear-session.
pub const CAPTURE_WINDOW_LABEL: &str = "archers-hub-capture";

/// The page the popup opens on. The student signs in there manually; the
/// initialization script guards itself to this host on every navigation.
pub const ARCHERS_HUB_URL: &str = "https://archershub.dlsu.edu.ph";

/// Directory name under the app data dir holding the capture window's
/// persisted WebView profile. Wiped by "sign out / clear session".
pub const SESSION_DIR_NAME: &str = "archers-hub-session";

/// The data directory holding the capture window's persisted profile.
pub fn session_data_dir(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join(SESSION_DIR_NAME)
}

/// Wipes the persisted browser profile and leaves a fresh empty directory
/// behind. The window holding the profile must already be destroyed.
pub fn wipe_session_dir(dir: &Path) -> std::io::Result<()> {
    if dir.exists() {
        std::fs::remove_dir_all(dir)?;
    }
    std::fs::create_dir_all(dir)?;
    Ok(())
}

/// The loopback URL the injected script posts to.
pub fn endpoint_url(listener: &CaptureListener) -> String {
    format!("http://{}/capture", listener.addr())
}

/// The campus/session the currently open capture window was created for.
/// Managed as Tauri state so `open_capture_window` can focus an open window
/// instead of recreating it when the scope still matches, and recreate it
/// when the scope changed — captures must never be misfiled across terms.
#[derive(Default)]
pub struct CaptureWindowScope(std::sync::Mutex<Option<CaptureScope>>);

impl CaptureWindowScope {
    pub fn get(&self) -> Option<CaptureScope> {
        *self.0.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    pub fn set(&self, scope: Option<CaptureScope>) {
        *self.0.lock().unwrap_or_else(|poisoned| poisoned.into_inner()) = scope;
    }
}

/// Opens (or refocuses) the capture popup for the given plan scope.
///
/// The window gets its own data directory (persisted session) and the
/// initialization script built from the listener's address and token, the
/// scope, and the currently loaded selector config — remote if it validated
/// at startup, bundled otherwise (ticket 18). Reopening with the same scope
/// focuses the existing window; a different scope closes it and starts a
/// fresh window so captures cannot be misfiled across terms.
pub fn open_capture_window(
    app: &AppHandle,
    listener: &CaptureListener,
    selector_config: &SelectorConfig,
    scope: CaptureScope,
) -> Result<(), String> {
    let state = app.state::<CaptureWindowScope>();

    if let Some(window) = app.get_webview_window(CAPTURE_WINDOW_LABEL) {
        if state.get() == Some(scope) {
            return window.set_focus().map_err(|err| err.to_string());
        }
        window.destroy().map_err(|err| err.to_string())?;
    }

    let data_dir = session_data_dir(
        &app.path()
            .app_data_dir()
            .map_err(|err| err.to_string())?,
    );
    std::fs::create_dir_all(&data_dir)
        .map_err(|err| format!("failed to create the capture session directory: {err}"))?;

    let script = build_capture_script(
        selector_config,
        &endpoint_url(listener),
        listener.token(),
        scope.campus_id,
        scope.session_id,
        "archershub.dlsu.edu.ph",
    );

    let url = Url::parse(ARCHERS_HUB_URL).expect("the Archer's Hub URL is a valid URL");
    WebviewWindowBuilder::new(app, CAPTURE_WINDOW_LABEL, WebviewUrl::External(url))
        .title("Archer's Hub")
        .inner_size(1100.0, 760.0)
        .initialization_script(script)
        .data_directory(data_dir)
        .build()
        .map_err(|err| err.to_string())?;

    state.set(Some(scope));
    Ok(())
}

/// Signs the student out: destroys the capture window and wipes its
/// persisted WebView profile, so the next open starts signed out. Nothing
/// else under the app data dir is touched.
pub fn clear_browser_session(app: &AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(CAPTURE_WINDOW_LABEL) {
        window.destroy().map_err(|err| err.to_string())?;
        app.state::<CaptureWindowScope>().set(None);
    }
    let data_dir = session_data_dir(
        &app.path()
            .app_data_dir()
            .map_err(|err| err.to_string())?,
    );
    wipe_session_dir(&data_dir)
        .map_err(|err| format!("failed to clear the browser session: {err}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_dir_lives_under_the_app_data_dir_with_its_own_name() {
        let dir = session_data_dir(Path::new("/data/app"));
        assert_eq!(dir, PathBuf::from("/data/app").join(SESSION_DIR_NAME));
    }

    #[test]
    fn wipe_removes_the_profile_and_leaves_a_fresh_empty_directory() {
        let temp = tempfile::tempdir().expect("temp dir");
        let dir = temp.path().join("session");
        std::fs::create_dir_all(dir.join("profile")).expect("nested dir");
        std::fs::write(dir.join("profile").join("cookies"), b"session cookie")
            .expect("a file inside the profile");

        wipe_session_dir(&dir).expect("wipe must succeed");

        assert!(dir.exists(), "the session directory is recreated");
        assert!(
            std::fs::read_dir(&dir).expect("read").next().is_none(),
            "the recreated directory is empty"
        );
    }

    #[test]
    fn wiping_a_missing_directory_creates_it() {
        let temp = tempfile::tempdir().expect("temp dir");
        let dir = temp.path().join("never-created");

        wipe_session_dir(&dir).expect("wipe must succeed");

        assert!(dir.exists(), "a missing session directory is created fresh");
    }

    #[tokio::test]
    async fn endpoint_url_is_the_listeners_loopback_address_with_the_capture_route() {
        let store = crate::adapters::store::Store::open_in_memory().expect("store");
        let (listener, server) = CaptureListener::bind(
            std::sync::Arc::new(std::sync::Mutex::new(store)),
            (),
            (),
            crate::adapters::refresh_driver::ActiveRefreshRun::default(),
        )
        .expect("listener must bind");
        // The server is dropped without serving: the socket is released and
        // only the endpoint metadata is asserted.
        drop(server);

        let url = endpoint_url(&listener);
        assert!(
            url.starts_with("http://127.0.0.1:"),
            "the endpoint is loopback only: {url}"
        );
        assert!(url.ends_with("/capture"), "the capture route: {url}");
        assert!(
            url.contains(&listener.port().to_string()),
            "the endpoint carries the bound port: {url}"
        );
    }

    #[test]
    fn hub_url_is_https_on_the_hub_host() {
        let url = Url::parse(ARCHERS_HUB_URL).expect("the hub URL must parse");
        assert_eq!(url.scheme(), "https");
        assert_eq!(url.host_str(), Some("archershub.dlsu.edu.ph"));
    }

    #[test]
    fn window_scope_tracks_the_open_scopes() {
        let state = CaptureWindowScope::default();
        assert_eq!(state.get(), None);

        let scope = CaptureScope { campus_id: 7, session_id: 155 };
        state.set(Some(scope));
        assert_eq!(state.get(), Some(scope));

        state.set(None);
        assert_eq!(state.get(), None);
    }
}
