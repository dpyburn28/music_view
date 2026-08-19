# Three-World integration plan (music_view)

**Status:** Planning
**Location:** `docs/roadmap/three-world-integration-plan.md`
**Source library:** `/Volumes/ARCHIVE/Creative/Code/Active/Three-World`
**Target app:** music_view (this repo)
**Precedent:** [artef4kt-integration-plan.md](artef4kt-integration-plan.md) — same embedding model

---

## 1. Goals

| Goal | Success look |
|------|----------------|
| **A. Get Three-World into the app** | Library lives under `vendor/three-world/`, loads without a second Electron process |
| **B. Floating container host** | A Display floating panel can host a Three-World Three.js scene (geometry, drag/resize, layer, style chrome) |
| **C. Wire to selected song** | When Music plays a track, Three-World scene reacts to that song's analysis — no second transport |
| **D. Scene switching** | User can switch between Three-World scenes from Controls (grass, desert, sky, water, astronaught, midi) |
| **E. Documented plan** | This doc is the source of truth for phased work |

### Non-goals (v1)

- Porting Three-World's full Tweakpane GUI into Controls (deferred — scene params via subset only)
- Replacing music_view's GLSL container shaders (Three-World scenes are complementary, not replacements)
- Three-World's AudioDriver / MIDI / audio recording in embed mode (music_view owns all audio)
- Three-World's CCapture video recording (music_view has its own capture pipeline)
- Offline packaging / npm publish of Three-World
- Perfect 1:1 of every Three-World parameter in Controls (subset per-scene in v1)

---

## 2. Current state (baseline)

### 2.1 music_view

- **Electron multi-window:** Main (`app.js`) + Display (`renderer.js` + `shaders.js`) + Controls + Music.
- **Single audio owner:** Music window plays via `<audio>` + `audio-analysis.js`; publishes `audio-frame`, `now-playing`, progress, lyrics over IP   Display **never** opens its own `AudioContext`.
- **Floating containers:** DOM boxes with roles (`song-cover`, `audio-scope`, `artef4kt`, …). Geometry absolute or `relative`; optional WebGL container shader fill; optional per-container postprocess; global postprocess captures the composited stage.
- **artef4kt precedent:** Same-document Three.js mount via adapter (`artef4kt-host.js`), external analysis injection, canvas inside container, `preserveDrawingBuffer` for capture.
- **Capture constraint:** Global and per-container FX use `drawImage` of same-document canvases. Cross-origin iframes / separate WebGL processes do not participate cleanly.

### 2.2 Three-World (`/Volumes/ARCHIVE/Creative/Code/Active/Three-World`)

| Asset | Role |
|-------|------|
| `main.js` (202 lines) | App orchestrator — calls `setup()` + `init()`, creates renderer, camera, composer, GUI, starts rAF |
| `js/SceneManager.js` | Scene registry + lazy loading via `fetch()` + `eval`; global uniform injection |
| `js/SceneEntities.js` | Per-scene aggregate of systems, objects, effects |
| `js/Entity.js` | Base class — lifecycle hooks (`load/init/preFrame/draw/dispose`), GUI binding, preset collect/apply |
| `js/SceneObject.js` | Visual 3D objects (meshes, particles, terrain) |
| `js/ShaderHandle.js` | Wraps shader directory (vert/frag/controls.json/uniforms) |
| `js/shaderLoader.js` | Fetches GLSL with `#include` support, auto-parses uniforms |
| `js/PingPongPass.js` | Feedback pass for datamosh/shader effects |
| `js/AudioDriver.js` | Polyphonic Web Audio synth (osc + FM) — **not needed in embed** |
| `js/MidiController.js` | Web MIDI input — **not needed in embed** |
| `objects/AudioVisualizer.js` | 8 visualization modes — **not needed in embed** |
| `scenes/index.json` | Registry list: `gf`, `desert`, `sky`, `water`, `astronaught`, `midiInput`, `clouds`, `eye` |
| `scenes/{name}/main.js` | Per-scene entry — registers factory into `window.SceneRegistry` |
| `css/style.css` | Full-page UI styles |
| `index.html` | Entry — CDN script tags for Three.js r128, Tweakpane, etc. |

**Architectural mismatches vs music_view:**

