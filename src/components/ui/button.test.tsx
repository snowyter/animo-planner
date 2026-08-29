/**
 * The button is the app's most repeated interactive element, and it is the
 * one the student presses while enlistment is live. These assertions keep a
 * styling change from quietly removing the press feedback or the focus ring,
 * both of which are the difference between a control and a label.
 *
 * Renders to static markup, like the rest of the suite.
 */

import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Button, buttonVariants } from "./button";

const render = (props: React.ComponentProps<typeof Button> = {}) =>
  renderToStaticMarkup(React.createElement(Button, props));

describe("Button", () => {
  it("renders a real button that a keyboard can reach", () => {
    const html = render({ children: "Add to Plan" });

    expect(html).toContain("Add to Plan");
    expect(html.startsWith("<button")).toBe(true);
  });

  it("responds to a press, so an action feels taken", () => {
    // Every action in this app is a button, and a press that produces no
    // feedback leaves the student unsure whether the click landed. `scale`
    // rather than a colour change: it is compositor-only, so it cannot
    // trigger a paint on a surface holding forty other controls.
    expect(buttonVariants()).toContain("active:scale-[0.97]");
  });

  it("presses with a transition, and only on the properties it moves", () => {
    // The transition names its properties and never `transition-all` — an
    // all-transition on a repeated control is one stray property away from
    // animating layout.
    const base = buttonVariants();
    expect(base).toMatch(/transition-\[transform,/);
    expect(base).not.toContain("transition-all");
  });

  it("still transitions the hover fill after the press was added", () => {
    // Regression: `transition-colors` was dropped when the press landed, so
    // every hover fill in every variant snapped instead of easing. The
    // colour properties have to stay in the transition list.
    const base = buttonVariants();
    expect(base).toContain("background-color");
    expect(base).toContain("color");
  });

  it("keeps the press off a button that is disabled", () => {
    const html = render({ children: "Apply", disabled: true });

    expect(html).toContain("disabled");
    // A disabled control must not feel pressable.
    expect(html).toContain("disabled:pointer-events-none");
  });

  it("never suppresses the focus ring", () => {
    // App.css draws `:focus-visible` on every interactive element. A
    // `outline-none` here would remove it from the most-used control in the
    // app and leave keyboard users with no idea where they are.
    const base = buttonVariants();
    expect(base).not.toContain("outline-none");
    expect(base).not.toMatch(/\bfocus:outline-none\b/);
  });

  it("keeps the affordance on every variant", () => {
    // The press is on the base, so a new variant inherits it rather than
    // silently becoming the one control in the app that does not respond.
    for (const variant of [
      "default",
      "destructive",
      "outline",
      "secondary",
      "ghost",
      "link",
    ] as const) {
      expect(
        buttonVariants({ variant }),
        `the ${variant} variant must still respond to a press`
      ).toContain("active:scale-[0.97]");
    }
  });

  it("lets a caller add a class without losing the affordance", () => {
    expect(buttonVariants({ className: "h-8 text-xs" })).toContain(
      "active:scale-[0.97]"
    );
  });
});
