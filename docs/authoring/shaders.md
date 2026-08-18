# Authoring shaders

Compatible **shader packages** for music_view: GLSL fragments + UI metadata.

## Package layout

```
shaders/
  index.json          # ordered list of package ids (required for discovery)
  <id>/
    controls.json     # id, roles, uniform schema
    shader.frag       # fragment body (or path from "entry")
```

### Register the package

Add the folder name to `shaders/index.json`:

```json
[
  "default",
  "grain",
  "my-effect"
]
```

If it is missing from the index, `listShaders` will not offer it.

### controls.json (required fields)

```json
{
  "id": "my-effect",
  "name": "My Effect",
  "description": "One-line summary for the UI.",
  "roles": ["postprocess"],
  "entry": "shader.frag",
  "uniforms": [ /* see below */ ]
}
```

| Field | Required | Notes |
|-------|----------|--------|
| `id` | yes | Must match folder name |
| `name` | yes | Display name |
| `description` | recommended | Short UI blurb |
| `roles` | yes | `"postprocess"`, `"container"`, or both |
| `entry` | no | Frag file; default `shader.frag` |
| `uniforms` | yes | Array of control defs (may be empty) |
| `ui` | no | Package chrome hints; runtime ignores |

## Fragment GLSL rules

### What the runtime injects

`shaders.js` wraps your source with:

- `precision mediump float;`
- `varying vec2 v_uv;` (0–1, full triangle)
- `uniform float u_time;` (seconds)
- `uniform vec2 u_resolution;`
- Optional `OES_standard_derivatives` on WebGL1

**Your file must define `main()`** and any extra uniforms used by `controls.json`.

Do **not** redeclare `u_time`, `u_resolution`, or `v_uv`.

### Postprocess role (full-frame FX)

**Required:**

```glsl
uniform sampler2D u_scene;
```

Sample the previous composite:

```glsl
vec3 col = texture2D(u_scene, v_uv).rgb;
// … process …
gl_FragColor = vec4(col, 1.0);
```

Conventions used by shipping packages:

- Include `u_intensity` (0–1) to mix processed vs original for usability.
- Stay in GLES-style GLSL that works on WebGL1 (`texture2D`, `gl_FragColor`).
- Avoid requiring extensions beyond derivatives.
- Optional feedback: declare `uniform sampler2D u_prev;` — stack allocates a feedback texture if the uniform exists.

### Container role (panel fill **or** stage background)

- No `u_scene` required; UV covers the panel — or the full stage when used as `background.mode = shader`.
- Draw opaque or alpha content into `gl_FragColor`.
- Do not assume a photo or font atlas exists. Procedural SDFs only unless Display uploads a texture.
- For audio viz, declare `sampler2D` uniforms that Display will upload (see [audio pipeline](../architecture/audio-pipeline.md)). Live scalars should also be declared so defaults/UI exist, even if Display overrides them.
- Prefer a `u_speed` float so `0` freezes motion (background fills especially).

### Stage background

Look → Background → **Shader** lists every package with a `container` role (`listShaders` metadata). Apply writes `scene.background.mode = "shader"` plus `shaderId` / `shaderUniforms`. The same package can also fill a generic Object panel.

Rules that bite authors:

- **Roles:** `"container"` only (or both). Postprocess-only packages do not appear in the background picker.
- **No `u_scene`.** The fill is generated, not a grade of the stage.
- **WebGL1 / GLES:** `texture2D`, `gl_FragColor`, `mediump`. Runtime already injects `u_time`, `u_resolution`, `v_uv`.
- **Catalog:** add the folder id to `shaders/index.json` (after `default` is the convention for `bg-*`). Listing does not compile the frag; compile happens on Apply.
- **UI:** Look → Background has the same Basic|All split as Look FX (`advanced: true` knobs). Changing the select keeps the pick until Apply (you do not need to Clear first).
- **Clocks:** re-applying the same package updates uniforms in place and does not rewind `u_time`.

Built-in stage fills (`roles: ["container"]`):

| Id | Name | Notes |
|----|------|--------|
| `default` | Default | Color wash |
| `bg-floral-pcb` | Floral PCB | Stylized board + platter + flowers (procedural, not a photo sample) |
| `bg-metal-split` | Metal Split | Filaments + cylindrical highlight |
| `bg-barcode-escalate` | Barcode Escalate | Blocks that subdivide into a vertical barcode |
| `bg-desert-signal` | Desert Signal | Dunes / sky + raining 1-bit debris |
| `bg-ink-orbit` | Ink Orbit | Four-fold ink metaballs |
| `bg-polar-cross` | Polar Cross | Polar-warped ripples that pinch into crosses |
| `bg-number-field` | Number Field | Drifting 7-seg integers on paper |
| `bg-number-cascade` | Number Cascade | Integers on diagonal tracks |
| `bg-flow-grain` | Flow Grain | Wormy grain + central vortex |
| `bg-bayer-sky` | Bayer Sky | 1-bit 8×8 dithered landscape |
| `bg-starburst` | Polar Burst | Pinched radial starburst |
| `bg-line-halftone` | Line Halftone | 1-bit vertical line-dither |

Performance **Capture current** stores whatever fill is live. Auto morphs keep an outgoing shader playing on a fade layer; a forced crossfade freezes the composite.

### Uniform types ↔ GLSL

| `controls.json` `type` | GLSL | JS value |
|------------------------|------|----------|
| `float` | `uniform float` | number |
| `int` | `uniform float` or int* | number (UI may treat as int) |
| `bool` | typically float 0/1 | boolean/number depending on path — prefer float 0/1 + toggle widget |
| `color` | `uniform vec3` | `[r,g,b]` in **0–1** |
| `vec2` / `vec3` / `vec4` | matching | number arrays |

