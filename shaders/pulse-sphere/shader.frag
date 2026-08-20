// Pulse Sphere — concentric wave rings pulsing on a radial sphere.

uniform float u_speed;
uniform float u_wave_freq;
uniform float u_wave_depth;
uniform float u_radius;
uniform float u_falloff;
uniform float u_breathe;
uniform float u_breathe_rate;
uniform float u_edge_fade;
uniform float u_bright;
uniform float u_core_dark;
uniform float u_color_r;
uniform float u_color_g;
uniform float u_color_b;

void main() {
    vec2 fragCoord = v_uv * u_resolution;
    vec2 uv = (fragCoord * 2.0 - u_resolution) / min(u_resolution.x, u_resolution.y);

    float t = -u_time * u_speed + 5000.0 + sin(u_time * u_breathe_rate) * u_breathe;

    float dist = distance(uv, vec2(0.0, 0.0)) * 0.6;
    float maxDist = u_radius;
    vec4 color;

    float expDist = dist * dist * dist;
    float strength = (sin(expDist * u_wave_freq) + 1.0) / 2.0;
    float height = (sin(t * u_wave_depth * strength) + 1.0) / 2.0;
    float alpha = 1.0 - expDist / (maxDist * maxDist * maxDist) + (1.0 - height) * -0.014;
    color = vec4(u_bright, u_bright, u_bright, 9.0) * height - (1.0 - alpha) * u_edge_fade;
    color.a = alpha;

    if (dist > maxDist) color = vec4(u_core_dark, u_core_dark, u_core_dark, 0.0);

    vec3 col = color.rgb;
    col *= vec3(u_color_r, u_color_g, u_color_b);

    gl_FragColor = vec4(col, color.a);
}
