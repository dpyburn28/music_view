> **Archived plan** — shipped work. Living docs: [docs/README.md](../../README.md) · [backlog](../backlog.md).

# Param Modulation Plan

Let any **float control** (Look FX layer params and Object container shader params) be driven by a **static value**, **wall time**, a **sine wave**, or **noise**, with editable **amplitude, rate, offset, phase** (and related knobs)—without rewriting GLSL packages.

**Depends on:** Shader controls overhaul Phases 0–5 complete (`shader-controls-overhaul-plan.md`). Shared widget toolkit + meta pass-through already exist.

**Scope (primary):** Postprocess layer uniforms + container shader uniforms; display-side per-frame evaluation; controls UI mode + modulator knobs; preset save/load of modulation specs.

**Scope (secondary):** Live readout of the *resolved* value while modulated; clamp to package min/max.

**Out of scope (v1):** Modulating colors/vec/bool/enums; full node graph / cross-param routing; audio-reactive sources (beat, spectrum); custom expression language; GLSL changes per package.

---

## Progress

| Phase | Status | Notes |
|-------|--------|--------|
| 0 Inventory & design lock | **Complete** (2026-08-08) | Rule-based eligibility; decisions locked in §15–16 |
| 1 Runtime evaluator | **Complete** (2026-08-08) | `param-mod.js` + postprocess/container resolve; static fast path |
| 2 State + IPC + presets | **Complete** (2026-08-08) | getState/export/apply + IPC set*Modulators; additive preset keys |
| 3 Controls UI | **Complete** (2026-08-08) | Source segmented + mod sub-rows; local rAF readout; freeze-on-static |
| 4 Package / product pass | **Complete** (2026-08-08) | Amp caps, breathing-crt preset, README note |
| 5 Polish | **Complete** (2026-08-08) | A11y, group badges, tri/sq, clocks, amp≈0 skip |

---

## 1. Goals

| Goal | Success look |
|------|----------------|
| One click from static → animated | Any continuous float (e.g. CRT scanlines, grain amount) can breathe without new shaders |
| Familiar modular knobs | **Source** + **rate** + **amp** + **offset** (+ phase) reads like a cheap LFO, not a programming task |
| Presets remember motion | Save/load restores modulation specs; looks match after reload |
| Zero regression for static looks | Layers with no modulators behave exactly as today (values, presets, performance) |
| No GLSL package edits | All packages keep current uniforms; modulation is external to frag sources |

### Non-goals (v1)

- Driving segmented / toggle / stepper / color / vec rows  
- Linking one param’s output into another’s input  
- Shadertoy-style freeform math expressions  
- Syncing phase to music beats (phase 5 optional *wall vs song time* only)

---

## 2. Current state (baseline)

### 2.1 How values reach the GPU

1. Controls UI edits a uniform → `setPostprocessLayerUniforms` / `setContainerUniforms` with `{ [name]: number | number[] }`.  
2. Display stores maps on `layer.uniforms` / `state.shaderUniforms`.  
3. Each frame, `shaders.js` postprocess stack:
   - injects **`u_time`** (seconds since stack start) and `u_resolution` / textures;
   - uploads **user uniforms as stored** (`setUserUniforms`) — pure numbers/arrays, no expression step.  
4. Presets store `scene.postprocess.layers[].uniforms` and container `shaderUniforms` as **flat value maps**.

### 2.2 Why modulation is not “just use u_time in the shader”

- Most packages expose *look* knobs (`u_scanline`, `u_amount`, …), not a general LFO input.  
- Users want **any** float control animated without authoring new GLSL.  
- `u_time` already exists inside shaders for grain/noise patterns; that is orthogonal to *driving control values*.

### 2.3 Design implication

**Evaluate modulators on the CPU (display process) each frame**, then upload the resolved number as the existing uniform. Frag shaders stay unchanged.

```
controls / preset
  base value + optional modulator spec
        │
        ▼
display layer state
  uniforms: { u_x: 0.5 }           // base / last static
  modulators: { u_x: { source, … } } // optional
        │
        ▼  every frame (t = wall seconds)
resolve(u_x) = f(source, t, amp, rate, offset, phase) clamped to [min,max]
        │
        ▼
gl.uniform1f(u_x, resolved)
```

---

## 3. Target UX (north star)

