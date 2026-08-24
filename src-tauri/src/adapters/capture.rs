//! Loopback capture endpoint (ticket 09).
//!
//! The injected capture script on Archer's Hub never gets Tauri IPC
//! (ADR-0003). Its only channel to the Rust core is this HTTP listener:
//! bound to `127.0.0.1` on a random free port, guarded by a bearer token
//! minted fresh each launch, exposing exactly one write route and no reads.
//!
//! A posted batch is parsed by the ticket-04 parser and stored by the
//! ticket-05 store. Raw HTML exists only in the request body: the store
//! receives typed parsed sections, so no HTML can ever be persisted.

use crate::adapters::remote_config::CurrentSelectorConfig;
use crate::adapters::store::{CaptureScope, StoreHandle};
use crate::core::ipc_types::CaptureSummary;
use crate::core::parser::{parse_results_table, CourseContext};
use axum::body::Bytes;
use axum::extract::State;
use axum::http::header::{self, AUTHORIZATION};
use axum::http::{HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::post;
use axum::{Json, Router};
use rand::RngCore;
use serde::Deserialize;
use std::collections::VecDeque;
use std::net::{Ipv4Addr, SocketAddr};
use std::sync::{Arc, Mutex};
use tokio::net::TcpListener;

/// Events the listener announces, so the UI can react without polling.
/// The app wires this to Tauri events (`capture:updated`, `capture:failed`);
/// tests use a recording sink or the no-op unit.
pub trait CaptureEvents: Clone + Send + Sync + 'static {
    fn capture_updated(&self, summary: CaptureSummary);
    fn capture_failed(&self, error: String);
}

impl CaptureEvents for () {
    fn capture_updated(&self, _summary: CaptureSummary) {}
    fn capture_failed(&self, _error: String) {}
}

/// The body of a capture POST: the scope the plan is fixed to, the course
/// identity read from the dropdown option at capture time, and the rendered
/// results HTML. The HTML is parsed and discarded — never persisted.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapturePayload {
    pub campus_id: i64,
    pub session_id: i64,
    pub course_id: i64,
    pub course_code: String,
    pub course_title: String,
    pub html: String,
}

#[derive(Debug)]
pub enum ListenerError {
    Io(std::io::Error),
}

/// How many recent failures stay in memory. A student can search several
/// courses back to back; every announced failure stays reportable for the
/// launch, within this bound.
pub const RETAINED_FAILURE_LIMIT: usize = 8;

/// One capture failure as retained Rust-side: the announced error and —
/// when the payload's HTML had been read before the failure — the raw DOM
/// fragment it failed on. Raw fragments never leave the core except
/// through `build_capture_report`, which scrubs first.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CapturedFailure {
    pub error: String,
    pub fragment: Option<String>,
}

/// Memory of recent capture failures, shared between the listener (writer)
/// and the report command (reader). Bounded; lives only for the launch.
#[derive(Clone, Default)]
pub struct RetainedFailures(Arc<Mutex<VecDeque<CapturedFailure>>>);

impl RetainedFailures {
    /// Records one failure. The capture listener is the production writer;
    /// public so seam tests can seed realistic failures.
    pub fn record(&self, failure: CapturedFailure) {
        let mut failures = self
            .0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        failures.push_back(failure);
        while failures.len() > RETAINED_FAILURE_LIMIT {
            failures.pop_front();
        }
    }

    /// The most recent failure whose announced error matches.
    pub fn find(&self, error: &str) -> Option<CapturedFailure> {
        self.0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .iter()
            .rev()
            .find(|failure| failure.error == error)
            .cloned()
    }

    /// The most recent failure of any kind.
    pub fn latest(&self) -> Option<CapturedFailure> {
        self.0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .back()
            .cloned()
    }

    #[cfg(test)]
    fn len(&self) -> usize {
        self.0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .len()
    }
}

impl std::fmt::Display for ListenerError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ListenerError::Io(err) => write!(f, "failed to bind the loopback listener: {err}"),
        }
    }
}

impl std::error::Error for ListenerError {}

impl From<std::io::Error> for ListenerError {
    fn from(err: std::io::Error) -> Self {
        ListenerError::Io(err)
    }
}

#[derive(Clone)]
struct ListenerState<E, C> {
    store: StoreHandle,
    events: E,
    token: String,
    config: C,
    failures: RetainedFailures,
}

/// The bound endpoint: its loopback address and the per-launch token the
/// popup (ticket 10) needs to reach it. Held in Tauri state so the capture
/// window can be opened with the right URL and token, and so
/// `build_capture_report` (ticket 19) can read the failures this listener
/// retained.
pub struct CaptureListener {
    addr: SocketAddr,
    token: String,
    failures: RetainedFailures,
}

