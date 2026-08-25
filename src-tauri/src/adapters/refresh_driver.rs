//! The headless refresh driver (ticket 26): the loop between the ticket-16
//! runner ([`crate::core::refresh::RefreshRun`]) and the open Archer's Hub
//! popup.
//!
//! The runner owns every decision — which course is next, whether a response
//! can be trusted, when the run halts. This module only feeds it: it drives
//! one course selection into the already-open popup (ticket 10's window,
//! select2 included), waits for the mutation observer's POST on the ticket-09
//! loopback endpoint, hands the rendered HTML back to the runner, and stores
//! what the runner trusted via [`crate::adapters::store::Store::apply_refresh`]
//! — never as an undoable capture batch.
//!
//! Routing is the other half of the seam: while a run is active for a plan's
//! scope, [`ActiveRefreshRun`] hands posted batches to the run instead of
//! letting them land in the capture journal, so an ordinary search during a
//! run cannot be mistaken for a refresh response or vice versa.
//!
//! Nothing here reads, intercepts, or stores anything about the login
//! (ADR-0002): driving a course selection is the same request the student's
//! own click makes, and no other page interaction is introduced.

use crate::adapters::capture_window::{ARCHERS_HUB_URL, CAPTURE_WINDOW_LABEL};
use crate::core::hub_pages::{classify_hub_page, HubPage, COURSE_FINDER_URL};
use crate::core::ipc_types::RefreshProgress;
use crate::core::parser::{ParsedSection, SelectorConfig};
use crate::core::refresh::{
    FetchResult, NextStep, RefreshCourse, RefreshFinish, RefreshRun, StepOutcome,
};
use std::collections::HashMap;
use std::net::{TcpStream, ToSocketAddrs};
use std::sync::mpsc::{Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{Manager, Url};

/// How long the driver waits for one course's rendered results to arrive on
/// the loopback endpoint before declaring the session expired. Long enough
/// for a slow search round trip plus the observer's debounce; short enough
/// that a closed or dead popup can never hang the run.
pub const REFRESH_RESPONSE_TIMEOUT_MS: u64 = 15_000;

/// How long the driver waits between re-evaluating the selection into a
/// popup that has not answered yet (ticket 37). A freshly navigated Course
/// Finder is not ready the instant `navigate()` returns, so the selection is
/// retried on this interval until the response lands or the step's overall
/// budget ([`REFRESH_RESPONSE_TIMEOUT_MS`]) is spent — spaced so a dead page
/// produces a handful of evals over the budget rather than a tight loop of
/// searches against the hub.
pub const SELECTION_RETRY_INTERVAL_MS: u64 = 3_000;

/// How long the connectivity probe waits for the hub host to accept a TCP
/// connection before the run is reported offline.
const ONLINE_PROBE_TIMEOUT_MS: u64 = 2_000;

/// One capture POST routed into an active refresh run: the course identity
/// the injected script read from the live dropdown at render time, and the
/// rendered results table HTML.
#[derive(Debug, Clone, PartialEq)]
pub struct RefreshBatch {
    pub course_id: i64,
    pub course_code: String,
    pub course_title: String,
    pub html: String,
}

/// Events the refresh announces to the main window. The app wires this to
/// the `refresh:progress` Tauri event (ticket 21 renders it); tests use the
/// no-op unit.
pub trait RefreshEvents: Clone + Send + Sync + 'static {
    fn refresh_progress(&self, progress: RefreshProgress);
}

impl RefreshEvents for () {
    fn refresh_progress(&self, _progress: RefreshProgress) {}
}

/// What the driver needs from the world outside the runner. Never stores
/// anything: fetching only observes the popup.
pub trait RefreshSource: Send + Sync {
    /// Whether the machine currently has network access. An offline run must
    /// do nothing at all — not even drive the popup (SPEC §4).
    fn is_online(&self) -> bool;

    /// Drives the already-open popup to select `course` and returns what the
    /// page produced: its rendered response, a dead session, or nothing.
    fn fetch(&self, course: &RefreshCourse) -> FetchResult;
}

/// What the driver does with the runner's decisions.
pub trait RefreshSink: Send + Sync {
    /// Persists one trusted step through `Store::apply_refresh` — snapshots
    /// appended, vanished sections flagged missing, never an undoable batch.
    fn persist(
        &self,
        plan_id: &str,
        course_id: i64,
        sections: &[ParsedSection],
    ) -> Result<(), String>;

    /// Announces per-course progress from the indices the runner supplies.
    fn progress(&self, course_index: usize, course_total: usize, course_code: &str);
}