1. **`main.js` hardcodes full-page** — `document.body.appendChild(renderer.domElement)`, `window.innerWidth/innerHeight`, Tweakpane GUI setup.
2. **Global scope classes** — `window.SceneManager`, `window.Entity`, etc. Not ES modules. All inter-file references via globals.
3. **Dynamic scene loading** — `SceneManager._loadScene()` does `fetch(scriptPath)` + `eval()`. Scenes register into `window.SceneRegistry`.
4. **Tweakpane GUI** — wired into every `Entity.setupGui()`. Would conflict with music_view Controls if both render.
5. **Own audio** — `AudioDriver` creates its own `AudioContext`, oscillator nodes. Must be disabled in embed mode.
6. **No `resize` abstraction** — renderer sized once at init; no `ResizeObserver` or container-relative sizing.

### 2.3 What makes this harder than artef4kt

| Concern | artef4kt | Three-World |
|---------|----------|-------------|
| Source complexity | 1 class (`FerrofluidVisualizer`) + helpers | 10+ classes, 6+ scenes, dynamic loading |
| Entry point | Constructor accepts `{ embed, canvas }` | `main.js` hardcodes body/size |
| GUI | Hidden in embed mode | Tweakpane in every Entity |
| Audio | Clean `setExternalAnalysis()` API | AudioDriver owns AudioContext |
| Scenes | N/A (single scene) | 6+ scenes, each with own objects/systems |
| Presets | `settings/*.json` | Per-scene `presets/` directories |

---

## 3. Recommended strategy

### 3.1 Packaging

**Vendor as a snapshot into `vendor/three-world/`.**

```
vendor/three-world/
  main.js              # patched embed entry
  index.html           # reference only (not loaded)
  js/                  # all framework scripts
  objects/             # scene objects
  systems/             # system handles
  scenes/              # scene scripts + presets
  shaders/             # GLSL sources (shared with music_view port)
  css/                 # styles (minimal subset)
  three.min.js         # Three.js r128
  tweakpane/           # Tweakpane (for scene param collection)
  VENDOR.md            # provenance, refresh instructions
```

Exclude: `mp3/`, CCapture, `AudioDriver`, `MidiController`, `AudioRecorder`, `AudioVisualizer` (not needed in embed).

### 3.2 Embed entry point (patched `main.js`)

The original `main.js` must be patched to support embed mode. Create `main.embed.js` (or patch `main.js` with an embed guard):

```js
// main.embed.js — thin wrapper around original main.js
// Detects embed mode via window.__THREE_WORLD_EMBED__ flag

window.__THREE_WORLD_EMBED__ = true;
window.__THREE_WORLD_CONTAINER__ = document.getElementById('three-world-host');

import('./main.js');  // or load via script tag
```

In `main.js`, guard the hardcoded parts:

```js
// Instead of:
//   renderer = new THREE.WebGLRenderer({ antialias: true });
//   renderer.setSize(window.innerWidth, window.innerHeight);
//   document.body.appendChild(renderer.domElement);

// Do:
const isEmbed = window.__THREE_WORLD_EMBED__;
const container = window.__THREE_WORLD_CONTAINER__;
const width = isEmbed ? container.clientWidth : window.innerWidth;
const height = isEmbed ? container.clientHeight : window.innerHeight;

renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(width, height);
if (isEmbed) {
    renderer.domElement.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;';
    container.appendChild(renderer.domElement);
} else {
    document.body.appendChild(renderer.domElement);
}

// Skip Tweakpane GUI in embed mode
if (!isEmbed) {
    setupGui();
}
```

### 3.3 Runtime integration model

Same as artef4kt — same-document mount + external audio feed:

```
Music window
  plays selected song
  publishes audio-frame + now-playing
        │
        ▼ IPC
Display renderer.js
  floating container role: "three-world"
        │
        ▼
ThreeWorldHost (new adapter)
  mounts Three.js into container .inner
  loads selected scene (e.g. "gf")
  resize on container geometry changes
  injectAnalysis(frame) each audio-frame
  scene switching via Controls
  does NOT create AudioContext / play audio
```

### 3.4 Audio mapping

Three-World scenes don't have a unified audio API like artef4kt's `setExternalAnalysis()`. Each scene accesses audio differently:

