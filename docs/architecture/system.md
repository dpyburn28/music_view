# System architecture

## Processes & surfaces

| Layer | Technology | Responsibility |
|-------|------------|----------------|
| Main | Node / Electron (`app.js`) | Workspace window, leftover IPC, presets / performances FS, music library FS, user settings, application menu, `song://` + `media://` protocols |
| Preload | `preload.js` | `contextBridge` → `window.musicView` (no Node in pages) |
| Workspace | One Chromium page | Music dock, portrait stage, Controls dock, Performance strip |

Security defaults: `contextIsolation: true`, `nodeIntegration: false`.

Tool scripts (`src/music/music.js`, `src/controls/controls.js`, `src/renderer/performance.js`, `src/renderer/renderer.js`) run in the **same document**. They talk through `src/workspace/workspace-bus.js` (in-process). `window.musicView` stays the preload object — never overwrite it; use `musicViewApi()` / `__musicViewIpc` when wrapping.

Standalone HTML files (`legacy/controls.html`, `legacy/music.html`, `legacy/performance.html`, `legacy/index.html`) remain in the tree as leftovers and are **not launched**.

## Module map

| File | Surface | Purpose |
|------|---------|---------|
| `app.js` | main | Window lifecycle, IPC handlers, protocol, application menu |
| `preload.js` | preload | Bridge API |
| `src/main/user-settings.js` | main | `userData/user-settings.json` (workspace window + docks + present + `render.fps`) |
| `workspace.html` / `src/workspace/*.css` / `src/workspace/*.js` | workspace | Shell, `#stage-slot`, dock sizes; `#dock-show` collapsed by default |
| `src/workspace/workspace-load.js` | workspace | First-paint `#app-load` overlay + later slim busy bar |
| `src/workspace/workspace-hotkeys.js` | workspace | Single Space / Esc / 1–2 / `[` `]` router |
| `src/workspace/workspace-bus.js` | workspace | In-process flags on (`inProcessDisplay`, `inProcessAudio`, `inProcessPerfFanout`, …) |
| `src/shared/layout-space.js` | shared | 1080×1920 design frame, normalize presets / performances |
| `src/shared/audio-input.js` | shared | Per-container `audioInput` sanitize / defaults |
| `src/main/music-library.js` | main | Song scan, LRC parse, cover/metadata |
| `src/main/presets.js` | main | List/load/save/delete preset JSON |
| `src/main/performances.js` | main | List/load/save/delete + validate performances, compose Show FX |
| `src/renderer/renderer.js` | stage | Containers, scene commands, capture, music consumers |
| `src/renderer/shaders.js` | stage | WebGL renderer + postprocess stack |
| `src/shared/param-mod.js` | shared | Pure LFO resolve (also Node-exportable) |
| `src/controls/controls.js` | controls | Look/Object UI (IIFE; `window.__musicViewControls`) |
| `src/music/music.js` | music | UI + publish streams (IIFE; `window.MusicViewMusic`) |
| `src/renderer/performance.js` | stage | Showcase conductor (IIFE; `window.MusicViewShow`) |
| `src/music/audio-analysis.js` | music | Web Audio graph + dual-deck mix + channel isolation |
| `src/renderer/artef4kt-host.js` | stage | Mount ARTEF4KT embed |
| `src/renderer/scene-match.js` | stage + node | Morph vs crossfade scorer |

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

`listSongs`, `loadSong`, `loadLyrics`, `getCover`, `getSongDisplayInfo` — main-process FS + metadata.

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
| Songs directory | Hardcoded candidates in `src/main/music-library.js` |
| Design frame | 1080×1920 in `src/shared/layout-space.js`; live stage letterboxes |
| Workspace geometry / docks / render FPS | `userData/user-settings.json` |
| Shader catalog | `shaders/index.json` |
| Default look | `presets/default.json` |
| Music analysis prefs (detect / send rate) | `localStorage` in the Music dock |
| Per-panel audio routing | Container `audioInput` (presets / performances) |
