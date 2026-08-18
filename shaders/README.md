# Shader packages

Each folder under `shaders/` is a package listed in `index.json`.

**Full authoring guide (including AI instructions):**  
→ [`docs/authoring/shaders.md`](../docs/authoring/shaders.md)  
→ Entry checklist: [`docs/authoring/README.md`](../docs/authoring/README.md)

## Layout

```
shaders/<id>/
  controls.json   # metadata + uniform UI schema
  shader.frag     # GLSL fragment (entry; override via "entry")
```

## controls.json

| Field | Purpose |
|-------|---------|
| `id`, `name`, `description` | Catalog identity |
| `roles` | `"postprocess"`, `"container"`, or both. Container packages fill a panel **or** Look → Background. |
| `entry` | Frag filename (default `shader.frag`) |
| `uniforms` | Array of uniform control defs (see below) |
| `ui` | Optional package-level chrome hints (ignored by runtime) |

### Uniform def (runtime + UI)

**Stable (must not rename without shader + preset migration):**

| Field | Required | Notes |
|-------|----------|--------|
| `name` | yes | GLSL uniform name |
| `type` | yes | `float` \| `int` \| `bool` \| `color` \| `vec2` \| `vec3` \| `vec4` |
| `default` | yes | Number, boolean, or `[r,g,b]` for color |

**Range / continuous controls:**

| Field | Notes |
|-------|--------|
| `min`, `max`, `step` | Range slider when min+max set |
| `label` | Human label (defaults to `name`) |

**Grouping (controls UI):**

| Field | Notes |
|-------|--------|
| `group` | Section title (e.g. `"Pixels"`, `"Mix"`) |
| `advanced` | `true` → hidden until Basic\|All → All |

### Schema v1.1 (additive UI only)

All optional. Older UI ignores unknown fields. **Never** put widget metadata into presets — only uniform *values* are saved.

| Field | Notes |
|-------|--------|
| `widget` | `slider` \| `number` \| `stepper` \| `toggle` \| `select` \| `segmented` \| `color` |
| `options` | For select/segmented: `[{ "value": 0, "label": "Iron" }, …]` — values must match what the shader expects |
| `unit` | Readout suffix (`"px"`, `"%"`) |
| `format` | `number` \| `percent` \| `degrees` (display only; storage unchanged) |
| `decimals` | Readout precision override |
| `hint` | Short tooltip |
| `description` | Longer help |
| `pairWith` | Other uniform `name` — UI renders the pair side-by-side |
| `order` | Sort within group (default: file order) |

**Value contract:** toggles and segmented controls still store numbers (`0`/`1` or option values). Colors stay `[r,g,b]` in 0–1. Presets are unchanged.

### Package annotations (examples)

| Package | Uniform | Widget |
|---------|---------|--------|
| `thermal` | `u_palette` | segmented (Iron / Rainbow / White hot) |
| `lcd` | `u_subpixel_mode` | segmented (RGB / BGR / V-RGB), advanced |
| `lcd2` | `u_pixel_layout` | segmented (Square / Offset / Arrow / Tri) |
| `lcd2` | `u_bgr`, `u_force_pixels` | toggle |
| `led-matrix` | `u_shape` | segmented (Round / Square) |
| `mono-lcd` / `led-matrix` | `u_levels` | stepper |
| `*` | `u_intensity` | slider + `format: percent` (store 0–1) |

Unannotated floats with min+max still fall back to sliders via the UI heuristic.

## GLSL essentials

- Runtime injects `u_time`, `u_resolution`, `v_uv`. Do not redeclare them.
- Postprocess packages **must** declare and sample `uniform sampler2D u_scene`.
- Container / stage-background packages must **not** sample `u_scene`. Prefer `u_speed` so `0` freezes motion.
- Prefer WebGL1-compatible GLSL (`texture2D`, `gl_FragColor`).
- Stage fills: `bg-*` packages after `default` in `index.json`. Catalog listing is metadata-only.

## Param modulation (runtime — not part of controls.json)

Float slider/number params can be animated from the **Controls** UI (Static · Time · Sine · Tri · Sq · Noise; clocks Stack · Wall · Song) without editing GLSL or package JSON.

| Concern | Where it lives |
|---------|----------------|
| Package uniforms | `controls.json` + `shader.frag` only (unchanged) |
| Modulation specs | Live layer/container state + visual presets (`modulators` / `shaderModulators`) |
| Evaluation | CPU each frame in `param-mod.js` → resolved numbers uploaded as normal uniforms |

**Do not** add LFO fields to `controls.json`. Details: [`docs/authoring/param-modulation.md`](../docs/authoring/param-modulation.md).

Demo preset: **`presets/breathing-crt.json`**.

### Author checklist

1. Keep `name` + `default` stable across releases when possible.  
2. Prefer clean `label` + `options` over “0=… 1=…” in the label string.  
3. Mark rarely used knobs `advanced: true`.  
4. Put related params in the same `group`.  
5. Do not change stored value ranges when only improving UI metadata.  
6. Register new packages in `shaders/index.json`.