> Each continuous float row can switch from a **static slider** to a compact **modulator strip** without leaving the FX params drawer.

### 3.1 Static (default — today’s UI)

```
Scanlines     ═══●══  0.55
```

### 3.2 Modulated

```
Scanlines     [Static ▾| Time | Sine | Noise]     live 0.62
  Offset      ═══●══  0.55
  Amp         ═══●══  0.20
  Rate        ═══●══  0.50 Hz
  Phase       ═══●══  0.00
```

Rules:

1. **Source** is discrete (segmented or select): `static` | `time` | `sine` | `noise`.  
2. Switching **static → sine** seeds **offset** from the current slider value; amp/rate get sensible defaults.  
3. Switching **→ static** freezes the **current resolved** value into the base uniform (no jump if possible).  
4. While modulated, the main slider either **hides** or becomes **offset** (recommend: main row shows live readout; offset is the center).  
5. **min/max** from `controls.json` still clamp the resolved output.  
6. Discrete widgets (segmented/toggle/stepper/color/vec) show **no** mode picker in v1.

### 3.2a Source semantics (v1)

| Source | Formula (conceptual) | Typical use |
|--------|----------------------|-------------|
| `static` | `offset` (or plain base) | Manual look |
| `time` | `offset + amp * (2*fract(t * rate + phase) − 1)` — **locked** bipolar wrapped saw | Bounded ramps / saw LFO |
| `sine` | `offset + amp * sin(2π * rate * t + phase)` | Breathing bloom, scanlines, intensity |
| `noise` | `offset + amp * valueNoise1D(t*rate+phase, seed)` bipolar | Jitter, unstable tape |

Defaults (**locked** Phase 0):

| Param | Default | Notes |
|-------|---------|--------|
| `offset` | current static value | Center of modulation |
| `amp` | `0.1 * (max−min)` or `0.1` | Zero = frozen at offset |
| `rate` | `0.5` | Hz for sine/noise; cycles/sec for time saw |
| `phase` | `0` | Radians for sine; cycles for noise/time |
| `seed` | hash(paramName) | Noise only; optional UI advanced |

### 3.3 Visual language

- Reuse Phase 2 density (segmented source, sliders for amp/rate).  
- Live readout uses tabular nums; optional soft pulse on the readout when source ≠ static.  
- Modulator sub-rows indented or grouped under the param (not a separate global panel).

---

## 4. Data model

### 4.1 Keep value maps; add parallel modulator maps

**Do not** replace bare numbers in `uniforms` with objects (breaks every preset and GLSL upload path).

```ts
// Layer (postprocess) — conceptual
{
  id: number;
  shaderId: string;
  enabled: boolean;
  uniforms: Record<string, number | number[]>;  // UNCHANGED shape
  modulators?: Record<string, ParamModulator>;  // NEW, optional
}

// Container shader — same idea on container state
{
  shaderUniforms: Record<string, number | number[]>;
  shaderModulators?: Record<string, ParamModulator>;
}
```

### 4.2 `ParamModulator` (v1)

```ts
type ModSource = 'static' | 'time' | 'sine' | 'noise';

interface ParamModulator {
  source: ModSource;     // 'static' may be omitted entirely (no entry)
  offset: number;        // center / base
  amp: number;           // peak deviation (all non-static sources)
  rate: number;          // Hz (sine/noise) or cycles/sec (time saw)
  phase?: number;        // radians (sine) or cycles (noise/time)
  seed?: number;         // noise
  /** If true, clamp resolved value to controls.json min/max when known */
  clamp?: boolean;       // default true
}
```

**Invariant:** When `modulators[name]` is missing or `source === 'static'`, GPU value = `uniforms[name]` exactly as today.

**When modulated:** `uniforms[name]` may still store **offset** (or last frozen value) so export always has a fallback number; resolved value is **not** required to be written back into `uniforms` every frame (prefer resolve only at draw). Controls may update `offset` into `uniforms[name]` for consistency.

Recommended write policy:

| UI edit | Writes |
|---------|--------|
| Static slider | `uniforms[name] = v`; delete `modulators[name]` or set static |
| Offset (modulated) | `modulators[name].offset = v` and `uniforms[name] = v` |
| Amp / rate / phase | `modulators[name].…` only |
| Source change | update modulator; maybe seed offset from current resolve |