| Scene | Audio usage | Embed adaptation |
|-------|-------------|-----------------|
| `gf` (Grass Field) | Wind system reacts to audio amplitude | Map `envelope` → wind strength |
| `desert` | Sun/clouds react to bass | Map `bass` → sun intensity |
| `sky` | Clouds drift with audio | Map `envelope` → cloud speed |
| `water` | Wave amplitude from bass | Map `bass` → wave height |
| `astronaught` | Particle effects from beat | Map `beat` → particle burst |
| `clouds` | Cloud density from mid | Map `mid` → cloud density |
| `eye` | Pupil dilation from treble | Map `treble` → pupil size |
| `midiInput` | Full MIDI/synth demo | **Not usable in embed** (requires AudioDriver) |

The adapter will provide a **unified analysis object** to each scene:

```js
{
    bass: 0.0–1.0,      // from audio-frame bass channel
    mid: 0.0–1.0,       // from audio-frame mid channel
    treble: 0.0–1.0,    // from audio-frame treble channel
    beat: 0.0–1.0,      // from audio-frame beat/onset
    envelope: 0.0–1.0,  // from audio-frame envelope
    playing: boolean,    // from audio-frame playing flag
}
```

Each scene's `preFrame()` will be patched to read from this shared object instead of its own audio system.

### 3.5 Container role & scene model

Add a new container role `three-world`:

| Concern | Behavior |
|---------|----------|
| Role | `three-world` |
| Content | Host-managed Three.js canvas (not GLSL package fill) |
| `shaderId` | null / ignored while role is three-world |
| Geometry | Same absolute/relative layout as other containers |
| Style chrome | Border/label/connect work as today (overlay) |
| Embed config | `embed: { engine: "three-world", sceneId: "gf", quality: "auto" }` |
| Preset field | Scene ID + quality tier + optional scene params snapshot |

### 3.6 Scene switching

Unlike artef4kt (single scene), Three-World has multiple scenes. The Controls Engine tab will include:

- **Scene dropdown** — populated from `vendor/three-world/scenes/index.json`
- **Load button** — disposes current scene, loads new one
- **Scene-specific param sliders** — subset of each scene's parameters (not full Tweakpane)

Scene param subsets (v1):

| Scene | Exposed params |
|-------|---------------|
| `gf` | Wind speed, wind strength, grass height, grass density |
| `desert` | Sun elevation, sun azimuth, cloud density, haze strength |
| `sky` | Cloud speed, cloud scale, cloud density, horizon offset |
| `water` | Wave amplitude, water color, caustic intensity |
| `astronaught` | Particle count, particle speed, glow intensity |
| `clouds` | Cloud density, cloud speed, cloud scale |
| `eye` | Iris color, pupil size, iris radius |

---

## 4. Phased work

### Phase 0 — Inventory & design lock

**Output:** decisions locked in §5; gap list for Three-World embed mode.

Tasks:

1. Trace each scene's audio path (what it reads, how it affects visuals).
2. Confirm capture path: same-document WebGL canvas in `captureSceneToCanvas`.
3. Choose packaging (vendor snapshot) and target path `vendor/three-world/`.
4. Decide role name + preset schema field names.
5. Decide which scenes are embed-compatible (exclude `midiInput`).
6. List Tweakpane params to expose per-scene in Controls.

**Exit criteria:** written decisions; no code.

### Phase 1 — Vendor sources into music_view

Tasks:

1. Copy Three-World tree into `vendor/three-world/`.
2. Strip: `mp3/`, `AudioDriver.js`, `MidiController.js`, `AudioRecorder.js`, `AudioVisualizer.js`, CCapture.
3. Create `VENDOR.md` with provenance + refresh instructions.
4. Add embed guard to `main.js` (or create `main.embed.js`).
5. Verify `npm start` still works (no load yet).

**Exit criteria:** tree present; app boots unchanged.

### Phase 2 — Embed-mode spike

Tasks:

1. Create temporary test container with a `<div id="three-world-host">`.
2. Patch `main.js` to detect embed mode, use container sizing, skip Tweakpane GUI.
3. Create `ThreeWorldHost` adapter skeleton (`three-world-host.js`):
   - `createThreeWorldEmbed({ canvas, width, height, parentEl })` → host API
   - `mount()` / `unmount()` / `setSize(w, h)`
   - `loadScene(sceneId)` / `disposeScene()`
   - `setAnalysis(frame)` / `setPlaying(boolean)`
