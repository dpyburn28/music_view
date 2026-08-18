// Diagonal typographic cascade. Each cell is one instance (instanceID analog).
// No texture atlas in this pipeline — digits are stroke SDFs (0–9).
// Built-in: u_time, u_resolution, v_uv

uniform float u_tracks;
uniform float u_spacing;
uniform float u_density;
uniform float u_contrast;
uniform float u_cascade;
uniform float u_fade;
uniform float u_speed;

float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

vec2 hash22(vec2 p) {
    float n = hash21(p);
    return vec2(n, hash21(p + n + 17.1));
}

float sdSeg(vec2 p, vec2 a, vec2 b, float th) {
    vec2 pa = p - a;
    vec2 ba = b - a;
    float h = clamp(dot(pa, ba) / max(dot(ba, ba), 0.0001), 0.0, 1.0);
    return length(pa - ba * h) - th;
}

// Sans-like 7-seg strokes in a ~[0,1] × [0,1.6] box (top-left origin).
float digitSDF(vec2 p, float id, float th) {
    float d = 1e3;
    float n = floor(mod(id, 10.0) + 0.5);

    vec2 A = vec2(0.16, 1.44);
    vec2 B = vec2(0.84, 1.44);
    vec2 C = vec2(0.84, 0.80);
    vec2 D = vec2(0.84, 0.16);
    vec2 E = vec2(0.16, 0.16);
    vec2 F = vec2(0.16, 0.80);
    vec2 G1 = vec2(0.20, 0.80);
    vec2 G2 = vec2(0.80, 0.80);

    float bits = 0.0;
    if (n < 0.5) bits = 63.0;
    else if (n < 1.5) bits = 6.0;
    else if (n < 2.5) bits = 91.0;
    else if (n < 3.5) bits = 79.0;
    else if (n < 4.5) bits = 102.0;
    else if (n < 5.5) bits = 109.0;
    else if (n < 6.5) bits = 125.0;
    else if (n < 7.5) bits = 7.0;
    else if (n < 8.5) bits = 127.0;
    else bits = 111.0;

    if (mod(bits, 2.0) > 0.5) d = min(d, sdSeg(p, A, B, th));
    if (mod(floor(bits / 2.0), 2.0) > 0.5) d = min(d, sdSeg(p, B, C, th));
    if (mod(floor(bits / 4.0), 2.0) > 0.5) d = min(d, sdSeg(p, C, D, th));
    if (mod(floor(bits / 8.0), 2.0) > 0.5) d = min(d, sdSeg(p, D, E, th));
    if (mod(floor(bits / 16.0), 2.0) > 0.5) d = min(d, sdSeg(p, E, F, th));
    if (mod(floor(bits / 32.0), 2.0) > 0.5) d = min(d, sdSeg(p, F, A, th));
    if (mod(floor(bits / 64.0), 2.0) > 0.5) d = min(d, sdSeg(p, G1, G2, th));

    if (n > 0.5 && n < 1.5) {
        d = min(sdSeg(p, vec2(0.54, 1.44), vec2(0.54, 0.16), th),
                sdSeg(p, vec2(0.54, 1.44), vec2(0.32, 1.20), th));
    }
    return d;
}

float numberSDF(vec2 p, float n0, float n1, float n2, float n3, float digits, float th) {
    float d = 1e3;
    float w = 0.90;
    if (digits > 3.5) {
        d = min(d, digitSDF(p - vec2(0.0, 0.0), n0, th));
        d = min(d, digitSDF(p - vec2(w, 0.0), n1, th));
        d = min(d, digitSDF(p - vec2(w * 2.0, 0.0), n2, th));
        d = min(d, digitSDF(p - vec2(w * 3.0, 0.0), n3, th));
    } else {
        d = min(d, digitSDF(p - vec2(0.0, 0.0), n1, th));
        d = min(d, digitSDF(p - vec2(w, 0.0), n2, th));
        d = min(d, digitSDF(p - vec2(w * 2.0, 0.0), n3, th));
    }
    return d;
}

void main() {
    vec2 uv = v_uv;
    float t = u_time * max(u_speed, 0.0);

    float tracks = max(u_tracks, 2.0);
    float spacing = max(u_spacing, 4.0);
    float dens = clamp(u_density, 0.0, 1.0);
    float contrast = clamp(u_contrast, 0.0, 1.0);
    float cascade = max(u_cascade, 0.0);
    float fadeRate = max(u_fade, 0.0);

    // Diagonal tracks: top-left → bottom-right. Glyphs stay screen-horizontal.
    float along0 = uv.x - uv.y;
    float across0 = uv.x + uv.y;
    vec2 grid = vec2(along0 * spacing - t * cascade * spacing, across0 * tracks);

    float best = 1e3;
    float bestInk = 0.0;

    for (float j = -1.0; j <= 1.0; j += 1.0) {
        for (float i = -1.0; i <= 1.0; i += 1.0) {
            vec2 cell = floor(grid) + vec2(i, j);
            vec2 rnd = hash22(cell);
            if (rnd.x > dens) continue;

            // instanceID analog — stable as the instance slides down the track.
            vec2 inst = cell;

            float along = (cell.x + 0.5 + t * cascade * spacing) / spacing;
            float across = (cell.y + 0.5) / tracks;
            vec2 center = vec2(along + across, across - along) * 0.5;
            vec2 jitter = (hash22(inst + 4.2) - 0.5) * vec2(0.012, 0.010);
            center += jitter;

            float digits = rnd.y > 0.4 ? 4.0 : 3.0;
            float seed = hash21(inst + 9.4) * 10000.0;
            float n0 = floor(mod(seed / 1000.0, 10.0));
            float n1 = floor(mod(seed / 100.0, 10.0));
            float n2 = floor(mod(seed / 10.0, 10.0));
            float n3 = floor(mod(seed, 10.0));

            vec2 lp = (uv - center) * vec2(52.0, 58.0);
            lp.x += digits > 3.5 ? 1.7 : 1.25;
            lp.y += 0.8;
            float th = mix(0.055, 0.08, hash21(inst + 2.2));
            float d = numberSDF(lp, n0, n1, n2, n3, digits, th);

            // Temporal mask: start fully white, noise-staggered fade to gray/black.
            float nAppear = hash21(inst + 7.7);
            float nGrain = hash21(inst + vec2(t * 0.07, 3.3));
            float reveal;
            if (fadeRate < 0.001) {
                reveal = 1.0;
            } else {
                reveal = smoothstep(0.0, 1.0, t * fadeRate - nAppear * 2.4 + (nGrain - 0.5) * 0.25);
            }

            float weight = mix(0.12, 1.0, pow(hash21(inst + 5.5), mix(1.9, 0.65, contrast)));
            float ink = reveal * weight;
            if (ink < 0.02) continue;

            if (d < best) {
                best = d;
                bestInk = ink;
            }
        }
    }

    float cover = 1.0 - smoothstep(-0.035, 0.04, best);
    // Pure white paper; ink only where a revealed instance sits.
    vec3 col = mix(vec3(1.0), vec3(0.06), cover * bestInk);

    gl_FragColor = vec4(col, 1.0);
}
