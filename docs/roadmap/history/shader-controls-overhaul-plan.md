> **Archived plan** — shipped work. Living docs: [docs/README.md](../../README.md) · [backlog](../backlog.md).

# Shader Controls Overhaul Plan

Redesign how **Look → FX stack → selected layer parameters** are presented and edited so postprocess shaders feel like instrument modules—not a long list of anonymous sliders.

**Scope (primary):** Look tab postprocess layer params drawer (`#pp-layer-editor` / `#pp-uniforms`), shared uniform builder in `controls.js`, and additive metadata in `shaders/*/controls.json`.

**Scope (secondary, same builder):** Object → Shader package uniforms (`#c-uniforms`) reuse the same widget system without a separate Object redesign.

**Out of scope:** New GLSL effects, preset JSON schema changes, music window, on-canvas gizmos, undo stack.

**Depends on:** Controls UI overhaul Phases 0–4 complete (`ui-overhaul-plan.md`). Groups + Basic/All already exist as a thin baseline.

**Progress**

| Phase | Status | Notes |
|-------|--------|--------|
| 0 Inventory & widget map | **Complete** (2026-08-07) | 113 postprocess uniforms mapped; merge + meta strip gaps logged |
| 1 Control schema v1.1 | **Complete** (2026-08-07) | Meta allow-list + thermal/lcd fixtures; Basic\|All unblocked |
| 2 Widget toolkit | **Complete** (2026-08-07) | Segmented/toggle/stepper/select/slider/color; discrete immediate |
| 3 FX params chrome | **Complete** (2026-08-08) | Collapsible groups, ↻ Defaults, denser drawer, keyboard |
| 4 Package pass | **Complete** (2026-08-08) | All 11 postprocess packages annotated; no 0= labels |
| 5 Polish | **Complete** (2026-08-08) | pairWith rows, dblclick reset, a11y, Object parity |

---

## 1. Goals

| Goal | Success look |
|------|----------------|
| Right widget for the parameter | Discrete modes are segmented controls or selects—not float sliders with “0=RGB 1=BGR” in the label |
| Scannable modules | Params read as **Pixels / Color / Screen / Mix**, collapsible, not 22 stacked range inputs |
| Fast live tweak | Continuous values still live-debounced; discrete values apply immediately |
| Calm density | Label-left / control-right rows; compact readout; fewer vertical miles |
| Zero preset regressions | Uniform **names** + **runtime values** unchanged; only UI chrome + optional schema fields |
| Authorable packages | New shaders declare widgets in `controls.json` without custom JS |

### Non-goals

- Per-shader bespoke React/Vue UIs  
- Changing frag shaders or uniform names  
- Saving UI layout (open groups, Basic/All) into presets  
- Full node-graph / modular routing UI  

---

## 2. Current state (baseline)

### 2.1 How params render today

1. User selects an FX layer → `#pp-layer-editor` shows shader select + description + `#pp-uniforms`.  
2. `buildUniformControls()` walks `shaderMeta.uniforms` from package `controls.json`.  
3. Widget map today:

| `type` | UI |
|--------|-----|
| `float` / `int` | Range if min+max, else number |
| `bool` | Checkbox |
| `color` | `<input type="color">` (vec3) |
| `vec2` / `vec3` / `vec4` | Row of numbers |

4. Phase 4 additions: optional `group`, `advanced`, Basic \| All bar, group title headers.

### 2.2 Pain points (Look / postprocess)

| Issue | Example | Effect |
|-------|---------|--------|
| **Enum-as-float** | `u_subpixel_mode` 0–2 step 1 labeled in prose | Unusable as a slider; wrong mental model |
| **Toggle-as-float** | `u_bgr`, `u_force_pixels` 0/1 | Should be on/off, not a range |
| **Integer counts as float** | Grey levels 2–8 | Better as stepped number or stepper |
| **No unit / format** | 0.002 jitter vs 1.15 brightness | Same 0–1 looking slider for different domains |
| **Reset only via full re-pick** | No per-param or per-group reset | Hard to recover defaults after exploring |
| **Long packages** | LCD 22 uniforms | Even with Basic, still a scroll wall of identical rows |
| **Color + tint weak** | Hex picker only | No RGB readout, no “neutral” quick set |
| **No linked pairs** | LOD lo/hi, light/dark colors | Related params far apart or unlinked |
| **Description dumps** | Full paragraph under shader select | Burns space; should be tooltip / one line |

### 2.3 Package inventory (postprocess-focused)

| Package | Uniforms | Enum-like floats | Colors | Notes |
|---------|----------|------------------|--------|-------|
| grain | 1 | — | — | Trivial; smoke package |
| crt | 12 | — | 1 | Classic “look” module |
| lcd | 22 | 1 mode | 1 | Highest priority redesign |
| lcd2 | 18 | layout, bgr, force | 1 | Modes + LOD pairs |
| led-matrix | 10 | shape | 2 | Shape toggle + dual colors |
| mono-lcd | 9 | levels (int-ish) | 2 | Palette pair |
| oled | 9 | — | — | Tone stack |
| phosphor | 6 | — | 1 | Short; trail focus |
| projector | 9 | — | 1 | Soft/hotspot/vignette |
| thermal | 7 | palette | — | Palette select |
| vhs | 10 | — | 1 | Tape character |
| default | 1 | — | — | Container only |

**Critical path that must not break:**

