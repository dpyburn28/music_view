// Oscilloscope-style waveform — style + range controlled via uniforms.

uniform float u_signal;
uniform float u_gain;
uniform float u_freq;
uniform float u_thickness;
uniform float u_glow;
uniform float u_intensity;
uniform float u_use_wave;
uniform float u_range;
uniform float u_fill;
uniform float u_mirror;
uniform float u_grid;
uniform float u_baseline;
uniform float u_grain;
uniform float u_vignette;
uniform vec3 u_color;
uniform vec3 u_core_color;
uniform vec3 u_bg_color;
uniform sampler2D u_waveform;

float sampleSynth(float x, float t, float signal) {
    float s = clamp(signal, 0.0, 1.0);
    float drive = 0.35 + 0.65 * s;
    float f = max(u_freq, 0.05);
    float y = sin(6.28318 * (x * f + t * 0.55));
    y += 0.45 * sin(6.28318 * (x * f * 2.0 + t * 1.1 + 0.3)) * s;
    y += 0.22 * sin(6.28318 * (x * f * 3.7 - t * 0.8)) * s * s;
    y += 0.08 * sin(x * 90.0 + t * 17.0) * s;
    return y * u_gain * drive;
}

float sampleLive(float x) {
    float s = texture2D(u_waveform, vec2(clamp(x, 0.0, 1.0), 0.5)).r;
    float bipolar = (s - 0.5) * 2.0;
    float drive = 0.4 + 0.6 * clamp(u_signal, 0.0, 1.0);
    return bipolar * u_gain * drive;
}

float waveAt(float x, float useLive, float t, float signal) {
    float y = mix(sampleSynth(x, t, signal), sampleLive(x), useLive);
    return y * clamp(u_range, 0.05, 1.0);
}

float scopeDist(float x, float yMid, float useLive, float t, float signal) {
    float x0 = x - 1.5 / max(u_resolution.x, 1.0);
    float x1 = x;
    float x2 = x + 1.5 / max(u_resolution.x, 1.0);
    float y0 = waveAt(x0, useLive, t, signal);
    float y1 = waveAt(x1, useLive, t, signal);
    float y2 = waveAt(x2, useLive, t, signal);
    float d01 = abs(yMid - y1);
    float span = max(abs(y2 - y0), 0.001);
    float dSeg = abs(yMid - y1) / (1.0 + span * 0.35);
    return min(d01, dSeg);
}

void main() {
    vec2 uv = v_uv;
    float t = u_time;
    float useLive = step(0.5, u_use_wave);
    float signal = u_signal;

    float mid = 0.5;
    float yOff = uv.y - mid;
    float d = scopeDist(uv.x, yOff, useLive, t, signal);
    if (u_mirror > 0.5) {
        d = min(d, scopeDist(uv.x, -yOff, useLive, t, signal));
    }

    float y1 = waveAt(uv.x, useLive, t, signal);
    float thick = max(u_thickness, 0.0025);
    float px = 1.5 / max(u_resolution.y, 1.0);
    float line = smoothstep(thick + px, thick * 0.2, d);
    float core = smoothstep(thick * 0.45 + px, 0.0, d);

    float glowAmt = clamp(u_glow, 0.0, 1.0);
    float glow = exp(-d * (14.0 + 50.0 * (1.0 - glowAmt))) * glowAmt;
    float bloom = exp(-d * 6.0) * (0.12 + 0.35 * clamp(signal, 0.0, 1.0)) * glowAmt;

    // Fill between baseline and wave
    float fillAmt = clamp(u_fill, 0.0, 1.0);
    float fillMask = 0.0;
    if (fillAmt > 0.001) {
        float lo = min(0.0, y1);
        float hi = max(0.0, y1);
        fillMask = step(lo, yOff) * step(yOff, hi);
        fillMask *= smoothstep(0.0, abs(y1) + 1e-4, abs(y1) - abs(yOff) + 0.02);
        if (u_mirror > 0.5) {
            float yAbs = abs(y1);
            fillMask = max(fillMask, step(abs(yOff), yAbs) * smoothstep(yAbs + 0.02, yAbs * 0.2, abs(yOff)));
        }
    }

    float gAmt = clamp(u_grid, 0.0, 1.0);
    float baseAmt = clamp(u_baseline, 0.0, 1.0);
    float baseline = smoothstep(0.0035, 0.0, abs(uv.y - mid)) * 0.45 * baseAmt;
    float gx = abs(fract(uv.x * 8.0) - 0.5);
    float gy = abs(fract(uv.y * 4.0) - 0.5);
    float vgrid = smoothstep(0.035, 0.0, gx) * 0.2 * gAmt;
    float hgrid = smoothstep(0.04, 0.0, gy) * 0.12 * gAmt;

    float grainAmt = clamp(u_grain, 0.0, 1.0);
    float grain = fract(sin(dot(uv * u_resolution, vec2(12.9898, 78.233)) + t * 3.0) * 43758.5453);
    grain = (grain - 0.5) * 0.08 * grainAmt;

    vec3 phosphor = mix(u_color, u_core_color, clamp(signal, 0.0, 1.0) * 0.35);
    vec3 col = u_bg_color;
    col += mix(u_bg_color, u_color, 0.35) * (baseline + vgrid + hgrid);
    col += phosphor * fillMask * fillAmt * 0.35;
    col += phosphor * (line * 0.95 + glow * 0.8 + bloom);
    col += u_core_color * core * 0.55;
    col += grain;

    float vigAmt = clamp(u_vignette, 0.0, 1.0);
    float vig = mix(1.0, smoothstep(0.95, 0.25, length(uv - 0.5)), vigAmt);
    col *= 0.72 + 0.28 * vig;

    float a = clamp(u_intensity, 0.0, 1.0);
    gl_FragColor = vec4(col * a, a);
}
