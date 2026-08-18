// Postprocess: directional feedback smear (requires u_prev).
uniform sampler2D u_scene;
uniform sampler2D u_prev;
uniform float u_decay;
uniform float u_drift;
uniform float u_angle;
uniform float u_mix;
uniform float u_intensity;

void main() {
    vec3 scene = texture2D(u_scene, v_uv).rgb;

    float a = radians(u_angle);
    vec2 dir = vec2(cos(a), sin(a));
    // Aspect-correct drift
    float aspect = u_resolution.x / max(u_resolution.y, 1.0);
    dir.x /= aspect;
    vec2 puv = clamp(v_uv - dir * max(u_drift, 0.0), 0.0, 1.0);

    vec3 prev = texture2D(u_prev, puv).rgb;
    float decay = clamp(u_decay, 0.0, 0.98);
    float trailMix = clamp(u_mix, 0.0, 1.0);

    vec3 trailed = mix(scene, prev * decay, trailMix);
    vec3 col = max(trailed, scene);

    float m = clamp(u_intensity, 0.0, 1.0);
    gl_FragColor = vec4(mix(scene, clamp(col, 0.0, 1.0), m), 1.0);
}
