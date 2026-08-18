// Utility: map luminance onto a 4-stop palette.
uniform sampler2D u_scene;
uniform vec3 u_c0;
uniform vec3 u_c1;
uniform vec3 u_c2;
uniform vec3 u_c3;
uniform float u_contrast;
uniform float u_soft;
uniform float u_intensity;

float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

void main() {
    vec3 original = texture2D(u_scene, v_uv).rgb;
    float m = clamp(u_intensity, 0.0, 1.0);
    if (m < 0.0001) {
        gl_FragColor = vec4(original, 1.0);
        return;
    }

    float l = luma(original);
    l = clamp((l - 0.5) * max(u_contrast, 0.01) + 0.5, 0.0, 1.0);
    float t = l * 3.0;
    float soft = clamp(u_soft, 0.0, 1.0);

    vec3 a = mix(u_c0, u_c1, clamp(t, 0.0, 1.0));
    vec3 b = mix(u_c1, u_c2, clamp(t - 1.0, 0.0, 1.0));
    vec3 c = mix(u_c2, u_c3, clamp(t - 2.0, 0.0, 1.0));
    vec3 hard = t < 1.0 ? a : (t < 2.0 ? b : c);

    // Soft: smoothstep blend across stops
    float w1 = smoothstep(1.0 - soft, 1.0 + soft, t);
    float w2 = smoothstep(2.0 - soft, 2.0 + soft, t);
    vec3 softCol = mix(mix(u_c0, u_c1, smoothstep(0.0, 1.0, t)), mix(u_c1, u_c2, smoothstep(1.0, 2.0, t)), w1);
    softCol = mix(softCol, mix(u_c2, u_c3, smoothstep(2.0, 3.0, t)), w2);

    vec3 col = mix(hard, softCol, soft);
    gl_FragColor = vec4(mix(original, col, m), 1.0);
}
