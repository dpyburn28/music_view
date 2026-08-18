> **Archived plan** — shipped work. Living docs: [docs/README.md](../../README.md) · [backlog](../backlog.md).

# Controls UI Overhaul Plan

Revamp the controls window so it feels calm, task-oriented, and space-efficient—without breaking live scene control, presets, postprocess stacking, or container editing.

**Scope:** `controls.html`, `controls.css`, `controls.js` (primary). Display (`renderer.js`), presets (`presets.js`, `presets/`), IPC (`app.js`, `preload.js`) only as needed for selection sync / compatibility.

**Out of scope (for this overhaul):** Music window UI, display stage layout redesign, new shader packages, on-canvas gizmos (optional later phase).

**Progress**

| Phase | Status | Notes |
|-------|--------|--------|
| 0 Inventory & guardrails | **Done** (2026-08-08) | See `ui-overhaul-phase-0-inventory.md` |
| 1 Tabs + compact presets | **Done** (2026-08-08) | Look \| Object tabs; compact presets; details collapsed |
| 2 Stack UX | **Done** (2026-08-08) | Dense rows, eye enable, ⋮ menu, drag reorder, params drawer |
| 3 Object segments | **Done** (2026-08-08) | Transform/Style/Motion/Shader; role-aware; live apply |
| 4 Polish | **Done** (2026-08-07) | Click-to-select; wider window; uniform groups/Basic·All; shortcuts; DnD polish |

---

## 1. Goals

| Goal | Success look |
|------|----------------|
| Reduce overwhelm | User sees one domain at a time (Look vs Object) |
| Economical layout | Fewer always-visible buttons; progressive disclosure |
| Intuitive hierarchy | “Pick look / pick effect / pick panel” matches mental model |
| Keep power | Full postprocess stack + container fields remain reachable |
| Zero regressions | Presets, stack IPC, container apply, live uniforms still work |

---

## 2. Current state (baseline)

### 2.1 Controls structure today

Single scrolling column (~340px) with three always-stacked panels:

1. **Presets** — select, load, save, save-as-default, delete, refresh  
2. **Postprocess stack** — global On, layer list, add layer, full layer editor + uniforms  
3. **Container** — picker + large form (text, label style, layout, motion, stroke, shader)

Many `<details open>`, permanent hint paragraphs, multiple primary CTAs, and role-agnostic fields (e.g. free text on song panels).

### 2.2 Systems that must not break

| System | Key files | Coupling to controls UI |
|--------|-----------|-------------------------|
| Scene commands IPC | `preload.js` → `app.js` → `renderer.js` `sceneCommand` | Controls call `cmd(command, payload)`; response may include `state` |
| Live state push | `publishSceneState` → `onState` | `applyState()` merges containers / postprocess / `activePreset` |
| Postprocess stack | `postprocessState.layers`, stack renderer | Layer id, order, uniforms, enabled, global active |
| Container edit | `updateContainer`, shaders | Full form → `readContainerForm` / live progress-time mode |
| Presets | `presets/`, `presets.js`, export/apply/load | **Export is display-side** (`exportPreset`); UI only orchestrates |
| Shader catalogs | `shaders/index.json` + packages | `listShaders` / `getState.shaders` fill selects |

### 2.3 Preset contract (do not change lightly)

Presets are **visual only** JSON under `presets/*.json`:

```text
{
  version: 1,
  name: string,
  createdAt, updatedAt,
  scene: {
    containers: [ { role, label, geometry, style, shaderId, shaderUniforms, … } ],
    postprocess: { active, layers: [ { shaderId, enabled, uniforms } ] }
  }
}
```

**Not in presets:** song selection, cover bitmaps, lyric lines, playback time.

**Critical path today:**

1. **Save:** Controls → `cmd('exportPreset')` → display builds preset from live scene → `savePresetFile(name, preset)` (main writes disk).  
2. **Load:** Controls → `cmd('loadPreset', { name })` → display `loadAndApplyPreset` (main reads file → `applyScenePreset`).  
3. **Startup:** Display loads `default` after panels exist (`loadAndApplyPreset('default')`).

