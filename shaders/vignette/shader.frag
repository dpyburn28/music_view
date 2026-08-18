// Postprocess: circular / rounded vignette.
// Built-in: u_time, u_resolution, v_uv
// Required: u_scene

uniform sampler2D u_scene;
uniform float u_amount;
uniform float u_softness;
uniform float u_roundness;
uniform float u_invert;
uniform float u_intensity;

void main() {
    vec3 original = texture2D(u_scene, v_uv).rgb;
    vec3 col = original;

    // Aspect-correct UV from center
    vec2 uv = v_uv * 2.0 - 1.0;
    float aspect = u_resolution.x / max(u_resolution.y, 1.0);
    uv.x *= aspect;

    float roundness = max(u_roundness, 0.05);
    // Superellipse-ish: higher roundness → more circular distance metric
    vec2 a = abs(uv);
    float r = pow(pow(a.x, 2.0 * roundness) + pow(a.y, 2.0 * roundness), 1.0 / (2.0 * roundness));

    float soft = max(u_softness, 0.02);
    float inner = 1.0 - soft;
    float vig = smoothstep(1.0, inner, r);
    // vig = 1 at center, 0 at edges

    float amt = max(u_amount, 0.0);
    float inv = step(0.5, u_invert);

    // Dark edges: multiply by mix(1-amt, 1, vig)
    // Bright edges: add edge * amt
    float edge = 1.0 - vig;
    vec3 dark = col * mix(1.0, 1.0 - amt, edge);
    vec3 bright = col + vec3(edge * amt);
    col = mix(dark, bright, inv);

    col = clamp(col, 0.0, 1.0);
    float m = clamp(u_intensity, 0.0, 1.0);
    gl_FragColor = vec4(mix(original, col, m), 1.0);
}
