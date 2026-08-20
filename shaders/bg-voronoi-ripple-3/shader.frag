// Organic Voronoi cellular mesh with optional container-aware mode.
// When enabled: feature points on container perimeters, mesh connects them,
// container borders glow, smin blends edges for organic pinching.
// Falls back to free-form Voronoi when disabled.
// Built-in: u_time, u_resolution, v_uv
// Container data: u_containerCount, u_containers[] (set by renderer)

uniform float u_containerAware;
uniform float u_scale;
uniform float u_edgeWidth;
uniform float u_sminK;
uniform float u_pointDensity;
uniform float u_warpStrength;
uniform float u_warpFreq;
uniform float u_speed;
uniform float u_phase;

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

float smin(float a, float b, float k) {
    float h = clamp(0.5 + 0.5 * (b - a) / max(k, 0.0001), 0.0, 1.0);
    return mix(b, a, h) - k * h * (1.0 - h);
}

float boxSdf(vec2 p, vec2 bMin, vec2 bMax) {
    vec2 d = max(bMin - p, p - bMax);
    return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

vec4 getContainer(int idx) {
    for (int n = 0; n < 16; n++) {
        if (n == idx) return u_containers[n];
    }
    return u_containers[0];
}

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

// Connection points per container, scaling with its perimeter
int pointCountFor(vec4 c, float density) {
    float perim = 2.0 * (c.z + c.w);
    return int(clamp(floor(perim * density + 0.5), 2.0, 8.0));
}

// Deterministic feature point on a container perimeter: even spacing,
// hashed jitter, slow drift along the edge over time
vec2 featurePoint(vec4 c, int i, int j, float density, float t, float phase) {
    int nPts = pointCountFor(c, density);
    float spacing = 1.0 / float(nPts);
    float seed = hash21(vec2(float(i) * 3.71, float(j) * 7.93));
    float jit = (seed - 0.5) * spacing * 0.6;
    float drift = sin(t * 0.35 + seed * 6.2831) * spacing * 0.18;
    float tt = fract(float(j) * spacing + jit + drift + phase);
    vec2 pt = perimeterPoint(c, tt);
    return mix(pt, c.xy + c.zw * 0.5, 0.06);
}

// Drifting seed point for the free-form fallback grid (unit-cell frame)
vec2 fallbackCellPoint(vec2 cellOffset, float t) {
    vec2 seed = hash22(cellOffset);
    float ph1 = seed.x * 6.2831;
    float ph2 = seed.y * 6.2831;
    float ph3 = hash21(cellOffset + 7.7) * 6.2831;
    float ph4 = hash21(cellOffset + 13.1) * 6.2831;
    return cellOffset + vec2(
        0.5 + sin(t * 0.3 + ph1) * 0.22 + cos(t * 0.17 + ph2) * 0.16,
        0.5 + cos(t * 0.23 + ph3) * 0.22 + sin(t * 0.13 + ph4) * 0.16
    );
}

void main() {
    vec2 res = max(u_resolution, vec2(1.0));
    float aspect = res.x / res.y;
    vec2 uv = v_uv;
    float t = u_time * max(u_speed, 0.0) + u_phase;
    float aware = step(0.5, u_containerAware);
    int count = int(u_containerCount);

    float intensity = 0.0;

    if (aware > 0.5 && count >= 2) {
        // --- Container-aware mode ---
        vec2 uvFlip = vec2(uv.x, 1.0 - uv.y);

        // Subtle domain warp
        float warpAmt = max(u_warpStrength, 0.0);
        float wf = max(u_warpFreq, 0.5);
        vec2 q = vec2(
            fbm(uvFlip * wf + vec2(0.0, 0.0) + t * 0.05),
            fbm(uvFlip * wf + vec2(5.2, 1.3) + t * 0.06)
        );
        vec2 warped = uvFlip + warpAmt * (q - 0.5) * 0.3;

        float density = max(u_pointDensity, 0.5);
        float k = max(u_sminK, 0.001);

        // Pass 1: locate the single nearest feature point
        float best = 1e10;
        vec2 bp = vec2(0.0);
        for (int i = 0; i < 16; i++) {
            if (i >= count) break;
            vec4 c = getContainer(i);
            if (c.z <= 0.0 || c.w <= 0.0) continue;
            int nPts = pointCountFor(c, density);
            for (int j = 0; j < 8; j++) {
                if (j >= nPts) break;
                vec2 pt = featurePoint(c, i, j, density, t, u_phase);
                vec2 diff = pt - warped;
                float d = dot(diff, diff);
                if (d < best) { best = d; bp = pt; }
            }
        }

        // Pass 2: exact edge distance. Every point is paired with the nearest
        // and soft-mined — bisectors of non-nearest pairs never bound the
        // nearest cell, so this stays continuous through junctions instead of
        // clipping where nearest-2/3 ranks swap.
        float edge = 1e10;
        for (int i = 0; i < 16; i++) {
            if (i >= count) break;
            vec4 c = getContainer(i);
            if (c.z <= 0.0 || c.w <= 0.0) continue;
            int nPts = pointCountFor(c, density);
            for (int j = 0; j < 8; j++) {
                if (j >= nPts) break;
                vec2 pt = featurePoint(c, i, j, density, t, u_phase);
                vec2 dir = pt - bp;
                float dl = length(dir);
                if (dl > 0.0001) {
                    float bd = abs(dot(warped - (bp + pt) * 0.5, dir / dl));
                    edge = smin(edge, bd, k);
                }
            }
        }

        // Container borders — smin with border SDF
        float borderDist = 1.0;
        for (int i = 0; i < 16; i++) {
            if (i >= count) break;
            vec4 c = getContainer(i);
            if (c.z <= 0.0 || c.w <= 0.0) continue;
            float bd = abs(boxSdf(warped, c.xy, c.xy + c.zw));
            borderDist = smin(borderDist, bd, k * 0.8);
        }

        // Combine Voronoi edges + container borders
        float combined = smin(edge, borderDist, k * 1.2);

        float w = max(u_edgeWidth, 0.002);
        intensity = 1.0 - smoothstep(0.0, w, combined);

    } else {
        // --- Fallback: free-form Voronoi mesh ---
        float warpAmt = max(u_warpStrength, 0.0);
        float wf = max(u_warpFreq, 0.5);
        vec2 q2 = vec2(
            fbm(uv * wf + vec2(0.0, 0.0) + t * 0.05),
            fbm(uv * wf + vec2(5.2, 1.3) + t * 0.06)
        );
        vec2 r2 = vec2(
            fbm(uv * wf + 4.0 * q2 + vec2(1.7, 9.2) + t * 0.07),
            fbm(uv * wf + 4.0 * q2 + vec2(8.3, 2.8) + t * 0.08)
        );
        vec2 warpedUv = uv + warpAmt * (r2 - 0.5);

        float sc = max(u_scale, 1.0);
        vec2 fp = warpedUv * sc;
        fp.x *= aspect;
        vec2 ip = floor(fp);
        vec2 fpFrac = fract(fp);
        float k = max(u_sminK, 0.001);

        // Pass 1: nearest seed among the 3x3 neighborhood
        float best = 1e10;
        vec2 bp = vec2(0.0);
        for (int y = -1; y <= 1; y++) {
            for (int x = -1; x <= 1; x++) {
                vec2 wp = fallbackCellPoint(vec2(float(x), float(y)), t);
                vec2 diff = wp - fpFrac;
                float d = dot(diff, diff);
                if (d < best) { best = d; bp = wp; }
            }
        }

        // Pass 2: exact edge distance via bisectors paired with the nearest
        float fallbackEdge = 1e10;
        for (int y = -1; y <= 1; y++) {
            for (int x = -1; x <= 1; x++) {
                vec2 wp = fallbackCellPoint(vec2(float(x), float(y)), t);
                vec2 dir = wp - bp;
                float dl = length(dir);
                if (dl > 0.0001) {
                    float dd = abs(dot(fpFrac - (bp + wp) * 0.5, dir / dl));
                    fallbackEdge = smin(fallbackEdge, dd, k);
                }
            }
        }

        float w = max(u_edgeWidth, 0.002);
        intensity = 1.0 - smoothstep(0.0, w, fallbackEdge);
    }

    gl_FragColor = vec4(vec3(intensity), 1.0);
}
