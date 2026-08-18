// Utility: extract / emphasize a bit plane of the image (binary structure).
uniform sampler2D u_scene;
uniform float u_bit;
uniform float u_mode;
uniform float u_mono;
uniform float u_intensity;

float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

void main() {
    vec3 original = texture2D(u_scene, v_uv).rgb;
    float m = clamp(u_intensity, 0.0, 1.0);
    if (m < 0.0001) {
        gl_FragColor = vec4(original, 1.0);
        return;
    }

    float bit = clamp(floor(u_bit + 0.5), 0.0, 7.0);
    float levels = pow(2.0, bit);
    // Extract bit plane via saw quantization
    vec3 scaled = original * 255.0;
    // Approximate: show whether value crosses mid of that bit
    float stepSize = 256.0 / pow(2.0, bit + 1.0);
    vec3 plane = step(0.5, fract(scaled / max(stepSize * 2.0, 1.0)));

    if (u_mono > 0.5) {
        float l = luma(original) * 255.0;
        float p = step(0.5, fract(l / max(stepSize * 2.0, 1.0)));
        plane = vec3(p);
    }

    float mode = floor(u_mode + 0.5);
    vec3 col;
    if (mode < 0.5) {
        col = plane;
    } else if (mode < 1.5) {
        col = original * plane;
    } else {
        col = mix(original, 1.0 - original, plane.r);
    }

    gl_FragColor = vec4(mix(original, clamp(col, 0.0, 1.0), m), 1.0);
}