- Live: `setPostprocessLayerUniforms` with `{ [name]: value }`  
- Shader change: `setPostprocessLayerShader` with full uniforms object  
- Preset export/import: layer `uniforms` map by **name**  
- Defaults: `def.default` when no stored value  

---

## 3. Target UX (north star)

> Selected FX layer feels like a **module card**: title + enable already on the stack row; drawer shows **semantic sections** with **typed controls**, Basic by default, Advanced one click away.

### 3.1 Information architecture (params drawer)

```
┌─────────────────────────────────────┐
│ LCD Screen              step 2/3    │
│ [Shader ▾]  ↻ defaults   ⋯          │
│ Soft one-line desc (title full)     │
├─────────────────────────────────────┤
│ Basic │ All                         │
├─────────────────────────────────────┤
│ ▾ PIXELS                            │
│   Pixel size        ═══●══  3.0     │
│   Grid gap          ══●═══  0.22    │
│   Subpixel          ═══●══  0.55    │
│   Mode              [RGB|BGR|V]     │  ← not a slider
├─────────────────────────────────────┤
│ ▾ COLOR                             │
│   Brightness …                      │
├─────────────────────────────────────┤
│ ▾ MIX                               │
│   Effect mix        ════●═  1.00    │
└─────────────────────────────────────┘
```

### 3.2 Interaction rules

1. **Widget follows schema** — never infer enums only from min/max heuristics at runtime if package authors can declare them (heuristics optional fallback).  
2. **Live continuous, instant discrete** — ranges debounced (~60ms); selects/toggles apply immediately.  
3. **Basic default** — advanced params hidden until All (keep Phase 4 behavior).  
4. **Groups collapsible** — default: groups with basic params open; empty advanced-only groups stay collapsed when in Basic mode.  
5. **Reset** — “Reset layer defaults” restores package defaults for this shader (does not remove layer). Optional later: double-click label → reset that param.  
6. **Preset-safe** — UI never renames uniforms; export still dumps raw float/color arrays.

### 3.3 Visual language (aligned with controls chrome)

- Same density as FX stack rows (12px base, accent on focus/selection)  
- Row: `label` | `control` | `readout` (tabular nums)  
- Discrete: pill segment bar or compact `<select>` when options > 4  
- Color: swatch + hex readout; optional “white / black” quick chips later  
- Avoid nested cards inside the drawer; hairline group dividers  

---

## 4. Control schema (additive)

Extend each uniform def in `controls.json`. **All new fields optional.** Unknown fields ignored by older UI.

### 4.1 Existing (keep)

```ts
{
  name: string;          // GLSL uniform name — STABLE
  label?: string;
  type: 'float' | 'int' | 'bool' | 'color' | 'vec2' | 'vec3' | 'vec4';
  default: number | number[] | boolean;
  min?: number;
  max?: number;
  step?: number;
  group?: string;        // Phase 4
  advanced?: boolean;    // Phase 4
}
```

### 4.2 Proposed additions (v1.1)

```ts
{
  /** Explicit UI widget; defaults derived from type if omitted */
  widget?:
    | 'slider'       // continuous range
    | 'number'       // bare number input
    | 'stepper'      // − / value / +
    | 'toggle'       // 0/1 or bool
    | 'select'       // dropdown
    | 'segmented'    // 2–5 options as pills
    | 'color'        // color picker
    | 'angle'        // optional later
    | 'pair';        // reserved; prefer pairWith

  /** For select / segmented — values must match what the shader expects */
  options?: { value: number | string; label: string }[];

  /** Display formatting for readout */
  unit?: string;           // e.g. "px", "%"
  format?: 'number' | 'percent' | 'degrees';
  decimals?: number;       // override step-based decimals

  /** Pairing / layout hints */
  pairWith?: string;       // other uniform name; render adjacent
  order?: number;          // sort within group (default: file order)

  /** Docs */
  hint?: string;           // tooltip / title
  description?: string;    // longer help (popover)

  /** Soft guidance for Basic heuristic if advanced omitted — not required */
  importance?: 'primary' | 'secondary';
}
```

### 4.3 Value contract (unchanged)

| UI widget | Stored uniform value |
|-----------|----------------------|
| slider / number / stepper | number |
| toggle | `0` \| `1` (or bool → 0/1 for GLSL) |
| select / segmented | number (or string only if shader already uses string — none today) |
| color | `[r,g,b]` 0–1 floats |

Presets continue to store the same maps. No migration.

### 4.4 Migration of enum-like floats (examples)

**Before (lcd):**
```json
{
  "name": "u_subpixel_mode",
  "label": "Subpixel mode (0=RGB 1=BGR 2=vert RGB)",
  "type": "float",
  "default": 0.0,
  "min": 0.0,
  "max": 2.0,
  "step": 1.0,
  "advanced": true
}
```

**After:**
```json
{
  "name": "u_subpixel_mode",
  "label": "Subpixel layout",
  "type": "float",
  "default": 0.0,
  "widget": "segmented",
  "options": [
    { "value": 0, "label": "RGB" },
    { "value": 1, "label": "BGR" },
    { "value": 2, "label": "V-RGB" }
  ],
  "group": "Pixels",
  "advanced": true,
  "hint": "Physical subpixel order of the emulated panel"
}
```

**Toggle example (lcd2 `u_bgr`):**
```json
{
  "name": "u_bgr",
  "label": "BGR subpixels",
  "type": "float",
  "default": 0.0,
  "widget": "toggle",
  "group": "Mask",
  "advanced": true
}
```

### 4.5 Optional package-level UI hints

