// Utility: sparse horizontal/vertical line corruption (tears, flashes, offsets).
// Built-in: u_time, u_resolution, v_uv · Required: u_scene

uniform sampler2D u_scene;
uniform float u_amount;
uniform float u_density;
uniform float u_thickness;
uniform float u_axis;
uniform float u_flash;
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
    float axis = floor(u_axis + 0.5);
    float coord = axis < 0.5 ? v_uv.y : v_uv.x;
    float res = axis < 0.5 ? u_resolution.y : u_resolution.x;
    float line = floor(coord * res);
    float thick = max(u_thickness, 1.0);

    // Group into thick bands
    float band = floor(line / thick);
    float h = hash11(band + t * 19.1);
    float dens = clamp(u_density, 0.0, 1.0);
    float active = step(1.0 - dens * amt, h);

    float shift = (hash11(band * 2.3 + t) - 0.5) * 0.25 * amt * active;
    vec2 uv = v_uv;
    if (axis < 0.5) uv.x += shift;
    else uv.y += shift;

    vec3 col = sampleScene(uv);
    // Flash white/black lines
    float fl = clamp(u_flash, 0.0, 1.0);
    float flashOn = active * step(0.92, hash11(band + t + 3.0));
    col = mix(col, vec3(step(0.5, hash11(band + 7.0))), flashOn * fl);

    // Thin desync chroma on active lines
    if (active > 0.5) {
        vec2 d = axis < 0.5 ? vec2(0.008 * amt, 0.0) : vec2(0.0, 0.008 * amt);
        col.r = sampleScene(uv + d).r;
        col.b = sampleScene(uv - d).b;
    }

    col = mix(original, col, active * amt);
    gl_FragColor = vec4(mix(original, col, m), 1.0);
}
