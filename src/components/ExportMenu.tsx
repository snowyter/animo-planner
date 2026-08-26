import { useState, useRef, useEffect, useCallback } from "react";
import {
  Download,
  Calendar,
  Image as ImageIcon,
  Loader2,
  ChevronDown,
  AlertTriangle,
  AlertCircle,
} from "lucide-react";
import { toBlob } from "html-to-image";
import { Button } from "./ui/button";
import { Alert, AlertDescription } from "./ui/alert";
import { WeekGrid } from "./WeekGrid";
import { exportPlanIcs } from "../adapters/ipc/client";
import type { Conflict, IcsExport, Plan, PlanSummary } from "../adapters/ipc/types";
import { deriveExportFileName, isAbortError } from "../core/export";

export interface FileSaveOptions {
  suggestedName: string;
  blob: Blob;
  types: {
    description: string;
    accept: Record<string, string[]>;
  }[];
}

export interface ExportMenuProps {
  planSummary: PlanSummary;
  plan: Plan | null;
  conflicts?: Conflict[];
  className?: string;
  defaultOpen?: boolean;
  onExportIcs?: (planId: string) => Promise<IcsExport>;
  onSaveFile?: (options: FileSaveOptions) => Promise<void>;
  onGenerateImage?: (element: HTMLElement) => Promise<Blob | null>;
}

/**
 * Saves a file using the native file save dialog when available in modern
 * Chromium / WebView2, or falls back to an anchor download.
 */
