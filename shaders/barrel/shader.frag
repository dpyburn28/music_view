// Postprocess: barrel / pincushion lens distortion.
// Built-in: u_time, u_resolution, v_uv
// Required: u_scene

uniform sampler2D u_scene;
uniform float u_amount;
uniform float u_zoom;
uniform float u_intensity;

vec3 sampleScene(vec2 uv) {
    return texture2D(u_scene, clamp(uv, 0.0, 1.0)).rgb;
}

void main() {
    vec3 original = sampleScene(v_uv);
    float m = clamp(u_intensity, 0.0, 1.0);
    float amt = u_amount * m;

    if (abs(amt) < 0.0001) {
        gl_FragColor = vec4(original, 1.0);
        return;
    }

    vec2 c = v_uv * 2.0 - 1.0;
    float aspect = u_resolution.x / max(u_resolution.y, 1.0);
    c.x *= aspect;

    float r2 = dot(c, c);
    // Positive amount → barrel (push out)
    c *= 1.0 + amt * r2;
    c.x /= aspect;

    float z = max(u_zoom, 0.01);
    c /= z;
    vec2 uv = c * 0.5 + 0.5;

    // Outside panel → black edge (common lens look)
    float inPanel = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
    vec3 col = sampleScene(uv) * inPanel;

    gl_FragColor = vec4(mix(original, col, m), 1.0);
}
