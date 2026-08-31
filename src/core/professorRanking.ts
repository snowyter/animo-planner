/**
 * The professor ranking list (ticket 49).
 *
 * A ranking is per course, and it is one ordered list read in three zones:
 * the professors you want, in order; the professors you have said nothing about;
 * and the professors you refuse. Where a professor sits is what they mean, which
 * is what keeps the model's "either a rank or an avoid, never both" legible
 * on screen and makes dragging the only gesture the surface needs.
 *
 * Zone membership, renumbering, and the copy that explains all of it are
 * decisions rather than markup, so they live here beside each other — the
 * same reason `toolPanel.ts` holds the tab identities.
 */

import type { PlanSection, RankableProfessor, ProfessorPreference } from "../adapters/ipc/types";

/** Where a professor sits in the one list, which is what the ranking means. */
export type RankingZone = "ranked" | "neutral" | "avoided";

export interface RankingEntry {
  /** The professor key: what a preference is keyed on, never displayed. */
  key: string;
  /** The verbatim name, which is what a student reads. */
  displayName: string;
  /** The sections of this course the professor is listed on, latest snapshot. */
  sectionIds: number[];
  zone: RankingZone;
  /** 1-based and contiguous inside the ranked zone; null everywhere else. */
  rank: number | null;
  /**
   * Whether the professor still appears on any of the course's latest
   * snapshots. An inactive entry is kept and shown, never dropped — a
   * preference is the student's work (ADR-0008's reasoning, one level up).
   */
  active: boolean;
}

/**
 * The one list, built from what the course currently offers and what the
 * student has already said.
 *
 * Order is the reading order of the surface: ranked first, in rank order,
 * then the untouched professors in the order the store listed them, then the
 * avoided. Ranks are renumbered from the ranked zone's own order rather than
 * trusted from storage — contiguity is the store's invariant, and this is the
 * second place that holds it rather than the only one.
 */
export function buildRankingList(
  rankable: readonly RankableProfessor[],
  preferences: readonly ProfessorPreference[]
): RankingEntry[] {
  const byKey = new Map(preferences.map((p) => [p.professorKey, p]));

  const ranked: RankingEntry[] = [];
  const neutral: RankingEntry[] = [];
  const avoided: RankingEntry[] = [];

  for (const professor of rankable) {
    const preference = byKey.get(professor.key);
    const entry: RankingEntry = {
      key: professor.key,
      displayName: professor.displayName,
      sectionIds: professor.sectionIds,
      zone: preference?.avoid ? "avoided" : preference?.rank != null ? "ranked" : "neutral",
      rank: null,
      active: true,
    };
    if (entry.zone === "ranked") {
      entry.rank = preference?.rank ?? null;
      ranked.push(entry);
    } else if (entry.zone === "avoided") {
      avoided.push(entry);
    } else {
      neutral.push(entry);
    }
  }

  // A preference whose professor has left the course's latest snapshots keeps
  // its place: it is the student's work, and deleting it would make a term's
  // ranking evaporate every time Archer's Hub blanks a Professor cell.
  for (const preference of preferences) {
    if (byKey.has(preference.professorKey) && rankable.some((t) => t.key === preference.professorKey)) {
      continue;
    }
    const entry: RankingEntry = {
      key: preference.professorKey,
      displayName: preference.displayName,
      sectionIds: [],
      zone: preference.avoid ? "avoided" : "ranked",
      rank: preference.avoid ? null : preference.rank,
      active: preference.active,
    };
    if (entry.zone === "ranked") {
      ranked.push(entry);
    } else {
      avoided.push(entry);
    }
  }

  ranked.sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));

  return [
    ...ranked.map((entry, index) => ({ ...entry, rank: index + 1 })),
    ...neutral,
    ...avoided,
  ];
}

/** The zones in reading order: wanted, untouched, refused. */
export const RANKING_ZONES: readonly RankingZone[] = ["ranked", "neutral", "avoided"] as const;

/**
 * Moves one professor to `index` within `zone`, and renumbers.
 *
 * This is the whole gesture vocabulary of the surface: ranking, re-ordering,
 * avoiding, and un-avoiding are one operation seen from four places. In
 * particular, demoting an avoided professor back to neutral costs one move —
 * "actually I don't mind them" is common, and delete-then-re-add would make
 * the student pay twice for changing their mind.
 */
