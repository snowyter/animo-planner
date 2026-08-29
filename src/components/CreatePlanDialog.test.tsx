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
});
