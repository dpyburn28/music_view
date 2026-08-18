// Postprocess: spectral prism / radial chromatic dispersion.
// Built-in: u_time, u_resolution, v_uv
// Required: u_scene

uniform sampler2D u_scene;
uniform float u_amount;
uniform float u_center_x;
uniform float u_center_y;
uniform float u_angle;
uniform float u_intensity;

vec3 sampleScene(vec2 uv) {
    return texture2D(u_scene, clamp(uv, 0.0, 1.0)).rgb;
}

void main() {
    vec3 original = sampleScene(v_uv);
    float m = clamp(u_intensity, 0.0, 1.0);
    float amt = max(u_amount, 0.0) * m;
    if (amt < 0.00001) {
        gl_FragColor = vec4(original, 1.0);
        return;
    }

    vec2 center = vec2(clamp(u_center_x, 0.0, 1.0), clamp(u_center_y, 0.0, 1.0));
    vec2 d = v_uv - center;
    float dist = length(d);
    vec2 dir = dist > 0.0001 ? d / dist : vec2(1.0, 0.0);

    // Optional global angle bias
    float ca = cos(u_angle);
    float sa = sin(u_angle);
    dir = vec2(ca * dir.x - sa * dir.y, sa * dir.x + ca * dir.y);

    float spread = amt * dist * 0.08;
    vec3 col;
    col.r = sampleScene(v_uv + dir * spread * 1.2).r;
    col.g = sampleScene(v_uv).g;
    col.b = sampleScene(v_uv - dir * spread * 1.35).b;
    // Extra yellow/cyan fringes for richer spectrum
    float y = sampleScene(v_uv + dir * spread * 0.55).r * 0.5
        + sampleScene(v_uv + dir * spread * 0.55).g * 0.5;
    col.r = mix(col.r, y, 0.15);
    col.g = mix(col.g, y, 0.1);

    col = clamp(col, 0.0, 1.0);
    gl_FragColor = vec4(mix(original, col, m), 1.0);
}
