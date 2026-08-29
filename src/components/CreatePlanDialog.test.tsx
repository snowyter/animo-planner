import { describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CreatePlanDialog } from "./CreatePlanDialog";
import type { CampusOption, SessionOption } from "../adapters/ipc/types";

// Fixture data mirroring what `get_campus_options` / `get_session_options`
// serve; the values themselves are owned by Rust (ticket 25).
const CAMPUS_FIXTURES: CampusOption[] = [
  { id: 7, name: "Manila" },
  { id: 8, name: "Laguna" },
  { id: 9, name: "Rufino" },
];
const SESSION_FIXTURES: SessionOption[] = [
  { id: 155, name: "AY2026-27 T1" },
  { id: 156, name: "AY2026-27 T2" },
];

describe("CreatePlanDialog", () => {
  it("renders when open with inputs for name, campus, and structured academic session with complete year", () => {
    const html = renderToStaticMarkup(
      React.createElement(CreatePlanDialog, {
        open: true,
        onOpenChange: vi.fn(),
        campusOptions: CAMPUS_FIXTURES,
        sessionOptions: SESSION_FIXTURES,
        onSubmit: vi.fn(),
      })
    );

    expect(html).toContain("Create Plan");
    expect(html).toContain("Plan Name");
    expect(html).toContain("Campus");
    expect(html).toContain("Academic Session");
    expect(html).toContain("Manila");
    expect(html).toContain("Laguna");
    expect(html).toContain("Rufino");
    expect(html).toContain("AY");
    expect(html).toContain("2026-2027");
    expect(html).toContain("Term 1");
    expect(html).toContain("Term 2");
    expect(html).toContain("Previous Academic Year");
    expect(html).toContain("Next Academic Year");
  });

  it("renders identifiable error state when submission error occurs", () => {
    const html = renderToStaticMarkup(
      React.createElement(CreatePlanDialog, {
        open: true,
        onOpenChange: vi.fn(),
        campusOptions: CAMPUS_FIXTURES,
        sessionOptions: SESSION_FIXTURES,
        error: "unimplemented: create_plan",
        onSubmit: vi.fn(),
      })
    );

    expect(html).toContain("unimplemented: create_plan");
  });

  it("informs the user that a plan is hard-scoped to one campus and term", () => {
    const html = renderToStaticMarkup(
      React.createElement(CreatePlanDialog, {
        open: true,
        onOpenChange: vi.fn(),
        campusOptions: CAMPUS_FIXTURES,
        sessionOptions: SESSION_FIXTURES,
        onSubmit: vi.fn(),
      })
    );

    expect(html).toContain("hard-scoped");
  });

  it("says so when the chosen term is not in the catalog, and blocks creation", () => {
    // Nothing here parses as an academic year, so the stepper opens on its
    // 2026 default with no session behind it. Before, the dialog invented an
    // id and created the plan anyway; now it must say the term does not
    // exist and refuse.
    const html = renderToStaticMarkup(
      React.createElement(CreatePlanDialog, {
        open: true,
        onOpenChange: vi.fn(),
        campusOptions: CAMPUS_FIXTURES,
        sessionOptions: [{ id: 144, name: "Annual" }],
        onSubmit: vi.fn(),
      })
    );

    expect(html).toContain('data-testid="plan-session-unavailable"');
    expect(html).toContain("is not in the Archer");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Create Plan<\/button>/);

    // The same dialog with a real session must leave the button live, or the
    // assertion above would pass for a button that is always disabled.
    const usable = renderToStaticMarkup(
      React.createElement(CreatePlanDialog, {
        open: true,
        onOpenChange: vi.fn(),
        campusOptions: CAMPUS_FIXTURES,
        sessionOptions: SESSION_FIXTURES,
        onSubmit: vi.fn(),
      })
    );
    expect(usable).not.toContain('data-testid="plan-session-unavailable"');
    expect(usable).not.toMatch(/<button[^>]*disabled=""[^>]*>Create Plan<\/button>/);
  });

  it("keeps the year-less sessions selectable beside the terms", () => {
    // `Annual` and `SHS` are offered sessions (SPEC §2) that a year-and-term
    // control cannot express. They were selectable before the stepper
    // existed and must not be quietly dropped by it.
    const html = renderToStaticMarkup(
      React.createElement(CreatePlanDialog, {
        open: true,
        onOpenChange: vi.fn(),
        campusOptions: CAMPUS_FIXTURES,
        sessionOptions: [
          { id: 155, name: "AY2026-27 T1" },
          { id: 144, name: "Annual" },
          { id: 161, name: "SHS" },
        ],
        onSubmit: vi.fn(),
      })
    );

    expect(html).toContain("Other sessions");
    expect(html).toContain("Annual");
    expect(html).toContain("SHS");
    expect(html).toContain('value="session:144"');
    expect(html).toContain('value="session:161"');
  });
});