```json
{
  "id": "lcd",
  "name": "LCD Screen",
  "ui": {
    "defaultMode": "basic",
    "icon": "lcd",
    "accentGroup": "Pixels"
  },
  "uniforms": [ ... ]
}
```

Package `ui` is optional and ignored by the renderer/runtime.

---

## 5. Widget toolkit (controls.js)

Refactor `appendUniformField` / `buildUniformControls` into a small toolkit (same file or `uniform-controls.js` if size warrants).

### 5.1 Components

| Widget | Behavior |
|--------|----------|
| **SliderRow** | Range + live readout; debounced onChange |
| **NumberRow** | Number input; commit on change/blur |
| **StepperRow** | − / + with step; clamp min/max |
| **ToggleRow** | Switch; maps to 0/1 |
| **SegmentedRow** | Pill group; aria-radiogroup |
| **SelectRow** | Native select when options.length > 5 |
| **ColorRow** | Color input + hex text optional |
| **GroupSection** | Collapsible `<details>` or button header |
| **ModeBar** | Basic \| All (existing) |
| **LayerToolbar** | Reset defaults; optional “copy values” later |

### 5.2 Resolution order for widget choice

1. Explicit `def.widget` if set  
2. Else `type === 'bool'` → toggle  
3. Else `type === 'color'` → color  
4. Else `type` vec* → vec row  
5. Else if `def.options?.length` → segmented (≤5) or select  
6. Else if `type === 'int'` or (step ≥ 1 and integer min/max span ≤ 12) → stepper  
7. Else if min+max → slider  
8. Else number  

### 5.3 Read path (Basic-hidden safety)

Keep Phase 4 behavior: `readUniformsFromHost` merges base/defaults for fields not in the DOM so Apply never drops advanced values.

Live path only pushes the edited key via `setPostprocessLayerUniforms` — no change required beyond new widgets calling the same onChange(name, value).

### 5.4 Reset layer defaults

```text
User clicks “Reset defaults”
  → defaultsFromDefs(meta.uniforms)
  → cmd('setPostprocessLayerUniforms', { id, uniforms: allDefaults })
     or setPostprocessLayerShader with same shaderId + defaults
  → rebuild UI from result.state
```

Prefer one uniforms push of the full map if the display API merges partially (confirm: today partial merge in `updatePostprocessLayerUniforms` — full map OK).

---

## 6. FX params chrome (Look drawer)

### 6.1 Structure changes (`controls.html` / CSS)

| Element | Change |
|---------|--------|
| `#pp-layer-title` row | Add toolbar: Reset · (optional) pin Basic mode |
| `#pp-shader-desc` | One line clamp (already); full text in `title` |
| `#pp-uniforms` | Host only; groups built as collapsible sections |
| Shader package `<select>` | Keep; label “Package” shorter |

### 6.2 Collapsible groups

- Remember open/closed per `shaderId:group` in `sessionStorage` (UI-only).  
- In Basic mode, hide groups that have zero visible uniforms.  

### 6.3 Density CSS targets

- Slider row height ~26–28px  
- Segmented control height ~24px  
- Group title sticky optional (nice-to-have Phase 5)  

---

## 7. Compatibility & breakage matrix

| Contract | Rule |
|----------|------|
| Uniform **names** | Immutable without shader + preset migration |
| Uniform **values** in presets | Same types (numbers / vec arrays) |
| `setPostprocessLayerUniforms` | Keep partial merge semantics |
| `controls.json` load path | `packageToClientMeta` / `uniformDefToClientMeta` explicit allow-list (group, advanced, v1.1 fields) |
| Old packages without `widget` | Still work via type heuristics |
| Basic/All + group | Remain; extend, don’t remove |
| Container shader uniforms | Share toolkit; no separate schema |

### Risks

| Risk | Mitigation |
|------|------------|
| Segmented value type mismatch (string vs number) | Coerce options to Number when def.type is float/int |
| Reset wipes user stack | Reset only selected layer uniforms, not stack membership |
| Heuristic steppers on continuous params | Prefer explicit widget; keep heuristics conservative |
| Rebuild thrash on every slider tick | Debounce commands; don’t full `renderPostprocess` on each input |
| Collapsed group forgets values | Values live on display/state, not in DOM |

---

## 8. Phased plan

### Phase 0 — Inventory & widget map

**Tasks**

- [x] Table every postprocess uniform: name, type, min/max/step, group, advanced, recommended widget  
- [x] Confirm display merge behavior for partial vs full uniform updates  
- [x] Screenshot / note current LCD + CRT drawer pain (optional)  
- [x] Decide: single `controls.js` vs extract `uniform-widgets.js`

**Exit:** Spreadsheet/table in this doc §9 filled; no code required. ✅

**Breakage risk:** None.

#### Phase 0 findings (2026-08-07)

**Uniform merge (display)**

| Path | Behavior | Implication |
|------|----------|-------------|
| `setPostprocessLayerUniforms` → `updatePostprocessLayerUniforms` | **Partial merge:** `Object.assign({}, layer.uniforms, payload)` | Live tweaks send `{ [name]: value }` only; safe. Full defaults map also OK for Reset. |
| `setPostprocessLayerShader` | Rebuilds map: `defaults ∪ (override ?? previous layer.uniforms)` | Shader package change keeps old keys that match new package names; missing keys get defaults. |
| Controls live push | Debounced 60ms per `pp:${layerId}:${name}`; always single-key payload | Continuous widgets keep debounce; discrete should skip debounce in Phase 2. |
| `readUniformsFromHost` | Hidden advanced fields fall back to `baseValues` then `def.default` | Object “Apply” path only; Look live path does not re-read host. |

