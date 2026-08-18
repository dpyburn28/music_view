// Postprocess: threshold bloom (single-pass multi-tap).
// Built-in: u_time, u_resolution, v_uv
// Required: u_scene

uniform sampler2D u_scene;
uniform float u_threshold;
uniform float u_radius;
uniform float u_strength;
uniform float u_iterations;
uniform float u_intensity;

float luma(vec3 c) {
    return dot(c, vec3(0.299, 0.587, 0.114));
}

vec3 sampleScene(vec2 uv) {
    return texture2D(u_scene, clamp(uv, 0.0, 1.0)).rgb;
}

vec3 brightPass(vec3 c, float thr) {
    float l = luma(c);
    float w = max(l - thr, 0.0) / max(1.0 - thr, 0.0001);
    return c * w;
}

void main() {
    vec3 original = sampleScene(v_uv);
    float radius = max(u_radius, 0.25);
    float thr = clamp(u_threshold, 0.0, 0.99);
    float ringsF = clamp(floor(u_iterations + 0.5), 1.0, 4.0);

    // Center + cross/diagonal rings for soft glow without full Gaussian cost
    vec3 acc = brightPass(original, thr);
    float wsum = 1.0;

    for (float r = 1.0; r <= 4.0; r += 1.0) {
        if (r > ringsF + 0.5) break;
        float dist = radius * r;
        float w = 1.0 / (1.0 + r * 0.85);
        // Pixel radius → UV offset
        vec2 d = vec2(dist) / max(u_resolution, vec2(1.0));

        acc += brightPass(sampleScene(v_uv + vec2(d.x, 0.0)), thr) * w;
        acc += brightPass(sampleScene(v_uv - vec2(d.x, 0.0)), thr) * w;
        acc += brightPass(sampleScene(v_uv + vec2(0.0, d.y)), thr) * w;
        acc += brightPass(sampleScene(v_uv - vec2(0.0, d.y)), thr) * w;

        vec2 diag = d * 0.7071;
        acc += brightPass(sampleScene(v_uv + vec2(diag.x, diag.y)), thr) * w * 0.85;
        acc += brightPass(sampleScene(v_uv + vec2(-diag.x, diag.y)), thr) * w * 0.85;
        acc += brightPass(sampleScene(v_uv + vec2(diag.x, -diag.y)), thr) * w * 0.85;
        acc += brightPass(sampleScene(v_uv + vec2(-diag.x, -diag.y)), thr) * w * 0.85;

        wsum += w * 4.0 + w * 0.85 * 4.0;
    }

    vec3 bloom = acc / max(wsum, 0.0001);
    vec3 col = original + bloom * max(u_strength, 0.0);
    col = clamp(col, 0.0, 1.0);

    float m = clamp(u_intensity, 0.0, 1.0);
    gl_FragColor = vec4(mix(original, col, m), 1.0);
}
