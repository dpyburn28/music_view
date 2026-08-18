// Utility: posterize combined with edge emphasis (comic / graphic novel).
uniform sampler2D u_scene;
uniform float u_levels;
uniform float u_edge;
uniform float u_edgeBoost;
uniform vec3 u_edgeColor;
uniform float u_intensity;

float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

float sampleL(vec2 uv) {
    return luma(texture2D(u_scene, clamp(uv, 0.0, 1.0)).rgb);
}

void main() {
    vec3 original = texture2D(u_scene, v_uv).rgb;
    float m = clamp(u_intensity, 0.0, 1.0);
    if (m < 0.0001) {
        gl_FragColor = vec4(original, 1.0);
        return;
    }

    float levels = max(floor(u_levels + 0.5), 2.0);
    vec3 poster = floor(original * levels + 0.5) / levels;

    vec2 px = 1.0 / max(u_resolution, vec2(1.0));
    float tl = sampleL(v_uv + px * vec2(-1.0, 1.0));
    float t = sampleL(v_uv + px * vec2(0.0, 1.0));
    float tr = sampleL(v_uv + px * vec2(1.0, 1.0));
    float l = sampleL(v_uv + px * vec2(-1.0, 0.0));
    float r = sampleL(v_uv + px * vec2(1.0, 0.0));
    float bl = sampleL(v_uv + px * vec2(-1.0, -1.0));
    float b = sampleL(v_uv + px * vec2(0.0, -1.0));
    float br = sampleL(v_uv + px * vec2(1.0, -1.0));
    float gx = -tl - 2.0 * l - bl + tr + 2.0 * r + br;
    float gy = -tl - 2.0 * t - tr + bl + 2.0 * b + br;
    float edge = smoothstep(u_edge, u_edge + 0.15, length(vec2(gx, gy)));

    vec3 col = mix(poster, u_edgeColor, edge * clamp(u_edgeBoost, 0.0, 2.0));
    gl_FragColor = vec4(mix(original, col, m), 1.0);
}