impl CaptureListener {
    /// Binds to `127.0.0.1` on a random free port and mints a fresh bearer
    /// token. The token lives only in memory for this launch; the address
    /// is loopback, so no other machine can reach the listener.
    ///
    /// Captures are parsed with whatever selector config `config` serves —
    /// the remote document once loaded, the bundled copy otherwise (ticket
    /// 18) — never with selectors hardcoded at this call site.
    ///
    /// Returns the endpoint metadata and the server to run: call
    /// `CaptureServer::serve` on the app's async runtime.
    pub fn bind<E: CaptureEvents, C: CurrentSelectorConfig>(
        store: StoreHandle,
        events: E,
        config: C,
    ) -> Result<(CaptureListener, CaptureServer), ListenerError> {
        let listener = std::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0))?;
        listener.set_nonblocking(true)?;
        let addr = listener.local_addr()?;
        let token = generate_token();
        let listener = TcpListener::from_std(listener)?;
        let failures = RetainedFailures::default();
        let state = ListenerState {
            store,
            events,
            token: token.clone(),
            config,
            failures: failures.clone(),
        };
        let app = Router::new()
            .route("/capture", post(handle_capture::<E, C>).options(handle_preflight))
            .with_state(state);
        Ok((
            CaptureListener { addr, token, failures },
            CaptureServer { listener, app },
        ))
    }

    pub fn addr(&self) -> SocketAddr {
        self.addr
    }

    pub fn port(&self) -> u16 {
        self.addr.port()
    }

    pub fn token(&self) -> &str {
        &self.token
    }

    /// The failures this listener has announced. Raw fragments stay here;
    /// the report command is the only reader and scrubs before assembling.
    pub fn retained_failures(&self) -> &RetainedFailures {
        &self.failures
    }
}

/// The running server half of a bound listener. Spawn it on the app's async
/// runtime; it serves until the process exits.
pub struct CaptureServer {
    listener: TcpListener,
    app: Router,
}

impl CaptureServer {
    pub async fn serve(self) {
        if let Err(err) = axum::serve(self.listener, self.app).await {
            eprintln!("capture listener shut down: {err}");
        }
    }
}

/// 256 bits of randomness per launch, hex-encoded. Never persisted.
fn generate_token() -> String {
    let mut bytes = [0u8; 32];
    rand::rng().fill_bytes(&mut bytes);
    let mut token = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        token.push_str(&format!("{byte:02x}"));
    }
    token
}

/// Extracts the bearer token from an `Authorization: Bearer <token>` header.
/// The scheme name is matched case-insensitively per RFC 6750.
fn bearer_token(headers: &HeaderMap) -> Option<&str> {
    let value = headers.get(AUTHORIZATION)?.to_str().ok()?;
    let (scheme, token) = value.split_once(' ')?;
    if !scheme.eq_ignore_ascii_case("bearer") {
        return None;
    }
    let token = token.trim();
    (!token.is_empty()).then_some(token)
}

/// Fixed-length constant-time comparison, so the token cannot be recovered
/// by timing the listener.
fn tokens_match(expected: &str, actual: &str) -> bool {
    let expected = expected.as_bytes();
    let actual = actual.as_bytes();
    if expected.len() != actual.len() {
        return false;
    }
    expected
        .iter()
        .zip(actual)
        .fold(0u8, |diff, (a, b)| diff | (a ^ b))
        == 0
}

/// The `Origin` header of a request, if one was sent.
fn request_origin(headers: &HeaderMap) -> Option<HeaderValue> {
    headers.get(header::ORIGIN).cloned()
}

/// Adds the CORS headers a cross-origin fetch needs to read the response.
/// The origin is echoed (with `Vary: Origin`); the bearer token is the only
/// authorization boundary, so reflecting the origin grants nothing.
fn with_cors(mut response: Response, origin: Option<HeaderValue>) -> Response {
    if let Some(origin) = origin {
        let headers = response.headers_mut();
        headers.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, origin);
        headers.insert(header::VARY, HeaderValue::from_static("origin"));
    }
    response
}

/// Answers the browser's CORS preflight for the capture POST. The injected
/// script runs on `https://archershub.dlsu.edu.ph` while the listener is on
/// `127.0.0.1:<random-port>`, so every post is cross-origin and preflighted
/// (Authorization header + JSON content type). No token is required for
/// OPTIONS — preflights never carry headers, and the answer reveals nothing.
async fn handle_preflight(headers: HeaderMap) -> Response {
    let mut response = StatusCode::NO_CONTENT.into_response();
    if let Some(origin) = request_origin(&headers) {
        let cors = response.headers_mut();
        cors.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, origin);
        cors.insert(header::VARY, HeaderValue::from_static("origin"));
        cors.insert(
            header::ACCESS_CONTROL_ALLOW_METHODS,
            HeaderValue::from_static("POST, OPTIONS"),
        );
        cors.insert(
            header::ACCESS_CONTROL_ALLOW_HEADERS,
            HeaderValue::from_static("authorization, content-type"),
        );
        cors.insert(
            header::ACCESS_CONTROL_MAX_AGE,
            HeaderValue::from_static("86400"),
        );
    }
    response
}

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

