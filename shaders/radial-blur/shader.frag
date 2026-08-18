// Postprocess: radial zoom / spin blur (multi-tap along rays).
// Built-in: u_time, u_resolution, v_uv
// Required: u_scene

uniform sampler2D u_scene;
uniform float u_amount;
uniform float u_samples;
uniform float u_spin;
uniform float u_center_x;
uniform float u_center_y;
uniform float u_intensity;

vec3 sampleScene(vec2 uv) {
    return texture2D(u_scene, clamp(uv, 0.0, 1.0)).rgb;
}

void main() {
    vec3 original = sampleScene(v_uv);
    float m = clamp(u_intensity, 0.0, 1.0);
    float amt = max(u_amount, 0.0) * m;
    if (amt < 0.0001) {
        gl_FragColor = vec4(original, 1.0);
        return;
    }

    vec2 center = vec2(clamp(u_center_x, 0.0, 1.0), clamp(u_center_y, 0.0, 1.0));
    vec2 dir = v_uv - center;
    float n = clamp(floor(u_samples + 0.5), 3.0, 12.0);
    float spin = u_spin * amt;

    vec3 acc = original;
    float wsum = 1.0;

    for (float i = 1.0; i <= 12.0; i += 1.0) {
        if (i > n + 0.5) break;
        float t = i / n;
        float z = 1.0 + amt * t * 0.35;
        float a = spin * t;
        float c = cos(a);
        float s = sin(a);
        vec2 p = dir;
        p = vec2(c * p.x - s * p.y, s * p.x + c * p.y) / z;
        float w = 1.0 - t * 0.65;
        acc += sampleScene(center + p) * w;
        wsum += w;
    }

    vec3 col = acc / max(wsum, 0.0001);
    gl_FragColor = vec4(mix(original, col, m), 1.0);
}
