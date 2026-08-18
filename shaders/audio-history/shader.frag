// Scrolling history strip — palette, height range, and chrome are controllable.

uniform float u_energy;
uniform float u_window;
uniform float u_scroll;
uniform float u_contrast;
uniform float u_intensity;
uniform float u_use_history;
uniform float u_write_head;
uniform float u_history_filled;
uniform float u_height;
uniform float u_weight;
uniform float u_glow;
uniform float u_fill;
uniform float u_age_fade;
uniform float u_playhead;
uniform float u_ticks;
uniform vec3 u_color_low;
uniform vec3 u_color_mid;
uniform vec3 u_color_high;
uniform vec3 u_bg_color;
uniform sampler2D u_history;

float historySynth(float tau, float energyNow) {
    float e = clamp(energyNow, 0.0, 1.0);
    float a = 0.45 + 0.55 * e;
    float y = sin(tau * 2.7) * 0.55;
    y += sin(tau * 5.3 + 1.2) * 0.3 * e;
    y += sin(tau * 11.0) * 0.15;
    float hit = pow(max(0.0, sin(tau * 1.7)), 8.0);
    y += hit * 0.5 * e;
    return clamp(abs(y) * a, 0.0, 1.0);
}

float sampleHistory(float x) {
    float filled = clamp(u_history_filled, 0.0, 1.0);
    float span = max(filled, 0.001);
    float age = (1.0 - x) * span;
    float u = fract(u_write_head - age - 0.0005);
    float a = texture2D(u_history, vec2(u, 0.5)).r;
    float b = texture2D(u_history, vec2(fract(u - 0.002), 0.5)).r;
    float c = texture2D(u_history, vec2(fract(u + 0.002), 0.5)).r;
    return max(a, max(b, c) * 0.85);
}

void main() {
    vec2 uv = v_uv;
    float useLive = step(0.5, u_use_history);

    float amp;
    if (useLive > 0.5) {
        amp = sampleHistory(uv.x);
        float filled = clamp(u_history_filled, 0.0, 1.0);
        float visibleFrom = 1.0 - filled;
        amp *= smoothstep(visibleFrom - 0.015, visibleFrom + 0.03, uv.x);
    } else {
        float windowSec = max(u_window, 0.5);
        float scroll = max(u_scroll, 0.0);
        float age = (1.0 - uv.x) * windowSec;
        float tau = u_time * scroll - age;
        amp = historySynth(tau, u_energy);
    }

    float mid = 0.5;
    float hRange = clamp(u_height, 0.05, 1.0);
    float halfH = amp * hRange;
    float weight = clamp(u_weight, 0.0, 1.0);
    float edgeSoft = mix(0.04, 0.006, weight);
    float inBand = smoothstep(halfH + edgeSoft * 1.5, halfH * mix(0.25, 0.05, weight), abs(uv.y - mid));
    float edge = smoothstep(halfH + edgeSoft, halfH - edgeSoft * 0.5, abs(uv.y - mid));

    float present = smoothstep(0.0, 1.0, uv.x);
    float glowAmt = clamp(u_glow, 0.0, 1.0);
    float glow = exp(-abs(uv.y - mid) * (5.0 + 22.0 * (1.0 - amp))) * amp * glowAmt;

    float fillAmt = clamp(u_fill, 0.0, 1.0);
    float bar = max(0.0, smoothstep(0.0, 0.12, amp) * (1.0 - abs(uv.y - mid) * (1.0 / max(hRange, 0.1))));
    bar *= fillAmt;

    float ageAmt = clamp(u_age_fade, 0.0, 1.0);
    float ageFade = mix(1.0, mix(0.45, 1.0, present), ageAmt);

    float c = max(u_contrast, 0.2);
    float level = pow(clamp(amp, 0.0, 1.0), 1.0 / c);
    vec3 ramp = mix(u_color_low, mix(u_color_mid, u_color_high, level), level);

    vec3 col = u_bg_color;
    col += ramp * (inBand * 0.7 * fillAmt + edge * 0.4 + glow * 0.55) * ageFade;
    col += ramp * bar * 0.28 * ageFade;

    float headAmt = clamp(u_playhead, 0.0, 1.0);
    float head = smoothstep(0.018, 0.0, abs(uv.x - 0.99)) * headAmt;
    col += mix(u_color_high, vec3(1.0), 0.5) * head * 0.55;

    float tickAmt = clamp(u_ticks, 0.0, 1.0);
    float tick = smoothstep(0.01, 0.0, abs(fract(uv.x * 8.0) - 0.5) - 0.48);
    col += mix(u_bg_color, u_color_low, 0.6) * tick * 0.15 * tickAmt * present;

    float spark = exp(-abs(uv.x - 0.97) * 40.0) * clamp(u_energy, 0.0, 1.0) * headAmt;
    col += u_color_high * spark * 0.35;

    float a = clamp(u_intensity, 0.0, 1.0);
    gl_FragColor = vec4(col * a, a);
}
