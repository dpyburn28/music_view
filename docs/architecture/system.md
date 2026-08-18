# System architecture

## Processes & surfaces

| Layer | Technology | Responsibility |
|-------|------------|----------------|
| Main | Node / Electron (`app.js`) | Workspace window, leftover IPC, presets / performances FS, music library FS, user settings, application menu, `song://` + `media://` protocols |
| Preload | `preload.js` | `contextBridge` → `window.musicView` (no Node in pages) |
| Workspace | One Chromium page | Music dock, portrait stage, Controls dock, Performance strip |

Security defaults: `contextIsolation: true`, `nodeIntegration: false`.

Tool scripts (`music.js`, `controls.js`, `performance.js`, `renderer.js`) run in the **same document**. They talk through `workspace-bus.js` (in-process). `window.musicView` stays the preload object — never overwrite it; use `musicViewApi()` / `__musicViewIpc` when wrapping.

Standalone `controls.html` / `music.html` / `performance.html` / `index.html` remain in the tree as leftovers and are **not launched**.

## Module map

| File | Surface | Purpose |
|------|---------|---------|
| `app.js` | main | Window lifecycle, IPC handlers, protocol, application menu |
| `preload.js` | preload | Bridge API |
| `user-settings.js` | main | `userData/user-settings.json` (workspace window + docks + present + `render.fps`) |
| `workspace.html` / `.css` / `.js` | workspace | Shell, `#stage-slot`, dock sizes; `#dock-show` collapsed by default |
| `workspace-load.js` | workspace | First-paint `#app-load` overlay + later slim busy bar |
| `workspace-hotkeys.js` | workspace | Single Space / Esc / 1–2 / `[` `]` router |
| `workspace-bus.js` | workspace | In-process flags on (`inProcessDisplay`, `inProcessAudio`, `inProcessPerfFanout`, …) |
| `layout-space.js` | workspace | 1080×1920 design frame, normalize presets / performances |
| `audio-input.js` | workspace | Per-container `audioInput` sanitize / defaults |
| `music-library.js` | main | Song scan, LRC parse, cover/metadata |
| `spotify-import.js` | main | Spotify track URL → songs dir + optional `.lrc` |
| `presets.js` | main | List/load/save/delete preset JSON |
| `performances.js` | main | List/load/save/delete + validate performances, compose Show FX |
| `renderer.js` | stage | Containers, scene commands, capture, music consumers |
| `shaders.js` | stage | WebGL renderer + postprocess stack |
| `param-mod.js` | stage + controls | Pure LFO resolve (also Node-exportable) |
| `controls.js` | controls | Look/Object UI (IIFE; `window.__musicViewControls`) |
| `music.js` | music | UI + publish streams (IIFE; `window.MusicViewMusic`) |
| `performance.js` | performance | Showcase conductor (IIFE; `window.MusicViewShow`) |
| `audio-analysis.js` | music | Web Audio graph + dual-deck mix + channel isolation |
| `artef4kt-host.js` | stage | Mount ARTEF4KT embed |
| `scene-match.js` | stage + node | Morph vs crossfade scorer |

## Communication

### Control → stage (request/response)

In the workspace, `sendCommand` calls `sceneCommand` in-process (cloned result). The same `musicView.sendCommand` API still exists for leftover IPC.

Return shape: `{ ok, error?, state? }`.

### Stage → Controls (push)

`publishState` / `onState` are in-process on the workspace bus (coalesced). Controls can also pull `getState`.

### Music → stage (fire-and-forget)

| Channel | Payload |
|---------|---------|
| `now-playing` | title, artist, album, cover data URL, lyrics lines |
| `lyric-focus` | prev / current / next text + index |
| `playback-progress` | fraction, times |
| `audio-frame` | `lead` + `mix` taps: levels, waveform `Uint8Array`, channels |
| `empty-lyrics-fx` | glitch parameters |

### Music library (invoke)

`listSongs`, `loadSong`, `loadLyrics`, `getCover`, `getSongDisplayInfo`, `importSpotifyTrack`, `probeSpotifyImport` — main-process FS + metadata + optional Spotify import.

### Presets & performances (invoke)

`presets-list` / `presets-load` / `presets-save` / `presets-delete` — `presets/`.  
`listPerformances` / `loadPerformanceFile` / `savePerformanceFile` / `deletePerformanceFile` — `performances/`.

**Export content** for looks is still built on the stage (`exportPreset`); Controls asks the stage to export, then calls `savePresetFile`.

### User settings (invoke)

`settings-get` / `settings-set` / `settings-reset` — `user-settings.js` under `app.getPath('userData')/user-settings.json`.  
Schema: `window` + `docks` + `present` + `render` (`fps`: `0` = native, otherwise 1–240; Look UI offers Native and 12–60). Workspace applies dock sizes and the FPS cap on boot. **Reset Layout** writes defaults and applies without reload. FPS is not stored in presets.

### Application menu

`Menu.setApplicationMenu` in `app.js`. View → **Present Stage**, **Fullscreen Stage**, **Toggle Docks**, **Reset Layout** send `workspace-command`. Present hides chrome; Fullscreen is OS fullscreen; they are independent.

## Display command surface

Full list: [reference/commands.md](../reference/commands.md).

Grouped:

- **State:** `getState`, `listShaders` (parallel `controls.json` only), `selectContainer`
- **Containers:** add/remove/duplicate/visible/role, shader apply/clear, uniforms, modulators
- **Stage background:** mode / shader apply-clear / media / Background FX stack
- **ARTEF4KT:** get/set settings, load look, list presets
- **Postprocess (global):** start/stop, add/remove/reorder, layer shader/uniforms/modulators/enabled, full stack set
- **Postprocess (per container):** same stack ops scoped by container `id` + `layerId`
- **Presets / snapshots:** `exportPreset`, `applyPreset`, `loadPreset`, `applySceneSnapshot`, `applySceneTransition`

## WebGL

- Prefer **WebGL2**, fall back to WebGL1.
- Fragment sources are wrapped with `precision`, `v_uv`, `u_time`, `u_resolution` (`buildFragmentSource` in `shaders.js`).
- User uniforms: `float`, `vec2`–`vec4` arrays; textures via `setTexture2D` (R8/LUMINANCE or RGBA).
- Postprocess: ping-pong FBOs; each enabled layer samples `u_scene`; optional `u_prev` enables feedback texture.
- Container postprocess: each panel may own a stack (`createPostprocessStack` on a per-box canvas); capture is that panel only; global stack then samples the composited scene.
- Re-applying the **same** shader package on a live viz container or background fill updates uniforms in place (does not replace the canvas or rewind `u_time`).
- A shared render-FPS gate (`window.__musicViewSetRenderFps`) skips draws in background, panel, and Look FX loops when a cap is set.
- Morphs that change fill identity keep the outgoing background WebGL/video on `#bg-transition-overlay` so the fade is live. Forced crossfade still snapshots the composite.

## GPU / CLI flags

Main appends Chromium switches for WebGL / accelerated 2D canvas (see `app.js`).

## Configuration surfaces (today)

| Concern | Where |
|---------|--------|
| Songs directory | Hardcoded candidates in `music-library.js` |
| Design frame | 1080×1920 in `layout-space.js`; live stage letterboxes |
| Workspace geometry / docks / render FPS | `userData/user-settings.json` |
| Shader catalog | `shaders/index.json` |
| Default look | `presets/default.json` |
| Music analysis prefs (detect / send rate) | `localStorage` in the Music dock |
| Per-panel audio routing | Container `audioInput` (presets / performances) |
