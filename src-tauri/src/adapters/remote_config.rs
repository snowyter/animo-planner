//! The remote selector config (ticket 18, ADR-0013).
//!
//! The DOM selectors and parse rules live in a small JSON file published on
//! GitHub. At startup the app fetches it once — a plain read of a static
//! URL with no query parameters, credentials, or app state attached
//! (ADR-0004) — and swaps it in when it validates. Any failure (network
//! error, timeout, malformed JSON, structurally invalid document) falls
//! back silently to the copy embedded in the binary, so startup never
//! blocks on the network and the app is fully usable offline.
//!
//! The decision logic ([`evaluate_fetch_outcome`]) is pure and unit-tested;
//! [`fetch_body`] is the only network code here.

use crate::core::ipc_types::SelectorConfigSource;
use crate::core::parser::SelectorConfig;
use crate::core::selector_config::load_versioned_selector_config;
use std::fmt;
use std::sync::{Arc, Mutex};
use std::time::Duration;

/// Where the remote document is fetched from: the latest release asset of
/// the public repo, the same channel as the updater. Fixing every installed
/// copy is a release publish away.
pub const SELECTOR_CONFIG_URL: &str = "https://github.com/snowyter/animo-planner/releases/latest/download/selector-config.json";

/// Total time the fetch may take before it is abandoned in favour of the
/// bundled copy. Short by design: the app never waits on this to become
/// usable.
pub const FETCH_TIMEOUT: Duration = Duration::from_secs(5);

/// Version of the bundled copy, reported when no remote document loaded.
pub const BUNDLED_VERSION: &str = "1";

/// The wire-format copy bundled into the binary: the same document shape
/// published remotely, pinned by a test against the compiled defaults.
pub const BUNDLED_DOCUMENT: &str = include_str!("../../selector-config.json");

/// Why a fetch attempt did not produce a body.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FetchError {
    /// Connection failure, DNS failure, or a non-success HTTP status.
    Network(String),
    /// The server did not answer within [`FETCH_TIMEOUT`].
    Timeout,
}

impl fmt::Display for FetchError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            FetchError::Network(detail) => write!(f, "network error: {detail}"),
            FetchError::Timeout => write!(f, "timed out"),
        }
    }
}

impl std::error::Error for FetchError {}

/// What the app currently parses captures with, and where it came from.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LoadedSelectorConfig {
    pub source: SelectorConfigSource,
    pub version: String,
    pub config: SelectorConfig,
}

/// The bundled copy: the embedded document, validated by the same loader a
/// remote document goes through. Falls back to the compiled defaults if the
/// embedded text were ever corrupted — unreachable, guarded by a test.
pub fn bundled() -> LoadedSelectorConfig {
    match load_versioned_selector_config(BUNDLED_DOCUMENT) {
        Ok(versioned) => LoadedSelectorConfig {
            source: SelectorConfigSource::Bundled,
            version: versioned.version,
            config: versioned.config,
        },
        Err(_) => LoadedSelectorConfig {
            source: SelectorConfigSource::Bundled,
            version: BUNDLED_VERSION.to_string(),
            config: SelectorConfig::default(),
        },
    }
}

/// The client startup uses: rustls TLS, total timeout enforced here so a
/// hanging server can never stall the swap-in beyond [`FETCH_TIMEOUT`].
pub fn startup_client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(FETCH_TIMEOUT)
        .build()
        .expect("the selector-config HTTP client must build")
}

/// Reads the static file. A plain GET: no query parameters, no auth or
/// custom headers — nothing identifying rides along (ADR-0004).
pub async fn fetch_body(client: &reqwest::Client, url: &str) -> Result<String, FetchError> {
    let response = client
        .get(url)
        .send()
        .await
        .map_err(classify_fetch_error)?;
    let status = response.status();
    if !status.is_success() {
        return Err(FetchError::Network(format!("HTTP {status}")));
    }
    response
        .text()
        .await
        .map_err(|err| FetchError::Network(err.to_string()))
}

fn classify_fetch_error(err: reqwest::Error) -> FetchError {
    if err.is_timeout() {
        FetchError::Timeout
    } else {
        FetchError::Network(err.to_string())
    }
}

/// Decides what the app loads from a fetch outcome: the validated remote
/// document, or — for any failure mode whatsoever — the bundled copy.
/// Fallback is silent by design (ADR-0004): no counters, no pings.
pub fn evaluate_fetch_outcome(outcome: Result<String, FetchError>) -> LoadedSelectorConfig {
    let body = match outcome {
        Ok(body) => body,
        Err(_) => return bundled(),
    };
    match load_versioned_selector_config(&body) {
        Ok(versioned) => LoadedSelectorConfig {
            source: SelectorConfigSource::Remote,
            version: versioned.version,
            config: versioned.config,
        },
        Err(_) => bundled(),
    }
}

