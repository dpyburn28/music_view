# Display scene commands

Controls (and tools) drive the stage through `musicView.sendCommand(command, payload)`. In the workspace this is in-process `sceneCommand` in `src/renderer/renderer.js`.

Return shape: `{ ok: boolean, error?: string, state?: object, … }`.

## State & catalog

| Command | Payload | Result |
|---------|---------|--------|
| `getState` | — | Full scene snapshot (+ shader list when requested by path). Shader list is `controls.json` metadata, not compiled frags. |
| `listShaders` | — | Package summaries for selects. Fetches `controls.json` in parallel; does not load `shader.frag`. |
| `selectContainer` | `{ id }` | UI selection; updates `selectedContainerId` |

## Containers

| Command | Payload | Notes |
|---------|---------|--------|
| `updateContainer` | container field patch + id | Role-aware; omit unused keys. Accepts `visible` and `audioInput`. **Rejects `role`** (use `setContainerRole`). |
| `addContainer` | `{ template?, role?, shaderId?, left?, top?, width?, height?, label?, text? }` | Spawn. Unique-role collision fails. Cap 32. |
| `removeContainer` | `{ id }` | Destroy + rebind; Display selects neighbor. |
| `duplicateContainer` | `{ id }` | Always generic; +16,+16; new `snapshotId`. |
| `setContainerVisible` | `{ id, visible }` | Hide keeps layout size. Capture + overlay skip the panel (CSS opacity alone does not hide the blit). |
| `setContainerRole` | `{ id, role }` | `role: null` ⇒ generic. Unique roles enforced. |
| `applyContainerShader` | `{ id, shaderId }` | Loads package defaults |
| `clearContainerShader` | `{ id }` | Removes fill shader |
| `setContainerUniforms` | `{ id, uniforms }` | Merge value map |
| `setContainerModulators` | `{ id, modulators }` | Replace/merge LFO map |

## ARTEF4KT embed

Role `artef4kt` only. Song/track selection is **not** controlled here — Music owns playback.

| Command | Payload | Notes |
|---------|---------|--------|
| `listArtef4ktPresets` | — | Look packs under `vendor/artef4kt/settings/` |
| `getArtef4ktSettings` | `{ id }` | Live settings + `settingsId` + preset list |
| `setArtef4ktSettings` | `{ id, patch }` or `{ id, settings }` | Partial merge via `patch`; full replace via `settings` |
| `loadArtef4ktPreset` | `{ id, settingsId }` | Load named look JSON into the embed |

## Stage / bottom strip

| Command | Payload | Notes |
|---------|---------|--------|
| `updateBottomPanel` | `{ color?, heightRatio?, heightPercent?, includeInFloatArea? }` | Blue bottom strip under the white stage. `heightRatio` 0–1 (or `heightPercent` 0–100); `0` hides strip and makes top fullscreen. `includeInFloatArea` lets floating containers use the bottom region. Saved in presets as `scene.bottomPanel`. |

## Stage background

Default is a blank white solid. Shader / image / video replace that fill. Background FX processes only the fill.

| Command | Payload | Notes |
|---------|---------|--------|
| `updateBackground` | `{ mode?, color?, imageMode?, videoMode?, videoLoop?, videoMuted? }` | `mode`: `solid` · `shader` · `image` · `video`. Color is the solid fill (`#ffffff` default). |
| `applyBackgroundShader` | `{ shaderId, uniforms? }` | Sets mode to `shader` and loads a container-role package. Same-id re-apply updates uniforms in place and keeps `u_time`. |
| `clearBackgroundShader` | — | Destroys the fill shader and **replaces** the WebGL canvas (a 2D context cannot be rebound). Mode returns to `solid`. |
| `setBackgroundUniforms` | `{ uniforms }` | Merge fill-shader values. |
| `setBackgroundModulators` | `{ modulators }` | LFO map for the fill shader (`null` clears). |
| `setBackgroundMedia` | `{ kind: 'image'\|'video', src?\|url?\|path?, name?, imageMode?, videoMode?, videoLoop? }` | Loads a local file (`media://` URL or absolute path) and sets mode. |
| `clearBackgroundMedia` | `{ kind?: 'image'\|'video'\|'all' }` | Drops image and/or video; mode returns to `solid` if it was that media. |
| `startBackgroundPostprocess` | optional `{ shaderId }` | Enable background FX (seeds a layer if empty). |
| `stopBackgroundPostprocess` | — | Disable output; keeps layers. |
| `addBackgroundPostprocessLayer` | `{ shaderId? }` | Append; auto-enables stack. |
| `removeBackgroundPostprocessLayer` | `{ id }` or `{ layerId }` | Drop layer. |
| `moveBackgroundPostprocessLayer` | `{ id, toIndex }` | Reorder. |
| `reorderBackgroundPostprocessLayers` | ordered ids | Full reorder. |
| `setBackgroundPostprocessLayerShader` | `{ id, shaderId }` | Clears modulators on package change. |
| `setBackgroundPostprocessLayerUniforms` | `{ id, uniforms }` | Merge values. |
| `setBackgroundPostprocessLayerModulators` | `{ id, modulators }` | LFO map. |
| `setBackgroundPostprocessLayerEnabled` | `{ id, enabled }` | Eye toggle. |
| `setBackgroundPostprocessStack` | `{ layers, active? }` | Bulk replace. |

