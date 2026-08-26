import { Sparkles, X, ArrowRight } from "lucide-react";
import { Button } from "./ui/button";
import type { UpdateCheck } from "../adapters/ipc/types";
import { shouldShowUpdateNotice } from "../core/updater";

export interface UpdateNoticeProps {
  updateCheck: UpdateCheck | null;
  onOpenAbout?: () => void;
  onDismiss?: () => void;
  dismissed?: boolean;
}

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
      className="bg-emerald-50 border-b border-emerald-200/80 px-4 py-2 text-xs text-emerald-950 transition-all"
    >
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-600 text-white shrink-0 shadow-2xs">
            <Sparkles className="h-3 w-3" />
          </div>
          <span className="font-medium truncate">
            A new version of Animo Plan (<strong>v{version}</strong>) is available.
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {onOpenAbout && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onOpenAbout}
              className="h-6 px-2.5 text-[11px] font-semibold bg-white hover:bg-emerald-100/50 text-emerald-900 border-emerald-300 shadow-2xs flex items-center gap-1"
            >
              <span>View update</span>
              <ArrowRight className="h-3 w-3" />
            </Button>
          )}
          {onDismiss && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onDismiss}
              aria-label="Dismiss update notice"
              className="h-6 w-6 p-0 text-emerald-800 hover:text-emerald-950 hover:bg-emerald-200/50 rounded-full"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
