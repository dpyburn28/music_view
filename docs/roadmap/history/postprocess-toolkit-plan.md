# Postprocess toolkit plan (music_view)

**Status:** Phases A–D complete (full planned catalog shipped)  
**Location:** `docs/roadmap/postprocess-toolkit-plan.md`  
**Target app:** music_view (this repo)  
**Depends on:** existing postprocess stack (`shaders.js`), package contract ([authoring/shaders.md](../authoring/shaders.md)), param modulation ([authoring/param-modulation.md](../authoring/param-modulation.md))  
**Related:** ARTEF4KT embed benefits from global grade/optics/glitch stacks ([artef4kt-integration-plan.md](./artef4kt-integration-plan.md))

---

## 1. Goals

| Goal | Success look |
|------|----------------|
| **A. Versatile toolkit** | A coherent set of postprocess packages covers grade, optics, temporal feedback, distortion/glitch, stylize, and utility — not only display simulation |
| **B. Stack composition** | Any 2–6 layers can be ordered into recognizable looks without new GLSL for one-off presets |
| **C. Controls-native** | Every package has complete `controls.json` (groups, ranges, `u_intensity` wet/dry, advanced flags) and works in Look → FX and per-container FX |
| **D. Modulator-ready** | Continuous float knobs (intensity, radius, amount, glitch) respond cleanly to param-mod LFOs |
| **E. Performance-aware** | Defaults stay real-time on portrait Display (1080×1920 scaled) with ARTEF4KT + multi-panel scenes |
| **F. Documented recipes** | Authoring docs list packages, stack order tips, and example preset recipes |

### Non-goals (this plan)

- Replacing existing display-sim packages (`crt`, `vhs`, `lcd*`, etc.) — they remain first-class
- Multi-pass FBO downsampling bloom as a separate renderer feature (v1 bloom is single-pass multi-tap; multi-pass is optional later)
- ML / neural style transfer
- External LUT file loading (v1 uses analytic or 3-stop color maps only)
- Per-pixel freeform expression language
- Audio-reactive modulator sources (already backlog; design knobs so beat sources can attach later)
- New container-only viz packages (scope/ferro) — out of scope unless a pack is dual-role by design

---

## 2. Current state (baseline)

### 2.1 Shipping postprocess-oriented packages

From `shaders/index.json` and package roles:

| Id | Typical use |
|----|-------------|
| `default` | Neutral / wash (also container) |
| `grain` | Film grain |
| `dither` | Ordered/Bayer-style quantization feel |
| `lcd`, `lcd2`, `mono-lcd`, `oled` | Flat panel families |
| `crt` | CRT (curvature, mask, scanlines, phosphor bloom, vignette) |
| `vhs` | Tape degradation |
| `led-matrix` | LED grid |
| `phosphor` | Green/amber phosphor terminal |
| `projector` | Projection / soft focus feel |
| `thermal` | False-color thermal |

**Strength:** period / device looks are deep.  
**Gap:** foundation grade, generic optics, temporal feedback, controlled glitch/warp, and small utilities. Designers currently overuse CRT/VHS to get “any interest,” which makes looks samey.

### 2.2 Runtime contract (unchanged)

Postprocess layers:

1. Capture scene (or container content) → `u_scene`
2. For each enabled layer: sample previous → write next (ping-pong)
3. Optional `u_prev` if the package declares it (feedback texture)
4. Injected: `u_time`, `u_resolution`, `v_uv`
5. User uniforms from `controls.json` + optional modulators via `param-mod.js`
6. **Convention:** every postprocess pack exposes `u_intensity` (0–1) wet/dry mix

Packages live under `shaders/<id>/` with `shader.frag` + `controls.json`, registered in `shaders/index.json`.

### 2.3 Where packs apply

| Surface | Use |
|---------|-----|
| **Look → FX stack** | Full-frame portrait look (primary toolkit surface) |
| **Object → FX** (per container) | Local polish on cover / ARTEF4KT / viz panels — prefer cheap packs |
| **Presets** | `scene.postprocess.layers[]` + optional per-container `postprocess` |

---

## 3. Design principles

