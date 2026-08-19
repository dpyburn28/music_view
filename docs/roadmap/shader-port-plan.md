# Shader port from Three-World

Port selected GLSL effects from `/Volumes/ARCHIVE/Creative/Code/Active/Three-World/shaders/` into music_view shader packages. Each shader is its own phase — complete one before starting the next.

## Adaptation rules

Three-World and music_view share the same GLSL target (WebGL1 / GLES) but differ in conventions:

| Three-World | music_view | Notes |
|-------------|-----------|-------|
| `varying vec2 vTexCoord` / `vUv` | `varying vec2 v_uv` (injected) | 0–1 across the quad |
| `uniform sampler2D tDiffuse` / `u_tex` | `uniform sampler2D u_scene` | Previous composite (postprocess) |
| `uniform sampler2D u_prev` | `uniform sampler2D u_prev` | Feedback texture (same name) |
| `#include "uniforms.glsl"` | **Inline everything** | Single `.frag` file per package |
| `uniform int u_frame` | `uniform float u_frame` | music_view uses float |
| `uniform vec2 u_mouse` | — | Not available; remove |
| Vertex-varying world direction | Derive from `v_uv` + `u_resolution` | See per-shader notes |
| `controls.json` (Tweakpane) | `controls.json` (music_view schema) | Same shape, different widget types |
| Separate `vert.glsl` | None needed | Runtime provides fullscreen quad |

Each ported package goes into `shaders/<id>/` with `controls.json` + `shader.frag`. Register in `shaders/index.json`.

## Per-shader checklist

1. Create `shaders/<id>/controls.json` with `id`, `name`, `description`, `roles`, `entry`, `uniforms`
2. Create `shaders/<id>/shader.frag` with inlined GLSL (no `#include`, no `varying` from vert)
3. Add `<id>` to `shaders/index.json`
4. Test: apply as container fill or postprocess layer in Controls
5. Create a look preset in `presets/` that features the new shader (postprocess layer or container fill)

## Shared utilities

The shaders share common noise/hash functions. Each shader file should include only the functions it actually calls:

- `hash(vec2)` — `fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453)` (2D value noise basis)
- `noise(vec2)` — bilinear-smoothed hash (used by sky, wind_vis, dither)
- `fbm(vec2)` — 6-octave rotated FBM (used by sky_desert, eye)
- `voronoi(vec2)` — F1/F2 Worley noise (used by eye)
- `snoise(vec3)` — simplex noise with gradient (used by caustics)

---

## Phase 1 — `dither` (postprocess)

**Source:** `shaders/dither/frag.glsl` + `common.glsl`
**Role:** `postprocess` (samples `u_scene`)
**Complexity:** Low

Adaptation:
- Replace `texture2D(tDiffuse, uv)` → `texture2D(u_scene, v_uv)`
- Remove `uniform sampler2D tDiffuse`
- Inline the hash + noise functions from `common.glsl`
- `gl_FragCoord.xy` is available as-is
- Rename `u_ditherScale` → `u_scale`, `u_ditherStrength` → `u_strength`

Uniforms: `u_scale` (float, default 2.0), `u_strength` (float, default 0.5), `u_keepColor` (float toggle 0/1, default 1.0).

---

## Phase 2 — `feedback-echo` (postprocess)

**Source:** `shaders/feedback/frag.glsl`
**Role:** `postprocess` (samples `u_scene` + `u_prev`)
**Complexity:** Very low

Adaptation:
- Rename `tCurrent` → `u_scene`, `tPrev` → `u_prev`
- Rename `uDecay` → `u_decay`
- Replace `vUv` → `v_uv`

Uniforms: `u_decay` (float, 0–1, default 0.85).

Note: music_view's existing `feedback-trail` already does this. Port only if the simpler implementation is preferred as a baseline.

---

## Phase 3 — `datamosh` (postprocess)

**Source:** `shaders/datamosh/frag.glsl`
**Role:** `postprocess` (samples `u_scene` + `u_prev`)
**Complexity:** Low