export function moveProfessor(
  entries: readonly RankingEntry[],
  key: string,
  zone: RankingZone,
  index: number
): RankingEntry[] {
  const moving = entries.find((entry) => entry.key === key);
  if (!moving) {
    return [...entries];
  }

  const zones = new Map<RankingZone, RankingEntry[]>(
    RANKING_ZONES.map((z) => [z, entries.filter((entry) => entry.zone === z && entry.key !== key)])
  );
  // `zones` is keyed by every RANKING_ZONES member, so a typed zone always
  // resolves. The throw makes that the guard rather than an assertion, and
  // names the bad value instead of failing later on a property of undefined.
  const target = zones.get(zone);
  if (!target) {
    throw new Error(`unknown ranking zone: ${zone}`);
  }
  const at = Math.max(0, Math.min(index, target.length));
  target.splice(at, 0, { ...moving, zone });

  return RANKING_ZONES.flatMap((z) =>
    (zones.get(z) ?? []).map((entry, position) => ({
      ...entry,
      rank: z === "ranked" ? position + 1 : null,
    }))
  );
}

/** What `writeCoursePreferences` takes: an ordered rank list and an avoid set. */
export interface PreferenceWrite {
  ranked: { key: string; displayName: string }[];
  avoided: { key: string; displayName: string }[];
}

/**
 * The list as the store takes it. The neutral zone is the absence of a
 * preference, so it writes nothing — and an inactive entry writes exactly
 * like an active one, because "no longer listed" is a fact about the course's
 * snapshots, not a retraction by the student.
 */
export function toPreferenceWrite(entries: readonly RankingEntry[]): PreferenceWrite {
  const name = (entry: RankingEntry) => ({ key: entry.key, displayName: entry.displayName });
  return {
    ranked: entries.filter((entry) => entry.zone === "ranked").map(name),
    avoided: entries.filter((entry) => entry.zone === "avoided").map(name),
  };
}

/**
 * What an empty list says.
 *
 * The empty state is the *normal* state early in a term: `SPEC.md` §2 records
 * `Professor` empty in 42 of 42 GEARTAP rows and 3 of 5 CSINTSY rows. Anything
 * vaguer than naming the cause and the fix and students report the feature as
 * broken.
 */
export function formatNoRankableProfessors(): string {
  return "No professor names captured yet — Archer's Hub fills these in closer to enlistment. Refresh to check.";
}

/** What an entry whose professor has left the course's latest snapshots says. */
export const INACTIVE_PROFESSOR_LABEL = "not currently listed for this course";

/**
 * What the live region says after a move.
 *
 * Keyboard reordering is a first-class path here, not a fallback, and a
 * keyboard move that says nothing is a move a student cannot verify.
 */
export function formatMoveAnnouncement(
  entries: readonly RankingEntry[],
  key: string
): string {
  const entry = entries.find((e) => e.key === key);
  if (!entry) {
    return "";
  }
  if (entry.zone === "avoided") {
    return `${entry.displayName} is avoided.`;
  }
  if (entry.zone === "neutral") {
    return `${entry.displayName} is unranked.`;
  }
  const total = entries.filter((e) => e.zone === "ranked").length;
  return `${entry.displayName} is ranked ${entry.rank} of ${total}.`;
}

/**
 * How heavily a ranking weighs against the preset (ADR-0021).
 *
 * A second axis, orthogonal to `Preset`: every priority composes with every
 * preset. `schedule` is exactly today's behaviour, which is why it is the
 * default — a student who ignores this feature gets an unchanged solve.
 */
export type Priority = "schedule" | "professors" | "hybrid";

export interface PriorityInfo {
  priority: Priority;
  label: string;
  /** One line under the label, naming what it does to the ranking. */
  description: string;
}

export const PRIORITY_INFOS: readonly PriorityInfo[] = [
  {
    priority: "schedule",
    label: "Schedule",
    description: "Rank results by the preset alone. Professor preferences are ignored.",
  },
  {
    priority: "professors",
    label: "Professors",
    description: "Rank by your professors first; the preset only breaks ties.",
  },
  {
    priority: "hybrid",
    label: "Hybrid",
    description: "Weigh a wanted professor against the schedule they cost you.",
  },
] as const;

export const DEFAULT_PRIORITY: Priority = "schedule";

export function isPriority(value: string): value is Priority {
  return PRIORITY_INFOS.some((info) => info.priority === value);
}

/** How much the student has said, across the whole plan. */
export interface PreferenceSummary {
  /** Courses carrying at least one ranked professor. */
  rankedCourses: number;
  /** Avoided professors, counted across every course. */
  avoidedProfessors: number;
}

