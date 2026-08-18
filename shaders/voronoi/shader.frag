// Postprocess: Voronoi / crystal cell mosaic with edge lines.
// Built-in: u_time, u_resolution, v_uv
// Required: u_scene

uniform sampler2D u_scene;
uniform float u_scale;
uniform float u_edge;
uniform float u_jitter;
uniform float u_animate;
uniform float u_intensity;

vec2 hash22(vec2 p) {
    p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
    return fract(sin(p) * 43758.5453);
}

void main() {
    vec3 original = texture2D(u_scene, v_uv).rgb;
    float m = clamp(u_intensity, 0.0, 1.0);
    if (m < 0.0001) {
        gl_FragColor = vec4(original, 1.0);
        return;
    }

    float sc = max(u_scale, 2.0);
    vec2 uv = v_uv * sc;
    // Mild aspect correction
    uv.x *= u_resolution.x / max(u_resolution.y, 1.0);

    vec2 i = floor(uv);
    vec2 f = fract(uv);

    float minD = 8.0;
    float minD2 = 8.0;
    vec2 minPt = vec2(0.0);

    for (float y = -1.0; y <= 1.0; y += 1.0) {
        for (float x = -1.0; x <= 1.0; x += 1.0) {
            vec2 g = vec2(x, y);
            vec2 o = hash22(i + g);
            o = 0.5 + 0.5 * sin(u_time * max(u_animate, 0.0) + 6.2831 * o);
            o = mix(vec2(0.5), o, clamp(u_jitter, 0.0, 1.0));
            vec2 r = g + o - f;
            float d = dot(r, r);
            if (d < minD) {
                minD2 = minD;
                minD = d;
                minPt = (i + g + o) / sc;
            } else if (d < minD2) {
                minD2 = d;
            }
        }
    }

    // Sample scene at cell center (convert back)
    minPt.x /= max(u_resolution.x / max(u_resolution.y, 1.0), 0.0001);
    vec2 cellUv = clamp(minPt, 0.0, 1.0);
    vec3 cellCol = texture2D(u_scene, cellUv).rgb;

    float edge = smoothstep(0.0, max(u_edge, 0.001), sqrt(minD2) - sqrt(minD));
    vec3 col = mix(cellCol * 0.15, cellCol, edge);
    // Dark cell borders
    col *= mix(0.25, 1.0, edge);

    gl_FragColor = vec4(mix(original, col, m), 1.0);
}
