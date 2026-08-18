uniform float u_mode;
uniform float u_density;
uniform float u_flow_spread;
uniform float u_turbulence;

uniform float u_audio_gain;
uniform float u_bass_response;

uniform float u_beat;
uniform float u_envelope;
uniform float u_bass;
uniform float u_beat_phase;

uniform vec3 u_color_core;
uniform vec3 u_color_mid;
uniform vec3 u_color_edge;
uniform vec3 u_bg_color;
uniform float u_intensity;

float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for(int i = 0; i < 3; i++) {
        v += a * noise(p);
        p *= 2.0;
        a *= 0.5;
    }
    return v;
}

void main() {
    vec2 p = (v_uv - 0.5) * vec2(u_resolution.x / max(u_resolution.y, 1.0), 1.0);
    int mode = int(floor(u_mode + 0.5));

    if (mode == 3) {
        p.y -= (u_time * 0.25); // Continuous upward drift for fire
    }

    float raw_r = length(p);
    float a = atan(p.y, p.x);

    // 1. Audio Signal Extraction
    float clamped_beat = clamp(u_beat, 0.0, 1.0);
    float clamped_bass = clamp(u_bass, 0.0, 1.0);
    float clamped_env = clamp(u_envelope, 0.0, 1.0);

    float angular_mod = 0.5 + 0.5 * sin(a * 4.0 + u_beat_phase * 0.04);
    float audio_signal = (clamped_beat * 1.3 + clamped_bass * u_bass_response * 1.6 + clamped_env * 0.5) * angular_mod;
    audio_signal = clamp(audio_signal * u_audio_gain, 0.0, 3.0);

    // Blank screen gate when audio is silent
    float audio_gate = smoothstep(0.01, 0.1, audio_signal);

    // Element-specific properties
    float p_size = 0.3;
    float p_softness = 0.1;
    float stretch = 1.0;
    float scatter = 0.0;
    float effective_density = u_density;

    if (mode == 0) {
        effective_density = u_density * 1.4;
        p_size = 0.12; p_softness = 0.02; stretch = 1.0; scatter = 0.22;
    } else if (mode == 1) {
        effective_density = u_density * 0.9;
        p_size = 0.45; p_softness = 0.32; stretch = 1.5; scatter = 0.05;
    } else if (mode == 2) {
        effective_density = u_density * 0.7;
        p_size = 0.65; p_softness = 0.75; stretch = 1.1; scatter = 0.35;
    } else {
        effective_density = u_density * 1.1;
        p_size = 0.25; p_softness = 0.15; stretch = 4.2; scatter = 0.15;
    }

    // Constant baseline motion combined with audio warping
    vec2 warp_coord = p * 2.5;
    if (mode == 2) warp_coord.y -= u_time * 0.3;
    vec2 warp = vec2(fbm(warp_coord + u_time * 0.15), fbm(warp_coord - u_time * 0.15));
    
    p += (warp - 0.5) * u_turbulence * (0.2 + audio_signal * 0.4);
    float r = length(p);

    // 2. Continuous Flow + Audio Ripple Wavefront Positioning
    float baseline_flow = u_time * 0.35; // Always flowing
    float audio_flow = baseline_flow + (audio_signal * u_flow_spread) + (u_beat_phase * 0.02);
    
    float ring_index = floor(r * effective_density - audio_flow);
    float ring_fract = fract(r * effective_density - audio_flow) - 0.5;

    float particles_in_ring = max(6.0, floor(abs(ring_index) * 2.2));
    float norm_angle = (a + 3.14159265) / (2.0 * 3.14159265);
    
    float ang_index = floor(norm_angle * particles_in_ring);
    float ang_fract = fract(norm_angle * particles_in_ring) - 0.5;

    vec2 cell_id = vec2(ring_index, ang_index);
    float h = hash21(cell_id);
    
    ring_fract -= (h - 0.5) * scatter;
    ang_fract -= (hash21(cell_id + 11.0) - 0.5) * scatter;

    vec2 local_pos = vec2(ring_fract, ang_fract * stretch * (particles_in_ring / (effective_density * 1.4)));
    
    float current_size = p_size * (0.6 + h * 0.4) * (0.8 + audio_signal * 0.6);
    
    float d = length(local_pos);
    float shape = smoothstep(current_size + p_softness, current_size - p_softness, d);
    
    // 3. Audio Ripple Mask: Forces particles to ripple outward from center, blank when silent
    float ripple_wave = smoothstep(0.9, 0.1, abs(r - (audio_signal * 0.7 + 0.1)));
    shape *= audio_gate * ripple_wave;

    // Element Color Profiles
    vec3 core_tint = u_color_core;
    vec3 mid_tint = u_color_mid;
    vec3 edge_tint = u_color_edge;

    if (mode == 0) {
        core_tint = mix(u_color_core, vec3(1.0, 0.85, 0.5), 0.6);
        mid_tint = mix(u_color_mid, vec3(0.7, 0.5, 0.3), 0.5);
    } else if (mode == 1) {
        core_tint = mix(u_color_core, vec3(0.6, 0.9, 1.0), 0.7);
        mid_tint = mix(u_color_mid, vec3(0.1, 0.4, 0.8), 0.6);
    } else if (mode == 2) {
        core_tint = mix(u_color_core, vec3(0.6, 0.65, 0.75), 0.7);
        mid_tint = mix(u_color_mid, vec3(0.25, 0.3, 0.4), 0.6);
    } else if (mode == 3) {
        core_tint = vec3(1.0, 0.95, 0.6);
        mid_tint = vec3(1.0, 0.35, 0.05);
        edge_tint = vec3(0.3, 0.02, 0.01);
    }

    float color_mix = clamp(r * 1.1 - (audio_signal * 0.2) + (h * 0.15), 0.0, 1.0);
    vec3 col_inner = mix(core_tint, mid_tint, color_mix);
    vec3 col_outer = mix(mid_tint, edge_tint, color_mix);
    
    vec3 particle_color = mix(col_outer, col_inner, smoothstep(current_size * 0.7, 0.0, d));
    vec3 final_col = u_bg_color;
    
    if (mode == 2) {
        final_col += particle_color * shape * (0.6 + audio_signal * 0.6);
    } else if (mode == 3) {
        final_col += particle_color * shape * (1.2 + audio_signal * 1.8);
    } else {
        final_col = mix(final_col, particle_color, shape);
    }

    float alpha = clamp(u_intensity * audio_gate, 0.0, 1.0);
    gl_FragColor = vec4(final_col * alpha, alpha);
}