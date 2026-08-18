// Four-fold ink metaballs: distinct disks, dumbbells, corner capsules.
// Built-in: u_time, u_resolution, v_uv

uniform float u_size;
uniform float u_merge;
uniform float u_halo;
uniform float u_satellites;
uniform float u_invert;
uniform float u_speed;

float smin(float a, float b, float k) {
    float h = clamp(0.5 + 0.5 * (b - a) / max(k, 0.0001), 0.0, 1.0);
    return mix(b, a, h) - k * h * (1.0 - h);
}

float sdCircle(vec2 p, float r) {
    return length(p) - r;
}

float sdCapsule(vec2 p, vec2 a, vec2 b, float r) {
    vec2 pa = p - a;
    vec2 ba = b - a;
    float h = clamp(dot(pa, ba) / max(dot(ba, ba), 0.0001), 0.0, 1.0);
    return length(pa - ba * h) - r;
}

void main() {
    vec2 res = max(u_resolution, vec2(1.0));
    vec2 uv = (v_uv - 0.5) * vec2(res.x / res.y, 1.0);
    float t = u_time * max(u_speed, 0.0);

    float sc = max(u_size, 0.15);
    vec2 p = uv / sc;
    vec2 q = vec2(abs(p.x), abs(p.y));

    float kPair = mix(0.01, 0.09, clamp(u_merge, 0.0, 1.0));
    float orbit = t * 0.55;
    float pulse = 0.5 + 0.5 * sin(t * 0.85);

    // Isolated center disk.
    float d = sdCircle(p, 0.145 + 0.012 * sin(t * 0.7));

    // Horizontal pair: two circles that kiss into a short dumbbell, then a gap.
    float hx = 0.30 + 0.045 * sin(orbit + 0.4);
    float hr = mix(0.055, 0.07, pulse);
    float dH = smin(
        sdCircle(q - vec2(hx, 0.0), hr),
        sdCircle(q - vec2(hx * 0.62, 0.0), hr * 0.72),
        kPair
    );

    // Vertical peanut (two fused circles), then a gap before the far dots.
    float hy = 0.33 + 0.04 * sin(orbit + 2.1);
    float dV = smin(
        sdCircle(q - vec2(0.0, hy), hr * 0.9),
        sdCircle(q - vec2(0.0, hy * 0.70), hr * 0.82),
        max(kPair * 1.7, 0.05)
    );

    d = min(d, dH);
    d = min(d, dV);

    float sat = clamp(u_satellites, 0.0, 1.0);

    float midX = 0.50 + 0.03 * sin(orbit * 0.8);
    d = min(d, sdCircle(q - vec2(midX, 0.0), 0.036 * sat));
    d = min(d, sdCircle(q - vec2(0.0, 0.62 + 0.03 * sin(orbit)), 0.015 * sat));
    d = min(d, sdCircle(q - vec2(0.0, 0.78), 0.013 * sat));
    d = min(d, sdCircle(q - vec2(0.0, 0.92), 0.011 * sat));

    // Corner capsules — stay inside the portrait frame (x is the short axis).
    vec2 c0 = vec2(0.27, 0.54) * (1.0 + 0.04 * sin(t * 0.5));
    vec2 c1 = c0 + normalize(c0) * 0.07;
    float dCap = sdCapsule(q, c0, c1, 0.032 * sat);
    d = min(d, dCap);

    float haloW = mix(0.004, 0.04, clamp(u_halo, 0.0, 1.0));
    float ink = 1.0 - smoothstep(-0.0015, 0.0025, d);
    float halo = (1.0 - smoothstep(-0.0015, haloW, d)) * (1.0 - ink);
    float field = 1.0 - ink;
    field = mix(field, field * 0.7, halo);

    if (u_invert > 0.5) field = 1.0 - field;

    gl_FragColor = vec4(vec3(field), 1.0);
}
