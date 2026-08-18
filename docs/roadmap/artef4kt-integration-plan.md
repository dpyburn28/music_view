# ARTEF4KT integration plan (music_view)

**Status:** Implemented (v1). Living behavior: [audio-pipeline.md](../architecture/audio-pipeline.md), [containers.md](../authoring/containers.md). This file is the original design record.  
**Location:** `docs/roadmap/artef4kt-integration-plan.md`  
**Source library:** `/Volumes/ARCHIVE/Dev/Tools/artef4kt`  
**Target app:** music_view (this repo)

---

## 1. Goals

| Goal | Success look |
|------|----------------|
| **A. Get ARTEF4KT into the app** | Library lives under the music_view tree (or a stable linked path), loads without a second Electron process |
| **B. Floating container host** | A Display floating panel can host the ferrofluid Three.js view (geometry, drag/resize, layer, style chrome like other containers) |
| **C. Wire to selected song** | When Music selects/plays a track, ARTEF4KT reacts to *that* song’s analysis — no second transport, no double audio |
| **D. Documented plan** | This doc is the source of truth for phased work |

### Non-goals (v1)

- Porting ARTEF4KT’s full control panel into Controls Look/Object (optional later)
- Replacing music_view’s GLSL `audio-ferrofluid` packages (they stay as lightweight alternatives)
- Offline packaging / npm publish of ARTEF4KT
- Microphone / line-in paths from ARTEF4KT (music_view is local-file library only)
- Perfect 1:1 of every ARTEF4KT preset UI control in music_view presets

---

## 2. Current state (baseline)

### 2.1 music_view

- **Electron multi-window:** Main (`app.js`) · Display (`renderer.js` + `shaders.js`) · Controls · Music.
- **Single audio owner:** Music window plays via `<audio>` + `audio-analysis.js`; publishes `audio-frame`, `now-playing`, progress, lyrics over IPC. Display **never** opens its own `AudioContext` for the track ([audio-pipeline.md](../architecture/audio-pipeline.md)).
- **Floating containers:** DOM boxes with roles (`song-cover`, `audio-scope`, `audio-history`, `audio-beat`, …). Geometry absolute or `relative`; optional WebGL **container shader** fill; optional per-container postprocess; global postprocess captures the composited stage ([containers.md](../authoring/containers.md), [scene-model.md](../architecture/scene-model.md)).
- **Live audio → viz:** Role-based only today for `audio-scope` / `audio-history` / `audio-beat` via `applyAudioFrame` → `setLiveUniforms` / `setTexture2D`. Existing `audio-ferrofluid*` packages are **2D GLSL** approximations for the beat panel — not Three.js.
- **Capture constraint:** Global and per-container FX use `drawImage` of same-document canvases. **Cross-origin iframes / separate WebGL processes do not participate cleanly** in capture.

### 2.2 ARTEF4KT (`/Volumes/ARCHIVE/Dev/Tools/artef4kt`)

| Asset | Role |
|-------|------|
| `script.js` (~7.3k lines) | Monolithic `FerrofluidVisualizer` — scene, audio, UI, animation |
| `three.min.js` | Bundled Three.js |
| `orbital-blobs.js`, `shockwave-system.js`, `grid-cells.js`, `gpu-particle-shaders.js`, `filmic-tone-system.js`, `effect-composer.js`, `color-harmonizer.js`, `performance-monitor.js` | Feature modules (globals / script tags, not ESM exports) |
| `settings/*.json` | Visual presets |
| `index.html` + `style.css` | Full-page UI (loading, side panel, track list) |
| `main.js` | Standalone Electron shell |
| `package.json` | Electron app metadata; **not** an embeddable library package |

**Architectural mismatches vs music_view:**

1. **Not a library** — no `export` / host API; couples to full-page DOM (`#visualizer`, `#ui`, loading screen).
2. **Owns playback** — creates `AudioContext`, `createMediaElementSource`, file/URL loading, destination routing.
3. **Owns analysis** — FFT on its own analyser; not the music_view channel model.
4. **Full viewport sizing** — uses `window.innerWidth/Height`; must become container-relative.
5. **Heavy** — multi-system Three.js scene; may stress portrait Display + multi-pass capture.

---

## 3. Recommended strategy

### 3.1 Packaging (part A — “getting it in”)

**Recommended: vendor as a git submodule or sibling path + copy/link into `vendor/artef4kt/`.**

| Option | Pros | Cons |
|--------|------|------|
| **Git submodule** `vendor/artef4kt` → Tools repo | Single source of truth; pull updates | Requires submodule discipline |
| **`file:` npm dependency** | Familiar npm workflow | ARTEF4KT is not structured as a package with `exports` |
| **Plain copy into `vendor/`** | Simple | Drift from Tools original |
| **Relative symlink** | Zero copy | Breaks if paths move; weak for packaging |