/// Drives `run` course by course until it ends or halts, pacing fetches
/// roughly `step_interval` apart. Every trusted step is persisted as soon
/// as the runner accepts it, so "keeping the partial result" after a halt
/// is simply never touching what already landed. A persistence failure
/// aborts the drive with `Err` — everything stored so far stays.
pub fn drive_refresh(
    run: &mut RefreshRun,
    source: &dyn RefreshSource,
    sink: &dyn RefreshSink,
    plan_id: &str,
    config: &SelectorConfig,
    step_interval: Duration,
) -> Result<RefreshFinish, String> {
    let mut next_step_allowed = Instant::now();
    loop {
        match run.next_course() {
            NextStep::Ended { finish } => return Ok(finish),
            NextStep::Fetch {
                course,
                course_index,
                course_total,
            } => {
                let now = Instant::now();
                if next_step_allowed > now {
                    std::thread::sleep(next_step_allowed - now);
                }
                next_step_allowed = Instant::now() + step_interval;

                sink.progress(course_index, course_total, &course.code);
                let result = if source.is_online() {
                    source.fetch(course)
                } else {
                    FetchResult::Offline
                };
                match run.complete(result, config) {
                    StepOutcome::Refreshed { course_id, ref sections, .. } => {
                        sink.persist(plan_id, course_id, sections)?;
                    }
                    StepOutcome::Halted { finish } => return Ok(finish),
                }
            }
        }
    }
}

/// Rebuilds the page shape the ticket-16 runner validates from one routed
/// batch: a document whose course dropdown selects the identity the injected
/// script observed on the live render, followed by the posted results table.
///
/// The identity travels from the real DOM — the script read it off the
/// selected option at capture time — never from what the driver requested,
/// so the runner's stale-table check stays genuine: a page still showing the
/// previous course arrives carrying *that* course's id and is rejected by
/// [`crate::core::refresh`] itself, not by this module.
pub fn response_page_html(config: &SelectorConfig, batch: &RefreshBatch) -> String {
    let dropdown_id = config.course_dropdown.trim_start_matches('#');
    format!(
        "<html><body>\
         <select id=\"{dropdown_id}\">\
         <option value=\"{}\" selected>{} - {}</option>\
         </select>\
         {}\
         </body></html>",
        batch.course_id, batch.course_code, batch.course_title, batch.html
    )
}

/// A TCP probe of the hub origin: DNS resolution plus one connect attempt on
/// 443. The app's trust story is that it only talks to Archer's Hub, so the
/// offline question is asked of the hub host itself — never of some other
/// reachability oracle.
pub fn probe_online(hub_url: &str, timeout: Duration) -> bool {
    let Ok(url) = reqwest::Url::parse(hub_url) else {
        return false;
    };
    let Some(host) = url.host_str() else {
        return false;
    };
    let Ok(addrs) = (host, 443u16).to_socket_addrs() else {
        return false;
    };
    let Some(addr) = addrs.into_iter().next() else {
        return false;
    };
    TcpStream::connect_timeout(&addr, timeout).is_ok()
}

/// Shared registration of the currently active refresh run, managed as Tauri
/// state and held by both the interface commands and the loopback listener.
/// While a run is active, `/capture` routes matching posts into it instead of
/// journaling them as undoable captures.
#[derive(Clone, Default)]
pub struct ActiveRefreshRun(Arc<Mutex<Option<ActiveRun>>>);

struct ActiveRun {
    plan_id: String,
    scope: crate::adapters::store::CaptureScope,
    sender: Sender<RefreshBatch>,
}

impl ActiveRefreshRun {
    /// Registers a run for `plan_id` scoped to `scope`. Fails when another
    /// run is still active — the app drives one popup, so one run at a time.
    pub fn begin(
        &self,
        plan_id: &str,
        scope: crate::adapters::store::CaptureScope,
        sender: Sender<RefreshBatch>,
    ) -> Result<(), String> {
        let mut run = self.0.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        if run.is_some() {
            return Err("another refresh run is already active".to_string());
        }
        *run = Some(ActiveRun {
            plan_id: plan_id.to_string(),
            scope,
            sender,
        });
        Ok(())
    }

    /// Ends the run registered for `plan_id`. A run for another plan (should
    /// one ever race) is left alone.
    pub fn end(&self, plan_id: &str) {
        let mut run = self.0.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        if run.as_ref().map(|active| active.plan_id.as_str()) == Some(plan_id) {
            *run = None;
        }
    }

    /// Routes `batch` into the active run when its scope matches the plan
    /// being refreshed; `false` means the post is not a refresh response and
    /// belongs to the ordinary capture path.
    pub fn deliver(
        &self,
        scope: &crate::adapters::store::CaptureScope,
        batch: RefreshBatch,
    ) -> bool {
        let run = self.0.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        match run.as_ref() {
            Some(active) if active.scope == *scope => active.sender.send(batch).is_ok(),
            _ => false,
        }
    }

