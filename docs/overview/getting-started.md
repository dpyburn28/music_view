# Getting started

## Requirements

- Node.js (LTS recommended)
- macOS / Windows / Linux with GPU drivers that support WebGL
- Local audio files (optional lyrics as `.lrc`)

## Install

```bash
cd music_view
npm install
```

## Run

```bash
npm start
```

One **Workspace** opens: Music (left), the portrait stage (center), Controls (right), and a collapsed Performance strip along the bottom.

## Songs folder

The main process looks for audio under (first existing path wins):

1. `/Volumes/ARCHIVE/Assets/Music/Songs`
2. `/Volumes/ARCHIVE/Assets/Music/Songs ` (trailing space variant)

Supported extensions include: `.mp3`, `.wav`, `.flac`, `.m4a`, `.aac`, `.ogg`, `.opus`, `.aiff`, `.aif`, `.wma`.

For lyrics, place a file next to the audio with the **same basename**:

```
Track Name.mp3
Track Name.lrc
```

To pull both from a **Spotify track link**, paste it into Music → Library and click **Import** (needs `yt-dlp` + `ffmpeg`; see [External tools](../tools/external-tools.md)).

If your songs live elsewhere, update `SONG_DIR_CANDIDATES` in `music-library.js` (or add a config path later — see [backlog](../roadmap/backlog.md)).

## First-run checklist

1. Wait for the boot overlay (percent + step) to finish. Later loads show a slim busy bar at the top.
2. **Music** (left dock) — pick a song, or paste a Spotify track URL and Import; confirm cover/title and lyrics (if `.lrc` present).
3. **Look** — enable postprocess; add or reorder FX layers; load a preset (e.g. `vhs-rental`).
4. **Look → Background** — leave the default white solid, or set Shader / Image / Video. Shader packages are container-role fills (`bg-*` and `default`). Apply commits the pick; you can switch packages without clearing first. Basic|All applies to background uniforms as well as Look FX.
5. **Look → Render** — optional frame-rate cap (`Native` or 12–60). This is a machine setting, not part of a look.
6. **Object** — select a container (or click it on the stage); move/style/shader. Viz / ARTEF4KT have an **Audio** tab (channel + continuous).
7. Confirm audio viz panels react when playback is running.
8. **Performance** (bottom strip) — expand to load a show (e.g. `container-walk`) or **Capture current**. Capture stores the live look **including** the stage background. There is no separate “save background” field.
9. **Present** hides chrome (Esc returns). **Fullscreen** is a separate command. **Reset Layout** (View menu) restores dock sizes.

## Project scripts

| Script | Action |
|--------|--------|
| `npm start` | Launch Electron (`electron .`) |
| `npm test` | Node unit tests (scene match, layout space, bus, Show FX, audio input, user settings / render FPS, …) |

There is no build/bundle step; renderer scripts load as plain files.

## Docs next steps

- Product overview: [What is music_view](./what-is-music-view.md)
- Runtime story: [How it works](./how-it-works.md)
- Creating assets: [Authoring](../authoring/README.md)
