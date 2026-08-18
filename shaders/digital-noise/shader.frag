// Utility: salt-pepper, ringing, and speckles — digital sensor / compression noise.
// Built-in: u_time, u_resolution, v_uv · Required: u_scene

uniform sampler2D u_scene;
uniform float u_amount;
uniform float u_pepper;
uniform float u_ringing;
uniform float u_size;
uniform float u_speed;
uniform float u_intensity;

float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

vec3 sampleScene(vec2 uv) {
    return texture2D(u_scene, clamp(uv, 0.0, 1.0)).rgb;
}

void main() {
    vec3 original = sampleScene(v_uv);
    float m = clamp(u_intensity, 0.0, 1.0);
    float amt = clamp(u_amount, 0.0, 1.0);
    if (amt * m < 0.0001) {
        gl_FragColor = vec4(original, 1.0);
        return;
    }

    float sz = max(u_size, 1.0);
    vec2 cell = floor((v_uv * u_resolution) / sz);
    float t = floor(u_time * max(u_speed, 0.0) * 20.0);
    float h = hash21(cell + t);
    float h2 = hash21(cell * 3.1 + t + 5.0);

    // Salt & pepper
    float pep = clamp(u_pepper, 0.0, 1.0) * amt;
    float salt = step(1.0 - pep * 0.5, h);
    float pepper = step(1.0 - pep * 0.5, h2) * (1.0 - salt);

    vec3 col = original;
    col = mix(col, vec3(1.0), salt);
    col = mix(col, vec3(0.0), pepper);

    // Edge ringing: sample offset neighbors
    float ring = clamp(u_ringing, 0.0, 1.0) * amt;
    if (ring > 0.001) {
        vec2 px = 2.0 / max(u_resolution, vec2(1.0));
        vec3 n1 = sampleScene(v_uv + vec2(px.x, 0.0));
        vec3 n2 = sampleScene(v_uv - vec2(px.x, 0.0));
        vec3 edge = abs(n1 - n2);
        col += edge * ring * 0.8 * (h - 0.5);
        // Mild Gibbs-like overshoot
        col = mix(col, original * 1.15 - 0.05, ring * 0.25 * step(0.6, h));
    }

    // Fine sensor hiss
    col += (hash21(v_uv * u_resolution + t) - 0.5) * amt * 0.12;

    gl_FragColor = vec4(mix(original, clamp(col, 0.0, 1.0), m), 1.0);
}