**Meta pass-through gap (blocks Basic/All + groups today)**

`renderer.js` → `packageToClientMeta` previously dropped `group` / `advanced`. **Fixed in Phase 1** via `uniformDefToClientMeta` allow-list (also passes v1.1 widget fields).

**Builder inventory**

| Item | Location | Notes |
|------|----------|-------|
| `appendUniformField` / `buildUniformControls` | `controls.js` ~365–592 | ~230 lines + helpers; range/number, checkbox→0/1, color hex, vec row |
| `scheduleUniformPush` | 60ms debounce all widgets | Phase 2: discrete immediate |
| `readUniformsFromHost` | container apply safety | Keep for Object tab |
| Toolkit size today | ~264 lines of uniform UI | Under 300-line extract threshold |

**LCD / CRT drawer pain (notes, no screenshots)**

| Package | Pain |
|---------|------|
| **lcd** (22 uniforms) | Long prose labels (`Subpixel mode (0=RGB 1=BGR 2=vert RGB)`); 5 basic + 17 advanced if meta worked; identical slider chrome for mode, px size, and 0–1 mix; full package description paragraph under select. |
| **crt** (12 uniforms) | Cleaner groups in JSON (Screen/Color/Noise/Mix) but meta strip loses them; fine-scale jitter/aberration (0.0005) looks same as 0–1 mask strength; color is advanced-only hex with no readout. |
| **lcd2 / thermal / led** | Highest widget wins: layout, palette, shape, BGR/force toggles all float sliders with arithmetic in labels. |

**Extract decision:** Keep toolkit in `controls.js` until widget code exceeds ~300 net lines *or* a second consumer needs the module. Revisit after Phase 2–3.

---

### Phase 1 — Schema v1.1 + loader pass-through

**Tasks**

- [x] Document schema in this file (done above); add short author note in `shaders/README.md`  
- [x] Fix `packageToClientMeta` in `renderer.js`: pass through `group`, `advanced`, and v1.1 fields via `uniformDefToClientMeta` allow-list  
- [x] Verify Basic\|All + group titles can activate (meta now carries `group`/`advanced`; static check: lcd has 16 advanced + 5 groups)  
- [x] Reference fixtures: `thermal` `u_palette` + `lcd` `u_subpixel_mode` annotated with `widget`/`options`  

**Exit:** Meta in controls shows `group`/`advanced` and `options` for thermal palette when logged; Basic\|All works; presets unchanged. ✅

**Breakage risk:** Low (additive JSON only).

**Shipped:**

| File | Change |
|------|--------|
| `renderer.js` | `uniformDefToClientMeta` + extended `packageToClientMeta` (optional `pkg.ui`) |
| `shaders/thermal/controls.json` | `u_palette` → segmented options; label cleaned |
| `shaders/lcd/controls.json` | `u_subpixel_mode` → segmented options; label cleaned |
| `shaders/README.md` | Authoring guide for schema + v1.1 fields |

**Note:** UI still renders annotated enums as range sliders until Phase 2 reads `widget`/`options`. Defaults/min/max/step unchanged so values and presets stay valid.

---

### Phase 2 — Widget toolkit

**Tasks**

- [x] Implement Segmented, Toggle, Stepper, Select, improved SliderRow + ColorRow  
- [x] Widget resolution order (§5.2) via `resolveUniformWidget`  
- [x] Wire onChange: continuous debounced in toolkit; discrete immediate  
- [x] Unit/format readout (`formatUniformReadout` — percent display-only)  
- [x] Smoke targets: grain slider, thermal palette, led shape (+ lcd mode fixture)  

**Exit:** Enum-like and toggle-like params usable without reading label arithmetic. ✅

**Breakage risk:** Medium (builder rewrite) — mitigate by keeping float slider path identical for unannotated defs.

**Shipped:**

| File | Change |
|------|--------|
| `controls.js` | Widget toolkit: resolve, segmented/toggle/stepper/select/slider/number/color/vec; `emitUniformChange`; `readUniformsFromHost` widget-aware |
| `controls.css` | Density + segmented/toggle/stepper/color styles |
| `shaders/led-matrix/controls.json` | `u_shape` segmented fixture (with thermal/lcd from Phase 1) |

---

### Phase 3 — FX params chrome

**Tasks**

- [x] Collapsible group sections with session memory (`details`/`summary`, `music_view_ug:…`)  
- [x] Layer toolbar: Reset defaults (`#pp-reset-defaults`)  
- [x] Tighten description + spacing in `#pp-layer-editor` (1-line desc, Package label)  
- [x] Keyboard: segmented ←/→/↑/↓/Home/End; stepper ↑↓  

**Exit:** LCD Basic mode feels like 3 short modules, not one scroll of sliders. ✅

**Breakage risk:** Low–medium (CSS/HTML structure around stable ids).

**Shipped:**

| File | Change |
|------|--------|
| `controls.html` | Layer toolbar ↻ Defaults; Package label |
| `controls.js` | Collapsible groups + prefs; `resetSelectedPpLayerDefaults`; segmented/stepper keys |
| `controls.css` | Group disclosure chrome, compact drawer density |

---

### Phase 4 — Full package pass (postprocess)

Annotate all postprocess packages with `widget` / `options` / cleaner labels / groups / advanced:

