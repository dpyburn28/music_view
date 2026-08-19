# How it works

End-to-end picture of a running session: music in, pixels out.

## High-level data flow

```
┌─────────────┐  in-process     ┌──────────────┐  in-process    ┌─────────────┐
│ Music dock  │ ──────────────► │ workspace-   │ ◄──────────── │ Controls    │
│ analysis +  │  now-playing,   │ bus + stage  │  commands +   │ Look/Object │
│ transport   │  audio-frame    │ src/renderer/ │  state push   │             │
└─────────────┘                 └──────────────┘               └─────────────┘
                                        ▲
                                        │ show state / Go
                                 ┌──────┴───────┐
                                 │ Performance  │
                                 │ dock         │
                                 └──────────────┘
```

1. **Music** loads a song from disk (`src/main/music-library.js` + `song://` stream), plays it on `#audio-a` / `#audio-b`, parses LRC, and runs `src/music/audio-analysis.js`.
2. Music **publishes** now-playing metadata, lyric focus, progress, empty-lyrics FX, and binary audio frames on the workspace bus (`src/workspace/workspace-bus.js`). No JSON clone on `audio-frame`.
3. **Controls** calls `musicView.sendCommand(command, payload)` (in-process `sceneCommand` in the workspace). The stage replies with `{ ok, state? }` and also **pushes** state on changes so Controls stay live.
4. **Workspace** hosts the portrait stage (`.app-shell` inside `#stage-slot`). Display logic: container DOM/layout, canvas drawing, container WebGL, per-container FX, and the full-frame postprocess stack. It loads the **default** visual preset at startup. Capture still sees only `.app-shell`, not the toolbar or docks.
5. **Performance** (when a show is loaded) drives Music transport + `applySceneTransition` so looks morph or cut with the clips. When auto/morph only the stage fill changes, the outgoing shader or video keeps rendering on a fade layer (it is not a still frame). A forced **crossfade** still freezes the whole composite.
6. The UI layer in Controls is intentionally live: it merges updates for uniform and modulator edits, preserves focus while scrubbing values, and keeps preset selections and object selection synchronized without a full reset.

## Frame composition (stage)

Each frame roughly:

```
Stage background (solid white default, or shader / image / video)
        │
        ▼
  optional Background FX stack (processes only the fill)
        │
        ▼
  Doodles (top-canvas) + floating containers
        │
        ▼
  overlay-canvas (borders / connect lines)
        │
        ▼
  Capture composite into a texture (postprocess input)
        │
        ▼
  Look FX stack (ordered WebGL passes)
        optional Show FX layers appended after the look
        each pass: sample previous (u_scene), write next
        optional u_prev feedback on some layers
        │
        ▼
  #postprocess-canvas  →  what the user sees as the “final look”
```

- **Container shaders** (e.g. audio scope) render into their own WebGL canvases inside each floating box; those canvases are part of the capture.
- **ARTEF4KT** owns a Three.js canvas in the same panel; capture includes it.
- **Postprocess** shaders *must* sample `uniform sampler2D u_scene` (the composited stage). They should not assume other textures unless the stack injects them (`u_prev` for feedback when declared).

## State ownership

| Data | Source of truth | In visual presets? |
|------|-----------------|--------------------|
| Containers (geometry, style, shaders, modulators, `audioInput`) | Stage | **Yes** |
| Postprocess stack | Stage | **Yes** |
| Per-container postprocess stacks | Stage | **Yes** when non-empty |
| Bottom strip layout (`color`, `heightRatio`, `includeInFloatArea`) | Stage | **Yes** |
| Stage background (`mode`, color / shader / media, background FX) | Stage | **Yes** |
| `layoutSpace` | Stage / files | **Yes** (`design-1080x1920`) |
| Active preset name | Stage / Controls | meta only |
| Show FX (`showFx`) | Performance document | In **performances**, not presets |
| Render frame rate (`render.fps`) | User settings | **No** (`0` = native) |
| Current song, cover bitmap, lyrics lines | Music → stage runtime | **No** |
| Playback time / progress fill | Music → stage runtime | **No** |
| Live analysis uniforms / textures | Music → stage each frame | **No** (not saved) |
| UI chrome (open groups, Basic\|All, selected tab) | Controls local | **No** |

Presets are **visual only**. Loading a look never changes the current track.

## Parameter path (Look / Object floats)

```
controls.json defaults
    → layer.uniforms / container.shaderUniforms  (base values)
    → optional modulators (param-mod.js)         (per-frame resolve)
    → optional live audio values                  (override after mod)
    → gl.uniform* upload
```

Important:

- **Base values** are what presets store under `uniforms` / `shaderUniforms`.
- **Modulators** are sibling maps (`modulators` / `shaderModulators`).
- **Live audio** overrides (e.g. beat/energy-driven uniforms) are *not* written into presets; they ride on top while analysis runs. Which channel they come from is stored as `audioInput`.
- The Controls editor applies these in the same order while preserving active ranges and minimal UI churn.

## Shader packages

Packages live under `shaders/<id>/` and are listed in `shaders/index.json`. Catalog listing (`listShaders`) fetches `controls.json` in parallel and does **not** pull every fragment. The frag source loads when a package is applied. Controls builds widgets from the same metadata (Look FX, per-container FX, Background, and panel fills). Basic|All on the Look tab refreshes both Look FX and Background uniforms.

Roles:

- **`postprocess`** — may appear in the FX stack (Look, per-container, or Background FX); must use `u_scene`.
- **`container`** — may fill a floating panel **or** the stage (`background.mode = shader`); full-screen style UV over that surface. No `u_scene`.

WebGL loops (background fill, panel fills, Look FX) share `window.__musicViewRenderFps` (`0` = native). A cap skips draws; `u_time` is still wall-clock.

Details: [Authoring → shaders](../authoring/shaders.md).

## Clocks used by modulators

| Clock | Meaning |
|-------|---------|
| `stack` (default) | Seconds since postprocess stack / renderer start (`u_time` family) |
| `wall` | Wall-clock seconds |
| `song` | Playback position seconds (when available from music) |

See [param-modulation](../authoring/param-modulation.md).

## Boot sequence (simplified)

1. Electron ready → register `song://` + `media://` → create the **workspace** window.
2. `workspace.html` paints `#app-load` immediately (`src/workspace/workspace-load.js`) so the first frame is a progress overlay, not an empty grid.
3. Workspace loads docks, stage (`src/renderer/renderer.js`), Music, Controls, Performance. Overlay steps: stage, default look, shader catalog, presets, library.
4. Stage builds song panels + audio viz + ARTEF4KT, starts postprocess capture, then `loadAndApplyPreset('default')`.
5. Shader catalog metadata loads in parallel. User settings apply dock sizes and `render.fps`.
6. Overlay hides when the workspace is ready. Later look / track / library loads use a compact busy bar instead of the full card.
7. Display-ready / music-ready fire in-process; user picks a track → now-playing + analysis stream.

## Mental model for contributors

- **Stage (`src/renderer/renderer.js`)** = engine + scene graph.
- **Controls** = editor UI over the workspace bus.
- **Music** = content + analysis publisher.
- **Performance** = conductor for saved shows.
- **Presets / shaders / performances** = data-driven content, not app forks.
- Prefer additive schema (`controls.json` UI fields, preset modulators, `audioInput`) over breaking renames of uniform names.