**UI overhaul must not:**

- Move export logic into the controls DOM in a way that drops fields  
- Save music-derived text/images into presets  
- Change on-disk schema without a version bump + migration  
- Rely on controls-only state for “what to save” (display remains source of truth)

---

## 3. Target UX (north star)

> Thin director panel: choose a **Look** (presets + FX chain) **or** an **Object** (floating panel). Parameters appear only for the current selection.

### 3.1 Information architecture

```
┌─────────────────────────────────────┐
│ music_view          status    ↻     │
├─────────────┬───────────────────────┤
│ Look │ Object│   (optional later: Stage)
├─────────────────────────────────────┤
│                                     │
│   Active pane only                  │
│                                     │
└─────────────────────────────────────┘
```

| Tab | Contents |
|-----|----------|
| **Look** | Presets (compact) + postprocess stack + selected-effect params |
| **Object** | Container picker + segmented editor (Transform / Style / Motion / Shader) |

### 3.2 Interaction rules

1. **One tab visible** — never mount full Look + full Object forms simultaneously in the scroll sense (DOM may keep both but one is hidden).  
2. **Selection-scoped editors** — postprocess uniforms only for selected layer; container fields only for selected container.  
3. **Live apply preferred** — debounced for numbers/colors; remove redundant Apply where safe.  
4. **Destructive / rare actions** — menus or confirm, not always-visible primary buttons.  
5. **Role-aware Object UI** — hide irrelevant fields for `song-cover`, `song-info`, `song-lyrics`, `song-progress`.

### 3.3 Visual language

- Instrument panel, not settings dump  
- One surface per pane; hairline dividers instead of nested cards  
- Label-left / control-right rows where possible  
- Accent only for selection + primary action  
- Hints → tooltips / `title` / first-run only  

---

## 4. Compatibility & breakage matrix

### 4.1 Must remain stable (API / data)

| Contract | Stability rule |
|----------|----------------|
| `cmd(command, payload)` names | Keep existing command strings; UI can call the same ones |
| `exportPreset` / `applyPreset` / `loadPreset` | Keep; UI only changes chrome around them |
| Preset JSON `version: 1` scene shape | No field removals from export without migration |
| Postprocess layer `id` (number) | Selection + uniform updates key off this |
| Container `id` (number) | Same |
| `getSceneState()` / `applyState()` fields | May **add** UI-only fields; don’t remove `containers`, `postprocess.layers`, `activePreset` |
| `shaders` list roles | Still filter `postprocess` vs `container` |

### 4.2 Safe to change (UI only)

| Area | Change |
|------|--------|
| HTML structure / class names | Freely, if JS selectors updated |
| Panel titles (“Postprocess stack” → “FX”) | Copy only |
| Apply button presence | If replaced by live `updateContainer` / layer commands |
| Hint paragraphs | Remove or tooltip |
| Open/closed details | Default collapsed |
| Window width | Optional increase (e.g. 360–400); not required for Phase 1 |

### 4.3 High-risk areas (explicit mitigations)

