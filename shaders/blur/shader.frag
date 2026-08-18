// Postprocess: multi-tap box blur (cross + diagonals).
// Built-in: u_time, u_resolution, v_uv
// Required: u_scene

uniform sampler2D u_scene;
uniform float u_radius;
uniform float u_quality;
uniform float u_intensity;

vec3 sampleScene(vec2 uv) {
    return texture2D(u_scene, clamp(uv, 0.0, 1.0)).rgb;
}

void main() {
    vec3 original = sampleScene(v_uv);
    float radius = max(u_radius, 0.0);
    float m = clamp(u_intensity, 0.0, 1.0);

    if (radius < 0.001 || m < 0.001) {
        gl_FragColor = vec4(original, 1.0);
        return;
    }

    float ringsF = clamp(floor(u_quality + 0.5), 1.0, 5.0);
    vec3 acc = original;
    float wsum = 1.0;

    for (float r = 1.0; r <= 5.0; r += 1.0) {
        if (r > ringsF + 0.5) break;
        float dist = radius * r;
        float w = 1.0 / (1.0 + r * 0.65);
        vec2 d = vec2(dist) / max(u_resolution, vec2(1.0));

        acc += sampleScene(v_uv + vec2(d.x, 0.0)) * w;
        acc += sampleScene(v_uv - vec2(d.x, 0.0)) * w;
        acc += sampleScene(v_uv + vec2(0.0, d.y)) * w;
        acc += sampleScene(v_uv - vec2(0.0, d.y)) * w;

        vec2 diag = d * 0.7071;
        acc += sampleScene(v_uv + vec2(diag.x, diag.y)) * w * 0.75;
        acc += sampleScene(v_uv + vec2(-diag.x, diag.y)) * w * 0.75;
        acc += sampleScene(v_uv + vec2(diag.x, -diag.y)) * w * 0.75;
        acc += sampleScene(v_uv + vec2(-diag.x, -diag.y)) * w * 0.75;

        wsum += w * 4.0 + w * 0.75 * 4.0;
    }

    vec3 blurred = acc / max(wsum, 0.0001);
    gl_FragColor = vec4(mix(original, blurred, m), 1.0);
}
