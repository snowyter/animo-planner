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

use crate::adapters::store::{CaptureScope, StoreHandle};
use crate::core::ipc_types::CaptureSummary;
use crate::core::parser::{parse_results_table, CourseContext, SelectorConfig};
use axum::body::Bytes;
use axum::extract::State;
use axum::http::header::AUTHORIZATION;
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::post;
use axum::{Json, Router};
use rand::RngCore;
use serde::Deserialize;
use std::net::{Ipv4Addr, SocketAddr};
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
struct ListenerState<E> {
    store: StoreHandle,
    events: E,
    token: String,
}

/// The bound endpoint: its loopback address and the per-launch token the
/// popup (ticket 10) needs to reach it. Held in Tauri state so the capture
/// window can be opened with the right URL and token.
pub struct CaptureListener {
    addr: SocketAddr,
    token: String,
}

impl CaptureListener {
    /// Binds to `127.0.0.1` on a random free port and mints a fresh bearer
    /// token. The token lives only in memory for this launch; the address
    /// is loopback, so no other machine can reach the listener.
    ///
    /// Returns the endpoint metadata and the server to run: call
    /// `CaptureServer::serve` on the app's async runtime.
    pub fn bind<E: CaptureEvents>(
        store: StoreHandle,
        events: E,
    ) -> Result<(CaptureListener, CaptureServer), ListenerError> {
        let listener = std::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0))?;
        listener.set_nonblocking(true)?;
        let addr = listener.local_addr()?;
        let token = generate_token();
        let listener = TcpListener::from_std(listener)?;
        let state = ListenerState {
            store,
            events,
            token: token.clone(),
        };
        let app = Router::new()
            .route("/capture", post(handle_capture::<E>))
            .with_state(state);
        Ok((
            CaptureListener { addr, token },
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

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

/// Rejects the request with a diagnostic body and announces the failure.
fn reject<E: CaptureEvents>(
    state: &ListenerState<E>,
    status: StatusCode,
    message: String,
) -> Response {
    state.events.capture_failed(message.clone());
    (status, Json(serde_json::json!({ "error": message }))).into_response()
}

/// The one write route: authenticate, parse, store. Anything malformed or
/// unparseable is rejected and stores nothing; the store's single
/// transaction guarantees no partial rows on failure.
async fn handle_capture<E: CaptureEvents>(
    State(state): State<ListenerState<E>>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    match bearer_token(&headers) {
        Some(token) if tokens_match(&state.token, token) => {}
        _ => return StatusCode::UNAUTHORIZED.into_response(),
    }

    let payload: CapturePayload = match serde_json::from_slice(&body) {
        Ok(payload) => payload,
        Err(err) => {
            return reject(
                &state,
                StatusCode::BAD_REQUEST,
                format!("malformed capture payload: {err}"),
            );
        }
    };

    let context = CourseContext {
        course_id: payload.course_id,
        code: payload.course_code,
        title: payload.course_title,
    };
    let parsed = match parse_results_table(&payload.html, &context, &SelectorConfig::default()) {
        Ok(parsed) => parsed,
        Err(err) => {
            return reject(
                &state,
                StatusCode::UNPROCESSABLE_ENTITY,
                format!("unparseable capture payload: {err}"),
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
            StatusCode::UNPROCESSABLE_ENTITY,
            format!("capture produced no sections: {detail}"),
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
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("capture could not be stored: {err}"),
            );
        }
        match store.capture_summary(&scope) {
            Ok(summary) => summary,
            Err(err) => {
                return reject(
                    &state,
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("capture summary unavailable: {err}"),
                );
            }
        }
    };
    state.events.capture_updated(summary);
    StatusCode::NO_CONTENT.into_response()
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
        (
            status,
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
        CaptureListener::bind(store, events).expect("listener must bind on loopback")
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
}