/// Rejects the request with a diagnostic body and announces the failure.
/// Every announced failure is retained Rust-side (ticket 19) — with the
/// offending DOM fragment when one was in scope — so it stays reportable;
/// raw fragments never travel to the webview in the event itself.
fn reject<E: CaptureEvents, C: CurrentSelectorConfig>(
    state: &ListenerState<E, C>,
    origin: Option<HeaderValue>,
    status: StatusCode,
    message: String,
    fragment: Option<&str>,
) -> Response {
    state.events.capture_failed(message.clone());
    state.failures.record(CapturedFailure {
        error: message.clone(),
        fragment: fragment.map(str::to_string),
    });
    with_cors(
        (status, Json(serde_json::json!({ "error": message }))).into_response(),
        origin,
    )
}

/// The one write route: authenticate, parse, store. Anything malformed or
/// unparseable is rejected and stores nothing; the store's single
/// transaction guarantees no partial rows on failure.
async fn handle_capture<E: CaptureEvents, C: CurrentSelectorConfig>(
    State(state): State<ListenerState<E, C>>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let origin = request_origin(&headers);

    match bearer_token(&headers) {
        Some(token) if tokens_match(&state.token, token) => {}
        _ => return with_cors(StatusCode::UNAUTHORIZED.into_response(), origin),
    }

    let payload: CapturePayload = match serde_json::from_slice(&body) {
        Ok(payload) => payload,
        Err(err) => {
            return reject(
                &state,
                origin,
                StatusCode::BAD_REQUEST,
                format!("malformed capture payload: {err}"),
                None,
            );
        }
    };

    let context = CourseContext {
        course_id: payload.course_id,
        code: payload.course_code,
        title: payload.course_title,
    };
    let selector_config = state.config.selector_config();
    let parsed =
        match parse_results_table(&payload.html, &context, &selector_config) {
        Ok(parsed) => parsed,
        Err(err) => {
            return reject(
                &state,
                origin,
                StatusCode::UNPROCESSABLE_ENTITY,
                format!("unparseable capture payload: {err}"),
                Some(&payload.html),
            );
        }
    };
    if parsed.sections.is_empty()
        && parsed
            .diagnostics
            .iter()
            .any(|diagnostic| diagnostic.severity == crate::core::parser::DiagnosticSeverity::Error)
    {
        let detail = parsed
            .diagnostics
            .first()
            .map(|diagnostic| diagnostic.message.clone())
            .unwrap_or_else(|| "no section parsed".to_string());
        return reject(
            &state,
            origin,
            StatusCode::UNPROCESSABLE_ENTITY,
            format!("capture produced no sections: {detail}"),
            Some(&payload.html),
        );
    }

    let scope = CaptureScope {
        campus_id: payload.campus_id,
        session_id: payload.session_id,
    };
    let summary = {
        let mut store = state.store.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Err(err) = store.record_capture(&scope, &parsed.sections, &now_iso()) {
            return reject(
                &state,
                origin,
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("capture could not be stored: {err}"),
                None,
            );
        }
        match store.capture_summary(&scope) {
            Ok(summary) => summary,
            Err(err) => {
                return reject(
                    &state,
                    origin,
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("capture summary unavailable: {err}"),
                    None,
                );
            }
        }
    };
    state.events.capture_updated(summary);
    with_cors(StatusCode::NO_CONTENT.into_response(), origin)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::adapters::store::{CaptureScope, Store, StoreHandle};
    use std::net::Ipv4Addr;
    use std::sync::{Arc, Mutex};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpStream;

    const CSINTSY_FIXTURE: &str =
        include_str!("../../tests/fixtures/ArchersHub-Course-Finder-CSINTSY.html");
    const GEARTAP_FIXTURE: &str =
        include_str!("../../tests/fixtures/ArchersHub-Course-Finder-GEARTAP.html");

    /// Event sink that records what the listener announced.
    #[derive(Clone, Default)]
    struct RecordingEvents {
        updated: Arc<Mutex<Vec<CaptureSummary>>>,
        failed: Arc<Mutex<Vec<String>>>,
    }

    impl CaptureEvents for RecordingEvents {
        fn capture_updated(&self, summary: CaptureSummary) {
            self.updated.lock().unwrap().push(summary);
        }

        fn capture_failed(&self, error: String) {
            self.failed.lock().unwrap().push(error);
        }
    }

    fn in_memory_store() -> StoreHandle {
        Arc::new(Mutex::new(
            Store::open_in_memory().expect("in-memory store must open"),
        ))
    }

    fn payload(
        campus: i64,
        session: i64,
        course_id: i64,
        code: &str,
        title: &str,
        html: &str,
    ) -> String {
        serde_json::json!({
            "campusId": campus,
            "sessionId": session,
            "courseId": course_id,
            "courseCode": code,
            "courseTitle": title,
            "html": html,
        })
        .to_string()
    }

    fn csintsy_payload() -> String {
        payload(
            7,
            155,
            2923,
            "CSINTSY",
            "INTRODUCTION TO INTELLIGENT SYSTEMS",
            CSINTSY_FIXTURE,
        )
    }

    fn geartap_payload() -> String {
        payload(7, 155, 564, "GEARTAP", "ART APPRECIATION", GEARTAP_FIXTURE)
    }

    /// Minimal raw-HTTP client so the tests exercise a real socket, not the
    /// router in-process.
    async fn raw_request(
        port: u16,
        method: &str,
        path: &str,
        headers: &[(&str, &str)],
        body: &[u8],
    ) -> (u16, String) {
        let (status, _, body) = raw_request_full(port, method, path, headers, body).await;
        (status, body)
    }

    /// Like [`raw_request`] but also returns the response headers, lowercased
    /// for case-insensitive lookup.
    async fn raw_request_full(
        port: u16,
        method: &str,
        path: &str,
        headers: &[(&str, &str)],
        body: &[u8],
    ) -> (u16, Vec<(String, String)>, String) {
        let mut stream = TcpStream::connect(("127.0.0.1", port))
            .await
            .expect("listener must accept a connection");
        let mut request = format!(
            "{method} {path} HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Length: {}\r\nConnection: close\r\n",
            body.len()
        );
        for (name, value) in headers {
            request.push_str(&format!("{name}: {value}\r\n"));
        }
        request.push_str("\r\n");
        stream
            .write_all(request.as_bytes())
            .await
            .expect("request head must send");
        stream
            .write_all(body)
            .await
            .expect("request body must send");
        let mut response = Vec::new();
        stream
            .read_to_end(&mut response)
            .await
            .expect("a response must arrive");
        let head_end = response
            .windows(4)
            .position(|window| window == b"\r\n\r\n")
            .expect("response must carry a head/body split");
        let head = String::from_utf8_lossy(&response[..head_end]);
        let status: u16 = head
            .split_whitespace()
            .nth(1)
            .expect("status line must have a code")
            .parse()
            .expect("status code must be numeric");
        let response_headers: Vec<(String, String)> = head
            .lines()
            .skip(1)
            .filter_map(|line| {
                let (name, value) = line.split_once(':')?;
                Some((name.trim().to_ascii_lowercase(), value.trim().to_string()))
            })
            .collect();
        (
            status,
            response_headers,
            String::from_utf8_lossy(&response[head_end + 4..]).into_owned(),
        )
    }

    fn summary(store: &StoreHandle, campus: i64, session: i64) -> CaptureSummary {
        let store = store.lock().unwrap();
        store
            .capture_summary(&CaptureScope {
                campus_id: campus,
                session_id: session,
            })
            .expect("summary")
    }

    fn auth(token: &str) -> String {
        format!("Bearer {token}")
    }

    fn bind(store: StoreHandle, events: RecordingEvents) -> (CaptureListener, CaptureServer) {
        CaptureListener::bind(store, events, ()).expect("listener must bind on loopback")
    }

    fn bind_with_config<C>(
        store: StoreHandle,
        events: RecordingEvents,
        config: C,
    ) -> (CaptureListener, CaptureServer)
    where
        C: crate::adapters::remote_config::CurrentSelectorConfig,
    {
        CaptureListener::bind(store, events, config).expect("listener must bind on loopback")
    }

    fn spawn(server: CaptureServer) {
        tokio::spawn(async move { server.serve().await });
    }

    // ---------- happy path ----------

    #[tokio::test]
    async fn happy_path_stores_the_posted_fixture_and_announces_it() {
        let store = in_memory_store();
        let events = RecordingEvents::default();
        let (listener, server) = bind(store.clone(), events.clone());
        assert_eq!(
            listener.addr().ip(),
            std::net::IpAddr::V4(Ipv4Addr::LOCALHOST),
            "the listener is bound to 127.0.0.1 only"
        );
        spawn(server);

        let (status, body) = raw_request(
            listener.port(),
            "POST",
            "/capture",
            &[("Authorization", &auth(listener.token()))],
            csintsy_payload().as_bytes(),
        )
        .await;
        assert_eq!(status, 204, "success is an empty 204, body: {body}");

        let counts = summary(&store, 7, 155);
        assert_eq!((counts.section_count, counts.course_count), (5, 1));
        assert!(counts.can_undo, "a real batch is undoable");
        let updated = events.updated.lock().unwrap().clone();
        assert_eq!(updated.len(), 1, "exactly one capture:updated event");
        assert_eq!(
            (updated[0].section_count, updated[0].course_count),
            (5, 1),
            "the event carries the running counts"
        );
        assert!(events.failed.lock().unwrap().is_empty());
    }

    // ---------- auth ----------

    #[tokio::test]
    async fn requests_without_a_token_are_rejected_and_store_nothing() {
        let store = in_memory_store();
        let events = RecordingEvents::default();
        let (listener, server) = bind(store.clone(), events.clone());
        spawn(server);

        let (status, _) = raw_request(
            listener.port(),
            "POST",
            "/capture",
            &[],
            csintsy_payload().as_bytes(),
        )
        .await;
        assert_eq!(status, 401, "a request without a token is rejected");

        let counts = summary(&store, 7, 155);
        assert_eq!((counts.section_count, counts.course_count), (0, 0));
        assert!(!counts.can_undo);
        assert!(events.updated.lock().unwrap().is_empty());
        assert!(
            events.failed.lock().unwrap().is_empty(),
            "auth failures are not announced as capture failures"
        );
    }

    #[tokio::test]
    async fn wrong_and_stale_tokens_are_rejected() {
        let store = in_memory_store();
        let (listener, server) = bind(store, RecordingEvents::default());
        spawn(server);

        let (garbage_status, _) = raw_request(
            listener.port(),
            "POST",
            "/capture",
            &[("Authorization", "Bearer not-the-token")],
            csintsy_payload().as_bytes(),
        )
        .await;
        assert_eq!(garbage_status, 401, "a wrong token is rejected");

        let (basic_status, _) = raw_request(
            listener.port(),
            "POST",
            "/capture",
            &[("Authorization", "Basic abc")],
            csintsy_payload().as_bytes(),
        )
        .await;
        assert_eq!(basic_status, 401, "a non-bearer scheme is rejected");

        // A token minted by a previous launch (another listener) is stale.
        let (stale, stale_server) = bind(in_memory_store(), RecordingEvents::default());
        spawn(stale_server);
        let (stale_status, _) = raw_request(
            listener.port(),
            "POST",
            "/capture",
            &[("Authorization", &auth(stale.token()))],
            csintsy_payload().as_bytes(),
        )
        .await;
        assert_eq!(
            stale_status, 401,
            "a stale token from another launch is rejected"
        );
    }

    // ---------- malformed payloads ----------

    #[tokio::test]
    async fn malformed_payloads_are_rejected_with_a_diagnostic_and_store_nothing() {
        let store = in_memory_store();
        let events = RecordingEvents::default();
        let (listener, server) = bind(store.clone(), events.clone());
        spawn(server);

        let (not_json_status, not_json_body) = raw_request(
            listener.port(),
            "POST",
            "/capture",
            &[("Authorization", &auth(listener.token()))],
            b"this is not json",
        )
        .await;
        assert_eq!(not_json_status, 400);
        assert!(not_json_body.contains("error"), "a diagnostic body: {not_json_body}");

        let (missing_fields_status, missing_fields_body) = raw_request(
            listener.port(),
            "POST",
            "/capture",
            &[("Authorization", &auth(listener.token()))],
            br#"{"campusId": 7}"#,
        )
        .await;
        assert_eq!(missing_fields_status, 400, "missing fields are malformed");
        assert!(
            missing_fields_body.contains("error"),
            "a diagnostic body: {missing_fields_body}"
        );

        let (unparseable_status, unparseable_body) = raw_request(
            listener.port(),
            "POST",
            "/capture",
            &[("Authorization", &auth(listener.token()))],
            payload(7, 155, 2923, "CSINTSY", "TITLE", "<html><body></body></html>")
                .as_bytes(),
        )
        .await;
        assert_eq!(unparseable_status, 422, "no results table is unparseable");
        assert!(
            unparseable_body.contains("error"),
            "a diagnostic body: {unparseable_body}"
        );

        let counts = summary(&store, 7, 155);
        assert_eq!((counts.section_count, counts.course_count), (0, 0), "nothing partial");
        assert!(!counts.can_undo);
        assert!(events.updated.lock().unwrap().is_empty());
        assert_eq!(
            events.failed.lock().unwrap().len(),
            3,
            "each rejected payload is announced as a capture failure"
        );
    }

    // ---------- dedupe ----------

    #[tokio::test]
    async fn repeat_posts_dedupe_on_the_natural_key() {
        let store = in_memory_store();
        let events = RecordingEvents::default();
        let (listener, server) = bind(store.clone(), events.clone());
        spawn(server);

        for _ in 0..2 {
            let (status, _) = raw_request(
                listener.port(),
                "POST",
                "/capture",
                &[("Authorization", &auth(listener.token()))],
                csintsy_payload().as_bytes(),
            )
            .await;
            assert_eq!(status, 204);
        }

        let counts = summary(&store, 7, 155);
        assert_eq!(
            (counts.section_count, counts.course_count),
            (5, 1),
            "the same capture twice yields the same counts"
        );
        assert_eq!(events.updated.lock().unwrap().len(), 2, "two batches, two events");
    }

    // ---------- undo ----------

    #[tokio::test]
    async fn undo_restores_the_prior_state_end_to_end() {
        let store = in_memory_store();
        let (listener, server) = bind(store.clone(), RecordingEvents::default());
        spawn(server);

        for (payload, expected) in [(csintsy_payload(), (5, 1)), (geartap_payload(), (47, 2))] {
            let (status, _) = raw_request(
                listener.port(),
                "POST",
                "/capture",
                &[("Authorization", &auth(listener.token()))],
                payload.as_bytes(),
            )
            .await;
            assert_eq!(status, 204);
            let counts = summary(&store, 7, 155);
            assert_eq!((counts.section_count, counts.course_count), expected);
        }

        let undone = store
            .lock()
            .unwrap()
            .undo_last_capture()
            .expect("undo must succeed");
        assert!(undone);
        let counts = summary(&store, 7, 155);
        assert_eq!(
            (counts.section_count, counts.course_count),
            (5, 1),
            "the most recent batch is reversed, the earlier one survives"
        );
        assert!(!counts.can_undo, "undo consumes the batch");

        let again = store
            .lock()
            .unwrap()
            .undo_last_capture()
            .expect("undo with nothing to undo is safe");
        assert!(!again, "there is nothing left to undo");
        let counts = summary(&store, 7, 155);
        assert_eq!((counts.section_count, counts.course_count), (5, 1));
    }

    // ---------- the loaded selector config drives parsing (ticket 18) ----------

    /// A provider serving one fixed, non-default config: a results table
    /// under a different id, as a renamed remote document would carry.
    #[derive(Clone)]
    struct FixedConfig(crate::core::parser::SelectorConfig);

    impl crate::adapters::remote_config::CurrentSelectorConfig for FixedConfig {
        fn selector_config(&self) -> crate::core::parser::SelectorConfig {
            self.0.clone()
        }
    }

    fn alt_table_payload() -> String {
        let row = "<tr data-start-date=\"07/10/2026\" data-end-date=\"12/09/2026\">\
                   <td>Lecture</td><td></td><td>3</td><td>S01</td>\
                   <td>[ MONDAY - 04:15 PM - 05:45 PM : Room - A1103 ]</td>\
                   <td>45</td><td>10</td><td></td><td><button>Add</button></td>\
                   <td hidden>2923</td><td hidden>384</td><td hidden></td></tr>";
        payload(
            7,
            155,
            2923,
            "CSINTSY",
            "INTRODUCTION TO INTELLIGENT SYSTEMS",
            &format!("<html><body><table id=\"altTable\"><tbody>{row}</tbody></table></body></html>"),
        )
    }

    #[tokio::test]
    async fn captures_are_parsed_with_the_loaded_selector_config_not_a_hardcoded_default() {
        let custom = crate::core::parser::SelectorConfig {
            results_table: "#altTable".into(),
            ..crate::core::parser::SelectorConfig::default()
        };
        let store = in_memory_store();
        let (listener, server) =
            bind_with_config(store.clone(), RecordingEvents::default(), FixedConfig(custom));
        spawn(server);

        let (status, _) = raw_request(
            listener.port(),
            "POST",
            "/capture",
            &[("Authorization", &auth(listener.token()))],
            alt_table_payload().as_bytes(),
        )
        .await;
        assert_eq!(
            status, 204,
            "a capture matching the loaded config parses and stores"
        );
        assert_eq!(summary(&store, 7, 155).section_count, 1);

        // The bundled-only default cannot see the renamed table.
        let other_store = in_memory_store();
        let (default_listener, default_server) =
            bind_with_config(other_store.clone(), RecordingEvents::default(), ());
        spawn(default_server);
        let (status, _) = raw_request(
            default_listener.port(),
            "POST",
            "/capture",
            &[("Authorization", &auth(default_listener.token()))],
            alt_table_payload().as_bytes(),
        )
        .await;
        assert_eq!(status, 422, "the bundled config does not know #altTable");
        assert_eq!(summary(&other_store, 7, 155).section_count, 0);
    }

    // ---------- retaining the failing fragment Rust-side (ticket 19) ----------
    //
    // A failed parse must be reportable without the raw DOM ever crossing
    // into the webview: the failure site retains the offending fragment here
    // in the adapter layer, and `build_capture_report` (which scrubs before
    // assembling) is its only reader. The announced event still carries the
    // error string alone.

    #[tokio::test]
    async fn an_unparseable_capture_retains_its_raw_fragment_rust_side() {
        let store = in_memory_store();
        let events = RecordingEvents::default();
        let (listener, server) = bind(store, events.clone());
        spawn(server);

        let hazardous = "<html><body>\
             <input type=\"hidden\" id=\"hdnStudId\" value=\"2299999\">\
             </body></html>";
        let (status, _) = raw_request(
            listener.port(),
            "POST",
            "/capture",
            &[("Authorization", &auth(listener.token()))],
            payload(7, 155, 2923, "CSINTSY", "TITLE", hazardous).as_bytes(),
        )
        .await;
        assert_eq!(status, 422);

        let announced = events.failed.lock().unwrap().clone();
        assert_eq!(announced.len(), 1);
        let retained = listener
            .retained_failures()
            .find(&announced[0])
            .expect("the announced failure must be retained");
        assert_eq!(retained.error, announced[0]);
        let fragment = retained.fragment.expect("parse failures keep their DOM");
        assert!(
            fragment.contains("hdnStudId") && fragment.contains("2299999"),
            "the fragment is retained raw for the scrubber: {fragment}"
        );
    }

    #[tokio::test]
    async fn failures_without_dom_are_retained_without_a_fragment() {
        let store = in_memory_store();
        let events = RecordingEvents::default();
        let (listener, server) = bind(store, events.clone());
        spawn(server);

        let (_, body) = raw_request(
            listener.port(),
            "POST",
            "/capture",
            &[("Authorization", &auth(listener.token()))],
            b"this is not json",
        )
        .await;

        let announced = events.failed.lock().unwrap().clone();
        assert_eq!(announced.len(), 1);
        let retained = listener
            .retained_failures()
            .find(&announced[0])
            .expect("every announced failure is reportable");
        assert!(retained.fragment.is_none(), "no DOM existed: {body}");
    }

    #[tokio::test]
    async fn a_successful_capture_retains_no_failure() {
        let store = in_memory_store();
        let (listener, server) = bind(in_memory_store(), RecordingEvents::default());
        spawn(server);
        drop(store);

        let (status, _) = raw_request(
            listener.port(),
            "POST",
            "/capture",
            &[("Authorization", &auth(listener.token()))],
            csintsy_payload().as_bytes(),
        )
        .await;
        assert_eq!(status, 204);
        assert!(listener.retained_failures().latest().is_none());
    }

    #[tokio::test]
    async fn the_announced_event_carries_only_the_error_never_the_dom() {
        let store = in_memory_store();
        let events = RecordingEvents::default();
        let (listener, server) = bind(store, events.clone());
        spawn(server);

        let (_, _) = raw_request(
            listener.port(),
            "POST",
            "/capture",
            &[("Authorization", &auth(listener.token()))],
            payload(7, 155, 2923, "CSINTSY", "TITLE", "<html><body></body></html>").as_bytes(),
        )
        .await;

        for error in events.failed.lock().unwrap().iter() {
            assert!(
                !error.contains("<html"),
                "raw DOM must not cross into the webview: {error}"
            );
        }
    }

    #[test]
    fn retention_is_bounded_so_a_long_session_cannot_grow_it_forever() {
        let failures = RetainedFailures::default();
        for index in 0..(RETAINED_FAILURE_LIMIT * 3) {
            failures.record(CapturedFailure {
                error: format!("failure {index}"),
                fragment: Some(format!("<html>{index}</html>")),
            });
        }
        assert_eq!(failures.len(), RETAINED_FAILURE_LIMIT);
        // The newest survive, the oldest are dropped.
        assert!(failures.find("failure 0").is_none());
        assert!(failures.find("failure 23").is_some());
    }

    #[test]
    fn finding_matches_the_most_recent_failure_with_that_error() {
        let failures = RetainedFailures::default();
        failures.record(CapturedFailure { error: "same".into(), fragment: Some("first".into()) });
        failures.record(CapturedFailure { error: "other".into(), fragment: None });
        failures.record(CapturedFailure { error: "same".into(), fragment: Some("second".into()) });
        assert_eq!(
            failures.find("same").expect("found").fragment.as_deref(),
            Some("second")
        );
    }

    #[test]
    fn unknown_errors_find_nothing() {
        let failures = RetainedFailures::default();
        assert!(failures.find("nothing recorded").is_none());
    }

    // ---------- the single route ----------

    #[tokio::test]
    async fn no_route_other_than_the_capture_write_exists() {
        let store = in_memory_store();
        let (listener, server) = bind(store, RecordingEvents::default());
        spawn(server);

        let (get_status, _) = raw_request(listener.port(), "GET", "/capture", &[], b"").await;
        assert_eq!(get_status, 405, "the write route answers GET with method-not-allowed");

        for path in ["/", "/health", "/sections", "/capture/summary", "/status"] {
            let (status, body) = raw_request(listener.port(), "GET", path, &[], b"").await;
            assert_eq!(status, 404, "no read route at {path}");
            assert!(!body.contains("section"), "no state leaks from a 404 at {path}: {body}");
        }
    }

    // ---------- fresh per launch ----------

    #[tokio::test]
    async fn tokens_and_ports_are_fresh_per_listener() {
        let (a, a_server) = bind(in_memory_store(), RecordingEvents::default());
        spawn(a_server);
        let (b, b_server) = bind(in_memory_store(), RecordingEvents::default());
        spawn(b_server);

        assert_ne!(a.token(), b.token(), "each launch mints its own token");
        assert_ne!(a.port(), b.port(), "each launch binds its own random port");
    }

    // ---------- cross-origin capture from the popup (ticket 10) ----------
    //
    // The injected script fetches the loopback endpoint from
    // https://archershub.dlsu.edu.ph, so every fetch is cross-origin: the
    // browser preflights the POST (Authorization + JSON content type) and
    // requires CORS headers on the real response. The token remains the
    // only authorization boundary.

    const HUB_ORIGIN: &str = "https://archershub.dlsu.edu.ph";

    fn response_header<'a>(headers: &'a [(String, String)], name: &str) -> Option<&'a str> {
        headers
            .iter()
            .find(|(key, _)| key.eq_ignore_ascii_case(name))
            .map(|(_, value)| value.as_str())
    }

    #[tokio::test]
    async fn preflight_from_the_popup_is_answered() {
        let store = in_memory_store();
        let (listener, server) = bind(store, RecordingEvents::default());
        spawn(server);

        let (status, headers, _) = raw_request_full(
            listener.port(),
            "OPTIONS",
            "/capture",
            &[
                ("Origin", HUB_ORIGIN),
                ("Access-Control-Request-Method", "POST"),
                (
                    "Access-Control-Request-Headers",
                    "authorization, content-type",
                ),
            ],
            b"",
        )
        .await;

        assert_eq!(status, 204, "the preflight is answered with an empty 204");
        assert_eq!(
            response_header(&headers, "access-control-allow-origin"),
            Some(HUB_ORIGIN),
            "the popup origin is allowed: {headers:?}"
        );
        let methods = response_header(&headers, "access-control-allow-methods")
            .expect("preflight must allow methods");
        assert!(methods.contains("POST"), "methods: {methods}");
        let allowed = response_header(&headers, "access-control-allow-headers")
            .expect("preflight must allow headers")
            .to_ascii_lowercase();
        assert!(
            allowed.contains("authorization"),
            "the bearer header must be allowed: {allowed}"
        );
        assert!(
            allowed.contains("content-type"),
            "the JSON content type must be allowed: {allowed}"
        );
    }

    #[tokio::test]
    async fn post_responses_echo_the_origin_so_the_script_can_read_them() {
        let store = in_memory_store();
        let events = RecordingEvents::default();
        let (listener, server) = bind(store.clone(), events.clone());
        spawn(server);

        let (status, headers, _) = raw_request_full(
            listener.port(),
            "POST",
            "/capture",
            &[
                ("Origin", HUB_ORIGIN),
                ("Authorization", &auth(listener.token())),
            ],
            csintsy_payload().as_bytes(),
        )
        .await;
        assert_eq!(status, 204);
        assert_eq!(
            response_header(&headers, "access-control-allow-origin"),
            Some(HUB_ORIGIN),
            "a successful post must carry the allow-origin header: {headers:?}"
        );

        let (rejected_status, rejected_headers, _) = raw_request_full(
            listener.port(),
            "POST",
            "/capture",
            &[("Origin", HUB_ORIGIN)],
            csintsy_payload().as_bytes(),
        )
        .await;
        assert_eq!(rejected_status, 401, "an untokenized post is still rejected");
        assert_eq!(
            response_header(&rejected_headers, "access-control-allow-origin"),
            Some(HUB_ORIGIN),
            "rejections are also readable by the script: {rejected_headers:?}"
        );
    }

    #[tokio::test]
    async fn preflight_grants_no_routes_beyond_the_capture_write() {
        let store = in_memory_store();
        let (listener, server) = bind(store, RecordingEvents::default());
        spawn(server);

        for path in ["/", "/health", "/capture/summary"] {
            let (status, _, _) = raw_request_full(
                listener.port(),
                "OPTIONS",
                path,
                &[("Origin", HUB_ORIGIN)],
                b"",
            )
            .await;
            assert_eq!(status, 404, "no preflight route at {path}");
        }
    }
}