### 4.3 Preset JSON (additive)

```json
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
      "amp": 0.15,
      "rate": 0.4,
      "phase": 0
    }
  }
}
```

- Old presets without `modulators`: load as all-static.  
- Unknown `source`: treat as static + log once.  
- **Never** put modulator objects inside `uniforms` values.

### 4.4 Eligibility

A uniform may be modulated only if:

1. `type` is `float` or `int` (v1: **float only** recommended; int = round after resolve optional later).  
2. Widget is continuous: `slider` or `number` (or unresolved float with min/max).  
3. Not `color` / `vec*` / `bool`; not discrete `segmented` / `toggle` / `stepper` / `select`.

Use package meta from `controls.json` (already on client) to decide.

---

## 5. Runtime (display)

### 5.1 Evaluation module

Add a small pure helper (e.g. `param-mod.js` or functions in `shaders.js` / `renderer.js`):

```ts
function resolveModulatedValue(
  base: number,
  mod: ParamModulator | null | undefined,
  tSec: number,
  bounds?: { min?: number; max?: number },
): number
```

- Deterministic for sine/time given `t` + params.  
- Noise: value noise or hash of `floor(t * rate * N + phase + seed)` with smoothstep interpolation (cheap, no allocation per call if possible).  
- Clamp when bounds present and `clamp !== false`.

### 5.2 Where to call

**Postprocess stack** (`createPostprocessStack` in `shaders.js`):

Inside `renderOnce`, for each layer, before `setUserUniforms`:

```text
resolved = {}
for each key in layer.uniforms:
  resolved[key] = resolve(layer.uniforms[key], layer.modulators?.[key], t, bounds?)
setUserUniforms(program, resolved)
```

Bounds: optional map from package meta if available on the layer; else clamp only if mod.min/max stored (prefer meta at layer set time).

**Container shaders** (`createShaderRenderer` path): same resolve in `renderOnce` using container modulator map.

### 5.3 Time base

| Option | Pros | Cons |
|--------|------|------|
| **A. Stack/renderer `startTime` (current u_time)** | Matches shader `u_time`; simple | Resets when stack rebuilds |
| **B. `performance.now()` global origin** | Stable across rebuilds | Diverges from u_time |
| **C. Song clock when music playing** | Musical motion | Needs music bridge; pauses |

**v1 recommendation:** **A** for parity with `u_time` (modulated knobs “in time” with grain/phosphor). Document that rebuild may re-phase. Phase 5 may add `clock: 'wall' | 'stack' | 'song'`.

### 5.4 Performance

- Resolve only float keys that have modulators; static keys pass through.  
- Avoid allocations in the hot path (reuse a resolved object per layer if needed).  
- Target: negligible vs full-screen postprocess cost.

---

## 6. Controls UI

### 6.1 Builder integration (`controls.js`)

Extend the float **slider/number** row:

1. Trailing or under-label **source** control (compact segmented: ○ / t / ∿ / ▓ or labels Static · Time · Sin · Noise).  
2. If source ≠ static, expand **mod sub-panel** (Offset, Amp, Rate, Phase; Seed advanced for noise).  
3. **Live readout** of last resolved value (needs display → controls feedback **or** local mirror of the same formula).

**Live readout strategy (locked Phase 0):**

| Approach | Pros | Cons |
|----------|------|------|
| **Local mirror** — controls recompute `resolve(mod, t)` on rAF | No IPC spam | Must share formula (shared module) |
| **State push** — display includes resolved snapshot | Single source of truth | Bandwidth / chatter |

**Locked:** ship **shared pure `resolveModulatedValue`** in `param-mod.js` (both windows); controls rAF updates readouts only (not IPC). Display remains authoritative for GPU.

### 6.2 Commands

Prefer **reuse** existing uniform commands for base values; add modulator updates:

| Command | Payload | Behavior |
|---------|---------|----------|
| `setPostprocessLayerUniforms` | `{ id, uniforms }` | Unchanged (base map merge) |
| `setPostprocessLayerModulators` | `{ id, modulators }` | Partial merge of modulator specs; `null` entry clears |
| `setContainerModulators` | `{ id, modulators }` | Same for container |
| or unified | `{ id, modulators, uniforms? }` | Optional single command |

