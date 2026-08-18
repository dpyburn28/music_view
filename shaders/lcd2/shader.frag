// Final postprocess: LCD Display (CJT-Jackton URP-style).
// Port of https://github.com/CJT-Jackton/URP-LCD-Dispaly-Example
// Algorithm (see also https://cjt-jackton.github.io/posts/shader-breakdown-lcd-display/):
//   1. Snap UVs to a virtual LCD pixel grid (pixelize with bilinear-friendly centers)
//   2. Multiply by an RGB subpixel mask + pixel-luma compensation (~4× for ~25% fill)
//   3. Fade pixelization / mask with a derivative-based LOD so distant/tiny pixels look normal
// Built-in: u_time, u_resolution, v_uv
// Required: u_scene

uniform sampler2D u_scene;

uniform float u_pixel_size;
uniform float u_pixel_luma;
uniform float u_pixel_layout;
uniform float u_layout_offset;
uniform float u_subpixel_gap;
uniform float u_row_gap;
uniform float u_mask_soft;
uniform float u_bgr;
uniform float u_lod_pix_lo;
uniform float u_lod_pix_hi;
uniform float u_lod_mask_lo;
uniform float u_lod_mask_hi;
uniform float u_force_pixels;
uniform float u_interlace;
uniform float u_interlace_speed;
uniform float u_brightness;
uniform vec3 u_tint;
uniform float u_intensity;

float remap01(float v, float lo, float hi) {
    return (v - lo) / max(hi - lo, 1e-5);
}

// ── Pixel layout coordinate helpers (from LCDDisplayCommon.hlsl) ─────────

void arrowCoordinate(inout vec2 uv, float offset, out vec2 cell) {
    uv.x += distance(fract(uv.y), 0.5) * offset;
    cell = floor(uv);
    cell += vec2(0.5 - 0.5 * offset, 0.5);
}

void offsetSquareCoordinate(inout vec2 uv, float offset, out vec2 cell) {
    bool isOddColumn = mod(uv.x, 2.0) < 1.0;
    uv.y += isOddColumn ? 0.0 : offset;
    cell = floor(uv);
    cell += isOddColumn ? vec2(0.5, 0.5) : vec2(0.5, 0.5 - offset);
}

// tri: (x, y) is triangle's (height, width) — matches HLSL TriangularCoordinate
void triangularCoordinate(inout vec2 uv, vec2 tri, out vec2 cell) {
    tri = normalize(tri);
    float offset = tri.y / max(tri.x, 1e-5);

    uv.x -= 0.5 - 1.25 * offset;

    vec2 t = vec2(3.0 * offset, 1.0);

    vec2 a = mod(uv, t);
    a.x += 0.5 - 1.25 * offset;

    vec2 cellA = uv - a;
    cellA += vec2(0.5, 0.5);

    vec2 b = mod(uv + vec2(0.5 * t.x, 0.0), t);
    b.x += 0.5 - 1.25 * offset;

    vec2 cellB = uv - b;
    cellB += vec2(0.5, 0.5);

    b.y = 1.0 - b.y;

    vec2 pos = a + vec2(-0.5, 0.0);
    pos.x = abs(pos.x);

    float c = dot(pos, tri);
    float k = dot(vec2(offset, 0.25), tri);

    if (c < k) {
        uv = a;
        cell = cellA;
    } else {
        uv = b;
        cell = cellB;
    }
}

// ── Procedural RGB stripe mask (Pixel_Geometry_Stripes style) ────────────
// Vertical R | G | B columns with black matrix gaps; mean fill ~1/4 → use luma ~4.

vec3 samplePixelMask(vec2 maskUV) {
    vec2 f = fract(maskUV);

    float gapX = clamp(u_subpixel_gap, 0.0, 0.45);
    float gapY = clamp(u_row_gap, 0.0, 0.45);
    float soft = max(u_mask_soft, 0.0001);

    // Horizontal black matrix (top/bottom of each LCD pixel)
    float yMask = smoothstep(gapY, gapY + soft, f.y)
                * (1.0 - smoothstep(1.0 - gapY - soft, 1.0 - gapY, f.y));

    // Three subpixel columns
    float t = f.x * 3.0;
    float col = floor(t);
    float lf = fract(t);
    float xMask = smoothstep(gapX, gapX + soft, lf)
                * (1.0 - smoothstep(1.0 - gapX - soft, 1.0 - gapX, lf));

    vec3 mask = vec3(0.0);
    if (col < 0.5) {
        mask = vec3(1.0, 0.0, 0.0);
    } else if (col < 1.5) {
        mask = vec3(0.0, 1.0, 0.0);
    } else {
        mask = vec3(0.0, 0.0, 1.0);
    }

    if (u_bgr > 0.5) {
        mask = mask.bgr;
    }

    return mask * xMask * yMask;
}

