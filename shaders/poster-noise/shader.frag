// Utility: posterize + dither noise in one (quant + noise before quant).
uniform sampler2D u_scene;
uniform float u_levels;
uniform float u_noise;
uniform float u_animate;
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

    float levels = max(floor(u_levels + 0.5), 2.0);
    vec2 pix = floor(v_uv * u_resolution);
    if (u_animate > 0.001) pix += floor(u_time * u_animate * 30.0);
    float n = (hash21(pix) - 0.5) * u_noise / levels;
    vec3 q = floor((original + n) * levels + 0.5) / levels;
    gl_FragColor = vec4(mix(original, clamp(q, 0.0, 1.0), m), 1.0);
}
