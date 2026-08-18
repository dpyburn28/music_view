// Utility: per-channel film grain with size, softness, and luma response.
// Built-in: u_time, u_resolution, v_uv · Required: u_scene

uniform sampler2D u_scene;
uniform float u_amount;
uniform float u_size;
uniform float u_chroma;
uniform float u_shadows;
uniform float u_speed;
uniform float u_intensity;

float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

float ign(vec2 p) {
    return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

void main() {
    vec3 original = texture2D(u_scene, v_uv).rgb;
    float m = clamp(u_intensity, 0.0, 1.0);
    float amt = max(u_amount, 0.0) * m;
    if (amt < 0.00001) {
        gl_FragColor = vec4(original, 1.0);
        return;
    }

    float sz = max(u_size, 0.5);
    vec2 pix = floor(v_uv * u_resolution / sz);
    float t = floor(u_time * max(u_speed, 0.0) * 24.0);

    float n0 = mix(hash21(pix + t), ign(pix + t * 1.7), 0.4);
    float n1 = mix(hash21(pix + t + 31.0), ign(pix.yx + t * 2.1), 0.4);
    float n2 = mix(hash21(pix + t + 67.0), ign(pix + t * 3.3 + 9.0), 0.4);

    float mono = n0;
    float ch = clamp(u_chroma, 0.0, 1.0);
    vec3 grain = mix(vec3(mono), vec3(n0, n1, n2), ch);

    // More grain in shadows (film-like) when u_shadows high
    float l = luma(original);
    float resp = mix(1.0, 1.0 - l * 0.85, clamp(u_shadows, 0.0, 1.0));

    vec3 col = original + (grain - 0.5) * amt * resp;
    gl_FragColor = vec4(mix(original, clamp(col, 0.0, 1.0), m), 1.0);
}
