// Utility: multi-axis slice warping glitch (H/V/both) with chroma and stretch.
// Built-in: u_time, u_resolution, v_uv · Required: u_scene

uniform sampler2D u_scene;
uniform float u_amount;
uniform float u_slices_h;
uniform float u_slices_v;
uniform float u_axis;
uniform float u_chroma;
uniform float u_stretch;
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
    float m = clamp(u_intensity, 0.0, 1.0);
    float amt = clamp(u_amount, 0.0, 1.0);
    if (amt * m < 0.0001) {
        gl_FragColor = vec4(original, 1.0);
        return;
    }

    float t = floor(u_time * max(u_speed, 0.0));
    float axis = floor(u_axis + 0.5); // 0 H, 1 V, 2 both
    vec2 uv = v_uv;

    if (axis < 0.5 || axis > 1.5) {
        float sh = max(floor(u_slices_h + 0.5), 1.0);
        float band = floor(v_uv.y * sh);
        float h = hash11(band + t * 17.13);
        float active = step(1.0 - amt * 0.9, h);
        float shift = (hash11(band * 3.1 + t) - 0.5) * 0.2 * amt * active;
        float str = 1.0 + (hash11(band + 9.0 + t) - 0.5) * u_stretch * active * amt;
        uv.x = (uv.x - 0.5) / max(str, 0.2) + 0.5 + shift;
    }
    if (axis > 0.5) {
        float sv = max(floor(u_slices_v + 0.5), 1.0);
        float band = floor(v_uv.x * sv);
        float h = hash11(band + t * 11.9 + 4.0);
        float active = step(1.0 - amt * 0.9, h);
        float shift = (hash11(band * 2.7 + t + 2.0) - 0.5) * 0.15 * amt * active;
        uv.y = uv.y + shift;
    }

    float ch = max(u_chroma, 0.0) * amt;
    vec3 col;
    col.r = sampleScene(uv + vec2(ch, 0.0)).r;
    col.g = sampleScene(uv).g;
    col.b = sampleScene(uv - vec2(ch * 1.1, 0.0)).b;

    gl_FragColor = vec4(mix(original, col, m), 1.0);
}
