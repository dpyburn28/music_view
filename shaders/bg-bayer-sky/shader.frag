// 1-bit 8×8 ordered dither of a drifting grayscale landscape.
// Bayer pattern is locked to gl_FragCoord (screen space).
// Built-in: u_time, u_resolution, v_uv  (do not redeclare)

uniform float u_dither_scale;
uniform float u_bias;
uniform float u_contrast;
uniform float u_cloud;
uniform float u_horizon;
uniform float u_audio_env;
uniform float u_env_amount;
uniform float u_speed;

float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (float i = 0.0; i < 5.0; i += 1.0) {
        v += a * noise(p);
        p = p * 2.03 + vec2(1.7, 9.2);
        a *= 0.5;
    }
    return v;
}

// 8×8 Bayer thresholds in 0–1, built from the 2×2 kernel
//   0 2
//   3 1
// so we never dynamically index an array (WebGL1 / GLES).
float bayer8(vec2 pix) {
    float res = 0.0;
    float scale = 1.0;
    vec2 p = floor(pix);
    for (float i = 0.0; i < 3.0; i += 1.0) {
        vec2 cell = mod(p, 2.0);
        // I2(x,y): 0,2 / 3,1
        float bit = cell.x * 2.0 + cell.y * 3.0 - 4.0 * cell.x * cell.y;
        res += bit * scale;
        scale *= 4.0;
        p = floor(p * 0.5);
    }
    return (res + 0.5) / 64.0;
}

float landscape(vec2 uv, float t) {
    float horizon = clamp(u_horizon, 0.12, 0.7);
    float y = uv.y;
    float x = uv.x;

    // Textured mid sky (breaks up the 50% Bayer checker).
    float sky = 0.50
        + 0.08 * fbm(vec2(x * 2.4, y * 3.1 + 2.0))
        + 0.10 * smoothstep(horizon, 0.95, y);
    vec2 sun = vec2(0.30, 0.76);
    float sunD = length((uv - sun) * vec2(0.7, 1.05));
    sky += exp(-sunD * 2.6) * 0.16;

    // Large drifting cloud masses — solid white cores, dithered rims.
    float cloudAmt = max(u_cloud, 0.0);
    vec2 cuv = vec2(x * 1.15 + t * 0.02, y * 1.45);
    float n1 = fbm(cuv);
    float n2 = fbm(cuv * 0.5 + vec2(5.2, t * 0.008));
    float n3 = fbm(cuv * 2.2 + n1);
    float cld = n1 * 0.5 + n2 * 0.35 + n3 * 0.15;
    float skyMask = smoothstep(horizon - 0.01, horizon + 0.12, y);
    float core = smoothstep(0.42, 0.56, cld);
    float body = smoothstep(0.32, 0.48, cld);
    float veil = smoothstep(0.24, 0.40, cld) * 0.32;
    float clouds = mix(veil, mix(body * 0.75, 1.0, core), 0.9) * skyMask * cloudAmt;

    float gray = mix(sky, 1.0, clamp(clouds, 0.0, 1.0));

    // Far mountain ridge (lit).
    float far = horizon + 0.07
        + 0.05 * sin(x * 4.2 + 0.3)
        + 0.025 * sin(x * 10.0 + 1.8)
        + 0.02 * fbm(vec2(x * 3.5, 1.1));
    // Near hill (darker, overlapping).
    float near = horizon - 0.01
        + 0.10 * sin(x * 2.2 + 2.4)
        + 0.04 * sin(x * 5.8 + 0.7)
        + 0.025 * fbm(vec2(x * 6.0, 2.2));

    float farMask = 1.0 - smoothstep(far, far + 0.008, y);
    float nearMask = 1.0 - smoothstep(near, near + 0.007, y);

    float farShade = 0.46
        + 0.14 * (1.0 - smoothstep(far - 0.06, far, y))
        + 0.06 * fbm(vec2(x * 8.0, y * 6.0));
    float nearShade = 0.12
        + 0.22 * smoothstep(near - 0.08, near, y)
        + 0.07 * fbm(vec2(x * 10.0, y * 8.0));

    gray = mix(gray, clamp(farShade, 0.0, 1.0), farMask * (1.0 - nearMask));
    gray = mix(gray, clamp(nearShade, 0.0, 1.0), nearMask);

    // Dark foreground — almost solid black with a little grain.
    float fg = smoothstep(0.20, 0.04, y);
    float grain = fbm(vec2(x * 9.0, y * 16.0 + t * 0.05)) * 0.07;
    gray = mix(gray, grain, fg);

    return clamp(gray, 0.0, 1.0);
}

void main() {
    vec2 uv = v_uv;
    float t = u_time * max(u_speed, 0.0);

    float lum = landscape(uv, t);

    // Contrast / exposure, then audio envelope flash or density shift.
    float contrast = max(u_contrast, 0.01);
    lum = (lum - 0.5) * contrast + 0.5 + u_bias;
    lum += clamp(u_audio_env, 0.0, 1.0) * max(u_env_amount, 0.0);

    // Screen-locked Bayer (not UV) so the grid stays put while clouds drift.
    float scale = max(u_dither_scale, 1.0);
    vec2 pix = floor(gl_FragCoord.xy / scale);
    float thresh = bayer8(pix);

    float bit = step(thresh, lum);
    gl_FragColor = vec4(vec3(bit), 1.0);
}
