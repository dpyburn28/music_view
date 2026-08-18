// Stylized floral motherboard: green PCB, spinning platter, swaying flowers.
// Built-in: u_time, u_resolution, v_uv

uniform float u_bloom;
uniform float u_trace_glow;
uniform float u_spin;
uniform vec3 u_board;
uniform vec3 u_trace;
uniform float u_speed;

float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

vec2 hash22(vec2 p) {
    float n = hash21(p);
    return vec2(n, hash21(p + 17.3));
}

float sdBox(vec2 p, vec2 b) {
    vec2 d = abs(p) - b;
    return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

float sdRoundBox(vec2 p, vec2 b, float r) {
    return sdBox(p, b - r) - r;
}

float sdCircle(vec2 p, float r) {
    return length(p) - r;
}

float sdCapsule(vec2 p, vec2 a, vec2 b, float r) {
    vec2 pa = p - a;
    vec2 ba = b - a;
    float h = clamp(dot(pa, ba) / max(dot(ba, ba), 0.0001), 0.0, 1.0);
    return length(pa - ba * h) - r;
}

float sdEllipse(vec2 p, vec2 r) {
    vec2 q = p / max(r, vec2(0.0001));
    return (length(q) - 1.0) * min(r.x, r.y);
}

float smin(float a, float b, float k) {
    float h = clamp(0.5 + 0.5 * (b - a) / max(k, 0.0001), 0.0, 1.0);
    return mix(b, a, h) - k * h * (1.0 - h);
}

float sdFlower(vec2 p, float r, float petals, float rot) {
    float d = 1e3;
    for (float i = 0.0; i < 6.0; i += 1.0) {
        if (i >= petals) break;
        float a = rot + i * 6.2831853 / max(petals, 1.0);
        vec2 c = vec2(cos(a), sin(a)) * r * 0.52;
        d = min(d, length(p - c) - r * 0.46);
    }
    return d;
}

void chip(inout vec3 col, vec2 p, vec2 c, vec2 halfSize, float pinPitch) {
    vec2 q = p - c;
    float body = sdRoundBox(q, halfSize, 0.006);
    if (body < 0.012) {
        float ink = 1.0 - smoothstep(-0.001, 0.002, body);
        vec3 pack = vec3(0.12, 0.13, 0.14);
        vec3 rim = vec3(0.22, 0.23, 0.24);
        float edge = smoothstep(0.0, 0.006, -body) * (1.0 - smoothstep(0.004, 0.01, -body));
        col = mix(col, mix(pack, rim, edge), ink);
        // Pin rows on left/right.
        float pins = 0.0;
        float py = (q.y + halfSize.y) / max(pinPitch, 0.004);
        float prow = abs(fract(py) - 0.5);
        pins = (1.0 - smoothstep(0.18, 0.32, prow))
            * (1.0 - smoothstep(0.0, 0.006, abs(abs(q.x) - halfSize.x - 0.004)));
        pins *= step(abs(q.y), halfSize.y - 0.004);
        col = mix(col, vec3(0.55, 0.52, 0.42), pins);
        // Fake legend mark.
        float mark = 1.0 - smoothstep(0.0, 0.003, sdBox(q - vec2(0.0, halfSize.y * 0.15), halfSize * vec2(0.45, 0.08)));
        col = mix(col, pack * 0.55, mark * ink * 0.8);
    }
}

void main() {
    vec2 res = max(u_resolution, vec2(1.0));
    float aspect = res.x / res.y;
    vec2 uv = v_uv;
    vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
    float t = u_time * max(u_speed, 0.0);

    vec3 board = u_board;
    vec3 traceCol = u_trace;
    float glow = clamp(u_trace_glow, 0.0, 1.0);
    float bloom = clamp(u_bloom, 0.0, 1.0);

    // --- Regions ---
    vec2 platterC = vec2(0.0, -0.06);
    float platterR = 0.175;
    float dPlatter = sdCircle(p - platterC, platterR);
    float pcbMask = smoothstep(-0.02, 0.04, p.y + 0.02);
    // Soft bite where the platter sits over the board.
    pcbMask *= smoothstep(-0.01, 0.02, dPlatter + 0.01);

    // Black drive bay with oval pockets.
    vec3 bay = vec3(0.05, 0.05, 0.055);
    float pockets = 1e3;
    pockets = min(pockets, sdEllipse(p - vec2(-0.12, -0.32), vec2(0.13, 0.08)));
    pockets = min(pockets, sdEllipse(p - vec2(0.10, -0.30), vec2(0.14, 0.09)));
    pockets = min(pockets, sdEllipse(p - vec2(-0.02, -0.42), vec2(0.16, 0.07)));
    float pocketShade = smoothstep(0.02, -0.01, pockets);
    vec3 col = mix(vec3(0.07, 0.07, 0.075), bay * 0.55, pocketShade);
    // Slight plastic grain.
    col += (hash21(uv * 180.0) - 0.5) * 0.02;

    // --- PCB ---
    if (pcbMask > 0.001) {
        vec3 pcb = board;
        // Mask texture.
        pcb *= 0.92 + 0.08 * hash21(floor(p * 90.0));

        // Manhattan traces.
        vec2 gp = p * 22.0 + vec2(0.0, 2.4);
        vec2 cell = floor(gp);
        vec2 f = fract(gp);
        float h = hash21(cell);
        float pulse = 0.55 + 0.45 * sin(t * 1.4 + hash21(cell + 3.0) * 6.28318);
        float tw = 0.035;
        float tr = 1e3;
        if (h < 0.42) {
            tr = abs(f.y - 0.5) - tw;
        } else if (h < 0.80) {
            tr = abs(f.x - 0.5) - tw;
        } else if (h < 0.93) {
            tr = min(abs(f.x - 0.5), abs(f.y - 0.5)) - tw;
        }
        float pad = sdCircle(f - 0.5, mix(0.0, 0.11, step(0.78, hash21(cell + 8.1))));
        tr = min(tr, pad);
        float traceInk = 1.0 - smoothstep(0.0, 0.025, tr);
        pcb = mix(pcb, traceCol, traceInk * 0.75);
        pcb += traceCol * traceInk * glow * 0.28 * pulse;

        // Silkscreen-ish hash dashes.
        float silk = step(0.97, hash21(floor(p * 40.0)));
        pcb = mix(pcb, vec3(0.78, 0.8, 0.74), silk * 0.35);

        col = mix(col, pcb, pcbMask);

        // Chips.
        chip(col, p, vec2(0.03, 0.22), vec2(0.095, 0.08), 0.014);
        chip(col, p, vec2(-0.10, 0.07), vec2(0.055, 0.038), 0.012);
        chip(col, p, vec2(0.17, 0.03), vec2(0.048, 0.032), 0.011);
        chip(col, p, vec2(0.16, 0.18), vec2(0.03, 0.022), 0.01);

        // Passives (small 0603s).
        for (float i = 0.0; i < 10.0; i += 1.0) {
            vec2 rnd = hash22(vec2(i, 4.2));
            vec2 pc = vec2((rnd.x - 0.5) * 0.48, mix(0.02, 0.38, rnd.y));
            if (sdCircle(pc - platterC, platterR + 0.02) < 0.0) continue;
            float d = sdRoundBox(p - pc, vec2(0.014, 0.006), 0.001);
            float ink = 1.0 - smoothstep(0.0, 0.002, d);
            vec3 body = mix(vec3(0.08), vec3(0.55, 0.22, 0.08), step(0.5, hash21(vec2(i, 9.0))));
            col = mix(col, body, ink * pcbMask);
        }
    }

    // --- Platter ---
    float platInk = 1.0 - smoothstep(0.0, 0.004, dPlatter);
    if (platInk > 0.001) {
        vec2 lp = p - platterC;
        float ang = atan(lp.y, lp.x) + t * u_spin;
        float rad = length(lp);
        float rings = 0.5 + 0.5 * sin(rad * 92.0);
        float brush = 0.5 + 0.5 * sin(ang * 2.0 + rad * 14.0);
        vec3 metal = mix(vec3(0.52, 0.53, 0.55), vec3(0.86, 0.86, 0.87), rings * 0.4 + brush * 0.22);
        // Hub.
        float hub = sdCircle(lp, 0.055);
        metal = mix(metal, vec3(0.55, 0.56, 0.58), 1.0 - smoothstep(0.0, 0.006, hub));
        // Screw dimples.
        for (float k = 0.0; k < 4.0; k += 1.0) {
            float a = k * 1.5708 + 0.4 + t * u_spin;
            float screw = sdCircle(lp - vec2(cos(a), sin(a)) * 0.11, 0.008);
            metal = mix(metal, vec3(0.25), 1.0 - smoothstep(0.0, 0.003, screw));
        }
        // Implied legend (dark arcs, not real type).
        float legend = abs(rad - 0.09) - 0.008;
        legend = max(legend, abs(mod(ang + 3.14159, 6.28318) - 3.2) - 1.1);
        metal = mix(metal, vec3(0.12), 1.0 - smoothstep(0.0, 0.004, legend));
        col = mix(col, metal, platInk);
        // Rim.
        float rim = abs(dPlatter) - 0.003;
        col = mix(col, vec3(0.62), (1.0 - smoothstep(0.0, 0.003, rim)) * platInk);
    }

    // Orange flex ribbon.
    vec2 fa = platterC + vec2(-0.055, -0.015);
    vec2 fb = platterC + vec2(-0.16, -0.13);
    vec2 fc = platterC + vec2(-0.07, -0.175);
    float flex = sdCapsule(p, fa, fb, 0.013);
    flex = smin(flex, sdCapsule(p, fb, fc, 0.011), 0.012);
    float flexInk = 1.0 - smoothstep(0.0, 0.002, flex);
    vec3 flexCol = vec3(0.82, 0.42, 0.14);
    // Conductor lines.
    vec2 along = normalize(fb - fa);
    vec2 perp = vec2(-along.y, along.x);
    float lanes = abs(fract(dot(p - fa, perp) * 28.0) - 0.5);
    flexCol = mix(flexCol, vec3(0.45, 0.2, 0.06), 1.0 - smoothstep(0.12, 0.28, lanes));
    col = mix(col, flexCol, flexInk * 0.95);

    // Connector block on the left of the board.
    float conn = sdRoundBox(p - vec2(-0.22, 0.02), vec2(0.03, 0.018), 0.003);
    col = mix(col, vec3(0.82, 0.82, 0.8), (1.0 - smoothstep(0.0, 0.002, conn)) * pcbMask);

    // --- Flowers ---
    if (bloom > 0.001) {
        // Hand-placed cluster so the still-life reads, plus a hashed spray.
        // pos.xy, radius, kind (0 white, 1 yellow, 2 violet)
        for (float i = 0.0; i < 16.0; i += 1.0) {
            vec2 rnd = hash22(vec2(i, 1.7));
            vec2 fp;
            float rad;
            float kind;
            if (i < 8.0) {
                // Composed positions (portrait still-life).
                if (i < 0.5)      { fp = vec2(-0.18, 0.36); rad = 0.034; kind = 0.0; }
                else if (i < 1.5) { fp = vec2(0.16, 0.34);  rad = 0.038; kind = 1.0; }
                else if (i < 2.5) { fp = vec2(0.20, 0.22);  rad = 0.030; kind = 2.0; }
                else if (i < 3.5) { fp = vec2(-0.02, 0.12); rad = 0.032; kind = 0.0; }
                else if (i < 4.5) { fp = vec2(0.04, -0.02); rad = 0.036; kind = 2.0; }
                else if (i < 5.5) { fp = vec2(-0.10, -0.18);rad = 0.030; kind = 0.0; }
                else if (i < 6.5) { fp = vec2(0.08, -0.34); rad = 0.040; kind = 1.0; }
                else              { fp = vec2(0.18, -0.40); rad = 0.036; kind = 0.0; }
            } else {
                if (rnd.x > bloom) continue;
                fp = vec2((rnd.x - 0.5) * 0.52, (rnd.y - 0.5) * 0.92);
                rad = mix(0.018, 0.032, hash21(vec2(i, 3.3)));
                kind = floor(hash21(vec2(i, 8.8)) * 3.0);
            }

            float sway = 0.012 * sin(t * 1.1 + i * 1.7);
            float swayY = 0.008 * sin(t * 0.9 + i * 2.1);
            vec2 fq = p - fp - vec2(sway, swayY);
            float rot = 0.4 * sin(t * 0.6 + i) + i * 0.7;
            float petals = kind > 1.5 ? 5.0 : (kind > 0.5 ? 4.0 : 5.0);
            float d = sdFlower(fq, rad, petals, rot);
            // Stem / sepal.
            float sepal = sdCircle(fq, rad * 0.18);
            float ink = 1.0 - smoothstep(0.0, 0.003, d);
            if (ink < 0.001 && sepal > 0.004) continue;

            vec3 petalC = vec3(0.93, 0.93, 0.9);
            vec3 coreC = vec3(0.82, 0.72, 0.25);
            if (kind > 0.5 && kind < 1.5) {
                petalC = vec3(0.92, 0.78, 0.12);
                coreC = vec3(0.55, 0.28, 0.08);
            } else if (kind > 1.5) {
                petalC = vec3(0.62, 0.45, 0.82);
                coreC = vec3(0.35, 0.18, 0.45);
            }
            float core = 1.0 - smoothstep(0.0, 0.003, sepal);
            col = mix(col, petalC, ink * bloom);
            col = mix(col, coreC, core * bloom);
            // Soft contact shadow.
            float sh = 1.0 - smoothstep(0.0, rad * 1.4, length(p - fp - vec2(0.006, -0.008)));
            col *= 1.0 - sh * 0.12 * bloom * (1.0 - ink);
        }

        // Ladybug crawling on the yellow bloom near the platter.
        vec2 bugHome = vec2(0.0, 0.05);
        float crawl = t * 0.35;
        vec2 bugP = bugHome + vec2(cos(crawl), sin(crawl * 1.3)) * 0.028;
        vec2 bq = p - bugP;
        float body = sdEllipse(bq, vec2(0.011, 0.008));
        float head = sdCircle(bq - vec2(0.01, 0.0), 0.0045);
        float bug = min(body, head);
        float bugInk = 1.0 - smoothstep(0.0, 0.002, bug);
        vec3 bugC = vec3(0.72, 0.12, 0.08);
        // Spots + split.
        float split = 1.0 - smoothstep(0.0, 0.0015, abs(bq.y) - 0.0008);
        float spots = 0.0;
        spots = max(spots, 1.0 - smoothstep(0.0, 0.0012, sdCircle(bq - vec2(-0.003, 0.0035), 0.0022)));
        spots = max(spots, 1.0 - smoothstep(0.0, 0.0012, sdCircle(bq - vec2(-0.003, -0.0035), 0.0020)));
        spots = max(spots, 1.0 - smoothstep(0.0, 0.0012, sdCircle(bq - vec2(0.004, 0.0), 0.0016)));
        bugC = mix(bugC, vec3(0.06), max(split * 0.8, spots));
        bugC = mix(bugC, vec3(0.08), 1.0 - smoothstep(0.0, 0.002, head));
        col = mix(col, bugC, bugInk * bloom);
    }

    // Soft top light.
    col *= 0.88 + 0.14 * smoothstep(-0.5, 0.45, p.y);

    gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