4. Smoke test: render `gf` scene inside a non-fullscreen DOM box.
5. Verify resize works via `ResizeObserver` on container.

**Exit criteria:** grass field scene renders inside a floating box in Display; resize works.

### Phase 3 — Container wiring

Tasks:

1. Extend scene model: role `three-world` in create/update/export/apply paths (`renderer.js`).
2. On create: call `ThreeWorldHost.createThreeWorldEmbed()` into container; store host handle on state.
3. On geometry change: `hostApi.setSize(w, h)`.
4. On destroy / role change: `hostApi.unmount()` + dispose Three.js resources (critical — avoid GPU leaks).
5. Ensure overlay borders/labels still draw.
6. Pointer events: container drag via chrome/header; canvas gets scene camera controls.

**Exit criteria:** floating panel shows live Three-World scene; drag/resize works; dispose clean.

### Phase 4 — Scene switching

Tasks:

1. Add scene selector to Controls Engine tab.
2. `loadScene(sceneId)` disposes current scene entities, fetches new scene script, evals, initializes.
3. Wire scene-specific params to Controls sliders (subset per §3.6).
4. On scene switch: preserve analysis state, reset scene-specific time.

**Exit criteria:** user can switch between 3+ scenes from Controls; params update live.

### Phase 5 — Song / analysis wiring

Tasks:

1. In `applyAudioFrame`, if `three-world` container exists, call `hostApi.setAnalysis(mappedFrame)`.
2. Map music_view audio channels → Three-World unified analysis object (§3.4).
3. Patch each embed-compatible scene's `preFrame()` to read from shared analysis.
4. On `now-playing`: optional scene reset (clear residual state).
5. Verify no second audible stream; Music remains sole transport.

**Exit criteria:** playing a library track drives scene motion (grass sway, water waves, etc.) in sync.

### Phase 6 — Capture, postprocess, performance

Tasks:

1. Confirm global FX stack includes Three-World canvas in capture (`preserveDrawingBuffer: true`).
2. Quality tiers: reduce geometry/particle count when panel is small or FPS drops.
3. Pause embed when container hidden / app minimized.
4. DPR clamping for high-DPI displays.

**Exit criteria:** CRT/grain/etc. global look applies; FPS acceptable on target hardware.

### Phase 7 — Presets, Controls, docs polish

Tasks:

1. Preset export/import of `embed.sceneId` + quality + scene params.
2. Controls Engine segment: scene dropdown + param sliders + quality tier.
3. Authoring docs: new role in `containers.md` / `scene-model.md`.
4. Architecture note in `audio-pipeline.md`.
5. Changelog + backlog entry; move this plan to `docs/roadmap/history/` when shipped.

**Exit criteria:** save/load preset restores embed presence + scene selection + params.

---

## 5. Design decisions (lock in Phase 0)

| # | Decision | Recommendation |
|---|----------|----------------|
| D1 | Packaging | `vendor/three-world/` vendored snapshot |
| D2 | Host model | Same-document adapter, not iframe |
| D3 | Audio ownership | Music only; inject analysis into embed |
| D4 | Role name | `three-world` |
| D5 | Relation to GLSL container shaders | Keep both; Three-World is richer but costlier |
| D6 | Tweakpane GUI | Hidden in embed; music_view Controls owns scene chrome |
| D7 | Camera interaction | Scene camera controls inside canvas; container drag via chrome |
| D8 | Scene switching | Controls dropdown, disposes/reloads scene |
| D9 | Which scenes are embed-compatible | All except `midiInput` (requires AudioDriver) |
| D10 | Analysis injection | Unified `{ bass, mid, treble, beat, envelope, playing }` object |
| D11 | Where patches live | Embed patches in `vendor/three-world/main.js` (guarded) |

---

## 6. Risk register

