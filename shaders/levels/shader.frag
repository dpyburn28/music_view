// Postprocess: lift–gamma–gain levels.
// Built-in: u_time, u_resolution, v_uv
// Required: u_scene

uniform sampler2D u_scene;
uniform float u_lift;
uniform float u_gamma;
uniform float u_gain;
uniform float u_intensity;

void main() {
    vec3 original = texture2D(u_scene, v_uv).rgb;
    vec3 col = original;

    // Lift (add shadows)
    col = col + u_lift;
    col = max(col, vec3(0.0));

    // Gamma (midtones): pow(x, 1/gamma)
    float g = max(u_gamma, 0.05);
    float invG = 1.0 / g;
    col = pow(col, vec3(invG));

    // Gain (highlights)
    col *= max(u_gain, 0.0);

    col = clamp(col, 0.0, 1.0);
    float m = clamp(u_intensity, 0.0, 1.0);
    gl_FragColor = vec4(mix(original, col, m), 1.0);
}
