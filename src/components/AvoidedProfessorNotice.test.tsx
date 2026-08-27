import { describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { AvoidedProfessorNotice } from "./AvoidedProfessorNotice";
import type { AvoidedProfessorAdvisory } from "../core/professorRanking";

const advisory: AvoidedProfessorAdvisory = {
  courseId: 2923,
  courseCode: "GEARTAP",
  sectionId: 384,
  sectionCode: "S17",
  professorName: "Bryant Lee",
};

const render = (advisories: AvoidedProfessorAdvisory[]) =>
  renderToStaticMarkup(
    React.createElement(AvoidedProfessorNotice, {
      advisories,
      onOpenRanking: vi.fn(),
    })
  );

describe("AvoidedProfessorNotice", () => {
  it("names the section and the professor it has acquired", () => {
    const html = render([advisory]);

    expect(html).toContain('data-testid="avoided-professor-notice"');
    expect(html).toContain("GEARTAP S17");
    expect(html).toContain("Bryant Lee");
  });

  it("says that nothing was changed, because nothing was", () => {
    const html = render([advisory]);

    expect(html).toContain("Nothing has been changed");
    expect(html).not.toContain("Remove from plan");
  });

  it("never looks like an error", () => {
    const html = render([advisory]);

    expect(html).not.toContain('role="alert"');
    expect(html).not.toMatch(/text-red-|bg-red-|border-red-/);
  });

  it("renders nothing at all when no plan section has acquired an avoided professor", () => {
    expect(render([])).toBe("");
  });
});
