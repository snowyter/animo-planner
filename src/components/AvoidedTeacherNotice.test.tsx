import { describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { AvoidedTeacherNotice } from "./AvoidedTeacherNotice";
import type { AvoidedTeacherAdvisory } from "../core/teacherRanking";

const advisory: AvoidedTeacherAdvisory = {
  courseId: 2923,
  courseCode: "GEARTAP",
  sectionId: 384,
  sectionCode: "S17",
  teacherName: "Bryant Lee",
};

const render = (advisories: AvoidedTeacherAdvisory[]) =>
  renderToStaticMarkup(
    React.createElement(AvoidedTeacherNotice, {
      advisories,
      onOpenRanking: vi.fn(),
    })
  );

describe("AvoidedTeacherNotice", () => {
  it("names the section and the teacher it has acquired", () => {
    const html = render([advisory]);

    expect(html).toContain('data-testid="avoided-teacher-notice"');
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

  it("renders nothing at all when no plan section has acquired an avoided teacher", () => {
    expect(render([])).toBe("");
  });
});
