// Utility: horizontal scanline-locked noise (stronger on lines, optional rolling).
uniform sampler2D u_scene;
uniform float u_amount;
uniform float u_lineDensity;
uniform float u_rolling;
uniform float u_mono;
uniform float u_intensity;

float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

void main() {
    vec3 original = texture2D(u_scene, v_uv).rgb;
    float m = clamp(u_intensity, 0.0, 1.0);
    float amt = max(u_amount, 0.0) * m;
    if (amt < 0.00001) {
        gl_FragColor = vec4(original, 1.0);
        return;
    }

    float dens = max(u_lineDensity, 1.0);
    float y = floor(v_uv.y * u_resolution.y / dens + u_time * u_rolling * 20.0);
    float x = floor(v_uv.x * u_resolution.x);
    float n = hash21(vec2(x, y));
    float n2 = hash21(vec2(x + 3.0, y + 7.0));
    float n3 = hash21(vec2(x + 11.0, y));
    vec3 noiseCol = mix(vec3(n), vec3(n, n2, n3), 1.0 - clamp(u_mono, 0.0, 1.0));

    // Stronger on alternating line groups
    float lineGate = 0.55 + 0.45 * step(0.5, fract(y * 0.5));
    vec3 col = original + (noiseCol - 0.5) * amt * lineGate;
    gl_FragColor = vec4(mix(original, clamp(col, 0.0, 1.0), m), 1.0);
}
