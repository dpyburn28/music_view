// Utility: multi-octave FBM noise overlay (add / multiply / soft-light blend modes).
// Built-in: u_time, u_resolution, v_uv · Required: u_scene

uniform sampler2D u_scene;
uniform float u_amount;
uniform float u_scale;
uniform float u_octaves;
uniform float u_speed;
uniform float u_mode;
uniform float u_mono;
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

float fbm(vec2 p, float octs) {
    float v = 0.0;
    float a = 0.5;
    float sum = 0.0;
    for (float i = 0.0; i < 6.0; i += 1.0) {
        if (i >= octs - 0.01) break;
        v += a * noise(p);
        sum += a;
        p *= 2.02;
        a *= 0.5;
    }
    return v / max(sum, 0.0001);
}

void main() {
    vec3 original = texture2D(u_scene, v_uv).rgb;
    float m = clamp(u_intensity, 0.0, 1.0) * clamp(u_amount, 0.0, 2.0);
    if (m < 0.0001) {
        gl_FragColor = vec4(original, 1.0);
        return;
    }

    float sc = max(u_scale, 0.5);
    float octs = clamp(floor(u_octaves + 0.5), 1.0, 6.0);
    vec2 p = v_uv * sc * (u_resolution.xy / min(u_resolution.x, u_resolution.y));
    p += vec2(u_time * u_speed * 0.15, u_time * u_speed * 0.11);

    float n = fbm(p, octs);
    float n2 = fbm(p + 17.3, octs);
    float n3 = fbm(p - 9.1, octs);
    vec3 noiseCol = mix(vec3(n, n2, n3), vec3(n), clamp(u_mono, 0.0, 1.0));

    // mode: 0 add, 1 multiply, 2 soft light, 3 overlay amount on luma
    float mode = floor(u_mode + 0.5);
    vec3 col = original;
    float amt = clamp(u_amount, 0.0, 2.0);

    if (mode < 0.5) {
        col = original + (noiseCol - 0.5) * amt;
    } else if (mode < 1.5) {
        col = original * mix(vec3(1.0), noiseCol * 2.0, clamp(amt, 0.0, 1.0));
    } else if (mode < 2.5) {
        // soft light
        vec3 b = noiseCol;
        col = mix(
            2.0 * original * b + original * original * (1.0 - 2.0 * b),
            sqrt(original) * (2.0 * b - 1.0) + 2.0 * original * (1.0 - b),
            step(0.5, b)
        );
        col = mix(original, col, clamp(amt, 0.0, 1.0));
    } else {
        col = original + (n - 0.5) * amt * (0.5 + original);
    }

    col = clamp(col, 0.0, 1.0);
    gl_FragColor = vec4(mix(original, col, clamp(u_intensity, 0.0, 1.0)), 1.0);
}
