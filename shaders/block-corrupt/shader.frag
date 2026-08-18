// Postprocess: macroblock corruption.
uniform sampler2D u_scene;
uniform float u_block;
uniform float u_density;
uniform float u_amount;
uniform float u_speed;
uniform float u_intensity;

float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

void main() {
    vec3 original = texture2D(u_scene, v_uv).rgb;
    float m = clamp(u_intensity, 0.0, 1.0);
    float amt = clamp(u_amount, 0.0, 1.0) * m;
    float dens = clamp(u_density, 0.0, 1.0);

    if (amt < 0.0001 || dens < 0.0001) {
        gl_FragColor = vec4(original, 1.0);
        return;
    }

    float block = max(u_block, 2.0);
    vec2 cell = floor((v_uv * u_resolution) / block);
    float t = floor(u_time * max(u_speed, 0.0));
    float h = hash21(cell + t * 11.7);
    float h2 = hash21(cell * 3.3 + t);

    float active = step(1.0 - dens, h);
    vec2 shift = (vec2(h2, hash21(cell + 9.1 + t)) - 0.5) * amt * active * 0.15;
    vec2 uv = v_uv + shift;

    // Occasional solid flash tile
    float flash = active * step(0.97, h2) * amt;
    vec3 col = texture2D(u_scene, clamp(uv, 0.0, 1.0)).rgb;
    col = mix(col, vec3(h2, h, 1.0 - h), flash * 0.6);

    gl_FragColor = vec4(mix(original, col, m), 1.0);
}
