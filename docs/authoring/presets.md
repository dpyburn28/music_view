# Authoring visual presets

Presets capture a **look**: layout, styles, container shaders, postprocess stack, and optional modulators. They never include the current song, lyrics text, or analysis state. Container geometry, font sizes, padding, and stroke widths are stored in the **1080×1920 design frame** (`scene.layoutSpace`). The stage projects that frame uniformly when the window is smaller.

## File location & naming

```
presets/<stem>.json
```

| Rule | Detail |
|------|--------|
| Stem | `^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$` |
| Reserved | `default` — always present; cannot be deleted via API |
| Storage | Main process `presets.js` only |

Display name inside JSON (`name`) may be human-readable (`"Breathing CRT"`); file stem stays machine-safe (`breathing-crt`).

## Envelope schema (version 1)

```json
{
  "version": 1,
  "name": "Display Name",
  "createdAt": "2026-08-07T00:00:00.000Z",
  "updatedAt": "2026-08-07T00:00:00.000Z",
  "scene": {
    "layoutSpace": "design-1080x1920",
    "containers": [ /* … */ ],
    "postprocess": {
      "active": true,
      "layers": [ /* … */ ]
    },
    "bottomPanel": {
      "color": "#111111",
      "heightRatio": 0,
      "includeInFloatArea": true
    },
    "background": {
      "mode": "solid",
      "color": "#ffffff"
    }
  }
}
```

`presets.js` rewrites `version`, `updatedAt`, and requires `scene` on save. Extra top-level keys are not required.

**Layout vs FX-only:** if `scene.containers` is missing, not an array, or `[]`, apply is **FX-only** (postprocess + bottom strip + `background` when present; panel set unchanged). A non-empty `containers` list updates/spawns those panels and **prunes generic extras** only — unique roles omitted from old files stay.

`scene.background` is optional. Layout apply with the key missing resets to a **blank white solid**. FX-only apply leaves the live background unless the file includes `background`. Export always writes the live background (omit empty FX layers).

## `scene.containers[]`

Mirror live container snapshots. Minimum practical fields (see also [containers.md](./containers.md)):

```json
{
  "role": "song-cover",
  "label": "Cover",
  "labelCorner": "bottom-right",
  "left": null,
  "top": null,
  "width": null,
  "height": null,
  "relative": {
    "widthOfMin": 0.48,
    "centerX": true,
    "centerYOffset": -0.06
  },
  "wander": false,
  "wanderAmplitude": 1,
  "wanderFrequency": 12,
  "layer": 0,
  "distancing": 0,
  "connect": false,
  "anchorDistance": null,
  "attachToRole": null,
  "shaderId": null,
  "shaderUniforms": {},
  "shaderModulators": {},
  "imageMode": "fill",
  "progressTimeMode": null,
  "style": {
    "border": { "color": "#000000", "lineWidth": 5, "dash": [] },
    "connect": { "color": "#000000", "lineWidth": 5, "dash": [] },
    "label": {
      "fontFamily": "system-ui, -apple-system, \"Segoe UI\", sans-serif",
      "fontSize": 12,
      "fontWeight": "600",
      "fontStyle": "normal",
      "color": "#111111",
      "background": "transparent",
      "letterSpacing": 0,
      "opacity": 1
    }
  }
}
```

### Important container rules

| Topic | Rule |
|-------|------|
| Song UI | Keep `song-cover`, `song-info`, `song-lyrics`, `song-progress` if the look should still show music chrome |
| Viz panels | `audio-scope` / `audio-history` / `audio-beat` / `artef4kt` optional; include for analysis-driven looks |
| `audioInput` | Viz / ARTEF4KT only — channel + `gain` + `continuous` (default true) |
| `embed` | ARTEF4KT: `{ engine, settingsId, quality }` |
| `shaderId` | Package id string or `null` (beat panel often `audio-ferrofluid`) |
| `shaderUniforms` | Flat map of **values only** (`number` or `[r,g,b]`) |
| `shaderModulators` | Optional; omit or `{}` when static ([modulation](./param-modulation.md)) |
| Runtime fields | Never include DOM nodes, canvas refs, or renderer instances |

## `scene.postprocess`

```json
{
  "active": true,
  "layers": [
    {
      "shaderId": "crt",
      "enabled": true,
      "uniforms": {
        "u_scanline": 0.55,
        "u_intensity": 1.0
      },
      "modulators": {
        "u_scanline": {
          "source": "sine",
          "offset": 0.55,
          "amp": 0.12,
          "rate": 0.35,
          "phase": 0
        }
      }
    }
  ]
}
```

| Field | Notes |
|-------|--------|
| Layer order | Array order = process order (first samples capture) |
| Missing uniforms | Package defaults fill gaps on apply |
| Empty `uniforms` | `{}` is fine — use package defaults |
| Runtime `id` | Not required in files; Display assigns layer ids |

## Performances (not presets)

Shows live under `performances/<stem>.json`. They store clips (song `relPath`, in/out, audio transition) plus look **snapshots** (same container schema as presets, including `scene.background`) and optional `showFx` (universal FX stack composited after each clip look). Each look cue applies its own background (shader / image / video / white); missing `background` resets to blank white so a prior shader cannot leak into the next section. Do not put the current analysis waveform in a performance file. See [containers.md](./containers.md) and `performances.js` `validatePerformance`.

**How to save a background with a section (in the app):**

1. Set Look → Background (and FX) the way the section should look.
2. Select the clip / look cue in Performance.
3. Click **Capture current**. That writes a snapshot of the live scene, including `scene.background`.
4. The inspector hint shows `bg shader (name)`, a media file, or a non-white solid when the snapshot has a fill.

There is no extra “background” field on the clip. Import preset / Inherit copy whatever `scene.background` those sources already have. Visual arrival **auto** morphs when layout/FX match even if the fill changes (live outgoing fade). **Crossfade** still freezes the composite.

## What must **not** appear in presets

- Song path, title, artist, cover data URLs  
- Lyric lines or focus indices  
- Playback time / progress fraction  
- Live analysis waveforms or `liveUniforms`  
- Controls UI state (selected tab, Basic\|All, open groups)  
- Look → Render frame rate (`render.fps` is user settings)  
- Widget metadata from `controls.json`

## Authoring workflows

### A. From the app (preferred for layout)

1. Arrange containers, Look FX, and Background in Controls.  
2. Save As (or overwrite) from the Look presets UI.  
3. Optionally rename the file stem carefully; keep JSON valid.

### B. Hand-written / AI-generated

1. Copy `presets/default.json` or a close thematic preset.  
2. Change `name`, stack layers, styles, modulators.  
3. Validate: JSON parse; every `shaderId` exists in `shaders/index.json`.  
4. Load in app via Controls preset list (Refresh if needed).

### C. Demo motion

Use `presets/breathing-crt.json` as a reference for `modulators` + container `shaderModulators`.

## Shipping presets checklist

- [ ] `version: 1` and valid `scene`  
- [ ] File stem matches sanitize rules  
- [ ] All `shaderId`s resolve  
- [ ] Uniform names exist on those packages (typos = ignored uniforms)  
- [ ] No music/runtime leakage  
- [ ] Looks acceptable after cold start + load  
- [ ] Modulators only on continuous floats  

## Related

- [param-modulation.md](./param-modulation.md)  
- [containers.md](./containers.md)  
- [shaders.md](./shaders.md)  
