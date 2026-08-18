// Postprocess: unsharp mask (center vs neighbor average).
// Built-in: u_time, u_resolution, v_uv
// Required: u_scene

uniform sampler2D u_scene;
uniform float u_amount;
uniform float u_radius;
uniform float u_intensity;

vec3 sampleScene(vec2 uv) {
    return texture2D(u_scene, clamp(uv, 0.0, 1.0)).rgb;
}

void main() {
    vec3 original = sampleScene(v_uv);
    vec2 d = vec2(max(u_radius, 0.25)) / max(u_resolution, vec2(1.0));

    vec3 blur =
        sampleScene(v_uv + vec2(d.x, 0.0)) +
        sampleScene(v_uv - vec2(d.x, 0.0)) +
        sampleScene(v_uv + vec2(0.0, d.y)) +
        sampleScene(v_uv - vec2(0.0, d.y)) +
        sampleScene(v_uv + vec2(d.x, d.y) * 0.707) +
        sampleScene(v_uv + vec2(-d.x, d.y) * 0.707) +
        sampleScene(v_uv + vec2(d.x, -d.y) * 0.707) +
        sampleScene(v_uv + vec2(-d.x, -d.y) * 0.707);
    blur *= 0.125;

    vec3 col = original + (original - blur) * max(u_amount, 0.0);
    col = clamp(col, 0.0, 1.0);
    float m = clamp(u_intensity, 0.0, 1.0);
    gl_FragColor = vec4(mix(original, col, m), 1.0);
}
