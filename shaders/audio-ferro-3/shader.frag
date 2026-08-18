precision mediump float;

uniform float u_spike_count;
uniform float u_spike_length;
uniform float u_spike_sharp;
uniform float u_core_size;
uniform float u_droplets;
uniform float u_gloss;
uniform float u_viscosity;
uniform float u_rotation;
uniform float u_window;
uniform float u_rim;
uniform float u_intensity;
uniform float u_gain;

uniform float u_beat;
uniform float u_envelope;
uniform float u_beat_phase;
uniform float u_bass;

uniform vec3 u_fluid_color;
uniform vec3 u_highlight;
uniform vec3 u_bg_color;
uniform vec3 u_chamber;

float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

float hash11(float n) {
    return fract(sin(n * 127.1) * 43758.5453);
}

float smin(float a, float b, float k) {
    float h = clamp(0.5 + 0.5 * (b - a) / max(k, 1e-4), 0.0, 1.0);
    return mix(b, a, h) - k * h * (1.0 - h);
}

float n2(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float spikeHeight(float ang, float t, float beat, float bass, float env) {
    float sharp = clamp(u_spike_sharp, 0.0, 1.0);
    float len = max(u_spike_length, 0.05);
    float count = clamp(floor(u_spike_count + 0.5), 3.0, 16.0);

    float h = 0.0;
    float rot = t * 0.22 * u_rotation + u_beat_phase * 0.06;

    for (int i = 0; i < 16; i++) {
        float fi = float(i);
        if (fi >= count) break;

        float seed = hash11(fi * 17.13 + 2.7);
        float baseAng = (fi / count) * 6.2831853 + rot * (0.4 + seed * 0.8);
        baseAng += 0.18 * sin(t * (0.35 + seed * 0.5) + fi) * u_rotation;

        float dAng = ang - baseAng;
        dAng = mod(dAng + 3.14159265, 6.2831853) - 3.14159265;

        float width = mix(0.55, 0.14, sharp) * (0.75 + 0.5 * seed);
        float lobe = exp(-0.5 * (dAng * dAng) / (width * width));
        lobe = pow(lobe, mix(1.1, 2.4, sharp));

        float amp = 0.45 + 0.55 * seed;
        amp *= 0.4 + beat * 1.05 + bass * 0.55 + env * 0.35;
        amp *= 0.65 + 0.35 * sin(u_beat_phase * 2.1 + fi * 1.7);
        h += lobe * amp;
    }

    float fine = 0.0;
    for (int j = 0; j < 8; j++) {
        float fj = float(j);
        float seed = hash11(fj * 31.7 + 9.1);
        float baseAng = (fj / 8.0) * 6.2831853 + 0.4 + rot * 1.3;
        float dAng = mod(ang - baseAng + 3.14159265, 6.2831853) - 3.14159265;
        float width = mix(0.22, 0.07, sharp);
        float lobe = exp(-0.5 * (dAng * dAng) / (width * width));
        lobe = pow(lobe, 2.5 + sharp * 2.0);
        fine += lobe * (0.15 + 0.25 * seed) * (0.25 + beat * 0.85 + env * 0.4);
    }
    h += fine * 0.5;
    h *= 0.88 + 0.12 * n2(vec2(ang * 1.2, t * 0.15));
    return h * len;
}

float dropletField(vec2 p, float t, float beat, float bass, float env, float amount) {
    float d = 1e3;
    float n = clamp(amount, 0.0, 1.0);
    if (n < 0.01) return d;

    float k = mix(0.035, 0.1, clamp(u_viscosity, 0.0, 1.0));
    float countF = 3.0 + n * 11.0;
    int count = int(floor(countF));

    for (int i = 0; i < 14; i++) {
        if (i >= count) break;
        float fi = float(i);
        float h1 = hash11(fi * 13.1 + 0.3);
        float h2 = hash11(fi * 27.7 + 1.9);
        float h3 = hash11(fi * 41.3 + 4.2);

        float orbit = 0.1 + h1 * 0.4;
        orbit += beat * 0.07 * h2 + bass * 0.035;
        float spin = t * (0.28 + h2 * 0.85) * max(u_rotation, 0.05)
            + fi * 1.7 + u_beat_phase * 0.12;
        float kick = beat * (0.035 + 0.09 * h3);
        vec2 c = vec2(cos(spin), sin(spin)) * (orbit + kick);
        c += vec2(sin(t * 1.3 + fi), cos(t * 0.9 + fi * 2.0)) * 0.018 * env;

        float rad = (0.01 + h3 * 0.026) * (0.65 + env * 0.55 + beat * 0.4);
        rad *= mix(1.0, 0.5, clamp(length(c) * 1.4, 0.0, 1.0));
        float di = length(p - c) - rad;
        d = smin(d, di, k * (0.55 + h1 * 0.9));
    }
    return d;
}

float ferroSDF(vec2 p, float t, float beat, float bass, float env) {
    float r = length(p);
    float ang = atan(p.y, p.x);

    float coreR = max(u_core_size, 0.02);
    coreR *= 0.5 + bass * 0.38 + env * 0.22 + beat * 0.12;
    coreR += 0.012 * sin(t * 1.05 + bass * 2.2);

    float spikes = spikeHeight(ang, t, beat, bass, env);
    float surfaceR = coreR + spikes;
    float d = r - surfaceR;

    float tipK = mix(0.02, 0.055, clamp(u_viscosity, 0.0, 1.0));
    float count = clamp(floor(u_spike_count + 0.5), 3.0, 16.0);
    float rot = t * 0.22 * u_rotation + u_beat_phase * 0.06;

    for (int i = 0; i < 12; i++) {
        float fi = float(i);
        if (fi >= count) break;
        float seed = hash11(fi * 17.13 + 2.7);
        float tipAng = (fi / count) * 6.2831853 + rot * (0.4 + seed * 0.8);
        tipAng += 0.18 * sin(t * (0.35 + seed * 0.5) + fi) * u_rotation;

        float tipH = spikeHeight(tipAng, t, beat, bass, env);
        float tipR = coreR + tipH * (0.78 + 0.18 * seed);
        vec2 tip = vec2(cos(tipAng), sin(tipAng)) * tipR;
        float tipRad = (0.022 + 0.02 * seed) * (0.75 + beat * 0.45 + env * 0.25);
        tipRad *= smoothstep(0.02, 0.12, tipH);
        float td = length(p - tip) - tipRad;
        d = smin(d, td, tipK);
    }

    float drops = dropletField(p, t, beat, bass, env, u_droplets);
    d = smin(d, drops, mix(0.028, 0.085, clamp(u_viscosity, 0.0, 1.0)));
    d += (n2(p * 16.0 + t * 0.25) - 0.5) * 0.01 * (0.35 + env * 0.65);
    return d;
}

vec2 ferroNormal(vec2 p, float t, float beat, float bass, float env) {
    float e = 0.0028;
    float dx = ferroSDF(p + vec2(e, 0.0), t, beat, bass, env)
             - ferroSDF(p - vec2(e, 0.0), t, beat, bass, env);
    float dy = ferroSDF(p + vec2(0.0, e), t, beat, bass, env)
             - ferroSDF(p - vec2(0.0, e), t, beat, bass, env);
    return normalize(vec2(dx, dy) + 1e-5);
}

void main() {
    vec2 uv = gl_FragCoord.xy / max(u_resolution, vec2(1.0));
    float aspect = u_resolution.x / max(u_resolution.y, 1.0);
    vec2 p = (uv - 0.5) * vec2(aspect, 1.0);

    float t = u_time;
    float gain = max(u_gain, 0.05);
    float beat = clamp(clamp(u_beat, 0.0, 1.0) * gain, 0.0, 1.5);
    float env = clamp(clamp(u_envelope, 0.0, 1.0) * mix(1.0, gain, 0.45), 0.0, 1.25);
    float bass = clamp(clamp(u_bass, 0.0, 1.0) * gain, 0.0, 1.4);

    float idle = 0.12 + 0.04 * sin(t * 0.7);
    beat = max(beat, idle * 0.35);
    env = max(env, idle * 0.5);
    bass = max(bass, idle * 0.25);

    float d = ferroSDF(p, t, beat, bass, env);
    vec2 n = ferroNormal(p, t, beat, bass, env);

    vec2 lightDir = normalize(vec2(-0.42, 0.78));
    float ndl = clamp(dot(n, lightDir), 0.0, 1.0);
    float gloss = clamp(u_gloss, 0.0, 1.0);

    vec2 halfV = normalize(lightDir + vec2(0.08, 0.35));
    float spec = pow(clamp(dot(n, halfV), 0.0, 1.0), mix(14.0, 72.0, gloss));
    spec *= gloss;

    float body = smoothstep(0.014, -0.018, d);
    float soft = smoothstep(0.055, -0.008, d);
    float edge = smoothstep(0.035, 0.0, abs(d));
    float fres = pow(clamp(1.0 - ndl, 0.0, 1.0), 2.2) * edge * gloss;

    vec3 fluid = u_fluid_color;
    fluid *= 0.32 + 0.68 * ndl;
    fluid += u_highlight * spec * (0.08 + beat * 0.18);
    fluid += mix(u_highlight, vec3(0.45, 0.55, 0.7), 0.3) * fres * 0.22;
    fluid *= 0.8 + 0.2 * smoothstep(0.0, 0.22, length(p));
    fluid += u_highlight * beat * 0.04 * body;

    vec3 chamber = u_chamber;
    chamber *= 0.9 + 0.1 * n2(p * 2.8 + t * 0.04);
    chamber = mix(chamber * 0.72, chamber * 1.06, smoothstep(0.5, 0.0, length(p)));
    chamber += u_fluid_color * soft * 0.025 * (0.25 + env);

    vec3 col = mix(chamber, fluid, body);
    float contact = smoothstep(0.07, 0.0, d) * (1.0 - body);
    col *= 1.0 - contact * 0.12;

    float rr = length(p);
    float wr = mix(1.2, 0.46, clamp(u_window, 0.0, 1.0));
    float aa = 1.5 / max(u_resolution.y, 1.0);
    float inside = smoothstep(wr + aa, wr - aa * 2.0, rr);

    float rimW = 0.01 + 0.022 * clamp(u_rim, 0.0, 1.0);
    float rimMask = smoothstep(wr + rimW, wr - aa, rr)
                  * smoothstep(wr - rimW * 1.25, wr + aa, rr);
    rimMask *= clamp(u_rim, 0.0, 1.0);

    vec3 outside = u_bg_color * (0.72 + 0.18 * (1.0 - uv.y));
    col = mix(outside, col, inside);

    float rimAng = atan(p.y, p.x);
    float brush = pow(abs(sin(rimAng * 2.0 + 0.9)), 3.5);
    vec3 rimCol = mix(vec3(0.52, 0.53, 0.55), vec3(0.93, 0.94, 0.96), brush * 0.55 + ndl * 0.25);
    rimCol = mix(rimCol, u_highlight, 0.12);
    col = mix(col, rimCol, rimMask * 0.92);

    float grain = (hash21(uv * u_resolution.xy + floor(t * 24.0)) - 0.5) * 0.028;
    col += grain * inside;
    col = clamp(col, 0.0, 1.0);

    float a = clamp(u_intensity, 0.0, 1.0);
    gl_FragColor = vec4(col * a, a);
}
