// Postprocess: pixelate / mosaic.
// Built-in: u_time, u_resolution, v_uv
// Required: u_scene

uniform sampler2D u_scene;
uniform float u_size;
uniform float u_intensity;

void main() {
    vec3 original = texture2D(u_scene, v_uv).rgb;
    float block = max(u_size, 1.0);

    vec2 cell = floor((v_uv * u_resolution) / block);
    vec2 uvPix = (cell + 0.5) * block / max(u_resolution, vec2(1.0));
    vec3 pix = texture2D(u_scene, clamp(uvPix, 0.0, 1.0)).rgb;

    float m = clamp(u_intensity, 0.0, 1.0);
    gl_FragColor = vec4(mix(original, pix, m), 1.0);
}
