// Morph Grid — shapes continuously morph between circle, square, diamond, and star.
// Spinoff of geometric-grid: same visual style, different algorithm.

uniform float u_speed;
uniform float u_zoom;
uniform float u_morph_speed;
uniform float u_pulse;
uniform float u_intensity;
uniform vec3 u_bg_color;

float h21(vec2 p) {
    return fract(1e3 * sin(dot(ceil(p), vec2(127.1, 311.7))));
}

vec2 rot(vec2 p, float a) {
    float c = cos(a), s = sin(a);
    return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
}

// Signed distance to a superellipse |x|^n + |y|^n = r^n
float superellipse(vec2 p, float n) {
    p = abs(p);
    float k = pow(pow(p.x, n) + pow(p.y, n), 1.0 / n);
    return k;
}

// Signed distance to a 4-pointed star
float star4(vec2 p, float r) {
    float a = atan(p.y, p.x);
    float l = length(p);
    float wave = 1.0 + 0.3 * sin(a * 4.0);
    return l / (r * wave);
}

// Morph between shapes based on parameter t in [0, 4)
// 0=circle, 1=square, 2=diamond, 3=star
float shapeDist(vec2 p, float t) {
    float d;
    if (t < 1.0) {
        // Circle → Square
        float n = mix(2.0, 40.0, t);
        d = superellipse(p, n);
    } else if (t < 2.0) {
        // Square → Diamond (rotate 45°)
        float ft = t - 1.0;
        vec2 rp = rot(p, ft * 0.7854); // 45°
        float n = mix(40.0, 2.0, ft);
        d = superellipse(rp, n);
    } else if (t < 3.0) {
        // Diamond → Star
        float ft = t - 2.0;
        float diamond = length(rot(p, 0.7854));
        float star = star4(p, 1.0);
        d = mix(diamond, star, ft);
    } else {
        // Star → Circle
        float ft = t - 3.0;
        float star = star4(p, 1.0);
        d = mix(star, length(p), ft);
    }
    return d;
}

void main() {
    vec2 fragCoord = v_uv * u_resolution;
    vec2 R = u_resolution;
    vec2 U = u_zoom * 6.0 * (fragCoord + fragCoord - R) / R.y;
    vec2 cell = floor(U);
    vec2 F = fract(U) - 0.5;

    float t = u_time * u_speed;

    // Per-cell random parameters
    float h0 = h21(cell);
    float h1 = h21(cell + 1.0);
    float h2 = h21(cell + 2.0);
    float h3 = h21(cell + 3.0);

    // Rotation: each cell rotates at its own speed
    float rotSpeed = (h0 - 0.5) * 4.0;
    float rotAngle = t * rotSpeed + h1 * 6.28;
    vec2 p = rot(F, rotAngle);

    // Morph: continuous shape interpolation
    float morphPhase = t * u_morph_speed * 0.5 + h2 * 4.0;
    float morphT = mod(morphPhase, 4.0);

    // Size pulse
    float size = 0.35 + u_pulse * 0.1 * sin(t * 2.0 + h3 * 6.28);

    // Distance to shape
    float d = shapeDist(p / size, morphT) * size;

    // Color: driven by morph phase
    float hue = mod(morphPhase * 0.25 + h2, 1.0);
    vec3 col;
    // HSV to RGB (simplified)
    float h6 = hue * 6.0;
    float c = 0.8;
    float x = c * (1.0 - abs(mod(h6, 2.0) - 1.0));
    if (h6 < 1.0) col = vec3(c, x, 0.0);
    else if (h6 < 2.0) col = vec3(x, c, 0.0);
    else if (h6 < 3.0) col = vec3(0.0, c, x);
    else if (h6 < 4.0) col = vec3(0.0, x, c);
    else if (h6 < 5.0) col = vec3(x, 0.0, c);
    else col = vec3(c, 0.0, x);

    // Anti-aliased edge
    float aa = smoothstep(0.0, 20.0 / R.y, d);

    // Inner glow: brighter near center
    float glow = exp(-d * 4.0) * 0.3;
    col += glow;

    col = mix(col, u_bg_color, aa);

    float a = clamp(u_intensity, 0.0, 1.0);
    gl_FragColor = vec4(col * a, a);
}
