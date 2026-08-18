// Utility: Worley/cellular noise overlay or multiply.
uniform sampler2D u_scene;
uniform float u_amount;
uniform float u_scale;
uniform float u_mode;
uniform float u_edge;
uniform float u_speed;
uniform float u_intensity;

vec2 hash22(vec2 p) {
    p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
    return fract(sin(p) * 43758.5453);
}

float worley(vec2 uv) {
    vec2 i = floor(uv);
    vec2 f = fract(uv);
    float md = 8.0;
    for (float y = -1.0; y <= 1.0; y += 1.0) {
        for (float x = -1.0; x <= 1.0; x += 1.0) {
            vec2 g = vec2(x, y);
            vec2 o = hash22(i + g);
            o = 0.5 + 0.5 * sin(u_time * u_speed + 6.2831 * o);
            vec2 r = g + o - f;
            md = min(md, dot(r, r));
        }
    }
    return sqrt(md);
}

void main() {
    vec3 original = texture2D(u_scene, v_uv).rgb;
    float m = clamp(u_intensity, 0.0, 1.0);
    float amt = clamp(u_amount, 0.0, 1.0);
    if (amt * m < 0.0001) {
        gl_FragColor = vec4(original, 1.0);
        return;
    }

    float sc = max(u_scale, 1.0);
    vec2 uv = v_uv * sc;
    uv.x *= u_resolution.x / max(u_resolution.y, 1.0);
    float d = worley(uv);
    float cell = 1.0 - smoothstep(0.0, max(u_edge, 0.01), d);

    float mode = floor(u_mode + 0.5);
    vec3 col = original;
    if (mode < 0.5) {
        col = original + (cell - 0.5) * amt;
    } else if (mode < 1.5) {
        col = original * mix(vec3(1.0), vec3(cell * 1.5), amt);
    } else {
        col = mix(original, original * cell + vec3(cell * 0.15), amt);
    }

    gl_FragColor = vec4(mix(original, clamp(col, 0.0, 1.0), m), 1.0);
}
