import { describe, expect, it } from "vitest";

import {
  buildRankingList,
  DEFAULT_PRIORITY,
  findAvoidedProfessorAdvisories,
  formatAvoidedProfessorAdvisory,
  formatMoveAnnouncement,
  formatPreferenceSummary,
  formatSchedulePriorityNoOp,
  formatNoRankableProfessors,
  INACTIVE_PROFESSOR_LABEL,
  moveProfessor,
  PRIORITY_INFOS,
  summarisePreferences,
  professorKey,
  toPreferenceWrite,
} from "./professorRanking";
import type { PlanSection, RankableProfessor, ProfessorPreference } from "../adapters/ipc/types";

const rankable = (key: string, displayName: string, sectionIds: number[] = []): RankableProfessor => ({
  key,
  displayName,
  sectionIds,
});

const preference = (
  professorKey: string,
  displayName: string,
  fields: Partial<ProfessorPreference> = {}
): ProfessorPreference => ({
  professorKey,
  displayName,
  rank: null,
  avoid: false,
  active: true,
  ...fields,
});


/** Unwraps a fixture value the literals above guarantee exists. */
function mustExist<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("fixture value must exist");
  return value;
}

describe("buildRankingList", () => {
  it("places a ranked professor, an avoided professor, and an unmentioned one in their own zones", () => {
    const entries = buildRankingList(
      [
        rankable("bryant lee", "Bryant Lee", [384]),
        rankable("nina cruz", "Nina Cruz", [385]),
        rankable("omar reyes", "Omar Reyes", [386]),
      ],
      [
        preference("nina cruz", "Nina Cruz", { rank: 1 }),
        preference("omar reyes", "Omar Reyes", { avoid: true }),
      ]
    );

    expect(entries).toEqual([
      { key: "nina cruz", displayName: "Nina Cruz", sectionIds: [385], zone: "ranked", rank: 1, active: true },
      { key: "bryant lee", displayName: "Bryant Lee", sectionIds: [384], zone: "neutral", rank: null, active: true },
      { key: "omar reyes", displayName: "Omar Reyes", sectionIds: [386], zone: "avoided", rank: null, active: true },
    ]);
  });
});

describe("an inactive preference", () => {
  it("stays in the list, in its own zone, with no sections and flagged inactive", () => {
    const entries = buildRankingList(
      [rankable("nina cruz", "Nina Cruz", [385])],
      [
        preference("nina cruz", "Nina Cruz", { rank: 2 }),
        preference("gone professor", "Gone Professor", { rank: 1, active: false }),
        preference("left entirely", "Left Entirely", { avoid: true, active: false }),
      ]
    );

    expect(entries.map((e) => [e.displayName, e.zone, e.rank, e.active])).toEqual([
      ["Gone Professor", "ranked", 1, false],
      ["Nina Cruz", "ranked", 2, true],
      ["Left Entirely", "avoided", null, false],
    ]);
    expect(mustExist(entries[0]).sectionIds).toEqual([]);
  });
});

describe("moveProfessor", () => {
  const list = () =>
    buildRankingList(
      [
        rankable("nina cruz", "Nina Cruz", [385]),
        rankable("bryant lee", "Bryant Lee", [384]),
        rankable("omar reyes", "Omar Reyes", [386]),
      ],
      [
        preference("nina cruz", "Nina Cruz", { rank: 1 }),
        preference("bryant lee", "Bryant Lee", { rank: 2 }),
      ]
    );

  it("renumbers the ranked zone the moment a professor is dropped into it", () => {
    const moved = moveProfessor(list(), "omar reyes", "ranked", 0);

    expect(moved.filter((e) => e.zone === "ranked").map((e) => [e.displayName, e.rank])).toEqual([
      ["Omar Reyes", 1],
      ["Nina Cruz", 2],
      ["Bryant Lee", 3],
    ]);
  });

  it("renumbers what is left behind when a ranked professor is avoided", () => {
    const moved = moveProfessor(list(), "nina cruz", "avoided", 0);

    expect(moved.map((e) => [e.displayName, e.zone, e.rank])).toEqual([
      ["Bryant Lee", "ranked", 1],
      ["Omar Reyes", "neutral", null],
      ["Nina Cruz", "avoided", null],
    ]);
  });

  it("demotes an avoided professor back to neutral in one move", () => {
    const avoided = moveProfessor(list(), "omar reyes", "avoided", 0);
    const demoted = moveProfessor(avoided, "omar reyes", "neutral", 0);

    expect(demoted.find((e) => e.key === "omar reyes")).toMatchObject({
      zone: "neutral",
      rank: null,
    });
  });
});

