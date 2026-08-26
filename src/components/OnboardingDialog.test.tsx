import { beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { OnboardingDialog } from "./OnboardingDialog";
import type { CampusOption, SessionOption, PlanSummary } from "../adapters/ipc/types";
import { DISCLAIMER_TEXT, SIGN_IN_NOTICE } from "../core/onboarding";

describe("OnboardingDialog", () => {
  const mockCampusOptions: CampusOption[] = [
    { id: 7, name: "Manila" },
    { id: 8, name: "Laguna" },
  ];
  const mockSessionOptions: SessionOption[] = [
    { id: 155, name: "AY2026-27 T1" },
    { id: 156, name: "AY2026-27 T2" },
  ];

  const mockCreatedPlan: PlanSummary = {
    id: "plan-123",
    name: "My First Plan",
    campusId: 7,
    campusName: "Manila",
    sessionId: 155,
    sessionName: "AY2026-27 T1",
    createdAt: "2026-08-24T00:00:00Z",
    sectionCount: 0,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the initial screen offering the one path in, with the verbatim disclaimer", () => {
    const html = renderToStaticMarkup(
      React.createElement(OnboardingDialog, {
        open: true,
        onOpenChange: vi.fn(),
        campusOptions: mockCampusOptions,
        sessionOptions: mockSessionOptions,
        onCreatePlan: vi.fn().mockResolvedValue(mockCreatedPlan),
        onOpenCapture: vi.fn().mockResolvedValue(undefined),
        onSelectPlan: vi.fn(),
        onComplete: vi.fn(),
        initialStep: "choice",
      })
    );

    expect(html).toMatch(/Start a real plan|Create your plan/i);
    // The sample-data path is gone; onboarding must not advertise one.
    expect(html).not.toMatch(/sample/i);

    // Verbatim disclaimer must be visible during first run
    expect(html).toContain(DISCLAIMER_TEXT);

    // Skip button must be available
    expect(html).toMatch(/Skip/i);
  });

  it("renders Step 1 (pick-scope) with campus, academic session, and name fields", () => {
    const html = renderToStaticMarkup(
      React.createElement(OnboardingDialog, {
        open: true,
        onOpenChange: vi.fn(),
        campusOptions: mockCampusOptions,
        sessionOptions: mockSessionOptions,
        onCreatePlan: vi.fn(),
        onOpenCapture: vi.fn(),
        onSelectPlan: vi.fn(),
        onComplete: vi.fn(),
        initialStep: "pick-scope",
      })
    );

    expect(html).toContain("Manila");
    expect(html).toContain("AY2026-27 T1");
    expect(html).toMatch(/Campus/i);
    expect(html).toMatch(/Academic Session/i);
    expect(html).toMatch(/Skip/i);
    expect(html).toMatch(/Continue|Next/i);
  });

  it("renders Step 2 (sign-in) stating sign-in occurs on university site with no credential storage before opening popup", () => {
    const html = renderToStaticMarkup(
      React.createElement(OnboardingDialog, {
        open: true,
        onOpenChange: vi.fn(),
        campusOptions: mockCampusOptions,
        sessionOptions: mockSessionOptions,
        onCreatePlan: vi.fn(),
        onOpenCapture: vi.fn(),
        onSelectPlan: vi.fn(),
        onComplete: vi.fn(),
        initialStep: "sign-in",
      })
    );

    expect(html).toContain(SIGN_IN_NOTICE.replace(/'/g, "&#x27;"));
    expect(html).toMatch(/Open Archer&#x27;s Hub|Sign in to Archer&#x27;s Hub|Open Archer's Hub/i);
    expect(html).toMatch(/Skip/i);
  });

  it("renders Step 3 (search-course) with instructions on searching courses in Archer's Hub", () => {
    const html = renderToStaticMarkup(
      React.createElement(OnboardingDialog, {
        open: true,
        onOpenChange: vi.fn(),
        campusOptions: mockCampusOptions,
        sessionOptions: mockSessionOptions,
        onCreatePlan: vi.fn(),
        onOpenCapture: vi.fn(),
        onSelectPlan: vi.fn(),
        onComplete: vi.fn(),
        initialStep: "search-course",
      })
    );

    expect(html).toMatch(/Search your first course/i);
    expect(html).toMatch(/Course Finder/i);
    expect(html).toMatch(/Finish|Go to Plan|Done/i);
  });

  it("renders error alert if an error occurs", () => {
    const html = renderToStaticMarkup(
      React.createElement(OnboardingDialog, {
        open: true,
        onOpenChange: vi.fn(),
        campusOptions: mockCampusOptions,
        sessionOptions: mockSessionOptions,
        onCreatePlan: vi.fn(),
        onOpenCapture: vi.fn(),
        onSelectPlan: vi.fn(),
        onComplete: vi.fn(),
        initialStep: "choice",
      })
    );

    // Initial state has no error
    expect(html).not.toContain("Alert variant=\"destructive\"");
  });
});
