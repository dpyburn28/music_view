// Utility: bit-depth crush with optional dither and channel independence.
// Built-in: u_time, u_resolution, v_uv · Required: u_scene

uniform sampler2D u_scene;
uniform float u_bits;
uniform float u_dither;
uniform float u_scale;
uniform float u_perChannel;
uniform float u_intensity;

float ign(vec2 p) {
    return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}

float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

void main() {
    vec3 original = texture2D(u_scene, v_uv).rgb;
    float m = clamp(u_intensity, 0.0, 1.0);
    if (m < 0.0001) {
        gl_FragColor = vec4(original, 1.0);
        return;
    }

    float bits = clamp(floor(u_bits + 0.5), 1.0, 8.0);
    float steps = pow(2.0, bits) - 1.0;
    float dith = clamp(u_dither, 0.0, 1.0);
    vec2 pix = floor(v_uv * u_resolution / max(u_scale, 0.5));
    float n = ign(pix) - 0.5;

    vec3 col;
    if (u_perChannel > 0.5) {
        col = original + n * dith / max(steps, 1.0);
        col = floor(col * steps + 0.5) / steps;
    } else {
        float l = luma(original) + n * dith / max(steps, 1.0);
        l = floor(l * steps + 0.5) / steps;
        // Preserve chroma ratio roughly
        float lo = luma(original);
        col = original * ((l + 0.0001) / (lo + 0.0001));
        col = clamp(col, 0.0, 1.0);
    }

    gl_FragColor = vec4(mix(original, clamp(col, 0.0, 1.0), m), 1.0);
}
