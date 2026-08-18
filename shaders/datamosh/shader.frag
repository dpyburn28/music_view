// Utility: datamosh-style block hold using previous frame (requires u_prev).
// Built-in: u_time, u_resolution, v_uv · Required: u_scene, u_prev

uniform sampler2D u_scene;
uniform sampler2D u_prev;
uniform float u_amount;
uniform float u_block;
uniform float u_threshold;
uniform float u_noise;
uniform float u_speed;
uniform float u_intensity;

float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

void main() {
    vec3 scene = texture2D(u_scene, v_uv).rgb;
    vec3 prev = texture2D(u_prev, v_uv).rgb;
    float m = clamp(u_intensity, 0.0, 1.0);
    float amt = clamp(u_amount, 0.0, 1.0);
    if (amt * m < 0.0001) {
        gl_FragColor = vec4(scene, 1.0);
        return;
    }

    float block = max(u_block, 4.0);
    vec2 cell = floor((v_uv * u_resolution) / block);
    float t = floor(u_time * max(u_speed, 0.0));
    float h = hash21(cell + floor(t * 0.25));

    // Motion proxy: difference vs previous
    float diff = abs(luma(scene) - luma(prev));
    float thr = clamp(u_threshold, 0.0, 1.0);
    // Hold blocks when motion is low OR random sticky
    float sticky = step(diff, thr) * step(1.0 - amt, h);
    float randomHold = step(1.0 - amt * 0.45, hash21(cell * 2.1 + t));
    float hold = max(sticky, randomHold * amt);

    // Optional block noise when holding
    float n = hash21(cell + t + 9.0);
    vec3 held = prev;
    held = mix(held, scene, n * u_noise * 0.15);
    // Slight block UV quantize sample from prev for macroblock feel
    vec2 q = (floor(v_uv * u_resolution / block) + 0.5) * block / u_resolution;
    held = mix(held, texture2D(u_prev, clamp(q, 0.0, 1.0)).rgb, 0.65);

    vec3 col = mix(scene, held, hold * amt);
    gl_FragColor = vec4(mix(scene, col, m), 1.0);
}