1. **Compose, don’t monopolize** — New packs should stack *with* CRT/VHS/grain, not re-implement a full CRT.
2. **Few knobs, wide range** — Prefer 4–10 uniforms; bury edge cases under `advanced: true`.
3. **Always wet/dry** — `u_intensity` (or documented alias + `u_intensity`) so stacks stay controllable.
4. **Modulator-friendly floats** — Amount, radius, threshold, slice count (as float stepper) first.
5. **Cheap defaults** — Full-res, fixed tap counts; no mandatory multi-pass for v1.
6. **WebGL1-safe GLSL** — `texture2D`, `gl_FragColor`; no required extensions beyond optional derivatives.
7. **Stable ids** — Lowercase kebab ids; never rename after ship without migration.
8. **Performance budget** — A “heavy” stack is ~4 medium packs or 2 heavy + 2 light at 1080×1920-class DPR.

### Complexity tiers (implementation + runtime cost)

| Tier | Cost | Examples |
|------|------|----------|
| **L** (light) | 1–4 samples, pure color math | levels, contrast-sat, hue-shift, vignette, invert, posterize, duotone |
| **M** (medium) | 5–16 taps or light noise | bloom (multi-tap), chromatic, blur box, pixelate, barrel, sharpen, warp-ripple |
| **H** (heavy) | Many taps, feedback, or large neighborhoods | feedback-trail, rgb-glitch + noise, halftone high density, oil-paint |

---

## 4. Catalog (full toolkit)

Packages below are the **target catalog**. Existing display sims stay; new work is **N1–N24**.

### 4.1 Already shipped (keep; document in recipes)

`grain`, `dither`, `crt`, `vhs`, `lcd`, `lcd2`, `mono-lcd`, `oled`, `led-matrix`, `phosphor`, `projector`, `thermal`, `default`

### 4.2 Color & grade (new)

| Id | Name | Tier | Purpose | Core uniforms (beyond `u_intensity`) |
|----|------|------|---------|--------------------------------------|
| **N1 `levels`** | Levels / LGG | L | Lift–gamma–gain foundation | `u_lift`, `u_gamma`, `u_gain` (float or vec3 — **v1: float global + optional color advanced**) |
| **N2 `contrast-sat`** | Contrast & saturation | L | Punch without full grade | `u_contrast`, `u_saturation`, `u_brightness` |
| **N3 `color-balance`** | Color balance | L | Shadow / mid / highlight tints | `u_shadows`, `u_mids`, `u_highs` (color), `u_amount` |
| **N4 `duotone`** | Duotone | L | Map luma to two colors | `u_color_a`, `u_color_b`, `u_contrast`, `u_smooth` |
| **N5 `hue-shift`** | Hue shift | L | Rotate hue; optional sat | `u_hue` (−180…180° as −0.5…0.5 or degrees), `u_saturation` |
| **N6 `posterize`** | Posterize | L | Quantize channels | `u_levels` (2–32 stepper) |
| **N7 `invert`** | Invert | L | Negative / partial invert | (intensity only, or `u_channel` advanced) |

**Ship order:** N2 + N1 first (max preset impact), then N4, N3, N5–N7.

### 4.3 Optics & lens (new)

| Id | Name | Tier | Purpose | Core uniforms |
|----|------|------|---------|---------------|
| **N8 `bloom`** | Bloom | M | Threshold glow | `u_threshold`, `u_radius`, `u_strength`, `u_iterations` (stepper 1–4) |
| **N9 `vignette`** | Vignette | L | Edge darken/lighten | `u_amount`, `u_softness`, `u_roundness`, `u_invert` (0/1) |
| **N10 `chromatic`** | Chromatic aberration | M | RGB split | `u_amount`, `u_angle` (optional) |
| **N11 `blur`** | Blur | M | Soften / dream | `u_radius`, `u_quality` (stepper taps) |
| **N12 `barrel`** | Lens distortion | M | Barrel / pincushion | `u_amount` (−1…1), `u_zoom` (compensate edges) |
| **N13 `sharpen`** | Sharpen | M | Unsharp mask | `u_amount`, `u_radius` |

**Note:** `crt` already includes vignette/bloom-like terms; standalone N8/N9 are for non-CRT stacks and finer control.

### 4.4 Temporal / feedback (new)

