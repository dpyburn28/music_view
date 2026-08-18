// Postprocess: flip / quadrant mirror.
uniform sampler2D u_scene;
uniform float u_flip_h;
uniform float u_flip_v;
uniform float u_quad;
uniform float u_intensity;

void main() {
    vec3 original = texture2D(u_scene, v_uv).rgb;
    vec2 uv = v_uv;

    if (u_quad > 0.5) {
        uv = abs(uv - 0.5) * 2.0;
        // fold back into 0-1 for sampling variety
        uv = abs(mod(uv, 2.0) - 1.0);
    }

    if (u_flip_h > 0.5) uv.x = 1.0 - uv.x;
    if (u_flip_v > 0.5) uv.y = 1.0 - uv.y;

    vec3 col = texture2D(u_scene, clamp(uv, 0.0, 1.0)).rgb;
    float m = clamp(u_intensity, 0.0, 1.0);
    gl_FragColor = vec4(mix(original, col, m), 1.0);
}