| Priority | Packages | Status |
|----------|----------|--------|
| P0 | lcd, lcd2, crt, vhs | ✅ |
| P1 | led-matrix, mono-lcd, oled, thermal, projector, phosphor | ✅ |
| P2 | grain (trivial) | ✅ |

**Tasks**

- [x] Clean labels (no `0=… 1=…` prose)  
- [x] Discrete: segmented / toggle / stepper + options  
- [x] `u_intensity` → `format: percent` (display-only)  
- [x] `unit: px` on pixel size / pitch knobs  
- [x] `pairWith` on lcd2 LOD pairs, mono-lcd paper/ink, led tint/bg  
- [x] Verify defaults/min/max/step unchanged for discrete fixtures  

**Exit:** No postprocess package still uses “0=… 1=…” in labels. ✅

**Breakage risk:** None if values/defaults unchanged (review diffs carefully).

**Widget totals (postprocess):** slider 95 · color 10 · segmented 4 · toggle 2 · stepper 2.

---

### Phase 5 — Polish & container parity

**Tasks**

- [x] Pair layout for LOD lo/hi and dual colors where `pairWith` set (`.u-pair` grid)  
- [x] Double-click label → reset single param to package default  
- [x] Object tab `#c-uniforms` same density + desc clamp; `default` package annotated  
- [x] A11y: segmented `aria-labelledby` / radiogroup; toggle `aria-label`; pair `role=group`  
- [x] Percent format for `u_intensity` (done in Phase 4; readout lives in toolkit)  

**Exit:** Look and Object uniform UIs feel like one system. ✅

**Shipped:**

| File | Change |
|------|--------|
| `controls.js` | `appendUniformFieldsWithPairs`, `finishUniformField` / reset, a11y hooks |
| `controls.css` | `.u-pair`, label resettable hover, `#c-uniforms` / `#c-shader-desc` parity |
| `shaders/default/controls.json` | Container Color Wash: `widget: slider` + hint |

---

## 9. Phase 0 widget map

**Source:** `shaders/*/controls.json` (postprocess packages in `shaders/index.json` except container-only `default`).  
**Count:** 113 uniforms across 11 postprocess packages.  
**Current UI column:** what `appendUniformField` renders today when meta arrives (range if min+max, else number; color picker for `color`).  
**Recommended:** Phase 4 annotations + Phase 2 widgets. Storage values stay float/color as today.

### 9.1 High-priority discrete / special widgets

| Package | Uniform | Type | Min–Max | Step | Group | Adv | Current | Recommended | Options / notes |
|---------|---------|------|---------|------|-------|-----|---------|-------------|-----------------|
| lcd | `u_subpixel_mode` | float | 0–2 | 1 | Pixels | yes | slider | **segmented** | 0 RGB · 1 BGR · 2 V-RGB |
| lcd2 | `u_pixel_layout` | float | 0–3 | 1 | Pixels | | slider | **segmented** | 0 square · 1 offset · 2 arrow · 3 tri |
| lcd2 | `u_bgr` | float | 0–1 | 1 | Mask | yes | slider | **toggle** | 0 RGB / 1 BGR |
| lcd2 | `u_force_pixels` | float | 0–1 | 1 | LOD | yes | slider | **toggle** | force structure |
| led-matrix | `u_shape` | float | 0–1 | 1 | Dots | | slider | **segmented** | 0 round · 1 square |
| thermal | `u_palette` | float | 0–2 | 1 | Palette | | slider | **segmented** | 0 iron · 1 rainbow · 2 whitehot |
| mono-lcd | `u_levels` | float | 2–8 | 1 | Palette | | slider | **stepper** | grey level count |
| led-matrix | `u_levels` | float | 2–16 | 1 | Color | yes | slider | **stepper** | brightness steps |
| lcd2 | `u_lod_pix_lo` / `_hi` | float | … | 0.1 | LOD | yes | slider | slider + **pairWith** | pixelize LOD band |
| lcd2 | `u_lod_mask_lo` / `_hi` | float | … | 0.1 | LOD | yes | slider | slider + **pairWith** | mask LOD band |
| mono-lcd | `u_light` / `u_dark` | color | — | — | Palette | yes | color | color + **pairWith** | paper / ink |
| led-matrix | `u_tint` / `u_bg` | color | — | — | Color | yes | color | color + **pairWith** | LED / board |
| * | `u_intensity` | float | 0–1 | 0.01 | Mix | | slider | slider **format percent** | store 0–1; display % |
| * | `u_pixel_size` / `u_pitch` | float | varies | 0.5 | … | | slider | slider **unit px** | primary size knobs |

### 9.2 Full catalog

