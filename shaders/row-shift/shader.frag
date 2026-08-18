// Utility: per-row (scanline) horizontal offsets driven by noise — pure slice utility.
uniform sampler2D u_scene;
uniform float u_amount;
uniform float u_frequency;
uniform float u_speed;
uniform float u_smooth;
uniform float u_intensity;

float hash11(float n) { return fract(sin(n) * 43758.5453123); }

void main() {
    vec3 original = texture2D(u_scene, v_uv).rgb;
    float m = clamp(u_intensity, 0.0, 1.0);
    float amt = max(u_amount, 0.0) * m;
    if (amt < 0.00001) {
        gl_FragColor = vec4(original, 1.0);
        return;
    }

    float freq = max(u_frequency, 1.0);
    float row = floor(v_uv.y * freq);
    float t = floor(u_time * max(u_speed, 0.0));
    float n = hash11(row + t * 13.0);
    float n2 = hash11(row * 1.7 + t);

    float shift = (n - 0.5) * 2.0 * amt * 0.12;
    if (u_smooth > 0.5) {
        float nB = hash11(row + 1.0 + t * 13.0);
        float f = fract(v_uv.y * freq);
        shift = mix((n - 0.5), (nB - 0.5), f) * 2.0 * amt * 0.12;
    }

    // Occasional big jumps
    shift += step(0.94, n2) * (n2 - 0.5) * amt * 0.2;

    vec2 uv = vec2(clamp(v_uv.x + shift, 0.0, 1.0), v_uv.y);
    vec3 col = texture2D(u_scene, uv).rgb;
    gl_FragColor = vec4(mix(original, col, m), 1.0);
}
