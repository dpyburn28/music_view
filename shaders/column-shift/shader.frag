// Utility: per-column vertical offsets — vertical twin of row-shift.
uniform sampler2D u_scene;
uniform float u_amount;
uniform float u_frequency;
uniform float u_speed;
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
    float col = floor(v_uv.x * freq);
    float t = floor(u_time * max(u_speed, 0.0));
    float n = hash11(col + t * 11.0);
    float shift = (n - 0.5) * 2.0 * amt * 0.12;
    shift += step(0.95, hash11(col * 2.1 + t)) * (n - 0.5) * amt * 0.18;

    vec2 uv = vec2(v_uv.x, clamp(v_uv.y + shift, 0.0, 1.0));
    vec3 outc = texture2D(u_scene, uv).rgb;
    gl_FragColor = vec4(mix(original, outc, m), 1.0);
}
