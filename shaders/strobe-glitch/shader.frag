// Utility: timed strobe invert / flash / freeze-noise bursts.
uniform sampler2D u_scene;
uniform float u_rate;
uniform float u_duty;
uniform float u_mode;
uniform float u_noise;
uniform float u_intensity;

float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

void main() {
    vec3 original = texture2D(u_scene, v_uv).rgb;
    float m = clamp(u_intensity, 0.0, 1.0);
    if (m < 0.0001) {
        gl_FragColor = vec4(original, 1.0);
        return;
    }

    float rate = max(u_rate, 0.05);
    float phase = fract(u_time * rate);
    float duty = clamp(u_duty, 0.02, 0.95);
    float on = step(phase, duty);

    float mode = floor(u_mode + 0.5);
    vec3 col = original;
    if (on > 0.5) {
        if (mode < 0.5) {
            col = 1.0 - original;
        } else if (mode < 1.5) {
            col = vec3(1.0);
        } else if (mode < 2.5) {
            col = vec3(0.0);
        } else {
            float n = hash21(v_uv * u_resolution + floor(u_time * rate * 10.0));
            col = mix(original, vec3(n), clamp(u_noise, 0.0, 1.0));
        }
    }

    gl_FragColor = vec4(mix(original, col, m * on + m * (1.0 - on) * 0.0), 1.0);
}
