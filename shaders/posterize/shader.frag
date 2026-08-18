// Postprocess: posterize / quantize.
uniform sampler2D u_scene;
uniform float u_levels;
uniform float u_intensity;

void main() {
    vec3 original = texture2D(u_scene, v_uv).rgb;
    float steps = max(floor(u_levels + 0.5), 2.0);
    vec3 col = floor(original * steps + 0.5) / steps;
    col = clamp(col, 0.0, 1.0);
    float m = clamp(u_intensity, 0.0, 1.0);
    gl_FragColor = vec4(mix(original, col, m), 1.0);
}
