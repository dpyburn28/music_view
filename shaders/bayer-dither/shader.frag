// Utility: 8×8 ordered Bayer dither with levels / mono controls.
uniform sampler2D u_scene;
uniform float u_levels;
uniform float u_spread;
uniform float u_pixelSize;
uniform float u_mono;
uniform float u_intensity;

float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

// 4×4 Bayer threshold in 0–1 (algebraic, no matrix index)
float bayer4(vec2 p) {
    vec2 q = mod(floor(p), 4.0);
    vec4 sx = step(vec4(0.0, 1.0, 2.0, 3.0), vec4(q.x)) * step(vec4(q.x), vec4(0.0, 1.0, 2.0, 3.0));
    vec4 sy = step(vec4(0.0, 1.0, 2.0, 3.0), vec4(q.y)) * step(vec4(q.y), vec4(0.0, 1.0, 2.0, 3.0));
    vec4 c0 = vec4(0.0, 8.0, 2.0, 10.0) / 16.0;
    vec4 c1 = vec4(12.0, 4.0, 14.0, 6.0) / 16.0;
    vec4 c2 = vec4(3.0, 11.0, 1.0, 9.0) / 16.0;
    vec4 c3 = vec4(15.0, 7.0, 13.0, 5.0) / 16.0;
    return dot(c0 * sx.x + c1 * sx.y + c2 * sx.z + c3 * sx.w, sy);
}

// Recursive-style 8×8: combine two 4×4 scales
float bayer8(vec2 p) {
    float a = bayer4(p);
    float b = bayer4(p * 0.5 + 17.0);
    return fract(a * 0.75 + b * 0.25 + floor(mod(p.x, 8.0) / 4.0) * 0.015625);
}

void main() {
    vec3 original = texture2D(u_scene, v_uv).rgb;
    float m = clamp(u_intensity, 0.0, 1.0);
    if (m < 0.0001) {
        gl_FragColor = vec4(original, 1.0);
        return;
    }

    float levels = max(floor(u_levels + 0.5), 2.0);
    float ps = max(u_pixelSize, 1.0);
    vec2 pix = floor(v_uv * u_resolution / ps);
    float b = bayer8(pix);
    float off = (b - 0.5) * u_spread / levels;

    vec3 base = mix(original, vec3(luma(original)), clamp(u_mono, 0.0, 1.0));
    vec3 q = floor((base + off) * levels + 0.5) / levels;
    gl_FragColor = vec4(mix(original, clamp(q, 0.0, 1.0), m), 1.0);
}