describe("toPreferenceWrite", () => {
  it("sends the ranked zone in order and the avoided zone with its display names, and nothing neutral", () => {
    const entries = buildRankingList(
      [
        rankable("nina cruz", "Nina Cruz"),
        rankable("bryant lee", "Bryant Lee"),
        rankable("omar reyes", "Omar Reyes"),
      ],
      [
        preference("bryant lee", "Bryant Lee", { rank: 1 }),
        preference("nina cruz", "Nina Cruz", { rank: 2 }),
        preference("omar reyes", "Omar Reyes", { avoid: true }),
      ]
    );

    expect(toPreferenceWrite(entries)).toEqual({
      ranked: [
        { key: "bryant lee", displayName: "Bryant Lee" },
        { key: "nina cruz", displayName: "Nina Cruz" },
      ],
      avoided: [{ key: "omar reyes", displayName: "Omar Reyes" }],
    });
  });

  it("keeps an inactive entry in the write, so a refresh's blank Professor cell cannot erase a ranking", () => {
    const entries = buildRankingList(
      [],
      [preference("gone professor", "Gone Professor", { rank: 1, active: false })]
    );

    expect(toPreferenceWrite(entries).ranked).toEqual([
      { key: "gone professor", displayName: "Gone Professor" },
    ]);
  });
});

describe("the copy the list needs", () => {
  it("says why the list is empty and what fills it, naming Refresh", () => {
    const copy = formatNoRankableProfessors();

    expect(copy).toContain("No professor names captured yet");
    expect(copy).toContain("Archer's Hub");
    expect(copy).toContain("Refresh");
  });

  it("labels an inactive entry as no longer listed for the course", () => {
    expect(INACTIVE_PROFESSOR_LABEL).toBe("not currently listed for this course");
  });

  it("announces a move by naming the professor and where they landed", () => {
    const ranked = buildRankingList(
      [rankable("nina cruz", "Nina Cruz"), rankable("omar reyes", "Omar Reyes")],
      [preference("nina cruz", "Nina Cruz", { rank: 1 })]
    );

    expect(formatMoveAnnouncement(ranked, "nina cruz")).toBe("Nina Cruz is ranked 1 of 1.");
    expect(formatMoveAnnouncement(ranked, "omar reyes")).toBe("Omar Reyes is unranked.");
    expect(
      formatMoveAnnouncement(moveProfessor(ranked, "omar reyes", "avoided", 0), "omar reyes")
    ).toBe("Omar Reyes is avoided.");
  });
});