Adaptation:
- Rename `u_tex` → `u_scene`, `u_prev` stays
- Replace `vTexCoord` → `v_uv`
- `u_frame` is already injected by runtime (as float); guard first frame with `u_frame < 1.0`
- `u_lumWeights` should default to `[0.2126, 0.7152, 0.0722]`
- Remove `uniform int u_frame` (runtime provides it)

Uniforms: `u_thresholdMax` (float, default 0.15), `u_thresholdRamp` (float, default 0.8), `u_spawnRate` (float, 0–1, default 0.7), `u_spawnScale` (float, default 8.0), `u_spawnSpeed` (float, default 1.0), `u_spawnSeed` (float, default 0.0), `u_deltaScale` (float, default 1.0).

---

## Phase 4 — `sky-gradient` (container)

**Source:** `shaders/sky/frag.glsl`
**Role:** `container` (no `u_scene`)
**Complexity:** Low–Medium

Adaptation:
- Remove `varying vec3 vWorldDir` — derive a fake view direction from `v_uv`:
  ```glsl
  vec2 p = (v_uv - 0.5) * vec2(u_resolution.x / u_resolution.y, 1.0);
  vec3 dir = normalize(vec3(p, 0.5));
  ```
  This gives a hemisphere projection that works well for a portrait panel.
- Inline hash + noise functions
- `u_horizonFade` is declared but unused in the original; drop it

Uniforms: `u_topColor` (color, default [0.2, 0.4, 0.8]), `u_bottomColor` (color, default [0.7, 0.8, 1.0]), `u_cloudSpeed` (float, default 0.05), `u_cloudScale` (float, default 3.0), `u_cloudDensity` (float, 0–1, default 0.45), `u_cloudSoftness` (float, default 0.15), `u_cloudBrightness` (float, default 0.9), `u_horizonOffset` (float, default 0.0), `u_cloudHeight` (float, default 0.0).

---

## Phase 5 — `caustics` (container)

**Source:** `shaders/water_caustics/frag.glsl` + `common.glsl`
**Role:** `container`
**Complexity:** Medium

Adaptation:
- Remove `screenToWorldPlane()` — not needed; use UV directly as world-space input:
  ```glsl
  vec3 pos = vec3(v_uv * u_worldScale, u_time * u_timeSpeed);
  ```
- Inline the simplex noise from `common.glsl` (`snoise` returning vec4)
- Remove camera/focal uniforms (`u_cameraDir`, `u_focalLength`, `u_worldOffset`)
- Replace `vTexCoord` → `v_uv`

Uniforms: `u_warpStrength` (float, default 0.8), `u_warpIterations` (float, 1–8, default 5), `u_contrastScale` (float, default 1.5), `u_contrastBias` (float, default 0.5), `u_color` (color, default [0.4, 0.8, 1.0]), `u_timeSpeed` (float, default 0.3), `u_worldScale` (float, default 3.0).

---

## Phase 6 — `wind-lic` (container)

**Source:** `shaders/wind_vis/frag.glsl`
**Role:** `container`
**Complexity:** Medium

Adaptation:
- Replace `varying vec2 vWorldXZ` → derive from `v_uv`:
  ```glsl
  vec2 vWorldXZ = v_uv * u_fieldSize;
  ```
- Inline hash + noise functions
- The LIC loop (`u_lineSteps` up to 64) is the main cost; keep the `for` + `if` guard pattern
- Output alpha for transparency: `gl_FragColor = vec4(u_lineColor * alpha, alpha);`

Uniforms: `u_fieldSize` (float, default 10.0), `u_windDir` (vec2, default [1.0, 0.0]), `u_windSpeed` (float, default 1.0), `u_windStrength` (float, default 1.0), `u_windWaveFreq` (float, default 0.3), `u_gustStrength` (float, default 0.5), `u_gustSpeed` (float, default 0.8), `u_gustFrequency` (float, default 2.0), `u_turbulence` (float, default 0.3), `u_lineColor` (color, default [1.0, 1.0, 1.0]), `u_lineOpacity` (float, 0–1, default 0.6), `u_lineLength` (float, default 1.0), `u_lineSteps` (float, 8–64, default 32), `u_lineScale` (float, default 1.0), `u_lineFade` (float, default 1.5), `u_gustOpacity` (float, default 0.4).

