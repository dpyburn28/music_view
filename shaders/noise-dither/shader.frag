uniform sampler2D u_scene;
uniform float u_scale;
uniform float u_strength;
uniform float u_keepColor;
uniform float u_intensity;

float hash(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);

    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));

    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

void main() {
    vec3 sourcePixel = texture2D(u_scene, v_uv).rgb;
    float grayscale   = dot(sourcePixel, vec3(0.2126, 0.7152, 0.0722));

    float ditherNoise = noise(mod(gl_FragCoord.xy / u_scale, 1.0) * 100.0);
    ditherNoise      -= 0.5;
    ditherNoise      *= u_strength;

    float dithered = grayscale + ditherNoise;
    float bit      = dithered >= 0.5 ? 1.0 : 0.0;

    vec3 ditherValue = vec3(bit);
    vec3 ditherColor = step(0.5, sourcePixel + ditherNoise);

    vec3 finalColor = mix(ditherValue, ditherColor, u_keepColor);

    float m = clamp(u_intensity, 0.0, 1.0);
    gl_FragColor = vec4(mix(sourcePixel, finalColor, m), 1.0);
}
