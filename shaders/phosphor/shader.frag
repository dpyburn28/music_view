// Final postprocess: phosphor persistence (temporal feedback).
// Built-in: u_time, u_resolution, v_uv
// Required: u_scene
// Optional pipeline: u_prev — previous postprocess frame (provided by shaders.js)

uniform sampler2D u_scene;
uniform sampler2D u_prev;
uniform float u_decay;
uniform float u_gain;
uniform float u_threshold;
uniform float u_bloom;
uniform vec3 u_tint;
uniform float u_intensity;

float luma(vec3 c) {
    return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

void main() {
    vec2 uv = v_uv;
    vec3 scene = texture2D(u_scene, uv).rgb;
    vec3 prev = texture2D(u_prev, uv).rgb;
    float mixAmt = clamp(u_intensity, 0.0, 1.0);

    // Soft bloom on the new frame so trails start a bit wider
    float bloom = max(u_bloom, 0.0);
    vec3 fresh = scene * max(u_gain, 0.0);
    if (bloom > 0.001) {
        vec2 px = 1.5 / max(u_resolution, vec2(1.0));
        vec3 b =
            texture2D(u_scene, uv + vec2(px.x, 0.0)).rgb +
            texture2D(u_scene, uv - vec2(px.x, 0.0)).rgb +
            texture2D(u_scene, uv + vec2(0.0, px.y)).rgb +
            texture2D(u_scene, uv - vec2(0.0, px.y)).rgb;
        b *= 0.25;
        fresh = mix(fresh, max(fresh, b), bloom);
    }

    // Decay previous phosphor glow
    float decay = clamp(u_decay, 0.0, 0.99);
    vec3 trail = prev * decay;

    // Only keep trails above a floor so blacks don't muddy
    float thr = max(u_threshold, 0.0);
    float tL = luma(trail);
    trail *= smoothstep(thr * 0.25, thr + 0.05, tL);

    // Additive-ish max blend: bright motion leaves residue
    vec3 col = max(fresh, trail);
    // Slight additive mix so trails glow over dark UI
    col = mix(col, fresh + trail * 0.65, 0.35);

    col *= u_tint;
    col = clamp(col, 0.0, 1.0);
    gl_FragColor = vec4(mix(scene, col, mixAmt), 1.0);
}