**getState / exportPreset** must include `modulators` on layers and container modulator maps.

### 6.3 Reset defaults

- Layer **↻ Defaults**: clear all modulators for that layer + restore package default uniforms.  
- Double-click label (Phase 5 overhaul): reset that param to static default and **clear** its modulator.

---

## 7. Compatibility & breakage

| Contract | Rule |
|----------|------|
| `uniforms` value types | Stay numbers / arrays only |
| Old presets | Load with no modulators → identical looks |
| GLSL packages | No required changes |
| Static performance | No extra work when `modulators` empty/missing |
| Export | Must not write modulator objects into `uniforms` |

### Risks

| Risk | Mitigation |
|------|------------|
| Stack rebuild resets phase | Document; optional wall-clock mode later |
| Amp drives out of legal range | Clamp to min/max from meta |
| User confuses offset vs static slider | One clear “Offset” label when modulated |
| Double formula drift (UI vs display) | Single shared module |
| Preset bloat | Only store keys with non-static source |
| Int/stepper accidental modulation | Eligibility gate in UI + runtime ignore |

---

## 8. Phased plan

### Phase 0 — Inventory & design lock

**Tasks**

- [x] List continuous float uniforms eligible by package (or define rule-only; no need to hardcode all 95).  
- [x] Lock **time** source formula (wrapped saw vs linear ramp vs `sin`-only).  
- [x] Lock noise implementation (value noise hash).  
- [x] Lock preset field name (`modulators` vs `modulation`).  
- [x] Lock live readout approach (shared module + local rAF recommended).  
- [x] Decide int support (recommend **defer**).  
- [x] Confirm export/getState paths for layers + containers.

**Exit:** Short “decisions” section filled in this doc; no user-facing feature required. **Met** — see §15–16.

**Breakage risk:** None.

---

### Phase 1 — Runtime evaluator

**Tasks**

- [x] Add `param-mod.js` (or equivalent) with `resolveModulatedValue` + unit-testable pure functions.  
- [x] Wire postprocess `renderOnce` to resolve per-layer modulators before `setUserUniforms`.  
- [x] Wire container `createShaderRenderer` path similarly.  
- [x] If no modulators, keep current assign path (fast path).  
- [x] Manual test: force a modulator in console → visible animation.

**Exit:** With a hand-set modulator on CRT scanline, picture pulses; removing modulator freezes at base. **Met** (console API below).

**Breakage risk:** Medium (render path) — gate on empty modulators.

**Console smoke (display DevTools):**

```js
// After a postprocess layer is active (e.g. CRT):
const id = window.postprocessAPI.getState().layers[0].id;
window.postprocessAPI.setLayerModulators(id, {
  u_scanline: { source: 'sine', offset: 0.55, amp: 0.35, rate: 0.5, phase: 0 },
});
// Clear:
window.postprocessAPI.setLayerModulators(id, { u_scanline: null });
// Or clear all:
window.postprocessAPI.setLayerModulators(id, null);
```

---

### Phase 2 — State, IPC, presets

**Tasks**

- [x] Extend layer model: `modulators` object; clone on add/reorder/export.  
- [x] Container: `shaderModulators` (locked Phase 0).  
- [x] Commands: set/clear modulators (partial merge).  
- [x] `getState` + `exportPreset` / `applyPreset` / `loadPreset` round-trip.  
- [x] Migration: ignore unknown keys; never fail load.

**Exit:** Save preset with sine on grain amount → reload → motion restored; old presets unchanged. **Met** (console + Save Look / load).

**Breakage risk:** Medium (preset shape additive only).

**IPC (display `sceneCommand`):**

| Command | Payload | Behavior |
|---------|---------|----------|
| `setPostprocessLayerModulators` | `{ id, modulators }` | Partial merge; `modulators: null` clears all; `{ name: null }` clears one key; `source: 'static'` clears key |
| `setContainerModulators` | `{ id, modulators }` | Same for container `shaderModulators` |

**Preset keys (additive only):**

- Layer: `modulators` (omit when empty)
- Container: `shaderModulators` (omit when empty)
- `uniforms` / `shaderUniforms` remain numbers/arrays only (sanitized on export/load)

**Round-trip smoke:**

