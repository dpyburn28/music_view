// Utility: interlaced field lines, optional field offset and weave.
// Built-in: u_time, u_resolution, v_uv · Required: u_scene

uniform sampler2D u_scene;
uniform float u_amount;
uniform float u_offset;
uniform float u_darken;
uniform float u_animate;
uniform float u_intensity;

vec3 sampleScene(vec2 uv) {
    return texture2D(u_scene, clamp(uv, 0.0, 1.0)).rgb;
}

void main() {
    vec3 original = sampleScene(v_uv);
    float m = clamp(u_intensity, 0.0, 1.0);
    float amt = clamp(u_amount, 0.0, 1.0) * m;
    if (amt < 0.0001) {
        gl_FragColor = vec4(original, 1.0);
        return;
    }

    float line = floor(v_uv.y * u_resolution.y);
    float field = mod(line, 2.0);
    float phase = u_animate > 0.5 ? mod(floor(u_time * 30.0), 2.0) : 0.0;
    float odd = abs(field - phase);

    vec2 uv = v_uv;
    // Shift alternate fields horizontally
    uv.x += (odd * 2.0 - 1.0) * u_offset * amt * 0.02;

    vec3 col = sampleScene(uv);
    // Darken every other line
    col *= 1.0 - odd * clamp(u_darken, 0.0, 1.0) * amt;

    gl_FragColor = vec4(mix(original, col, m), 1.0);
}
