// Postprocess: Sobel outline.
// Built-in: u_time, u_resolution, v_uv
// Required: u_scene

uniform sampler2D u_scene;
uniform float u_strength;
uniform float u_threshold;
uniform vec3 u_color;
uniform float u_invert_bg;
uniform float u_intensity;

float luma(vec3 c) {
    return dot(c, vec3(0.299, 0.587, 0.114));
}

float sampleL(vec2 uv) {
    return luma(texture2D(u_scene, clamp(uv, 0.0, 1.0)).rgb);
}

void main() {
    vec3 original = texture2D(u_scene, v_uv).rgb;
    vec2 px = 1.0 / max(u_resolution, vec2(1.0));

    float tl = sampleL(v_uv + vec2(-px.x, px.y));
    float t  = sampleL(v_uv + vec2(0.0, px.y));
    float tr = sampleL(v_uv + vec2(px.x, px.y));
    float l  = sampleL(v_uv + vec2(-px.x, 0.0));
    float r  = sampleL(v_uv + vec2(px.x, 0.0));
    float bl = sampleL(v_uv + vec2(-px.x, -px.y));
    float b  = sampleL(v_uv + vec2(0.0, -px.y));
    float br = sampleL(v_uv + vec2(px.x, -px.y));

    float gx = -tl - 2.0 * l - bl + tr + 2.0 * r + br;
    float gy = -tl - 2.0 * t - tr + bl + 2.0 * b + br;
    float g = length(vec2(gx, gy));
    g = max(g - u_threshold, 0.0) * max(u_strength, 0.0);
    g = clamp(g, 0.0, 1.0);

    float useBlack = step(0.5, u_invert_bg);
    vec3 bg = mix(original, vec3(0.0), useBlack);
    vec3 col = mix(bg, u_color, g);

    float m = clamp(u_intensity, 0.0, 1.0);
    gl_FragColor = vec4(mix(original, col, m), 1.0);
}
