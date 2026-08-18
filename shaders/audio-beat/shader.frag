// Beat particle ripple — colors, density, ring weight, and motion knobs.

uniform float u_beat;
uniform float u_envelope;
uniform float u_density;
uniform float u_spread;
uniform float u_ring;
uniform float u_intensity;
uniform float u_beat_phase;
uniform float u_bass;
uniform float u_particle_size;
uniform float u_kick;
uniform float u_swirl;
uniform float u_ring_weight;
uniform float u_ring_speed;
uniform float u_core;
uniform float u_spokes;
uniform float u_vignette;
uniform vec3 u_color_cool;
uniform vec3 u_color_hot;
uniform vec3 u_color_bass;
uniform vec3 u_bg_color;

float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

void main() {
    vec2 uv = v_uv;
    vec2 p = (uv - 0.5) * vec2(u_resolution.x / max(u_resolution.y, 1.0), 1.0);
    float r = length(p);
    float ang = atan(p.y, p.x);

    float beat = clamp(u_beat, 0.0, 1.0);
    float env = clamp(u_envelope, 0.0, 1.0);
    float bass = clamp(u_bass, 0.0, 1.0);
    float dens = max(u_density, 2.0);
    float spread = max(u_spread, 0.1);
    float phase = u_beat_phase;
    float pSize = max(u_particle_size, 0.15);
    float kickAmt = max(u_kick, 0.0);
    float swirlAmt = max(u_swirl, 0.0);
    float ringW = max(u_ring_weight, 0.05);
    float ringSpd = max(u_ring_speed, 0.1);

    float ringAmt = clamp(u_ring, 0.0, 1.0);
    float rings = 0.0;
    for (int i = 0; i < 3; i++) {
        float fi = float(i);
        float seed = phase - fi;
        float age = (phase - seed) + (1.0 - beat) * 0.15 + fi * 0.22;
        float rad = age * 0.28 * spread * ringSpd;
        float w = abs(r - rad);
        float line = smoothstep(0.03 * ringW + 0.02, 0.0, w);
        float fade = exp(-age * 1.8) * exp(-r * 0.9);
        rings += line * fade;
    }
    float wavePhase = r * (9.0 / spread) - u_time * 1.6 * ringSpd - beat * 5.0;
    float cont = smoothstep(0.08 * ringW + 0.04, 0.0, abs(fract(wavePhase) - 0.5));
    cont *= exp(-r * 1.5) * (0.25 + 0.75 * beat);
    rings = (rings * 0.85 + cont * 0.65) * ringAmt;

    vec2 grid = uv * dens;
    vec2 cell = floor(grid);
    vec2 f = fract(grid) - 0.5;
    float h = hash21(cell);
    float h2 = hash21(cell + 17.1);
    float h3 = hash21(cell + 91.7);

    vec2 dir = normalize(p + 1e-4);
    vec2 tang = vec2(-dir.y, dir.x);
    float kick = beat * (0.4 + 0.6 * h) * spread * 0.09 * kickAmt;
    float swirl = beat * (h3 - 0.5) * 0.04 * spread * swirlAmt;
    vec2 offset = dir * kick + tang * swirl;

    float d = length(f - offset * dens);
    float radius = (0.1 + 0.12 * h2 + beat * 0.08 + env * 0.03) * pSize;
    float particle = smoothstep(radius, radius * 0.15, d);
    particle *= 0.4 + 0.5 * env + beat * 0.55 + bass * 0.2;
    particle *= smoothstep(0.9 * spread, 0.12, r);

    float dust = smoothstep(0.08 * pSize, 0.0, length(f - 0.15 * dir * beat)) * 0.35 * env;
    dust *= smoothstep(0.75, 0.1, r);

    float coreAmt = max(u_core, 0.0);
    float core = exp(-r * (5.5 - beat * 2.8 - bass * 1.2))
        * (0.18 + beat * 0.95 + env * 0.28 + bass * 0.2) * coreAmt;

    float spokeAmt = clamp(u_spokes, 0.0, 1.0);
    float spokes = pow(abs(sin(ang * 6.0 + phase)), 12.0)
        * exp(-r * 2.5) * beat * spokeAmt;

    vec3 cool = u_color_cool;
    vec3 hot = u_color_hot;
    vec3 bassCol = u_color_bass;
    vec3 tint = mix(cool, hot, beat * 0.65 + env * 0.25);
    tint = mix(tint, bassCol, bass * 0.45);

    vec3 col = u_bg_color;
    col += tint * (particle * 1.15 + dust);
    col += mix(cool, mix(hot, vec3(1.0), 0.4), beat) * rings * 0.95;
    col += mix(hot, vec3(1.0), 0.35) * core;
    col += tint * spokes;

    float vigAmt = clamp(u_vignette, 0.0, 1.0);
    float vig = mix(1.0, smoothstep(1.1, 0.2, r), vigAmt);
    col *= 0.65 + 0.35 * vig;

    float a = clamp(u_intensity, 0.0, 1.0);
    gl_FragColor = vec4(col * a, a);
}