```js
// Display console — set grain amount LFO, then Save Look from Controls
const id = window.postprocessAPI.getState().layers.find(l => l.shaderId === 'grain')?.id
  ?? window.postprocessAPI.getState().layers[0].id;
window.postprocessAPI.setLayerModulators(id, {
  u_amount: { source: 'sine', offset: 0.14, amp: 0.06, rate: 0.45, phase: 0 },
});
// Save Look → reload preset → motion restored. Old presets without modulators unchanged.
```

---

### Phase 3 — Controls UI

**Tasks**

- [x] Mode control on eligible float rows only.  
- [x] Sub-rows: offset, amp, rate, phase (+ seed for noise).  
- [x] Wire to IPC; static path unchanged.  
- [x] Local live readout via shared resolver + rAF while drawer open.  
- [x] Freeze-on-static: write resolved → uniforms, clear modulator.  
- [x] Session: mod panel expands only when source ≠ static (not in presets).

**Exit:** User can animate LCD brightness and CRT mask from the Look drawer without console. **Met.**

**Breakage risk:** Medium (builder complexity) — keep static layout pixel-identical when source=static.

**UI notes:**

- Eligible floats only (`float` + slider/number): compact **Static · Time · Sine · Noise** under the label.
- Modulated: main slider hides; **Offset / Amp / Rate / Phase** (+ **Seed** for noise); live readout pulses via `param-mod.js` + rAF.
- → Static freezes resolved value into the uniform; double-click label clears mod + package default.
- Layer **↻ Defaults** clears all modulators on that layer.
- Container shader path same when package is active.

---

### Phase 4 — Product pass

**Tasks**

- [x] Sensible amp/rate defaults from min/max span.  
- [x] Clamp feedback in UI (amp cannot exceed span if desired).  
- [x] Smoke preset or docs example: “breathing CRT”.  
- [x] Container Color Wash `u_speed` eligible smoke.  
- [x] Author note in `shaders/README.md` or this doc: modulation is runtime, not controls.json.

**Exit:** Happy path documented; one-click demo path for new users. **Met.**

**Breakage risk:** Low.

**Product notes:**

| Item | Detail |
|------|--------|
| Default amp | `min(0.1 × span, maxModAmp(offset))` — bipolar stays in package range |
| Default rate | `0.5` Hz (Phase 0) |
| Amp UI cap | `maxModAmp` = min(span, room above/below offset); label shows “(capped)” when limited by offset |
| Demo preset | `presets/breathing-crt.json` — CRT scanline/mask/bloom sine + Color Wash `u_speed` on cover |
| Authoring | `shaders/README.md` § Param modulation — no controls.json schema for LFOs |

**One-click demo:** Look tab → preset list → **Breathing CRT** → Load.

---

### Phase 5 — Polish

**Tasks**

- [x] A11y: mode group labels, keyboard on source segmented.  
- [x] Visual: live readout emphasis; collapsed mod summary when group collapsed.  
- [x] Optional: `clock: 'stack' | 'wall'`.  
- [x] Optional: triangle / square LFO sources.  
- [x] Optional: song-time clock when music API available.  
- [x] Perf pass: skip resolve when amp===0 (treat as static offset).

**Exit:** Feels like part of the instrument, not a debug panel. **Met.**

**Polish notes:**

| Item | Detail |
|------|--------|
| Source a11y | Radiogroup + `aria-labelledby` / labels; ←→/↑↓/Home/End move selection |
| Group badge | Collapsed `details` shows `N animated` when any param in group is modulated |
| Live readout | Accent weight + pulse; tabular nums |
| Sources | `static` · `time` · `sine` · `triangle` · `square` · `noise` |
| Clocks | `stack` (default, omit on export) · `wall` · `song` (progress panel time) |
| Perf | `\|amp\| < 1e-12` → return offset without wave eval |

---

## 9. File-level change map

| File | Phases | Notes |
|------|--------|-------|
| `param-mod.js` (new) | 1–3 | Pure resolve + noise helper; load from display + controls |
| `shaders.js` | 1 | Resolve in postprocess + container render loops |
| `renderer.js` | 2 | Layer/container state, commands, preset I/O, meta bounds optional |
| `controls.js` | 3–5 | Mode UI, sub-sliders, readout rAF |
| `controls.css` | 3, 5 | Mod sub-panel density |
| `controls.html` | — | Prefer JS-built rows; no hard dependency |
| `preload.js` / `app.js` | 2 | Only if command bridge needs allow-listing |
| `presets/*` | 4 optional | Example preset only; don’t rewrite default unless desired |
| `shaders/*/controls.json` | — | **No change required** for v1 |
| `docs/roadmap/history/param-modulation-plan.md` | all | This plan |

