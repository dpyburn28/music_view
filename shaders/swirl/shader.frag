// Postprocess: polar swirl / vortex UV warp.
// Built-in: u_time, u_resolution, v_uv
// Required: u_scene

uniform sampler2D u_scene;
uniform float u_amount;
uniform float u_radius;
uniform float u_center_x;
uniform float u_center_y;
uniform float u_spin;
uniform float u_intensity;

void main() {
    vec3 original = texture2D(u_scene, v_uv).rgb;
    float m = clamp(u_intensity, 0.0, 1.0);
    float amt = u_amount * m;
    if (abs(amt) < 0.0001) {
        gl_FragColor = vec4(original, 1.0);
        return;
    }

    vec2 center = vec2(clamp(u_center_x, 0.0, 1.0), clamp(u_center_y, 0.0, 1.0));
    vec2 p = v_uv - center;
    float aspect = u_resolution.x / max(u_resolution.y, 1.0);
    p.x *= aspect;

    float r = length(p);
    float fall = 1.0 - smoothstep(0.0, max(u_radius, 0.05), r);
    float angle = amt * fall * fall + u_time * u_spin * fall;
    float c = cos(angle);
    float s = sin(angle);
    vec2 q = vec2(c * p.x - s * p.y, s * p.x + c * p.y);
    q.x /= max(aspect, 0.0001);
    vec2 uv = clamp(q + center, 0.0, 1.0);

    vec3 col = texture2D(u_scene, uv).rgb;
    gl_FragColor = vec4(mix(original, col, m), 1.0);
}
