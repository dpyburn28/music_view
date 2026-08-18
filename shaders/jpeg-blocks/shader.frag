// Utility: fake JPEG macroblock quantization + optional DCT-ish ringing.
uniform sampler2D u_scene;
uniform float u_block;
uniform float u_quality;
uniform float u_ringing;
uniform float u_chromaSub;
uniform float u_intensity;

float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

vec3 sampleScene(vec2 uv) {
    return texture2D(u_scene, clamp(uv, 0.0, 1.0)).rgb;
}

void main() {
    vec3 original = sampleScene(v_uv);
    float m = clamp(u_intensity, 0.0, 1.0);
    if (m < 0.0001) {
        gl_FragColor = vec4(original, 1.0);
        return;
    }

    float block = max(u_block, 4.0);
    vec2 res = max(u_resolution, vec2(1.0));
    vec2 cell = floor(v_uv * res / block);
    vec2 local = fract(v_uv * res / block);
    vec2 centerUv = (cell + 0.5) * block / res;

    // Block average sample (center + corners)
    vec2 halfPx = vec2(block * 0.35) / res;
    vec3 avg =
        sampleScene(centerUv) * 0.4 +
        sampleScene(centerUv + halfPx) * 0.15 +
        sampleScene(centerUv - halfPx) * 0.15 +
        sampleScene(centerUv + vec2(halfPx.x, -halfPx.y)) * 0.15 +
        sampleScene(centerUv + vec2(-halfPx.x, halfPx.y)) * 0.15;

    // Quality: fewer levels at low quality
    float q = clamp(u_quality, 0.05, 1.0);
    float levels = mix(4.0, 32.0, q);
    vec3 quant = floor(avg * levels + 0.5) / levels;

    // Chroma subsample: pull chroma from 2x block
    if (u_chromaSub > 0.5) {
        vec2 ccell = floor(v_uv * res / (block * 2.0));
        vec2 cuv = (ccell + 0.5) * block * 2.0 / res;
        vec3 cavg = sampleScene(cuv);
        float y = luma(quant);
        float cy = luma(cavg);
        quant = quant * 0.35 + (cavg * (y + 0.0001) / (cy + 0.0001)) * 0.65;
        quant = floor(quant * levels + 0.5) / levels;
    }

    // Mild ringing at block edges
    float edge = max(abs(local.x - 0.5), abs(local.y - 0.5)) * 2.0;
    float ring = smoothstep(0.75, 1.0, edge) * clamp(u_ringing, 0.0, 1.0);
    vec3 col = mix(quant, original * 1.05 - quant * 0.05, ring * 0.35);
    col = mix(quant, col, 1.0);

    gl_FragColor = vec4(mix(original, clamp(col, 0.0, 1.0), m), 1.0);
}
