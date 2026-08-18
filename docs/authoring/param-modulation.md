# Param modulation

Drive continuous **float** parameters with LFOs without editing GLSL. Evaluation is pure CPU in `param-mod.js`, then values upload as normal uniforms.

Full design history: [roadmap/history/param-modulation-plan.md](../roadmap/history/param-modulation-plan.md) (complete).

## Where specs live

| Surface | Map key | Location |
|---------|---------|----------|
| Postprocess layer | `modulators` | next to `uniforms` on the layer |
| Container shader | `shaderModulators` | next to `shaderUniforms` on the container |
| Package JSON | — | **Never** — do not add LFO fields to `controls.json` |

Base values stay plain numbers in `uniforms` / `shaderUniforms`.

## Spec shape

```json
{
  "source": "sine",
  "offset": 0.55,
  "amp": 0.12,
  "rate": 0.35,
  "phase": 0,
  "clock": "stack",
  "seed": 0
}
```

| Field | Type | Meaning |
|-------|------|---------|
| `source` | string | `static` \| `time` \| `sine` \| `triangle` \| `square` \| `noise` |
| `offset` | number | Center / bias |
| `amp` | number | Amplitude of bipolar wave (before clamp) |
| `rate` | number | Frequency in Hz (cycles per second of the chosen clock) |
| `phase` | number | Phase offset (sine: radians; time/noise/tri/sq: cycles — see plan) |
| `clock` | string | `stack` (default, may omit) \| `wall` \| `song` |
| `seed` | number | Noise lattice seed (noise source) |

`static` or missing modulator → use base uniform only.

## Resolve formulas (summary)

Let `t` be seconds from the selected clock.

| Source | Pre-clamp value |
|--------|-----------------|
| static | base uniform |
| time | `offset + amp * (2 * fract(t * rate + phase) − 1)` |
| sine | `offset + amp * sin(2π * rate * t + phase)` |
| triangle | bipolar triangle of phase cycles |
| square | bipolar square of phase cycles |
| noise | `offset + amp * valueNoise1D(t * rate + phase, seed)` ∈ bipolar |

Then clamp to package `min`/`max` when bounds are known.

Amp ≈ 0 skips expensive paths (treated as static offset).

## Eligibility

Only continuous float widgets (`slider` / `number`) are modulated in UI. Colors, toggles, segmented enums, steppers are **not** eligible. Runtime ignores modulators on ineligible keys (static fallback).

## Preset example

```json
"uniforms": {
  "u_scanline": 0.55
},
"modulators": {
  "u_scanline": {
    "source": "sine",
    "offset": 0.55,
    "amp": 0.15,
    "rate": 0.4,
    "phase": 0
  }
}
```

See `presets/breathing-crt.json` for a full multi-param demo.

## Authoring tips

1. Set **offset** to the visual center you want; **amp** to the wobble amount.  
2. Prefer modest amps so clamp does not hard-rail the signal.  
3. Use `clock: "song"` when motion should pause/seek with playback (when song time is published).  
4. Changing shader package on a layer **clears** modulators (by design).  
5. Live audio `setLiveUniforms` applies **after** modulation and can override the same uniform name.

## UI

Controls → float row → source segmented control (Static · Time · Sine · Tri · Sq · Noise) + sub-knobs. Live readout shows the resolved value while modulated.
