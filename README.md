# music_view

Portrait music visualizer for Electron: local playback, lyrics, live audio analysis, floating scene layout, a controllable stage background, and a stack of WebGL postprocess “looks” — all in one workspace window.

- **Stage** — 1080×1920 design frame, letterboxed in the center pane
- **Music** — left dock: library, transport, lyrics, analysis
- **Controls** — right dock: Look (FX, presets, background, render FPS) and Object (containers)
- **Performance** — bottom strip: clip list and show transport (starts collapsed)

## Install & run

```bash
npm install
npm start
```

```bash
npm test
```

Songs are loaded from the directory configured in `music-library.js` (see docs). Optional `.lrc` files share the audio basename.

## Documentation

Full docs live under **[docs/](./docs/README.md)**.

| Section | Contents |
|---------|----------|
| [Overview](./docs/overview/what-is-music-view.md) | What it is, features, how it works |
| [Getting started](./docs/overview/getting-started.md) | Install, songs folder, first run |
| [Authoring (AI + human)](./docs/authoring/README.md) | **Shaders, presets, modulators, performances** |
| [Architecture](./docs/architecture/system.md) | Workspace, IPC / in-process bus, scene, audio |
| [Roadmap / backlog](./docs/roadmap/backlog.md) | Planned features & overhauls |
| [Reference](./docs/reference/file-map.md) | File map, commands, shortcuts |

Shader package short form: [shaders/README.md](./shaders/README.md).

## License

MIT