| Risk | How it breaks | Mitigation |
|------|----------------|------------|
| **Preset save incomplete** | New UI forgets to call `exportPreset` and invents state from form | Always save via `exportPreset` on display; never reconstruct scene from controls form alone |
| **Preset load doesn’t refresh UI** | Apply succeeds but selects/lists stale | On load success: `applyState(result.state, { full: true })` + `refreshPresetList` + set `activePreset` |
| **Default startup** | Controls assume empty stack before display ready | Keep display-side `loadAndApplyPreset('default')`; controls only list files |
| **Layer uniform pushes** | Wrong layer id after reorder/DOM rebuild | Keep `selectedPpLayerId`; re-bind on list re-render; commands use layer `id` not index |
| **Reorder / remove** | Selection points at deleted id | Clear or clamp selection after remove; re-render list from `state.postprocess.layers` |
| **Global FX Off** | `pp-active` unchecked but stack destroyed incorrectly | Keep `stopPostprocess` / `startPostprocess` semantics (hide canvas / stop loop—don’t wipe layer list unless intended) |
| **Container Apply vs live** | Double-apply or missed fields (progress time mode, shaders) | Checklist of fields in §6.3; integration tests / manual script §8 |
| **Role-hidden fields** | Hide `c-text` but still send empty text and wipe labels | Role-aware `readContainerForm`: omit keys that aren’t shown, or don’t send `text` for song roles |
| **formDirty / live state** | Full form reset from wander ticks | Preserve `positionsOnly` / `formDirty` behavior; tab switches shouldn’t force dirty clear incorrectly |
| **Shader select lists** | Look vs Object both need catalogs | Shared `renderShaderSelects()` filling both `#pp-*` and `#c-shader` even if tab hidden |
| **CSS `.hidden`** | Tab hide vs editor hide conflict | Separate classes: `.tab-panel[hidden]` vs `.is-hidden` for editors |

### 4.4 Explicit non-goals that protect stability

- Do **not** change `applyScenePreset` / `exportScenePreset` algorithms in the first UI phase except bugfixes.  
- Do **not** rename IPC commands in Phase 1–2.  
- Do **not** require preset schema v2 for the UI overhaul.  
- Do **not** load presets by reading only the controls window’s partial form state.

---

## 5. Phased plan

### Phase 0 — Inventory & guardrails (before visual work)

**Status: complete (2026-08-08).** Full tables live in **`ui-overhaul-phase-0-inventory.md`** (source of truth if this section and the inventory disagree, prefer the inventory file and update both).

**Tasks**

- [x] Document every `cmd('…')` used by `controls.js` → inventory §2 (16 commands).  
- [x] Document every element id referenced by `controls.js` → inventory §4 (63 ids).  
- [x] Document all display `sceneCommand` cases → inventory §1 (21 commands).  
- [x] Confirm `presets/default.json` + boot `loadAndApplyPreset("default")` → inventory §5 (**PASS** static).  
- [x] Baseline smoke checklist template → inventory §6 (interactive column for pre–Phase 1 run).  
- [x] Drift log / guardrails → inventory §7–8.

**Exit criteria:** Inventory complete; static preset/boot verification PASS. Interactive §8.1 still recommended once on current UI before Phase 1 ships.

**Breakage risk:** None (docs only).

---

### Phase 1 — Information architecture (tabs + collapse)

**Status: complete (2026-08-08).**

**Intent:** Biggest calm-down with minimal logic change.

#### 1.1 UI — done

- Tab bar: **Look** | **Object** (`#tab-btn-look` / `#tab-btn-object`).  
- Presets + FX stack under Look (`#tab-look`).  
- Container under Object (`#tab-object`).  
- Default tab: **Look**; last tab in `sessionStorage` key `music_view_controls_tab`.

#### 1.2 Presets chrome — done

```
[ preset ▾ ] [Load] [↻]     Active: name
[ name     ] [Save ▾]       → Save as default | Delete selected
```

- Same IPC: `exportPreset`, `savePresetFile`, `loadPreset` / `applyPreset`, `deletePresetFile`, `listPresets`.  
- Permanent hint paragraphs removed; tooltips on controls.

#### 1.3 Container sections — done

- **Layout** open by default; Label style, Motion, Border, Shader **collapsed**.  
- Progress time layout field remains above details (role-gated).  
- No IPC changes.

#### 1.4 Compatibility notes

| Keep working | How |
|--------------|-----|
| Save preset | Still `exportPreset` then `savePresetFile` |
| Load preset | Still display apply; then full `applyState` |
| Hidden tab DOM | Both panels stay in DOM; inactive uses `hidden` + `.is-active` |
| Element ids | Unchanged (Phase 0 inventory) |
| Refresh | Header ↻ still `refreshFull` + `refreshPresetList` |

