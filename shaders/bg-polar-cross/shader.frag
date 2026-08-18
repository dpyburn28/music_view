// Four-fold polar topology: concentric ripples warped into crosses / split blobs.
// Built-in: u_time, u_resolution, v_uv  (do not redeclare)

uniform float u_freq_a;
uniform float u_freq_b;
uniform float u_lobe;
uniform float u_fold;
uniform float u_threshold;
uniform float u_edge;
uniform float u_invert;
uniform float u_speed;

void main() {
    // Control surface (also exposed as uniforms).
    float freqA = max(u_freq_a, 0.2);
    float freqB = max(u_freq_b, 0.2);
    float lobeAmp = max(u_lobe, 0.0);
    float fold = max(floor(u_fold + 0.5), 2.0);
    float thresh = clamp(u_threshold, 0.0, 1.0);
    float t = u_time * max(u_speed, 0.0);

    // 1. Centered [-1,1] UV, aspect-corrected, then polar (r, theta).
    vec2 res = max(u_resolution, vec2(1.0));
    vec2 uv = (v_uv * 2.0 - 1.0) * vec2(res.x / res.y, 1.0);
    float r = length(uv);
    float theta = atan(uv.y, uv.x);

    // 2. Periodic field + polar advection.
    //    Concentric waves: sin(r * freq - time).
    //    4-fold warp: sin(theta * fold) stretches rings into crosses
    //    and pinches them into splitting blobs.
    // cos(fold * theta) peaks on the cardinal axes (matches the still).
    float ang = cos(theta * fold);
    float f1 = sin(r * freqA - t * 1.55) + lobeAmp * ang;
    float f2 = sin(r * freqB - t * 2.15 + 1.2) + lobeAmp * 0.55 * cos(theta * fold + 0.65);
    float f = 0.5 + 0.38 * f1 + 0.22 * f2;

    // Keep energy toward the center so the field reads as discrete
    // satellites, not full-screen rings.
    float envelope = smoothstep(1.25, 0.08, r);
    f = mix(0.35, f, envelope);

    // Breathing core disk — the still's central blob.
    float coreR = 0.145 + 0.03 * sin(t * 0.85);
    f = max(f, (1.0 - smoothstep(coreR - 0.01, coreR + 0.01, r)) * 0.95);

    // 3. Implicit surface → hard 1-bit (optional hairline halo via u_edge).
    float edge = max(u_edge, 0.0);
    float ink;
    if (edge < 0.0005) {
        ink = step(thresh, f);
    } else {
        ink = smoothstep(thresh - edge, thresh + edge, f);
    }

    float col = 1.0 - ink;
    if (u_invert > 0.5) col = 1.0 - col;

    gl_FragColor = vec4(vec3(col), 1.0);
}
