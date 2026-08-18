# ARTEF4KT (vendored)

Runtime snapshot of the [ARTEF4KT](https://github.com/) ferrofluid visualizer for embedding in **music_view**.

## Provenance

| Field | Value |
|-------|--------|
| Source tree | `/Volumes/ARCHIVE/Dev/Tools/artef4kt` |
| Vendored for | music_view Display floating container role `artef4kt` |
| Packaging | Copy of runtime JS + `settings/` only (no Electron shell, no sample MP3s) |

## Refresh from Tools

```bash
SRC=/Volumes/ARCHIVE/Dev/Tools/artef4kt
DST="$(dirname "$0")"
cp "$SRC"/three.min.js "$SRC"/color-harmonizer.js "$SRC"/grid-cells.js \
  "$SRC"/orbital-blobs.js "$SRC"/shockwave-system.js "$SRC"/performance-monitor.js \
  "$SRC"/gpu-particle-shaders.js "$SRC"/effect-composer.js "$SRC"/filmic-tone-system.js \
  "$SRC"/script.js "$DST"/
cp "$SRC"/settings/*.json "$DST"/settings/
# Re-apply embed patches in script.js (constructor options, external analysis,
# ARTEF4KT_NO_AUTO_INIT) — see docs/roadmap/artef4kt-integration-plan.md
```

## Embed API (patched `script.js`)

- Set `window.ARTEF4KT_NO_AUTO_INIT = true` before loading `script.js`.
- Construct with `new FerrofluidVisualizer({ embed: true, canvas, width, height, externalAnalysis: true })`.
- Drive audio via `setExternalAnalysis({ bass, mid, high, beat, envelope })` and `isPlaying`.
- Resize with `setEmbedSize(w, h)`.
- Host helper: `artef4kt-host.js` → `createArtef4ktEmbed(...)`.

Do **not** merge this package’s Electron dependencies into music_view’s root `package.json`.