**Decision for v1:** place sources at **`vendor/artef4kt/`** (submodule preferred if both trees are git-backed; otherwise vendored snapshot with README pointing at Tools path). Do **not** install ARTEF4KT’s Electron/`electron-builder` deps into music_view. Only runtime web assets are needed:

```
vendor/artef4kt/
  three.min.js
  script.js          # later: split / embed build
  orbital-blobs.js
  shockwave-system.js
  grid-cells.js
  gpu-particle-shaders.js
  filmic-tone-system.js
  effect-composer.js
  color-harmonizer.js
  performance-monitor.js
  settings/          # optional presets for the embed
  images/            # only if embed needs logos (can omit UI chrome)
```

Exclude: `main.js`, `mp3/`, Electron packaging, full `index.html` control chrome (replace with thin host shell).

### 3.2 Runtime integration model (part B + C)

**Recommended: same-document mount (not iframe) + external audio feed.**

```
Music window
  plays selected song
  publishes audio-frame + now-playing
        │
        ▼ IPC
Display renderer.js
  floating container role: "artef4kt" (new)
        │
        ▼
Artef4ktHost (new adapter)
  mounts Three.js into container .inner
  resize on container geometry changes
  injectAnalysis(frame) each audio-frame
  optional: load preset JSON from settings/
  does NOT create MediaElementSource / play audio
```

**Why not iframe/webview**

- Capture/`drawImage` of foreign WebGL is unreliable for global FX stacks.
- Double security origins and harder song URL access (`song://`).
- Harder to share analysis binary frames efficiently.

**Why not “just use existing GLSL ferrofluid”**

- User asked to integrate the **library** (Three.js system, particles, filmic, presets), not only the aesthetic.

**Why analysis injection instead of sharing MediaElement**

- Web Audio: one element can have only one `MediaElementSource`; Music already owns it.
- Preserves music_view invariant: analysis runs only in Music; Display consumes frames.

### 3.3 Adapter contract (target API)

Introduce a thin host module in music_view (e.g. `artef4kt-host.js`) that wraps a **refactored embed entry** in the vendor tree:

```js
// Target surface (to implement in vendor or host wrapper)
createArtef4ktEmbed(options) → {
  mount(parentEl),
  unmount(),
  setSize(width, height),
  setAnalysis(frame),     // bass/mid/high, beat, spectrum-ish fields
  setPlaying(boolean),
  loadSettings(json|id),  // optional ARTEF4KT preset
  setQuality(tier),       // performance
  getCanvas(),            // for capture / debugging
}
```

ARTEF4KT’s `FerrofluidVisualizer` must gain an **embed mode** (or a parallel slim constructor) that:

1. Accepts an existing canvas or parent element and size (not full window).
2. Skips loading screen / side UI / track picker (or hides them).
3. Accepts **precomputed bands** (map from music_view `audio-frame`) instead of reading its own analyser when in embed mode.
4. Does not connect to `audioContext.destination` for music (no second playback path).
5. Implements `setSize` from container layout (including DPR clamp).

Mapping sketch (music_view → ARTEF4KT internal expectations):

| music_view `audio-frame` | ARTEF4KT use |
|--------------------------|--------------|
| levels / envelope / peak | amplitude / blob scale |
| beat / kick / onset | shockwave / spike impulse |
| bass / mid / treble-ish channels | lights, color, orbital energy |
| waveform (optional) | if ARTEF4KT expects FFT arrays, synthesize or expand analysis publish |

**Gap to close in Phase 0 inventory:** ARTEF4KT currently drives deformation from its own FFT bins. The adapter must either (a) publish richer spectrum from Music, or (b) synthesize ARTEF4KT’s expected arrays from existing channels + waveform.

### 3.4 Container role & scene model

Add a new container **role** (name TBD; recommend `artef4kt`):

| Concern | Behavior |
|---------|----------|
| Role | `artef4kt` |
| Content | Host-managed Three.js canvas (not GLSL package fill) |
| `shaderId` | null / ignored while role is artef4kt (or reserved) |
| Geometry | Same absolute/relative layout as other containers |
| Style chrome | Border/label/connect work as today (overlay) |
| Per-container postprocess | Optional v1.1 — capture host canvas first |
| Preset field | e.g. `embed: { engine: "artef4kt", settingsId: "default", quality: "auto" }` |

Default placement: large center or left stack panel (similar footprint to beat/ferro demo, but larger — e.g. 40–60% of stage min dimension).

Controls UI (v1 minimal):

