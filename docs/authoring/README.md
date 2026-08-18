# Authoring guide (humans & AI)

This folder is the **canonical guide for creating compatible content** for music_view: shaders, presets, modulators, and container layouts.

## AI agent checklist (read first)

When the user asks you to add or change looks, FX, or presets:

1. **Do not invent schema.** Follow the docs below and mirror existing packages/presets.
2. **Shaders**
   - Add a folder under `shaders/<id>/` with `controls.json` + `shader.frag`.
   - Register `id` in `shaders/index.json`.
   - Set `roles` correctly (`postprocess` and/or `container`).
   - Postprocess **must** sample `u_scene`. Container fills (panels **or** stage background) must **not**.
   - Runtime injects `u_time`, `u_resolution`, `v_uv`. Do not redeclare them.
   - Uniform `name` + value types are the stable contract; UI-only fields (`widget`, `group`, `hint`, …) never go in presets.
   - Stage backgrounds use a **container-role** package via `scene.background` (`mode: "shader"`). Prefer a `bg-*` id. Include `u_speed` if motion should freeze at `0`.
   - Full rules: [shaders.md](./shaders.md)
3. **Presets**
   - File: `presets/<name>.json` where `<name>` is `[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}`.
   - Version 1 envelope with `scene.containers` + `scene.postprocess` + optional `scene.background` — **no music/runtime**.
   - Geometry is 1080×1920 design space (`layoutSpace`).
   - Prefer copying structure from `presets/default.json` or a themed preset.
   - Full rules: [presets.md](./presets.md)
   - **Performances** (`performances/*.json`) are clip lists + look snapshots (including `scene.background`) + optional `showFx`, not looks. In the app, **Capture current** is how you save the live background with a section — there is no separate background field.
4. **Modulation**
   - Put LFOs in `modulators` (FX layers) or `shaderModulators` (containers).
   - Only continuous floats; never fold LFO fields into `controls.json`.
   - Full rules: [param-modulation.md](./param-modulation.md)
5. **Containers**
   - Keep required roles for song panels if the preset should still show music UI.
   - Viz / ARTEF4KT routing lives on `audioInput`, not in Music.
   - [containers.md](./containers.md)
6. **Do not**
   - Rename existing uniform `name`s without migrating all presets that set them.
   - Store live analysis values, song paths, or Look → Render FPS in presets.
   - Add Node dependencies for a simple look change.
   - Break IPC command names casually (see [commands](../reference/commands.md)).
   - Sample photos from disk in a container/background shader (no image atlas unless the runtime injects a texture). Keep fills procedural.

## Quick links

| Task | Doc |
|------|-----|
| New postprocess look (CRT-like) | [shaders.md](./shaders.md) § Postprocess |
| New container fill / viz | [shaders.md](./shaders.md) § Container |
| New stage background shader | [shaders.md](./shaders.md) § Stage background |
| Packaged “film look” preset | [presets.md](./presets.md) |
| Breathing / LFO motion | [param-modulation.md](./param-modulation.md) |
| Layout / roles | [containers.md](./containers.md) |
| How runtime uses packages | [How it works](../overview/how-it-works.md) |

## Short package README

`shaders/README.md` is a compact in-tree reminder. Prefer **this** `docs/authoring/` tree for full instructions; keep both aligned when changing the schema.