**Exit criteria:** Tabs work; same IPC smoke as baseline; presets save/load unchanged.

**Risk:** Medium (HTML restructure). **Mitigation:** Element **ids** kept stable.

---

### Phase 2 — Look pane density (stack UX)

**Status: complete (2026-08-08).**

**Intent:** Stack feels like a layer list, not a second settings app.

#### 2.1 Layer list — done

- Row: `⠿` handle · order · name · eye (◉/○) · ⋮ menu.  
- Click row → select (`selectedPpLayerId`).  
- Eye → `setPostprocessLayerEnabled`.  
- Menu: Move up / Move down / Remove (same IPC as before).

#### 2.2 Reorder — done

- HTML5 drag-and-drop → `reorderPostprocessLayers({ ids })`.  
- Move up/down remain in ⋮ menu and on hidden legacy buttons.

#### 2.3 Params drawer — done

- Editor shown only when a layer is selected; empty hint otherwise.  
- Description clamped to 2 lines + full text in `title`.  
- Global **On** → `startPostprocess` / `stopPostprocess` (does not clear layers).  
- Hidden `#pp-layer-enabled` kept for sync; up/down/remove buttons kept but hidden.

#### 2.4 Compatibility notes

| Keep working | How |
|--------------|-----|
| Layer uniforms | `setPostprocessLayerUniforms` + layer id |
| Shader change | `setPostprocessLayerShader` |
| Add layer | `addPostprocessLayer` + select `layerId` |
| Element ids | Phase 0 ids preserved |
| Presets | Export still display-side; order = stack order |

**Exit criteria:** Stack ops + presets path unchanged in behavior.

---

### Phase 3 — Object pane (role-aware + segmented)

**Status: complete (2026-08-08).**

**Intent:** Edit one panel without drowning in fields.

#### 3.1 Segments — done

**Transform** | **Style** | **Motion** | **Shader** — one visible; last segment in `sessionStorage`.

#### 3.2 Role-aware field policy — done

| Role | Behavior |
|------|----------|
| `song-cover` | Hide free text; Shader tab available |
| `song-info` / `song-lyrics` / `song-progress` | Hide free text; hide Shader tab |
| `song-progress` | Progress time layout on Transform |
| generic | Full fields including text + Shader |

`readContainerForm` **omits `text`** for all `song-*` roles.

#### 3.3 Apply strategy — done

- Debounced live `updateContainer` on input/change (non-shader).  
- Shader still **Apply shader** / **Clear**.  
- **Apply now** remains for explicit full commit.  
- Focused inputs not overwritten on soft re-render after live apply.

#### 3.4 Compatibility notes

| Keep working | How |
|--------------|-----|
| Presets | Export still display-side; omit text only in *controls* payloads for song roles |
| Element ids | All Phase 0 container field ids preserved |
| Music content | Never sent as empty `text` from song panel edits |

---

### Phase 4 — Polish & optional features

**Status: complete (2026-08-07)** for the high-value polish set. Deferred: undo stack, preset schema v2, icon rail.

Do only after Phases 1–3 are stable.

| Item | Notes | Preset impact | Status |
|------|--------|----------------|--------|
| Display click-to-select container | `selectContainer` cmd + `selectedContainerId` in state; blue ring on stage; switches Object tab | None (UI-only, not exported) | **Done** |
| Wider window / icon rail | Controls window 380px (min 320); no icon rail | None | **Done** (width) |
| Uniform groups in `controls.json` | Additive `group?: string` on uniforms; UI group headers | None (values unchanged) | **Done** |
| Basic/Advanced uniform filter | Additive `advanced?: boolean`; Basic \| All toggle | None | **Done** |
| DnD polish, keyboard shortcuts | Handle-only drag; before/after drop markers; keys below | None | **Done** |
| Undo stack | Harder; optional | Must not corrupt export | Deferred |
| Preset schema v2 | Only if relative layout export needed | Migration path required | Deferred |

