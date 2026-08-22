import { invoke } from "@tauri-apps/api/core";

export function getAppVersion(): Promise<string> {
  return invoke<string>("get_app_version");
}
