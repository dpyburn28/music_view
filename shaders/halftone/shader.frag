// Postprocess: circular halftone dots.
// Built-in: u_time, u_resolution, v_uv
// Required: u_scene

uniform sampler2D u_scene;
uniform float u_scale;
uniform float u_angle;
uniform float u_contrast;
uniform vec3 u_color_ink;
uniform vec3 u_color_paper;
uniform float u_intensity;

void main() {
    vec3 original = texture2D(u_scene, v_uv).rgb;
    float luma = dot(original, vec3(0.299, 0.587, 0.114));
    float c = max(u_contrast, 0.01);
    luma = clamp((luma - 0.5) * c + 0.5, 0.0, 1.0);

    // Rotate pixel grid
    float a = radians(u_angle);
    float ca = cos(a);
    float sa = sin(a);
    vec2 p = v_uv * u_resolution;
    vec2 pr = vec2(ca * p.x - sa * p.y, sa * p.x + ca * p.y);

    float scale = max(u_scale, 0.5);
    vec2 cell = fract(pr / scale) - 0.5;
    float d = length(cell);

    // Larger dots in darker areas (print convention)
    float radius = (1.0 - luma) * 0.55;
    float dotMask = 1.0 - smoothstep(radius, radius + 0.08, d);
    vec3 col = mix(u_color_paper, u_color_ink, dotMask);

    float m = clamp(u_intensity, 0.0, 1.0);
    gl_FragColor = vec4(mix(original, col, m), 1.0);
}
