// Light Ripple — Danilo Guanabara (pouet.net/prod.php?which=57245)
// Ported to music_view shader system.

uniform float u_speed;
uniform float u_threshold;
uniform float u_zoom;
uniform float u_intensity;
uniform float u_vignette;
uniform vec3 u_bg_color;
uniform vec3 u_fg_color;

vec3 lightRipple(vec2 fragCoord) {
    vec2 r = u_resolution;
    float t = u_time * u_speed;
    vec3 c;
    float l, z = t;
    for (int i = 0; i < 3; i++) {
        vec2 uv, p = fragCoord / r;
        uv = p;
        p -= 0.5;
        p.x *= r.x / r.y;
        z += 0.07;
        l = length(p);
        float tSin = 0.5 + sin(t / 2.0) / 2.0;
        uv += p / l * (sin(z) + 1.0) * abs(sin(l * 90.0 * tSin - z - z));
        c[i] = 0.01 / length(mod(uv, 1.0) - 0.5);
    }
    c = c / l;
    return c;
}

void main() {
    vec2 uv = v_uv;
    vec2 fragCoord = uv * u_resolution;

    vec3 c = lightRipple(fragCoord * u_zoom);
    c.gb = c.rr;

    float s = step(u_threshold, c.x);
    vec3 col = mix(u_bg_color, u_fg_color, s);

    float vigAmt = clamp(u_vignette, 0.0, 1.0);
    if (vigAmt > 0.0) {
        vec2 p = (uv - 0.5) * vec2(u_resolution.x / max(u_resolution.y, 1.0), 1.0);
        float r = length(p);
        float vig = mix(1.0, smoothstep(1.2, 0.15, r), vigAmt);
        col *= 0.6 + 0.4 * vig;
    }

    float a = clamp(u_intensity, 0.0, 1.0);
    gl_FragColor = vec4(col * a, a);
}