/** Rolls up per-course preferences into the one line the Solve panel shows. */
export function summarisePreferences(
  perCourse: readonly (readonly ProfessorPreference[])[]
): PreferenceSummary {
  let rankedCourses = 0;
  let avoidedProfessors = 0;
  for (const preferences of perCourse) {
    if (preferences.some((preference) => preference.rank != null)) {
      rankedCourses += 1;
    }
    avoidedProfessors += preferences.filter((preference) => preference.avoid).length;
  }
  return { rankedCourses, avoidedProfessors };
}

const plural = (count: number, noun: string) =>
  `${count} ${count === 1 ? noun : `${noun}s`}`;

/**
 * The read-only summary beside the Priority control. The panel is where a
 * student feels the effect of a ranking; it is deliberately not where the
 * ranking is done, so this reads and links rather than edits.
 */
export function formatPreferenceSummary(summary: PreferenceSummary): string {
  if (summary.rankedCourses === 0 && summary.avoidedProfessors === 0) {
    return "No professors ranked or avoided yet";
  }
  return `${plural(summary.rankedCourses, "course")} ranked · ${plural(
    summary.avoidedProfessors,
    "professor"
  )} avoided`;
}

/**
 * The warning that a ranking is doing nothing (ADR-0021).
 *
 * A ranking under `schedule` is a no-op by design, and a student who spent
 * five minutes ranking and saw nothing change will file it as broken. So the
 * panel says it out loud — but only when there is something being ignored.
 */
export function formatSchedulePriorityNoOp(
  priority: Priority,
  summary: PreferenceSummary
): string | null {
  if (priority !== "schedule") {
    return null;
  }
  if (summary.rankedCourses === 0 && summary.avoidedProfessors === 0) {
    return null;
  }
  return "Your professor preferences are being ignored: Priority is set to Schedule, which ranks on the schedule alone. Switch to Professors or Hybrid to use them.";
}

/**
 * The professor key, mirroring `src-tauri/src/core/professors.rs`.
 *
 * Trimmed, case-folded, inner whitespace collapsed. A blank name has no key:
 * unknown is not an identity, so it can never be ranked, never avoided, and
 * never matched — the invariant that keeps a filter from silently deleting
 * the 42 GEARTAP sections whose Professor cell was empty (`SPEC.md` §2).
 */
export function professorKey(name: string | null | undefined): string | null {
  const trimmed = (name ?? "").trim();
  if (trimmed === "") {
    return null;
  }
  return trimmed.replace(/\s+/g, " ").toLowerCase();
}

/** A section already in the plan that is now listed with an avoided professor. */
export interface AvoidedProfessorAdvisory {
  courseId: number;
  courseCode: string;
  sectionId: number;
  sectionCode: string;
  /** The verbatim name from the snapshot — the key is never shown. */
  professorName: string;
}

/**
 * Sections in the plan whose latest snapshot names a professor avoided for
 * their own course.
 *
 * `Professor` populates over the term, so the common event is not a student
 * adding an avoided section — it is a section they chose weeks ago acquiring
 * a name on a refresh. Avoid is a filter on what the solver *offers*
 * (ADR-0020); a section the student put on the grid themselves is theirs, so
 * this only ever reports (ADR-0009).
 */
export function findAvoidedProfessorAdvisories(
  planSections: readonly PlanSection[],
  preferencesByCourse: ReadonlyMap<number, readonly ProfessorPreference[]>
): AvoidedProfessorAdvisory[] {
  const advisories: AvoidedProfessorAdvisory[] = [];
  for (const section of planSections) {
    const professorName = section.latestSnapshot?.professor ?? null;
    const key = professorKey(professorName);
    if (key === null || professorName === null) {
      continue;
    }
    const avoided = (preferencesByCourse.get(section.courseId) ?? []).some(
      (preference) => preference.avoid && preference.professorKey === key
    );
    if (avoided) {
      advisories.push({
        courseId: section.courseId,
        courseCode: section.courseCode,
        sectionId: section.sectionId,
        sectionCode: section.sectionCode,
        professorName,
      });
    }
  }
  return advisories;
}

/**
 * What the advisory says. It is modelled on `MissingSectionBanner`: the same
 * family, the same restraint. Nothing is removed and nothing is re-solved, so
 * the copy has to be as calm as the behaviour.
 */
export function formatAvoidedProfessorAdvisory(advisory: AvoidedProfessorAdvisory): {
  title: string;
  description: string;
} {
  return {
    title: `${advisory.courseCode} ${advisory.sectionCode} is now listed with ${advisory.professorName}, a professor you avoid`,
    description:
      "Nothing has been changed — the section is still in your plan, and no solve has been re-run. Avoiding a professor only filters what a solve offers you.",
  };
}
