uniform float u_symmetry;
uniform float u_smin_k;
uniform float u_density;
uniform float u_particle_size;
uniform float u_spread;

uniform vec3 u_pal_base;
uniform vec3 u_pal_amp;
uniform vec3 u_pal_freq;
uniform vec3 u_pal_phase;
uniform vec3 u_bg_color;
uniform float u_intensity;

uniform float u_beat;
uniform float u_envelope;
uniform float u_beat_phase;
uniform float u_bass;

// Procedural Cosine Color Palette
vec3 getPalette(float t) {
    return u_pal_base + u_pal_amp * cos(6.2831853 * (u_pal_freq * t + u_pal_phase));
}

// Polynomial Smooth Minimum (IQ)
float smin(float a, float b, float k) {
    float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
    return mix(b, a, h) - k * h * (1.0 - h);
}

// 2D Hash for pseudo-random particle variation
float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

void main() {
    vec2 p = (v_uv - 0.5) * vec2(u_resolution.x / max(u_resolution.y, 1.0), 1.0);
    float r = length(p);
    float ang = atan(p.y, p.x);
    
    float beat = clamp(u_beat, 0.0, 1.0);
    float env = clamp(u_envelope, 0.0, 1.0);
    float bass = clamp(u_bass, 0.0, 1.0);
    float sym = max(floor(u_symmetry), 1.0);

    // 1. Space Folding (Kaleidoscope)
    if (sym > 1.1) {
        float sector = 6.2831853 / sym;
        // Rotate the entire domain based on time and audio bass
        ang = mod(ang + (u_time * 0.1) + (bass * 0.2), sector) - (sector / 2.0);
        p = vec2(cos(ang), sin(ang)) * r;
    }

    // 2. Core SDF
    float core_radius = (0.05 + bass * 0.1 + beat * 0.08) * u_spread;
    float d = length(p) - core_radius;

    // 3. Ring SDF
    // Expands outward and dissolves into the core
    float ring_radius = core_radius + 0.15 + (env * 0.1) * u_spread;
    float ring_d = abs(length(p) - ring_radius) - (0.005 + beat * 0.02);
    d = smin(d, ring_d, u_smin_k);

    // 4. Particle Grid SDF
    vec2 grid = p * u_density;
    vec2 cell_id = floor(grid);
    vec2 local_p = fract(grid) - 0.5;
    float h = hash21(cell_id);

    // Particles push outward dynamically on beat
    vec2 dir = normalize(p + 1e-4);
    vec2 offset = dir * (beat * u_spread * 1.5 * h);
    
    float blob_size = (u_particle_size * 0.15) * (0.4 + 0.6 * env + 0.2 * bass);
    float particle_d = length(local_p - offset) - blob_size;
    
    // Scale local cell distance back to global space to prevent rendering artifacts
    particle_d /= u_density;

    // Melt particles into the core and rings
    d = smin(d, particle_d, u_smin_k);

    // 5. Procedural Palette Mapping
    // Offset the color phase dynamically across the shapes and through time
    float color_phase = r * 2.0 - u_time * 0.8 + (u_beat_phase * 0.15) + (d * 3.0);
    vec3 color = getPalette(color_phase);

    // 6. Final Mask & Compositing
    float edge = smoothstep(0.015, 0.0, d);
    float glow = exp(-max(d, 0.0) * (8.0 - beat * 4.0)) * (0.3 + 0.7 * beat);

    vec3 final_col = mix(u_bg_color, color, edge);
    final_col += color * glow;

    // Simple smooth edge vignette
    final_col *= smoothstep(1.1, 0.2, r);
    
    float a = clamp(u_intensity, 0.0, 1.0);
    gl_FragColor = vec4(final_col * a, a);
}