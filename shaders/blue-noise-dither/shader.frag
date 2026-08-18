// Utility: blue-noise-ish ordered dither (IGN + multi-hash, not true blue noise table).
// Built-in: u_time, u_resolution, v_uv · Required: u_scene

uniform sampler2D u_scene;
uniform float u_levels;
uniform float u_spread;
uniform float u_scale;
uniform float u_animate;
uniform float u_mono;
uniform float u_intensity;

float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

// Interleaved gradient noise — good high-frequency dither
float ign(vec2 p) {
    return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}

float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

// Approximate blue-noise-like: blend IGN with jittered high-freq hash
float blueNoise(vec2 pix) {
    float a = ign(pix);
    float b = hash21(pix * 1.37 + 19.2);
    float c = ign(pix.yx * 1.11 + 7.3);
    return fract(a * 0.55 + b * 0.25 + c * 0.2);
}

void main() {
    vec3 original = texture2D(u_scene, v_uv).rgb;
    float m = clamp(u_intensity, 0.0, 1.0);
    if (m < 0.0001) {
        gl_FragColor = vec4(original, 1.0);
        return;
    }

    float levels = max(floor(u_levels + 0.5), 2.0);
    float sc = max(u_scale, 0.5);
    vec2 pix = floor(v_uv * u_resolution / sc);
    if (u_animate > 0.001) {
        pix += floor(u_time * u_animate * 60.0);
    }

    float n = blueNoise(pix);
    float off = (n - 0.5) * u_spread / levels;

    vec3 base = mix(original, vec3(luma(original)), clamp(u_mono, 0.0, 1.0));
    vec3 q = base + off;
    q = floor(q * levels + 0.5) / levels;
    q = clamp(q, 0.0, 1.0);

    gl_FragColor = vec4(mix(original, q, m), 1.0);
}
