import { describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ProfessorRanking } from "./ProfessorRanking";
import { buildRankingList } from "../core/professorRanking";
import type { RankableProfessor, ProfessorPreference } from "../adapters/ipc/types";

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

const render = (props: Record<string, unknown> = {}) =>
  renderToStaticMarkup(
    React.createElement(ProfessorRanking, {
      courseCode: "GEARTAP",
      courseTitle: "Art Appreciation",
      entries: buildRankingList(
        [
          rankable("nina cruz", "Nina Cruz", [385]),
          rankable("bryant lee", "Bryant Lee", [384, 387]),
          rankable("omar reyes", "Omar Reyes", [386]),
        ],
        [
          preference("nina cruz", "Nina Cruz", { rank: 1 }),
          preference("omar reyes", "Omar Reyes", { avoid: true }),
        ]
      ),
      sectionCodesById: { 384: "S11", 385: "S12", 386: "S13", 387: "S14" },
      onMove: vi.fn(),
      onBack: vi.fn(),
      ...props,
    })
  );

describe("ProfessorRanking", () => {
  it("shows a ranked region, an avoided region below it, and everyone else in between", () => {
    const html = render();

    const ranked = html.indexOf('data-testid="ranking-zone-ranked"');
    const neutral = html.indexOf('data-testid="ranking-zone-neutral"');
    const avoided = html.indexOf('data-testid="ranking-zone-avoided"');

    expect(ranked).toBeGreaterThan(-1);
    expect(neutral).toBeGreaterThan(ranked);
    expect(avoided).toBeGreaterThan(neutral);

    expect(html).toContain('data-professor-key="nina cruz"');
    expect(html).toContain('data-professor-key="bryant lee"');
    expect(html).toContain('data-professor-key="omar reyes"');
  });

  it("numbers the ranked professors 1, 2, 3 and numbers nobody else", () => {
    const html = render({
      entries: buildRankingList(
        [
          rankable("nina cruz", "Nina Cruz"),
          rankable("bryant lee", "Bryant Lee"),
          rankable("omar reyes", "Omar Reyes"),
        ],
        [
          preference("bryant lee", "Bryant Lee", { rank: 1 }),
          preference("nina cruz", "Nina Cruz", { rank: 2 }),
        ]
      ),
    });

    expect(html).toMatch(/data-professor-key="bryant lee"[^>]*data-rank="1"/);
    expect(html).toMatch(/data-professor-key="nina cruz"[^>]*data-rank="2"/);
    expect(html).toMatch(/data-professor-key="omar reyes"[^>]*data-rank=""/);
  });

  it("lists the sections each professor is listed on, by section code", () => {
    const html = render();

    expect(html).toContain("S11");
    expect(html).toContain("S14");
    expect(html).toContain("S12");
  });

  it("offers an explicit way back to the course it was entered from", () => {
    const html = render();

    expect(html).toContain('data-testid="professor-ranking-back"');
    expect(html).toContain("Back to Capture");
    expect(html).toContain("GEARTAP");
  });

  it("says plainly why the list is empty and what fills it", () => {
    const html = render({ entries: [] });

    expect(html).toContain('data-testid="professor-ranking-empty"');
    expect(html).toContain("No professor names captured yet");
    expect(html).toContain("Refresh to check.");
    expect(html).not.toContain('data-testid="ranking-zone-ranked"');
  });

  it("keeps a professor who has left the course, de-emphasised and labelled", () => {
    const html = render({
      entries: buildRankingList(
        [rankable("nina cruz", "Nina Cruz", [385])],
        [
          preference("nina cruz", "Nina Cruz", { rank: 2 }),
          preference("gone professor", "Gone Professor", { rank: 1, active: false }),
        ]
      ),
    });

    expect(html).toContain("Gone Professor");
    expect(html).toMatch(/data-professor-key="gone professor"[^>]*data-active="false"/);
    expect(html).toContain("not currently listed for this course");
    // Kept means kept: it still holds a rank, and Nina renumbers around it.
    expect(html).toMatch(/data-professor-key="gone professor"[^>]*data-rank="1"/);
  });
});