## Postprocess (global / full scene)

| Command | Payload | Notes |
|---------|---------|--------|
| `startPostprocess` | optional stack | Enable loop / capture |
| `stopPostprocess` | — | Stops loop; **does not** clear layers |
| `addPostprocessLayer` | `{ shaderId? }` | Append layer |
| `removePostprocessLayer` | `{ id }` | Drop layer |
| `movePostprocessLayer` | `{ id, direction }` | Up/down |
| `reorderPostprocessLayers` | ordered ids | Full reorder |
| `setPostprocessLayerShader` | `{ id, shaderId }` | Clears modulators on package change |
| `setPostprocessLayerUniforms` | `{ id, uniforms }` | Merge values |
| `setPostprocessLayerModulators` | `{ id, modulators }` | LFO map |
| `setPostprocessLayerEnabled` | `{ id, enabled }` | Eye toggle |
| `setPostprocessStack` | full stack blob | Bulk replace |
| `setPostprocessUniforms` | legacy | First-layer oriented; prefer per-layer |
| `setPostprocessShader` | legacy | Prefer `setPostprocessLayerShader` |

## Container postprocess (per floating panel)

Same postprocess-role packages as the global FX stack, but each pass samples **only that panel** (fill + text) as `u_scene`. Output covers the panel; the global stack then composites the scene (including processed panels).

| Command | Payload | Notes |
|---------|---------|--------|
| `startContainerPostprocess` | `{ id }` | Enable this panel’s stack |
| `stopContainerPostprocess` | `{ id }` | Disable output; keeps layers |
| `addContainerPostprocessLayer` | `{ id, shaderId? }` | Append; auto-enables stack |
| `removeContainerPostprocessLayer` | `{ id, layerId }` | Drop layer |
| `moveContainerPostprocessLayer` | `{ id, layerId, toIndex }` | Reorder |
| `reorderContainerPostprocessLayers` | `{ id, ids }` | Full reorder |
| `setContainerPostprocessLayerShader` | `{ id, layerId, shaderId }` | Clears modulators on package change |
| `setContainerPostprocessLayerUniforms` | `{ id, layerId, uniforms }` | Merge values |
| `setContainerPostprocessLayerModulators` | `{ id, layerId, modulators }` | LFO map |
| `setContainerPostprocessLayerEnabled` | `{ id, layerId, enabled }` | Eye toggle |
| `setContainerPostprocessStack` | `{ id, layers, active? }` | Bulk replace |

Preset export includes `containers[].postprocess: { active, layers }` when non-empty.

## Presets

| Command | Payload | Notes |
|---------|---------|--------|
| `exportPreset` | `{ name? }` | Display builds JSON from live scene |
| `applyPreset` | `{ preset }` | Layout files: spawn listed + prune **generics**. FX-only (no/`[]` containers): chrome only. |
| `loadPreset` | `{ name }` | Main loads file → same wrapper |
| `exportSceneSnapshot` | `{ name? }` | Like export, plus `snapshotId` + `relative` (K24) |
| `resolveSnapshotGeometry` | `{ scene }` | Fill missing pixels from `relative` |
| `applySceneSnapshot` | `{ scene, spawnMissing?, pruneExtra? }` | Spawn/prune unique roles |
| `applySceneTransition` | `{ mode, duration, easing, scene, … }` | `cut` / `dip` / `morph` / `crossfade` / `auto`. Auto morphs when layout/FX match even if `background` identity differs (live outgoing fade). Forced `crossfade` freezes the composite. |
| `setSceneTransitionPaused` | `{ paused }` | Freeze transition `u` |
| `finishSceneTransition` | `{ applyIncoming? }` | Flush runner |

Disk IO for save/delete uses `musicView.savePresetFile` / `deletePresetFile` from Controls after export.

## Authoring notes

- Prefer keeping command **names** stable; Controls and docs inventory depend on them.
- Authoritative historical inventory: [roadmap/history/ui-overhaul-phase-0-inventory.md](../roadmap/history/ui-overhaul-phase-0-inventory.md).
- New features should add **new** commands rather than overloading payload shapes silently when possible.
