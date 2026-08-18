// Fine wormy B&W grain with a slow central vortex.
// Built-in: u_time, u_resolution, v_uv

uniform float u_scale;
uniform float u_contrast;
uniform float u_swirl;
uniform float u_warp;
uniform float u_vignette;
uniform float u_speed;

float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm2(vec2 p) {
    return 0.66 * noise(p) + 0.34 * noise(p * 2.07 + 3.1);
}

void main() {
    vec2 res = max(u_resolution, vec2(1.0));
    vec2 uv = (v_uv - 0.5) * vec2(res.x / res.y, 1.0);
    float t = u_time * max(u_speed, 0.0);

    float sc = max(u_scale, 1.0);
    float swirl = max(u_swirl, 0.0);
    float warp = max(u_warp, 0.0);

    float r = length(uv);
    float ang = atan(uv.y, uv.x);
    ang += swirl * 0.35 / (r * 2.4 + 0.4) + t * swirl * 0.08;
    vec2 p = vec2(cos(ang), sin(ang)) * r;

    vec2 q = p * sc * 1.8;
    q += vec2(t * 0.09, -t * 0.06);

    float n1 = fbm2(q * 0.7);
    float n2 = fbm2(q * 0.7 + 11.3);
    q += vec2(n2 - 0.5, n1 - 0.5) * warp * 1.15;

    // High-frequency ridged worms (not large oil-paint swirls).
    float g = fbm2(q * 5.5);
    float worms = sin(q.y * 22.0 + g * 12.0 + q.x * 3.0);
    float grain = fbm2(q * 9.0 + g);
    float field = 0.55 * worms + 0.45 * (grain * 2.0 - 1.0);
    field = 0.5 + 0.5 * field;

    float contrast = clamp(u_contrast, 0.0, 1.0);
    float lo = mix(0.32, 0.44, contrast);
    float hi = mix(0.68, 0.56, contrast);
    field = smoothstep(lo, hi, field);

    field += exp(-r * r * 3.2) * 0.08;
    float vig = mix(1.0, smoothstep(1.1, 0.22, r), clamp(u_vignette, 0.0, 1.0));
    field = clamp(field * vig, 0.0, 1.0);

    gl_FragColor = vec4(vec3(field), 1.0);
}
