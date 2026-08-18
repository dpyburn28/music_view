// Utility: neighborhood error-diffusion style dither (FS-inspired, single-pass approx).
// Built-in: u_time, u_resolution, v_uv · Required: u_scene

uniform sampler2D u_scene;
uniform float u_levels;
uniform float u_strength;
uniform float u_pixelSize;
uniform float u_mono;
uniform float u_intensity;

float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

vec3 sampleScene(vec2 uv) {
    return texture2D(u_scene, clamp(uv, 0.0, 1.0)).rgb;
}

vec3 quantize(vec3 c, float levels) {
    return floor(c * levels + 0.5) / levels;
}

void main() {
    vec3 original = sampleScene(v_uv);
    float m = clamp(u_intensity, 0.0, 1.0);
    if (m < 0.0001) {
        gl_FragColor = vec4(original, 1.0);
        return;
    }

    float levels = max(floor(u_levels + 0.5), 2.0);
    float px = max(u_pixelSize, 1.0);
    vec2 stepUv = vec2(px) / max(u_resolution, vec2(1.0));

    // Sample causal neighbors (left, up-left, up, up-right) like FS diffusion
    vec3 c  = original;
    vec3 cl = sampleScene(v_uv - vec2(stepUv.x, 0.0));
    vec3 cu = sampleScene(v_uv + vec2(0.0, stepUv.y));
    vec3 cul = sampleScene(v_uv + vec2(-stepUv.x, stepUv.y));
    vec3 cur = sampleScene(v_uv + vec2(stepUv.x, stepUv.y));

    float mono = clamp(u_mono, 0.0, 1.0);
    c = mix(c, vec3(luma(c)), mono);
    cl = mix(cl, vec3(luma(cl)), mono);
    cu = mix(cu, vec3(luma(cu)), mono);
    cul = mix(cul, vec3(luma(cul)), mono);
    cur = mix(cur, vec3(luma(cur)), mono);

    vec3 ql = quantize(cl, levels);
    vec3 qu = quantize(cu, levels);
    vec3 qul = quantize(cul, levels);
    vec3 qur = quantize(cur, levels);

    // Errors from neighbors push this pixel
    vec3 err =
        (cl - ql) * (7.0 / 16.0) +
        (cur - qur) * (3.0 / 16.0) +
        (cu - qu) * (5.0 / 16.0) +
        (cul - qul) * (1.0 / 16.0);

    vec3 adjusted = c + err * max(u_strength, 0.0);
    vec3 col = quantize(clamp(adjusted, 0.0, 1.0), levels);

    gl_FragColor = vec4(mix(original, col, m), 1.0);
}
