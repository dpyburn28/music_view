# Changelog

Running app update log. Newest entries first.

## 2026-08-18

### Song list cover art

Music dock shows a **36×36 thumbnail** per track. Cover art is extracted from embedded `METADATA_BLOCK_PICTURE` via `music-metadata` and cached in-renderer so subsequent scrolls are instant. On first launch, `preloadCovers()` batch-loads all covers with 4 concurrent workers during the boot overlay — the list renders with covers already populated.

Each `<li>` now includes an **artist · genre** line below the title (metadata read during the same `listSongs` scan). Filter matches on artist and genre as well as title/filename.

Song list `min-height` raised to **520 px** so the library is readable without scrolling.

### Preset load — lyrics position preserved

`restackLyricsSnapshot` no longer overwrites explicit `left`, `top`, `width`, or `height` on the `song-lyrics` container when loading a preset or performance snapshot. Geometry set by the author (or a previous save) is kept; only missing or invalid values are filled by the restack math. This fixes the lyrics panel being pushed up to sit directly below `song-info` when a preset was saved with `bottomPanel.heightRatio: 0`.

`clampContainerInPanel` now early-returns when the clamped position matches the current position, preventing `syncDesignFromLive` from overwriting `layoutDesign` with live-pixel values for containers that don't need repositioning.

## 2026-08-15

### Spotify import

Music → Library accepts a Spotify **track** URL or `spotify:track:` URI. The main process resolves public metadata, downloads a matching recording with `yt-dlp`/`ffmpeg`, and writes an `.lrc` from LRCLIB when lyrics exist. Albums/playlists are rejected. Re-importing a title already on disk only fills missing lyrics.

The application menu now includes **Edit** (cut / copy / paste / select all) so `Cmd+V` works in text fields. The previous custom menu had no paste role, so macOS swallowed the shortcut.

Import no longer depends on a Homebrew `yt-dlp` from 2024 (YouTube returns “Please sign in”). The first import downloads a current official yt-dlp into the app data folder, then retries with browser cookies if YouTube still blocks the request.

YouTube matching now requires the Spotify **title and artist** (plus a duration window). A more popular song that only shares the name is skipped. Re-import overwrites the previous `Artist - Title.mp3` so a bad grab can be fixed.

### Render frame rate

Look → **Render → Frame rate** caps background shaders, panel shaders, and Look FX (`Native` or 12–60). Stored in user settings, not in presets.

### Performance backgrounds

Look snapshots already stored `scene.background`. When layout and FX still match, auto **morphs** even if the fill identity changes (shader↔video, image↔shader, image↔video, shader↔shader). Same solid color or same shader package lerps uniforms/color. Different fills fade the outgoing **live** shader or video over the incoming one — not a still of the last frame.

A forced **crossfade** still freezes the whole composite and fades that still.

Shader clocks no longer reset when a look is re-applied. Identical Look / background / panel FX stacks update uniforms in place instead of tearing down WebGL. Incoming packages compile before the swap so transitions do not stall for a compile frame.

### Loading

Workspace shows a first-paint overlay with percent and step text (stage, default look, shader catalog, presets, library). After boot, look/track/library loads use a compact busy bar. Shader catalog listing fetches controls metadata in parallel and no longer pulls every fragment on `getState`.

### Docs

Overview, architecture, authoring, and reference now match the live contract: container-role stage fills (`bg-*`), Look → Render FPS in user settings, boot overlay, Capture current includes `scene.background`, and auto morph uses a live outgoing fade (forced crossfade still freezes).

## 2026-08-14

### Stage background (Controls → Look)

The white stage is now a controllable **Background**: default remains a blank white solid. Mode can be **Solid**, **Shader** (container-role package), **Image**, or **Video**, plus its own FX stack (same postprocess packages as Look / panel FX). Image and video pickers use a native dialog and `media://` streaming. Saved in presets as `scene.background`.

Leaving shader mode (Clear, Solid/Image/Video, or a performance clip without a shader) **destroys the WebGL fill and replaces the canvas** so the last shader frame cannot stick. Performance snapshots carry `scene.background`. (Auto later **morphs** same-layout fill changes and keeps the outgoing shader/video live — see 2026-08-15.)

### Show progress bar

New unique role `show-progress` — same canvas bar as track progress, driven by the performance clock (`showTime` / one-loop duration, wraps when the show loops). Container Walk includes it on every look.

### Design-space layout

Container geometry, fonts, and strokes live in a **1080×1920** design frame (`layoutSpace`). The live stage letterboxes with a uniform scale. Existing presets and performances were normalized. Covers stay square; lyrics / progress type scale with the stage. Resize during playback reflows without drifting the composition.

### Show FX

A performance can carry a universal FX stack (`showFx`) composited **after** each clip look. Capture / export of a look strips those overlay layers.

### Container Walk

