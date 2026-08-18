// Postprocess: multi-sector polar kaleidoscope.
// Built-in: u_time, u_resolution, v_uv
// Required: u_scene

uniform sampler2D u_scene;
uniform float u_segments;
uniform float u_angle;
uniform float u_zoom;
uniform float u_spin;
uniform float u_intensity;

vec2 toPolar(vec2 p) {
    return vec2(length(p), atan(p.y, p.x));
}

void main() {
    vec3 original = texture2D(u_scene, v_uv).rgb;
    float m = clamp(u_intensity, 0.0, 1.0);
    if (m < 0.0001) {
        gl_FragColor = vec4(original, 1.0);
        return;
    }

    float segs = max(floor(u_segments + 0.5), 2.0);
    float sector = 6.2831853 / segs;

    vec2 p = (v_uv - 0.5) * max(u_zoom, 0.2);
    // Compensate aspect so circles stay round on portrait
    float aspect = u_resolution.x / max(u_resolution.y, 1.0);
    p.x *= aspect;

    float spin = u_angle + u_time * u_spin;
    float c = cos(spin);
    float s = sin(spin);
    p = vec2(c * p.x - s * p.y, s * p.x + c * p.y);

    vec2 pol = toPolar(p);
    float a = pol.y;
    // Fold into [0, sector] then mirror
    a = mod(a, sector);
    if (a > sector * 0.5) a = sector - a;
    // Rebuild cartesian
    vec2 q = vec2(cos(a), sin(a)) * pol.x;
    q.x /= max(aspect, 0.0001);
    vec2 uv = clamp(q + 0.5, 0.0, 1.0);

    vec3 col = texture2D(u_scene, uv).rgb;
    gl_FragColor = vec4(mix(original, col, m), 1.0);
}
