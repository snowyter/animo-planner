/**
 * The one React Bits component in the app, and the conditions it was allowed
 * in under (`docs/agents/dependencies.md`).
 *
 * The assertions that matter are the ones the original component does NOT
 * satisfy: it ships dark-on-dark, it looks like it belongs on every card in a
 * list, and it is the kind of component whose natural next edit adds
 * `backdrop-filter` or `will-change`. Renders to static markup, like the rest
 * of the suite.
 */

import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SpotlightCard } from "./spotlightCard";

const render = (props: Partial<React.ComponentProps<typeof SpotlightCard>> = {}) =>
  renderToStaticMarkup(
    React.createElement(
      SpotlightCard,
      props as React.ComponentProps<typeof SpotlightCard>,
      React.createElement("p", null, "No saved plans yet")
    )
  );

describe("SpotlightCard", () => {
  it("renders its children rather than replacing them", () => {
    // The whole point is that it wraps an existing surface.
    expect(render()).toContain("No saved plans yet");
  });

  it("is light-only, because the app is light-only (ADR-0018)", () => {
    // The upstream component is a dark card: bg-neutral-900 with a white
    // spotlight. Neither survives here.
    const html = render();
    expect(html).not.toMatch(/neutral-900|bg-black|text-white/);
    expect(html).not.toContain("dark:");
  });

  it("never carries backdrop-filter or will-change", () => {
    // Both are banned outside ui/dialog.tsx: frosted glass and a permanent
    // compositor hint on a surface this size is paint the app cannot afford.
    const html = render();
    expect(html).not.toMatch(/backdrop-filter|backdrop-blur|will-change/);
  });

  it("hides the glow from assistive technology and from the pointer", () => {
    // It is decoration. It must never be read out, and it must never eat the
    // click meant for the button inside the card.
    const html = render();
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("pointer-events-none");
  });

  it("starts the glow at zero opacity, so the card is unchanged until pointed at", () => {
    expect(render()).toContain("opacity:0");
  });

  it("is idle at rest: no animation, no transition that runs forever", () => {
    // An idle app has zero continuously animating elements. The only
    // transition is the glow's own opacity, and it is finite.
    const html = render();
    expect(html).not.toMatch(/animate-|infinite/);
  });

  it("lets the caller keep the card's own shape and arrival", () => {
    const html = render({ className: "enter-rise rounded-panel" });
    expect(html).toContain("enter-rise");
    expect(html).toContain("rounded-panel");
  });
});
