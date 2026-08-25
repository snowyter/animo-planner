//! Classifying which Archer's Hub page the capture popup is showing
//! (ticket 37).
//!
//! The refresh driver must know, before it drives a selection into the
//! popup, whether the popup can even answer: on Course Finder it can, on
//! the sign-in page the session is genuinely expired, and anywhere else
//! (the Student Dashboard after a fresh sign-in, say) the driver navigates
//! to Course Finder first. The decision is made here from the URL alone,
//! as pure string logic — no Tauri types, no I/O — so it carries its own
//! tests without needing a webview.

/// Host every Archer's Hub page lives on.
pub const HUB_HOST: &str = "archershub.dlsu.edu.ph";

/// The Course Finder page the refresh driver navigates the popup to.
///
/// This is deliberately a Rust constant and **not** a [`crate::core::parser::SelectorConfig`]
/// field: `selector_config.rs` rejects any document whose field set is not
/// exactly that struct's own serialization plus `version` (ADR-0013), so
/// growing the struct would reject the currently published remote document
/// and break capture on every installed copy until that document is
/// republished. The `/53` is the nav item's id on the hub, identical across
/// both captured fixtures (SPEC §2).
pub const COURSE_FINDER_URL: &str = "https://archershub.dlsu.edu.ph/CourseFinder/index/53";

/// The login path prefix on the hub. Evidence: the fixtures carry logout
/// links to `/StudentLogin/UserLogout`, so every signed-out landing lives
/// under this controller.
const LOGIN_PATH_PREFIX: &str = "/studentlogin";

/// The path prefix of the Course Finder itself.
const COURSE_FINDER_PATH_PREFIX: &str = "/coursefinder";

/// Which page of the hub a popup URL shows, as far as driving a refresh is
/// concerned.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HubPage {
    /// The Course Finder: its dropdown exists, so a selection can be driven
    /// into the page right away.
    CourseFinder,
    /// The sign-in page: the session is genuinely expired, and no amount of
    /// retrying will render a results table.
    LoginPage,
    /// Anywhere else — the Student Dashboard after signing in, another
    /// host entirely, or something unparseable. The driver navigates to
    /// Course Finder before driving.
    Elsewhere,
}

/// Decides what a popup URL means for driving a refresh step, from the URL
/// string alone. Lenient about scheme, host case, and route case; strict
/// about the host being exactly the hub's.
pub fn classify_hub_page(url: &str) -> HubPage {
    let Some((host, path)) = split_host_and_path(url) else {
        return HubPage::Elsewhere;
    };
    if host != HUB_HOST {
        return HubPage::Elsewhere;
    }
    if path_is(&path, LOGIN_PATH_PREFIX) {
        HubPage::LoginPage
    } else if path_is(&path, COURSE_FINDER_PATH_PREFIX) {
        HubPage::CourseFinder
    } else {
        HubPage::Elsewhere
    }
}

/// Splits an absolute URL into its lowercase host (port stripped) and its
/// lowercase path (query and fragment stripped, never empty). `None` when
/// the input is not shaped like an absolute URL at all.
fn split_host_and_path(url: &str) -> Option<(String, String)> {
    let rest = url.split_once("://")?.1;
    let authority_and_rest = rest.split(['/', '?', '#']).next()?;
    if authority_and_rest.is_empty() {
        // "https:///path" or "https://" — no host to speak of.
        return None;
    }
    let authority = authority_and_rest.rsplit('@').next()?;
    let host = authority.split(':').next()?.to_lowercase();
    let path_and_more = &rest[authority_and_rest.len()..];
    let path = match path_and_more.find(['?', '#']) {
        Some(end) => &path_and_more[..end],
        None => path_and_more,
    };
    let path = if path.is_empty() { "/" } else { path };
    Some((host, path.to_lowercase()))
}

/// Whether a lowercased path *is* the given controller prefix: equal to it,
/// or one level beneath it — never merely starting with the same characters.
fn path_is(lowercased_path: &str, lowercased_prefix: &str) -> bool {
    lowercased_path == lowercased_prefix
        || lowercased_path.starts_with(&format!("{lowercased_prefix}/"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_student_dashboard_is_elsewhere_so_the_driver_must_navigate() {
        assert_eq!(
            classify_hub_page("https://archershub.dlsu.edu.ph/StudentDashboard/index/1"),
            HubPage::Elsewhere,
            "signing in lands here; a refresh from this page needs navigation"
        );
        assert_eq!(classify_hub_page("https://archershub.dlsu.edu.ph/"), HubPage::Elsewhere);
    }

    #[test]
    fn the_course_finder_is_recognized_bare_with_a_trailing_path_and_with_a_query() {
        assert_eq!(classify_hub_page("https://archershub.dlsu.edu.ph/CourseFinder"), HubPage::CourseFinder);
        assert_eq!(
            classify_hub_page("https://archershub.dlsu.edu.ph/CourseFinder/index/53"),
            HubPage::CourseFinder
        );
        assert_eq!(
            classify_hub_page("https://archershub.dlsu.edu.ph/CourseFinder/index/53?campus=7"),
            HubPage::CourseFinder,
            "a query string does not make it another page"
        );
        assert_eq!(
            classify_hub_page("HTTPS://ARCHERSHUB.DLSU.EDU.PH/CourseFinder/index/53"),
            HubPage::CourseFinder,
            "scheme and host case do not matter"
        );
    }

    #[test]
    fn the_login_page_means_an_expired_session_not_a_page_to_retry() {
        assert_eq!(
            classify_hub_page("https://archershub.dlsu.edu.ph/StudentLogin/UserLogin"),
            HubPage::LoginPage
        );
        assert_eq!(
            classify_hub_page("https://archershub.dlsu.edu.ph/StudentLogin"),
            HubPage::LoginPage
        );
        // A lookalike path segment must not read as the login controller.
        assert_eq!(
            classify_hub_page("https://archershub.dlsu.edu.ph/StudentLogin2/UserLogin"),
            HubPage::Elsewhere
        );
    }

    #[test]
    fn a_url_on_some_other_host_is_not_the_course_finder() {
        assert_eq!(
            classify_hub_page("https://example.com/CourseFinder/index/53"),
            HubPage::Elsewhere,
            "the page identity lives in the host too, not just the path"
        );
        assert_eq!(
            classify_hub_page("https://archershub.dlsu.edu.ph.evil.test/CourseFinder/index/53"),
            HubPage::Elsewhere,
            "a host merely containing the hub host is not the hub"
        );
    }

    #[test]
    fn the_navigation_constant_is_https_on_the_hub_and_classifies_as_the_course_finder() {
        assert!(
            COURSE_FINDER_URL.starts_with(&format!("https://{HUB_HOST}/")),
            "the driver only ever navigates the popup within the hub: {COURSE_FINDER_URL}"
        );
        assert_eq!(classify_hub_page(COURSE_FINDER_URL), HubPage::CourseFinder);
    }

    #[test]
    fn input_that_is_not_an_absolute_url_falls_back_to_elsewhere() {
        assert_eq!(classify_hub_page(""), HubPage::Elsewhere);
        assert_eq!(classify_hub_page("not a url"), HubPage::Elsewhere);
        assert_eq!(classify_hub_page("/StudentDashboard/index/1"), HubPage::Elsewhere);
    }
}