---

## 10. Test plan

### 10.1 Smoke (every phase after 1)

1. Launch → default LCD stack static (no motion regression).  
2. Inject/set sine on `u_intensity` or grain `u_amount` → visible change over ~2s.  
3. Set amp=0 → frozen at offset.  
4. Toggle source static → value freezes near last resolve.  
5. Save preset → reload app → load preset → modulation returns.

### 10.2 Regression

| Action | Expect |
|--------|--------|
| Old preset without modulators | Bit-identical static look |
| Reorder FX layers | Modulators stay with layer id/shader |
| Change package on layer | Clear modulators or drop keys not in new package |
| Basic/All hide advanced | Mod UI only for visible eligible floats |
| Export JSON | `uniforms` values numeric; `modulators` sibling object |

### 10.3 Formula checks (Phase 1)

- Pure tests: sine at t=0, phase=0 → `offset`; amp=0 → `offset`; clamp respects min/max.

---

## 11. Implementation order

1. Phase 0 decisions  
2. Phase 1 evaluator + GPU path  
3. Phase 2 state/IPC/presets  
4. Phase 3 controls UI  
5. Phase 4 defaults + example  
6. Phase 5 polish / optional clocks  

After each phase: §10.1; after 2 also preset round-trip; after 3 full UI smoke.

---

## 12. Rollback

| Phase | Rollback |
|-------|----------|
| 1 resolve in shaders.js | Revert to direct `setUserUniforms(layer.uniforms)` |
| 2 state/preset fields | Ignore `modulators` on load; strip on export if needed |
| 3 UI | Hide mode picker; leave runtime intact for hand-edited presets |

Keep commits split: runtime → preset/IPC → UI.

---

## 13. Open decisions (resolved in Phase 0)

1. **Time source formula:** **Locked — bipolar wrapped saw**  
   `offset + amp * (2 * fract(t * rate + phase) - 1)`  
   Bounded in `[offset−amp, offset+amp]` (then clamp to meta min/max). Linear unbounded ramp rejected for v1.
2. **Field name:** **`modulators`** on postprocess layers; **`shaderModulators`** on containers (parallel to `shaderUniforms`). Not nested under uniforms.
3. **Live readout:** **shared pure module** (`param-mod.js`) + **local rAF** in controls while drawer open. No resolved-value IPC stream in v1.
4. **Int / discrete:** **v1 float-only.** No mode picker on stepper/segmented/toggle/color/vec. (No true `type: "int"` packages today; steppers are float + widget.)
5. **Clear modulators on package change:** **yes** (layer package change and container package change).
6. **Default amp:** **`0.1 * (max − min)`** when span known from meta, else `0.1`.
7. **Music / wall clock:** **defer** to Phase 5+. v1 clock = stack/renderer `u_time` (`(now − startTime) / 1000`).

---

## 14. Relation to prior work

| Prior work | Reuse |
|------------|--------|
| Widget toolkit / eligibility via `widget` + `type` | Gate mode picker |
| Basic/All + groups | Mod UI lives inside same rows |
| `setPostprocessLayerUniforms` partial merge | Keep for base values |
| Layer ↻ Defaults / dblclick reset | Also clear modulators |
| Shader package authoring | No schema change required; document runtime feature separately |

This plan is a **runtime + controls** feature on top of the finished param UI overhaul—not another chrome rewrite.

---

## 15. Phase 0 decision table (locked 2026-08-08)

