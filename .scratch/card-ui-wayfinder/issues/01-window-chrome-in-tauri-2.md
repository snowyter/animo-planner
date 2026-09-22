# 01 — Can Tauri 2 give us a unified title bar and Mica, and what does it cost?

Type: research
Lane: AFK
Status: resolved
Blocked by: None — can start immediately
Map: [map.md](../map.md)

## Question

On Windows 11 (and falling back on Windows 10), can Animo Plan replace the native title bar with its own header — macOS "unified toolbar" style — and put a **Mica** (or Acrylic) window material behind it, using Tauri 2 on WebView2?

Find out, from primary sources (Tauri 2 docs and source, `window-vibrancy`, WebView2 and Windows App SDK docs):

- The mechanism: `decorations: false` + a drag region vs `titleBarStyle`/overlay; `data-tauri-drag-region`; `windowEffects` / `window-vibrancy`'s `apply_mica`; whether a transparent webview background is required and what that does to rendering cost.
- Whether **Snap Layouts** (hover on maximise), double-click to maximise, drag to dock, resize edges, and keyboard shortcuts survive a custom title bar on Windows 11 — and what code it takes to keep them.
- Behaviour on **Windows 10**: what Mica falls back to, and whether the app needs a solid-colour path.
- Whether a Mica-backed transparent window changes GPU/battery cost measurably, or interacts with `backdrop-filter` inside the webview.
- What the same header needs on **macOS** later (traffic-light inset, `titleBarStyle: Overlay`) so today's layout does not preclude it.
- Any new crate or plugin this would take, and its licence — dependencies need the human's approval (`docs/agents/dependencies.md`).

Recommend adopt / adopt without Mica / keep native chrome, with the reason.

## Answer

**Adopt a custom title bar; defer Mica.** Findings: branch `research/window-chrome`, file `docs/research/window-chrome.md` (commit `2cb7ba5`, local only).

- **Custom header on Windows via `decorations: false` — no new dependency.** Drag, double-click-maximise, drag-to-edge docking, resize edges, and Win+arrow survive (verified in `tauri`/`tao`/`wry` source at the lockfile's versions). Win+Z is expected to survive but wants a manual check.
- **Lost: the Snap Layouts flyout on maximise-button hover.** WebView2 blocks it and Tauri won't restore it in v2 (tauri#4531). Small in practice: `minWidth: 1024` already keeps the window out of half-screen snap zones on most laptops.
- **Mica deferred.** It needs a fully transparent window: Windows 10 falls through to see-through (Tauri ignores the failure silently), the tint would have to follow the in-app theme, WebView2 flashes white, macOS transparency needs `macOSPrivateApi` (blocks the App Store), no primary source measures its GPU/battery cost, and it degrades to solid when unfocused or on Battery Saver. `backdrop-filter` inside the header cannot see it. The header gets an opaque token-driven background.
- **macOS later:** `titleBarStyle: Overlay`, not `decorations: false`. The header keeps its leading edge free for the traffic lights; minimise/maximise/close are a Windows-only trailing component.
- A future Mica with exact Windows 10 detection would need `window-vibrancy` 0.6 (Apache-2.0 OR MIT) as a direct dependency — not pre-approved.
