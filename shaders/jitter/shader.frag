// Postprocess: handheld camera jitter / micro shake.
// Built-in: u_time, u_resolution, v_uv
// Required: u_scene

uniform sampler2D u_scene;
uniform float u_amount;
uniform float u_speed;
uniform float u_roughness;
uniform float u_intensity;

float hash11(float n) {
    return fract(sin(n) * 43758.5453123);
}

// Value noise 1D
float vnoise(float x) {
    float i = floor(x);
    float f = fract(x);
    float a = hash11(i);
    float b = hash11(i + 1.0);
    f = f * f * (3.0 - 2.0 * f);
    return mix(a, b, f);
}

void main() {
    vec3 original = texture2D(u_scene, v_uv).rgb;
    float m = clamp(u_intensity, 0.0, 1.0);
    float amt = max(u_amount, 0.0) * m;
    if (amt < 0.00001) {
        gl_FragColor = vec4(original, 1.0);
        return;
    }

    float sp = max(u_speed, 0.0);
    float t = u_time * sp;
    float rough = clamp(u_roughness, 0.0, 1.0);
    // Layered noise for organic shake
    float nx = (vnoise(t * 3.1) - 0.5) * 2.0;
    float ny = (vnoise(t * 3.7 + 17.0) - 0.5) * 2.0;
    nx += (vnoise(t * 11.0) - 0.5) * 2.0 * rough;
    ny += (vnoise(t * 13.0 + 5.0) - 0.5) * 2.0 * rough;

    vec2 off = vec2(nx, ny) * amt * 0.04;
    vec2 uv = clamp(v_uv + off, 0.0, 1.0);
    vec3 col = texture2D(u_scene, uv).rgb;

    gl_FragColor = vec4(mix(original, col, m), 1.0);
}
