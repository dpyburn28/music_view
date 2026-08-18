// Postprocess: horizontal scan tears / rolling glitch bands.
// Built-in: u_time, u_resolution, v_uv
// Required: u_scene

uniform sampler2D u_scene;
uniform float u_amount;
uniform float u_speed;
uniform float u_band;
uniform float u_softness;
uniform float u_intensity;

float hash11(float n) {
    return fract(sin(n) * 43758.5453123);
}

vec3 sampleScene(vec2 uv) {
    return texture2D(u_scene, clamp(uv, 0.0, 1.0)).rgb;
}

void main() {
    vec3 original = sampleScene(v_uv);
    float m = clamp(u_intensity, 0.0, 1.0);
    float amt = clamp(u_amount, 0.0, 1.0) * m;
    if (amt < 0.0001) {
        gl_FragColor = vec4(original, 1.0);
        return;
    }

    float bandH = max(u_band, 0.02);
    float t = u_time * max(u_speed, 0.0);
    // Rolling tear centers
    float y1 = fract(t * 0.17);
    float y2 = fract(t * 0.11 + 0.37);
    float y3 = fract(t * 0.23 + 0.61);

    float d1 = abs(v_uv.y - y1);
    float d2 = abs(v_uv.y - y2);
    float d3 = abs(v_uv.y - y3);
    float d = min(d1, min(d2, d3));
    float soft = max(u_softness, 0.001);
    float bandMask = 1.0 - smoothstep(bandH * (1.0 - soft), bandH, d);
    bandMask *= amt;

    // Per-band horizontal offset
    float which = step(d2, d1) * 2.0 + step(d3, min(d1, d2));
    float seed = floor(v_uv.y * 48.0) + floor(t * 3.0);
    float shift = (hash11(seed + which * 13.1) - 0.5) * 0.22 * bandMask;

    vec2 uv = v_uv + vec2(shift, 0.0);
    // Mild vertical squash inside band
    uv.y += (hash11(seed * 1.7) - 0.5) * 0.012 * bandMask;

    vec3 col = sampleScene(uv);
    // Desync chroma on tears
    col.r = sampleScene(uv + vec2(0.008 * bandMask, 0.0)).r;
    col.b = sampleScene(uv - vec2(0.01 * bandMask, 0.0)).b;

    gl_FragColor = vec4(mix(original, col, clamp(bandMask * 1.2, 0.0, 1.0)), 1.0);
}
