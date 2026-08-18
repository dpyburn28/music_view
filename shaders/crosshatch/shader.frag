// Postprocess: luminance crosshatch sketch.
uniform sampler2D u_scene;
uniform float u_density;
uniform float u_thickness;
uniform float u_contrast;
uniform vec3 u_color_ink;
uniform vec3 u_color_paper;
uniform float u_intensity;

void main() {
    vec3 original = texture2D(u_scene, v_uv).rgb;
    float luma = dot(original, vec3(0.299, 0.587, 0.114));
    float c = max(u_contrast, 0.01);
    luma = clamp((luma - 0.5) * c + 0.5, 0.0, 1.0);

    float dens = max(u_density, 1.0);
    vec2 p = v_uv * u_resolution / dens;
    float thick = clamp(u_thickness, 0.02, 0.95) * 0.5;

    // Darker → more hatch layers
    float h0 = step(luma, 0.85) * (1.0 - smoothstep(0.0, thick, abs(fract(p.x + p.y) - 0.5)));
    float h1 = step(luma, 0.65) * (1.0 - smoothstep(0.0, thick, abs(fract(p.x - p.y) - 0.5)));
    float h2 = step(luma, 0.4) * (1.0 - smoothstep(0.0, thick, abs(fract(p.x * 1.5) - 0.5)));
    float h3 = step(luma, 0.2) * (1.0 - smoothstep(0.0, thick, abs(fract(p.y * 1.5) - 0.5)));
    float ink = clamp(h0 + h1 + h2 + h3, 0.0, 1.0);

    vec3 col = mix(u_color_paper, u_color_ink, ink);
    float m = clamp(u_intensity, 0.0, 1.0);
    gl_FragColor = vec4(mix(original, col, m), 1.0);
}
