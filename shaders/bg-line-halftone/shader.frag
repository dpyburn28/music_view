// 1D vertical line-halftone of a scrolling 2D noise field.
// Built-in: u_time, u_resolution, v_uv  (do not redeclare)

uniform float u_density;
uniform float u_scale;
uniform float u_contrast;
uniform float u_invert;
uniform float u_speed;

float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

// Value-noise stand-in for Perlin (WebGL1, no derivatives required).
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

float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (float i = 0.0; i < 5.0; i += 1.0) {
        v += a * noise(p);
        p = p * 2.03 + vec2(1.7, 9.2);
        a *= 0.5;
    }
    return v;
}

void main() {
    vec2 res = max(u_resolution, vec2(1.0));
    vec2 uv = v_uv;
    vec2 uvN = vec2(uv.x * (res.x / res.y), uv.y);

    float t = u_time * max(u_speed, 0.0);
    float sc = max(u_scale, 0.2);

    // Animate the field along Y — fluid scroll.
    vec2 nUV = vec2(uvN.x, uvN.y + t * 0.12) * sc;
    float n = fbm(nUV);
    n = mix(n, fbm(nUV * 0.55 + 8.1), 0.35);

    float contrast = clamp(u_contrast, 0.0, 1.0);
    // Crush midtones so the field has solid masses + a thin line fringe.
    float lo = mix(0.32, 0.46, contrast);
    float hi = mix(0.68, 0.52, contrast);
    float noiseVal = smoothstep(lo, hi, n);

    // Vertical carrier: slider is approximate bar count across the frame.
    float lineDensity = max(u_density, 2.0);
    float carrier = 0.5 + 0.5 * sin(uv.x * 3.14159265 * lineDensity);

    // Halftone: local luma → variable-width vertical bars.
    float bit = step(carrier, noiseVal);

    if (u_invert > 0.5) bit = 1.0 - bit;

    gl_FragColor = vec4(vec3(bit), 1.0);
}
