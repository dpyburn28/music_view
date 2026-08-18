> **Archived plan** — shipped work. Living docs: [docs/README.md](../../README.md) · [backlog](../backlog.md).

# Phase 0 inventory (Controls UI overhaul)

**Status:** Complete (static verification 2026-08-08)  
**Plan:** `ui-overhaul-plan.md`  
**Rule:** Prefer keeping these command names and element **ids** stable through Phases 1–3. If either drifts, update this file in the same PR.

---

## 1. Display `sceneCommand` cases (`renderer.js`)

All commands the display window can handle:

| Command | Used by controls? | Purpose |
|---------|-------------------|---------|
| `getState` | yes | Full scene + shaders list |
| `listShaders` | no (via getState) | Shader catalog |
| `selectContainer` | yes (Phase 4) | UI-only selection sync; not in presets |
| `updateContainer` | yes | Layout/style/motion/text |
| `applyContainerShader` | yes | Package on container |
| `clearContainerShader` | yes | Remove container shader |
| `setContainerUniforms` | yes | Live container uniforms |
| `setPostprocessUniforms` | no* | Legacy first-layer uniforms |
| `setPostprocessShader` | no* | Legacy replace stack with one |
| `stopPostprocess` | yes | Global FX off |
| `startPostprocess` | yes | Global FX on |
| `addPostprocessLayer` | yes | Append effect |
| `removePostprocessLayer` | yes | Delete effect |
| `reorderPostprocessLayers` | no* | Full id order array |
| `movePostprocessLayer` | yes | Move one layer by index |
| `setPostprocessLayerShader` | yes | Change layer package |
| `setPostprocessLayerUniforms` | yes | Live layer uniforms |
| `setPostprocessLayerEnabled` | yes | Bypass one layer |
| `setPostprocessStack` | no* | Replace entire stack |
| `exportPreset` | yes | Build visual preset from display |
| `applyPreset` | yes | Apply preset object |
| `loadPreset` | yes | Load file + apply on display |

\*Available for power tools / future UI; not currently called from `controls.js`.

---

## 2. Commands actually called from `controls.js`

| Command | Call sites (approx.) |
|---------|----------------------|
| `getState` | `refreshFull` |
| `selectContainer` | picker change / `[` `]` cycle (via `sendCommand`, not full `cmd`) |
| `exportPreset` | `saveCurrentAsPreset` |
| `applyPreset` | after save; load fallback |
| `loadPreset` | `loadSelectedPreset` |
| `updateContainer` | Apply container; progress time live |
| `setContainerUniforms` | container uniform debounce |
| `applyContainerShader` | c-shader-apply |
| `clearContainerShader` | c-shader-clear |
| `setPostprocessLayerUniforms` | pp uniform debounce |
| `setPostprocessLayerShader` | pp-shader change |
| `setPostprocessLayerEnabled` | pp-layer-enabled |
| `addPostprocessLayer` | pp-add-layer |
| `removePostprocessLayer` | pp-layer-remove |
| `movePostprocessLayer` | pp-layer-up / down |
| `startPostprocess` | pp-active on |
| `stopPostprocess` | pp-active off |

**Count:** 16 distinct commands from controls.

---

## 3. Main-process / preload APIs used by controls

| Bridge | Method | Purpose |
|--------|--------|---------|
| `musicView.sendCommand` | IPC → display | All `cmd()` calls |
| `musicView.onState` | live push | positionsOnly merge |
| `musicView.listPresets` | main | preset dropdown |
| `musicView.savePresetFile` | main | write `presets/*.json` |
| `musicView.loadPresetFile` | main | read JSON (fallback path) |
| `musicView.deletePresetFile` | main | delete non-default |

Display also uses `loadPresetFile` inside `loadAndApplyPreset` (startup + `loadPreset` command).

---

## 4. Element ids referenced by `controls.js` (`$('…')`)

**Stable ids — do not rename without updating JS.**

### Header
- `status`, `btn-refresh`

### Presets
- `preset-active`, `preset-select`, `preset-load`, `preset-refresh`
- `preset-name`, `preset-save`, `preset-save-default`, `preset-delete`

### Postprocess
- `pp-active`, `pp-layer-list`
- `pp-add-shader`, `pp-add-layer`
- `pp-layer-editor`, `pp-layer-title`, `pp-layer-index`
- `pp-reset-defaults` (Phase 3 — restore package default uniforms for selected layer)
- `pp-shader`, `pp-shader-desc`, `pp-layer-enabled`
- `pp-uniforms`
- `pp-layer-up`, `pp-layer-down`, `pp-layer-remove`

