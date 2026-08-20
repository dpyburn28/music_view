# Blackbody Audio Shader — Plan

## Concept

A container shader that uses **physically accurate blackbody radiation colors** (Planck's law × CIE 1931 observer × XYZ→linear sRGB) to visualize audio. Instead of hand-picked palettes, each pixel's color is the actual spectral emission of a thermal radiator at a temperature determined by audio energy.

A blackbody at798K glows deep infrared (invisible); at2000K it's dim red; at3500K warm orange; at5500K roughly solar white. The shader maps audio amplitude to this temperature range, so quiet music = deep reds and loud passages = white-hot. Beats cause brief temperature spikes. The rational approximation (`blackbody_medium`) computes this with one divide + one exp2 per pixel — cheaper than most noise-based palettes.

Existing audio viz shaders use arbitrary color ramps or gradient stops. This shader's colors are *physically grounded* — the same math that predicts the color of a heated iron bar or a star. The Planckian locus (the curve of blackbody chromaticity) is the most natural warm-to-hot color progression.

Adapted from a Shadertoy blackbody spectral shader. The original visualized four quality tiers of rational approximations against ground truth. This version replaces the static visualization with audio-reactive spatial patterns while keeping the core spectral engine.

## Audio Mapping

The core idea: audio energy → blackbody temperature.

| Audio parameter | Maps to | Visual effect |
|----------------|---------|---------------|
| `u_envelope` | Base temperature | Smooth glow that brightens with music |
| `u_beat` | Temperature spike | Brief flash to white-hot on each beat, then cools |
| `u_bass` | Temperature bias | Low-end shifts the whole palette warmer |
| Combined | Weighted mix | Best default — smooth base + beat accent |

Formula:

```
audio_factor = f(mode, beat, envelope, bass, strength)
effective_temp = mix(u_bg_temp, mix(u_temp_lo, u_temp_hi, audio_factor), spatial_weight)
rgb = blackbody_medium(effective_temp)  // returns linear sRGB
```

## Spatial Patterns

Audio provides the **temperature**; spatial patterns provide the **structure**. Each pixel's effective temperature = `audio_temp * spatial_weight + u_bg_temp * (1 - spatial_weight)`.

| Mode | ID | Description | Best for |
|------|----|-------------|----------|
| Radial glow | 0 | Center-out falloff, audio modulates brightness | Focused energy, classic viz |
| Gradient | 1 | Vertical or horizontal temperature gradient shifted by audio | Spectrogram-like, thermal band |
| Rings | 2 | Concentric circles that pulse on beats | Ripple effect |
| Noise | 3 | Organic noise field colored by audio temperature | Smoky, atmospheric |
| Bars | 4 | Vertical strips, each bar's level = its temperature | Spectrum analyzer with physical colors |

## Shader Identity

| Field | Value |
|-------|-------|
| **ID** | `blackbody-audio` |
| **Name** | "Blackbody Audio" |
| **Role** | `["container"]` (audio-beat role) |
| **Entry** | `shader.frag` |
| **Files** | `shaders/blackbody-audio/controls.json` + `shaders/blackbody-audio/shader.frag` |

## What to Keep from the Original

From the **common** tab, lift these functions into `shader.frag`:

| Function | Purpose | Keep? |
|----------|---------|-------|
| `blackbody_medium(k)` | Quartic/quintic rational approx (20 constants, ~11-bit accuracy) | **Yes** — best cost/quality for real-time |
| `blackbody_low(k)` | Cubic/cubic (15 constants) | No — medium is sufficient |
| `blackbody_high(k)` | Quintic/quintic (23 constants) | No — medium is sufficient |
| `srgb_encode(vec3)` | Linear→sRGB gamma | **Yes** |
| `pq_encode3 / pq_decode3` | SMPTE ST.2084 PQ curve | **Yes** — for HDR display mode |
| `rgb_to_ipt / ipt_to_rgb` | IPT opponent color space | **Yes** — for hue-preserving tone mapping |
| `display_clip(vec3)` | Hue-preserving HDR clip | **Yes** — handles over-range gracefully |
| `blackbody_truth(k)` + CMFW[95] | Ground truth spectral integration | **No** —95-entry loop too expensive for real-time; was only used for error plots |
| `luma_palette_ev()` | Diverging exposure map | **Yes** — offer as alternative color mode |
| `blackbody_level()` | Quality dispatcher | **Simplify** — just inline the chosen level |

From the **image** tab: **nothing** — the 4-strip static visualization is replaced entirely by audio-reactive content.

## Controls Reference

### Audio

| Uniform | Type | Default | Range | Description |
|---------|------|---------|-------|-------------|
| `u_audio_mode` | float (select) | 0.0 | 0–3 | Energy · Beat flash · Bass · Combined |
| `u_audio_strength` | float | 0.7 | 0–2 | Audio→temperature sensitivity |
| `u_decay` | float | 0.3 | 0.05–2 | Beat flash cooldown (seconds) |

### Temperature

| Uniform | Type | Default | Range | Description |
|---------|------|---------|-------|-------------|
| `u_temp_lo` | float | 1200 | 798–3000 | Coldest color (K) — deep red/amber |
| `u_temp_hi` | float | 5500 | 2000–5772 | Hottest color (K) — white/blue |
| `u_bg_temp` | float | 900 | 798–2000 | Background temperature when silent |

Kelvin range:798K = Draper point (first visible glow),5772K = solar surface. These are the physical limits of the model.

### Spatial

| Uniform | Type | Default | Range | Description |
|---------|------|---------|-------|-------------|
| `u_spatial_mode` | float (select) | 0.0 | 0–4 | Radial · Gradient · Rings · Noise · Bars |
| `u_spatial_scale` | float | 1.0 | 0.2–4 | Pattern density/frequency |
| `u_spatial_speed` | float | 1.0 | 0–3 | Animation speed |
| `u_falloff` | float | 2.0 | 0.5–6 | Radial falloff exponent |

### Color

| Uniform | Type | Default | Range | Description |
|---------|------|---------|-------|-------------|
| `u_display` | float (select) | 0.0 | 0–2 | sRGB · PQ-HDR · Diverging map |
| `u_exposure` | float | 0.0 | -6–6 | Exposure offset (EV) |
| `u_saturation` | float | 1.0 | 0–2 | Chroma multiplier |

### Style

| Uniform | Type | Default | Range | Description |
|---------|------|---------|-------|-------------|
| `u_intensity` | float | 1.0 | 0–1 | Overall mix |
| `u_vignette` | float | 0.5 | 0–1 | Edge darkening |
| `u_bg_color` | color | [0.01, 0.01, 0.02] | — | Fallback behind the blackbody layer |

## Technical Notes

### Blackbody engine

The shader uses `blackbody_medium()` — a quartic/quintic rational approximation (20 constants, ~17 scalar FMAs). Worst-case error:9.9×10⁻⁵ in chroma,1.4×10⁻⁴ EV in magnitude (~11-bit accuracy). Sufficient for `mediump float` on WebGL1.

### What's excluded

The CMFW[95] ground truth table and `blackbody_truth()` function from the original are not included. They were only used for error visualization and would cost95 divisions per pixel — far too expensive for real-time.

### Display chain

The PQ/IPT display chain (`pq_encode3`, `rgb_to_ipt`, `display_clip`) is included for the PQ-HDR display mode. Provides hue-preserving tone mapping for HDR-capable displays. The sRGB mode skips this entirely.

### Performance

Purely procedural — no texture lookups except audio-injected uniforms. The blackbody function is ~20 ALU ops; spatial patterns add 4–8 evals per pixel. Total: well under100 ALU per pixel, comfortably real-time on integrated GPU.

## Integration Notes

- **Role:** `audio-beat` container — gets `u_beat`, `u_envelope`, `u_bass`, `u_beat_phase` from Display via `setLiveUniforms`
- **Audio routing:** Default `audioInput` = `{ source: "beat", envelope: "envelope", bass: "bass" }` — same as existing `audio-beat` role
- **Registration:** Add `"blackbody-audio"` to `shaders/index.json` after the other `audio-*` entries
- **Dual use:** Can also be assigned as a stage background (Look → Background → Shader) since it has `container` role. When used as background, the spatial patterns fill the full stage.

## Preset Ideas

1. **"Blackbody Pulse"** — Combined mode, Radial spatial, default temperatures. The baseline: smooth glow with beat flashes.
2. **"Thermal Spectrum"** — Bars mode, Energy audio, high temperature range. A spectrum analyzer where each bar's color is its actual blackbody radiation.
3. **"Solar Wind"** — Rings mode, Beat audio, high `u_spatial_speed`. Expanding rings that flash white-hot on beats.

## Implementation Checklist

- [ ] Create `shaders/blackbody-audio/controls.json`
- [ ] Create `shaders/blackbody-audio/shader.frag`
  - [ ] Inline `blackbody_medium()` from original common tab
  - [ ] Inline `srgb_encode()`, PQ encode/decode, IPT chain, `display_clip()`
  - [ ] Implement 5 spatial pattern functions
  - [ ] Implement audio→temperature mapping
  - [ ] Wire `main()` pipeline
- [ ] Register in `shaders/index.json`
- [ ] Smoke test: apply as audio-beat container fill
- [ ] Smoke test: apply as stage background
- [ ] Create starter preset(s) in `presets/`
- [ ] Verify mediump float accuracy (no visual banding at default temps)
