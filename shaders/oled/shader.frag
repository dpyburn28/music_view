// Final postprocess: OLED cinema panel.
// Built-in: u_time, u_resolution, v_uv
// Required: u_scene

uniform sampler2D u_scene;
uniform float u_black;
uniform float u_contrast;
uniform float u_brightness;
uniform float u_saturation;
uniform float u_bloom;
uniform float u_pixel;
uniform float u_vignette;
uniform float u_warmth;
uniform float u_intensity;

float luma(vec3 c) {
    return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

void main() {
    vec2 uv = v_uv;
    vec3 original = texture2D(u_scene, uv).rgb;
    float mixAmt = clamp(u_intensity, 0.0, 1.0);

    vec3 col = original;

    // Crush near-blacks to pure black (OLED infinite contrast feel)
    float crush = clamp(u_black, 0.0, 1.0);
    float L = luma(col);
    float blackGate = smoothstep(0.0, mix(0.02, 0.18, crush), L);
    col *= mix(blackGate, 1.0, 1.0 - crush * 0.85);
    // Extra floor kill
    col = max(col - crush * 0.04, 0.0);

    // Contrast around mid-greys
    col = (col - 0.5) * max(u_contrast, 0.01) + 0.5;
    col *= max(u_brightness, 0.0);

    // Saturation
    float l2 = luma(col);
    col = mix(vec3(l2), col, max(u_saturation, 0.0));

    // Warmth shift
    float w = u_warmth;
    col.r += w * 0.08;
    col.b -= w * 0.08;

    // Subtle highlight bloom
    float bloom = max(u_bloom, 0.0);
    if (bloom > 0.001) {
        vec2 px = 2.0 / max(u_resolution, vec2(1.0));
        vec3 b =
            texture2D(u_scene, uv + vec2(px.x, 0.0)).rgb +
            texture2D(u_scene, uv - vec2(px.x, 0.0)).rgb +
            texture2D(u_scene, uv + vec2(0.0, px.y)).rgb +
            texture2D(u_scene, uv - vec2(0.0, px.y)).rgb;
        b *= 0.25;
        float hi = smoothstep(0.55, 0.95, luma(b));
        col = mix(col, max(col, b * 1.1), bloom * hi);
    }

    // Very fine pixel structure (barely there)
    float pix = clamp(u_pixel, 0.0, 1.0);
    if (pix > 0.001) {
        vec2 p = fract(uv * u_resolution * 0.5);
        float grid = smoothstep(0.0, 0.08, p.x) * smoothstep(0.0, 0.08, p.y)
                   * smoothstep(0.0, 0.08, 1.0 - p.x) * smoothstep(0.0, 0.08, 1.0 - p.y);
        // Subpixel hint
        float tri = mod(floor(uv.x * u_resolution.x), 3.0);
        vec3 m = vec3(1.0);
        if (tri < 0.5) m = vec3(1.05, 0.97, 0.97);
        else if (tri < 1.5) m = vec3(0.97, 1.05, 0.97);
        else m = vec3(0.97, 0.97, 1.05);
        col *= mix(vec3(1.0), m * mix(1.0, grid, 0.5), pix * 0.5);
    }

    // Soft corner falloff (not heavy CRT vignette)
    float vig = clamp(u_vignette, 0.0, 1.0);
    if (vig > 0.001) {
        vec2 vc = uv * 2.0 - 1.0;
        // Superellipse-ish corners
        float e = pow(abs(vc.x), 3.0) + pow(abs(vc.y), 3.0);
        float v = 1.0 - smoothstep(0.7, 1.35, e) * vig;
        col *= clamp(v, 0.0, 1.0);
    }

    col = clamp(col, 0.0, 1.0);
    gl_FragColor = vec4(mix(original, col, mixAmt), 1.0);
}
