// Container-aware: glowing container outlines + controlled ripple arcs between them.
// Falls back to free-form Voronoi mesh when u_containerAware is off.
// Built-in: u_time, u_resolution, v_uv
// Container data: u_containerCount, u_containers[] (set by renderer via setContainerBounds)

uniform float u_containerAware;
uniform float u_borderSharpness;
uniform float u_arcSharpness;
uniform float u_arcCount;
uniform float u_arcWobble;
uniform float u_arcFrequency;
uniform float u_nodeIntensity;
uniform float u_speed;

// Fallback Voronoi uniforms (used when u_containerAware < 0.5)
uniform float u_scale;
uniform float u_edge;
uniform float u_warp;
uniform float u_warpSpeed;

uniform float u_containerCount;
uniform vec4 u_containers[16];

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

float boxSdf(vec2 p, vec2 bMin, vec2 bMax) {
    vec2 d = max(bMin - p, p - bMax);
    return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

// Resolve container rect by dynamic index (loop-unrolled for GLSL ES 1.0)
vec4 getContainer(int idx) {
    for (int n = 0; n < 16; n++) {
        if (n == idx) return u_containers[n];
    }
    return u_containers[0];
}

// --- Perimeter parameterization ---
// Maps t in [0,1) to a point on the rectangle perimeter (CW from top-left)
vec2 perimeterPoint(vec4 rect, float t) {
    vec2 org = rect.xy;
    vec2 sz = rect.zw;
    float perim = 2.0 * (sz.x + sz.y);
    float d = t * perim;
    if (d < sz.x) return org + vec2(d, 0.0);
    d -= sz.x;
    if (d < sz.y) return org + vec2(sz.x, d);
    d -= sz.y;
    if (d < sz.x) return org + vec2(sz.x - d, sz.y);
    d -= sz.x;
    return org + vec2(0.0, sz.y - d);
}

// --- Quadratic bezier distance (sampled) ---
float bezierDist(vec2 p, vec2 a, vec2 ctrl, vec2 b, int steps) {
    float md = 1e10;
    float fin = float(steps);
    for (int i = 0; i <= 10; i++) {
        if (i > steps) break;
        float t = float(i) / fin;
        float omt = 1.0 - t;
        vec2 pt = omt * omt * a + 2.0 * omt * t * ctrl + t * t * b;
        float d = length(pt - p);
        if (d < md) md = d;
    }
    return md;
}

// --- Container border glow (returns max glow across all containers) ---
float containerBorderGlow(vec2 uv) {
    int count = int(u_containerCount);
    float glow = 0.0;
    float sharp = max(u_borderSharpness, 1.0);
    for (int i = 0; i < 16; i++) {
        if (i >= count) break;
        vec4 c = u_containers[i];
        if (c.z <= 0.0 || c.w <= 0.0) continue;
        float d = abs(boxSdf(uv, c.xy, c.xy + c.zw));
        float g = exp(-sharp * d);
        if (g > glow) glow = g;
    }
    return glow;
}

// --- Connection arcs (returns glow from all arcs) ---
float connectionArcGlow(vec2 uv) {
    int count = int(u_containerCount);
    if (count < 2) return 0.0;
    int arcs = int(max(u_arcCount, 1.0));
    float sharp = max(u_arcSharpness, 1.0);
    float wobble = max(u_arcWobble, 0.0);
    float freq = max(u_arcFrequency, 1.0);
    float t = u_time * max(u_speed, 0.0);
    float glow = 0.0;

    for (int i = 0; i < 16; i++) {
        if (i >= count) break;
        for (int k = 0; k < 4; k++) {
            if (k >= arcs) break;

            // Deterministic target container (avoid self)
            float h = hash21(vec2(float(i), float(k) + 17.3));
            int j = int(mod(float(i) + 1.0 + h * float(count - 1), float(count)));
            if (j == i) j = int(mod(float(j) + 1.0, float(count)));
            if (j >= count) continue;

            // Perimeter parameters for start/end
            float s = hash21(vec2(float(i), float(k) + 31.7));
            float e = hash21(vec2(float(j), float(k) + 47.3));

            vec2 p0 = perimeterPoint(u_containers[i], s);
            vec2 p2 = perimeterPoint(getContainer(j), e);
            vec2 mid = (p0 + p2) * 0.5;
            vec2 dir = p2 - p0;
            float len = length(dir);
            if (len < 0.001) continue;
            vec2 perp = vec2(-dir.y, dir.x) / len;

            // Animated wobble: combination of slow sway + ripple
            float sway = sin(t * 0.4 + float(i) * 2.1 + float(k) * 3.7) * wobble * 2.0;
            float ripple = sin(t * 1.2 + float(i + j) * 1.3 + s * freq) * wobble * 0.5;
            vec2 ctrl = mid + perp * (sway + ripple + len * 0.15);

            // Distance to curve
            float d = bezierDist(uv, p0, ctrl, p2, 8);
            float g = exp(-sharp * d);
            if (g > glow) glow = g;
        }
    }
    return glow;
}

// --- Junction nodes (brighten where arcs meet container edges) ---
float junctionNodes(vec2 uv) {
    int count = int(u_containerCount);
    if (count < 2) return 0.0;
    int arcs = int(max(u_arcCount, 1.0));
    float t = u_time * max(u_speed, 0.0);
    float node = 0.0;

    for (int i = 0; i < 16; i++) {
        if (i >= count) break;
        for (int k = 0; k < 4; k++) {
            if (k >= arcs) break;

            float h = hash21(vec2(float(i), float(k) + 17.3));
            int j = int(mod(float(i) + 1.0 + h * float(count - 1), float(count)));
            if (j == i) j = int(mod(float(j) + 1.0, float(count)));
            if (j >= count) continue;

            float s = hash21(vec2(float(i), float(k) + 31.7));
            float e = hash21(vec2(float(j), float(k) + 47.3));

            vec2 p0 = perimeterPoint(u_containers[i], s);
            vec2 p2 = perimeterPoint(getContainer(j), e);

            // Node at start point
            float d0 = length(uv - p0);
            float g0 = exp(-20.0 * d0);
            if (g0 > node) node = g0;

            // Node at end point
            float d1 = length(uv - p2);
            float g1 = exp(-20.0 * d1);
            if (g1 > node) node = g1;
        }
    }
    return node * max(u_nodeIntensity, 0.0);
}

// --- Fallback Voronoi mesh (from v1) ---
float voronoiMesh(vec2 uv, float t) {
    float sc = max(u_scale, 1.0);
    float aspect = u_resolution.x / max(u_resolution.y, 1.0);
    vec2 p = uv * sc;
    p.x *= aspect;
    vec2 ip = floor(p);
    vec2 fp = fract(p);

    float f1 = 1e10, f2 = 1e10, f3 = 1e10;
    for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
            vec2 neighbor = vec2(float(x), float(y));
            vec2 cell = ip + neighbor;
            vec2 pt = hash22(cell);
            pt = 0.5 + 0.5 * sin(t * 0.8 + 6.2831 * pt);
            pt = mix(vec2(0.5), pt, 0.85);
            vec2 diff = neighbor + pt - fp;
            float d = dot(diff, diff);
            if (d < f1) { f3 = f2; f2 = f1; f1 = d; }
            else if (d < f2) { f3 = f2; f2 = d; }
            else if (d < f3) { f3 = d; }
        }
    }

    float edgeGlow = exp(-max(u_edge, 1.0) * (sqrt(f2) - sqrt(f1)));
    float nodeBloom = exp(-6.0 * abs(sqrt(f3) - sqrt(f2))) * max(u_nodeIntensity, 0.0);
    float centerFlare = exp(-4.0 * sqrt(f1)) * 0.15;
    return edgeGlow + nodeBloom + centerFlare;
}

void main() {
    vec2 uv = v_uv;
    float t = u_time * max(u_speed, 0.0);
    float aware = step(0.5, u_containerAware);
    int count = int(u_containerCount);

    float intensity = 0.0;

    if (aware > 0.5 && count >= 2) {
        // Container mode: borders + arcs + nodes
        // Container bounds are in CSS space (Y-down), flip UV to match
        vec2 uvFlip = vec2(uv.x, 1.0 - uv.y);
        float border = containerBorderGlow(uvFlip);
        float arcs = connectionArcGlow(uvFlip);
        float nodes = junctionNodes(uvFlip);
        intensity = max(border, arcs) + nodes;
    } else {
        // Fallback: free-form Voronoi mesh
        float wt = u_time * max(u_warpSpeed, 0.0);
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
        intensity = voronoiMesh(warpedUv, t);
    }

    // Tone mapping
    intensity = pow(clamp(intensity, 0.0, 1.0), 0.8);

    // Subtle vignette
    vec2 vigUv = uv - 0.5;
    float vig = 1.0 - dot(vigUv, vigUv) * 0.5;
    intensity *= vig;

    gl_FragColor = vec4(vec3(intensity), 1.0);
}
