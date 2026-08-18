// Final postprocess: monochrome handheld LCD (Game Boy–style).
// Built-in: u_time, u_resolution, v_uv
// Required: u_scene

uniform sampler2D u_scene;
uniform float u_pixel_size;
uniform float u_levels;
uniform float u_dither;
uniform float u_grid;
uniform float u_contrast;
uniform float u_brightness;
uniform vec3 u_light;
uniform vec3 u_dark;
uniform float u_intensity;

float luma(vec3 c) {
    return dot(c, vec3(0.299, 0.587, 0.114));
}

// 4x4 Bayer matrix (0..1)
float bayer4(vec2 p) {
    // p in integer pixel coords
    float x = mod(p.x, 4.0);
    float y = mod(p.y, 4.0);
    float idx = y * 4.0 + x;
    // Classic Bayer values / 16
    if (idx < 0.5) return 0.0 / 16.0;
    if (idx < 1.5) return 8.0 / 16.0;
    if (idx < 2.5) return 2.0 / 16.0;
    if (idx < 3.5) return 10.0 / 16.0;
    if (idx < 4.5) return 12.0 / 16.0;
    if (idx < 5.5) return 4.0 / 16.0;
    if (idx < 6.5) return 14.0 / 16.0;
    if (idx < 7.5) return 6.0 / 16.0;
    if (idx < 8.5) return 3.0 / 16.0;
    if (idx < 9.5) return 11.0 / 16.0;
    if (idx < 10.5) return 1.0 / 16.0;
    if (idx < 11.5) return 9.0 / 16.0;
    if (idx < 12.5) return 15.0 / 16.0;
    if (idx < 13.5) return 7.0 / 16.0;
    if (idx < 14.5) return 13.0 / 16.0;
    return 5.0 / 16.0;
}

void main() {
    vec2 uv = v_uv;
    vec3 original = texture2D(u_scene, uv).rgb;
    float mixAmt = clamp(u_intensity, 0.0, 1.0);

    float px = max(u_pixel_size, 1.0);
    vec2 frag = uv * u_resolution;
    vec2 cell = floor(frag / px);
    vec2 cellUV = fract(frag / px);
    vec2 quantUV = (cell + 0.5) * px / u_resolution;

    vec3 sampleCol = texture2D(u_scene, clamp(quantUV, 0.0, 1.0)).rgb;
    float g = luma(sampleCol);

    // Contrast / brightness on greyscale
    g = (g - 0.5) * max(u_contrast, 0.01) + 0.5;
    g *= max(u_brightness, 0.0);
    g = clamp(g, 0.0, 1.0);

    // Ordered dither into discrete greys
    float levels = max(floor(u_levels + 0.5), 2.0);
    float dither = clamp(u_dither, 0.0, 1.0);
    float b = bayer4(cell);
    float gd = g + (b - 0.5) * dither / levels;
    gd = clamp(gd, 0.0, 1.0);
    float q = floor(gd * (levels - 1.0) + 0.5) / (levels - 1.0);

    // Map 0 = dark ink, 1 = light paper (LCD is reflective)
    vec3 col = mix(u_dark, u_light, q);

    // Pixel grid / black matrix
    float gap = clamp(u_grid, 0.0, 0.45);
    float halfGap = gap * 0.5;
    float aperture = smoothstep(halfGap, halfGap + 0.06, cellUV.x)
                   * (1.0 - smoothstep(1.0 - halfGap - 0.06, 1.0 - halfGap, cellUV.x))
                   * smoothstep(halfGap, halfGap + 0.06, cellUV.y)
                   * (1.0 - smoothstep(1.0 - halfGap - 0.06, 1.0 - halfGap, cellUV.y));
    // Darker seams like a real GB LCD
    col = mix(u_dark * 0.85, col, mix(1.0, aperture, gap > 0.001 ? 1.0 : 0.0));

    col = clamp(col, 0.0, 1.0);
    gl_FragColor = vec4(mix(original, col, mixAmt), 1.0);
}
