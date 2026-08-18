// Final postprocess: sample the composited scene, add film grain.
// Built-in: u_time, u_resolution, v_uv
// Required: u_scene (sampler2D of the captured frame)
// Declared uniforms are driven by controls.json

uniform sampler2D u_scene;
uniform float u_amount;

float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

float ign(vec2 p) {
    return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}

void main() {
    vec4 scene = texture2D(u_scene, v_uv);

    vec2 pix = v_uv * u_resolution;
    float n = hash21(pix + floor(u_time * 60.0));
    n = mix(n, ign(pix + u_time * 10.0), 0.35);

    float amount = u_amount;
    if (amount <= 0.0) amount = 0.12;

    scene.rgb += (n - 0.5) * amount;

    gl_FragColor = vec4(scene.rgb, 1.0);
}
