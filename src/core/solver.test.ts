import { describe, expect, it } from "vitest";
import {
  PRESET_INFOS,
  defaultSolveOptions,
  formatExclusionNotice,
  formatScoreBreakdown,
  formatUnsatisfiableCoursesMessage,
  formatWarningLabel,
  solutionToSectionRefs,
} from "./solver";
import type { Solution, TransitionWarning, UnsatisfiableCourse } from "../adapters/ipc/types";

describe("core/solver", () => {

  it("never renders an empty label, even for a kind it does not recognise", () => {
    const label = formatWarningLabel({
      kind: "something_new" as never,
      day: "TUE",
      startMin: 555,
      endMin: 570,
      from: { courseId: 1, sectionId: 1 },
      to: { courseId: 2, sectionId: 2 },
    });

    expect(label).toBeTruthy();
    expect(label.length).toBeGreaterThan(0);
  });
  it("provides complete preset information for the three presets", () => {
    expect(PRESET_INFOS).toHaveLength(3);
    const presetKeys = PRESET_INFOS.map((p) => p.preset);
    expect(presetKeys).toEqual(["fewest_campus_days", "no_early_mornings", "most_online"]);

    const campusDays = PRESET_INFOS.find((p) => p.preset === "fewest_campus_days");
    expect(campusDays?.label).toBe("Fewest campus days");
    expect(campusDays?.description).toMatch(/campus|commute/i);

    const noMornings = PRESET_INFOS.find((p) => p.preset === "no_early_mornings");
    expect(noMornings?.label).toBe("No early mornings");
    expect(noMornings?.description).toMatch(/early/i);

    const mostOnline = PRESET_INFOS.find((p) => p.preset === "most_online");
    expect(mostOnline?.label).toBe("Most online");
    expect(mostOnline?.description).toMatch(/online/i);
  });

  it("returns default solve options with fewest_campus_days preset", () => {
    const opts = defaultSolveOptions();
    expect(opts.preset).toBe("fewest_campus_days");
    expect(opts.dayBlacklist).toEqual([]);
    expect(opts.earliestStartMin).toBeNull();
    expect(opts.latestEndMin).toBeNull();
    // Ticket 34: exclude-full defaults to on — a section at capacity cannot
    // be enlisted into — but the student can still turn it off.
    expect(opts.excludeFull).toBe(true);
    expect(opts.resultLimit).toBeGreaterThan(0);
  });

  it("allows overriding preset in defaultSolveOptions", () => {
    const opts = defaultSolveOptions("most_online");
    expect(opts.preset).toBe("most_online");
  });

  it("formats warning labels for advisory transitions", () => {
    const f2fOnlineWarning: TransitionWarning = {
      kind: "f2f_online_back_to_back",
      day: "MON",
      startMin: 540,
      endMin: 555,
      from: { courseId: 1, sectionId: 10 },
      to: { courseId: 2, sectionId: 20 },
    };

    const labelA = formatWarningLabel(f2fOnlineWarning);
    expect(labelA).toContain("F2F");
    expect(labelA).toContain("Online");
    expect(labelA).toContain("MON");

    const diffBuildingWarning: TransitionWarning = {
      kind: "f2f_f2f_different_buildings",
      day: "THU",
      startMin: 660,
      endMin: 675,
      from: { courseId: 1, sectionId: 10 },
      to: { courseId: 2, sectionId: 20 },
    };

    const labelB = formatWarningLabel(diffBuildingWarning);
    expect(labelB).toContain("different buildings");
    expect(labelB).toContain("THU");
  });

  it("formats unsatisfiable course messages naming the unsatisfied courses", () => {
    expect(formatUnsatisfiableCoursesMessage([])).toBe(
      "No conflict-free schedules found matching your constraints."
    );

    const single: UnsatisfiableCourse[] = [
      { courseId: 1, code: "GEARTAP", reason: "no_valid_section" },
    ];
    const msgSingle = formatUnsatisfiableCoursesMessage(single);
    expect(msgSingle).toContain("GEARTAP");
    expect(msgSingle).toContain("No conflict-free schedules found");

    const multi: UnsatisfiableCourse[] = [
      { courseId: 1, code: "GEARTAP", reason: "no_valid_section" },
      { courseId: 2, code: "CSINTSY", reason: "no_valid_section" },
    ];
    const msgMulti = formatUnsatisfiableCoursesMessage(multi);
    expect(msgMulti).toContain("GEARTAP");
    expect(msgMulti).toContain("CSINTSY");
  });

  it("says when exclusion is why a course cannot be filled (ticket 34)", () => {
    const allFull: UnsatisfiableCourse[] = [
      { courseId: 1, code: "GEARTAP", reason: "all_sections_full" },
    ];
    const msg = formatUnsatisfiableCoursesMessage(allFull);
    expect(msg).toContain("GEARTAP");
    expect(msg).toMatch(/full/i);

    const mixed: UnsatisfiableCourse[] = [
      { courseId: 1, code: "GEARTAP", reason: "all_sections_full" },
      { courseId: 2, code: "CSINTSY", reason: "no_valid_section" },
    ];
    const msgMixed = formatUnsatisfiableCoursesMessage(mixed);
    expect(msgMixed).toContain("GEARTAP");
    expect(msgMixed).toContain("CSINTSY");
    expect(msgMixed).toMatch(/full/i);
  });

  it("formats score breakdown items into readable strings", () => {
    const itemPos = { label: "Campus days", points: 40 };
    const itemNeg = { label: "Late classes", points: -20 };
    const itemZero = { label: "Even spread", points: 0 };

    expect(formatScoreBreakdown(itemPos)).toBe("Campus days: +40");
    expect(formatScoreBreakdown(itemNeg)).toBe("Late classes: -20");
    expect(formatScoreBreakdown(itemZero)).toBe("Even spread: 0");
  });

  it("announces how many sections were excluded as full, with the numbers' age", () => {
    // Ticket 34: the student must see the constraint doing something and
    // know whether the numbers are five minutes or five days old.
    const notice = formatExclusionNotice(3, "2026-08-22T10:00:00Z");
    expect(notice).not.toBeNull();
    expect(notice).toContain("3");
    expect(notice).toMatch(/full/i);
    expect(notice).toContain("2026");
    expect(notice).toMatch(/stale/i);

    const one = formatExclusionNotice(1, "2026-08-22T10:00:00Z");
    expect(one).toContain("1");
    expect(one).toMatch(/\bsection\b/);

    // No exclusions means nothing to announce.
    expect(formatExclusionNotice(0, "2026-08-22T10:00:00Z")).toBeNull();

    // Unknown age still announces the count.
    const unstamped = formatExclusionNotice(2, null);
    expect(unstamped).toContain("2");
    expect(unstamped).toMatch(/full/i);
  });

  it("extracts section refs from a solution for applying to a plan", () => {
    const solution: Solution = {
      id: "solution-0",
      score: 100,
      breakdown: [{ label: "Preset score", points: 100 }],
      warnings: [],
      sections: [
        {
          courseId: 2923,
          courseCode: "GEARTAP",
          sectionId: 384,
          sectionCode: "S11",
          pinned: false,
          blocks: [],
        },
        {
          courseId: 564,
          courseCode: "CSINTSY",
          sectionId: 737,
          sectionCode: "Z01",
          pinned: true,
          blocks: [],
        },
      ],
    };

    const refs = solutionToSectionRefs(solution);
    expect(refs).toEqual([
      { courseId: 2923, sectionId: 384 },
      { courseId: 564, sectionId: 737 },
    ]);
  });
});
