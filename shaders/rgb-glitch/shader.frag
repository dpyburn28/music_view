// Postprocess: horizontal slice RGB glitch.
// Built-in: u_time, u_resolution, v_uv
// Required: u_scene

uniform sampler2D u_scene;
uniform float u_amount;
uniform float u_slices;
uniform float u_chroma;
uniform float u_speed;
uniform float u_intensity;

float hash11(float n) {
    return fract(sin(n) * 43758.5453123);
}

vec3 sampleScene(vec2 uv) {
    return texture2D(u_scene, clamp(uv, 0.0, 1.0)).rgb;
}

void main() {
    vec3 original = sampleScene(v_uv);
    float amt = clamp(u_amount, 0.0, 1.0);
    float m = clamp(u_intensity, 0.0, 1.0);

    if (amt * m < 0.0001) {
        gl_FragColor = vec4(original, 1.0);
        return;
    }

    float slices = max(floor(u_slices + 0.5), 1.0);
    float band = floor(v_uv.y * slices);
    float t = floor(u_time * max(u_speed, 0.0));
    float h = hash11(band + t * 17.13);
    float h2 = hash11(band * 3.1 + t * 9.7);

    // Occasional active slices
    float active = step(1.0 - amt * 0.85, h);
    float shift = (h2 - 0.5) * 0.12 * amt * active;

    vec2 uv = v_uv + vec2(shift, 0.0);
    float ch = max(u_chroma, 0.0) * amt * active;

    vec3 col;
    col.r = sampleScene(uv + vec2(ch, 0.0)).r;
    col.g = sampleScene(uv).g;
    col.b = sampleScene(uv - vec2(ch * 1.15, 0.0)).b;

    // Mild scanline tear on strong bands
    float tear = active * step(0.92, h2) * amt;
    col = mix(col, sampleScene(uv + vec2(shift * 2.0, 0.0)), tear * 0.5);

    gl_FragColor = vec4(mix(original, col, m), 1.0);
}
