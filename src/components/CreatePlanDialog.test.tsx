import { describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CreatePlanDialog } from "./CreatePlanDialog";
import { DEFAULT_CAMPUS_OPTIONS, DEFAULT_SESSION_OPTIONS } from "../core/options";

describe("CreatePlanDialog", () => {
  it("renders when open with inputs for name, campus, and academic session", () => {
    const html = renderToStaticMarkup(
      React.createElement(CreatePlanDialog, {
        open: true,
        onOpenChange: vi.fn(),
        campusOptions: DEFAULT_CAMPUS_OPTIONS,
        sessionOptions: DEFAULT_SESSION_OPTIONS,
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
    expect(html).toContain("AY2026-27 T1");
  });

  it("renders identifiable error state when submission error occurs", () => {
    const html = renderToStaticMarkup(
      React.createElement(CreatePlanDialog, {
        open: true,
        onOpenChange: vi.fn(),
        campusOptions: DEFAULT_CAMPUS_OPTIONS,
        sessionOptions: DEFAULT_SESSION_OPTIONS,
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
        campusOptions: DEFAULT_CAMPUS_OPTIONS,
        sessionOptions: DEFAULT_SESSION_OPTIONS,
        onSubmit: vi.fn(),
      })
    );

    expect(html).toContain("hard-scoped");
  });
});
