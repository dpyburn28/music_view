// Utility: temporal RGB channel delay via u_prev (feedback). Analog separation / ghost chroma.
uniform sampler2D u_scene;
uniform sampler2D u_prev;
uniform float u_amount;
uniform float u_mix_r;
uniform float u_mix_g;
uniform float u_mix_b;
uniform float u_intensity;

void main() {
    vec3 scene = texture2D(u_scene, v_uv).rgb;
    vec3 prev = texture2D(u_prev, v_uv).rgb;
    float m = clamp(u_intensity, 0.0, 1.0);
    float amt = clamp(u_amount, 0.0, 1.0);
    if (amt * m < 0.0001) {
        gl_FragColor = vec4(scene, 1.0);
        return;
    }

    vec3 col;
    col.r = mix(scene.r, prev.r, clamp(u_mix_r, 0.0, 1.0) * amt);
    col.g = mix(scene.g, prev.g, clamp(u_mix_g, 0.0, 1.0) * amt);
    col.b = mix(scene.b, prev.b, clamp(u_mix_b, 0.0, 1.0) * amt);

    gl_FragColor = vec4(mix(scene, col, m), 1.0);
}
