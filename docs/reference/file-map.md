# Repository file map

```
music_view/
├── app.js                 # Electron main: workspace window, IPC, menu, song://
├── preload.js             # contextBridge → window.musicView
├── user-settings.js       # userData/user-settings.json (docks, window, present, render.fps)
├── workspace-bus.js       # in-process musicView facade
├── package.json           # npm start → electron .; npm test
│
├── workspace.html         # Landscape shell (launched); first-paint #app-load
├── workspace.css
├── workspace-load.js      # Boot overlay + slim busy bar
├── workspace.js           # fitStage / docks / Present / apply render FPS
├── workspace-hotkeys.js   # Single workspace key router
├── index.html             # Leftover stage partial (not launched)
├── main.css
├── renderer.js            # Scene engine, commands, music consumers
├── shaders.js             # WebGL helpers + postprocess stack
├── param-mod.js           # LFO resolve (stage + controls)
├── layout-space.js        # 1080×1920 design frame helpers
├── audio-input.js         # Per-container audioInput sanitize
├── artef4kt-host.js       # Load/mount ARTEF4KT embed
├── scene-match.js         # Morph vs crossfade scorer (also node --test)
│
├── vendor/artef4kt/       # Vendored Three.js ferrofluid runtime + settings
│
├── controls.html          # Leftover standalone Controls (not launched)
├── controls.css
├── controls.js
│
├── music.html             # Leftover standalone Music (not launched)
├── music.css
├── music.js
├── audio-analysis.js      # Web Audio analysis + dual-deck mixer
├── music-library.js       # Main-process song scan + LRC + metadata
├── spotify-import.js      # Spotify URL → local audio + .lrc (yt-dlp + LRCLIB)
│
├── presets.js
├── presets/               # Visual preset JSON
│
├── performances.js        # Validate + Show FX compose
├── performances/          # Performance JSON (e.g. container-walk.json)
├── performance.html       # Leftover standalone (not launched)
├── performance.css
├── performance.js
│
├── shaders/
│   ├── index.json
│   ├── README.md
│   └── <id>/controls.json + shader.frag
│
├── scripts/               # node --test fixtures
│
└── docs/
```

## Entry points

| Surface | HTML | Primary scripts |
|---------|------|-----------------|
| Workspace (launched) | `workspace.html` | `workspace-load.js`, `workspace-bus.js`, `layout-space.js`, `audio-input.js`, `renderer.js`, `audio-analysis.js`, `music.js`, `controls.js`, `performance.js`, `workspace-hotkeys.js`, `workspace.js` |
