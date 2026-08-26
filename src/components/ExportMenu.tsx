import { useState, useRef, useEffect, useCallback } from "react";
/**
 * Two glyphs: disclosure, which no word here supplies, and the conflict mark
 * inside the exported image, which is the indicator ADR-0009 protects.
 */
import { ChevronDown, AlertTriangle } from "lucide-react";
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
        className="h-9 gap-1.5 font-medium text-xs cursor-pointer"
        aria-haspopup="true"
        aria-expanded={isOpen}
      >
        <span>{isExporting ? "Exporting..." : "Export"}</span>
        <ChevronDown className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
      </Button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div className="menu-enter absolute right-0 z-30 mt-2 w-72 origin-top-right rounded-panel border border-border bg-popover p-1.5 shadow-overlay">
          <div className="px-2.5 py-2 border-b border-border">
            <p className="text-xs font-semibold text-foreground">Export Plan</p>
            <p className="text-micro text-muted-foreground">
              Save your schedule to calendar or image
            </p>
          </div>

          <div className="py-1 space-y-0.5">
            <button
              type="button"
              onClick={handleExportIcs}
              className="flex w-full flex-col rounded-control px-2.5 py-2 text-left text-xs hover:bg-muted cursor-pointer"
            >
              <span className="font-semibold text-foreground">
                Calendar file (.ics)
              </span>
              <span className="text-micro text-muted-foreground leading-tight">
                Import into Google Calendar or Apple Calendar
              </span>
            </button>

            <button
              type="button"
              onClick={handleExportPng}
              className="flex w-full flex-col rounded-control px-2.5 py-2 text-left text-xs hover:bg-muted cursor-pointer"
            >
              <span className="font-semibold text-foreground">
                Schedule image (.png)
              </span>
              <span className="text-micro text-muted-foreground leading-tight">
                High-res image of the week grid to share in chat
              </span>
            </button>
          </div>
        </div>
      )}

      {/* Export Error Alert */}
      {errorMessage && (
        <div className="absolute right-0 top-full mt-2 w-80 z-40">
          <Alert variant="destructive" className="py-2 px-3 shadow-lifted">
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
          {/*
            Header for the exported screenshot: academic year and term as the
            title, plus the conflict indicator when there is one (ticket 44).

            Deliberately still styled in literal colours rather than design
            tokens, and deliberately free of this ticket's ambient surfaces:
            the PNG is captured out of the document, so it keeps its own
            self-describing light palette and nothing interactive or animated
            reaches it.
          */}
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
