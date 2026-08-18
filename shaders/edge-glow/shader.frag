// Postprocess: edge detect + colored glow (neon outline without full bloom stack).
// Built-in: u_time, u_resolution, v_uv
// Required: u_scene

uniform sampler2D u_scene;
uniform float u_threshold;
uniform float u_strength;
uniform float u_spread;
uniform vec3 u_color;
uniform float u_keep_image;
uniform float u_intensity;

float luma(vec3 c) {
    return dot(c, vec3(0.299, 0.587, 0.114));
}

float sampleL(vec2 uv) {
    return luma(texture2D(u_scene, clamp(uv, 0.0, 1.0)).rgb);
}

void main() {
    vec3 original = texture2D(u_scene, v_uv).rgb;
    float m = clamp(u_intensity, 0.0, 1.0);
    if (m < 0.0001) {
        gl_FragColor = vec4(original, 1.0);
        return;
    }

    vec2 px = 1.0 / max(u_resolution, vec2(1.0));
    float spread = max(u_spread, 0.5);
    // Sobel
    float tl = sampleL(v_uv + px * vec2(-1.0, 1.0) * spread);
    float t  = sampleL(v_uv + px * vec2(0.0, 1.0) * spread);
    float tr = sampleL(v_uv + px * vec2(1.0, 1.0) * spread);
    float l  = sampleL(v_uv + px * vec2(-1.0, 0.0) * spread);
    float r  = sampleL(v_uv + px * vec2(1.0, 0.0) * spread);
    float bl = sampleL(v_uv + px * vec2(-1.0, -1.0) * spread);
    float b  = sampleL(v_uv + px * vec2(0.0, -1.0) * spread);
    float br = sampleL(v_uv + px * vec2(1.0, -1.0) * spread);

    float gx = -tl - 2.0 * l - bl + tr + 2.0 * r + br;
    float gy = -tl - 2.0 * t - tr + bl + 2.0 * b + br;
    float edge = length(vec2(gx, gy));
    edge = max(edge - u_threshold, 0.0);
    edge = clamp(edge * max(u_strength, 0.0), 0.0, 2.5);

    // Soften edge a bit with extra samples for glow body
    float glow = edge;
    glow += sampleL(v_uv + px * vec2(2.0, 0.0) * spread) * 0.0; // keep structure simple
    float g2 = 0.0;
    g2 += length(vec2(
        sampleL(v_uv + px * vec2(2.0, 0.0) * spread) - sampleL(v_uv - px * vec2(2.0, 0.0) * spread),
        sampleL(v_uv + px * vec2(0.0, 2.0) * spread) - sampleL(v_uv - px * vec2(0.0, 2.0) * spread)
    )) * 0.35;
    glow = clamp(glow + max(g2 - u_threshold, 0.0) * u_strength * 0.4, 0.0, 2.5);

    vec3 edgeCol = u_color * glow;
    float keep = clamp(u_keep_image, 0.0, 1.0);
    vec3 base = mix(vec3(0.0), original, keep);
    vec3 col = base + edgeCol;
    col = clamp(col, 0.0, 1.0);

    gl_FragColor = vec4(mix(original, col, m), 1.0);
}
