// Utility: TV static / snow with density, size, and hold frames.
// Built-in: u_time, u_resolution, v_uv · Required: u_scene

uniform sampler2D u_scene;
uniform float u_amount;
uniform float u_density;
uniform float u_size;
uniform float u_hold;
uniform float u_color;
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
    if (amt < 0.0001) {
        gl_FragColor = vec4(original, 1.0);
        return;
    }

    float sz = max(u_size, 1.0);
    vec2 cell = floor((v_uv * u_resolution) / sz);
    float hold = max(u_hold, 0.0);
    float t = hold > 0.001 ? floor(u_time * (1.0 / max(hold, 0.016))) : floor(u_time * 60.0);

    float h = hash21(cell + t * 13.7);
    float dens = clamp(u_density, 0.0, 1.0);
    float flake = step(1.0 - dens, h);

    vec3 snow = vec3(h);
    if (u_color > 0.5) {
        snow = vec3(
            hash21(cell + t),
            hash21(cell + t + 3.1),
            hash21(cell + t + 7.9)
        );
    }

    // Mix flakes over scene; also mild full-field hiss
    float hiss = (hash21(v_uv * u_resolution + t) - 0.5) * amt * 0.15;
    vec3 col = original + hiss;
    col = mix(col, snow, flake * amt);

    gl_FragColor = vec4(mix(original, clamp(col, 0.0, 1.0), m), 1.0);
}