| Id | Name | Tier | Purpose | Core uniforms | Special |
|----|------|------|---------|---------------|---------|
| **N14 `feedback-trail`** | Feedback trail | H | Motion smear / tunnel | `u_decay`, `u_zoom`, `u_rotate`, `u_mix` | **Requires `u_prev`** |
| **N15 `echo-smear`** | Echo smear | H | Higher decay + UV drift | `u_decay`, `u_drift`, `u_angle` | **Requires `u_prev`** |

### 4.5 Distortion & glitch (new)

| Id | Name | Tier | Purpose | Core uniforms |
|----|------|------|---------|---------------|
| **N16 `rgb-glitch`** | RGB glitch | M–H | Slice + channel offset | `u_amount`, `u_slices`, `u_seed` or time-driven chaos |
| **N17 `scan-tear`** | Scan tear | M | Horizontal tears | `u_amount`, `u_speed`, `u_band` |
| **N18 `warp-ripple`** | Warp ripple | M | Radial waves | `u_amplitude`, `u_frequency`, `u_speed`, `u_center` (vec2 advanced) |
| **N19 `warp-noise`** | Warp noise | M | Domain-warped UV | `u_scale`, `u_strength`, `u_speed` |
| **N20 `pixelate`** | Pixelate | L–M | Mosaic | `u_size` (px or relative) |
| **N21 `block-corrupt`** | Block corrupt | M | Macroblock noise | `u_block`, `u_density`, `u_amount` |

### 4.6 Stylize (new)

| Id | Name | Tier | Purpose | Core uniforms |
|----|------|------|---------|---------------|
| **N22 `outline`** | Outline / Sobel | M | Edge detect | `u_strength`, `u_color`, `u_threshold`, `u_invert_bg` |
| **N23 `halftone`** | Halftone | M | Dot screen | `u_scale`, `u_angle`, `u_contrast` |
| **N24 `crosshatch`** | Crosshatch | M | Sketch lines | `u_density`, `u_thickness`, `u_contrast` |

### 4.7 Utility (new, small)

| Id | Name | Tier | Purpose |
|----|------|------|---------|
| **N25 `mirror`** | Mirror | L | Flip H/V, optional kaleido-2 |
| **N26 `crop-zoom`** | Crop zoom | L | Zoom + pan before other FX |
| **N27 `clamp-tonemap`** | Clamp / soft clip | L | Soft knee to prevent blowout after bloom |

*(Catalog count: 27 new ids N1–N27; implement in phases — not all required for v1 “toolkit usable.”)*

### 4.8 Explicitly deferred

| Idea | Why deferred |
|------|----------------|
| True multi-pass half-res bloom | Needs stack/renderer changes |
| External `.cube` LUT files | IO + UI + packaging |
| Depth of field (real CoC) | No depth buffer in capture path |
| Full ASCII | Cost + font atlas complexity |
| God rays / radial blur from light centers | Needs light buffer or many samples |

---

## 5. Package contract (normative for this work)

### 5.1 Files

```
shaders/<id>/
  controls.json
  shader.frag
```

Register `<id>` in `shaders/index.json` (order: group new packs after utilities/display or in logical blocks — document final order in Phase 0).

### 5.2 `controls.json` minimum

```json
{
  "id": "contrast-sat",
  "name": "Contrast & Saturation",
  "description": "…",
  "roles": ["postprocess"],
  "entry": "shader.frag",
  "uniforms": [
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
      "format": "percent",
      "hint": "0 = original scene, 1 = full effect"
    }
  ]
}
```

Rules:

- `roles` must include `"postprocess"` (dual-role only if truly useful as container fill).
- Every pack: **`u_intensity`** in group `"Mix"` (or `"Master"`) first or last consistently — **prefer last** so effect knobs come first (match grain/crt patterns where possible; **decision: put Mix group last** for new packs).
- Colors: `type: "color"`, defaults as `[r,g,b]` in 0–1.
- Discrete levels: `float` + `widget: "stepper"`.
- Use `group` strings consistently: `Mix`, `Color`, `Optics`, `Distort`, `Temporal`, `Style`, `Utility`.

### 5.3 Fragment shader minimum