async function defaultSaveFileWithDialog({
  suggestedName,
  blob,
  types,
}: FileSaveOptions): Promise<void> {
  if (typeof window !== "undefined" && "showSaveFilePicker" in window) {
    try {
      const showPicker = (
        window as unknown as {
          showSaveFilePicker: (options: {
            suggestedName: string;
            types: typeof types;
          }) => Promise<FileSystemFileHandle>;
        }
      ).showSaveFilePicker;

      const handle = await showPicker({
        suggestedName,
        types,
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return;
    } catch (err) {
      if (isAbortError(err)) {
        // User cancelled the file dialog - return quietly without error
        return;
      }
      throw err;
    }
  }

  // Fallback for browsers or test environments without showSaveFilePicker
  if (typeof document !== "undefined") {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = suggestedName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }
}

export function ExportMenu({
  planSummary,
  plan,
  conflicts = [],
  className = "",
  defaultOpen = false,
  onExportIcs,
  onSaveFile = defaultSaveFileWithDialog,
  onGenerateImage,
}: ExportMenuProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [isExportingIcs, setIsExportingIcs] = useState(false);
  const [isExportingPng, setIsExportingPng] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const menuRef = useRef<HTMLDivElement>(null);
  const imageExportRef = useRef<HTMLDivElement>(null);

  const isExporting = isExportingIcs || isExportingPng;
  const currentSections = plan?.sections ?? [];

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  const handleExportIcs = useCallback(async () => {
    try {
      setErrorMessage(null);
      setIsExportingIcs(true);
      setIsOpen(false);

      const icsData = onExportIcs
        ? await onExportIcs(planSummary.id)
        : await exportPlanIcs({ planId: planSummary.id });

      const suggestedName = deriveExportFileName(
        planSummary.name,
        planSummary.sessionName,
        "ics"
      );

      const blob = new Blob([icsData.contents], {
        type: "text/calendar;charset=utf-8",
      });

      await onSaveFile({
        suggestedName,
        blob,
        types: [
          {
            description: "iCalendar File (.ics)",
            accept: { "text/calendar": [".ics"] },
          },
        ],
      });
    } catch (err) {
      if (!isAbortError(err)) {
        setErrorMessage(
          err instanceof Error
            ? err.message
            : "Failed to export calendar file. Please try again."
        );
      }
    } finally {
      setIsExportingIcs(false);
    }
  }, [onExportIcs, planSummary, onSaveFile]);

  const handleExportPng = useCallback(async () => {
    try {
      setErrorMessage(null);
      setIsExportingPng(true);
      setIsOpen(false);

      const container = imageExportRef.current;
      if (!container) {
        throw new Error("Export canvas element not found");
      }

      const blob = onGenerateImage
        ? await onGenerateImage(container)
        : await toBlob(container, {
            pixelRatio: 2,
            backgroundColor: "#ffffff",
            cacheBust: true,
          });

      if (!blob) {
        throw new Error("Failed to generate image data");
      }

      const suggestedName = deriveExportFileName(
        planSummary.name,
        planSummary.sessionName,
        "png"
      );

      await onSaveFile({
        suggestedName,
        blob,
        types: [
          {
            description: "PNG Image (.png)",
            accept: { "image/png": [".png"] },
          },
        ],
      });
    } catch (err) {
      if (!isAbortError(err)) {
        setErrorMessage(
          err instanceof Error
            ? err.message
            : "Failed to export schedule image. Please try again."
        );
      }
    } finally {
      setIsExportingPng(false);
    }
  }, [onGenerateImage, planSummary, onSaveFile]);

  return (
    <div className={`relative inline-block text-left ${className}`} ref={menuRef}>
      {/* Export Menu Trigger Button */}
      <Button
        variant="outline"
        size="sm"
        disabled={isExporting}
        onClick={() => setIsOpen((prev) => !prev)}
        className="h-9 gap-1.5 bg-white hover:bg-slate-50 text-slate-800 border-slate-200 shadow-2xs font-medium text-xs cursor-pointer"
        aria-haspopup="true"
        aria-expanded={isOpen}
      >
        {isExporting ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-600" />
        ) : (
          <Download className="h-3.5 w-3.5 text-slate-600" />
        )}
        <span>Export</span>
        <ChevronDown className="h-3 w-3 text-slate-400 ml-0.5" />
      </Button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div className="absolute right-0 z-30 mt-2 w-72 origin-top-right rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg ring-1 ring-black/5 focus:outline-none animate-in fade-in-0 zoom-in-95">
          <div className="px-2.5 py-2 border-b border-slate-100">
            <p className="text-xs font-semibold text-slate-900">Export Plan</p>
            <p className="text-[11px] text-slate-500">
              Save your schedule to calendar or image
            </p>
          </div>

          <div className="py-1 space-y-0.5">
            <button
              type="button"
              onClick={handleExportIcs}
              className="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs transition-colors hover:bg-slate-50 active:bg-slate-100 cursor-pointer"
            >
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-emerald-50 text-emerald-700 mt-0.5">
                <Calendar className="h-3.5 w-3.5" />
              </div>
              <div className="flex-1">
                <div className="font-semibold text-slate-800">
                  Calendar file (.ics)
                </div>
                <div className="text-[11px] text-slate-500 leading-tight">
                  Import into Google Calendar or Apple Calendar
                </div>
              </div>
            </button>

            <button
              type="button"
              onClick={handleExportPng}
              className="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs transition-colors hover:bg-slate-50 active:bg-slate-100 cursor-pointer"
            >
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-blue-50 text-blue-700 mt-0.5">
                <ImageIcon className="h-3.5 w-3.5" />
              </div>
              <div className="flex-1">
                <div className="font-semibold text-slate-800">
                  Schedule image (.png)
                </div>
                <div className="text-[11px] text-slate-500 leading-tight">
                  High-res image of the week grid to share in chat
                </div>
              </div>
            </button>
          </div>
        </div>
      )}

      {/* Export Error Alert */}
      {errorMessage && (
        <div className="absolute right-0 top-full mt-2 w-80 z-40">
          <Alert variant="destructive" className="py-2 px-3 shadow-md bg-red-50 text-red-900 border-red-200">
            <AlertCircle className="h-4 w-4 text-red-600" />
            <AlertDescription className="text-xs flex items-center justify-between">
              <span>{errorMessage}</span>
              <button
                type="button"
                onClick={() => setErrorMessage(null)}
                className="ml-2 text-xs font-semibold underline text-red-700 hover:text-red-900"
              >
                Dismiss
              </button>
            </AlertDescription>
          </Alert>
        </div>
      )}

      {/*
        Wrapper carrying the off-screen positioning to keep the export tree laid out
        and measurable without appearing on screen or in the accessibility tree (TICKET-40).
      */}
      <div
        data-testid="export-wrapper"
        style={{
          position: "fixed",
          left: "-9999px",
          top: 0,
          zIndex: -100,
          pointerEvents: "none",
        }}
        aria-hidden="true"
      >
        {/*
          Self-describing container for high-res PNG export (SPEC §7, Ticket 22, Ticket 40).
          Fixed at 1200px width and explicit light-theme styling to ensure the full Mon–Sat
          week grid and all labels render cleanly and self-describing regardless of current theme.
          Statically positioned so cloned computed styles stay within foreignObject frame.
        */}
        <div
          ref={imageExportRef}
          data-testid="export-canvas"
          style={{
            width: "1200px",
            backgroundColor: "#ffffff",
            color: "#0f172a",
          }}
          className="p-8 space-y-5 bg-white text-slate-900 font-sans"
        >
          {/* Header for Exported Screenshot: Academic year and term as title, brief conflict indicator if any (Ticket 44) */}
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              {planSummary.sessionName}
            </h1>
            {conflicts.length > 0 && (
              <div className="flex items-center gap-1.5 text-sm font-semibold text-red-600">
                <AlertTriangle className="h-4 w-4" />
                <span>
                  {conflicts.length} {conflicts.length === 1 ? "conflict" : "conflicts"}
                </span>
              </div>
            )}
          </div>

          {/* Full Week Grid with full Mon–Sat columns */}
          <WeekGrid
            sections={currentSections}
            conflicts={conflicts}
            interactive={false}
          />
        </div>
      </div>
    </div>
  );
}
