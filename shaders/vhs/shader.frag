// Final postprocess: VHS / composite video.
// Built-in: u_time, u_resolution, v_uv
// Required: u_scene

uniform sampler2D u_scene;
uniform float u_bleed;
uniform float u_softness;
uniform float u_wobble;
uniform float u_noise;
uniform float u_scanline;
uniform float u_tracking;
uniform float u_saturation;
uniform float u_contrast;
uniform vec3 u_tint;
uniform float u_intensity;

float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

float luma(vec3 c) {
    return dot(c, vec3(0.299, 0.587, 0.114));
}

vec3 sampleScene(vec2 uv) {
    return texture2D(u_scene, clamp(uv, 0.0, 1.0)).rgb;
}

void main() {
    vec2 uv = v_uv;
    vec3 original = sampleScene(uv);
    float mixAmt = clamp(u_intensity, 0.0, 1.0);

    // Vertical tracking wobble
    float wob = max(u_wobble, 0.0);
    float yWave = sin(uv.y * 18.0 + u_time * 2.2) * cos(uv.y * 3.1 - u_time * 0.7);
    float xOff = yWave * wob;
    // Occasional harder skew
    xOff += sin(uv.y * 40.0 + u_time * 11.0) * wob * 0.35;
    vec2 suv = uv + vec2(xOff, 0.0);

    // Soft luma (horizontal blur)
    float soft = clamp(u_softness, 0.0, 1.0);
    vec2 px = vec2(1.0 / max(u_resolution.x, 1.0), 0.0);
    float blurPx = mix(0.0, 3.5, soft);
    vec3 c0 = sampleScene(suv);
    vec3 c1 = sampleScene(suv + px * blurPx);
    vec3 c2 = sampleScene(suv - px * blurPx);
    vec3 c3 = sampleScene(suv + px * blurPx * 2.0);
    vec3 c4 = sampleScene(suv - px * blurPx * 2.0);
    vec3 softCol = (c0 * 0.35 + (c1 + c2) * 0.22 + (c3 + c4) * 0.105);

    // Chroma bleed: offset R/B channels horizontally
    float bleed = max(u_bleed, 0.0);
    float r = sampleScene(suv + vec2(bleed, 0.0)).r;
    float g = softCol.g;
    float b = sampleScene(suv - vec2(bleed * 1.2, 0.0)).b;
    // Mix soft luma with sharp-ish chroma
    float Y = luma(softCol);
    vec3 col = vec3(r, g, b);
    col = mix(vec3(Y), col, 0.85);

    // Tracking bars (bottom band noise / tear)
    float track = clamp(u_tracking, 0.0, 1.0);
    if (track > 0.001) {
        float band = smoothstep(0.82, 0.95, uv.y + sin(u_time * 0.4) * 0.03);
        float tear = hash21(vec2(floor(uv.y * 80.0), floor(u_time * 8.0)));
        col = mix(col, col * (0.4 + tear * 0.9) + tear * 0.15, band * track);
        // Horizontal displacement in bar
        if (band > 0.01) {
            vec2 tuv = suv + vec2((tear - 0.5) * 0.04 * track, 0.0);
            col = mix(col, sampleScene(tuv), band * track * 0.65);
        }
    }

    // Tape noise
    float nAmt = max(u_noise, 0.0);
    if (nAmt > 0.0001) {
        float n = hash21(uv * u_resolution + floor(u_time * 24.0));
        float n2 = hash21(uv * u_resolution * 0.5 - floor(u_time * 18.0));
        col += (n - 0.5) * nAmt;
        col.rg += (n2 - 0.5) * nAmt * 0.35;
    }

    // Soft scanlines
    float scan = clamp(u_scanline, 0.0, 1.0);
    if (scan > 0.001) {
        float line = 0.5 + 0.5 * sin(uv.y * u_resolution.y * 3.14159265);
        col *= mix(1.0 - scan * 0.5, 1.0, line);
    }

    // Grade
    float L = luma(col);
    col = mix(vec3(L), col, max(u_saturation, 0.0));
    col = (col - 0.5) * max(u_contrast, 0.01) + 0.5;
    col *= u_tint;

    col = clamp(col, 0.0, 1.0);
    gl_FragColor = vec4(mix(original, col, mixAmt), 1.0);
}
