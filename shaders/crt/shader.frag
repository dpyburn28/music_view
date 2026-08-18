// Final postprocess: CRT television.
// Built-in: u_time, u_resolution, v_uv
// Required: u_scene

uniform sampler2D u_scene;
uniform float u_curvature;
uniform float u_scanline;
uniform float u_mask;
uniform float u_mask_scale;
uniform float u_bloom;
uniform float u_brightness;
uniform float u_contrast;
uniform float u_vignette;
uniform float u_jitter;
uniform float u_aberration;
uniform vec3 u_tint;
uniform float u_intensity;

vec2 curveUV(vec2 uv, float amount) {
    if (amount <= 0.0001) return uv;
    vec2 c = uv * 2.0 - 1.0;
    float r2 = dot(c, c);
    c *= 1.0 + amount * r2;
    c *= 1.0 / (1.0 + amount * 0.55);
    return c * 0.5 + 0.5;
}

float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

vec3 sampleScene(vec2 uv) {
    return texture2D(u_scene, clamp(uv, 0.0, 1.0)).rgb;
}

void main() {
    vec2 uv = v_uv;
    vec3 original = sampleScene(uv);
    float mixAmt = clamp(u_intensity, 0.0, 1.0);

    float curve = max(u_curvature, 0.0);
    vec2 cuv = curveUV(uv, curve);

    // Horizontal jitter (unstable sync)
    float j = max(u_jitter, 0.0);
    if (j > 0.00001) {
        float n = hash21(vec2(floor(cuv.y * u_resolution.y), floor(u_time * 30.0)));
        cuv.x += (n - 0.5) * j * 2.0;
    }

    float inPanel = step(0.0, cuv.x) * step(cuv.x, 1.0) * step(0.0, cuv.y) * step(cuv.y, 1.0);

    // Chromatic aberration
    float ab = max(u_aberration, 0.0);
    vec2 dir = (cuv - 0.5);
    vec3 col;
    col.r = sampleScene(cuv + dir * ab).r;
    col.g = sampleScene(cuv).g;
    col.b = sampleScene(cuv - dir * ab).b;

    // Soft phosphor bloom
    float bloom = max(u_bloom, 0.0);
    if (bloom > 0.001) {
        vec2 px = 1.0 / max(u_resolution, vec2(1.0));
        vec3 b =
            sampleScene(cuv + vec2(px.x * 2.0, 0.0)) +
            sampleScene(cuv - vec2(px.x * 2.0, 0.0)) +
            sampleScene(cuv + vec2(0.0, px.y * 2.0)) +
            sampleScene(cuv - vec2(0.0, px.y * 2.0));
        b *= 0.25;
        col = mix(col, max(col, b * 1.15), bloom);
    }

    // RGB aperture grille / shadow mask
    float maskAmt = clamp(u_mask, 0.0, 1.0);
    if (maskAmt > 0.001) {
        float scale = max(u_mask_scale, 0.25);
        float tri = mod(floor(cuv.x * u_resolution.x * scale), 3.0);
        vec3 m = vec3(1.0);
        if (tri < 0.5) m = vec3(1.0, 0.15, 0.15);
        else if (tri < 1.5) m = vec3(0.15, 1.0, 0.15);
        else m = vec3(0.15, 0.15, 1.0);
        col *= mix(vec3(1.0), m, maskAmt);
        col *= mix(1.0, 1.45, maskAmt * 0.7);
    }

    // Scanlines
    float scan = clamp(u_scanline, 0.0, 1.0);
    if (scan > 0.001) {
        float line = sin(cuv.y * u_resolution.y * 3.14159265);
        line = pow(abs(line), 1.4);
        col *= mix(1.0 - scan * 0.85, 1.0, line);
    }

    // Contrast / brightness / tint
    col = (col - 0.5) * max(u_contrast, 0.01) + 0.5;
    col *= max(u_brightness, 0.0);
    col *= u_tint;

    // Vignette
    float vig = clamp(u_vignette, 0.0, 1.0);
    if (vig > 0.001) {
        vec2 vc = cuv * 2.0 - 1.0;
        float v = 1.0 - dot(vc, vc) * 0.55 * vig;
        col *= clamp(v, 0.0, 1.0);
    }

    col *= inPanel;
    col = clamp(col, 0.0, 1.0);
    gl_FragColor = vec4(mix(original, col, mixAmt), 1.0);
}
