// Postprocess: radial chromatic aberration.
// Built-in: u_time, u_resolution, v_uv
// Required: u_scene

uniform sampler2D u_scene;
uniform float u_amount;
uniform float u_intensity;

vec3 sampleScene(vec2 uv) {
    return texture2D(u_scene, clamp(uv, 0.0, 1.0)).rgb;
}

void main() {
    vec3 original = sampleScene(v_uv);
    float amt = max(u_amount, 0.0);

    vec2 dir = v_uv - 0.5;
    // Slightly stronger on long axis so portrait stages still read
    float aspect = u_resolution.x / max(u_resolution.y, 1.0);
    dir.x *= aspect;

    vec3 col;
    col.r = sampleScene(v_uv + dir * amt).r;
    col.g = sampleScene(v_uv).g;
    col.b = sampleScene(v_uv - dir * amt).b;

    float m = clamp(u_intensity, 0.0, 1.0);
    gl_FragColor = vec4(mix(original, col, m), 1.0);
}
