// Geometric Grid — animated shapes with hash-based randomness and symmetry.

uniform float u_speed;
uniform float u_zoom;
uniform float u_intensity;
uniform vec3 u_bg_color;

float h21(vec2 p) {
    return fract(1e3 * sin(dot(ceil(p), vec2(127.1, 311.7))));
}

float box2(vec2 p) {
    return max(abs(p).x, abs(p).y);
}

vec2 circ(float t) {
    return cos(t + vec2(11.0, 0.0));
}

float lineSeg(vec2 p, vec2 a, vec2 b) {
    p -= a;
    b -= a;
    return length(p - b * clamp(dot(p, b) / dot(b, b), 0.0, 1.0));
}

void main() {
    vec2 fragCoord = v_uv * u_resolution;
    vec2 R = u_resolution;
    vec2 U = u_zoom * 6.0 * (fragCoord + fragCoord - R) / R.y;
    vec2 F = fract(U) - 0.5;

    float t = u_time * u_speed;

    int i = int(5.0 * h21(U));
    int c = int(4.0 * h21(U + 1.0));
    float r = 8.0 * h21(U + 2.0);
    int ri = int(r);

    float d;
    float f = 1.0;
    t += h21(U + 3.0) * 6.0;

    // Symmetry
    if (i != 1) {
        if (ri < 4) { F = vec2(F.y, F.x); }
        if (mod(r, 4.0) < 2.0) { F.x *= -1.0; }
        if (mod(r, 2.0) < 1.0) { F.y *= -1.0; }
    }

    d = 0.5 - F.y;
    vec2 P;

    if (i < 1) {
        // Box
        P = circ(t + sin(4.0 * t) / 4.0);
        d = min(0.5 - box2(F), box2(F - 0.35 * P / box2(P)) - 0.1);
    } else if (i < 2) {
        // Pendulum
        P = -0.6 * circ(0.5 * sin(4.0 * t));
        P.y += 0.5;
        d = min(d, min(length(P - F) - 0.2, lineSeg(F, vec2(0.0, 0.5), P)));
    } else if (i < 3) {
        // Fan
        d = min(d, lineSeg(F, vec2(0.0, 0.5), vec2(0.0, 0.3)));
        d = min(d, lineSeg(length(F) * circ(mod(t + atan(F.y, F.x), 2.1)), vec2(0.0), vec2(0.0, 0.3)));
        d = min(d, min(length(length(F) - 0.3), length(F) - 0.1));
    } else if (i < 4) {
        // Pendulum pair
        t = mod(t + t, 4.0);
        P = vec2(0.15, 0.25 * clamp(min(t, 4.0 - t) * 2.0 - 2.0, -1.0, 1.0));
        d = min(d, min(length(P - F) - 0.1, lineSeg(F, vec2(0.15, 0.5), P)));
        d = min(d, min(length(P + F) - 0.1, lineSeg(F, vec2(-0.15, 0.5), -P)));
    } else if (i < 5) {
        // S-curve
        t = mod(t, 6.0) - 3.0;
        if (length(t) < 1.0) {
            P = vec2(0.2, 0.0) + 0.2 * circ(-3.14 * length(t) - 1.57);
        } else {
            P = vec2(0.4, abs(t / 2.0) - 0.5);
        }
        d = min(d, length(t < 0.0 ? P + F : P - F) - 0.1);
        if (F.y > 0.0) { F = -F; }
        d = min(d, lineSeg(-F, vec2(0.4, 0.5), vec2(0.4, 0.0)));
        if (F.y < 0.0) {
            d = min(d, length(length(F - vec2(0.2, 0.0)) - 0.2));
        }
    }

    // Anti-aliased color
    float aa = smoothstep(0.0, 20.0 / R.y, length(d));
    vec3 shapeColor = vec3(
        float(c == 0 || c == 3),
        float(c == 1 || c == 3),
        float(c == 2)
    );
    vec3 col = mix(shapeColor, u_bg_color, aa);

    float a = clamp(u_intensity, 0.0, 1.0);
    gl_FragColor = vec4(col * a, a);
}