    /// The plan whose run is currently active, if any.
    pub fn active_plan_id(&self) -> Option<String> {
        self.0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .as_ref()
            .map(|active| active.plan_id.clone())
    }
}

/// Halted-run resume tokens keyed by plan id, kept only in memory for the
/// launch: `resume_refresh` takes `{ planId }` alone, so Rust remembers
/// where each plan's run stopped.
#[derive(Clone, Default)]
pub struct HaltedRefreshTokens(Arc<Mutex<HashMap<String, String>>>);

impl HaltedRefreshTokens {
    /// Remembers `token` as the point to resume `plan_id` from.
    pub fn stash(&self, plan_id: &str, token: String) {
        self.0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .insert(plan_id.to_string(), token);
    }

    /// Takes the token for `plan_id`, removing it — a resume token is spent
    /// exactly once, and completing a run discards any stale memory.
    pub fn take(&self, plan_id: &str) -> Option<String> {
        self.0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .remove(plan_id)
    }
}

/// The production [`RefreshSource`]: drives the open capture popup via
/// `eval` (the same channel the initialization script uses — no IPC is ever
/// granted to the remote origin), then waits for the observer's POST on the
/// routed channel.
pub struct LiveRefreshSource {
    app: tauri::AppHandle,
    receiver: Mutex<Receiver<RefreshBatch>>,
    selector_config: SelectorConfig,
    response_timeout: Duration,
}

impl LiveRefreshSource {
    pub fn new(app: tauri::AppHandle, receiver: Receiver<RefreshBatch>, selector_config: SelectorConfig) -> Self {
        LiveRefreshSource {
            app,
            receiver: Mutex::new(receiver),
            selector_config,
            response_timeout: Duration::from_millis(REFRESH_RESPONSE_TIMEOUT_MS),
        }
    }

    /// Which hub page the popup is showing right now. An unreadable URL
    /// counts as [`HubPage::Elsewhere`], which leads to navigation — never
    /// as a reason to skip driving.
    fn current_page(&self, window: &tauri::WebviewWindow) -> HubPage {
        window
            .url()
            .map(|url| classify_hub_page(url.as_str()))
            .unwrap_or(HubPage::Elsewhere)
    }
}

impl RefreshSource for LiveRefreshSource {
    fn is_online(&self) -> bool {
        probe_online(ARCHERS_HUB_URL, Duration::from_millis(ONLINE_PROBE_TIMEOUT_MS))
    }

    fn fetch(&self, course: &RefreshCourse) -> FetchResult {
        // A closed popup is a dead session, reported as such rather than
        // hanging: no window, no render, no response.
        let Some(window) = self.app.get_webview_window(CAPTURE_WINDOW_LABEL) else {
            return FetchResult::SessionExpired;
        };
        // Anything still buffered belongs to an earlier selection — a
        // duplicate debounce fire or the student's own search. Draining
        // before triggering this one is what makes the next batch received
        // *this course's* render (never after the eval: that could eat it).
        {
            let receiver = self
                .receiver
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            discard_stale_batches(&receiver);
        }
        let script = super::selection_script::build_selection_script(
            &self.selector_config,
            course.course_id,
        );

        // The student is not assumed to have left the popup on Course Finder
        // (ticket 37): signing in lands the hub on the Student Dashboard,
        // where the selection script's guards no-op and nothing ever renders.
        // So decide from the current URL first — a popup already on Course
        // Finder is never reloaded out from under the student, one sitting on
        // the sign-in page *is* an expired session, and anything else is
        // navigated there (a GET of a page the student opens by hand; the
        // ticket-10 initialization script runs per document, so the capture
        // observer comes back on its own). Nothing about the login is read
        // (ADR-0002): only the URL, never the page's contents or credentials.
        match self.current_page(&window) {
            HubPage::LoginPage => return FetchResult::SessionExpired,
            HubPage::Elsewhere => {
                let course_finder =
                    Url::parse(COURSE_FINDER_URL).expect("the Course Finder URL is a valid URL");
                if window.navigate(course_finder).is_err() {
                    return FetchResult::SessionExpired;
                }
            }
            HubPage::CourseFinder => {}
        }

        // A freshly navigated page is not ready when `navigate` returns, and
        // a retry against a page that is not ready stays a clean no-op: the
        // selection script's guards return before it sets the force flag. So
        // drive the selection on the retry interval until the response lands
        // or this step's overall budget — today's timeout — is spent.
        let deadline = Instant::now() + self.response_timeout;
        loop {
            if window.eval(&script).is_err() {
                return FetchResult::SessionExpired;
            }
            let slice = deadline
                .saturating_duration_since(Instant::now())
                .min(Duration::from_millis(SELECTION_RETRY_INTERVAL_MS));
            let received = {
                let receiver = self
                    .receiver
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                next_response(&receiver, slice)
            };
            match received {
                Some(batch) => {
                    return FetchResult::Page {
                        html: response_page_html(&self.selector_config, &batch),
                    };
                }
                None if Instant::now() >= deadline => return FetchResult::SessionExpired,
                None => {
                    // A navigation that got bounced to the sign-in page is a
                    // genuinely expired session — report it without burning
                    // the rest of the budget on retries that cannot render.
                    if self.current_page(&window) == HubPage::LoginPage {
                        return FetchResult::SessionExpired;
                    }
                }
            }
        }
    }
}

