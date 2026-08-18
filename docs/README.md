# music_view documentation

Portrait music visualizer for Electron. One **workspace** window hosts the Music dock, a 1080×1920 portrait stage, Controls, and a Performance strip.

## Start here

| Audience | Read |
|----------|------|
| New user | [Getting started](./overview/getting-started.md) · [What it is](./overview/what-is-music-view.md) |
| Understanding the system | [How it works](./overview/how-it-works.md) · [Architecture](./architecture/system.md) |
| **AI / authoring content** | **[Authoring guide](./authoring/README.md)** (shaders, presets, modulators) |
| Live editor workflow | [Commands](./reference/commands.md) · [Scene model](./architecture/scene-model.md) |
| Changelog | [CHANGELOG.md](./CHANGELOG.md) |
| Planned work | [Roadmap & backlog](./roadmap/README.md) |
| External helpers | [Tools](./tools/external-tools.md) |

## Current app shape

- **Workspace** is the landscape shell: **Music** left, portrait stage center, **Controls** right, **Performance** as a bottom strip (collapsed to transport by default).
- Geometry is authored in a **1080×1920 design frame** (`scene.layoutSpace`) and projected uniformly onto the live stage.
- **Stage background** is part of the look: solid, container-role shader, image, or video, plus optional Background FX. It is saved in presets and in performance look snapshots.
- **Presets** save the visual scene only; they do not save the current song, lyrics, analysis, or Look → Render frame rate.
- **Performances** sequence clips (song in/out + look snapshots + transitions). Optional **Show FX** layers sit on top of each clip’s own FX stack. Auto morphs when layout/FX match even if the fill identity changes; outgoing shaders/videos keep playing on a fade layer.
- **Render frame rate** (Look → Render) caps WebGL draws and lives in user settings, not in presets.

The most relevant docs for the current editor are [overview/how-it-works.md](./overview/how-it-works.md), [reference/commands.md](./reference/commands.md), and [architecture/scene-model.md](./architecture/scene-model.md).

## Doc map

```
docs/
  overview/           Product, features, install, end-to-end flow
  architecture/       Workspace, IPC / bus, scene model, audio pipeline
  authoring/          How to create shaders, presets, modulators (AI + human)
  reference/          Commands, file map, shortcuts
  roadmap/            Backlog + completed overhaul plans (history/)
  tools/              Lyric / download utilities
```

### Overview

| Doc | Description |
|-----|-------------|
| [what-is-music-view.md](./overview/what-is-music-view.md) | Purpose, features, workspace layout |
| [how-it-works.md](./overview/how-it-works.md) | Runtime pipeline (music → scene → postprocess) |
| [getting-started.md](./overview/getting-started.md) | Install, run, songs folder |

### Architecture

| Doc | Description |
|-----|-------------|
| [system.md](./architecture/system.md) | Electron process, workspace docks, IPC / in-process bus |
| [scene-model.md](./architecture/scene-model.md) | Containers, roles, postprocess stack, design space |
| [audio-pipeline.md](./architecture/audio-pipeline.md) | Analysis channels → per-container `audioInput` |

### Authoring (create compatible assets)

| Doc | Description |
|-----|-------------|
| [README.md](./authoring/README.md) | **AI entry point** — checklist before editing |
| [shaders.md](./authoring/shaders.md) | Package layout, GLSL rules, `controls.json` schema |
| [presets.md](./authoring/presets.md) | Visual preset JSON schema |
| [param-modulation.md](./authoring/param-modulation.md) | LFO specs in presets / runtime |
| [containers.md](./authoring/containers.md) | Container fields, `audioInput`, layout helpers |

Canonical short form of the shader package contract also lives at [`shaders/README.md`](../shaders/README.md) (kept in sync with authoring docs).

### Reference

| Doc | Description |
|-----|-------------|
| [file-map.md](./reference/file-map.md) | Repo layout |
| [commands.md](./reference/commands.md) | Display `sceneCommand` API |
| [keyboard-shortcuts.md](./reference/keyboard-shortcuts.md) | Workspace keys |

### Changelog / roadmap

| Doc | Description |
|-----|-------------|
| [CHANGELOG.md](./CHANGELOG.md) | Running app update log for new features and fixes |
| [roadmap/README.md](./roadmap/README.md) | Status of finished work + links |
| [artef4kt-integration-plan.md](./roadmap/artef4kt-integration-plan.md) | Plan: vendor ARTEF4KT, floating container, song wiring |
| [postprocess-toolkit-plan.md](./roadmap/postprocess-toolkit-plan.md) | Plan: versatile postprocess FX catalog |
| [performance-timeline-plan.md](./roadmap/performance-timeline-plan.md) | Plan: Performance dock, song sections, look snapshots |
| [container-management-plan.md](./roadmap/container-management-plan.md) | Plan: Controls panel list, add/remove/hide |
| [fullscreen-single-window-plan.md](./roadmap/fullscreen-single-window-plan.md) | Plan: single workspace (implemented) |
| [backlog.md](./roadmap/backlog.md) | Features / overhauls still open |
| [history/](./roadmap/history/) | Full completed plan docs (UI, shaders, modulation) |

### Tools

| Doc | Description |
|-----|-------------|
| [external-tools.md](./tools/external-tools.md) | In-app Spotify import, LRC makers |
