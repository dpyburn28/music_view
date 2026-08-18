// Final postprocess: LCD panel emulation.
// Built-in: u_time, u_resolution, v_uv
// Required: u_scene (sampler2D of the captured frame)
// Declared uniforms are driven by controls.json

uniform sampler2D u_scene;

uniform float u_pixel_size;
uniform float u_pixel_aspect;
uniform float u_grid_gap;
uniform float u_subpixel;
uniform float u_subpixel_mode;
uniform float u_scanline;
uniform float u_scanline_soft;
uniform float u_brightness;
uniform float u_contrast;
uniform float u_saturation;
uniform float u_backlight;
uniform float u_bloom;
uniform float u_bleed;
uniform float u_curvature;
uniform float u_vignette;
uniform float u_edge_mask;
uniform float u_sharpness;
uniform float u_flicker;
uniform float u_noise;
uniform vec3 u_tint;
uniform float u_black_level;
uniform float u_intensity;

float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

// Barrel-style UV warp for a gently curved panel
vec2 curveUV(vec2 uv, float amount) {
    if (amount <= 0.0001) return uv;
    vec2 c = uv * 2.0 - 1.0;
    float r2 = dot(c, c);
    c *= 1.0 + amount * r2;
    // slight extra squeeze so corners stay in frame
    c *= 1.0 / (1.0 + amount * 0.55);
    return c * 0.5 + 0.5;
}

// Soft hard-step: 0 = soft pixels, 1 = crisp cell edges
float cellSoft(float f, float sharpness) {
    float w = mix(0.45, 0.02, clamp(sharpness, 0.0, 1.0));
    return smoothstep(0.0, w, f) * (1.0 - smoothstep(1.0 - w, 1.0, f));
}

vec3 sampleScene(vec2 uv) {
    return texture2D(u_scene, clamp(uv, 0.0, 1.0)).rgb;
}

vec3 adjustContrast(vec3 c, float contrast) {
    return (c - 0.5) * contrast + 0.5;
}

vec3 adjustSaturation(vec3 c, float sat) {
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    return mix(vec3(l), c, sat);
}

