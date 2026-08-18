// Utility: multi-echo spatial ghost (sample offsets) — no feedback required.
uniform sampler2D u_scene;
uniform float u_amount;
uniform float u_distance;
uniform float u_angle;
uniform float u_echoes;
uniform float u_decay;
uniform float u_intensity;

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

    float n = clamp(floor(u_echoes + 0.5), 1.0, 6.0);
    vec2 dir = vec2(cos(u_angle), sin(u_angle)) * max(u_distance, 0.0) * 0.08;
    float decay = clamp(u_decay, 0.1, 0.95);

    vec3 acc = original;
    float wsum = 1.0;
    float w = 1.0;
    for (float i = 1.0; i <= 6.0; i += 1.0) {
        if (i > n + 0.5) break;
        w *= decay;
        acc += sampleScene(v_uv + dir * i) * w;
        acc += sampleScene(v_uv - dir * i) * w * 0.65;
        wsum += w + w * 0.65;
    }
    vec3 col = mix(original, acc / max(wsum, 0.0001), amt);
    gl_FragColor = vec4(mix(original, col, m), 1.0);
}
