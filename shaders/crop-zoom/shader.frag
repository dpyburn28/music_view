// Postprocess: zoom + pan crop.
uniform sampler2D u_scene;
uniform float u_zoom;
uniform float u_pan_x;
uniform float u_pan_y;
uniform float u_intensity;

void main() {
    vec3 original = texture2D(u_scene, v_uv).rgb;
    float z = max(u_zoom, 1.0);
    vec2 uv = (v_uv - 0.5) / z + 0.5;
    uv += vec2(u_pan_x, u_pan_y) / z;

    float inFrame = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
    vec3 col = texture2D(u_scene, clamp(uv, 0.0, 1.0)).rgb * inFrame;

    float m = clamp(u_intensity, 0.0, 1.0);
    gl_FragColor = vec4(mix(original, col, m), 1.0);
}
