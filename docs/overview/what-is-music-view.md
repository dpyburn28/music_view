# What is music_view?

**music_view** is a desktop Electron app that turns local music into a **portrait (TikTok-sized) visual stage**. You pick a track, lyrics, and a visual *look* (layout + display shaders); the app draws album art, track info, scrolling lyrics, progress, and optional audio visualizations, then runs a stack of WebGL postprocess effects over the full frame.

It is **not** a DAW or streaming client. Playback is local files; looks are JSON presets; effects are GLSL packages.

## Goals

- **Portrait-first display** — author for 1080×1920; the live stage letterboxes that frame.
- **Live look editing** — tweak FX and object layout while music plays.
- **Presets as looks** — save/load visual state without binding to a song.
- **Performances as shows** — sequence song sections + looks with audio and visual transitions.
- **Authorable FX** — new looks via shader packages + presets, not custom app code.
- **Audio-reactive viz** — scope / history / beat / ARTEF4KT driven by real-time analysis.

## Workspace

One landscape **Workspace** window. Music, Controls, and Performance are docks in that document (not separate product windows).

| Pane | Role | Primary files |
|------|------|----------------|
| **Stage** | Portrait `.app-shell` inside `#stage-slot` | `renderer.js`, `shaders.js`, `main.css` |
| **Music** | Library, transport, lyrics, analysis | `music.js`, `audio-analysis.js` |
| **Controls** | Look (FX, presets, background, render FPS) and Object (containers) | `controls.js` |
| **Performance** | Clip list + show transport (starts collapsed) | `performance.js` |

**Present** hides chrome (docks / toolbar). **Fullscreen** is a separate OS fullscreen toggle. **Reset Layout** (View menu) restores dock sizes.

Main process (`app.js`) creates the workspace, brokers leftover IPC, loads songs/presets/performances from disk, and serves local audio via a custom `song://` protocol. In the workspace, Music ↔ stage ↔ Controls talk over `workspace-bus.js` (in-process).

## Feature summary

### Music & library

- Scans a configured **Songs** directory for common audio formats.
- **Import from a Spotify track link** (Music → Library) writes audio + optional `.lrc`.
- Optional sidecar **`.lrc`** lyrics (same basename as the audio file).
- Cover art from embedded tags when present.
- Playback, seek, lyric focus (prev / current / next lines). Dual-deck crossfade for shows.
- Live **audio analysis**: waveform, bands, beat/energy. Music publishes **lead** (incoming track) and **mix** (audible blend) taps.
- Per-container **audio input** (Controls → Object → Audio): channel, gain, and **continuous** (follow the mix across fades vs jump to the next track).
- Empty-lyrics glitch FX settings published to the stage.

### Scene / layout

- **Floating containers** with unique roles: cover, track info, lyrics, progress, audio scope/history/beat, ARTEF4KT.
- Geometry in the **1080×1920 design frame** (`layoutSpace`), or **relative** placement (center, below another role, width of panel).
- Borders, connection lines, labels, layer order, wander motion, distancing.
- Per-container **shader** fill (e.g. audio scope GLSL, ferrofluid beat).
- Click-to-select containers on the stage and a live object editor in Controls.
- A configurable **bottom strip** under the stage, with optional float-area behavior and color/height controls.
- **Stage background** behind the panels: solid color (default white), a container-role shader, a still image, or a looping video, plus its own FX stack (Background FX). Saved in presets and in performance look snapshots.

### Look / postprocess

- Ordered **FX stack** of postprocess shaders (LCD, CRT, VHS, grain, thermal, toolkit grade/optics/glitch, …).
- Per-layer enable, reorder, package swap, and uniform editing.
- **Per-container FX stacks** in addition to the global scene stack.
- **Show FX** on a performance: the same stack language, composited **after** each clip look.
- Schema-driven UI: sliders, toggles, segmented enums, color, steppers, groups, Basic|All.
- **Param modulation**: animate continuous floats with time / sine / triangle / square / noise LFOs (stack, wall, or song clock).
- **Visual presets** under `presets/*.json` (layout + styles + FX + background + modulators — not the current song).
- **Performances** under `performances/*.json` (clips + look snapshots including background + transitions).
- **Render frame rate** on Look → Render (`Native` or 12–60). Caps background, panel, and Look FX draws. Stored in user settings, not in presets.

### Built-in shader packages

| Id | Typical role | Notes |
|----|--------------|--------|
| `default` | container | Color wash (also usable as a stage fill) |
| `bg-floral-pcb`, `bg-metal-split`, `bg-barcode-escalate`, `bg-desert-signal`, `bg-ink-orbit`, `bg-polar-cross`, `bg-number-field`, `bg-number-cascade`, `bg-flow-grain`, `bg-bayer-sky`, `bg-starburst`, `bg-line-halftone` | container (stage fill) | Generative backgrounds. No `u_scene`. `u_speed = 0` freezes motion. |
| `levels`, `contrast-sat`, `hue-shift`, `duotone`, `color-balance`, `posterize`, `invert` | postprocess | Grade / color toolkit |
| `bloom`, `vignette`, `chromatic`, `blur`, `barrel`, `sharpen`, `clamp-tonemap` | postprocess | Optics toolkit |
| `feedback-trail`, `echo-smear`, `rgb-glitch`, `warp-ripple`, `warp-noise`, `pixelate`, `block-corrupt` | postprocess | Motion / chaos toolkit |
| `outline`, `halftone`, `crosshatch`, `mirror`, `crop-zoom` | postprocess | Style + utility toolkit |
| `grain`, `dither`, `lcd`, `lcd2`, `crt`, `vhs`, `led-matrix`, `phosphor`, `oled`, `mono-lcd`, `projector`, `thermal` | postprocess | Grain / display-sim looks |
| `audio-scope`, `audio-history`, `audio-beat`, `audio-ferrofluid` | container | Live analysis textures / uniforms |

Catalog: `shaders/index.json`. Authoring: [Authoring → shaders](../authoring/shaders.md).

## What is intentionally *not* in scope (today)

- Cloud streaming APIs, accounts, or playlists as a product surface.
- ML stem separation (vocals channel is M/S + band heuristics only).
- Undo history for look edits.
- Full modular node graph for parameters.
- Audio-driven modulators as first-class LFO sources (planned backlog).

See [Roadmap](../roadmap/backlog.md) for planned work.
