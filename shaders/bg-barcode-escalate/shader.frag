// Large intersecting blocks → dense vertical barcode as time escalates.
// Built-in: u_time, u_resolution, v_uv  (do not redeclare)

uniform float u_freq_x;
uniform float u_freq_y;
uniform float u_shape;
uniform float u_edge;
uniform float u_intersect;
uniform float u_escalate;
uniform float u_y_decay;
uniform float u_period;
uniform float u_speed;

void main() {
    vec2 uv = v_uv;

    float speed = max(u_speed, 0.0);
    float t = u_time * speed;

    // Loop the escalation (period 0 = one-shot, then hold at the cap).
    float period = max(u_period, 0.0);
    float localT = t;
    if (period > 0.001) {
        localT = fract(t / period) * period;
    }

    // Exponential frequency curve: freqX = base * exp(t * speed_factor).
    // Clamp the exponent so mediump does not overflow.
    float speedFactor = max(u_escalate, 0.0);
    float expArg = min(localT * speedFactor, 6.5);
    float freqGrow = exp(expArg);
    float freqX = max(u_freq_x, 0.1) * freqGrow;
    freqX = min(freqX, 420.0);

    // Y stays at a lower base frequency; only a mild climb so it never
    // competes with the barcode.
    float freqY = max(u_freq_y, 0.1) * (1.0 + 0.35 * min(localT * speedFactor, 2.0));

    // Vertical domain (X): sine bands that subdivide as freqX grows.
    float vx = sin(uv.x * freqX * 6.2831853);
    // Horizontal domain (Y): intersecting bands, strong at t ≈ 0.
    float hy = sin(uv.y * freqY * 6.2831853);

    // Shaping threshold: pow() crushes midtones into sharp white peaks.
    float shape = max(u_shape, 1.0);
    // As frequency climbs, push shape up so late frames are hairline, not slabs.
    float shapeNow = shape * (1.0 + 0.45 * clamp(expArg / 6.5, 0.0, 1.0));
    float px = pow(abs(vx), shapeNow);
    float py = pow(abs(hy), shapeNow);

    // Temporal mask: Y-axis opacity decays so X overpowers it.
    float yFade = exp(-localT * max(u_y_decay, 0.0));

    float addMix = px + py * yFade;
    float mulMix = px * mix(1.0, py, yFade);
    float field = mix(addMix, mulMix, clamp(u_intersect, 0.0, 1.0));

    // Final contrast: deep black negative space, glowing white peaks.
    float edge = clamp(u_edge, 0.02, 0.98);
    float col = smoothstep(edge * 0.45, edge + 0.18, field);

    gl_FragColor = vec4(vec3(col), 1.0);
}