/// Fetches the remote document through the startup client and decides what
/// to load. Spawned off the main thread at startup; the app runs on the
/// bundled copy until this resolves.
pub async fn fetch_startup_config() -> LoadedSelectorConfig {
    let client = startup_client();
    let outcome = fetch_body(&client, SELECTOR_CONFIG_URL).await;
    evaluate_fetch_outcome(outcome)
}

/// Shared handle to the currently loaded config. Managed as Tauri state:
/// starts bundled immediately (startup never blocks), swapped in place if
/// the remote fetch validates.
#[derive(Clone)]
pub struct SelectorConfigHandle(Arc<Mutex<LoadedSelectorConfig>>);

impl Default for SelectorConfigHandle {
    fn default() -> Self {
        Self(Arc::new(Mutex::new(bundled())))
    }
}

impl SelectorConfigHandle {
    pub fn loaded(&self) -> LoadedSelectorConfig {
        self.0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
    }

    pub fn set_loaded(&self, loaded: LoadedSelectorConfig) {
        *self
            .0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = loaded;
    }
}

/// Hands the capture path whatever selector config is currently loaded —
/// the remote document once it arrives, the bundled copy before that.
/// Production uses [`SelectorConfigHandle`]; tests use fixed configs or the
/// unit type for the bundled default.
pub trait CurrentSelectorConfig: Clone + Send + Sync + 'static {
    fn selector_config(&self) -> SelectorConfig;
}

impl CurrentSelectorConfig for SelectorConfigHandle {
    fn selector_config(&self) -> SelectorConfig {
        self.loaded().config
    }
}

impl CurrentSelectorConfig for () {
    fn selector_config(&self) -> SelectorConfig {
        SelectorConfig::default()
    }
}


