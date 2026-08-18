// Hashed field of 3–4 digit integers, stroke SDF type.
// Built-in: u_time, u_resolution, v_uv

uniform float u_density;
uniform float u_scale;
uniform float u_contrast;
uniform vec3 u_paper;
uniform vec3 u_ink;
uniform float u_drift;
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

// Thin stroke digits in a ~[0,1] x [0,1.6] box. 0 at top-left of glyph.
float digitSDF(vec2 p, float id, float th) {
    float d = 1e3;
    float n = floor(mod(id, 10.0) + 0.5);

    vec2 A = vec2(0.15, 1.45);
    vec2 B = vec2(0.85, 1.45);
    vec2 C = vec2(0.85, 0.80);
    vec2 D = vec2(0.85, 0.15);
    vec2 E = vec2(0.15, 0.15);
    vec2 F = vec2(0.15, 0.80);
    vec2 G1 = vec2(0.18, 0.80);
    vec2 G2 = vec2(0.82, 0.80);

    // 7-seg mask via thresholds (0-9).
    // bits: 0 top, 1 UR, 2 LR, 3 bot, 4 LL, 5 UL, 6 mid
    float bits = 0.0;
    if (n < 0.5) bits = 63.0;           // 0: 1111110
    else if (n < 1.5) bits = 6.0;       // 1: 0110000
    else if (n < 2.5) bits = 91.0;      // 2: 1101101
    else if (n < 3.5) bits = 79.0;      // 3: 1111001
    else if (n < 4.5) bits = 102.0;     // 4: 0110011
    else if (n < 5.5) bits = 109.0;     // 5: 1011011
    else if (n < 6.5) bits = 125.0;     // 6: 1011111
    else if (n < 7.5) bits = 7.0;       // 7: 1110000
    else if (n < 8.5) bits = 127.0;     // 8: 1111111
    else bits = 111.0;                  // 9: 1111011

    if (mod(bits, 2.0) > 0.5) d = min(d, sdSeg(p, A, B, th));
    if (mod(floor(bits / 2.0), 2.0) > 0.5) d = min(d, sdSeg(p, B, C, th));
    if (mod(floor(bits / 4.0), 2.0) > 0.5) d = min(d, sdSeg(p, C, D, th));
    if (mod(floor(bits / 8.0), 2.0) > 0.5) d = min(d, sdSeg(p, D, E, th));
    if (mod(floor(bits / 16.0), 2.0) > 0.5) d = min(d, sdSeg(p, E, F, th));
    if (mod(floor(bits / 32.0), 2.0) > 0.5) d = min(d, sdSeg(p, F, A, th));
    if (mod(floor(bits / 64.0), 2.0) > 0.5) d = min(d, sdSeg(p, G1, G2, th));

    // Digit 1 is just the right stem — shift it left a touch for balance.
    if (n > 0.5 && n < 1.5) {
        d = min(sdSeg(p, vec2(0.55, 1.45), vec2(0.55, 0.15), th),
                sdSeg(p, vec2(0.55, 1.45), vec2(0.32, 1.22), th));
    }
    return d;
}

float numberSDF(vec2 p, float n0, float n1, float n2, float n3, float digits, float th) {
    float d = 1e3;
    float w = 0.92;
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
    vec2 res = max(u_resolution, vec2(1.0));
    vec2 uv = v_uv * vec2(res.x / res.y, 1.0);
    float t = u_time * max(u_speed, 0.0);
    float drift = max(u_drift, 0.0);

    float sc = max(u_scale, 4.0);
    vec2 field = uv * sc;
    field += vec2(t * drift * 0.07, t * drift * -0.045);

    float dens = clamp(u_density, 0.0, 1.0);
    float contrast = clamp(u_contrast, 0.0, 1.0);

    float best = 1e3;
    float bestW = 0.0;

    // 3x3 neighborhood so numbers can sit off-cell.
    for (float j = -1.0; j <= 1.0; j += 1.0) {
        for (float i = -1.0; i <= 1.0; i += 1.0) {
            vec2 cell = floor(field) + vec2(i, j);
            vec2 rnd = hash22(cell);
            if (rnd.x > dens * 0.72 + 0.08) continue;

            vec2 jitter = hash22(cell + 3.1);
            vec2 pos = cell + vec2(0.08, 0.12) + jitter * vec2(0.35, 0.42);

            // Occasional rewrite flicker.
            float life = hash21(cell + floor(t * (0.35 + rnd.y)));
            if (life < 0.08) continue;

            float digits = rnd.y > 0.35 ? 4.0 : 3.0;
            float seed = hash21(cell + 9.4) * 10000.0;
            float n0 = floor(mod(seed / 1000.0, 10.0));
            float n1 = floor(mod(seed / 100.0, 10.0));
            float n2 = floor(mod(seed / 10.0, 10.0));
            float n3 = floor(mod(seed, 10.0));

            float th = mix(0.06, 0.085, hash21(cell + 2.2));
            // Keep the glyph well inside the cell so clusters do not collide.
            vec2 lp = (field - pos) * vec2(6.2, 6.8);
            float d = numberSDF(lp, n0, n1, n2, n3, digits, th);

            // Weight: most pale, a few near-black (matches the still).
            float w = hash21(cell + 5.5);
            w = mix(0.12, 1.0, pow(w, mix(1.8, 0.7, contrast)));

            if (d < best) {
                best = d;
                bestW = w;
            }
        }
    }

    float aa = 0.04;
    float ink = 1.0 - smoothstep(-aa, aa, best);
    vec3 col = mix(u_paper, u_ink, ink * bestW);

    gl_FragColor = vec4(col, 1.0);
}
