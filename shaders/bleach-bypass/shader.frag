// Postprocess: bleach-bypass / skip-bleach cinema look.
// Built-in: u_time, u_resolution, v_uv
// Required: u_scene

uniform sampler2D u_scene;
uniform float u_amount;
uniform float u_contrast;
uniform float u_brightness;
uniform float u_intensity;

float luma(vec3 c) {
    return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

void main() {
    vec3 original = texture2D(u_scene, v_uv).rgb;
    float m = clamp(u_intensity, 0.0, 1.0);
    float amt = clamp(u_amount, 0.0, 1.0);

    float l = luma(original);
    // High-contrast mono layer
    float bw = (l - 0.5) * max(u_contrast, 0.1) + 0.5 + u_brightness;
    bw = clamp(bw, 0.0, 1.0);
    // Overlay-style merge of desaturated contrast onto color
    vec3 base = original;
    vec3 blend = vec3(bw);
    vec3 overlay;
    overlay.r = base.r < 0.5 ? (2.0 * base.r * blend.r) : (1.0 - 2.0 * (1.0 - base.r) * (1.0 - blend.r));
    overlay.g = base.g < 0.5 ? (2.0 * base.g * blend.g) : (1.0 - 2.0 * (1.0 - base.g) * (1.0 - blend.g));
    overlay.b = base.b < 0.5 ? (2.0 * base.b * blend.b) : (1.0 - 2.0 * (1.0 - base.b) * (1.0 - blend.b));

    vec3 desat = mix(original, vec3(l), 0.55);
    vec3 col = mix(desat, overlay, amt);
    col = clamp(col, 0.0, 1.0);

    gl_FragColor = vec4(mix(original, col, m), 1.0);
}