`performances/container-walk.json` — same eight containers every clip, morph on position + style, cover `contentFade`, lyrics/info/progress `textGlitch` (lands on the current lyric section). Later clips add Scope / History / Beat / ARTEF4KT.

### Per-container audio input

Display routing left Music. Each viz / ARTEF4KT panel has Object → **Audio**: analysis channel(s), gain, and **Continuous audio** (default on). Continuous follows the audible **mix** across dual-deck fades and does not reset history. Off jumps to the incoming track and clears accumulated state.

### Morph / viz stability

Re-applying the same shader package no longer replaces the WebGL canvas (end-of-morph white flash). Postprocess backing store is not stomped on resize. Lyrics decode retargets to the current song-time line.

### Controls

Look / Object docks scroll. Progress and other stage type scale with layout.

## 2026-08-13

### Single-window overhaul — complete (PRs 1–8)

One maximized workspace: Music, portrait stage, Controls, Performance strip. **Present** hides chrome; **Fullscreen** is separate; **Kiosk** is Present + fullscreen + auto-hidden menu (Esc confirms). Dock sizes persist; **Reset Layout** restores defaults. Four-window launch path removed. Plan: [docs/roadmap/fullscreen-single-window-plan.md](./roadmap/fullscreen-single-window-plan.md).

### Hide panel (not just the label)

The Object-list eye (`setContainerVisible`) now skips the panel in scene capture and overlay — content, border, and connectors — not only the external name. CSS opacity never reached the postprocess blit. **Show label** in Style is still the name-only switch.

### Container management (Controls)

Object tab is a panel list: **Add** (templates + vacant named roles), **Duplicate** (always generic), **Delete**, **Hide**, and a **Role** dropdown. Look load adds listed panels and prunes generic extras only — FX-only looks and omitted unique roles (ARTEF4KT on `default`) stay. Plan: [docs/roadmap/container-management-plan.md](./roadmap/container-management-plan.md).

### Performance timeline (v1)

Fourth **Performance** window conducts a saved showcase: song sections (in/out), full-scene look snapshots, audio crossfades (dual-deck), and visual cut/dip/morph/crossfade. Save/load under `performances/`. Plan: [docs/roadmap/performance-timeline-plan.md](./roadmap/performance-timeline-plan.md).

### Look preset library

Added **33** postprocess look presets (`look-*.json`) spanning grade, optics, temporal, glitch, graphic, and display hybrids (e.g. Warm Vinyl, Neon Bloom, Time Tunnel, Datamosh, Cyanotype, CRT Arcade). Load from Controls → Look → preset list. FX-only scenes (keep current layout when applied).

### Postprocess toolkit — Phases A–D (complete)

Full planned catalog of full-frame FX packages (Look → FX / per-container FX).

**A — grade + optics:** `levels`, `contrast-sat`, `bloom`, `vignette`, `chromatic`  
**B — motion + chaos:** `blur`, `pixelate`, `warp-ripple`, `rgb-glitch`, `feedback-trail`  
**C — style + optics:** `hue-shift`, `duotone`, `sharpen`, `barrel`, `outline`, `halftone`  
**D — utility + polish:** `invert`, `posterize`, `mirror`, `crop-zoom`, `clamp-tonemap`, `color-balance`, `warp-noise`, `block-corrupt`, `crosshatch`, `echo-smear`

Demo presets: `toolkit-clean-grade`, `toolkit-music-glow`, `toolkit-feedback-tunnel`, `toolkit-liquid-stage`, `toolkit-broken-broadcast`, `toolkit-terminal-poster`, `toolkit-print`, `toolkit-soft-dream`, `toolkit-echo-haze`, `toolkit-sketch`.  
Plan: [docs/roadmap/postprocess-toolkit-plan.md](./roadmap/postprocess-toolkit-plan.md).

## 2026-08-12

### ARTEF4KT integration (v1 embed + Controls)

- Vendored runtime under `vendor/artef4kt/` (Three.js ferrofluid visualizer from Tools).
- Host API: `artef4kt-host.js` → `createArtef4ktEmbed`.
- Display role **`artef4kt`**: floating container mounts the embed; resizes with the panel.
- Analysis from Music `audio-frame` only (no second transport / MediaElement).
- **Controls → Object → Engine**: ARTEF4KT look presets + live knobs (audio reaction, grid, scene, lights, environment, shockwave, filmic). **Overlays** group: info opacity + show/hide status, track/time, freq bars, progress, logo. **Camera** group: auto music motion, orbit/zoom/elevation intensity, fly-around, manual pose, canvas drag orbit, Reset cam. Track picker stays in Music.
- IPC: `getArtef4ktSettings`, `setArtef4ktSettings`, `loadArtef4ktPreset`, `listArtef4ktPresets`.
- Plan: [docs/roadmap/artef4kt-integration-plan.md](./roadmap/artef4kt-integration-plan.md).

<!-- Prior dated entries: if this file was reset during integration, restore older sections from backup if needed. -->
