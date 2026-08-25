# 40 — [ui] Exporting the week grid produces a blank white image

**What to build:** A PNG export that contains the schedule. Today "Schedule image (.png)" saves a file of the right size and name whose contents are entirely white. Reproduced on a second machine by a different student, so it is not local state or a broken install.

**Blocked by:** None — can start immediately

**Status:** ready-for-agent

## The prime suspect, with its reasoning

`ExportMenu` renders a hidden 1200px-wide container and hands it to `html-to-image`:

```tsx
<div
  ref={imageExportRef}
  style={{
    position: "fixed",
    left: "-9999px",
    top: 0,
    width: "1200px",
    ...
  }}
```

```ts
await toBlob(container, { pixelRatio: 2, backgroundColor: "#ffffff", cacheBust: true })
```

`html-to-image` works by deep-cloning the node, copying **every computed style property onto the clone**, wrapping it in an SVG `<foreignObject>`, and rasterizing that. The clone therefore inherits `position: fixed; left: -9999px`. Inside the `foreignObject` those coordinates resolve against the SVG viewport, so the content is laid out roughly ten thousand pixels to the left of the frame being captured — off the canvas entirely.

What is left is the `backgroundColor: "#ffffff"` the call passes in. **That is why the image is white specifically rather than transparent or garbled**, and that agreement between mechanism and symptom is the reason to start here.

The off-screen position exists for a real reason — the node must still be laid out and measurable, so `display: none` is not an option — so the fix is to move the hiding up one level rather than delete it: **a wrapper carries the off-screen positioning, and the ref points at a statically positioned child.** Then the node handed to `toBlob` has nothing unusual to copy.

`html-to-image` also applies an options `style` object to the clone root, so overriding `position` at the call site is a one-line alternative. Prefer the wrapper: it depends on the component's own structure rather than on library internals, and it reads correctly to the next person.

## Why the tests did not catch it

`ExportMenu.test.tsx` never exercises the real path. Its image test does not render the component at all:

```ts
const onGenerateImage = vi.fn().mockResolvedValue(new Blob(["dummy-png-data"], …));
const blob = await onGenerateImage(dummyElement);
```

It calls the injected mock and asserts on the mock's own return value. `toBlob` has no coverage of any kind. The seam that made the component testable also made the defect invisible — the same shape as every other bug found running this app.

## Acceptance criteria

- [ ] **The exported PNG contains the schedule** — header, plan name, campus and session badges, and the full Mon–Sat grid with its blocks. Verified by exporting from a running app and opening the file, not by reasoning about the DOM
- [ ] **The node handed to the image library is not positioned off-screen.** The off-screen positioning moves to a wrapper; the captured node is statically positioned and measurable
- [ ] The container is still **invisible and inert in the app** — not on screen, not focusable, not in the accessibility tree, no layout shift, no horizontal scrollbar at any window width
- [ ] The export still renders at **1200px wide with explicit light-theme colours**, so the image is legible regardless of the window size or theme (ticket 22's intent)
- [ ] **Sections, conflict styling, and course hues survive the export.** Hue is course identity (ADR-0012); an export that flattens it is a broken export. Conflicts stay visible (ADR-0009)
- [ ] An export from a **plan with no sections** produces a readable empty grid with its header, not a blank file — a legitimately empty schedule and a failed export must not look the same
- [ ] **A failure is reported, not saved.** If the generated blob is empty or the library throws, the existing error alert shows and no file is written
- [ ] The **`.ics` export is unchanged** — it works today and shares this menu

## Testing

The suite renders to static markup, so `toBlob` cannot run under it. Pin what can be pinned, and it is more than it looks:

- [ ] **The rendered markup carries the fix.** The captured element gets a stable `data-testid`; a test asserts its inline style contains no fixed positioning and no negative offset, and that the wrapper is the thing carrying them. This fails against today's code and passes after the fix — verify that directly by reverting the change and watching it go red, rather than assuming
- [ ] A test covers the export container rendering the plan's sections and its header, so a future refactor cannot quietly empty it
- [ ] The existing menu tests keep passing; do not delete the injected `onGenerateImage` seam, which is what lets the rest of the flow stay testable

## If the wrapper does not fix it

Verify before moving on — instrument the real call rather than guessing again. In order of likelihood:

1. **Rasterization races the styles.** `html-to-image` is widely reported to return a blank or partial first frame in Chromium when webfonts or stylesheets have not settled; the usual tell is that a second call succeeds. If a repeated call renders correctly, the fix is to await readiness, not to call it twice and hope
2. **A colour function the serializer cannot handle.** This project is on Tailwind v4, whose palette is `oklch()`. WebView2 is modern enough, but if a specific declaration breaks the `foreignObject`, it will fail silently and blankly, exactly like this
3. **`pixelRatio: 2` at 1200px** — a 2400px-wide canvas is not large, but a canvas that fails to allocate returns nothing rather than erroring

Whatever it turns out to be, say so in the commit message. A blank export that "works now" without a named cause will come back.