```glsl
uniform sampler2D u_scene;
uniform float u_intensity;
// do not redeclare u_time, u_resolution, v_uv

void main() {
  vec3 original = texture2D(u_scene, v_uv).rgb;
  vec3 col = original;
  // … process into col …
  col = mix(original, col, clamp(u_intensity, 0.0, 1.0));
  gl_FragColor = vec4(col, 1.0);
}
```

Feedback packs also:

```glsl
uniform sampler2D u_prev;
```

### 5.4 Quality bar (per package)

Before marking a package **done**:

1. Appears in Controls Look → Add FX and Object → Panel FX.  
2. Defaults look intentional (not broken/black/white).  
3. `u_intensity = 0` ≈ identity (within float error).  
4. Extreme knobs do not NaN or flash solid magenta (debug).  
5. Save/load preset round-trips uniforms.  
6. One float is smoke-tested with a sine modulator.  
7. No reliance on mouse or audio uniforms (unless explicitly documented later).

---

## 6. Stack recipes (validation targets)

Use these as **acceptance demos** (manual or preset files).

| Recipe | Layers (bottom → top) | Intent |
|--------|----------------------|--------|
| **Clean grade** | `levels` → `contrast-sat` → `vignette` → `grain` | Everyday polish |
| **Music glow** | `bloom` → `chromatic` → `vignette` → `grain` | Music video |
| **Liquid stage** | (ARTEF4KT visible) `warp-ripple` → `bloom` → `duotone` → `grain` | Embed-friendly |
| **Broken broadcast** | `rgb-glitch` → `vhs` → `scan-tear` → `dither` | Chaos |
| **Terminal poster** | `outline` → `phosphor` → `grain` | Graphic |
| **Feedback tunnel** | `feedback-trail` → `barrel` → `chromatic` → `levels` | Temporal |
| **Soft dream** | `blur` → `bloom` → `color-balance` → `vignette` | Ballad |
| **Print** | `contrast-sat` → `halftone` → `dither` | Poster |

Optional: ship 2–3 presets under `presets/` once Phase A–B land (e.g. `toolkit-music-glow.json`, `toolkit-clean-grade.json`).

---

## 7. Phased implementation

### Phase 0 — Inventory, naming lock, perf budget

**Status:** pending  

Tasks:

1. Confirm stack cost of current max realistic scene (default containers + ARTEF4KT + 3–4 FX).  
2. Lock id list for Phase A–C (subset of N1–N27).  
3. Lock uniform naming (`u_intensity` always; prefer `u_amount` vs `u_strength` consistency per domain).  
4. Decide index.json ordering (recommended blocks: grade → optics → temporal → glitch → stylize → utility → existing display sims).  
5. Add checklist section to [authoring/shaders.md](../authoring/shaders.md) linking this plan.

**Exit:** Written decisions in §11; no code required beyond doc links.

### Phase A — Core grade + lens (P0)

**Status:** pending  
**Packages:** `contrast-sat`, `levels`, `bloom`, `vignette`, `chromatic`

Tasks:

1. Implement five packages + register.  
2. Manual stack: Clean grade + Music glow recipes.  
3. Verify per-container FX on song-cover and `artef4kt` with light settings.  
4. Changelog entry.

**Exit:** Five packs usable in Look FX; recipes work; no regressions on existing packs.

### Phase B — Motion + chaos (P1)

**Status:** pending  
**Packages:** `feedback-trail`, `rgb-glitch`, `warp-ripple`, `pixelate`, `blur`

Tasks:

1. Implement five packages; `feedback-trail` must declare `u_prev` and be tested with stack feedback path.  
2. Recipes: Feedback tunnel, Liquid stage, glitch smoke.  
3. Perf check with ARTEF4KT + feedback + bloom (document if half-res needed later).  
4. Changelog.

**Exit:** Temporal + glitch toolkit usable; known perf notes in this plan §10.

### Phase C — Style + remaining optics (P2)

**Status:** pending  
**Packages:** `duotone`, `barrel`, `outline`, `halftone`, `sharpen`, `hue-shift` (stretch: `color-balance`, `scan-tear`)

Tasks:

1. Implement listed packs.  
2. Recipes: Terminal poster, Print, Soft dream.  
3. Optional: 2 toolkit presets in `presets/`.  
4. Authoring doc table of all postprocess packages.

