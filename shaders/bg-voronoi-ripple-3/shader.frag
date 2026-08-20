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

// Try to insert a point into the nearest-3 tracking
void trackNearest(vec2 pt, vec2 warped,
    inout float f1, inout float f2, inout float f3,
    inout vec2 b1, inout vec2 b2, inout vec2 b3) {
    vec2 diff = pt - warped;
    float d = dot(diff, diff);
    if (d < f1) {
        f3 = f2; b3 = b2;
        f2 = f1; b2 = b1;
        f1 = d; b1 = pt;
    } else if (d < f2) {
        f3 = f2; b3 = b2;
        f2 = d; b2 = pt;
    } else if (d < f3) {
        f3 = d; b3 = pt;
    }
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

        // Find 3 nearest feature points — generated directly on container perimeters
        float f1 = 1e10, f2 = 1e10, f3 = 1e10;
        vec2 b1 = vec2(0.0), b2 = vec2(0.0), b3 = vec2(0.0);

        for (int i = 0; i < 16; i++) {
            if (i >= count) break;
            vec4 c = getContainer(i);
            if (c.z <= 0.0 || c.w <= 0.0) continue;

            vec2 center = c.xy + c.zw * 0.5;

            // 2 points per container on its perimeter, offset by phase
            float t0 = fract(hash21(vec2(float(i), 5.3)) + u_phase);
            vec2 pt0 = perimeterPoint(c, t0);
            pt0 = mix(pt0, center, 0.08);
            trackNearest(pt0, warped, f1, f2, f3, b1, b2, b3);

            float t1 = fract(hash21(vec2(float(i), 11.7)) + u_phase);
            vec2 pt1 = perimeterPoint(c, t1);
            pt1 = mix(pt1, center, 0.08);
            trackNearest(pt1, warped, f1, f2, f3, b1, b2, b3);
        }

        // Voronoi edge distances via perpendicular bisectors
        float e12 = 1.0;
        vec2 dir12 = b2 - b1;
        if (length(dir12) > 0.001)
            e12 = abs(dot(warped - (b1 + b2) * 0.5, normalize(dir12)));

        float e13 = 1.0;
        vec2 dir13 = b3 - b1;
        if (length(dir13) > 0.001)
            e13 = abs(dot(warped - (b1 + b3) * 0.5, normalize(dir13)));

        // smin blend for organic pinching at junctions
        float edge = smin(e12, e13, max(u_sminK, 0.01));

        // Container borders — smin with border SDF
        float borderDist = 1.0;
        for (int i = 0; i < 16; i++) {
            if (i >= count) break;
            vec4 c = getContainer(i);
            if (c.z <= 0.0 || c.w <= 0.0) continue;
            float bd = abs(boxSdf(warped, c.xy, c.xy + c.zw));
            borderDist = smin(borderDist, bd, max(u_sminK, 0.01) * 0.8);
        }

        // Combine Voronoi edges + container borders
        float combined = smin(edge, borderDist, max(u_sminK, 0.01) * 1.2);

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

        float ff1 = 1e10, ff2 = 1e10, ff3 = 1e10;
        vec2 fb1 = vec2(0.0), fb2 = vec2(0.0), fb3 = vec2(0.0);

        for (int y = -1; y <= 1; y++) {
            for (int x = -1; x <= 1; x++) {
                vec2 neighbor = vec2(float(x), float(y));
                vec2 cell = ip + neighbor;
                vec2 seed = hash22(cell);
                float ph1 = seed.x * 6.2831;
                float ph2 = seed.y * 6.2831;
                float ph3 = hash21(cell + 7.7) * 6.2831;
                float ph4 = hash21(cell + 13.1) * 6.2831;
                vec2 pt = vec2(
                    0.5 + sin(t * 0.3 + ph1) * 0.22 + cos(t * 0.17 + ph2) * 0.16,
                    0.5 + cos(t * 0.23 + ph3) * 0.22 + sin(t * 0.13 + ph4) * 0.16
                );
                vec2 diff = neighbor + pt - fpFrac;
                float d = dot(diff, diff);
                if (d < ff1) { ff3 = ff2; fb3 = fb2; ff2 = ff1; fb2 = fb1; ff1 = d; fb1 = ip + neighbor + pt; }
                else if (d < ff2) { ff3 = ff2; fb3 = fb2; ff2 = d; fb2 = ip + neighbor + pt; }
                else if (d < ff3) { ff3 = d; fb3 = ip + neighbor + pt; }
            }
        }

        float ee12 = 1.0;
        vec2 dd12 = fb2 - fb1;
        if (length(dd12) > 0.001) ee12 = abs(dot(fpFrac - (fb1 + fb2) * 0.5, normalize(dd12)));
        float ee13 = 1.0;
        vec2 dd13 = fb3 - fb1;
        if (length(dd13) > 0.001) ee13 = abs(dot(fpFrac - (fb1 + fb3) * 0.5, normalize(dd13)));

        float fallbackEdge = smin(ee12, ee13, max(u_sminK, 0.01));
        float w = max(u_edgeWidth, 0.002);
        intensity = 1.0 - smoothstep(0.0, w, fallbackEdge);
    }

    gl_FragColor = vec4(vec3(intensity), 1.0);
}
