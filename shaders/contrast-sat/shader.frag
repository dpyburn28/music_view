// Postprocess: brightness, contrast, saturation.
// Built-in: u_time, u_resolution, v_uv
// Required: u_scene

uniform sampler2D u_scene;
uniform float u_brightness;
uniform float u_contrast;
uniform float u_saturation;
uniform float u_intensity;

void main() {
    vec3 original = texture2D(u_scene, v_uv).rgb;
    vec3 col = original;

    // Brightness (multiplicative)
    col *= max(u_brightness, 0.0);

    // Contrast around mid-grey
    float c = max(u_contrast, 0.0);
    col = (col - 0.5) * c + 0.5;

    // Saturation via luma mix
    float luma = dot(col, vec3(0.299, 0.587, 0.114));
    float sat = max(u_saturation, 0.0);
    col = mix(vec3(luma), col, sat);

    col = clamp(col, 0.0, 1.0);
    float m = clamp(u_intensity, 0.0, 1.0);
    gl_FragColor = vec4(mix(original, col, m), 1.0);
}