| Package | Uniform | Type | Min–Max | Step | Group | Adv | Current UI | Recommended widget | Notes |
|---------|---------|------|---------|------|-------|-----|------------|--------------------|-------|
| grain | `u_amount` | float | 0–0.5 | 0.01 | Grain | | slider | slider | smoke package |
| crt | `u_curvature` | float | 0–0.45 | 0.005 | Screen | | slider | slider | |
| crt | `u_scanline` | float | 0–1 | 0.01 | Screen | | slider | slider | |
| crt | `u_mask` | float | 0–1 | 0.01 | Screen | | slider | slider | |
| crt | `u_mask_scale` | float | 0.5–3 | 0.05 | Screen | yes | slider | slider | |
| crt | `u_bloom` | float | 0–1 | 0.01 | Color | yes | slider | slider | |
| crt | `u_brightness` | float | 0.4–2 | 0.01 | Color | | slider | slider | |
| crt | `u_contrast` | float | 0.5–2 | 0.01 | Color | yes | slider | slider | |
| crt | `u_vignette` | float | 0–1 | 0.01 | Screen | | slider | slider | |
| crt | `u_jitter` | float | 0–0.02 | 0.0005 | Noise | yes | slider | slider | fine scale |
| crt | `u_aberration` | float | 0–0.01 | 0.0005 | Noise | yes | slider | slider | fine scale |
| crt | `u_tint` | color | — | — | Color | yes | color | color | hex readout later |
| crt | `u_intensity` | float | 0–1 | 0.01 | Mix | | slider | slider | format percent |
| lcd | `u_pixel_size` | float | 1–16 | 0.5 | Pixels | | slider | slider | unit px; primary |
| lcd | `u_pixel_aspect` | float | 0.5–2 | 0.05 | Pixels | yes | slider | slider | |
| lcd | `u_grid_gap` | float | 0–0.6 | 0.01 | Pixels | | slider | slider | |
| lcd | `u_subpixel` | float | 0–1 | 0.01 | Pixels | | slider | slider | |
| lcd | `u_subpixel_mode` | float | 0–2 | 1 | Pixels | yes | slider | segmented | RGB/BGR/V-RGB |
| lcd | `u_scanline` | float | 0–1 | 0.01 | Screen | yes | slider | slider | |
| lcd | `u_scanline_soft` | float | 0–1 | 0.01 | Screen | yes | slider | slider | |
| lcd | `u_brightness` | float | 0.3–2 | 0.01 | Color | | slider | slider | |
| lcd | `u_contrast` | float | 0.5–2 | 0.01 | Color | | slider | slider | |
| lcd | `u_saturation` | float | 0–2 | 0.01 | Color | yes | slider | slider | |
| lcd | `u_backlight` | float | 0–0.6 | 0.01 | Color | yes | slider | slider | |
| lcd | `u_bloom` | float | 0–0.8 | 0.01 | Color | yes | slider | slider | |
| lcd | `u_bleed` | float | 0–0.5 | 0.01 | Color | yes | slider | slider | |
| lcd | `u_curvature` | float | 0–0.4 | 0.005 | Screen | yes | slider | slider | |
| lcd | `u_vignette` | float | 0–1 | 0.01 | Screen | yes | slider | slider | |
| lcd | `u_edge_mask` | float | 0–1 | 0.01 | Screen | yes | slider | slider | |
| lcd | `u_sharpness` | float | 0–1 | 0.01 | Pixels | yes | slider | slider | |
| lcd | `u_flicker` | float | 0–0.15 | 0.005 | Noise | yes | slider | slider | |
| lcd | `u_noise` | float | 0–0.2 | 0.005 | Noise | yes | slider | slider | |
| lcd | `u_tint` | color | — | — | Color | yes | color | color | |
| lcd | `u_black_level` | float | 0–0.2 | 0.005 | Color | yes | slider | slider | |
| lcd | `u_intensity` | float | 0–1 | 0.01 | Mix | | slider | slider | format percent |
| lcd2 | `u_pixel_size` | float | 1–24 | 0.5 | Pixels | | slider | slider | unit px |
| lcd2 | `u_pixel_luma` | float | 1–8 | 0.05 | Pixels | | slider | slider | |
| lcd2 | `u_pixel_layout` | float | 0–3 | 1 | Pixels | | slider | segmented | 4 layouts |
| lcd2 | `u_layout_offset` | float | 0–1 | 0.01 | Pixels | yes | slider | slider | |
| lcd2 | `u_subpixel_gap` | float | 0–0.4 | 0.01 | Mask | | slider | slider | |
| lcd2 | `u_row_gap` | float | 0–0.4 | 0.01 | Mask | yes | slider | slider | |
| lcd2 | `u_mask_soft` | float | 0–0.2 | 0.005 | Mask | yes | slider | slider | |
| lcd2 | `u_bgr` | float | 0–1 | 1 | Mask | yes | slider | toggle | |
| lcd2 | `u_lod_pix_lo` | float | 0–6 | 0.1 | LOD | yes | slider | slider | pairWith `u_lod_pix_hi` |
| lcd2 | `u_lod_pix_hi` | float | 0.5–8 | 0.1 | LOD | yes | slider | slider | pairWith `u_lod_pix_lo` |
| lcd2 | `u_lod_mask_lo` | float | 0–6 | 0.1 | LOD | yes | slider | slider | pairWith `u_lod_mask_hi` |
| lcd2 | `u_lod_mask_hi` | float | 0.5–8 | 0.1 | LOD | yes | slider | slider | pairWith `u_lod_mask_lo` |
| lcd2 | `u_force_pixels` | float | 0–1 | 1 | LOD | yes | slider | toggle | |
| lcd2 | `u_interlace` | float | 0–1 | 0.01 | FX | yes | slider | slider | |
| lcd2 | `u_interlace_speed` | float | 0–8 | 0.1 | FX | yes | slider | slider | |
| lcd2 | `u_brightness` | float | 0.3–2.5 | 0.01 | Color | | slider | slider | |
| lcd2 | `u_tint` | color | — | — | Color | yes | color | color | |
| lcd2 | `u_intensity` | float | 0–1 | 0.01 | Mix | | slider | slider | format percent |
| led-matrix | `u_pitch` | float | 3–28 | 0.5 | Dots | | slider | slider | unit px |
| led-matrix | `u_dot_size` | float | 0.2–1 | 0.01 | Dots | | slider | slider | |
| led-matrix | `u_shape` | float | 0–1 | 1 | Dots | | slider | segmented | round/square |
| led-matrix | `u_glow` | float | 0–1 | 0.01 | Dots | yes | slider | slider | |
| led-matrix | `u_levels` | float | 2–16 | 1 | Color | yes | slider | stepper | |
| led-matrix | `u_gap` | float | 0–1 | 0.01 | Dots | yes | slider | slider | |
| led-matrix | `u_brightness` | float | 0.4–2.5 | 0.01 | Color | | slider | slider | |
| led-matrix | `u_tint` | color | — | — | Color | yes | color | color | pairWith `u_bg` |
| led-matrix | `u_bg` | color | — | — | Color | yes | color | color | pairWith `u_tint` |
| led-matrix | `u_intensity` | float | 0–1 | 0.01 | Mix | | slider | slider | format percent |
| mono-lcd | `u_pixel_size` | float | 1–16 | 0.5 | Pixels | | slider | slider | unit px |
| mono-lcd | `u_levels` | float | 2–8 | 1 | Palette | | slider | stepper | |
| mono-lcd | `u_dither` | float | 0–1 | 0.01 | Pixels | yes | slider | slider | |
| mono-lcd | `u_grid` | float | 0–0.5 | 0.01 | Pixels | yes | slider | slider | |
| mono-lcd | `u_contrast` | float | 0.5–2.5 | 0.01 | Color | | slider | slider | |
| mono-lcd | `u_brightness` | float | 0.4–1.8 | 0.01 | Color | | slider | slider | |
| mono-lcd | `u_light` | color | — | — | Palette | yes | color | color | pairWith `u_dark` |
| mono-lcd | `u_dark` | color | — | — | Palette | yes | color | color | pairWith `u_light` |
| mono-lcd | `u_intensity` | float | 0–1 | 0.01 | Mix | | slider | slider | format percent |
| oled | `u_black` | float | 0–1 | 0.01 | Tone | | slider | slider | |
| oled | `u_contrast` | float | 0.8–2.2 | 0.01 | Tone | | slider | slider | |
| oled | `u_brightness` | float | 0.4–1.8 | 0.01 | Tone | | slider | slider | |
| oled | `u_saturation` | float | 0–2 | 0.01 | Tone | yes | slider | slider | |
| oled | `u_bloom` | float | 0–0.8 | 0.01 | Glow | yes | slider | slider | |
| oled | `u_pixel` | float | 0–0.6 | 0.01 | Glow | yes | slider | slider | |
| oled | `u_vignette` | float | 0–0.8 | 0.01 | Glow | yes | slider | slider | |
| oled | `u_warmth` | float | −0.2–0.2 | 0.01 | Tone | yes | slider | slider | bipolar |
| oled | `u_intensity` | float | 0–1 | 0.01 | Mix | | slider | slider | format percent |
| phosphor | `u_decay` | float | 0.5–0.98 | 0.005 | Trail | | slider | slider | label: lower = longer |
| phosphor | `u_gain` | float | 0.3–2 | 0.01 | Trail | | slider | slider | |
| phosphor | `u_threshold` | float | 0–0.5 | 0.01 | Trail | yes | slider | slider | |
| phosphor | `u_bloom` | float | 0–0.8 | 0.01 | Trail | yes | slider | slider | |
| phosphor | `u_tint` | color | — | — | Color | yes | color | color | |
| phosphor | `u_intensity` | float | 0–1 | 0.01 | Mix | | slider | slider | format percent |
| projector | `u_softness` | float | 0–1 | 0.01 | Lens | | slider | slider | |
| projector | `u_hotspot` | float | 0–1 | 0.01 | Lens | | slider | slider | |
| projector | `u_vignette` | float | 0–1 | 0.01 | Lens | | slider | slider | |
| projector | `u_dust` | float | 0–0.5 | 0.01 | FX | yes | slider | slider | |
| projector | `u_rainbow` | float | 0–0.4 | 0.01 | FX | yes | slider | slider | |
| projector | `u_brightness` | float | 0.4–1.8 | 0.01 | Color | | slider | slider | |
| projector | `u_contrast` | float | 0.5–1.5 | 0.01 | Color | yes | slider | slider | |
| projector | `u_tint` | color | — | — | Color | yes | color | color | |
| projector | `u_intensity` | float | 0–1 | 0.01 | Mix | | slider | slider | format percent |
| thermal | `u_softness` | float | 0–1 | 0.01 | Image | | slider | slider | |
| thermal | `u_contrast` | float | 0.5–2.5 | 0.01 | Image | | slider | slider | |
| thermal | `u_brightness` | float | −0.3–0.3 | 0.01 | Image | | slider | slider | level offset |
| thermal | `u_noise` | float | 0–0.4 | 0.01 | Image | yes | slider | slider | |
| thermal | `u_palette` | float | 0–2 | 1 | Palette | | slider | segmented | iron/rainbow/whitehot |
| thermal | `u_scan` | float | 0–0.6 | 0.01 | HUD | yes | slider | slider | |
| thermal | `u_intensity` | float | 0–1 | 0.01 | Mix | | slider | slider | format percent |
| vhs | `u_bleed` | float | 0–0.03 | 0.0005 | Tape | | slider | slider | fine scale |
| vhs | `u_softness` | float | 0–1 | 0.01 | Tape | | slider | slider | |
| vhs | `u_wobble` | float | 0–0.02 | 0.0005 | Tape | | slider | slider | fine scale |
| vhs | `u_noise` | float | 0–0.5 | 0.01 | Tape | yes | slider | slider | |
| vhs | `u_scanline` | float | 0–1 | 0.01 | Tape | yes | slider | slider | |
| vhs | `u_tracking` | float | 0–1 | 0.01 | Tape | yes | slider | slider | |
| vhs | `u_saturation` | float | 0–2 | 0.01 | Color | yes | slider | slider | |
| vhs | `u_contrast` | float | 0.5–2 | 0.01 | Color | yes | slider | slider | |
| vhs | `u_tint` | color | — | — | Color | yes | color | color | |
| vhs | `u_intensity` | float | 0–1 | 0.01 | Mix | | slider | slider | format percent |

