// Utility: triangular PDF dither (better for gradients than uniform). Animated optional.
uniform sampler2D u_scene;
uniform float u_levels;
uniform float u_spread;
uniform float u_animate;
uniform float u_mono;
uniform float u_intensity;

float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

// Two uniform → triangular distribution in [-1,1]
float triNoise(vec2 p) {
    float a = hash21(p);
    float b = hash21(p + 19.2);
    return a - b;
}

void main() {
    vec3 original = texture2D(u_scene, v_uv).rgb;
    float m = clamp(u_intensity, 0.0, 1.0);
    if (m < 0.0001) {
        gl_FragColor = vec4(original, 1.0);
        return;
    }

    float levels = max(floor(u_levels + 0.5), 2.0);
    vec2 pix = floor(v_uv * u_resolution);
    if (u_animate > 0.001) pix += floor(u_time * u_animate * 48.0);

    float n = triNoise(pix);
    float off = n * 0.5 * u_spread / levels;

    vec3 base = mix(original, vec3(luma(original)), clamp(u_mono, 0.0, 1.0));
    vec3 q = floor((base + off) * levels + 0.5) / levels;
    gl_FragColor = vec4(mix(original, clamp(q, 0.0, 1.0), m), 1.0);
}