- Role appears in container select.
- Optional: preset dropdown for ARTEF4KT `settings/*.json`.
- Optional: quality tier. Defer full ARTEF4KT parameter matrix.

---

## 4. Phased work

### Phase 0 — Inventory & design lock

**Status:** plan draft  
**Output:** decisions locked in this doc §5; short gap list in ARTEF4KT for embed mode.

Tasks:

1. Trace ARTEF4KT audio path (analyser → blob/shockwave/particles uniforms) and list required per-frame inputs.
2. Confirm capture path: same-document WebGL canvas appears in `captureSceneToCanvas` / `captureContainerContentToCanvas`.
3. Choose packaging (submodule vs copy) and target path `vendor/artef4kt`.
4. Decide role name + preset schema field names.
5. Decide minimum analysis enrichment (reuse frames vs extend Music publish).

**Exit criteria:** written decisions; no code required beyond optional spike notes.

### Phase 1 — Bring sources into music_view (part A)

Tasks:

1. Add `vendor/artef4kt/` (submodule or vendored files) with README provenance + license note.
2. Document how to refresh from `/Volumes/ARCHIVE/Dev/Tools/artef4kt`.
3. Do **not** merge ARTEF4KT `package.json` deps into app root.
4. Optional: `.gitignore` rules if submodule.

**Exit criteria:** tree present; `npm start` still works unchanged (no load yet).

### Phase 2 — Embed-mode spike (part B foundation)

Tasks:

1. Add thin host page or script path: mount visualizer into a fixed-size div without ARTEF4KT UI.
2. Patch/wrap ARTEF4KT:
   - constructor option `{ embed: true, canvas, width, height }`
   - `setSize(w,h)`
   - disable own audio load in embed mode
   - fake/static analysis for smoke test
3. Manual smoke: open Display-only test or temporary container mount; confirm render + resize.

**Exit criteria:** ferrofluid renders inside a non-fullscreen DOM box in music_view Display (even if not role-wired).

### Phase 3 — Container wiring

Tasks:

1. Extend scene model: role `artef4kt` in create/update/export/apply paths in `renderer.js`.
2. On create: call host `mount` into container content root; store host handle on container state (non-serialized).
3. On geometry change / layout: `setSize`.
4. On destroy / role change: `unmount` + dispose Three.js resources (critical — avoid GPU leaks).
5. Ensure overlay borders/labels still draw; pointer events: either forward to ARTEF4KT camera or capture for container drag only (product choice — recommend **container drag uses chrome/header; canvas keeps orbit** if feasible, else disable orbit in embed).

**Exit criteria:** floating panel shows live ARTEF4KT; drag/resize works; dispose clean.

### Phase 4 — Selected song / analysis wiring (part C)

Tasks:

1. In `applyAudioFrame`, if an `artef4kt` container host exists, call `setAnalysis(mappedFrame)` and `setPlaying`.
2. On `now-playing`: optional host “track change” reset (clear residual spikes); **do not** load/play URL inside ARTEF4KT.
3. If spectrum depth is insufficient, extend Music analysis publish (prefer additive fields on `audio-frame`, not a second pipeline).
4. Verify no second audible stream; Music remains sole transport.

**Exit criteria:** selecting and playing a library track drives blob/beat/particles in the panel in sync with scope/history/beat panels.

### Phase 5 — Capture, postprocess, performance

Tasks:

1. Confirm global FX stack includes the ARTEF4KT canvas in capture (same document).
2. If WebGL readback/taint issues appear, document fallback (skip container in capture, or blit via `preserveDrawingBuffer: true` on Three.js renderer).
3. Quality tiers: reduce particle count / grid / pixel ratio when panel is small or FPS drops.
4. Pause embed when container hidden / app minimized if easy.

**Exit criteria:** CRT/grain/etc. global look still applies; FPS acceptable on target hardware.

### Phase 6 — Presets, Controls, docs polish

Tasks:

1. Preset export/import of `embed.settingsId` (and quality).
2. Minimal Controls: settings dropdown for vendored ARTEF4KT presets.
3. Authoring docs: new role in `containers.md` / `scene-model.md`; architecture note in `audio-pipeline.md`.
4. Changelog + backlog checkboxes; move this plan to `docs/roadmap/history/` when shipped.

**Exit criteria:** save/load preset restores embed presence + ARTEF4KT settings id.

---

## 5. Design decisions (lock in Phase 0)