| Topic | Decision | Date |
|-------|----------|------|
| Eligibility | **Rule-only** (not a hardcoded list): `type === 'float'` (or default float) **and** resolved widget is `slider` or `number`. Use `resolveUniformWidget` (controls) / same rules at runtime. | 2026-08-08 |
| Time formula | Bipolar wrapped saw: `offset + amp * (2*fract(t*rate+phase) − 1)` | 2026-08-08 |
| Sine formula | `offset + amp * sin(2π * rate * t + phase)` — phase in **radians** | 2026-08-08 |
| Noise algo | 1D value noise: hash lattice + smoothstep lerp; sample at `t*rate + phase`; map to bipolar `[-1,1]` then `offset + amp * n`. `seed` folds into hash. | 2026-08-08 |
| Preset / layer key | `modulators: Record<string, ParamModulator>` sibling of `uniforms` | 2026-08-08 |
| Container key | `shaderModulators` (export + live state); never inside `shaderUniforms` values | 2026-08-08 |
| Readout | shared `param-mod.js` + controls rAF (mirror of display formula) | 2026-08-08 |
| Int support | v1 **no** | 2026-08-08 |
| Package change | **clear** all modulators for that layer/container | 2026-08-08 |
| Clock | stack/renderer `u_time` (seconds since startTime) | 2026-08-08 |
| Default amp | `0.1 * (max−min)` else `0.1` | 2026-08-08 |
| Default rate | `0.5` (Hz for sine/noise; cycles/sec for time saw) | 2026-08-08 |
| Default phase | `0` | 2026-08-08 |
| Clamp | default `true`; clamp resolved to package min/max when known | 2026-08-08 |
| Store policy | only persist keys with `source` ∈ {`time`,`sine`,`noise`}; omit static | 2026-08-08 |
| IPC commands (Phase 2) | `setPostprocessLayerModulators` + `setContainerModulators` (partial merge; `null` clears key) | 2026-08-08 |

---

## 16. Phase 0 inventory & path confirmation

### 16.1 Eligibility rule (authoritative)

```text
eligible =
  (def.type || 'float').toLowerCase() === 'float'
  && resolveUniformWidget(def) ∈ { 'slider', 'number' }
```

Ineligible widgets (v1, no mode picker): `stepper`, `segmented`, `toggle`, `select`, `color`, `vec`.

Runtime ignore: if a modulator key exists for an ineligible uniform, treat as static (do not resolve).

### 16.2 Snapshot inventory (static scan 2026-08-08)

All packages under `shaders/*/controls.json` (schema: `uniforms` **array**).

| Metric | Count |
|--------|------:|
| Total uniform defs | 114 |
| Eligible continuous floats | **96** (all resolved `slider`) |
| Ineligible | 18 |

**Eligible by package**

| Package | Role | Eligible floats |
|---------|------|----------------:|
| crt | postprocess | 11 |
| grain | postprocess | 1 |
| lcd | postprocess | 20 |
| lcd2 | postprocess | 14 |
| led-matrix | postprocess | 6 |
| mono-lcd | postprocess | 6 |
| oled | postprocess | 9 |
| phosphor | postprocess | 5 |
| projector | postprocess | 8 |
| thermal | postprocess | 6 |
| vhs | postprocess | 9 |
| default | container | 1 (`u_speed`) |
| **Total** | | **96** |

**Ineligible (mode picker off)**

| Package | Uniform | Resolved widget |
|---------|---------|-----------------|
| crt, lcd, lcd2, led-matrix, mono-lcd×2, phosphor, projector, vhs | `u_tint` / `u_light` / `u_dark` / `u_bg` | color |
| lcd | `u_subpixel_mode` | segmented |
| lcd2 | `u_pixel_layout` | segmented |
| lcd2 | `u_bgr`, `u_force_pixels` | toggle |
| led-matrix | `u_shape` | segmented |
| led-matrix, mono-lcd | `u_levels` | stepper |
| thermal | `u_palette` | segmented |

No package currently uses `type: "int"`; steppers are float + `widget: "stepper"`. No `number`-only floats today (all continuous floats have min/max → slider). Rule still allows `number` for future packages.

### 16.3 Source formulas (locked)

Let `t` = stack/renderer time in seconds; `fract(x) = x − floor(x)`.

| Source | Resolved value (pre-clamp) |
|--------|----------------------------|
| `static` / missing | `uniforms[name]` (base); ignore mod fields |
| `time` | `offset + amp * (2 * fract(t * rate + phase) − 1)` |
| `sine` | `offset + amp * Math.sin(2 * Math.PI * rate * t + phase)` |
| `noise` | `offset + amp * valueNoise1D(t * rate + phase, seed)` → bipolar `[-1, 1]` |

**Noise detail (value noise 1D):**

