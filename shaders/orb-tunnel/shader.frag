// Orb Tunnel — raymarched twisted tunnel with glowing orb light source.
// Optimized for real-time: configurable step count and fractal depth.

uniform float u_speed;
uniform float u_steps;
uniform float u_detail;
uniform float u_twist;
uniform float u_glow;
uniform float u_intensity;

vec4 tanh4(vec4 x) {
    return x / (1.0 + abs(x));
}

float orb(vec3 p, float t) {
    vec3 orbPos = vec3(
        sin(sin(t * 0.2) + t * 0.4) * 6.0,
        1.0 + sin(sin(t * 0.5) + t * 0.2) * 4.0,
        12.0 + t + cos(t * 0.3) * 8.0
    );
    return length(p - orbPos);
}

void main() {
    vec2 fragCoord = v_uv * u_resolution;
    float t = u_time * u_speed;
    vec2 uv = (fragCoord + fragCoord - u_resolution.xy) / u_resolution.y;

    uv += vec2(cos(t * 0.1) * 0.3, cos(t * 0.3) * 0.1);

    float maxSteps = mix(24.0, 72.0, u_steps);
    int steps = int(maxSteps);
    int fbmIters = int(mix(1.0, 5.0, u_detail));

    vec4 o = vec4(0.0);
    float d = 0.0;
    float s = 0.0;
    float e = 0.0;

    for (int i = 0; i < 72; i++) {
        if (i >= steps) break;

        vec3 p = vec3(uv * d, d + t);

        e = orb(p, t) - 0.1;

        p.xy *= mat2(cos(0.1 * t + p.z / 8.0 + vec4(0.0, 33.0, 11.0, 0.0)));
        p.xy *= mix(1.0, u_twist, 1.0);

        s = 4.0 - abs(p.y);

        for (int j = 0; j < 5; j++) {
            float a = 0.8 * pow(2.0, float(j));
            if (a > 16.0) break;
            p += cos(0.7 * t + p.yzx) * 0.2;
            s -= abs(dot(sin(0.1 * t + p * a), vec3(0.6))) / a;
        }

        d += s = min(0.03 + 0.2 * abs(s), max(0.5 * e, 0.01));
        o += vec4(1.0) / (s + e * 3.0 * u_glow);
    }

    o = tanh4(o / 10.0);

    float a = clamp(u_intensity, 0.0, 1.0);
    gl_FragColor = vec4(o.rgb * a, a);
}
