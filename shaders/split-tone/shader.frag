// Postprocess: split toning — tint shadows and highlights separately.
// Built-in: u_time, u_resolution, v_uv
// Required: u_scene

uniform sampler2D u_scene;
uniform vec3 u_shadows;
uniform vec3 u_highlights;
uniform float u_balance;
uniform float u_amount;
uniform float u_softness;
uniform float u_intensity;

float luma(vec3 c) {
    return dot(c, vec3(0.299, 0.587, 0.114));
}

void main() {
    vec3 original = texture2D(u_scene, v_uv).rgb;
    float m = clamp(u_intensity, 0.0, 1.0) * clamp(u_amount, 0.0, 1.0);
    if (m < 0.0001) {
        gl_FragColor = vec4(original, 1.0);
        return;
    }

    float l = luma(original);
    float bal = clamp(u_balance, 0.0, 1.0);
    float soft = max(u_softness, 0.01);
    // Weight toward shadows vs highlights around balance point
    float hi = smoothstep(bal - soft, bal + soft, l);
    float sh = 1.0 - hi;

    vec3 tinted = original;
    tinted = mix(tinted, tinted * u_shadows * 2.0, sh * 0.55);
    tinted = mix(tinted, mix(tinted, u_highlights, 0.45) + tinted * 0.15, hi * 0.55);
    // Preserve some luminance
    float l2 = luma(tinted);
    tinted *= (l + 0.0001) / (l2 + 0.0001);
    tinted = clamp(tinted, 0.0, 1.0);

    gl_FragColor = vec4(mix(original, tinted, m), 1.0);
}
