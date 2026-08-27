/**
 * Ranking the professors of one course (ticket 49).
 *
 * A drill-down, not a fourth tool: the student goes here from a course row in
 * the Capture tab and comes back to it. Ticket 46 settled that the week grid
 * sits in the same place at the same size on every *tab*, so this is not one
 * — it takes the whole workspace width instead, which is more room than
 * displacing the grid would have given it.
 *
 * One list, read in three zones. Where a professor sits is what they mean, so
 * ranking, re-ordering, avoiding, and un-avoiding are all the same gesture:
 * a drag. In particular, an avoided professor comes back to neutral in one
 * move — "actually I do not mind them" is common, and delete-then-re-add
 * would charge the student twice for changing their mind.
 *
 * Keyboard reordering is a first-class path, not a fallback: the keyboard
 * sensor is wired, the zones are real lists, and every move is announced in
 * a live region.
 */

import { useState } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowLeft, GripVertical } from "lucide-react";

import { Button } from "./ui/button";
import { Skeleton } from "./ui/skeleton";
import { Alert, AlertTitle, AlertDescription } from "./ui/alert";
import type { RankingEntry, RankingZone } from "../core/professorRanking";
import {
  INACTIVE_PROFESSOR_LABEL,
  formatMoveAnnouncement,
  formatNoRankableProfessors,
  moveProfessor,
} from "../core/professorRanking";

export interface ProfessorRankingProps {
  courseCode: string;
  courseTitle: string;
  /** The one list, already in zone order (`buildRankingList`). */
  entries: RankingEntry[];
  /** Section codes for the ids a rankable professor carries. */
  sectionCodesById?: Record<number, string>;
  isLoading?: boolean;
  isSaving?: boolean;
  error?: string | null;
  /**
   * Test seam for the live region. The suite renders to static markup and
   * cannot drag, so what a move announces is otherwise unassertable.
   */
  initialAnnouncement?: string;
  onMove: (key: string, zone: RankingZone, index: number) => void;
  onBack: () => void;
}

interface ZoneInfo {
  zone: RankingZone;
  label: string;
  description: string;
  /** What an empty zone says — which is also its drop target. */
  empty: string;
}

const ZONE_INFOS: readonly ZoneInfo[] = [
  {
    zone: "ranked",
    label: "Ranked",
    description:
      "Rank 1 is the professor you most want. Drag to reorder; the numbers follow.",
    empty: "Drag a professor here to rank them.",
  },
  {
    zone: "neutral",
    label: "Not ranked",
    description: "Neither wanted nor avoided. A solve treats these as neutral.",
    empty: "Every professor of this course is either ranked or avoided.",
  },
  {
    zone: "avoided",
    label: "Avoided",
    description:
      "A solve drops every section these professors are listed on, and says so when that empties the course.",
    empty: "Drag a professor here to refuse their sections.",
  },
] as const;

export function ProfessorRanking({
  courseCode,
  courseTitle,
  entries,
  sectionCodesById = {},
  isLoading = false,
  isSaving = false,
  error = null,
  initialAnnouncement = "",
  onMove,
  onBack,
}: ProfessorRankingProps) {
  const [announcement, setAnnouncement] = useState(initialAnnouncement);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const inZone = (zone: RankingZone) => entries.filter((entry) => entry.zone === zone);

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over) {
      return;
    }
    const key = String(active.id);
    const overId = String(over.id);

    let zone: RankingZone;
    let index: number;

    if (overId.startsWith("zone:")) {
      zone = overId.slice("zone:".length) as RankingZone;
      index = entries.filter((entry) => entry.zone === zone && entry.key !== key).length;
    } else {
      const target = entries.find((entry) => entry.key === overId);
      if (!target || target.key === key) {
        return;
      }
      zone = target.zone;
      const rest = entries.filter((entry) => entry.zone === zone && entry.key !== key);
      const at = rest.findIndex((entry) => entry.key === overId);
      index = at === -1 ? rest.length : at;
    }

    // The announcement is computed from what the move *will* produce, so the
    // live region never lags a frame behind the numbers on screen.
    setAnnouncement(formatMoveAnnouncement(moveProfessor(entries, key, zone, index), key));
    onMove(key, zone, index);
  };

  return (
    <div data-testid="professor-ranking" className="w-full space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-bold text-foreground">
            Rank the professors of {courseCode}
          </h3>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
            {courseTitle} · A ranking is per course, because a student takes one
            section of it. Ranked professors are wanted; avoided professors are
            refused. Everyone else is neutral.
          </p>
        </div>

        {/* The explicit way back. Leaving returns to the Capture tab, on the
            course this was entered from. */}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onBack}
          className="h-8 shrink-0 gap-1.5 text-xs"
          data-testid="professor-ranking-back"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Back to Capture</span>
        </Button>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTitle>Unable to save this ranking</AlertTitle>
          <AlertDescription className="font-mono text-xs break-all">
            {error}
          </AlertDescription>
        </Alert>
      )}

      {/* Every move is announced, because the keyboard path is a real path. */}
      <p
        data-testid="professor-ranking-announcement"
        role="status"
        aria-live="polite"
        className="sr-only"
      >
        {announcement}
      </p>

      {isLoading ? (
        <div className="space-y-2" data-testid="professor-ranking-skeleton">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : entries.length === 0 ? (
        /* The normal state early in a term, not a failure: SPEC §2 recorded
           Professor empty in 42 of 42 GEARTAP rows. Name the cause and the fix
           or students report the feature as broken. */
        <p
          data-testid="professor-ranking-empty"
          className="rounded-panel border border-border bg-card p-panel text-xs leading-relaxed text-muted-foreground"
        >
          {formatNoRankableProfessors()}
        </p>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {ZONE_INFOS.map((info) => (
              <RankingZonePanel
                key={info.zone}
                info={info}
                entries={inZone(info.zone)}
                sectionCodesById={sectionCodesById}
                isSaving={isSaving}
              />
            ))}
          </div>
        </DndContext>
      )}
    </div>
  );
}

