// Utility: approximate pixel-sort glitch along H or V by thresholded luma runs.
// Built-in: u_time, u_resolution, v_uv · Required: u_scene

uniform sampler2D u_scene;
uniform float u_amount;
uniform float u_threshold;
uniform float u_length;
uniform float u_axis;
uniform float u_invert;
uniform float u_intensity;

float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

vec3 sampleScene(vec2 uv) {
    return texture2D(u_scene, clamp(uv, 0.0, 1.0)).rgb;
}

void main() {
    vec3 original = sampleScene(v_uv);
    float m = clamp(u_intensity, 0.0, 1.0);
    float amt = clamp(u_amount, 0.0, 1.0);
    if (amt * m < 0.0001) {
        gl_FragColor = vec4(original, 1.0);
        return;
    }

    float thr = clamp(u_threshold, 0.0, 1.0);
    float len = max(u_length, 2.0);
    float axis = floor(u_axis + 0.5);
    float inv = step(0.5, u_invert);

    // Walk along axis collecting max-luma sample within a run (cheap sort proxy)
    vec2 dir = axis < 0.5 ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec2 px = dir / max(u_resolution, vec2(1.0));

    float l0 = luma(original);
    float active = inv > 0.5 ? step(l0, thr) : step(thr, l0);
    if (active < 0.5) {
        gl_FragColor = vec4(original, 1.0);
        return;
    }

    vec3 best = original;
    float bestL = l0;
    vec3 worst = original;
    float worstL = l0;

    for (float i = 1.0; i <= 24.0; i += 1.0) {
        if (i > len + 0.5) break;
        vec3 s = sampleScene(v_uv + px * i);
        float ls = luma(s);
        float a = inv > 0.5 ? step(ls, thr) : step(thr, ls);
        if (a < 0.5) break;
        if (ls > bestL) { bestL = ls; best = s; }
        if (ls < worstL) { worstL = ls; worst = s; }
        s = sampleScene(v_uv - px * i);
        ls = luma(s);
        a = inv > 0.5 ? step(ls, thr) : step(thr, ls);
        if (a < 0.5) continue;
        if (ls > bestL) { bestL = ls; best = s; }
        if (ls < worstL) { worstL = ls; worst = s; }
    }

    // Map position along run to sorted-ish value: bright end vs dark end
    float t = fract((axis < 0.5 ? v_uv.x : v_uv.y) * 10.0 + bestL * 3.0);
    vec3 sorted = mix(worst, best, smoothstep(0.0, 1.0, t));
    vec3 col = mix(original, sorted, amt);

    gl_FragColor = vec4(mix(original, col, m), 1.0);
}
