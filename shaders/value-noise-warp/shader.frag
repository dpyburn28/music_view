// Utility: multi-scale value-noise UV warp (cheaper cousin of warp-noise with octaves).
uniform sampler2D u_scene;
uniform float u_strength;
uniform float u_scale;
uniform float u_octaves;
uniform float u_speed;
uniform float u_intensity;

float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p, float octs) {
    float v = 0.0;
    float a = 0.5;
    float s = 0.0;
    for (float i = 0.0; i < 5.0; i += 1.0) {
        if (i >= octs - 0.01) break;
        v += a * vnoise(p);
        s += a;
        p *= 2.05;
        a *= 0.5;
    }
    return v / max(s, 0.0001);
}

void main() {
    vec3 original = texture2D(u_scene, v_uv).rgb;
    float m = clamp(u_intensity, 0.0, 1.0);
    float str = max(u_strength, 0.0) * m;
    if (str < 0.00001) {
        gl_FragColor = vec4(original, 1.0);
        return;
    }

    float sc = max(u_scale, 0.5);
    float octs = clamp(floor(u_octaves + 0.5), 1.0, 5.0);
    vec2 p = v_uv * sc + u_time * u_speed * 0.2;
    float n1 = fbm(p, octs);
    float n2 = fbm(p + 13.7, octs);
    vec2 uv = v_uv + (vec2(n1, n2) - 0.5) * str * 0.35;
    vec3 col = texture2D(u_scene, clamp(uv, 0.0, 1.0)).rgb;
    gl_FragColor = vec4(mix(original, col, m), 1.0);
}
