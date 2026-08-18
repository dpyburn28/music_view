// Postprocess: radial ripple warp.
// Built-in: u_time, u_resolution, v_uv
// Required: u_scene

uniform sampler2D u_scene;
uniform float u_amplitude;
uniform float u_frequency;
uniform float u_speed;
uniform float u_intensity;

void main() {
    vec3 original = texture2D(u_scene, v_uv).rgb;
    float m = clamp(u_intensity, 0.0, 1.0);
    float amp = max(u_amplitude, 0.0) * m;

    if (amp < 0.00001) {
        gl_FragColor = vec4(original, 1.0);
        return;
    }

    vec2 center = vec2(0.5);
    vec2 d = v_uv - center;
    // Aspect-correct radius so circles stay round
    float aspect = u_resolution.x / max(u_resolution.y, 1.0);
    vec2 da = vec2(d.x * aspect, d.y);
    float r = length(da);
    float wave = sin(r * max(u_frequency, 0.01) - u_time * u_speed);
    vec2 dir = r > 0.0001 ? normalize(d) : vec2(0.0);
    vec2 uv = v_uv + dir * wave * amp;

    vec3 col = texture2D(u_scene, clamp(uv, 0.0, 1.0)).rgb;
    // When mix < 1, blend warped with original (amp already scaled by m for identity at 0)
    col = mix(original, col, m);
    gl_FragColor = vec4(col, 1.0);
}
