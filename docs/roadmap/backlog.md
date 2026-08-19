# Backlog & future work

Living list of **not yet done** features, deferred polish, and recommended overhauls. Ordered roughly by product impact, not commitment.

---

## Deferred from completed overhauls

Items explicitly left out when shipping UI / shader / modulation work:

| Item | Origin | Notes |
|------|--------|--------|
| **Undo / redo stack** for look edits | UI overhaul Phase 4 | Must not corrupt preset export; harder than surface UI |
| **Preset schema v2** | UI overhaul | Only if relative-layout export/migration needs a version bump; requires migration path |
| **Icon rail** for Controls | UI overhaul | Width increased instead; rail still optional |
| **On-canvas gizmos** | UI overhaul out-of-scope | Transform handles beyond current drag/resize |
| **Audio-reactive modulator sources** | Param modulation non-goals | Beat / band / envelope as LFO `source` values |
| **Modulate color / vec / enum** | Param modulation | v1 is continuous floats only |
| **Cross-param routing / node graph** | Shader + mod non-goals | One param driving another |
| **Expression language** | Param modulation | Freeform math strings |
| **Per-shader bespoke UIs** | Shader overhaul non-goals | Stick to schema-driven widgets |
| **Save UI chrome in presets** | Shader overhaul | Open groups, Basic\|All must stay session-local |

---

## Product features to add

### Music & content

| Feature | Why | Rough approach |
|---------|-----|----------------|
| **Performance / showcase timeline** | Sequence song sections + look snapshots with audio/visual transitions; live Go + auto-run | **v1 in tree.** Plan: [performance-timeline-plan.md](./performance-timeline-plan.md) |
| Configurable songs directory | Paths are hardcoded in `music-library.js` | Settings file or Controls/Music picker; persist path |
| Playlist / queue | Single-track focus today | Music dock queue + next/prev |
| More lyric formats | LRC only | SRT/JSON adapters |
| Better stem-like isolation | Vocals are M/S heuristics | Document limits; optional offline stem import later |
| Export still frame / short clip | Sharing looks | Capture postprocess canvas → image/video |

### Look & shaders

| Feature | Why | Rough approach |
|---------|-----|----------------|
| **Postprocess toolkit** (grade, optics, feedback, glitch, stylize, utility) | **Shipped (A–D)** | Plan: [postprocess-toolkit-plan.md](./postprocess-toolkit-plan.md) — optional half-res bloom / LUT later |
| Generic audio→uniform binding | Only 3 roles hard-wired | Metadata in `controls.json` or role registry |
| Feedback / multi-pass helpers | Advanced looks | Phase B `feedback-trail` + expand `u_prev`; half-res bloom later |
| Shader hot-reload | Faster authoring | Watch packages or Controls “Reload package” command |

### Controls / UX

| Feature | Why | Rough approach |
|---------|-----|----------------|
| **Floating container management** | Object tab can only edit the boot-created 8 roles; no add/remove/hide | **v1 in tree.** Plan: [container-management-plan.md](./container-management-plan.md) |
| Undo stack | Recovery after bad tweaks | Command history on Display state |
| Preset folders / tags | Growing preset list | Metadata in preset envelope or sidecar |
| A/B preset compare | Design workflow | Dual state or quick toggle |
| Display layout guides / safe areas | Portrait framing | Overlay toggles |

### Architecture / quality

| Feature | Why | Rough approach |
|---------|-----|----------------|
| Broader automated tests | `npm test` covers bus, layout, Show FX, audio input, match | Still no Electron e2e / screenshot smoke |
| Typed IPC contracts | Large `renderer.js` surface | Shared command enum + payload types |
| Split `renderer.js` | ~4.7k lines | Modules: scene, postprocess, music-bridge, commands |
| Songs path in settings | Geometry already in `user-settings.json` | Add a songs-dir field + picker |
| Packaging / release builds | `npm start` only | electron-builder targets |

---

## Recommended overhauls (not started)

### 0. ARTEF4KT Three.js embed (external library)

**Status:** implemented (v1) — [artef4kt-integration-plan.md](./artef4kt-integration-plan.md). Per-container `audioInput` now drives its bands (including continuous mix).

### 1a. Floating container management (Controls Object)

**Status:** implemented (v1). Full design in [container-management-plan.md](./container-management-plan.md).

Replace the Object dropdown with a panel list (add / duplicate / delete / hide), unique named roles + unlimited generics, and route Controls look apply through snapshot spawn of **listed** panels plus prune of **generic extras** (never auto-delete unique roles omitted from old files; FX-only `look-*` files keep layout).

### 1. Single-window workspace overhaul

**Status:** implemented — [fullscreen-single-window-plan.md](./fullscreen-single-window-plan.md).

One workspace: portrait stage as a pane, docked Music / Controls / Performance, Present / Fullscreen / Kiosk, persisted dock layout.

### 2. Audio-reactive modulation (v2 modulators)

**Status:** backlog.

Extend `param-mod.js` sources with analysis channels (`beat`, `envelope`, `bass`, …) using the same amp/offset knobs. Requires Display to pass a live analysis snapshot into the resolve path each frame (data already arrives via `audio-frame`).

### 3. Scene / layout system cleanup

**Status:** backlog.

Relative layout helpers are expressive but informal. A schema v2 (or validated relative DSL) would help AI authors and prevent invalid `belowRole` graphs. Couple with export always writing a normalized form.

### 4. Display performance pass

**Status:** backlog.

Capture-full-DOM + multi-pass WebGL can get expensive with large stacks and high DPR. Profile capture path, skip disabled layers earlier, optional half-res intermediate, throttle analysis IPC.

### 5. Documentation & packaging for third-party packs

**Status:** partially done (this docs tree).

Future: zip install of shader packs / preset packs, version field on packages, conflict resolution for ids.

---

## Tech debt (keep visible)

| Debt | Notes |
|------|--------|
| Hardcoded songs paths | `music-library.js` `SONG_DIR_CANDIDATES` |
| Legacy postprocess commands | `setPostprocessShader` / flat uniforms still present |
| Dual WebGL paths | Container renderer vs stack — shared helpers OK, still complex |
| Large controls.js / renderer.js | Harder reviews; split when next feature touches them |
| No CI | `npm test` is local-only |

---

## Recently finished (do not re-open without cause)

- Song list cover art thumbnails + startup preloading
- Song list artist / genre display and filter
- Preset load: lyrics geometry preservation
- Look / Object controls IA  
- Schema-driven shader widgets  
- Param modulation with clocks and multi-wave sources  
- Live audio viz containers (scope / history / beat / ARTEF4KT)  
- Per-container `audioInput` + continuous mix tap  
- Visual preset system + design-space layout  
- Single-window workspace + Performance dock + Show FX  

---

## Suggesting new backlog items

When proposing work, include:

1. User-visible outcome  
2. Files likely touched  
3. Preset / schema impact (breaking or additive)  
4. Whether authoring docs must update  