void main() {
    vec2 uv = v_uv;
    float mixAmt = clamp(u_intensity, 0.0, 1.0);

    // Original (for dry/wet mix)
    vec3 original = sampleScene(uv);

    // Curved panel coordinates
    float curve = max(u_curvature, 0.0);
    vec2 cuv = curveUV(uv, curve);

    // Outside curved panel → black bezel
    float inPanel = step(0.0, cuv.x) * step(cuv.x, 1.0) * step(0.0, cuv.y) * step(cuv.y, 1.0);
    // Soft edge falloff near bezel
    float edge = min(min(cuv.x, 1.0 - cuv.x), min(cuv.y, 1.0 - cuv.y));
    float edgeFade = smoothstep(0.0, 0.04 * max(u_edge_mask, 0.001), edge);
    edgeFade = mix(1.0, edgeFade, clamp(u_edge_mask, 0.0, 1.0));

    // Pixel grid in screen space (stable with resolution)
    float px = max(u_pixel_size, 1.0);
    float aspect = max(u_pixel_aspect, 0.05);
    vec2 cellSize = vec2(px * aspect, px);
    vec2 fragPx = cuv * u_resolution;
    vec2 cellId = floor(fragPx / cellSize);
    vec2 cellUV = fract(fragPx / cellSize); // 0..1 within cell

    // Quantized sample UV at cell center (with optional soft snap)
    vec2 cellCenterPx = (cellId + 0.5) * cellSize;
    vec2 quantUV = cellCenterPx / u_resolution;
    // Blend quantized vs continuous for sharpness control
    vec2 sampleUV = mix(cuv, quantUV, clamp(u_sharpness, 0.0, 1.0) * 0.92 + 0.08);

    // Color bleed: slight channel offsets in subpixel direction
    float bleed = max(u_bleed, 0.0);
    vec2 bleedOff = vec2(bleed * cellSize.x / u_resolution.x, 0.0);
    float mode = floor(u_subpixel_mode + 0.5);
    if (mode > 1.5) {
        bleedOff = vec2(0.0, bleed * cellSize.y / u_resolution.y);
    }

    vec3 col;
    col.r = sampleScene(sampleUV + bleedOff).r;
    col.g = sampleScene(sampleUV).g;
    col.b = sampleScene(sampleUV - bleedOff).b;

    // Soft bloom from neighboring cells
    float bloomAmt = max(u_bloom, 0.0);
    if (bloomAmt > 0.001) {
        vec2 o = cellSize / u_resolution;
        vec3 b =
            sampleScene(sampleUV + vec2(o.x, 0.0)) +
            sampleScene(sampleUV - vec2(o.x, 0.0)) +
            sampleScene(sampleUV + vec2(0.0, o.y)) +
            sampleScene(sampleUV - vec2(0.0, o.y));
        b *= 0.25;
        col = mix(col, max(col, b), bloomAmt);
    }

    // RGB subpixel stripes
    float sub = clamp(u_subpixel, 0.0, 1.0);
    vec3 mask = vec3(1.0);
    if (sub > 0.001) {
        float t;
        if (mode < 0.5) {
            // Horizontal RGB (classic LCD)
            t = cellUV.x;
            if (t < 0.333) mask = vec3(1.0, 0.12, 0.08);
            else if (t < 0.666) mask = vec3(0.1, 1.0, 0.1);
            else mask = vec3(0.08, 0.12, 1.0);
        } else if (mode < 1.5) {
            // Horizontal BGR
            t = cellUV.x;
            if (t < 0.333) mask = vec3(0.08, 0.12, 1.0);
            else if (t < 0.666) mask = vec3(0.1, 1.0, 0.1);
            else mask = vec3(1.0, 0.12, 0.08);
        } else {
            // Vertical RGB
            t = cellUV.y;
            if (t < 0.333) mask = vec3(1.0, 0.12, 0.08);
            else if (t < 0.666) mask = vec3(0.1, 1.0, 0.1);
            else mask = vec3(0.08, 0.12, 1.0);
        }
        // Keep some luminance so image doesn't go pure monochrome per stripe
        mask = mix(vec3(1.0), mask, sub);
        col *= mask;
        // Compensate average luminance loss from mask
        col *= mix(1.0, 1.55, sub * 0.65);
    }

    // Gap / black matrix between pixels
    float gap = clamp(u_grid_gap, 0.0, 0.9);
    float gx = cellSoft(cellUV.x, u_sharpness);
    float gy = cellSoft(cellUV.y, u_sharpness);
    // Shrink active area by gap
    float halfGap = gap * 0.5;
    float ax = smoothstep(halfGap, halfGap + 0.08 * (1.0 - u_sharpness * 0.7), cellUV.x)
             * (1.0 - smoothstep(1.0 - halfGap - 0.08 * (1.0 - u_sharpness * 0.7), 1.0 - halfGap, cellUV.x));
    float ay = smoothstep(halfGap, halfGap + 0.08 * (1.0 - u_sharpness * 0.7), cellUV.y)
             * (1.0 - smoothstep(1.0 - halfGap - 0.08 * (1.0 - u_sharpness * 0.7), 1.0 - halfGap, cellUV.y));
    float aperture = mix(1.0, ax * ay, gap > 0.001 ? 1.0 : 0.0);
    // When gap is 0, still use soft cell falloff slightly for definition
    aperture = mix(mix(1.0, gx * gy, 0.15), aperture, clamp(gap * 3.0, 0.0, 1.0));
    col *= aperture;

    // Horizontal scanlines (LCD row shading)
    float scan = clamp(u_scanline, 0.0, 1.0);
    if (scan > 0.001) {
        float soft = clamp(u_scanline_soft, 0.0, 1.0);
        float sy = cellUV.y;
        float line = sin(sy * 3.14159265);
        line = pow(abs(line), mix(8.0, 1.2, soft));
        float scanMul = mix(1.0 - scan * 0.85, 1.0, line);
        col *= scanMul;
    }

    // Backlight: lift darks slightly + warm ambient under grid
    float bl = max(u_backlight, 0.0);
    float black = max(u_black_level, 0.0);
    col = max(col, vec3(black));
    col += vec3(bl * 0.35) * (1.0 - aperture) + bl * 0.08;

    // Color grading
    col = adjustContrast(col, max(u_contrast, 0.01));
    col = adjustSaturation(col, max(u_saturation, 0.0));
    col *= max(u_brightness, 0.0);
    col *= u_tint;

    // Subtle refresh flicker
    float flick = max(u_flicker, 0.0);
    if (flick > 0.0001) {
        float f = 0.5 + 0.5 * sin(u_time * 62.0 + cellId.y * 0.1);
        col *= 1.0 - flick * (1.0 - f);
    }

    // Fine panel noise
    float nAmt = max(u_noise, 0.0);
    if (nAmt > 0.0001) {
        float n = hash21(cellId + floor(u_time * 24.0));
        col += (n - 0.5) * nAmt;
    }

    // Vignette
    float vig = clamp(u_vignette, 0.0, 1.0);
    if (vig > 0.001) {
        vec2 vc = cuv * 2.0 - 1.0;
        float v = 1.0 - dot(vc, vc) * 0.55 * vig;
        col *= clamp(v, 0.0, 1.0);
    }

    // Bezel / out-of-panel
    col *= inPanel * edgeFade;

    col = clamp(col, 0.0, 1.0);
    vec3 outc = mix(original, col, mixAmt);
    gl_FragColor = vec4(outc, 1.0);
}
