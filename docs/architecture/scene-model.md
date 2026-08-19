# Scene model

The **scene** is everything Display owns that defines the visual layout (and what presets save).

## Top-level shape

```json
{
  "layoutSpace": "design-1080x1920",
  "containers": [ /* ordered list of container states */ ],
  "postprocess": {
    "active": true,
    "layers": [
      {
        "shaderId": "crt",
        "enabled": true,
        "uniforms": { "u_scanline": 0.5 },
        "modulators": { "u_scanline": { "source": "sine", "amp": 0.1, "rate": 0.3, "offset": 0.5 } }
      }
    ]
  },
  "bottomPanel": {
    "color": "#2563eb",
    "heightRatio": 0.25,
    "includeInFloatArea": false
  },
  "background": {
    "mode": "solid",
    "color": "#ffffff"
  }
}
```

`layoutSpace: "design-1080x1920"` means container `left` / `top` / `width` / `height` and type/stroke sizes are in that design frame. The live stage applies a **uniform** scale (`min(sx, sy)`) so the composition does not stretch. `layout-space.js` normalizes older files on load.

### Bottom strip (`bottomPanel`)

| Field | Meaning |
|-------|---------|
| `color` | CSS hex fill of the blue strip under the white stage |
| `heightRatio` | 0–1 of shell height (`0` = strip hidden, stage fullscreen) |
| `includeInFloatArea` | When true, floating containers may move/resize into the bottom strip |

Runtime may attach extra non-serializable fields (DOM elements, WebGL programs). Preset export strips those.

### Stage background (`background`)

Fill of the white stage (the region above the bottom strip), behind floating panels. Default is a **blank white solid**.

| Field | Meaning |
|-------|---------|
| `mode` | `solid` (default) · `shader` · `image` · `video` |
| `color` | CSS hex used in `solid` mode (default `#ffffff`) |
| `shaderId` / `shaderUniforms` / `shaderModulators` | Container-role package drawn as the fill when `mode` is `shader`. Same contract as a panel fill: no `u_scene`. Built-in `bg-*` packages typically freeze when `u_speed` is `0`. |
| `imageSrc` / `imagePath` / `imageName` / `imageMode` | Still image (`fill` / `scale` / `tile`) |
| `videoSrc` / `videoPath` / `videoName` / `videoMode` / `videoLoop` | Looping video (`fill` / `scale`) |
| `postprocess` | Own FX stack (`active` + `layers[]`), same package contract as Look FX. Processes **only** this fill, then containers composite on top, then the global stack. |

Missing `background` on old files: layout apply resets to white; FX-only apply leaves the live background.

Performance look snapshots include `background`. When the rest of the look matches, auto **morphs** and the outgoing fill keeps playing on a fade layer (shader/video do not freeze). Same solid color or same shader package lerps. A forced **crossfade** still freezes the whole composite.

## Containers

A container is a floating panel: geometry + style + optional content role + optional WebGL fill. At most one of each named role (`song-cover`, `song-info`, `song-lyrics`, `song-progress`, `show-progress`, `audio-scope`, `audio-history`, `audio-beat`, `artef4kt`). Extra panels are generic (`role` null). Persist `snapshotId` and `visible` (default true). Controls can add/remove/hide/duplicate; look apply prunes **generics only**.

### Roles

| Role | Content | Typical media |
|------|---------|----------------|
| `song-cover` | Album art | Image fill |
| `song-info` | Title / artist / album text | DOM text |
| `song-lyrics` | Lyric viewport | DOM / scroll |
| `song-progress` | Track progress bar + times | Canvas bar |
| `show-progress` | Show / performance progress bar + times | Canvas bar; `show-state` clock |
| `audio-scope` | Oscilloscope shader | WebGL + live wave |
| `audio-history` | Scrolling energy history | WebGL + ring buffer |
| `audio-beat` | Beat rings / pulse | WebGL + live scalars |
| `artef4kt` | ARTEF4KT Three.js ferrofluid | Host canvas + `audio-frame` (no GLSL package) |
| _(null / other)_ | Generic | text or shader |

Role-aware Controls UI hides irrelevant fields (e.g. free text on song cover).

### Geometry

- Absolute: `left`, `top`, `width`, `height` in the **1080×1920 design frame** (`scene.layoutSpace: "design-1080x1920"`). Live stage size only scales that frame.
- Relative helper object `relative` (examples from presets):
  - `widthOfMin`, `widthOfPanel`, `maxWidth`
  - `centerX`, `centerYOffset`
  - `belowRole` + `gap`
  - `bottomInset`

Null absolute fields often mean “driven by relative layout”.

### Motion & stacking

| Field | Meaning |
|-------|---------|
| `layer` | Z-order |
| `wander` | Auto drift |
| `wanderAmplitude`, `wanderFrequency` | Wander shape |
| `distancing` | Keep-out radius vs others |
| `connect` | Draw line to another container |
| `attachToRole` / `anchorDistance` | Soft attachment |

### Style

Nested under `style`:

- `border` — color, lineWidth, dash
- `connect` — line style when connect is on
- `label` — font, color, background, opacity, corner via `labelCorner`

### Shader fill

| Field | Meaning |
|-------|---------|
| `shaderId` | Package id or null |
| `shaderUniforms` | Base uniform map |
| `shaderModulators` | Optional LFO map (float keys only) |
| `imageMode` | e.g. `fill` / `scale` for image roles |
| `progressTimeMode` | Progress panel time display mode |
| `contentFade` | Seconds to crossfade cover art on track change |
| `textGlitch` | Seconds to decode lyrics / info / progress text |
| `audioInput` | Viz / ARTEF4KT: channel, gain, `continuous` |
| `embed` | ARTEF4KT only: `{ engine, settingsId, quality, settings }` |
| `visible` | Hide from capture + overlay; keep layout |

Live analysis can call `setLiveUniforms` / `setTexture2D` on the container’s renderer without mutating saved uniforms. Which channel feeds each viz / ARTEF4KT panel is stored on the container as `audioInput` (Controls → Object → Audio). `continuous: true` (default) uses the audible **mix** tap and does not reset history on a track change.

## Postprocess stack

| Field | Meaning |
|-------|---------|
| `active` | Global FX on/off |
| `layers[]` | Bottom → top processing order |
| `layers[].id` | Runtime numeric id (not required in preset files; rebuilt on apply) |
| `layers[].shaderId` | Package with `roles` including `postprocess` |
| `layers[].enabled` | Skip pass when false |
| `layers[].uniforms` | Base values |
| `layers[].modulators` | Optional LFOs |

Capture feeds the first enabled pass as `u_scene`; each pass’s output becomes the next `u_scene`.

**Show FX** (`showFx` on a performance, not on a look) is the same layer shape. Runtime composes **look layers, then tagged show layers**. Capture / export of a look strips `_showFx` layers.

## Selection

`selectedContainerId` is UI-only (click-to-select + Controls Object tab). **Not** written into presets.

## Export / apply

- **Export:** Display walks live containers + stack → JSON (version 1 preset envelope).
- **Apply:** Display rebuilds stack programs and container properties; music content remains whatever is currently playing. Container geometry is preserved when explicit pixel values are present — `restackLyricsSnapshot` only fills missing/invalid fields on `song-lyrics`; `clampContainerInPanel` skips containers already within bounds.

See [Authoring → presets](../authoring/presets.md).