/// Drops every batch still queued from earlier selections, so the driver can
/// only ever consume the render triggered by its own selection.
fn discard_stale_batches(receiver: &Receiver<RefreshBatch>) {
    while receiver.try_recv().is_ok() {}
}

/// Waits up to `timeout` for the rendered response of the current selection.
/// `None` — never a panic, never an unbounded wait — on timeout or when the
/// run side went away.
fn next_response(receiver: &Receiver<RefreshBatch>, timeout: Duration) -> Option<RefreshBatch> {
    receiver.recv_timeout(timeout).ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::adapters::store::CaptureScope;
    use std::sync::mpsc::{channel, TryRecvError};
    use std::time::Duration;

    // ---------- fixtures ----------

    const PLAN: &str = "p1";
    const SCOPE: CaptureScope = CaptureScope { campus_id: 7, session_id: 155 };

    fn csintsy() -> RefreshCourse {
        RefreshCourse { course_id: 2923, code: "CSINTSY".into(), plan_section_ids: vec![384] }
    }

    fn geartap() -> RefreshCourse {
        RefreshCourse { course_id: 564, code: "GEARTAP".into(), plan_section_ids: vec![737] }
    }

    fn third() -> RefreshCourse {
        RefreshCourse { course_id: 301, code: "THIRD".into(), plan_section_ids: vec![900] }
    }

    /// One synthetic results row shaped like the real page.
    fn row(course_id: i64, section_id: i64, section_code: &str) -> String {
        format!(
            "<tr data-end-date=\"12/09/2026\" data-start-date=\"07/10/2026\">\
             <td>Lecture</td><td></td><td>3</td><td>{section_code}</td>\
             <td>[ MONDAY - 07:30 AM - 09:00 AM : Online ]</td>\
             <td>45</td><td>10</td><td></td>\
             <td><button type=\"button\">Add</button></td>\
             <td hidden>{course_id}</td><td hidden>{section_id}</td><td hidden></td>\
             </tr>"
        )
    }

    fn table(rows: &[String]) -> String {
        format!(
            "<table id=\"tblCourseSelection\"><thead><tr><th>a</th></tr></thead><tbody>{}</tbody></table>",
            rows.concat()
        )
    }

    /// A batch the injected script would post after the page rendered
    /// `course_id`'s results carrying `rows`.
    fn batch_for(course_id: i64, code: &str, rows: &[String]) -> RefreshBatch {
        RefreshBatch {
            course_id,
            course_code: code.into(),
            course_title: format!("{code} TITLE"),
            html: table(rows),
        }
    }

    /// The `FetchResult` the driver hands the runner for a rendered page:
    /// always built through `response_page_html`, exactly like production.
    fn page_of(batch: &RefreshBatch) -> FetchResult {
        page_with(&SelectorConfig::default(), batch)
    }

    /// Same, for scenarios asserting against a non-default selector config.
    fn page_with(config: &SelectorConfig, batch: &RefreshBatch) -> FetchResult {
        FetchResult::Page { html: response_page_html(config, batch) }
    }

    fn ok_page(course: &RefreshCourse, section_id: i64) -> FetchResult {
        page_of(&batch_for(
            course.course_id,
            &course.code,
            &[row(course.course_id, section_id, "S01")],
        ))
    }

    /// Source answering each fetch with the next scripted response; records
    /// which courses were driven, in order.
    struct FakeSource {
        online: std::sync::atomic::AtomicBool,
        responses: Mutex<Vec<std::collections::VecDeque<FetchResult>>>,
        driven: Mutex<Vec<i64>>,
    }

    impl FakeSource {
        fn online(responses: Vec<FetchResult>) -> Self {
            FakeSource {
                online: std::sync::atomic::AtomicBool::new(true),
                responses: Mutex::new(vec![responses.into()]),
                driven: Mutex::new(Vec::new()),
            }
        }

        fn offline() -> Self {
            FakeSource {
                online: std::sync::atomic::AtomicBool::new(false),
                responses: Mutex::new(vec![Default::default()]),
                driven: Mutex::new(Vec::new()),
            }
        }

        fn driven_courses(&self) -> Vec<i64> {
            self.driven.lock().unwrap().clone()
        }
    }

    impl RefreshSource for FakeSource {
        fn is_online(&self) -> bool {
            self.online.load(std::sync::atomic::Ordering::SeqCst)
        }

        fn fetch(&self, course: &RefreshCourse) -> FetchResult {
            self.driven.lock().unwrap().push(course.course_id);
            self.responses.lock().unwrap()[0]
                .pop_front()
                .unwrap_or(FetchResult::SessionExpired)
        }
    }

    /// Sink recording what was persisted and announced.
    #[derive(Default)]
    struct RecordingSink {
        persisted: Mutex<Vec<(String, i64, Vec<i64>)>>,
        progress: Mutex<Vec<(usize, usize, String)>>,
        fail_on: Mutex<Option<i64>>,
    }

    impl RecordingSink {
        fn persisted(&self) -> Vec<(String, i64, Vec<i64>)> {
            self.persisted.lock().unwrap().clone()
        }

        fn progress(&self) -> Vec<(usize, usize, String)> {
            self.progress.lock().unwrap().clone()
        }
    }

    impl RefreshSink for RecordingSink {
        fn persist(
            &self,
            plan_id: &str,
            course_id: i64,
            sections: &[ParsedSection],
        ) -> Result<(), String> {
            if *self.fail_on.lock().unwrap() == Some(course_id) {
                return Err("db exploded".into());
            }
            self.persisted.lock().unwrap().push((
                plan_id.to_string(),
                course_id,
                sections.iter().map(|section| section.section_id).collect(),
            ));
            Ok(())
        }

        fn progress(&self, course_index: usize, course_total: usize, course_code: &str) {
            self.progress
                .lock()
                .unwrap()
                .push((course_index, course_total, course_code.to_string()));
        }
    }

    fn drive(
        courses: Vec<RefreshCourse>,
        source: &FakeSource,
        sink: &RecordingSink,
    ) -> Result<RefreshFinish, String> {
        let mut run = RefreshRun::start(courses);
        drive_refresh(
            &mut run,
            source,
            sink,
            PLAN,
            &SelectorConfig::default(),
            Duration::ZERO,
        )
    }

    // ---------- clean full run ----------

    #[test]
    fn a_clean_full_run_drives_each_plan_course_once_and_persists_every_trusted_step() {
        let source = FakeSource::online(vec![
            ok_page(&csintsy(), 384),
            ok_page(&geartap(), 737),
        ]);
        let sink = RecordingSink::default();

        let finish = drive(vec![csintsy(), geartap()], &source, &sink).expect("the run completes");

        assert_eq!(finish.outcome.status, crate::core::ipc_types::RefreshStatus::Complete);
        assert_eq!(finish.outcome.refreshed_courses, 2);
        assert_eq!(finish.outcome.total_courses, 2);
        assert_eq!(finish.outcome.halted_after_course_code, None);
        assert_eq!(finish.resume_token, None, "a complete run has nothing to resume");

        assert_eq!(source.driven_courses(), vec![2923, 564], "each course is driven once");
        assert_eq!(
            sink.persisted(),
            vec![
                (PLAN.to_string(), 2923, vec![384]),
                (PLAN.to_string(), 564, vec![737]),
            ],
            "every trusted step is stored under the plan being refreshed"
        );
        assert_eq!(
            sink.progress(),
            vec![
                (0, 2, "CSINTSY".to_string()),
                (1, 2, "GEARTAP".to_string()),
            ],
            "progress fires once per course from the runner's indices"
        );
    }

    // ---------- wrong-course response ----------

    #[test]
    fn a_response_for_the_wrong_course_is_discarded_by_the_runner_and_stored_nowhere() {
        // The driver requested CSINTSY but the page still shows GEARTAP —
        // the stale-but-present failure mode. The driver hands the HTML over
        // untouched; the runner rejects it.
        let source = FakeSource::online(vec![page_of(&batch_for(
            564,
            "GEARTAP",
            &[row(564, 737, "Y11")],
        ))]);
        let sink = RecordingSink::default();

        let finish = drive(vec![csintsy()], &source, &sink).expect("the run halts, not errors");

        assert_eq!(
            finish.outcome.status,
            crate::core::ipc_types::RefreshStatus::SessionExpired
        );
        assert_eq!(finish.outcome.refreshed_courses, 0);
        assert!(
            sink.persisted().is_empty(),
            "a discarded response reaches no store path"
        );
        assert_eq!(sink.progress(), vec![(0, 1, "CSINTSY".to_string())]);
        assert!(finish.resume_token.is_some(), "a halted run stays resumable");
    }

    // ---------- mid-run expiry keeps the partial result ----------

    #[test]
    fn mid_run_expiry_keeps_everything_already_persisted_and_halts_with_a_token() {
        let source = FakeSource::online(vec![
            ok_page(&csintsy(), 384),
            ok_page(&geartap(), 737),
            FetchResult::SessionExpired,
        ]);
        let sink = RecordingSink::default();

        let finish =
            drive(vec![csintsy(), geartap(), third()], &source, &sink).expect("the run halts");

        assert_eq!(
            finish.outcome.status,
            crate::core::ipc_types::RefreshStatus::SessionExpired
        );
        assert_eq!(finish.outcome.refreshed_courses, 2, "the partial result is kept");
        assert_eq!(
            finish.outcome.halted_after_course_code.as_deref(),
            Some("GEARTAP")
        );
        assert_eq!(source.driven_courses(), vec![2923, 564, 301]);
        assert_eq!(sink.persisted().len(), 2, "what landed stays landed");
        assert_eq!(sink.progress().len(), 3, "progress fired for every attempted course");
        let token = finish.resume_token.expect("a halted run mints a resume token");
        assert!(RefreshRun::from_token(&token).is_ok(), "the token resumes");
    }

    // ---------- resume continues, never restarts ----------

    #[test]
    fn resuming_a_halted_run_continues_from_the_halted_course_not_the_beginning() {
        // First attempt: two courses land, the third halts.
        let source = FakeSource::online(vec![
            ok_page(&csintsy(), 384),
            ok_page(&geartap(), 737),
            FetchResult::SessionExpired,
        ]);
        let sink = RecordingSink::default();
        let halted = drive(vec![csintsy(), geartap(), third()], &source, &sink).expect("halt");
        let token = halted.resume_token.expect("token");

        // Resume: only the halted course is re-attempted, at its original index.
        let resumed_source = FakeSource::online(vec![ok_page(&third(), 900)]);
        let resumed_sink = RecordingSink::default();
        let mut resumed_run = RefreshRun::from_token(&token).expect("the token rebuilds the run");
        let finish = drive_refresh(
            &mut resumed_run,
            &resumed_source,
            &resumed_sink,
            PLAN,
            &SelectorConfig::default(),
            Duration::ZERO,
        )
        .expect("the resumed run completes");

        assert_eq!(finish.outcome.status, crate::core::ipc_types::RefreshStatus::Complete);
        assert_eq!(finish.outcome.refreshed_courses, 3);
        assert_eq!(finish.resume_token, None);
        assert_eq!(
            resumed_source.driven_courses(),
            vec![301],
            "resume continues; the refreshed courses are not re-driven"
        );
        assert_eq!(
            resumed_sink.persisted(),
            vec![(PLAN.to_string(), 301, vec![900])],
            "only the remaining course is stored again"
        );
        assert_eq!(
            resumed_sink.progress(),
            vec![(2, 3, "THIRD".to_string())],
            "progress continues from where the run stopped"
        );
    }

    // ---------- offline ----------

    #[test]
    fn offline_does_nothing_at_all_writes_nothing_and_says_so() {
        let source = FakeSource::offline();
        let sink = RecordingSink::default();

        let finish = drive(vec![csintsy(), geartap()], &source, &sink).expect("the run reports");

        assert_eq!(finish.outcome.status, crate::core::ipc_types::RefreshStatus::Offline);
        assert_eq!(finish.outcome.refreshed_courses, 0, "nothing was fetched");
        assert_eq!(
            source.driven_courses(),
            Vec::<i64>::new(),
            "an offline run does not even drive the popup"
        );
        assert!(sink.persisted().is_empty(), "nothing stored, no partial writes");
        assert_eq!(sink.progress().len(), 1, "the first course is still announced");
    }

    // ---------- persistence failure ----------

    #[test]
    fn a_persistence_failure_aborts_the_drive_but_keeps_what_already_landed() {
        let source = FakeSource::online(vec![
            ok_page(&csintsy(), 384),
            ok_page(&geartap(), 737),
        ]);
        let sink = RecordingSink::default();
        *sink.fail_on.lock().unwrap() = Some(564);

        let err = drive(vec![csintsy(), geartap()], &source, &sink).expect_err("aborts loudly");
        assert!(err.contains("db exploded"), "got: {err}");
        assert_eq!(
            sink.persisted(),
            vec![(PLAN.to_string(), 2923, vec![384])],
            "the first step stays stored"
        );
    }

    // ---------- pacing ----------

    #[test]
    fn fetches_are_paced_step_interval_apart_and_never_before_the_first() {
        let source = FakeSource::online(vec![
            ok_page(&csintsy(), 384),
            ok_page(&geartap(), 737),
        ]);
        let sink = RecordingSink::default();

        let started = Instant::now();
        let mut run = RefreshRun::start(vec![csintsy(), geartap()]);
        drive_refresh(
            &mut run,
            &source,
            &sink,
            PLAN,
            &SelectorConfig::default(),
            Duration::from_millis(40),
        )
        .expect("completes");
        let elapsed = started.elapsed();

        assert!(
            elapsed >= Duration::from_millis(40),
            "two fetches are one interval apart (start to start): {elapsed:?}"
        );
        assert!(
            elapsed < Duration::from_millis(2_000),
            "the pacing is the interval, not a fixed sleep: {elapsed:?}"
        );
    }

    // ---------- response_page_html ----------

    #[test]
    fn the_response_page_carries_the_observed_identity_in_a_dropdown_built_from_the_config() {
        let config = SelectorConfig {
            course_dropdown: "#myDropdown".into(),
            ..SelectorConfig::default()
        };
        let batch = batch_for(2923, "CSINTSY", &[row(2923, 384, "S01")]);

        let html = response_page_html(&config, &batch);

        assert!(
            html.contains("<select id=\"myDropdown\">"),
            "the dropdown id comes from the loaded selector config: {html}"
        );
        assert!(
            !html.contains("ddlSelectCourse"),
            "no default selector is hardcoded: {html}"
        );
        assert!(
            html.contains("<option value=\"2923\" selected>CSINTSY - CSINTSY TITLE</option>"),
            "the observed identity is the selected option: {html}"
        );
        assert!(
            html.contains("tblCourseSelection"),
            "the rendered table travels verbatim: {html}"
        );

        // And the runner accepts it end-to-end: identity matches, sections parse.
        let mut run = RefreshRun::start(vec![csintsy()]);
        match run.next_course() {
            NextStep::Fetch { .. } => {}
            other => panic!("expected a fetch, got {other:?}"),
        }
        match run.complete(page_with(&config, &batch), &config) {
            StepOutcome::Refreshed { course_id, sections, missing_section_ids, .. } => {
                assert_eq!(course_id, 2923);
                assert_eq!(sections.len(), 1);
                assert_eq!(sections[0].section_code, "S01");
                assert!(
                    missing_section_ids.is_empty(),
                    "plan section 384 is present in the fresh results"
                );
            }
            other => panic!("a matching batch must refresh, got {other:?}"),
        }
    }

    #[test]
    fn a_batch_carrying_another_courses_identity_is_rejected_by_the_runner_end_to_end() {
        let config = SelectorConfig::default();
        // Requested CSINTSY; the observed page still shows GEARTAP.
        let stale = batch_for(564, "GEARTAP", &[row(564, 737, "Y11")]);
        let mut run = RefreshRun::start(vec![csintsy()]);
        match run.next_course() {
            NextStep::Fetch { .. } => {}
            other => panic!("expected a fetch, got {other:?}"),
        }
        match run.complete(page_of(&stale), &config) {
            StepOutcome::Halted { finish } => {
                assert_eq!(finish.outcome.refreshed_courses, 0, "stored nowhere");
            }
            other => panic!("a stale identity must halt, got {other:?}"),
        }
    }

    // ---------- ActiveRefreshRun ----------

    #[test]
    fn a_post_matching_the_active_runs_scope_is_delivered_to_the_run() {
        let active = ActiveRefreshRun::default();
        let (sender, receiver) = channel::<RefreshBatch>();
        active.begin(PLAN, SCOPE, sender).expect("registers");

        assert_eq!(active.active_plan_id().as_deref(), Some(PLAN));

        let batch = batch_for(2923, "CSINTSY", &[row(2923, 384, "S01")]);
        assert!(
            active.deliver(&SCOPE, batch.clone()),
            "a matching scope routes into the run"
        );
        assert_eq!(receiver.recv_timeout(Duration::from_millis(100)).ok().as_ref(), Some(&batch));
    }

    #[test]
    fn a_post_outside_the_active_runs_scope_is_not_routed() {
        let active = ActiveRefreshRun::default();
        let (sender, receiver) = channel::<RefreshBatch>();
        active.begin(PLAN, SCOPE, sender).expect("registers");

        let other_scope = CaptureScope { campus_id: 8, session_id: 156 };
        assert!(
            !active.deliver(&other_scope, batch_for(999, "OTHER", &[])),
            "another term's search goes to the ordinary capture path"
        );
        assert_eq!(
            receiver.try_recv().err(),
            Some(TryRecvError::Empty),
            "nothing reached the run"
        );
    }

    #[test]
    fn ending_a_run_routes_nothing_more_and_frees_the_registration() {
        let active = ActiveRefreshRun::default();
        let (sender, receiver) = channel::<RefreshBatch>();
        active.begin(PLAN, SCOPE, sender).expect("registers");
        active.end(PLAN);

        assert_eq!(active.active_plan_id(), None);
        assert!(
            !active.deliver(&SCOPE, batch_for(2923, "CSINTSY", &[])),
            "after the run ends a late post is an ordinary capture"
        );
        drop(receiver);

        let (again, _) = channel::<RefreshBatch>();
        active.begin("p2", SCOPE, again).expect("the registration is free");
    }

    #[test]
    fn ending_under_a_different_plan_id_leaves_the_active_run_alone() {
        let active = ActiveRefreshRun::default();
        let (sender, _) = channel::<RefreshBatch>();
        active.begin(PLAN, SCOPE, sender).expect("registers");
        active.end("not-p1");
        assert_eq!(active.active_plan_id().as_deref(), Some(PLAN));
    }

    #[test]
    fn a_second_run_cannot_begin_while_one_is_active() {
        let active = ActiveRefreshRun::default();
        let (first, _) = channel::<RefreshBatch>();
        active.begin(PLAN, SCOPE, first).expect("registers");

        let (second, _) = channel::<RefreshBatch>();
        let err = active
            .begin("p2", SCOPE, second)
            .expect_err("one popup, one run at a time");
        assert!(
            err.to_lowercase().contains("already active"),
            "identifiable: {err}"
        );
    }

    // ---------- HaltedRefreshTokens ----------

    #[test]
    fn a_resume_token_is_stashed_per_plan_and_spent_exactly_once() {
        let tokens = HaltedRefreshTokens::default();
        assert!(tokens.take("p1").is_none(), "nothing stashed yet");

        tokens.stash("p1", "token-a".into());
        tokens.stash("p2", "token-b".into());
        assert_eq!(tokens.take("p1").as_deref(), Some("token-a"));
        assert!(tokens.take("p1").is_none(), "a token is spent once");

        // Completing a run clears any stale memory.
        tokens.stash("p2", "token-c".into());
        assert!(tokens.take("p2").is_some());
    }

    // ---------- stale batches from earlier selections ----------

    #[test]
    fn batches_left_over_from_earlier_selections_are_dropped_before_the_next_fetch() {
        let (sender, receiver) = channel::<RefreshBatch>();
        sender.send(batch_for(2923, "CSINTSY", &[row(2923, 384, "S01")])).expect("send");
        sender.send(batch_for(2923, "CSINTSY", &[row(2923, 385, "S02")])).expect("send");

        discard_stale_batches(&receiver);

        assert_eq!(
            receiver.try_recv().err(),
            Some(TryRecvError::Empty),
            "a late duplicate must never be consumed as the next course's response"
        );
    }

    #[test]
    fn draining_an_already_empty_channel_is_a_no_op() {
        let (sender, receiver) = channel::<RefreshBatch>();
        drop(sender);

        discard_stale_batches(&receiver);
        assert_eq!(receiver.try_recv().err(), Some(TryRecvError::Disconnected));
    }

    #[test]
    fn the_next_response_after_draining_is_this_selections_render_not_a_stale_one() {
        let (sender, receiver) = channel::<RefreshBatch>();
        let stale = batch_for(564, "GEARTAP", &[row(564, 737, "Y11")]);
        let fresh = batch_for(301, "THIRD", &[row(301, 900, "T01")]);

        // The leftover lands first; only draining before selecting THIRD
        // guarantees the driver waits for THIRD's own render.
        sender.send(stale.clone()).expect("send");
        discard_stale_batches(&receiver);
        sender.send(fresh.clone()).expect("send");

        assert_eq!(
            next_response(&receiver, Duration::from_millis(500)),
            Some(fresh)
        );
    }

    #[test]
    fn waiting_out_a_render_that_never_arrives_resolves_promptly_as_none() {
        let (sender, receiver) = channel::<RefreshBatch>();
        drop(sender);

        let started = Instant::now();
        assert_eq!(
            next_response(&receiver, Duration::ZERO),
            None,
            "a closed popup or missing render is None, not a hang"
        );
        assert!(
            started.elapsed() < Duration::from_secs(1),
            "the wait resolves immediately on a dead channel: {:?}",
            started.elapsed()
        );
    }

    // ---------- constants ----------

    #[test]
    fn the_response_timeout_bounds_a_dead_popup_without_hanging_the_run() {
        assert_eq!(REFRESH_RESPONSE_TIMEOUT_MS, 15_000);
    }

    #[test]
    fn selection_retries_are_spaced_so_a_dead_page_yields_a_handful_of_evals_not_a_tight_loop() {
        assert_eq!(SELECTION_RETRY_INTERVAL_MS, 3_000);
        let evals_over_budget = REFRESH_RESPONSE_TIMEOUT_MS / SELECTION_RETRY_INTERVAL_MS;
        assert!(
            (1..=6).contains(&evals_over_budget),
            "a dead page is re-evaluated {evals_over_budget} times over the budget"
        );
    }

    #[test]
    fn probe_online_rejects_an_unparseable_or_non_hub_url_without_panicking() {
        assert!(!probe_online("not a url", Duration::from_millis(10)));
    }
}
