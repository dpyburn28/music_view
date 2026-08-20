// Organic glowing Voronoi mesh with domain warping and luminous junction nodes.
// Built-in: u_time, u_resolution, v_uv

uniform float u_scale;
uniform float u_edge;
uniform float u_nodeIntensity;
uniform float u_warp;
uniform float u_warpSpeed;
uniform float u_speed;

float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

vec2 hash22(vec2 p) {
    p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
    return fract(sin(p) * 43758.5453);
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
    vec2 shift = vec2(100.0);
    for (int i = 0; i < 4; i++) {
        v += a * noise(p);
        p = p * 2.0 + shift;
        a *= 0.5;
    }
    return v;
}

void main() {
    vec2 res = max(u_resolution, vec2(1.0));
    float aspect = res.x / res.y;
    vec2 uv = v_uv;
    float t = u_time * max(u_speed, 0.0);
    float wt = u_time * max(u_warpSpeed, 0.0);

    // Domain warping — two-layer feedback for liquid distortion
    float warpAmt = max(u_warp, 0.0);
    vec2 q = vec2(
        fbm(uv * 3.0 + vec2(0.0, 0.0) + wt * 0.1),
        fbm(uv * 3.0 + vec2(5.2, 1.3) + wt * 0.12)
    );
    vec2 r = vec2(
        fbm(uv * 3.0 + 4.0 * q + vec2(1.7, 9.2) + wt * 0.15),
        fbm(uv * 3.0 + 4.0 * q + vec2(8.3, 2.8) + wt * 0.13)
    );
    vec2 warpedUv = uv + warpAmt * (r - 0.5) * 0.6;

    // Scale into Voronoi space
    float sc = max(u_scale, 1.0);
    vec2 p = warpedUv * sc;
    p.x *= aspect;

    vec2 ip = floor(p);
    vec2 fp = fract(p);

    // Track F1, F2, F3 (nearest, second, third distances)
    float f1 = 1e10;
    float f2 = 1e10;
    float f3 = 1e10;

    for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
            vec2 neighbor = vec2(float(x), float(y));
            vec2 cell = ip + neighbor;

            // Animated jittered point
            vec2 pt = hash22(cell);
            pt = 0.5 + 0.5 * sin(t * 0.8 + 6.2831 * pt);
            pt = mix(vec2(0.5), pt, 0.85);

            vec2 diff = neighbor + pt - fp;
            float d = dot(diff, diff);

            if (d < f1) {
                f3 = f2;
                f2 = f1;
                f1 = d;
            } else if (d < f2) {
                f3 = f2;
                f2 = d;
            } else if (d < f3) {
                f3 = d;
            }
        }
    }

    float sf1 = sqrt(f1);
    float sf2 = sqrt(f2);
    float sf3 = sqrt(f3);

    // Edge glow: exponential decay on F2 - F1 boundary
    float edgeDist = sf2 - sf1;
    float edgeSharpness = max(u_edge, 1.0);
    float edgeGlow = exp(-edgeSharpness * edgeDist);

    // Junction nodes: brighten where three cells meet (F3 - F2 is small)
    float junctionDist = abs(sf3 - sf2);
    float nodeBloom = exp(-6.0 * junctionDist) * max(u_nodeIntensity, 0.0);

    // Secondary: also flare the F1 center slightly for extra warmth
    float centerFlare = exp(-4.0 * sf1) * 0.15;

    // Combine
    float intensity = edgeGlow + nodeBloom + centerFlare;

    // Tone mapping — crush cells to black, keep lines/nodes bright
    intensity = pow(clamp(intensity, 0.0, 1.0), 0.8);

    // Subtle vignette
    vec2 vigUv = v_uv - 0.5;
    float vig = 1.0 - dot(vigUv, vigUv) * 0.5;
    intensity *= vig;

    gl_FragColor = vec4(vec3(intensity), 1.0);
}
