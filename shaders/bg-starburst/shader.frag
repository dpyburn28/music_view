// Polar starburst: pinched radial rays, segmented rings, optional 1-bit invert.
// Built-in: u_time, u_resolution, v_uv  (do not redeclare)

uniform float u_rays;
uniform float u_pinch;
uniform float u_rings;
uniform float u_glow;
uniform float u_crisp;
uniform float u_pulse;
uniform float u_spin;
uniform float u_speed;

void main() {
    float t = u_time * max(u_speed, 0.0);

    // 1. Centered polar, portrait ellipse (the still is a tall oval).
    vec2 res = max(u_resolution, vec2(1.0));
    vec2 uv = (v_uv - 0.5) * vec2(res.x / res.y * 1.35, 1.0);
    float r0 = length(uv);
    float theta = atan(uv.y, uv.x);

    // 2–3. Non-linear radial warp: pinch + inverse-distance origin.
    float pinch = max(u_pinch, 0.05);
    float rWarp = pow(max(r0, 1e-4), pinch);
    float rInv = 1.0 / (r0 + 0.045);

    // 2. High-frequency angular rays (texture, not a full sunburst).
    float nRays = max(u_rays, 2.0);
    float spin = t * u_spin;
    float ray = sin(theta * nRays + spin);
    // Sparse thick spokes — a handful of needles, not a full sunburst.
    float thick = pow(abs(sin(theta * 2.0 + 0.55 + spin * 0.25)), 70.0);
    thick = max(thick, pow(abs(sin(theta * 1.5 - 0.9 + spin * 0.18)), 80.0));
    // Fine dotted rays toward the core.
    float dashRay = step(0.35, sin(theta * nRays + 1.1))
        * step(0.55, fract(rInv * 22.0 - t * 0.8));

    // 4. Concentric bands on the warped radius → dashed elliptical frame.
    float ringDen = max(u_rings, 1.0);
    float ringWave = sin(rWarp * ringDen - t * 1.1);
    float ringDash = step(-0.15, sin(theta * 28.0 + rWarp * 3.0));
    float ringBand = step(0.35, ringWave) * ringDash;
    float ringMask = smoothstep(0.48, 0.64, r0) * (1.0 - smoothstep(0.88, 1.08, r0));

    // Soft oval body: blown-out origin, gentle falloff, then black corners.
    float gAmt = clamp(u_glow, 0.0, 1.5);
    float glow = exp(-r0 * r0 * mix(2.4, 0.9, gAmt));
    glow = max(glow, 0.72 * exp(-r0 * mix(3.2, 1.3, gAmt)));
    float streaks = pow(max(ray, 0.0), 10.0) * 0.08 * glow;
    float body = glow + streaks;
    body *= 1.0 - thick * 0.9 * smoothstep(0.06, 0.32, r0);
    body *= 1.0 - dashRay * 0.45 * (1.0 - glow);
    body = max(body, ringBand * ringMask * mix(0.55, 1.0, 1.0 - glow));
    body *= smoothstep(1.15, 0.42, r0);
    body = clamp(body, 0.0, 1.0);

    // 5. Optional hard 1-bit, then time-driven full-screen invert.
    float crisp = clamp(u_crisp, 0.0, 1.0);
    float bit = step(0.5, body);
    float col = mix(body, bit, crisp);

    float pulse = max(u_pulse, 0.0);
    if (pulse > 0.001 && step(0.5, sin(t * pulse * 6.2831853)) > 0.5) {
        col = 1.0 - col;
    }

    gl_FragColor = vec4(vec3(col), 1.0);
}
