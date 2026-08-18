// Final postprocess: thermal / FLIR camera.
// Built-in: u_time, u_resolution, v_uv
// Required: u_scene

uniform sampler2D u_scene;
uniform float u_softness;
uniform float u_contrast;
uniform float u_brightness;
uniform float u_noise;
uniform float u_palette;
uniform float u_scan;
uniform float u_intensity;

float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

float luma(vec3 c) {
    return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

// Ironbow-ish thermal palette
vec3 paletteIron(float t) {
    t = clamp(t, 0.0, 1.0);
    vec3 c;
    c.r = smoothstep(0.15, 0.85, t);
    c.g = smoothstep(0.0, 0.35, t) * (1.0 - smoothstep(0.55, 1.0, t)) * 0.85
        + smoothstep(0.7, 1.0, t);
    c.b = (1.0 - smoothstep(0.05, 0.45, t)) * 0.55
        + smoothstep(0.85, 1.0, t) * 0.9;
    // Deep cold blue-black
    vec3 cold = vec3(0.02, 0.02, 0.12);
    vec3 hot = vec3(1.0, 0.95, 0.85);
    return mix(cold, c, smoothstep(0.0, 0.15, t));
}

// Rainbow / false-color
vec3 paletteRainbow(float t) {
    t = clamp(t, 0.0, 1.0);
    return 0.5 + 0.5 * cos(6.28318 * (vec3(0.0, 0.33, 0.67) + t));
}

// White-hot
vec3 paletteWhiteHot(float t) {
    t = clamp(t, 0.0, 1.0);
    return mix(vec3(0.0), vec3(1.0, 0.98, 0.95), pow(t, 0.85));
}

vec3 sampleScene(vec2 uv) {
    return texture2D(u_scene, clamp(uv, 0.0, 1.0)).rgb;
}

void main() {
    vec2 uv = v_uv;
    vec3 original = sampleScene(uv);
    float mixAmt = clamp(u_intensity, 0.0, 1.0);

    // Soft blob sampling (thermal sensors are low-res / smeared)
    float soft = clamp(u_softness, 0.0, 1.0);
    vec2 px = (1.0 + soft * 5.0) / max(u_resolution, vec2(1.0));
    vec3 acc = sampleScene(uv) * 0.3;
    acc += sampleScene(uv + vec2(px.x, 0.0)) * 0.12;
    acc += sampleScene(uv - vec2(px.x, 0.0)) * 0.12;
    acc += sampleScene(uv + vec2(0.0, px.y)) * 0.12;
    acc += sampleScene(uv - vec2(0.0, px.y)) * 0.12;
    acc += sampleScene(uv + px * 1.5) * 0.11;
    acc += sampleScene(uv - px * 1.5) * 0.11;

    float t = luma(acc);
    t = (t - 0.5) * max(u_contrast, 0.01) + 0.5;
    t += u_brightness;
    t = clamp(t, 0.0, 1.0);

    // Noise / scintillation
    float nAmt = max(u_noise, 0.0);
    if (nAmt > 0.0001) {
        float n = hash21(uv * u_resolution + floor(u_time * 20.0));
        t += (n - 0.5) * nAmt;
        t = clamp(t, 0.0, 1.0);
    }

    float mode = floor(u_palette + 0.5);
    vec3 col;
    if (mode < 0.5) col = paletteIron(t);
    else if (mode < 1.5) col = paletteRainbow(t);
    else col = paletteWhiteHot(t);

    // Subtle HUD scan
    float scan = clamp(u_scan, 0.0, 1.0);
    if (scan > 0.001) {
        float line = 0.5 + 0.5 * sin(uv.y * u_resolution.y * 1.5 + u_time * 2.0);
        col *= mix(1.0 - scan * 0.25, 1.0, line);
        // Faint crosshair / frame
        float frame = max(
            smoothstep(0.02, 0.0, min(uv.x, 1.0 - uv.x)),
            smoothstep(0.02, 0.0, min(uv.y, 1.0 - uv.y))
        );
        col = mix(col, col + vec3(0.15, 0.05, 0.0), frame * scan * 0.5);
    }

    col = clamp(col, 0.0, 1.0);
    gl_FragColor = vec4(mix(original, col, mixAmt), 1.0);
}
