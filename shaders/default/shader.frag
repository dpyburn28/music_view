// Animated color wash for container backgrounds.
// Optional uniform: u_speed (animation rate multiplier)

uniform float u_speed;

void main() {
    vec2 uv = v_uv;
    vec2 p = uv - 0.5;
    float speed = u_speed > 0.0 ? u_speed : 1.0;
    float t = u_time * speed;
    float r = length(p) * 2.0;
    vec3 col = 0.5 + 0.5 * cos(6.28318 * (vec3(0.2, 0.5, 0.8) * t) + vec3(0.0, 2.0, 4.0) + r * 6.0);
    gl_FragColor = vec4(col, 1.0);
}
