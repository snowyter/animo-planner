#[tauri::command]
pub fn get_app_version<R: tauri::Runtime>(app: tauri::AppHandle<R>) -> String {
    app.package_info().version.to_string()
}
