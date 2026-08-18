// Postprocess: filmic tone curve + mild grade (ACES-inspired rational).
// Built-in: u_time, u_resolution, v_uv
// Required: u_scene

uniform sampler2D u_scene;
uniform float u_exposure;
uniform float u_contrast;
uniform float u_saturation;
uniform float u_shoulder;
uniform float u_toe;
uniform float u_intensity;

float luma(vec3 c) {
    return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

// Cheap filmic curve: (x*(a*x+b))/(x*(c*x+d)+e) simplified
vec3 filmicCurve(vec3 x, float shoulder, float toe) {
    float a = 2.51 + shoulder * 0.4;
    float b = 0.03 + toe * 0.08;
    float c = 2.43 + shoulder * 0.25;
    float d = 0.59;
    float e = 0.14 + toe * 0.05;
    return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

void main() {
    vec3 original = texture2D(u_scene, v_uv).rgb;
    float m = clamp(u_intensity, 0.0, 1.0);

    vec3 col = original * exp2(u_exposure);
    // Pre-contrast around mid grey
    float mid = 0.18;
    col = (col - mid) * max(u_contrast, 0.01) + mid;
    col = max(col, 0.0);
    col = filmicCurve(col, clamp(u_shoulder, 0.0, 1.0), clamp(u_toe, 0.0, 1.0));

    float l = luma(col);
    col = mix(vec3(l), col, max(u_saturation, 0.0));
    col = clamp(col, 0.0, 1.0);

    gl_FragColor = vec4(mix(original, col, m), 1.0);
}
