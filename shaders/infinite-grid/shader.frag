// Infinite Grid — recursive folded grid with perspective depth and fog.

#define ITE_MAX 15

uniform float u_speed;
uniform float u_scroll_x;
uniform float u_rotation;
uniform float u_zoom;
uniform float u_scale;
uniform float u_line_w;
uniform float u_fog_decay;
uniform float u_color_r;
uniform float u_color_g;
uniform float u_color_b;
uniform float u_intensity;

vec2 rot(vec2 p, float a) {
    return vec2(cos(a) * p.x - sin(a) * p.y, sin(a) * p.x + cos(a) * p.y);
}

vec3 tex(vec2 uv) {
    vec3 c = vec3(fract(uv.xyy));
    if (mod(uv.x * 2.0, 2.0) < (2.0 - u_line_w * 2.0)) return vec3(0.0);
    if (mod(uv.y * 1.0, 1.0) < (2.0 - u_line_w * 2.0)) return vec3(0.0);
    return c;
}

void main() {
    vec2 fragCoord = v_uv * u_resolution;

    float M = u_time * u_speed;
    float fog = 1.0;
    vec2 uv = 2.0 * (fragCoord / u_resolution) - 1.0;
    uv *= vec2(u_resolution.x / u_resolution.y, 1.0);
    uv *= u_zoom;
    uv = rot(uv, u_rotation);
    vec3 c = vec3(0.0);
    for (int i = 0; i < ITE_MAX; i++) {
        c = tex(vec2(uv.x / abs(uv.y / (float(i) + 1.0)) + M + u_scroll_x, abs(uv.y)));
        if (length(c) > 0.5) break;
        uv = uv.yx * u_scale;
        fog *= u_fog_decay;
    }
    vec3 col = vec3(u_color_r, u_color_g, u_color_b) * c.x * (fog * fog);
    col = vec3(1.0) - col;
    float a = clamp(u_intensity * fog, 0.0, 1.0);
    gl_FragColor = vec4(col * a, a);
}
