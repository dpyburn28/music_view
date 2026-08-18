// Postprocess: soft-knee highlight clamp.
uniform sampler2D u_scene;
uniform float u_knee;
uniform float u_strength;
uniform float u_intensity;

void main() {
    vec3 original = texture2D(u_scene, v_uv).rgb;
    float knee = clamp(u_knee, 0.05, 0.99);
    float str = clamp(u_strength, 0.0, 1.0);

    vec3 col = original;
    // Soft compress values above knee toward 1.0
    vec3 over = max(col - knee, 0.0);
    float range = max(1.0 - knee, 0.0001);
    vec3 compressed = knee + over / (1.0 + over / range * str * 4.0);
    col = mix(col, compressed, str);
    col = clamp(col, 0.0, 1.0);

    float m = clamp(u_intensity, 0.0, 1.0);
    gl_FragColor = vec4(mix(original, col, m), 1.0);
}