**Exit:** Style coverage complete for “versatile toolkit” claim.

### Phase D — Utility + polish (P3)

**Status:** pending  
**Packages:** `posterize`, `invert`, `mirror`, `crop-zoom`, `clamp-tonemap`, `warp-noise`, `block-corrupt`, `crosshatch`, `echo-smear`, `color-balance` (if not in C)

Tasks:

1. Fill remaining catalog or explicitly cut with reasons.  
2. Cross-pass on amp caps for modulators where needed.  
3. Move this plan to `history/` when toolkit considered shipped.  
4. Update backlog / CHANGELOG / what-is-music-view package list.

**Exit:** Catalog either complete or consciously trimmed; plan archived.

---

## 8. Implementation notes (per high-value pack)

### 8.1 `contrast-sat` (template for L packs)

- Math in linear-ish RGB is fine for v1 (match existing crt contrast).  
- Order: brightness → contrast around 0.5 or luma mid → saturation via luma mix.

### 8.2 `levels` (LGG)

- `out = gain * pow(max(in + lift, 0), 1/gamma)` style or separate shadow/mid/highlight curves — **prefer simple LGG floats first**.  
- Keep defaults near identity: lift 0, gamma 1, gain 1.

### 8.3 `bloom`

- Extract bright: `max(luma - threshold, 0)`.  
- Blur with dual separable box or N-tap Gaussian approximation at full res.  
- Add back: `original + strength * blurredHighlights`.  
- `u_iterations` may loop taps, not true multi-pass FBOs.

### 8.4 `vignette`

- UV from center; smoothstep edge; optional invert for bright edges.  
- Independent of CRT vignette so non-CRT stacks get framing.

### 8.5 `chromatic`

- Sample R/G/B at UV ± `amount * dir`; dir from angle or radial from center.  
- Radial often looks more “lens”; support `u_mode` float 0/1 advanced if needed — **v1: radial only** to reduce knobs.

### 8.6 `feedback-trail`

- `col = mix(scene, tex(u_prev, uv'), decay)` then mix with intensity.  
- `uv'` = zoom about 0.5 + small rotate.  
- Guard first frame (u_prev black) — decay should not stick forever at 1.0.

### 8.7 `rgb-glitch`

- Horizontal bands via `floor(uv.y * slices)`; hash offset R/B.  
- Use `u_time` for motion when amount > 0; keep deterministic option via seed advanced.

### 8.8 `warp-ripple`

- `uv += normal * sin(r * freq - time * speed) * amp`.  
- Ideal for beat modulation of `u_amplitude` later.

---

## 9. Controls / product UX

No Controls chrome rewrite required if packages follow schema.

| Concern | Approach |
|---------|----------|
| Discoverability | Clear `name` + `description`; groups in widgets |
| Ordering in Add FX | Phase 0 index order |
| Per-container use | Document which packs are “safe light” (L tier) |
| Presets | New packs optional in layers; missing pack on old app versions already handled by load errors — keep ids stable |
| ARTEF4KT | Prefer global stack grade/optics; light grain/chromatic on panel only if needed |

---

## 10. Performance budget

| Scenario | Target |
|----------|--------|
| Idle default scene + 3 L packs | No visible hitch; 60fps class on desktop GPU |
| ARTEF4KT + bloom + chromatic + grain | Playable (≥30fps) on M-class / mid GPU |
| ARTEF4KT + feedback-trail + bloom + glitch | May dip; document; allow disabling feedback |

Mitigations if over budget:

1. Lower default `u_radius` / taps.  
2. Mark heavy packs in description (“expensive”).  
3. Future: half-res bloom pass (out of scope v1).

---

## 11. Decisions (lock in Phase 0)

| # | Decision | Recommendation |
|---|----------|----------------|
| D1 | Mix control name | Always `u_intensity`, group `Mix`, **last** in uniforms list |
| D2 | Radial vs angular chromatic | v1 radial only |
| D3 | Levels model | Global float LGG first; vec3 channel LGG advanced or Phase D |
| D4 | Feedback packs | Must declare `u_prev`; test stack enables feedback texture |
| D5 | Dual-role packages | New toolkit packs are **postprocess-only** unless proven need |
| D6 | Index ordering | Grade → optics → temporal → glitch → stylize → utility → existing display |
| D7 | Preset shipping | At least 2 demo presets after Phase B |
| D8 | Audio-driven knobs | No hard-coded audio uniforms in v1 packs; use modulators / future audio sources |

