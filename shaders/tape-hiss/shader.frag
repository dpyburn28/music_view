// Utility: analog tape hiss — high-freq noise + mild dropouts + HF emphasis.
uniform sampler2D u_scene;
uniform float u_amount;
uniform float u_dropout;
uniform float u_warmth;
uniform float u_speed;
uniform float u_intensity;

float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

void main() {
    vec3 original = texture2D(u_scene, v_uv).rgb;
    float m = clamp(u_intensity, 0.0, 1.0);
    float amt = max(u_amount, 0.0) * m;
    if (amt < 0.00001) {
        gl_FragColor = vec4(original, 1.0);
        return;
    }

    float t = floor(u_time * max(u_speed, 0.0) * 48.0);
    vec2 pix = floor(v_uv * u_resolution);
    float n = hash21(pix + t);
    float n2 = hash21(pix * 1.7 + t + 3.0);

    // Fine hiss
    vec3 col = original + (n - 0.5) * amt * 0.35;
    // Warmth: bias noise toward brown/orange
    col += vec3(0.04, 0.02, 0.0) * (n2 - 0.5) * clamp(u_warmth, 0.0, 1.0) * amt;

    // Sparse dropouts (volume dips)
    float drop = step(1.0 - clamp(u_dropout, 0.0, 1.0) * 0.08, hash21(vec2(floor(v_uv.y * 40.0), t)));
    col *= 1.0 - drop * 0.55 * amt;

    // Slight HF lift of noise on midtones
    float l = luma(original);
    col += (n - 0.5) * amt * 0.12 * (1.0 - abs(l - 0.5) * 2.0);

    gl_FragColor = vec4(mix(original, clamp(col, 0.0, 1.0), m), 1.0);
}