```text
x = t * rate + phase
i0 = floor(x); f = fract(x)
u = f * f * (3 - 2 * f)          // smoothstep
h0 = hash(i0 + seed)
h1 = hash(i0 + 1 + seed)
n  = mix(h0, h1, u) * 2 - 1      // hash → [0,1] then bipolar
return offset + amp * n
```

`hash(n)`: integer/bit mix producing float in `[0, 1)` (e.g. mul/xor style; exact constant chosen in Phase 1, must be deterministic).

**Phase units:** sine uses **radians**; time/noise treat `phase` as **cycles** (added before fract / lattice).

### 16.4 Export / getState path confirmation

Verified against `renderer.js` (display is source of truth).

| Path | Function | Layer uniforms today | Container uniforms today | Phase 2 hook |
|------|----------|----------------------|--------------------------|--------------|
| Live snapshot | `getSceneState` → `snapshotPostprocessLayers` / `getContainerSnapshot` | `layers[].uniforms` | `containers[].shaderUniforms` | Add `modulators` / `shaderModulators` clones |
| Preset export | `exportScenePreset` | `scene.postprocess.layers[].uniforms` only | `scene.containers[].shaderUniforms` only | Clone sibling modulator maps (omit empty) |
| Preset apply | `applyScenePreset` → `setPostprocessStack` / `applyShaderPackageToState` | restores `uniforms` | restores via package + override | Accept optional modulators; ignore unknown |
| getState IPC | `sceneCommand('getState')` | via `getSceneState` | same | automatic once snapshots include fields |
| Uniform live edit | `updatePostprocessLayerUniforms` / `setContainerUniforms` | merges numbers into maps; pushes to renderer | same | **unchanged**; modulators via new commands |
| Layer model create | `addPostprocessLayer` | `{ id, shaderId, uniforms, enabled, … }` | — | start with no `modulators` |
| Package change | `setPostprocessLayerShader` / `applyContainerShader` | rebuilds uniforms from defaults + override | same | **clear** modulators (locked) |

**Also note:**

- `uniforms` values must remain `number | number[]` only — never modulator objects.
- Legacy flat `postprocess.uniforms` in getState is first-layer only; modulators live on **per-layer** objects only.
- Controls receives state via `getState` / `onState`; no separate export path for modulators beyond presets.
- File IO: `presets.js` / main `presets-load` / `presets-save` are opaque JSON — additive keys are free.

### 16.5 GPU resolve insertion points (for Phase 1)

| Path | File | Call site |
|------|------|-----------|
| Postprocess | `shaders.js` `createPostprocessStack` → `renderOnce` | before `setUserUniforms(layer.program, layer.uniforms)` — resolve using layer modulators + `t` |
| Container | `shaders.js` `createShaderRenderer` → `renderOnce` | before uploading user uniforms |
| Fast path | both | if modulators empty/missing, pass uniforms through unchanged |

Layer objects held by the stack currently carry `uniforms` only; Phase 1–2 must plumb `modulators` onto stack layer state (or resolve from `postprocessState.layers` before upload).

### 16.6 Shared module contract (Phase 1)

File: **`param-mod.js`** (project root, loaded by display + controls; no Node-only APIs).

Exports (names locked for cross-window parity):

- `resolveModulatedValue(base, mod, tSec, bounds?) → number`
- `resolveUniforms(uniforms, modulators, tSec, boundsByName?) → object` (static pass-through + selective resolve)
- `isModSourceActive(mod) → boolean` (`source` in time/sine/noise)
- pure helpers: `valueNoise1D`, `hash01` (or internal)

Controls rAF: for each visible modulated row, call `resolveModulatedValue` with local `performance.now()`-based clock **or** the same stack-relative `t` if display publishes `startTime` later; v1 may use a controls-local origin (readout approximate) until Phase 5 clock sync — **accept readout drift vs GPU if origins differ**; prefer documenting that live readout is best-effort in v1, GPU is authoritative.

**Phase 0 note on readout clock:** use **shared formula** always; time base for controls mirror = `performance.now()/1000` from first open of mod UI in session is OK for v1 UX (shows motion). Optional later: publish stack `t` on state.

---

*Phase 0 complete. Next: Phase 1 — Runtime evaluator (`param-mod.js` + GPU wire).*