| # | Decision | Recommendation |
|---|----------|----------------|
| D1 | Packaging | `vendor/artef4kt` submodule or vendored snapshot |
| D2 | Host model | Same-document adapter, not iframe |
| D3 | Audio ownership | Music only; inject analysis into embed |
| D4 | Role name | `artef4kt` |
| D5 | Relation to GLSL ferro packages | Keep both; different fidelity/cost |
| D6 | ARTEF4KT UI chrome | Hidden in embed; music_view Controls owns scene chrome |
| D7 | Camera interaction | Prefer orbit inside canvas; container move via existing drag handles / non-canvas chrome |
| D8 | Settings | Load subset of `settings/*.json` by id |
| D9 | Where patches live | Prefer embed patches **in vendor tree** (or thin fork file `script.embed.js`) so Tools original can stay standalone |

---

## 6. Risk register

| Risk | Impact | Mitigation |
|------|--------|------------|
| Monolithic `script.js` hard to embed | Schedule | Phase 2 spike early; if blocked, fork `script.embed.js` with minimal surface |
| Dual WebGL (Three + music_view) GPU cost | FPS | Quality tiers; smaller default panel; optional disable host when not visible |
| Capture misses WebGL canvas | Broken global FX | `preserveDrawingBuffer`; verify `drawImage`; same origin only |
| Analysis shape mismatch | Weak reactivity | Extend `audio-frame` or map bands carefully in Phase 4 |
| Memory leaks on container destroy | Long sessions | Explicit Three.js dispose checklist |
| Path fragility (ARCHIVE volumes) | Dev setup | Vendor inside repo; document refresh from Tools |
| License / attribution | Compliance | Keep ARTEF4KT README/attribution in vendor |

---

## 7. File touch map (expected)

| Area | Files |
|------|--------|
| Vendor | `vendor/artef4kt/**` (new) |
| Host | `artef4kt-host.js` (new) |
| Display | `renderer.js` (role create/update/audio/dispose), maybe `index.html` script tags |
| Main | `app.js` only if protocol/static path needed for settings JSON |
| Preload | unlikely unless new IPC |
| Music / analysis | `audio-analysis.js`, `music.js` only if spectrum fields extended |
| Controls | `controls.js` / `controls.html` for role + settings dropdown (Phase 6) |
| Docs | this plan; later authoring/architecture updates |
| Presets | optional demo preset with `artef4kt` container |

---

## 8. Acceptance criteria (v1 complete)

1. ARTEF4KT sources are inside the music_view project under `vendor/artef4kt` with provenance notes.
2. A floating container with role `artef4kt` shows the Three.js ferrofluid scene.
3. Container can be moved/resized; host resizes the renderer.
4. Playing a song selected in the Music library drives the embed (beat/energy motion) without ARTEF4KT playing a second audio element.
5. Disposing or switching the container role does not leave a runaway rAF/WebGL context.
6. Global postprocess still runs on a captured stage that includes the embed (or documented known limitation).
7. Docs linked from `docs/roadmap/README.md` and backlog entry exists.

---

## 9. Implementation order (when executing)

1. ~~Write this plan into `docs/roadmap/artef4kt-integration-plan.md` and link from roadmap/backlog/README.~~ **Done**
2. Phase 0 decisions confirmed (no blockers).
3. Phase 1 vendor drop.
4. Phase 2 embed spike (highest technical risk).
5. Phases 3–4 product wiring.
6. Phases 5–6 polish.

---

## 10. Progress

| Phase | Status | Notes |
|-------|--------|--------|
| 0 Inventory & design lock | **Done** | Decisions §5; analysis via external bands + synthetic FFT |
| 1 Vendor into app | **Done** | `vendor/artef4kt/` + README provenance |
| 2 Embed-mode spike | **Done** | `FerrofluidVisualizer({ embed })` + `artef4kt-host.js` |
| 3 Container role wiring | **Done** | role `artef4kt`, default panel, resize/dispose hooks |
| 4 Song / analysis wiring | **Done** | `applyAudioFrame` → `feedArtef4ktAnalysis` |
| 5 Capture & performance | Partial | `preserveDrawingBuffer` in embed; quality tiers TBD |
| 6 Presets / Controls / docs | **Done (v1)** | Object → Engine segment; preset load; live knobs; embed.settings in scene presets |

---

## Appendix A — Why this is not “npm install artef4kt”

ARTEF4KT is a **standalone visualizer app** (Electron + full HTML UI + self-contained audio). music_view is a **multi-window host** with its own audio pipeline and scene graph. Integration is an **embedding + adapter** problem first, packaging second.

## Appendix B — Related existing work in music_view

- Lightweight ferro look: `shaders/audio-ferrofluid/`, `audio-ferro-2/`, `audio-ferro-3/` bound via `audio-beat` role.
- Live audio path: `applyAudioFrame` in `renderer.js`.
- Role registry pattern: hard-wired roles; new role needs explicit hooks (same as audio viz today — packages alone do not auto-bind).
