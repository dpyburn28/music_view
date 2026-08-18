// Postprocess: shadow / mid / highlight color balance.
uniform sampler2D u_scene;
uniform vec3 u_shadows;
uniform vec3 u_mids;
uniform vec3 u_highs;
uniform float u_amount;
uniform float u_intensity;

void main() {
    vec3 original = texture2D(u_scene, v_uv).rgb;
    float luma = dot(original, vec3(0.299, 0.587, 0.114));

    // Soft weights for three bands
    float wS = 1.0 - smoothstep(0.0, 0.45, luma);
    float wH = smoothstep(0.55, 1.0, luma);
    float wM = 1.0 - wS - wH;
    wM = max(wM, 0.0);

    // Colors as offset from mid-grey (0.5)
    vec3 tS = (u_shadows - 0.5) * 2.0;
    vec3 tM = (u_mids - 0.5) * 2.0;
    vec3 tH = (u_highs - 0.5) * 2.0;
    vec3 tint = tS * wS + tM * wM + tH * wH;

    float amt = clamp(u_amount, 0.0, 1.0);
    vec3 col = clamp(original + tint * amt, 0.0, 1.0);

    float m = clamp(u_intensity, 0.0, 1.0);
    gl_FragColor = vec4(mix(original, col, m), 1.0);
}
