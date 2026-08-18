// Final postprocess: LED matrix / scoreboard.
// Built-in: u_time, u_resolution, v_uv
// Required: u_scene

uniform sampler2D u_scene;
uniform float u_pitch;
uniform float u_dot_size;
uniform float u_shape;
uniform float u_glow;
uniform float u_levels;
uniform float u_gap;
uniform float u_brightness;
uniform vec3 u_tint;
uniform vec3 u_bg;
uniform float u_intensity;

void main() {
    vec2 uv = v_uv;
    vec3 original = texture2D(u_scene, uv).rgb;
    float mixAmt = clamp(u_intensity, 0.0, 1.0);

    float pitch = max(u_pitch, 2.0);
    vec2 frag = uv * u_resolution;
    vec2 cell = floor(frag / pitch);
    vec2 cellUV = fract(frag / pitch); // 0..1 in cell
    vec2 centerUV = (cell + 0.5) * pitch / u_resolution;

    vec3 sampleCol = texture2D(u_scene, clamp(centerUV, 0.0, 1.0)).rgb;

    // Quantize brightness steps (LED drive levels)
    float levels = max(floor(u_levels + 0.5), 2.0);
    sampleCol = floor(sampleCol * levels + 0.5) / levels;

    // Dot shape mask
    float size = clamp(u_dot_size, 0.05, 1.0);
    float mask;
    if (u_shape < 0.5) {
        // Round LED
        float d = distance(cellUV, vec2(0.5));
        float r = 0.5 * size;
        mask = 1.0 - smoothstep(r * 0.85, r, d);
        // Soft glow halo
        float glow = clamp(u_glow, 0.0, 1.0);
        if (glow > 0.001) {
            float halo = 1.0 - smoothstep(r, r + 0.35 * glow, d);
            mask = max(mask, halo * glow * 0.55);
        }
    } else {
        // Square module
        vec2 q = abs(cellUV - 0.5);
        float halfSz = 0.5 * size;
        float edge = 0.02 + (1.0 - clamp(u_glow, 0.0, 1.0)) * 0.04;
        mask = (1.0 - smoothstep(halfSz, halfSz + edge, q.x))
             * (1.0 - smoothstep(halfSz, halfSz + edge, q.y));
    }

    float gapDark = clamp(u_gap, 0.0, 1.0);
    vec3 board = u_bg;
    vec3 led = sampleCol * u_tint * max(u_brightness, 0.0);
    // Boost so sparse LEDs still punch
    led *= 1.0 + (1.0 - size) * 0.35;

    vec3 col = mix(board, led, mask);
    // Darken residual board when gap is strong
    col = mix(col, mix(board, col, 1.0 - gapDark * 0.15), 1.0);

    col = clamp(col, 0.0, 1.0);
    gl_FragColor = vec4(mix(original, col, mixAmt), 1.0);
}
