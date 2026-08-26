import { Button } from "./ui/button";
import type { UpdateCheck } from "../adapters/ipc/types";
import { shouldShowUpdateNotice } from "../core/updater";

export interface UpdateNoticeProps {
  updateCheck: UpdateCheck | null;
  onOpenAbout?: () => void;
  onDismiss?: () => void;
  dismissed?: boolean;
}

/**
 * Quiet and dismissible.
 *
 * An update is never the reason a student opened this app during enlistment
 * week, so the notice is a neutral strip rather than a green banner with a
 * badge on it: one line of type, one link, one dismiss. It must not compete
 * with the plan for attention.
 */
export function UpdateNotice({
  updateCheck,
  onOpenAbout,
  onDismiss,
  dismissed = false,
}: UpdateNoticeProps) {
  if (!shouldShowUpdateNotice(updateCheck, dismissed)) {
    return null;
  }

  const version = updateCheck?.availableVersion ?? "";

  return (
    <div
      data-testid="update-notice"
      className="border-b border-border bg-muted px-4 py-2 text-micro text-muted-foreground"
    >
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
        <span className="truncate">
          A new version of Animo Plan (
          <strong className="font-semibold text-foreground">v{version}</strong>)
          is available.
        </span>

        <div className="flex items-center gap-1 shrink-0">
          {onOpenAbout && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onOpenAbout}
              className="h-6 px-2 text-micro font-semibold text-foreground"
            >
              View update
            </Button>
          )}
          {onDismiss && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onDismiss}
              aria-label="Dismiss update notice"
              className="h-6 px-2 text-micro"
            >
              Dismiss
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
