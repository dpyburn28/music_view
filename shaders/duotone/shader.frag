// Postprocess: duotone via luminance map.
// Built-in: u_time, u_resolution, v_uv
// Required: u_scene

uniform sampler2D u_scene;
uniform vec3 u_color_a;
uniform vec3 u_color_b;
uniform float u_contrast;
uniform float u_smooth;
uniform float u_intensity;

void main() {
    vec3 original = texture2D(u_scene, v_uv).rgb;
    float luma = dot(original, vec3(0.299, 0.587, 0.114));
    float c = max(u_contrast, 0.01);
    luma = (luma - 0.5) * c + 0.5;
    luma = clamp(luma, 0.0, 1.0);

    float sm = clamp(u_smooth, 0.0, 0.49);
    if (sm > 0.001) {
        luma = smoothstep(sm, 1.0 - sm, luma);
    }

    vec3 col = mix(u_color_a, u_color_b, luma);
    float m = clamp(u_intensity, 0.0, 1.0);
    gl_FragColor = vec4(mix(original, col, m), 1.0);
}
