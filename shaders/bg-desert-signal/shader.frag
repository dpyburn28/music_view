// Desert sky + dunes with raining 1-bit digital debris.
// Built-in: u_time, u_resolution, v_uv

uniform float u_sun;
uniform float u_cloud;
uniform float u_horizon;
uniform float u_debris;
uniform vec3 u_sky;
uniform vec3 u_sand;
uniform float u_speed;

float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

vec2 hash22(vec2 p) {
    float n = hash21(p);
    return vec2(n, hash21(p + 19.2));
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
        p = p * 2.05 + vec2(1.7, 9.2);
        a *= 0.5;
    }
    return v;
}

void main() {
    vec2 uv = v_uv;
    float t = u_time * max(u_speed, 0.0);
    float aspect = u_resolution.x / max(u_resolution.y, 1.0);

    float horizon = clamp(u_horizon, 0.05, 0.7);
    vec2 sunPos = vec2(0.16, 0.90);
    float sunAmt = max(u_sun, 0.0);
    float cloudAmt = max(u_cloud, 0.0);
    float y = uv.y;
    float x = uv.x;

    float farDune = horizon + 0.07
        + 0.04 * sin(x * 3.4 + 0.6)
        + 0.02 * sin(x * 8.0 + 1.4);
    float nearDune = horizon + 0.01
        + 0.085 * sin(x * 2.6 + 2.4)
        + 0.03 * sin(x * 6.5 + 0.3)
        + 0.012 * fbm(vec2(x * 5.0, 1.8));

    vec3 skyLo = mix(u_sky, vec3(0.86, 0.74, 0.52), 0.78);
    vec3 col = mix(skyLo, u_sky, smoothstep(horizon, 0.98, y));

    vec2 suv = (uv - sunPos) * vec2(aspect, 1.0);
    float sd = length(suv);
    float sun = (exp(-sd * 7.0) + 0.45 * exp(-sd * 1.8)) * sunAmt;
    sun *= 1.0 + 0.05 * sin(t * 0.75);
    col += vec3(1.0, 0.97, 0.88) * sun;
    col = mix(col, vec3(1.0), smoothstep(0.14, 0.0, sd) * clamp(sunAmt, 0.0, 1.0));

    if (y > horizon - 0.03) {
        vec2 cuv = vec2(uv.x * aspect * 2.2, uv.y * 2.6);
        cuv.x += t * 0.03;
        float cld = fbm(cuv);
        float cld2 = fbm(cuv * 0.55 + vec2(3.1, t * 0.01));
        cld = smoothstep(0.34, 0.64, cld * 0.65 + cld2 * 0.45) * cloudAmt;
        cld *= smoothstep(horizon, horizon + 0.18, y) * smoothstep(1.02, 0.48, y);
        vec3 ccol = mix(vec3(0.58, 0.70, 0.86), vec3(0.97, 0.98, 0.99), cld);
        col = mix(col, ccol, cld * 0.92);
    }

    float sandMask = 1.0 - smoothstep(nearDune, nearDune + 0.01, y);
    float ridge = 1.0 - smoothstep(farDune, farDune + 0.012, y);
    vec3 sandFar = mix(u_sand, vec3(0.88, 0.72, 0.42), 0.4);
    float rip = 0.5 + 0.5 * sin(uv.x * 55.0 + fbm(uv * 14.0) * 3.5);
    vec3 sandNear = u_sand * (0.86 + 0.16 * rip);
    vec3 land = mix(sandNear * 0.78, mix(sandNear, sandFar, 0.45), smoothstep(nearDune - 0.05, nearDune + 0.01, y));
    col = mix(col, mix(sandFar, col, 0.12), ridge * (1.0 - sandMask));
    col = mix(col, land, sandMask);

    float debrisAmt = clamp(u_debris, 0.0, 1.0);
    if (debrisAmt > 0.001) {
        vec2 duv = uv;
        duv.y += t * 0.04;

        // Sparse large blocks / barcodes (the still's main debris).
        vec2 g1 = vec2(9.0, 16.0);
        vec2 cell = floor(duv * g1);
        vec2 f = fract(duv * g1);
        vec2 rnd = hash22(cell);
        float hold = step(0.12, hash21(cell + floor(t * 5.0)));
        if (rnd.x > 1.0 - debrisAmt * 0.14 && hold > 0.5) {
            vec2 sz = mix(vec2(0.12, 0.08), vec2(0.38, 0.32), hash22(cell + 2.4));
            vec2 c = abs(f - 0.5);
            float inBox = step(c.x, sz.x) * step(c.y, sz.y);
            float kind = rnd.y;
            float pix;
            if (kind < 0.4) {
                pix = step(0.45, hash21(cell + 8.0));
            } else if (kind < 0.75) {
                pix = step(0.5, fract(f.y * mix(5.0, 12.0, hash21(cell + 3.1))));
            } else {
                // Tiny pixel cluster, not a stalk.
                vec2 pc = floor(f * 6.0);
                pix = step(0.55, hash21(cell + pc));
            }
            col = mix(col, mix(vec3(0.03), vec3(0.96), pix), inBox);
        }

        // A few thin vertical ticks (rare).
        vec2 g2 = floor(duv * vec2(22.0, 10.0));
        vec2 r2 = hash22(g2 + 41.0);
        if (r2.x > 1.0 - debrisAmt * 0.045) {
            vec2 f2 = fract(duv * vec2(22.0, 10.0));
            float tick = step(abs(f2.x - 0.5), 0.035) * step(abs(f2.y - 0.5), mix(0.15, 0.45, r2.y));
            col = mix(col, vec3(0.04), tick);
        }
    }

    gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
