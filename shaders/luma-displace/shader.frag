// Utility: displace UVs by scene luminance (or neighbor gradient). Extremely stackable.
// Built-in: u_time, u_resolution, v_uv · Required: u_scene

uniform sampler2D u_scene;
uniform float u_amount;
uniform float u_angle;
uniform float u_center;
uniform float u_invert;
uniform float u_smooth;
uniform float u_intensity;

float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

vec3 sampleScene(vec2 uv) {
    return texture2D(u_scene, clamp(uv, 0.0, 1.0)).rgb;
}

void main() {
    vec3 original = sampleScene(v_uv);
    float m = clamp(u_intensity, 0.0, 1.0);
    float amt = u_amount * m;
    if (abs(amt) < 0.00001) {
        gl_FragColor = vec4(original, 1.0);
        return;
    }

    float l = luma(original);
    if (u_smooth > 0.01) {
        vec2 px = 1.0 / max(u_resolution, vec2(1.0));
        l = (
            l +
            luma(sampleScene(v_uv + vec2(px.x, 0.0))) +
            luma(sampleScene(v_uv - vec2(px.x, 0.0))) +
            luma(sampleScene(v_uv + vec2(0.0, px.y))) +
            luma(sampleScene(v_uv - vec2(0.0, px.y)))
        ) * 0.2;
    }

    if (u_invert > 0.5) l = 1.0 - l;
    l = l - clamp(u_center, 0.0, 1.0);

    float ang = u_angle;
    vec2 dir = vec2(cos(ang), sin(ang));
    vec2 uv = v_uv + dir * l * amt * 0.15;
    vec3 col = sampleScene(uv);

    gl_FragColor = vec4(mix(original, col, m), 1.0);
}