\*Prefer `float` + `widget: "stepper"` for discrete levels (matches existing packages).

## Uniform control schema

### Stable runtime fields (do not rename lightly)

| Field | Required | Notes |
|-------|----------|--------|
| `name` | yes | Exact GLSL uniform name |
| `type` | yes | `float` \| `int` \| `bool` \| `color` \| `vec2` \| `vec3` \| `vec4` |
| `default` | yes | Number, bool, or `[r,g,b]` |

### Range / labeling

| Field | Notes |
|-------|--------|
| `min`, `max`, `step` | Continuous range → slider |
| `label` | Human name (defaults to `name`) |
| `group` | Section header (`"Screen"`, `"Color"`, `"Mix"`) |
| `advanced` | `true` → hidden until Basic\|All → All |

### UI-only (schema v1.1 — never store in presets)

| Field | Notes |
|-------|--------|
| `widget` | `slider` \| `number` \| `stepper` \| `toggle` \| `select` \| `segmented` \| `color` |
| `options` | `[{ "value": 0, "label": "Iron" }, …]` for select/segmented |
| `unit` | Readout suffix (`"%"`, `"px"`) |
| `format` | `number` \| `percent` \| `degrees` (display only) |
| `decimals` | Readout precision |
| `hint` | Tooltip |
| `description` | Longer help |
| `pairWith` | Sibling uniform `name` for side-by-side UI |
| `order` | Sort within group |

**Value contract:** toggles/segmented still store **numbers** (`0`/`1` or option values). Colors stay `[r,g,b]` 0–1.

### Example uniform block

```json
{
  "name": "u_intensity",
  "label": "Effect mix",
  "type": "float",
  "default": 1.0,
  "min": 0.0,
  "max": 1.0,
  "step": 0.01,
  "group": "Mix",
  "format": "percent",
  "unit": "%",
  "widget": "slider",
  "hint": "Blend of processed vs original"
}
```

## Minimal postprocess package

**`shaders/my-tint/controls.json`**

```json
{
  "id": "my-tint",
  "name": "My Tint",
  "description": "Simple color grade over the scene.",
  "roles": ["postprocess"],
  "entry": "shader.frag",
  "uniforms": [
    {
      "name": "u_tint",
      "label": "Tint",
      "type": "color",
      "default": [1.0, 0.95, 0.9],
      "group": "Color",
      "widget": "color"
    },
    {
      "name": "u_intensity",
      "label": "Mix",
      "type": "float",
      "default": 1.0,
      "min": 0.0,
      "max": 1.0,
      "step": 0.01,
      "group": "Mix",
      "widget": "slider",
      "format": "percent"
    }
  ]
}
```

**`shaders/my-tint/shader.frag`**

```glsl
uniform sampler2D u_scene;
uniform vec3 u_tint;
uniform float u_intensity;

void main() {
    vec3 original = texture2D(u_scene, v_uv).rgb;
    vec3 graded = original * u_tint;
    float m = clamp(u_intensity, 0.0, 1.0);
    gl_FragColor = vec4(mix(original, graded, m), 1.0);
}
```

Then add `"my-tint"` to `shaders/index.json` and restart the app (or reload Display).

## Minimal container package

```json
{
  "id": "my-fill",
  "name": "My Fill",
  "description": "Solid animated fill for a panel.",
  "roles": ["container"],
  "entry": "shader.frag",
  "uniforms": [
    {
      "name": "u_speed",
      "label": "Speed",
      "type": "float",
      "default": 1.0,
      "min": 0.0,
      "max": 4.0,
      "step": 0.05,
      "group": "Motion",
      "widget": "slider"
    }
  ]
}
```

```glsl
uniform float u_speed;

void main() {
    float t = u_time * max(u_speed, 0.0);
    vec3 col = 0.5 + 0.5 * cos(vec3(0.0, 2.0, 4.0) + t + v_uv.xyx);
    gl_FragColor = vec4(col, 1.0);
}
```

## Author checklist

1. Keep `name` + `default` stable across releases when possible.
2. Prefer `label` + `options` over “0=RGB 1=BGR” prose in labels.
3. Mark rarely used knobs `advanced: true`.
4. Group related params; put mix/intensity last in **Mix**.
5. Do not change stored value ranges when only improving UI metadata.
6. **Do not** put LFO / modulation fields in `controls.json` — that is runtime/preset only ([param-modulation](./param-modulation.md)).
7. After adding a package, smoke-test: add layer or assign container / background shader, tweak each uniform (including Basic|All), save/load a preset.

## Reference packages

| Learn from | Why |
|------------|-----|
| `shaders/grain/` | Smallest postprocess |
| `shaders/crt/` | Rich groups + advanced knobs |
| `shaders/thermal/` | Segmented enum (`u_palette`) |
| `shaders/lcd2/` | Toggles + segmented layout |
| `shaders/default/` | Smallest container |
| `shaders/bg-line-halftone/` | Smallest generative stage fill |
| `shaders/bg-floral-pcb/` | Richer procedural background + `u_speed` |
| `shaders/audio-scope/` | Live texture + style uniforms |

## Runtime load path (for debugging)

`renderer.js` → `listShaders` reads `shaders/index.json` and fetches each `controls.json` in parallel (no fragment). `loadShaderPackage(id)` / `loadShaderControls` then fetch the frag entry when applying a fill or FX layer, map meta through an allow-list, and build default uniform maps. Compile errors surface as program link/compile exceptions in the Display DevTools console.