// OpenGL-style texture LOD from UV scale factor (content-pixel units).
// λ = 0.5 * log2(max(|∂p/∂x|², |∂p/∂y|²))
// Full-screen post: UV is linear, so we use analytical gradients (no dFdx/dFdy).
// That matches OES_standard_derivatives results for a 1:1 fullscreen triangle and
// compiles on WebGL contexts that lack the derivatives extension.
float computeTextureLOD(vec2 duvdx, vec2 duvdy) {
    float sx = max(dot(duvdx, duvdx), 1e-12);
    float sy = max(dot(duvdy, duvdy), 1e-12);
    return 0.5 * log2(max(sx, sy));
}

vec3 sampleScene(vec2 uv) {
    return texture2D(u_scene, clamp(uv, 0.0, 1.0)).rgb;
}

void main() {
    vec2 uv = v_uv;
    float mixAmt = clamp(u_intensity, 0.0, 1.0);
    vec3 original = sampleScene(uv);

    // Virtual LCD resolution: one LCD cell every u_pixel_size screen pixels
    float px = max(u_pixel_size, 1.0);
    vec2 displayRes = max(u_resolution / px, vec2(1.0));

    // Optional interlacing (refresh-mismatch style glitch)
    float inter = clamp(u_interlace, 0.0, 1.0);
    if (inter > 0.001) {
        float line = floor(uv.y * u_resolution.y);
        float phase = step(0.5, fract(u_time * max(u_interlace_speed, 0.0) * 0.5));
        float odd = mod(line, 2.0);
        float shift = inter * 0.004 * (odd * 2.0 - 1.0) * (phase * 2.0 - 1.0);
        uv.x = clamp(uv.x + shift, 0.0, 1.0);
        // darken alternate fields slightly
        // (applied after color sample via interFieldMul)
    }
    float interFieldMul = 1.0;
    if (inter > 0.001) {
        float line = floor(v_uv.y * u_resolution.y);
        float field = mod(line + floor(u_time * max(u_interlace_speed, 0.0) * 30.0), 2.0);
        interFieldMul = mix(1.0, mix(0.82, 1.0, field), inter);
    }

    // pixelMaskUV in LCD-pixel units (tiles the mask once per virtual pixel)
    vec2 pixelMaskUV = uv * displayRes;
    vec2 pixelizedUV;
    vec2 maskUV = pixelMaskUV;

    float layout = floor(u_pixel_layout + 0.5);
    float layoutOff = u_layout_offset;

    if (layout < 0.5) {
        // Square (classic)
        pixelizedUV = (floor(pixelMaskUV) + vec2(0.5)) / displayRes;
        maskUV = pixelMaskUV;
    } else if (layout < 1.5) {
        // Offset square (brick)
        vec2 cell;
        maskUV = pixelMaskUV;
        offsetSquareCoordinate(maskUV, layoutOff, cell);
        pixelizedUV = cell / displayRes;
    } else if (layout < 2.5) {
        // Arrow
        vec2 cell;
        maskUV = pixelMaskUV;
        arrowCoordinate(maskUV, layoutOff, cell);
        pixelizedUV = cell / displayRes;
    } else {
        // Triangular
        vec2 cell;
        maskUV = pixelMaskUV;
        // HLSL uses float2(_PixelLayoutOffset, 1.0) as tri (height, width)
        triangularCoordinate(maskUV, vec2(max(layoutOff, 0.05), 1.0), cell);
        pixelizedUV = cell / displayRes;
    }

    // Analytical ∂(pixelMaskUV)/∂(screen) for a linear fullscreen UV mapping:
    // pixelMaskUV = uv * displayRes  ⇒  ∂/∂x ≈ (displayRes.x / width, 0)
    // which is ~ (1/pixel_size, 0) when displayRes = resolution / pixel_size.
    vec2 res = max(u_resolution, vec2(1.0));
    vec2 dpdx = vec2(displayRes.x / res.x, 0.0);
    vec2 dpdy = vec2(0.0, displayRes.y / res.y);
    float mipmapLevel = computeTextureLOD(dpdx, dpdy);

    // When force-pixels is on, pin LOD so structure is always fully visible
    if (u_force_pixels > 0.5) {
        mipmapLevel = min(mipmapLevel, u_lod_pix_lo);
    }

    // Original remap: pixelization 1→4, pixelremoval (mask→white) 3→4
    float pixelization = clamp(remap01(mipmapLevel, u_lod_pix_lo, u_lod_pix_hi), 0.0, 1.0);
    float pixelremoval = clamp(remap01(mipmapLevel, u_lod_mask_lo, u_lod_mask_hi), 0.0, 1.0);

    // Blend continuous UV ↔ snapped pixel-center UV
    vec2 sampleUV = mix(pixelizedUV, uv, pixelization);

    vec3 texColor = sampleScene(sampleUV);

    // RGB subpixel mask × luma (then fade to white when “far”)
    vec3 pixelMaskColor = samplePixelMask(maskUV) * max(u_pixel_luma, 0.0);
    pixelMaskColor = mix(pixelMaskColor, vec3(1.0), pixelremoval);

    vec3 color = texColor * pixelMaskColor;

    color *= max(u_brightness, 0.0);
    color *= u_tint;
    color *= interFieldMul;

    color = clamp(color, 0.0, 1.0);
    vec3 outc = mix(original, color, mixAmt);
    gl_FragColor = vec4(outc, 1.0);
}
