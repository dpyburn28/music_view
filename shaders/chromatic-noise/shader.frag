// Utility: noise applied as RGB channel offsets (noisy chromatic aberration).
uniform sampler2D u_scene;
uniform float u_amount;
uniform float u_scale;
uniform float u_speed;
uniform float u_intensity;

float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

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

    float sc = max(u_scale, 0.5);
    vec2 p = v_uv * sc * 8.0 + u_time * u_speed;
    float nx = noise(p) - 0.5;
    float ny = noise(p + 5.2) - 0.5;
    float nz = noise(p + 11.7) - 0.5;

    float r = sampleScene(v_uv + vec2(nx, ny) * amt * 0.04).r;
    float g = sampleScene(v_uv + vec2(ny, nz) * amt * 0.03).g;
    float b = sampleScene(v_uv + vec2(nz, nx) * amt * 0.045).b;

    gl_FragColor = vec4(mix(original, vec3(r, g, b), m), 1.0);
}