### 9.3 Container-only (secondary, same builder)

| Package | Uniform | Type | Min–Max | Step | Group | Recommended |
|---------|---------|------|---------|------|-------|-------------|
| default | `u_speed` | float | 0–4 | 0.05 | Motion | slider |

### 9.4 Widget counts (recommended)

| Widget | Approx count | Packages driving demand |
|--------|--------------|-------------------------|
| slider | ~95 | all continuous params |
| segmented | 4 | lcd, lcd2, led-matrix, thermal |
| toggle | 2 | lcd2 |
| stepper | 2 | mono-lcd, led-matrix |
| color | 10 | crt, lcd, lcd2, led×2, mono×2, phosphor, projector, vhs |
| pairWith (layout) | 4 pairs | lcd2 LOD×2, mono palette, led colors |

Phase 2 ship checkpoint: **segmented + toggle + existing slider** unblocks every “0=…” label today.

---

## 10. File-level change map

| File | Phases | Notes |
|------|--------|-------|
| `controls.js` | 2–5 | Widget toolkit + drawer toolbar |
| `controls.css` | 2–3, 5 | Row density, segmented, toggle, groups |
| `controls.html` | 3 | Optional toolbar hooks; keep `#pp-uniforms` |
| `shaders/*/controls.json` | 1, 4 | Additive metadata only |
| `renderer.js` / `shaders.js` | 1 | Pass-through meta fields if stripped |
| `presets/*` | — | **No change** |
| `app.js` / `preload.js` | — | No change expected |

