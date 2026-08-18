// Final postprocess: digital projector / cinema lamp.
// Built-in: u_time, u_resolution, v_uv
// Required: u_scene

uniform sampler2D u_scene;
uniform float u_softness;
uniform float u_hotspot;
uniform float u_vignette;
uniform float u_dust;
uniform float u_rainbow;
uniform float u_brightness;
uniform float u_contrast;
uniform vec3 u_tint;
uniform float u_intensity;

float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

vec3 sampleScene(vec2 uv) {
    return texture2D(u_scene, clamp(uv, 0.0, 1.0)).rgb;
}

void main() {
    vec2 uv = v_uv;
    vec3 original = sampleScene(uv);
    float mixAmt = clamp(u_intensity, 0.0, 1.0);

    // Soft focus (multi-tap blur)
    float soft = clamp(u_softness, 0.0, 1.0);
    vec2 px = (1.0 + soft * 3.0) / max(u_resolution, vec2(1.0));
    vec3 col = sampleScene(uv) * 0.28;
    col += sampleScene(uv + vec2(px.x, 0.0)) * 0.14;
    col += sampleScene(uv - vec2(px.x, 0.0)) * 0.14;
    col += sampleScene(uv + vec2(0.0, px.y)) * 0.14;
    col += sampleScene(uv - vec2(0.0, px.y)) * 0.14;
    col += sampleScene(uv + px) * 0.08;
    col += sampleScene(uv - px) * 0.08;

    // DLP rainbow fringe (slight channel offsets that pulse with time)
    float rb = clamp(u_rainbow, 0.0, 1.0);
    if (rb > 0.001) {
        float phase = sin(u_time * 9.0) * 0.5 + 0.5;
        float off = rb * 0.004 * (0.5 + phase);
        vec2 dir = normalize(uv - 0.5 + 1e-5);
        float r = sampleScene(uv + dir * off).r;
        float g = col.g;
        float b = sampleScene(uv - dir * off * 1.1).b;
        col = mix(col, vec3(r, g, b), rb * 0.85);
    }

    // Center hotspot (brighter middle of throw)
    float hot = clamp(u_hotspot, 0.0, 1.0);
    if (hot > 0.001) {
        float d = length(uv - 0.5);
        float spot = exp(-d * d * mix(2.0, 8.0, 1.0 - hot));
        col *= 1.0 + spot * hot * 0.45;
    }

    // Vignette / falloff toward edges of screen
    float vig = clamp(u_vignette, 0.0, 1.0);
    if (vig > 0.001) {
        vec2 vc = uv * 2.0 - 1.0;
        float v = 1.0 - dot(vc, vc) * 0.5 * vig;
        col *= clamp(v, 0.0, 1.0);
    }

    // Dust / dirt on lens or glass (mostly static + slight drift)
    float dust = max(u_dust, 0.0);
    if (dust > 0.0001) {
        vec2 dp = uv * u_resolution * 0.35 + vec2(u_time * 0.4, -u_time * 0.15);
        float speckle = hash21(floor(dp));
        float fine = hash21(uv * u_resolution + 17.0);
        float spots = smoothstep(0.88, 0.98, speckle) * fine;
        col *= 1.0 - spots * dust * 1.4;
        // A few larger soft blotches
        float blot = hash21(floor(uv * 12.0 + 3.0));
        blot = smoothstep(0.75, 1.0, blot) * (0.5 + 0.5 * sin(uv.x * 20.0));
        col *= 1.0 - blot * dust * 0.35;
    }

    col = (col - 0.5) * max(u_contrast, 0.01) + 0.5;
    col *= max(u_brightness, 0.0);
    col *= u_tint;

    col = clamp(col, 0.0, 1.0);
    gl_FragColor = vec4(mix(original, col, mixAmt), 1.0);
}
