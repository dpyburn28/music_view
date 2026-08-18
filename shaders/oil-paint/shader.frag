// Postprocess: painterly oil look via quadrant averages (cheap kuwahara-ish).
// Built-in: u_time, u_resolution, v_uv
// Required: u_scene

uniform sampler2D u_scene;
uniform float u_radius;
uniform float u_levels;
uniform float u_smooth;
uniform float u_intensity;

float luma(vec3 c) {
    return dot(c, vec3(0.299, 0.587, 0.114));
}

vec3 sampleScene(vec2 uv) {
    return texture2D(u_scene, clamp(uv, 0.0, 1.0)).rgb;
}

void accumulateQuad(
    vec2 uv, vec2 px, float rad, float qx0, float qx1, float qy0, float qy1,
    out vec3 acc, out float accL, out float accL2, out float cnt
) {
    acc = vec3(0.0);
    accL = 0.0;
    accL2 = 0.0;
    cnt = 0.0;
    for (float y = -3.0; y <= 3.0; y += 1.0) {
        for (float x = -3.0; x <= 3.0; x += 1.0) {
            if (x < qx0 || x > qx1 || y < qy0 || y > qy1) continue;
            if (abs(x) > rad + 0.01 || abs(y) > rad + 0.01) continue;
            vec3 s = sampleScene(uv + px * vec2(x, y) * rad * 0.55);
            float lv = luma(s);
            acc += s;
            accL += lv;
            accL2 += lv * lv;
            cnt += 1.0;
        }
    }
}

void main() {
    vec3 original = sampleScene(v_uv);
    float m = clamp(u_intensity, 0.0, 1.0);
    if (m < 0.0001) {
        gl_FragColor = vec4(original, 1.0);
        return;
    }

    vec2 px = 1.0 / max(u_resolution, vec2(1.0));
    float rad = max(u_radius, 0.5);
    float levels = max(floor(u_levels + 0.5), 2.0);

    vec3 a0, a1, a2, a3;
    float l0, l1, l2, l3, l20, l21, l22, l23, c0, c1, c2, c3;
    accumulateQuad(v_uv, px, rad, 0.0, 3.0, 0.0, 3.0, a0, l0, l20, c0);
    accumulateQuad(v_uv, px, rad, -3.0, 0.0, 0.0, 3.0, a1, l1, l21, c1);
    accumulateQuad(v_uv, px, rad, -3.0, 0.0, -3.0, 0.0, a2, l2, l22, c2);
    accumulateQuad(v_uv, px, rad, 0.0, 3.0, -3.0, 0.0, a3, l3, l23, c3);

    float bestVar = 1e9;
    vec3 best = original;

    float n = max(c0, 1.0);
    float mean = l0 / n;
    float vr = max(l20 / n - mean * mean, 0.0);
    if (vr < bestVar) { bestVar = vr; best = a0 / n; }

    n = max(c1, 1.0);
    mean = l1 / n;
    vr = max(l21 / n - mean * mean, 0.0);
    if (vr < bestVar) { bestVar = vr; best = a1 / n; }

    n = max(c2, 1.0);
    mean = l2 / n;
    vr = max(l22 / n - mean * mean, 0.0);
    if (vr < bestVar) { bestVar = vr; best = a2 / n; }

    n = max(c3, 1.0);
    mean = l3 / n;
    vr = max(l23 / n - mean * mean, 0.0);
    if (vr < bestVar) { bestVar = vr; best = a3 / n; }

    best = floor(best * levels + 0.5) / levels;

    float sm = clamp(u_smooth, 0.0, 1.0);
    vec3 soft = (
        sampleScene(v_uv + px * vec2(1.0, 0.0)) +
        sampleScene(v_uv - px * vec2(1.0, 0.0)) +
        sampleScene(v_uv + px * vec2(0.0, 1.0)) +
        sampleScene(v_uv - px * vec2(0.0, 1.0))
    ) * 0.25;
    vec3 col = mix(best, soft, sm * 0.2);
    col = clamp(col, 0.0, 1.0);

    gl_FragColor = vec4(mix(original, col, m), 1.0);
}