#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::parser::SelectorConfig;

    fn remote_document(version: &str, results_table: &str) -> String {
        let mut value = serde_json::to_value(SelectorConfig::default()).unwrap();
        let object = value.as_object_mut().unwrap();
        object.insert("version".into(), serde_json::json!(version));
        object.insert("resultsTable".into(), serde_json::json!(results_table));
        serde_json::to_string(&object).unwrap()
    }

    // ---------- the bundled copy ----------

    #[test]
    fn bundled_is_the_bundled_source_with_a_version_and_default_rules() {
        let loaded = bundled();
        assert_eq!(loaded.source, SelectorConfigSource::Bundled);
        assert_eq!(loaded.version, BUNDLED_VERSION);
        assert_eq!(loaded.config, SelectorConfig::default());
    }

    #[test]
    fn the_bundled_document_parses_and_matches_the_compiled_defaults() {
        // The JSON file is the wire-format copy published to GitHub; this
        // test fails if it ever drifts from what the parser expects.
        let loaded = load_versioned_selector_config(BUNDLED_DOCUMENT)
            .expect("the embedded document must always parse");
        assert_eq!(loaded.config, SelectorConfig::default());
        assert_eq!(loaded.version, BUNDLED_VERSION);
    }

    // ---------- the fallback decision ----------

    #[test]
    fn a_valid_remote_document_is_loaded_as_remote() {
        let body = remote_document("9", "#remoteTable");
        let loaded = evaluate_fetch_outcome(Ok(body));

        assert_eq!(loaded.source, SelectorConfigSource::Remote);
        assert_eq!(loaded.version, "9");
        assert_eq!(loaded.config.results_table, "#remoteTable");
    }

    #[test]
    fn a_network_failure_falls_back_to_bundled() {
        let loaded = evaluate_fetch_outcome(Err(FetchError::Network("dns exploded".into())));
        assert_eq!(loaded.source, SelectorConfigSource::Bundled);
        assert_eq!(loaded.config, SelectorConfig::default());
    }

    #[test]
    fn a_timeout_falls_back_to_bundled() {
        let loaded = evaluate_fetch_outcome(Err(FetchError::Timeout));
        assert_eq!(loaded.source, SelectorConfigSource::Bundled);
    }

    #[test]
    fn malformed_json_falls_back_to_bundled() {
        for body in ["", "<html>502 Bad Gateway</html>", "{ truncated"] {
            let loaded = evaluate_fetch_outcome(Ok(body.to_string()));
            assert_eq!(loaded.source, SelectorConfigSource::Bundled, "body: {body:?}");
            assert_eq!(loaded.config, SelectorConfig::default());
        }
    }

    #[test]
    fn a_structurally_invalid_document_falls_back_to_bundled() {
        // Parses as JSON but would break capture if loaded.
        let missing_field = {
            let mut value =
                serde_json::from_str::<serde_json::Value>(&remote_document("9", "#t")).unwrap();
            value.as_object_mut().unwrap().remove("scheduleCell");
            serde_json::to_string(&value).unwrap()
        };
        let unknown_field = {
            let mut value =
                serde_json::from_str::<serde_json::Value>(&remote_document("9", "#t")).unwrap();
            value
                .as_object_mut()
                .unwrap()
                .insert("surprise".into(), serde_json::json!("#x"));
            serde_json::to_string(&value).unwrap()
        };
        let uncompilable_selector = remote_document("9", "###not css###");

        for body in [missing_field, unknown_field, uncompilable_selector] {
            let loaded = evaluate_fetch_outcome(Ok(body.clone()));
            assert_eq!(loaded.source, SelectorConfigSource::Bundled, "body: {body:?}");
            assert_eq!(loaded.config, SelectorConfig::default());
        }
    }

    // ---------- the request itself (privacy, ADR-0004) ----------

    #[test]
    fn the_config_url_is_a_static_github_read_with_no_query_parameters() {
        let url = reqwest::Url::parse(SELECTOR_CONFIG_URL).expect("the constant must be a URL");
        assert_eq!(url.scheme(), "https", "fetched over https only");
        assert_eq!(url.host_str(), Some("github.com"));
        assert!(url.username().is_empty(), "no credentials in the URL");
        assert!(url.password().is_none(), "no credentials in the URL");
        assert!(
            url.query().is_none(),
            "no query parameters — no app or student state may ride along"
        );
        assert!(
            url.path().ends_with(".json"),
            "a static file read, got path {:?}",
            url.path()
        );
    }

    // ---------- real loopback round trip ----------

    /// A one-route axum server that records the request URI and answers
    /// with a fixed body. Used instead of mocking reqwest so the test
    /// exercises the actual HTTP read.
    async fn serve_body(
        body: &'static str,
    ) -> std::net::SocketAddr {
        use axum::routing::get;
        let recorded: std::sync::Arc<std::sync::Mutex<Option<axum::http::Uri>>> =
            Default::default();
        let recorder = recorded.clone();
        let app = axum::Router::new().route(
            "/selector-config.json",
            get(move |uri: axum::http::Uri| {
                *recorder.lock().unwrap() = Some(uri);
                async move { body.to_string() }
            }),
        );
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        addr
    }

    #[tokio::test]
    async fn a_real_fetch_loads_the_remote_document() {
        let document: &'static str =
            Box::leak(remote_document("12", "#loopbackTable").into_boxed_str());
        let addr = serve_body(document).await;
        let url = format!("http://{addr}/selector-config.json");

        let client = startup_client();
        let loaded = evaluate_fetch_outcome(fetch_body(&client, &url).await);

        assert_eq!(loaded.source, SelectorConfigSource::Remote);
        assert_eq!(loaded.version, "12");
        assert_eq!(loaded.config.results_table, "#loopbackTable");
    }

    #[tokio::test]
    async fn a_hanging_server_times_out_into_the_bundled_fallback() {
        use axum::routing::get;
        let app = axum::Router::new().route(
            "/slow",
            get(|| async {
                std::thread::sleep(std::time::Duration::from_secs(5));
                "too late"
            }),
        );
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });

        let client = reqwest::Client::builder()
            .timeout(Duration::from_millis(150))
            .build()
            .expect("client builds");
        let loaded =
            evaluate_fetch_outcome(fetch_body(&client, &format!("http://{addr}/slow")).await);

        assert_eq!(loaded.source, SelectorConfigSource::Bundled);
        assert_eq!(loaded.config, SelectorConfig::default());
    }

    #[tokio::test]
    async fn a_missing_remote_file_falls_back_to_bundled() {
        // GitHub answers a release asset that was never published with 404;
        // that is a failed fetch like any other.
        let app = axum::Router::new()
            .fallback(|| async { (axum::http::StatusCode::NOT_FOUND, "nope") });
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });

        let client = startup_client();
        let loaded =
            evaluate_fetch_outcome(fetch_body(&client, &format!("http://{addr}/selector-config.json")).await);

        assert_eq!(loaded.source, SelectorConfigSource::Bundled);
        assert_eq!(loaded.version, BUNDLED_VERSION);
        assert_eq!(loaded.config, SelectorConfig::default());
    }

    // ---------- the shared handle ----------

    #[test]
    fn the_handle_starts_bundled_and_swaps_when_a_remote_arrives() {
        let handle = SelectorConfigHandle::default();
        assert_eq!(handle.loaded().source, SelectorConfigSource::Bundled);

        let remote = evaluate_fetch_outcome(Ok(remote_document("4", "#swapped")));
        handle.set_loaded(remote);
        let loaded = handle.loaded();
        assert_eq!(loaded.source, SelectorConfigSource::Remote);
        assert_eq!(loaded.version, "4");
        assert_eq!(loaded.config.results_table, "#swapped");
    }
}