### Container
- `container-select`, `container-editor`
- `c-text`, `c-label`, `c-label-corner`
- `c-label-font`, `c-label-size`, `c-label-weight`, `c-label-style`
- `c-label-color`, `c-label-bg`, `c-label-bg-on`, `c-label-tracking`, `c-label-opacity`
- `c-progress-time-wrap`, `c-progress-time-mode`
- `c-left`, `c-top`, `c-width`, `c-height`, `c-layer`, `c-distancing`
- `c-wander`, `c-connect`, `c-amp`, `c-freq`, `c-anchor`, `c-attach`
- `c-border-color`, `c-border-width`, `c-connect-color`, `c-connect-width`
- `c-apply`
- `c-shader-status`, `c-shader`, `c-shader-desc`, `c-shader-apply`, `c-shader-clear`, `c-uniforms`

**Count:** 63 unique ids.

### Dynamic hosts (no fixed child ids)
- `#pp-uniforms`, `#c-uniforms` — populated by `buildUniformControls` (generated inputs)
- `#pp-layer-list` — rows built in JS (`dataset.id` = layer id)

---

## 5. Preset path verification (static)

| Check | Result |
|-------|--------|
| `presets/default.json` parses | OK |
| Containers in default | 4 (`song-cover`, `song-info`, `song-lyrics`, `song-progress`) |
| Default postprocess | `active: true`, one layer `lcd` |
| Display boot calls `loadAndApplyPreset("default")` | OK (`renderer.js` DOMContentLoaded async init) |
| `exportScenePreset` / `applyScenePreset` present | OK |
| Save path: export on display → `savePresetFile` on main | OK (controls.js) |
| Load path: `loadPreset` on display → file via main | OK |

**Schema note:** Default file uses `relative` geometry hints + null absolutes; user saves use absolute geometry from live scene. `applyScenePreset` supports both.

---

## 6. Baseline smoke checklist (§8.1)

Interactive Electron run is **manual** (not automated in Phase 0).  
Static code/path verification is **PASS** for preset boot + IPC inventory.

| # | Test | Static | Interactive (fill when run) |
|---|------|--------|------------------------------|
| 1 | Launch: display + controls + music | — | ☐ |
| 2 | Default preset applied (LCD, 4 panels) | PASS path | ☐ |
| 3 | Refresh shows containers + layers | PASS wiring | ☐ |
| 4 | Postprocess On/Off | PASS cmds exist | ☐ |
| 5 | Add / reorder / disable / remove layer | PASS cmds exist | ☐ |
| 6 | Layer uniform live update | PASS cmd exists | ☐ |
| 7 | Container move Apply | PASS cmd exists | ☐ |
| 8 | Save `ui-smoke` → load default → load `ui-smoke` | PASS path | ☐ |
| 9 | Save as default (careful) | PASS path | ☐ |
| 10 | Play song: music still drives cover/lyrics | N/A (not preset) | ☐ |

**Phase 0 exit:** Inventory complete; static preset/boot verification PASS. Interactive column is the gate before claiming Phase 1 regression-free—run once before/after Phase 1.

---

## 7. Guardrails for later phases

1. **Do not rename** the ids in §4 without a simultaneous `controls.js` update.  
2. **Do not remove** commands in §2 from the display without a controls migration.  
3. **Preset save** must always go through `exportPreset` (display), never a controls-only form dump.  
4. **`stopPostprocess` must not clear** `postprocessState.layers` (current behavior: stop loop / hide canvas only)—Phase 2 UI must preserve that.  
5. When hiding fields (Phase 3), **omit keys** from `updateContainer` payloads rather than sending empty strings for song content.  
6. After any command that returns `state`, prefer `applyState(state, { full: true, preserveSelection: true })` so lists stay in sync.

---

## 8. Drift log

| Date | Change |
|------|--------|
| 2026-08-08 | Phase 0 inventory created from current `controls.js` / `renderer.js` / `presets/` |
| 2026-08-08 | Phase 1: added tab chrome ids (`tab-btn-look`, `tab-btn-object`, `tab-look`, `tab-object`, `preset-save-menu`, `preset-save-menu-btn`). **All Phase 0 control ids preserved.** |
| 2026-08-08 | Phase 2: stack UX (drag reorder, eye, ⋮ menus). Added `pp-layer-empty-hint`. Legacy `pp-layer-up/down/remove/enabled` remain in DOM (enabled visually hidden; buttons in hidden row). |
| 2026-08-08 | Phase 3: Object segments + role-aware fields + live `updateContainer`. Added `seg-btn-*`, `seg-*`, `c-role-badge`, `c-text-wrap`, `c-label-row`. All Phase 0 field ids preserved. |
