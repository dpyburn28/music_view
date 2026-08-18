// Brushed-metal filaments (left) + cylindrical highlight (right).
// Built-in: u_time, u_resolution, v_uv

uniform float u_split;
uniform float u_line_density;
uniform float u_line_contrast;
uniform float u_highlight;
uniform float u_band_y;
uniform float u_speed;

float hash11(float n) {
    return fract(sin(n * 127.1) * 43758.5453);
}

float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

void main() {
    vec2 uv = v_uv;
    float t = u_time * max(u_speed, 0.0);

    float split = clamp(u_split, 0.05, 0.95);
    split = clamp(split + 0.006 * sin(t * 0.17), 0.05, 0.95);

    float dens = max(u_line_density, 8.0);
    float contrast = clamp(u_line_contrast, 0.0, 1.0);
    float hi = clamp(u_highlight, 0.0, 1.0);
    float y = uv.y;

    // Left: sine comb — stays hairline under mediump / low res.
    float phase = uv.x * dens * 3.14159265 + t * 0.55;
    float comb = abs(sin(phase));
    float sharpness = mix(1.2, 8.0, contrast);
    float lines = pow(1.0 - comb, sharpness);

    // Column-to-column brightness + rare dark gutters.
    float col = floor(uv.x * dens);
    float hCol = hash11(col + 11.3);
    lines *= mix(0.35, 1.0, hCol);
    lines *= 1.0 - step(0.97, hash11(col + 3.7)) * 0.9;

    // High-key metal on top, thin filaments on crushed black below.
    float topWash = smoothstep(0.32, 0.98, y);
    float lowFil = (1.0 - smoothstep(0.36, 0.52, y)) * smoothstep(0.0, 0.22, y);
    float leftVal = lines * mix(0.08, 1.25, topWash);
    leftVal += lines * 0.7 * lowFil;
    float sheenY = 0.74 + 0.07 * sin(t * 0.35);
    leftVal += lines * exp(-pow((y - sheenY) * 5.0, 2.0)) * 0.4;
    float edgeHot = (1.0 - smoothstep(0.0, 0.04, uv.x)) * smoothstep(0.5, 0.9, y);
    leftVal = clamp(max(leftVal, edgeHot), 0.0, 1.0);

    // Right: gray crown, hot equatorial band, crushed black skirt (matches still).
    float bandY = clamp(u_band_y, 0.15, 0.9) + 0.035 * sin(t * 0.28);
    float lobe = exp(-pow((y - bandY) * 4.2, 2.0));
    float crown = 0.28 * smoothstep(0.5, 0.92, y);
    float skirt = smoothstep(0.34, 0.52, y);
    float cyl = (crown + lobe * hi * 1.15) * skirt;
    cyl += (hash21(vec2(uv.x * 4.0, y * 50.0 + t * 0.3)) - 0.5) * 0.02 * skirt;
    cyl = clamp(cyl, 0.0, 1.0);

    float seam = smoothstep(split - 0.001, split + 0.001, uv.x);
    float val = mix(leftVal, cyl, seam);

    gl_FragColor = vec4(vec3(val), 1.0);
}
