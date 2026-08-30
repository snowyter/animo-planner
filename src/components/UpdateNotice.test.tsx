import { describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { UpdateNotice } from "./UpdateNotice";
import type { UpdateCheck } from "../adapters/ipc/types";

describe("UpdateNotice component", () => {
  it("renders quiet dismissible notice naming the available version when an update is offered", () => {
    const check: UpdateCheck = {
      status: "available",
      currentVersion: "0.1.0",
      availableVersion: "0.2.0",
      notes: "Fixed Course Finder selectors for T1",
      failureReason: null,
      failureDetail: null,
    };

    const html = renderToStaticMarkup(
      React.createElement(UpdateNotice, {
        updateCheck: check,
        onOpenAbout: vi.fn(),
        onDismiss: vi.fn(),
      })
    );

    expect(html).toContain("0.2.0");
    expect(html).toMatch(/update (?:is )?available|new version/i);
    expect(html).toMatch(/view update|details|update/i);
    expect(html).toMatch(/dismiss/i);
  });

  it("does not render when update is dismissed", () => {
    const check: UpdateCheck = {
      status: "available",
      currentVersion: "0.1.0",
      availableVersion: "0.2.0",
      notes: null,
      failureReason: null,
      failureDetail: null,
    };

    const html = renderToStaticMarkup(
      React.createElement(UpdateNotice, {
        updateCheck: check,
        dismissed: true,
        onOpenAbout: vi.fn(),
        onDismiss: vi.fn(),
      })
    );

    expect(html).toBe("");
  });

  it("does not render when app is up to date", () => {
    const check: UpdateCheck = {
      status: "up_to_date",
      currentVersion: "0.1.0",
      availableVersion: null,
      notes: null,
      failureReason: null,
      failureDetail: null,
    };

    const html = renderToStaticMarkup(
      React.createElement(UpdateNotice, {
        updateCheck: check,
        onOpenAbout: vi.fn(),
        onDismiss: vi.fn(),
      })
    );

    expect(html).toBe("");
  });

  it("does not render when check failed (offline or network failure)", () => {
    const check: UpdateCheck = {
      status: "failed",
      currentVersion: "0.1.0",
      availableVersion: null,
      notes: null,
      failureReason: "network",
      failureDetail: "Network error",
    };

    const html = renderToStaticMarkup(
      React.createElement(UpdateNotice, {
        updateCheck: check,
        onOpenAbout: vi.fn(),
        onDismiss: vi.fn(),
      })
    );

    expect(html).toBe("");
  });

  it("does not render when updater is compiled out (status: unavailable)", () => {
    const check: UpdateCheck = {
      status: "unavailable",
      currentVersion: "0.1.0",
      availableVersion: null,
      notes: null,
      failureReason: null,
      failureDetail: null,
    };

    const html = renderToStaticMarkup(
      React.createElement(UpdateNotice, {
        updateCheck: check,
        onOpenAbout: vi.fn(),
        onDismiss: vi.fn(),
      })
    );

    expect(html).toBe("");
  });

  it("does not render when check is null", () => {
    const html = renderToStaticMarkup(
      React.createElement(UpdateNotice, {
        updateCheck: null,
        onOpenAbout: vi.fn(),
        onDismiss: vi.fn(),
      })
    );

    expect(html).toBe("");
  });

  it("fades in rather than pushing the page down without warning", () => {
    // The notice appears above the whole app, asynchronously, after the
    // startup check resolves. Arriving with a rise here would shift every
    // surface below it a few seconds after first paint, so it is a fade.
    const check: UpdateCheck = {
      status: "available",
      currentVersion: "0.1.0",
      availableVersion: "0.2.0",
      notes: "Fixed Course Finder selectors for T1",
      failureReason: null,
      failureDetail: null,
    };

    const html = renderToStaticMarkup(
      React.createElement(UpdateNotice, {
        updateCheck: check,
        onOpenAbout: vi.fn(),
        onDismiss: vi.fn(),
      })
    );

    expect(html).toContain("enter-fade");
  });
});
