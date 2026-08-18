// Utility: hard / soft luminance threshold with optional color map.
// Built-in: u_time, u_resolution, v_uv · Required: u_scene

uniform sampler2D u_scene;
uniform float u_level;
uniform float u_softness;
uniform float u_invert;
uniform vec3 u_low;
uniform vec3 u_high;
uniform float u_mode;
uniform float u_intensity;

float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

void main() {
    vec3 original = texture2D(u_scene, v_uv).rgb;
    float m = clamp(u_intensity, 0.0, 1.0);
    if (m < 0.0001) {
        gl_FragColor = vec4(original, 1.0);
        return;
    }

    float l = luma(original);
    float soft = max(u_softness, 0.0001);
    float thr = clamp(u_level, 0.0, 1.0);
    float mask = smoothstep(thr - soft, thr + soft, l);
    if (u_invert > 0.5) mask = 1.0 - mask;

    float mode = floor(u_mode + 0.5);
    vec3 col;
    if (mode < 0.5) {
        // Binary color map
        col = mix(u_low, u_high, mask);
    } else if (mode < 1.5) {
        // Keep image above threshold, fill below
        col = mix(u_low, original, mask);
    } else {
        // Soft punch: boost highs, crush lows toward colors
        col = mix(mix(original, u_low, 0.85), mix(original, u_high, 0.35), mask);
    }

    gl_FragColor = vec4(mix(original, col, m), 1.0);
}
