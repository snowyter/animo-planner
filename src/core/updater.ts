/**
 * Pure domain helpers for update status formatting and presentation.
 * Free of I/O and framework imports.
 */

import type { UpdateCheck, UpdateFailureReason } from "../adapters/ipc/types";

/**
 * Determines whether the quiet update notice banner should be displayed.
 * Visible only when an update is available, not dismissed, and updater is available.
 */
export function shouldShowUpdateNotice(
  check: UpdateCheck | null,
  dismissed: boolean,
): boolean {
  if (!check || dismissed) {
    return false;
  }
  return check.status === "available" && Boolean(check.availableVersion);
}

/**
 * Formats update failure reasons into quiet, non-alarming descriptions.
 * An ordinary answer suitable for inline display.
 */
export function formatUpdateFailureReason(
  reason: UpdateFailureReason | null,
): string {
  switch (reason) {
    case "network":
      return "Could not connect to update server (offline)";
    case "endpoint":
      return "Update release endpoint unavailable";
    case "malformed":
      return "Unreadable update response";
    case "signature":
      return "Update signature verification failed";
    case "unknown":
      return "Check failed (unknown reason)";
    default:
      return "Update check could not complete";
  }
}