---

## Phase 7 — `sky-desert` (container)

**Source:** `shaders/sky_desert/frag.glsl`
**Role:** `container`
**Complexity:** High

Adaptation:
- Same hemisphere projection as `sky-gradient` for `vWorldDir` derivation
- Inline hash, hash3, noise, fbm functions
- Replace `u_sunDir` (vec3 direction) with simpler polar controls: `u_sunAzimuth` (float, radians) + `u_sunElevation` (float, radians) → convert to direction in-shader
- `u_nightBlend` should default to 0.0 (daytime); can be driven by a modulator for day/night cycle

Uniforms (24 total — group into UI sections):
- **Sun:** `u_sunAzimuth` (float, default 0.5), `u_sunElevation` (float, default 0.3), `u_sunColor` (color, default [1.0, 0.9, 0.7]), `u_sunSize` (float, default 0.02), `u_sunBloom` (float, default 0.15)
- **Sky:** `u_zenithColor` (color, default [0.1, 0.2, 0.5]), `u_horizonColor` (color, default [0.7, 0.6, 0.5]), `u_groundColor` (color, default [0.3, 0.25, 0.2]), `u_horizonSharpness` (float, default 1.5), `u_horizonOffset` (float, default 0.0)
- **Haze:** `u_hazeColor` (color, default [0.8, 0.7, 0.5]), `u_hazeStrength` (float, default 0.3)
- **Clouds:** `u_cloudSpeed` (float, default 0.04), `u_cloudScale` (float, default 3.0), `u_cloudDensity` (float, 0–1, default 0.45), `u_cloudSoftness` (float, default 0.15), `u_cloudBrightness` (float, default 1.0), `u_cloudHeight` (float, default 0.1), `u_cloudColor` (color, default [1.0, 0.95, 0.9]), `u_cloudShadowColor` (color, default [0.4, 0.4, 0.5])
- **Stars:** `u_starDensity` (float, default 40.0), `u_starBrightness` (float, default 1.0), `u_starSize` (float, default 1.0), `u_nightBlend` (float, 0–1, default 0.0)

---

## Phase 8 — `procedural-eye` (container)

**Source:** `shaders/eye/frag.glsl`
**Role:** `container`
**Complexity:** High

Adaptation:
- The original maps UV to eye-space using `u_eyeRadius` and an explicit `drawCircle`/`drawEyelid` system with `gl_FragColor` mutation. This is already 2D and maps cleanly to music_view.
- Replace `vTexCoord` → `v_uv`
- Remove `uniform vec2 u_mouse` (not used in frag)
- The `drawCircle` function uses `gl_FragColor` as a read-write target — this works in WebGL1
- `u_frame` is unused in the frag; remove
- Consider simplifying the eyelid to a single squeeze parameter for music_view use

Uniforms (23 total — group into sections):
- **Eye shape:** `u_eyeRadius` (float, default 0.4), `u_scleraSqueeze` (float, default 0.0), `u_scleraAngle` (float, default 0.0), `u_scleraColor` (color, default [0.95, 0.95, 0.95])
- **Pupil:** `u_pupilPosition` (vec2, default [0.0, 0.0]), `u_pupilRadius` (float, default 0.12), `u_pupilColor` (color, default [0.02, 0.02, 0.02])
- **Iris:** `u_irisRadius` (float, default 0.25), `u_irisInnerColor` (color, default [0.3, 0.5, 0.2]), `u_irisOuterColor` (color, default [0.15, 0.35, 0.55]), `u_irisCryptColor` (color, default [0.1, 0.15, 0.1]), `u_limbalWidth` (float, default 0.03), `u_irisRadialComp` (float, default 1.0), `u_irisCryptFreq` (float, default 8.0), `u_fiberFreq` (float, default 12.0)
- **Eyelid:** `u_eyelidColor` (color, default [0.6, 0.45, 0.35]), `u_eyelidBias` (float, default 0.0), `u_eyelidAngle` (float, default 0.0), `u_blink` (float, 0–1, default 0.0)
- **Render:** `u_soften` (float, default 0.01)
