# Containers (layout objects)

Containers are floating panels on the Display stage. Presets and Controls Object tab edit the same fields.

## Roles & content

| Role | Purpose | Notes for authors |
|------|---------|-------------------|
| `song-cover` | Album art | Prefer relative center layout; `imageMode` `fill` or `scale` |
| `song-info` | Title / artist / album | Often `belowRole: "song-cover"` |
| `song-lyrics` | Lyric lines | Height matters; width often `widthOfPanel` |
| `song-progress` | Track time bar | `progressTimeMode` e.g. `"ends"` |
| `show-progress` | Performance / show time bar | Same chrome as track progress; driven by `show-state` |
| `audio-scope` | Scope viz | Default `shaderId: "audio-scope"` |
| `audio-history` | History viz | Default `shaderId: "audio-history"` |
| `audio-beat` | Beat viz | Default live package `audio-ferrofluid` (role stays `audio-beat`) |
| `artef4kt` | Three.js ferrofluid embed | No `shaderId`; `embed: { engine, settingsId, quality, settings }`. **Controls → Object → Engine**: look knobs. **Audio**: per-panel analysis channels. Track/playback stay in Music. See [artef4kt-integration-plan](../roadmap/artef4kt-integration-plan.md). |

Custom freeform panels may use null role + text/shader, but song roles are what Music content targets by name.

## Geometry

Prefer **relative** layout for portrait responsiveness:

```json
"relative": {
  "widthOfMin": 0.48,
  "centerX": true,
  "centerYOffset": -0.06
}
```

```json
"relative": {
  "belowRole": "song-cover",
  "gap": 16,
  "centerX": true
}
```

```json
"relative": {
  "widthOfPanel": 0.84,
  "maxWidth": 380,
  "centerX": true,
  "bottomInset": 20
}
```

Absolute `left`/`top`/`width`/`height` work for fixed placements (common for audio viz demos). Those pixels are in the **1080×1920 design frame**.

## Style block

All three sub-objects are expected for round-trip export:

- `style.border` — panel outline  
- `style.connect` — connector stroke when `connect: true`  
- `style.label` — corner label chrome  

`labelCorner`: `top-left` | `top-right` | `bottom-left` | `bottom-right`.

## Shader fields

| Field | Use |
|-------|-----|
| `shaderId` | Package id with `container` role, or null |
| `shaderUniforms` | Override package defaults |
| `shaderModulators` | Optional float LFOs |

Only packages listed with `"container"` in `roles` should be assigned. Postprocess-only packages belong in an FX stack (global or per-container), not as the fill shader.

The same container-role packages can fill the **stage** via Look → Background (`scene.background.mode = "shader"`). That is not a container; it is documented in [scene-model](../architecture/scene-model.md) and [shaders.md](./shaders.md) § Stage background.

## Per-container postprocess (`postprocess`)

Each floating panel can run its own multi-pass FX stack (same packages as Look → FX stack, `"roles": ["postprocess"]`).

```json
"postprocess": {
  "active": true,
  "layers": [
    {
      "shaderId": "crt",
      "enabled": true,
      "uniforms": { "u_intensity": 0.8 }
    }
  ]
}
```

| Field | Use |
|-------|-----|
| `active` | When true, stack runs and covers the panel |
| `layers[]` | Ordered passes; each samples this panel as `u_scene` |
| `layers[].shaderId` | Postprocess package id |
| `layers[].uniforms` / `modulators` | Same as global FX layers |

Pipeline: **panel content → container FX stack → (visible on panel) → global scene capture → global FX stack**.

Edit in Controls → Object → **FX**. Global Look FX still applies to the whole frame after panel stacks.

## Motion

| Field | Use |
|-------|-----|
| `wander` | Enable idle motion |
| `wanderAmplitude` / `wanderFrequency` | Shape of path |
| `distancing` | Soft collision radius |
| `layer` | Draw / hit order |
| `connect` + `attachToRole` | Linked composition |

## Editing in Controls

Object tab is a **panel list** plus inspector (Transform / Style / Motion / Shader / Audio / Engine / FX).

## Audio input (`audioInput`)

Scope, History, Beat, and ARTEF4KT each pick which Music analysis channel they listen to. Stored on the container (not in Music):

```json
"audioInput": {
  "source": "beat",
  "envelope": "envelope",
  "bass": "bass",
  "mid": "mid",
  "high": "treble",
  "gain": 1,
  "continuous": true
}
```

| Field | Used by |
|-------|---------|
| `source` | Scope signal, History energy, Beat pulse, ARTEF4KT beat |
| `envelope` | Beat + ARTEF4KT |
| `bass` / `mid` / `high` | Beat bass; ARTEF4KT bands |
| `gain` | Per-panel scale (0–4) |
| `continuous` | Default `true`. On: follow the audible mix (including fades) and keep history. Off: jump to the incoming track and reset. |

Edit in Controls → Object → **Audio**. Missing fields fall back to the role defaults above.

### List actions

- **Add** — templates: blank, text, shader, image, or a vacant named role (Cover, Lyrics, …).
- **Duplicate** — always a generic copy (never a second Cover).
- **Delete** — removes the panel. Named roles ask for confirm; Music content for that role has nowhere to draw until you add it again.
- **Hide** — list eye (`visible: false`). The panel stays in the list and in presets, keeps its layout size, and is omitted from capture + overlay (content, border, connectors). Distinct from Style → **Show label**, which only toggles the external name.
- **Role** — dropdown on Transform. At most one of each named role.

Live apply uses `updateContainer` (and the add/remove/role/visible commands). Click a row or a panel on Display to select (`selectContainer`). `[` / `]` cycle the list.

Loading a **layout** look updates listed panels and removes **generic extras** you added. Unique roles omitted from old files (e.g. ARTEF4KT missing from `default.json`) stay. FX-only looks (`look-*`) do not change the panel set.

See [container-management-plan.md](../roadmap/container-management-plan.md).

## AI authoring tips

1. Start from an existing preset’s container list; do not invent unknown fields.  
2. Keep the four song roles if music chrome should remain.  
3. When adding a decorative container, assign a unique `layer` and non-overlapping geometry.  
4. For themed looks, restyle borders/labels in concert with the postprocess stack (e.g. green phosphor borders for terminal looks).  
5. Leave `shaderUniforms` sparse when package defaults are fine; only override intentional knobs.
