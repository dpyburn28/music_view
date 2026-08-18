// Utility: RGB channel shift, swap, isolate, and gain — versatile color channel toolkit.
// Built-in: u_time, u_resolution, v_uv · Required: u_scene
//
// u_mode: 0 offset RGB, 1 swap modes, 2 isolate, 3 gain only

uniform sampler2D u_scene;
uniform float u_shift_r;
uniform float u_shift_g;
uniform float u_shift_b;
uniform float u_swap;
uniform float u_isolate;
uniform float u_gain_r;
uniform float u_gain_g;
uniform float u_gain_b;
uniform float u_intensity;

vec3 sampleScene(vec2 uv) {
    return texture2D(u_scene, clamp(uv, 0.0, 1.0)).rgb;
}

void main() {
    vec3 original = sampleScene(v_uv);
    float m = clamp(u_intensity, 0.0, 1.0);
    if (m < 0.0001) {
        gl_FragColor = vec4(original, 1.0);
        return;
    }

    // Channel UV offsets (in UV units)
    float r = sampleScene(v_uv + vec2(u_shift_r, 0.0)).r;
    float g = sampleScene(v_uv + vec2(u_shift_g, 0.0)).g;
    float b = sampleScene(v_uv + vec2(u_shift_b, 0.0)).b;
    vec3 col = vec3(r, g, b);

    // Swap: 0 none, 1 R<->G, 2 G<->B, 3 R<->B, 4 rotate, 5 reverse rotate
    float sw = floor(u_swap + 0.5);
    if (abs(sw - 1.0) < 0.1) col = col.grb;
    else if (abs(sw - 2.0) < 0.1) col = col.rbg;
    else if (abs(sw - 3.0) < 0.1) col = col.bgr;
    else if (abs(sw - 4.0) < 0.1) col = col.gbr;
    else if (abs(sw - 5.0) < 0.1) col = col.brg;

    // Isolate: 0 none, 1 R, 2 G, 3 B, 4 luma as RGB
    float iso = floor(u_isolate + 0.5);
    if (abs(iso - 1.0) < 0.1) col = vec3(col.r);
    else if (abs(iso - 2.0) < 0.1) col = vec3(col.g);
    else if (abs(iso - 3.0) < 0.1) col = vec3(col.b);
    else if (abs(iso - 4.0) < 0.1) {
        float l = dot(col, vec3(0.299, 0.587, 0.114));
        col = vec3(l);
    }

    col *= vec3(max(u_gain_r, 0.0), max(u_gain_g, 0.0), max(u_gain_b, 0.0));
    col = clamp(col, 0.0, 1.0);

    gl_FragColor = vec4(mix(original, col, m), 1.0);
}