---

## 12. File touch map

| Area | Files |
|------|--------|
| New packages | `shaders/<id>/shader.frag`, `shaders/<id>/controls.json` |
| Catalog | `shaders/index.json` |
| Docs | this plan; [authoring/shaders.md](../authoring/shaders.md); [overview/what-is-music-view.md](../overview/what-is-music-view.md) package table; [CHANGELOG.md](../CHANGELOG.md) |
| Presets (later) | `presets/toolkit-*.json` |
| Runtime | **No** `shaders.js` changes if contract unchanged; feedback already supported |

---

## 13. Acceptance criteria (toolkit “v1 complete”)

Phase A–C done is the bar for **v1 toolkit complete**:

1. ≥ **15** new postprocess packages shipped (Phase A5 + B5 + C≥5).  
2. All packs pass quality bar §5.4.  
3. Clean grade + Music glow + Feedback tunnel + Liquid stage recipes work.  
4. Authoring doc lists postprocess packages with one-line purpose.  
5. No regression: existing display packs still load and preset-apply.  
6. CHANGELOG documents the toolkit drop(s).  
7. This plan progress table updated; when fully done, move to `history/`.

---

## 14. Progress

| Phase | Status | Notes |
|-------|--------|--------|
| 0 Inventory & design lock | **Done** | Decisions §11 accepted; index order grade → optics → rest |
| A Core grade + lens | **Done** (2026-08-13) | `contrast-sat`, `levels`, `bloom`, `vignette`, `chromatic` + presets `toolkit-clean-grade`, `toolkit-music-glow` |
| B Motion + chaos | **Done** (2026-08-13) | `blur`, `pixelate`, `warp-ripple`, `rgb-glitch`, `feedback-trail` + presets `toolkit-feedback-tunnel`, `toolkit-liquid-stage`, `toolkit-broken-broadcast` |
| C Style + optics | **Done** (2026-08-13) | `duotone`, `barrel`, `outline`, `halftone`, `sharpen`, `hue-shift` + presets `toolkit-terminal-poster`, `toolkit-print`, `toolkit-soft-dream` |
| D Utility + polish | **Done** (2026-08-13) | `invert`, `posterize`, `mirror`, `crop-zoom`, `clamp-tonemap`, `color-balance`, `warp-noise`, `block-corrupt`, `crosshatch`, `echo-smear` + presets `toolkit-echo-haze`, `toolkit-sketch` |

---

## 15. Implementation order (when executing)

1. Phase 0: lock D1–D8; link from roadmap/backlog.  
2. Phase A packages one-by-one (contrast-sat first as template).  
3. Smoke each with Look FX add → tweak → preset save/load.  
4. Phase B with feedback emphasis.  
5. Phase C + optional presets.  
6. Phase D or archive with deferred list.  
7. Update living docs; archive plan.

---

## Appendix A — Why not only more display sims?

Display sims solve “what screen am I on?” Grade/optics/glitch solve “how is this shot finished?” Music visualization needs both: ARTEF4KT + ferro panels provide content; toolkit packs provide **finish**.

## Appendix B — Mapping to user-facing Controls

| User goal | Packs to reach for |
|-----------|-------------------|
| Make it prettier | levels, contrast-sat, vignette, grain |
| Make it glow | bloom, chromatic |
| Make it move | feedback-trail, warp-ripple |
| Make it broken | rgb-glitch, scan-tear, vhs, dither |
| Make it graphic | outline, duotone, halftone, phosphor |
| Soft / dreamy | blur, bloom, color-balance, vignette |

## Appendix C — Related docs

- [authoring/shaders.md](../authoring/shaders.md) — package contract  
- [architecture/system.md](../architecture/system.md) — WebGL / postprocess  
- [authoring/presets.md](../authoring/presets.md) — layer serialization  
- [authoring/param-modulation.md](../authoring/param-modulation.md) — LFO on floats  
- [roadmap/backlog.md](./backlog.md) — audio-reactive modulators (future)  