describe("the Priority axis", () => {
  it("offers Schedule, Professors and Hybrid in that order, and defaults to Schedule", () => {
    expect(PRIORITY_INFOS.map((info) => info.priority)).toEqual([
      "schedule",
      "professors",
      "hybrid",
    ]);
    expect(DEFAULT_PRIORITY).toBe("schedule");
    for (const info of PRIORITY_INFOS) {
      expect(info.label.length).toBeGreaterThan(0);
      expect(info.description.length).toBeGreaterThan(0);
    }
  });

  it("summarises the preferences that exist, counting courses and avoided professors", () => {
    expect(formatPreferenceSummary({ rankedCourses: 3, avoidedProfessors: 2 })).toBe(
      "3 courses ranked · 2 professors avoided"
    );
    expect(formatPreferenceSummary({ rankedCourses: 1, avoidedProfessors: 1 })).toBe(
      "1 course ranked · 1 professor avoided"
    );
    expect(formatPreferenceSummary({ rankedCourses: 0, avoidedProfessors: 0 })).toBe(
      "No professors ranked or avoided yet"
    );
  });

  it("warns that a ranking does nothing under Schedule, and only then", () => {
    const withPreferences = { rankedCourses: 2, avoidedProfessors: 0 };

    const warning = formatSchedulePriorityNoOp("schedule", withPreferences);
    expect(warning).not.toBeNull();
    expect(warning).toContain("ignored");
    expect(warning).toContain("Professors");

    expect(formatSchedulePriorityNoOp("professors", withPreferences)).toBeNull();
    expect(formatSchedulePriorityNoOp("hybrid", withPreferences)).toBeNull();
    expect(
      formatSchedulePriorityNoOp("schedule", { rankedCourses: 0, avoidedProfessors: 0 })
    ).toBeNull();
  });

  it("counts a preference summary from the preferences of every course", () => {
    expect(
      summarisePreferences([
        [preference("nina cruz", "Nina Cruz", { rank: 1 })],
        [
          preference("omar reyes", "Omar Reyes", { avoid: true }),
          preference("bryant lee", "Bryant Lee", { avoid: true }),
        ],
        [],
      ])
    ).toEqual({ rankedCourses: 1, avoidedProfessors: 2 });
  });
});

describe("professorKey", () => {
  it("mirrors the store: trimmed, case-folded, inner whitespace collapsed", () => {
    expect(professorKey("  BRYANT   lee ")).toBe("bryant lee");
    expect(professorKey("Bryant Lee")).toBe("bryant lee");
  });

  it("gives a blank name no key at all, because unknown is not an identity", () => {
    expect(professorKey("")).toBeNull();
    expect(professorKey("   ")).toBeNull();
    expect(professorKey(null)).toBeNull();
  });
});

describe("findAvoidedProfessorAdvisories", () => {
  const planSection = (
    courseId: number,
    courseCode: string,
    sectionCode: string,
    professor: string | null
  ) =>
    ({
      courseId,
      courseCode,
      courseTitle: `${courseCode} Title`,
      sectionId: 900 + courseId,
      sectionCode,
      pinned: false,
      missing: false,
      modality: "F2F",
      blocks: [],
      latestSnapshot: { capturedAt: "2026-08-27T00:00:00Z", enrolled: 40, professor, remark: null },
    }) as unknown as PlanSection;

  it("names a section in the plan that has acquired a professor avoided for its course", () => {
    const advisories = findAvoidedProfessorAdvisories(
      [
        planSection(2923, "GEARTAP", "S17", "  BRYANT  Lee "),
        planSection(3001, "CSINTSY", "S11", "Nina Cruz"),
      ],
      new Map([
        [2923, [preference("bryant lee", "Bryant Lee", { avoid: true })]],
        [3001, [preference("nina cruz", "Nina Cruz", { rank: 1 })]],
      ])
    );

    expect(advisories).toEqual([
      {
        courseId: 2923,
        courseCode: "GEARTAP",
        sectionId: 3823,
        sectionCode: "S17",
        professorName: "  BRYANT  Lee ",
      },
    ]);
  });

  it("never raises one for a blank professor, because unknown is never a match", () => {
    expect(
      findAvoidedProfessorAdvisories(
        [planSection(2923, "GEARTAP", "S17", null), planSection(2923, "GEARTAP", "S18", "  ")],
        new Map([[2923, [preference("bryant lee", "Bryant Lee", { avoid: true })]]])
      )
    ).toEqual([]);
  });

  it("says what happened and that nothing was changed", () => {
    const copy = formatAvoidedProfessorAdvisory({
      courseId: 2923,
      courseCode: "GEARTAP",
      sectionId: 384,
      sectionCode: "S17",
      professorName: "Bryant Lee",
    });

    expect(copy.title).toBe("GEARTAP S17 is now listed with Bryant Lee, a professor you avoid");
    expect(copy.description).toContain("Nothing has been changed");
  });
});
