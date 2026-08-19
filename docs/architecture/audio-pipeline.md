# Audio pipeline

How sound becomes analysis frames and reactive visuals.

## Chain

```
<audio> element (`#audio-a` / `#audio-b` in `#dock-music`)
    → Web Audio (audio-analysis.js)
    → lead tap (incoming MES) + mix tap (mixGain, what you hear)
    → frame { lead, mix, channels, waveform, playing, … }
    → workspace bus in-process `publishAudioFrame` / `onAudioFrame` (no JSON clone)
    → Display applyAudioFrame
    → per-container `audioInput` → setTexture2D / setLiveUniforms / ARTEF4KT setAnalysis
```

Analysis runs only in the **Music** dock. The stage never opens its own AudioContext for the track. Dual-deck playback (`#audio-a` / `#audio-b`) shares one AudioContext; the **mix** analyser stays on `mixGain` so fades are visible.

## Isolatable channels

Defined in `audio-analysis.js` (`CHANNELS`):

| Id | Kind | Notes |
|----|------|--------|
| `full` | wave | L+R mid mix |
| `bass` | wave | ~20–150 Hz |
| `lowmid` | wave | ~150–500 Hz |
| `mid` | wave | ~500 Hz–2 kHz |
| `presence` | wave | ~2–5 kHz |
| `treble` | wave | ~5 kHz+ |
| `center` | wave | Stereo mid (M/S) |
| `vocals` | wave | Center + vocal band — **not** ML stems |
| `rms`, `peak`, `envelope` | level | Loudness / follower |
| `onset` | level | Spectral flux |
| `kick` | level | Low-band flux |
| `beat` | level | Peak-picked pulse |

Wave channels can supply the **waveform** texture; level channels feed scalars.

## Routing (per container)

Each viz / ARTEF4KT container stores `audioInput` (source, optional envelope/bass/mid/high, gain, **continuous**). Edit in Controls → Object → **Audio** — not the Music Analysis tab (that tab is detect / preview / send rate only).

Music publishes a **lead** tap (incoming track) and a **mix** tap (what you hear, including crossfades). Continuous panels (default) use the mix and do not reset on a track change. Off follows the incoming track and clears history / smoothing.

| Viz role | Typical live uniforms / textures | Default `audioInput` |
|----------|----------------------------------|----------------------|
| `audio-scope` | `u_waveform` (full mix), `u_signal`, `u_use_wave` | `source: full` |
| `audio-history` | `u_history` ring buffer, write head, energy | `source: envelope` |
| `audio-beat` | `u_beat`, `u_envelope`, `u_beat_phase`, `u_bass` | `source: beat`, `envelope`, `bass` |
| `artef4kt` | host `setAnalysis` bass/mid/high/beat/envelope | beat + envelope + bass/mid/treble |

Display applies light **smoothing / peak-hold** per container so sparse frames still feel continuous. `audioInput` is saved with presets and performance snapshots.

## What is *not* audio-driven (yet)

Param modulators (sine/noise/etc.) are **not** wired to beat/spectrum as sources. That is backlog (see [roadmap](../roadmap/backlog.md)). Demo motion uses LFOs or hard-coded live uniforms on the three viz packages.

## Authoring note for audio shaders

If you add a new analysis-driven container shader:

1. Role should be `container` in `controls.json`.
2. Declare style knobs as normal uniforms with defaults.
3. Declare live-driven uniforms (advanced) so the UI shows them, but expect Display code to **override** them via `setLiveUniforms`.
4. For waveforms/history, declare `sampler2D` in GLSL and ensure Display (or a new hook) uploads with `setTexture2D`.
5. Wire the role in `createAudioVizPanels` / `applyAudioFrame` if it is a new fixed role — packages alone do not auto-bind IPC.

Today’s live binding is **role-based** for `audio-scope`, `audio-history`, `audio-beat`, and the `artef4kt` embed host, not generic package metadata.

### ARTEF4KT embed

When a container has role `artef4kt`, the stage loads `vendor/artef4kt` via `src/renderer/artef4kt-host.js` and calls `setAnalysis` each frame with bands taken from that panel’s `audioInput` (and the lead or mix tap). ARTEF4KT does **not** open its own MediaElement or AudioContext for the track.
