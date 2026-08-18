// Postprocess: noise domain warp.
uniform sampler2D u_scene;
uniform float u_scale;
uniform float u_strength;
uniform float u_speed;
uniform float u_intensity;

float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

void main() {
    vec3 original = texture2D(u_scene, v_uv).rgb;
    float m = clamp(u_intensity, 0.0, 1.0);
    float str = max(u_strength, 0.0) * m;

    if (str < 0.00001) {
        gl_FragColor = vec4(original, 1.0);
        return;
    }

    float sc = max(u_scale, 0.1);
    vec2 p = v_uv * sc + vec2(u_time * u_speed, u_time * u_speed * 0.7);
    float n1 = noise(p);
    float n2 = noise(p + vec2(19.2, 7.1));
    vec2 uv = v_uv + (vec2(n1, n2) - 0.5) * str * 2.0;

    vec3 col = texture2D(u_scene, clamp(uv, 0.0, 1.0)).rgb;
    gl_FragColor = vec4(mix(original, col, m), 1.0);
}