---

## 11. Test plan

### 11.1 Smoke (every phase)

1. Launch → default preset LCD stack visible.  
2. Select LCD layer → params drawer renders.  
3. Drag brightness → live display update.  
4. Change package to grain → one control; back to LCD → values restored from state.  
5. Toggle layer eye / reorder — params still bound to layer **id**.  
6. Save preset `shader-ui-smoke` → reload → load preset → uniform values match.  

### 11.2 Widget regression (after Phase 2+)

| Action | Expect |
|--------|--------|
| Thermal palette → Rainbow | Segmented updates; look changes; value is number 1 |
| LED shape → Square | Not a half-step float |
| LCD subpixel layout switch | Immediate; no debounce lag |
| Basic hides advanced; Apply shader on container | Advanced values preserved |
| Reset defaults on layer | Matches package defaults; other layers untouched |

### 11.3 Preset parity

Open JSON after save: `scene.postprocess.layers[].uniforms` keys/values only—no `widget` or UI fields leaked into preset.

---

## 12. Implementation order

1. Phase 0 inventory table  
2. Phase 1 meta pass-through + 1–2 annotated packages  
3. Phase 2 toolkit (ship checkpoint: segmented + toggle + slider)  
4. Phase 3 drawer chrome  
5. Phase 4 annotate all postprocess packages  
6. Phase 5 polish / pairs / container parity  

After each phase: §11.1; after 2 and 4 also §11.2–11.3.

---

## 13. Rollback

| Phase | Rollback |
|-------|----------|
| 1 JSON annotations | Revert `controls.json`; UI ignores missing fields |
| 2–3 UI | Revert `controls.js` / `.css` / `.html`; packages still load |
| Accidental default wipe | Re-select package or load preset; `git checkout -- presets/default.json` if needed |

Keep commits split: schema annotations vs UI toolkit when possible.

---

## 14. Open decisions (resolve in Phase 0–1)

1. **Extract file?** **Decided (Phase 0):** keep in `controls.js` until toolkit > ~300 net lines or a second consumer needs the module; then `uniform-widgets.js`.  
2. **Percent intensity:** **Decided:** display-only format (`format: 'percent'`) — stored value remains 0–1.  
3. **Collapsible default:** **Decided:** all basic groups open for short packages; if group count > 4, open only groups that contain at least one non-advanced param (collapse empty/advanced-only when in Basic).  
4. **Icon rail / package thumbnails:** Deferred; not required for param quality.  
5. **Meta allow-list:** **Decided (Phase 0):** Phase 1 extends `packageToClientMeta` with explicit fields (`group`, `advanced`, `widget`, `options`, `unit`, `format`, `decimals`, `hint`, `description`, `pairWith`, `order`) — no silent full-object copy.  

---

## 15. Relation to prior overhaul

| Prior work | Reuse |
|------------|--------|
| Look / Object tabs | Unchanged |
| FX stack rows, eye, DnD | Unchanged; this plan is the **params drawer** under the stack |
| `group` / `advanced` / Basic\|All | Foundation; this plan deepens widgets + chrome |
| Click-to-select, shortcuts | Orthogonal |

This is a **follow-on** focused on Look postprocess **parameter quality**, not another full chrome rewrite.
