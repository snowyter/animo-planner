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

            let (listener, server) = adapters::capture::CaptureListener::bind(
                store,
                AppHandleEvents(app.handle().clone()),
            )
            .map_err(|err| format!("failed to start the capture listener: {err}"))?;
            app.manage(listener);
            app.manage(adapters::capture_window::CaptureWindowScope::default());
            app.manage(interface::commands::SolveCancellation::default());
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
            seed_sample_plan,
            list_captured_courses,
            list_captured_sections,
            add_section_to_plan,
            remove_section_from_plan,
            set_section_pinned,
            get_plan_conflicts,
            apply_solution,
            open_capture_window,
            get_capture_summary,
            undo_last_capture,
            clear_browser_session,
            solve_plan,
            continue_solve,
            cancel_solve,
            start_refresh,
            resume_refresh,
            get_missing_sections,
            export_plan_ics,
            build_capture_report,
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