**Keyboard shortcuts (controls window, when not typing in a field):**

| Key | Action |
|-----|--------|
| `1` / `2` | Look / Object tab |
| `[` / `]` | Previous / next container (Object) |
| `E` | Toggle enable on selected FX layer (Look) |
| `Delete` / `Backspace` | Remove selected FX layer (Look) |
| `⌥↑` / `⌥↓` (Alt+arrows) | Move selected FX layer up/down |
| `Esc` | Close menus / blur field |

---

## 6. Command & field contracts (reference)

> **Phase 0:** Authoritative inventories (including full id list and display-only commands) are in `ui-overhaul-phase-0-inventory.md`. Summary below.

### 6.1 Commands used by controls (keep)

| Command | Used for |
|---------|----------|
| `getState` | Full sync |
| `updateContainer` | Container fields |
| `applyContainerShader` / `clearContainerShader` / `setContainerUniforms` | Container FX |
| `startPostprocess` / `stopPostprocess` | Global FX on/off |
| `addPostprocessLayer` / `removePostprocessLayer` | Stack membership |
| `movePostprocessLayer` | Order (↑↓); `reorderPostprocessLayers` available, unused by UI |
| `setPostprocessLayerShader` / `setPostprocessLayerUniforms` / `setPostprocessLayerEnabled` | Layer edit |
| `exportPreset` | Build preset from display |
| `applyPreset` / `loadPreset` | Apply look |

Display also implements (unused by current controls UI): `listShaders`, `setPostprocessUniforms`, `setPostprocessShader`, `setPostprocessStack`, `reorderPostprocessLayers`.

### 6.2 Main-process preset API (keep)

| API | Role |
|-----|------|
| `listPresets` | Fill dropdown |
| `loadPresetFile` | Display load path + controls fallback |
| `savePresetFile` | Persist JSON |
| `deletePresetFile` | Delete non-default |
| `getDefaultPresetName` | Optional |

### 6.3 Container payload parity checklist

When changing apply/live paths, ensure these still round-trip if shown:

- `text` (non-song only), `label`, `labelCorner`, `labelStyle`  
- `left`, `top`, `width`, `height`, `layer`, `distancing`  
- `wander`, `wanderAmplitude`, `wanderFrequency`, `connect`, `anchorDistance`, `attachToId`  
- `style.border`, `style.connect`  
- `progressTimeMode` (progress role)  
- `shaderId` + uniforms via shader commands  

### 6.4 Preset export parity checklist

`exportScenePreset` must continue to include (per container):

- role, label, labelCorner, geometry, wander*, layer, distancing, connect, anchor, attach, shaderId, shaderUniforms, imageMode, progressTimeMode, style  

And postprocess:

- `active`, `layers[]` with `shaderId`, `enabled`, `uniforms`  

After UI overhaul, run: load default → tweak → save `ui-test` → reload app → load `ui-test` → visual match.

---

## 7. File-level change map

| File | Phase 1 | Phase 2 | Phase 3 | Notes |
|------|---------|---------|---------|-------|
| `controls.html` | Tabs, regroup sections | Stack markup | Segmented object | Keep element ids |
| `controls.css` | Tab chrome, compact presets | Layer rows, drawer | Segments | Prefer additive classes |
| `controls.js` | Tab state, render visibility | DnD/menus | Role filters, live apply | Don’t fork preset export |
| `app.js` | Optional width | — | — | Preset IPC untouched |
| `preload.js` | — | — | — | Unless new select-sync API |
| `renderer.js` | — | — | Optional live helpers | Preset apply/export stable |
| `presets.js` / `presets/*` | — | — | — | No change required for UI |
| `shaders/*/controls.json` | — | — | Phase 4 groups | Additive only |

---

## 8. Test plan

### 8.1 Smoke (every phase)

