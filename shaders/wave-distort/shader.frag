// Utility: sine / multi-wave UV distortion (scanlines of displacement). Very stackable.
// Built-in: u_time, u_resolution, v_uv · Required: u_scene

uniform sampler2D u_scene;
uniform float u_amount;
uniform float u_frequency;
uniform float u_speed;
uniform float u_angle;
uniform float u_secondary;
uniform float u_intensity;

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

    float ang = u_angle;
    vec2 dir = vec2(cos(ang), sin(ang));
    vec2 perp = vec2(-dir.y, dir.x);
    float phase = dot(v_uv, dir) * max(u_frequency, 0.1) * 6.2831853 + u_time * u_speed;
    float w = sin(phase);
    // Secondary harmonic for less pure sine look
    w += sin(phase * 2.17 + 1.3) * clamp(u_secondary, 0.0, 1.0) * 0.45;

    vec2 uv = v_uv + perp * w * amt * 0.05;
    vec3 col = sampleScene(uv);

    gl_FragColor = vec4(mix(original, col, m), 1.0);
}