| Risk | Impact | Mitigation |
|------|--------|------------|
| `main.js` hardcodes body/size | Blocking | Phase 2 spike — guard with embed flag |
| Global scope classes (no ESM) | Medium | Works as-is in same document; no bundler needed |
| `fetch()` for scenes/shaders needs proper path | Medium | Serve from vendored path; test with Electron file:// protocol |
| Tweakpane conflicts with Controls | Medium | Skip `setupGui()` in embed mode |
| `eval()`-loaded scenes may fail | Low | Scenes are simple factory functions; test each |
| Dual WebGL (Three + music_view) GPU cost | FPS | Quality tiers; smaller default panel; pause when hidden |
| Capture misses WebGL canvas | Broken global FX | `preserveDrawingBuffer`; verify `drawImage`; same origin only |
| Analysis shape mismatch per scene | Weak reactivity | Unified adapter object; per-scene mapping in Phase 5 |
| Memory leaks on scene switch / destroy | Long sessions | Explicit Three.js dispose checklist per scene |
| Three.js r128 CDN dependency | Dev setup | Bundle `three.min.js` in vendor (already vendored) |
| Path fragility (ARCHIVE volumes) | Dev setup | Vendor inside repo; document refresh |

---

## 7. File touch map (expected)

| Area | Files |
|------|-------|
| Vendor | `vendor/three-world/**` (new) |
| Host | `three-world-host.js` (new) |
| Display | `renderer.js` (role create/update/audio/dispose), `index.html` (script tag) |
| Main | `app.js` only if protocol/static path needed |
| Music / analysis | `audio-analysis.js` only if spectrum fields extended |
| Controls | `controls.js` / `workspace.html` for role + scene dropdown + param sliders |
| Audio input | `audio-input.js` for `three-world` role default channels |
| CSS | `main.css` for `.three-world-panel` styles |
| Docs | this plan; later authoring/architecture updates |
| Presets | demo preset with `three-world` container |

---

## 8. Acceptance criteria (v1 complete)

1. Three-World sources are inside the music_view project under `vendor/three-world/` with provenance notes.
2. A floating container with role `three-world` shows a Three-World Three.js scene.
3. Container can be moved/resized; host resizes the renderer.
4. User can switch scenes from Controls (at least 3 scenes working).
5. Playing a song selected in the Music library drives scene motion (grass, water, sky) without Three-World playing a second audio element.
6. Disposing or switching the container role does not leave a runaway rAF/WebGL context.
7. Global postprocess still runs on a captured stage that includes the embed (or documented known limitation).
8. Scene-specific params are adjustable from Controls (subset per scene).
9. Docs linked from `docs/roadmap/README.md`; backlog entry exists.

---

## 9. Implementation order (when executing)

1. ~~Write this plan into `docs/roadmap/three-world-integration-plan.md` and link from roadmap/backlog/README.~~ **This step**
2. Phase 0 decisions confirmed (no blockers).
3. Phase 1 vendor drop.
4. Phase 2 embed spike (highest technical risk).
5. Phases 3–4 product wiring (container + scene switching).
6. Phases 5–6 audio + capture.
7. Phase 7 polish.

---

## 10. Progress

| Phase | Status | Notes |
|-------|--------|-------|
| 0 Inventory & design lock | **In progress** | Awaiting design confirmation |
| 1 Vendor into app | Pending | |
| 2 Embed-mode spike | Pending | |
| 3 Container role wiring | Pending | |
| 4 Scene switching | Pending | |
| 5 Song / analysis wiring | Pending | |
| 6 Capture & performance | Pending | |
| 7 Presets / Controls / docs | Pending | |

---

## Appendix A — Why this is harder than artef4kt

artef4kt was a **single self-contained class** with an embed API already designed in. Three-World is a **multi-scene application framework** with global scope coupling, dynamic loading, and its own GUI. The integration requires:

1. Patching the entry point to accept a container element
2. Disabling Tweakpane in embed mode
3. Adapting each scene to read from injected analysis instead of its own audio
4. Managing scene lifecycle (load/dispose/switch) from the host

The artef4kt pattern (same-document mount + adapter + external analysis) still applies — the adapter just has more work to do.

## Appendix B — Embed-compatible scenes

| Scene | Description | Audio-adaptive | Embed-compatible |
|-------|-------------|---------------|-----------------|
| `gf` | Grass field with wind | Wind ← envelope | Yes |
| `desert` | Desert with sun/clouds | Sun ← bass | Yes |
| `sky` | Sky dome with clouds | Clouds ← envelope | Yes |
| `water` | Water with caustics | Waves ← bass | Yes |
| `astronaught` | Particle astronaut | Particles ← beat | Yes |
| `clouds` | Cloud field | Density ← mid | Yes |
| `eye` | Procedural eye | Pupil ← treble | Yes |
| `midiInput` | Full MIDI/synth demo | Requires AudioDriver | **No** |
