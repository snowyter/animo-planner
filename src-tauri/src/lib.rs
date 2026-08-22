pub mod core;
pub mod interface;

use interface::commands::*;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
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
            build_capture_report
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    #[test]
    fn smoke_test() {
        assert_eq!(2 + 2, 4);
    }
}
