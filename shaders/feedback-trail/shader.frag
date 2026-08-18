// Postprocess: temporal feedback trail (requires u_prev from stack).
// Built-in: u_time, u_resolution, v_uv
// Required: u_scene, u_prev
//
// Output is copied into u_prev for the next frame. Classic trail:
//   col = mix(scene, prev(zoomed/rotated), decay * trailMix)

uniform sampler2D u_scene;
uniform sampler2D u_prev;
uniform float u_decay;
uniform float u_zoom;
uniform float u_rotate;
uniform float u_mix;
uniform float u_intensity;

vec2 rotate2(vec2 p, float a) {
    float c = cos(a);
    float s = sin(a);
    return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
}

void main() {
    vec3 scene = texture2D(u_scene, v_uv).rgb;

    vec2 c = v_uv - 0.5;
    float z = max(u_zoom, 0.01);
    c = rotate2(c / z, u_rotate);
    vec2 puv = clamp(c + 0.5, 0.0, 1.0);

    vec3 prev = texture2D(u_prev, puv).rgb;
    float decay = clamp(u_decay, 0.0, 0.98);
    float trailMix = clamp(u_mix, 0.0, 1.0);

    // Blend previous (transformed) into current; decay keeps trails from sticking forever
    vec3 trailed = mix(scene, prev, decay * trailMix);
    // Soft lighten so motion reads on dark stages
    vec3 col = max(trailed, scene * (1.0 - trailMix * 0.15));

    col = clamp(col, 0.0, 1.0);
    float m = clamp(u_intensity, 0.0, 1.0);
    gl_FragColor = vec4(mix(scene, col, m), 1.0);
}
