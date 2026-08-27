pub mod adapters;
pub mod core;
pub mod interface;

pub const UPDATER_ENABLED: bool = cfg!(feature = "updater");

use interface::commands::*;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default().plugin(tauri_plugin_opener::init());

    #[cfg(feature = "updater")]
    let builder = builder.plugin(tauri_plugin_updater::Builder::new().build());

    builder
        .setup(|app| {
            // The local store lives in the app data directory and survives
            // restarts; the loopback capture listener is minted per launch.
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let store = adapters::store::Store::open(
                &data_dir.join(adapters::store::DB_FILE_NAME),
            )
                .map_err(|err| format!("failed to open the local store: {err}"))?;
            let store: adapters::store::StoreHandle = std::sync::Arc::new(std::sync::Mutex::new(store));
            app.manage(store.clone());

            // The bundled selector config is live immediately; the remote
            // document (ticket 18) is fetched off the main thread and swaps
            // in only if it validates. Startup never blocks on the network
            // and the app is fully usable offline (ADR-0013). One shared
            // handle: the managed state, the fetch task, and the capture
            // listener all see the same loaded config.
            let selector_config = adapters::remote_config::SelectorConfigHandle::default();
            app.manage(selector_config.clone());
            let fetch_handle = selector_config.clone();
            tauri::async_runtime::spawn(async move {
                let loaded = adapters::remote_config::fetch_startup_config().await;
                fetch_handle.set_loaded(loaded);
            });

            // The active-refresh registration is shared by the loopback
            // listener (which routes `/capture` posts into the run) and the
            // refresh commands (which register and unregister it); one
            // instance, so routing and driving agree.
            let events = AppHandleEvents(app.handle().clone());
            let active_refresh = adapters::refresh_driver::ActiveRefreshRun::default();
            let (listener, server) = adapters::capture::CaptureListener::bind(
                store.clone(),
                events.clone(),
                selector_config.clone(),
                active_refresh.clone(),
            )
            .map_err(|err| format!("failed to start the capture listener: {err}"))?;
            app.manage(listener);
            app.manage(adapters::refresh_driver::HaltedRefreshTokens::default());
            app.manage(interface::commands::RefreshContext {
                store,
                active: active_refresh,
                halted: Default::default(),
                selector_config,
                events,
            });
            app.manage(adapters::capture_window::CaptureWindowScope::default());
            app.manage(interface::commands::SolveCancellation::default());

            // The update commands (ticket 38) sit behind the same IPC seam
            // as everything else: the plugin-backed gateway when the updater
            // feature is compiled in, and a stub that answers "unavailable"
            // otherwise — the commands exist with the same signature in both
            // configurations. The check is one of the app's static reads
            // (ADR-0017); only an explicit install_update ever installs.
            #[cfg(feature = "updater")]
            let update_gateway: adapters::update_service::SharedGateway = std::sync::Arc::new(
                adapters::update_service::PluginGateway::new(app.handle().clone()),
            );
            #[cfg(not(feature = "updater"))]
            let update_gateway: adapters::update_service::SharedGateway =
                std::sync::Arc::new(adapters::update_service::DisabledGateway);
            app.manage(interface::update::UpdateService::new(update_gateway));

            tauri::async_runtime::spawn(async move {
                server.serve().await;
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_campus_options,
            get_session_options,
            get_app_info,
            list_plans,
            create_plan,
            delete_plan,
            get_plan,
            list_captured_courses,
            list_captured_sections,
            forget_captured_course,
            set_course_included,
            add_section_to_plan,
            remove_section_from_plan,
            set_section_pinned,
            get_plan_conflicts,
            apply_solution,
            open_capture_window,
            get_capture_summary,
            clear_browser_session,
            solve_plan,
            continue_solve,
            cancel_solve,
            start_refresh,
            resume_refresh,
            get_missing_sections,
            export_plan_ics,
            build_capture_report,
            list_rankable_professors,
            get_course_preferences,
            write_course_preferences,
            interface::update::check_for_update,
            interface::update::install_update,
            interface::version::get_app_version
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use crate::UPDATER_ENABLED;

    #[test]
    fn smoke_test() {
        assert_eq!(2 + 2, 4);
    }

    #[test]
    fn updater_feature_flag_matches_compile_time_config() {
        assert_eq!(UPDATER_ENABLED, cfg!(feature = "updater"));
    }

    /// The updater being registered-but-unreachable is the exact state this
    /// app shipped in before ticket 38: the plugin loaded, no code path
    /// reaching it. The update commands must be on the invoke handler with a
    /// gateway managed behind them — in both feature configurations.
    #[test]
    fn update_commands_are_registered_with_a_gateway_behind_them() {
        let src = std::fs::read_to_string("src/lib.rs")
            .expect("lib.rs must be readable from the package root");
        // Only the production half of the file: this test module's own text
        // would otherwise satisfy every assertion.
        let production = src.split("#[cfg(test)]").next().expect("non-empty");
        for required in [
            "interface::update::check_for_update",
            "interface::update::install_update",
            "interface::update::UpdateService::new(",
            "adapters::update_service::SharedGateway",
            "PluginGateway::new(",
            "DisabledGateway",
        ] {
            assert!(
                production.contains(required),
                "lib.rs must wire {required}; an unregistered command is unreachable"
            );
        }
    }

    #[test]
    fn app_version_is_synced_between_cargo_toml_and_tauri_conf() {
        assert_eq!(cargo_package_version(), tauri_conf_version());
    }

    #[test]
    fn updater_endpoints_target_github_releases_latest_json() {
        let conf = read_tauri_conf();
        let endpoints = conf["plugins"]["updater"]["endpoints"]
            .as_array()
            .expect("plugins.updater.endpoints must be an array");
        assert!(
            endpoints.iter().any(|endpoint| {
                let endpoint = endpoint.as_str().unwrap_or_default();
                endpoint.contains("github.com")
                    && endpoint.ends_with("/releases/latest/download/latest.json")
            }),
            "at least one updater endpoint must be a GitHub Releases latest.json URL, got: {endpoints:?}"
        );
    }

    /// Config guard for ADR-0004/ADR-0017 (ticket 38): the update check is
    /// the app's third static read and must reveal nothing about the asking
    /// machine. The updater substitutes `{{current_version}}`, `{{target}}`,
    /// `{{arch}}`, and `{{bundle_type}}` into query parameters when present,
    /// so a templated or parameterised endpoint would quietly turn the check
    /// into telemetry. Pinned so a config edit cannot reintroduce it.
    #[test]
    fn updater_endpoints_are_plain_static_urls_with_no_query_or_placeholders() {
        let conf = read_tauri_conf();
        let endpoints = conf["plugins"]["updater"]["endpoints"]
            .as_array()
            .expect("plugins.updater.endpoints must be an array");
        assert!(!endpoints.is_empty(), "at least one endpoint is configured");
        for endpoint in endpoints {
            let url = reqwest::Url::parse(endpoint.as_str().expect("endpoint must be a string"))
                .expect("each updater endpoint must be a valid URL");
            assert_eq!(url.scheme(), "https", "fetched over https only: {url}");
            assert!(
                url.query().is_none(),
                "an updater endpoint must carry no query parameters: {url}"
            );
            assert!(
                !endpoint.as_str().unwrap_or_default().contains("{{"),
                "an updater endpoint must carry no template placeholders — they would \
                 be substituted into the query and reveal machine state: {url}"
            );
        }
    }

    fn read_tauri_conf() -> serde_json::Value {
        let raw = std::fs::read_to_string("tauri.conf.json")
            .expect("tauri.conf.json must be readable from the package root");
        serde_json::from_str(&raw).expect("tauri.conf.json must be valid JSON")
    }

    fn tauri_conf_version() -> String {
        read_tauri_conf()["version"]
            .as_str()
            .expect("tauri.conf.json must have a version string")
            .to_string()
    }

    fn cargo_package_version() -> String {
        let raw = std::fs::read_to_string("Cargo.toml")
            .expect("Cargo.toml must be readable from the package root");
        let mut in_package = false;
        for line in raw.lines() {
            let line = line.trim();
            if line == "[package]" {
                in_package = true;
                continue;
            }
            if in_package {
                if line.starts_with('[') {
                    break;
                }
                if let Some(version) = line.strip_prefix("version = ") {
                    return version.trim_matches('"').to_string();
                }
            }
        }
        panic!("no version key found in the [package] section of Cargo.toml");
    }
}
