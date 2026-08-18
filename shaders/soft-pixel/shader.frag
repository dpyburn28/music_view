// Utility: soft pixelation (block sample with optional bilinear blend inside cell).
uniform sampler2D u_scene;
uniform float u_size;
uniform float u_soft;
uniform float u_snap;
uniform float u_intensity;

vec3 sampleScene(vec2 uv) {
    return texture2D(u_scene, clamp(uv, 0.0, 1.0)).rgb;
}

void main() {
    vec3 original = sampleScene(v_uv);
    float m = clamp(u_intensity, 0.0, 1.0);
    if (m < 0.0001) {
        gl_FragColor = vec4(original, 1.0);
        return;
    }

    float sz = max(u_size, 1.0);
    vec2 res = max(u_resolution, vec2(1.0));
    vec2 cell = floor(v_uv * res / sz);
    vec2 local = fract(v_uv * res / sz);
    vec2 center = (cell + 0.5) * sz / res;

    vec3 hard = sampleScene(center);
    // Soft: blend neighboring cells
    vec2 n = vec2(sz) / res;
    vec3 mixN =
        sampleScene(center) * 0.4 +
        sampleScene(center + vec2(n.x, 0.0)) * 0.15 +
        sampleScene(center - vec2(n.x, 0.0)) * 0.15 +
        sampleScene(center + vec2(0.0, n.y)) * 0.15 +
        sampleScene(center - vec2(0.0, n.y)) * 0.15;

    float soft = clamp(u_soft, 0.0, 1.0);
    // Interior falloff
    float edge = max(abs(local.x - 0.5), abs(local.y - 0.5)) * 2.0;
    vec3 col = mix(hard, mixN, soft * edge);

    // Color snap inside pixel
    float snap = max(u_snap, 0.0);
    if (snap > 0.5) {
        float levels = clamp(snap, 2.0, 24.0);
        col = floor(col * levels + 0.5) / levels;
    }

    gl_FragColor = vec4(mix(original, col, m), 1.0);
}