function RankingZonePanel({
  info,
  entries,
  sectionCodesById,
  isSaving,
}: {
  info: ZoneInfo;
  entries: RankingEntry[];
  sectionCodesById: Record<number, string>;
  isSaving: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `zone:${info.zone}` });

  return (
    <section
      data-testid={`ranking-zone-${info.zone}`}
      className={`rounded-panel border bg-card p-4 space-y-3 ${
        isOver ? "border-primary" : "border-border"
      }`}
      aria-label={`${info.label} professors`}
    >
      <div className="space-y-1">
        <h4 className="text-micro font-bold uppercase tracking-wider text-muted-foreground">
          {info.label} ({entries.length})
        </h4>
        <p className="text-nano leading-relaxed text-muted-foreground">
          {info.description}
        </p>
      </div>

      <SortableContext
        items={entries.map((entry) => entry.key)}
        strategy={verticalListSortingStrategy}
      >
        <ul ref={setNodeRef} className="space-y-1.5" data-zone={info.zone}>
          {entries.length === 0 ? (
            <li className="rounded-card border border-dashed border-border px-3 py-4 text-nano text-muted-foreground">
              {info.empty}
            </li>
          ) : (
            entries.map((entry) => (
              <SortableProfessor
                key={entry.key}
                entry={entry}
                sectionCodesById={sectionCodesById}
                isSaving={isSaving}
              />
            ))
          )}
        </ul>
      </SortableContext>
    </section>
  );
}

function SortableProfessor({
  entry,
  sectionCodesById,
  isSaving,
}: {
  entry: RankingEntry;
  sectionCodesById: Record<number, string>;
  isSaving: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: entry.key, disabled: isSaving });

  /* dnd-kit moves the row with its own transform, which is what makes the
     drag both smooth and cheap. It is confined to this row — never an
     ancestor of the workspace, which would become the containing block for
     the grid's fixed-positioned context menu (tickets 41, 45). */
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const sections = entry.sectionIds
    .map((id) => sectionCodesById[id])
    .filter((code): code is string => Boolean(code));

  return (
    <li
      ref={setNodeRef}
      style={style}
      data-professor-key={entry.key}
      data-zone={entry.zone}
      data-rank={entry.rank ?? ""}
      data-active={entry.active ? "true" : "false"}
      className={`flex items-start gap-2 rounded-card border px-3 py-2 ${
        entry.active ? "border-border bg-muted/40" : "border-dashed border-border bg-muted/20"
      } ${isDragging ? "opacity-60" : ""}`}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        disabled={isSaving}
        className="mt-0.5 shrink-0 cursor-grab rounded-control p-0.5 text-muted-foreground hover:text-foreground"
        aria-label={`Reorder ${entry.displayName}`}
      >
        <GripVertical className="h-4 w-4" aria-hidden="true" />
      </button>

      {entry.zone === "ranked" && (
        <span className="mt-0.5 shrink-0 rounded-pill bg-emerald-100 px-2 py-0.5 text-nano font-bold tabular-nums text-emerald-900">
          {entry.rank}
        </span>
      )}

      <div className="min-w-0 flex-1">
        <span
          className={`block text-xs font-bold ${
            entry.active ? "text-foreground" : "text-muted-foreground"
          }`}
        >
          {entry.displayName}
        </span>
        <span className="mt-0.5 block text-nano text-muted-foreground">
          {entry.active ? (
            sections.length > 0 ? (
              `Listed on ${sections.join(", ")}`
            ) : (
              "No section codes captured"
            )
          ) : (
            /* Kept, not deleted, for the same reason ADR-0008 keeps a section
               that stopped appearing: the preference is the student's work. */
            <em data-testid={`inactive-${entry.key}`} className="not-italic">
              {INACTIVE_PROFESSOR_LABEL}
            </em>
          )}
        </span>
      </div>
    </li>
  );
}