1. Launch app: display + controls + music open.  
2. Default preset applied (LCD stack, panels visible).  
3. Controls refresh shows containers + layers.  
4. Toggle postprocess On/Off: canvas shows/hides; layers still listed.  
5. Add grain layer → reorder → disable → remove.  
6. Edit a uniform → visible change on display.  
7. Select Cover → move X/Y → Apply/live → position sticks after refresh.  
8. **Save** preset `ui-smoke` → **Load** `default` → **Load** `ui-smoke` → matches.  
9. **Save as default** only when intentional; restore default from git if needed.  
10. Play song: cover/lyrics/progress still update (presets didn’t own music).

### 8.2 Preset regression (after Phase 1 and 3)

| Step | Expect |
|------|--------|
| Export via Save | File under `presets/` with `scene.containers` + `scene.postprocess` |
| Open JSON | No lyric strings, no cover data URLs, no `currentTime` |
| Load on clean launch | Geometry + FX restored; then play song fills content |
| Delete non-default | Works; delete `default` rejected |

### 8.3 Role-aware regression (Phase 3)

| Action | Expect |
|--------|--------|
| Edit Cover position | Cover moves; track text unchanged |
| Edit Track style | Label style changes; title still from music |
| Progress time layout | Ends/center still works; saved in preset |
| Lyrics position | Scroll lyrics still work after move |

### 8.4 Automated (optional later)

- Unit: `exportScenePreset` snapshot shape (if Node-testable extract).  
- Unit: `sanitizePresetName` / save reject path.  
- No full Electron e2e required for Phase 1.

---

## 9. Implementation order (recommended)

1. **Phase 0** inventory + baseline smoke  
2. **Phase 1** tabs + compact presets + collapsed details (**ship checkpoint**)  
3. **Phase 2** stack list/params UX  
4. **Phase 3** object segments + role-aware + live apply  
5. **Phase 4** polish only if needed  

After each phase: run §8.1; after 1 and 3 also §8.2.

---

## 10. Rollback strategy

| Phase | Rollback |
|-------|----------|
| 1–2 | Revert `controls.html` / `.css` / `.js` only; display + presets untouched |
| 3 live-apply | Re-enable Apply button; restore previous `readContainerForm` send-all-fields behavior |
| Accidental default overwrite | `git checkout -- presets/default.json` |
| Bad preset file | Delete file from `presets/`; load `default` |

Keep UI commits separate from `renderer.js` / `presets.js` commits when possible.

---

## 11. Open decisions (resolve before Phase 3)

1. **Live apply vs Apply button** for containers — recommend live with debounce.  
2. **Empty FX stack allowed?** — recommend allow but warn; default preset always has ≥1 layer.  
3. **Control window width** — stay 340 vs grow to ~400 for segments.  
4. **Tab labels** — “Look / Object” vs “FX / Panels”.  
5. **Whether Object text fields remain for debugging** — recommend hide for song roles.

---

## 12. Success criteria (project done)

- [ ] Controls feel navigable in &lt; 3 seconds to any common task (load look, tweak FX, move panel).  
- [ ] No permanent multi-paragraph hints.  
- [ ] Preset save/load/default path identical in behavior to pre-overhaul.  
- [ ] Postprocess stack feature-complete vs today (add/remove/reorder/enable/uniforms/shader).  
- [ ] Container editing feature-complete for all roles without clobbering music content.  
- [ ] §8 smoke green on a clean launch.

---

## 13. Appendix — Mental model diagram

```text
                    ┌──────────────┐
                    │   Display    │  source of truth for scene
                    │  renderer.js │
                    └──────┬───────┘
           exportPreset    │    applyPreset / loadPreset
           getState        │    stack + container commands
                    ┌──────▼───────┐
                    │  Main / IPC  │  presets/*.json on disk
                    └──────┬───────┘
                           │
                    ┌──────▼───────┐
                    │   Controls   │  view + edit chrome only
                    │  Look|Object │
                    └──────────────┘
```

**Rule of thumb:** Controls are a **remote control**, not a second database. Presets are snapshots of the display scene’s visual configuration, not of the controls form DOM.
