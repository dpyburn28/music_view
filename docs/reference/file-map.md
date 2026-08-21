# Repository file map

```
music_view/
├── app.js                        # Electron main: workspace window, IPC, menu, song://
├── preload.js                    # contextBridge → window.musicView
├── package.json                  # npm start → electron .; npm test
│
├── workspace.html                # Landscape shell (launched); first-paint #app-load
│
├── src/
│   ├── main/                     # Node.js modules (require'd by app.js)
│   │   ├── music-library.js      # Song scan + LRC + metadata
│   │   ├── presets.js            # List/load/save/delete preset JSON
│   │   ├── performances.js       # Validate + Show FX compose
│   │   └── user-settings.js      # userData/user-settings.json (docks, window, present, render.fps)
│   │
│   ├── renderer/                 # Display / scene / rendering
│   │   ├── renderer.js           # Scene engine, commands, music consumers
│   │   ├── shaders.js            # WebGL helpers + postprocess stack
│   │   ├── scene-match.js        # Morph vs crossfade scorer (also node --test)
│   │   ├── artef4kt-host.js      # Load/mount ARTEF4KT embed
│   │   ├── performance.js        # Showcase conductor (IIFE; window.MusicViewShow)
│   │   ├── main.css
│   │   └── performance.css
│   │
│   ├── controls/                 # Controls UI
│   │   ├── controls.js           # Look/Object UI (IIFE; window.__musicViewControls)
│   │   └── controls.css
│   │
│   ├── music/                    # Music library + playback
│   │   ├── music.js              # UI + publish streams (IIFE; window.MusicViewMusic)
│   │   ├── audio-analysis.js     # Web Audio analysis + dual-deck mixer
│   │   └── music.css
│   │
│   ├── workspace/                # Workspace shell + bus
│   │   ├── workspace.js          # fitStage / docks / Present / apply render FPS
│   │   ├── workspace-bus.js      # In-process musicView facade
│   │   ├── workspace-hotkeys.js  # Single workspace key router
│   │   ├── workspace-load.js     # Boot overlay + slim busy bar
│   │   └── workspace.css
│   │
│   └── shared/                   # Used by both main + renderer
│       ├── param-mod.js          # LFO resolve (stage + controls)
│       ├── audio-input.js        # Per-container audioInput sanitize
│       └── layout-space.js       # 1080×1920 design frame helpers
│
├── legacy/                       # Standalone HTML files (not launched)
│   ├── index.html
│   ├── controls.html
│   ├── music.html
│   └── performance.html
│
├── vendor/artef4kt/              # Vendored Three.js ferrofluid runtime + settings
│
├── presets/                      # Visual preset JSON
├── performances/                 # Performance JSON (e.g. container-walk.json)
│
├── shaders/
│   ├── index.json
│   ├── README.md
│   └── <id>/controls.json + shader.frag
│
├── test/                         # node --test fixtures
│
└── docs/
```

## Entry points

| Surface | HTML | Primary scripts |
|---------|------|-----------------|
| Workspace (launched) | `workspace.html` | `src/workspace/workspace-load.js`, `src/workspace/workspace-bus.js`, `src/shared/layout-space.js`, `src/shared/audio-input.js`, `src/renderer/renderer.js`, `src/music/audio-analysis.js`, `src/music/music.js`, `src/controls/controls.js`, `src/renderer/performance.js`, `src/workspace/workspace-hotkeys.js`, `src/workspace/workspace.js` |
