// Cloud Sky — 2D procedural cloud layer with ridged FBM over a gradient sky.

uniform float u_speed;
uniform float u_cloudscale;
uniform float u_cloudcover;
uniform float u_cloudalpha;
uniform float u_clouddark;
uniform float u_cloudlight;
uniform float u_skytint;
uniform vec3 u_skycolour1;
uniform vec3 u_skycolour2;
uniform float u_intensity;

const mat2 m = mat2(1.6, 1.2, -1.2, 1.6);

vec2 hash(vec2 p) {
    p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
    return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
}

float noise(vec2 p) {
    const float K1 = 0.366025404;
    const float K2 = 0.211324865;
    vec2 i = floor(p + (p.x + p.y) * K1);
    vec2 a = p - i + (i.x + i.y) * K2;
    vec2 o = (a.x > a.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec2 b = a - o + K2;
    vec2 c = a - 1.0 + 2.0 * K2;
    vec3 h = max(0.5 - vec3(dot(a, a), dot(b, b), dot(c, c)), 0.0);
    vec3 n = h * h * h * h * vec3(dot(a, hash(i + 0.0)), dot(b, hash(i + o)), dot(c, hash(i + 1.0)));
    return dot(n, vec3(70.0));
}

float fbm(vec2 n) {
    float total = 0.0, amplitude = 0.1;
    for (int i = 0; i < 7; i++) {
        total += noise(n) * amplitude;
        n = m * n;
        amplitude *= 0.4;
    }
    return total;
}

void main() {
    vec2 fragCoord = v_uv * u_resolution;
    vec2 p = fragCoord.xy / u_resolution.xy;
    vec2 uv = p * vec2(u_resolution.x / u_resolution.y, 1.0);
    float time = u_time * u_speed;
    float q = fbm(uv * u_cloudscale * 0.5);

    // Ridged noise shape
    float r = 0.0;
    uv *= u_cloudscale;
    uv -= q - time;
    float weight = 0.8;
    for (int i = 0; i < 8; i++) {
        r += abs(weight * noise(uv));
        uv = m * uv + time;
        weight *= 0.7;
    }

    // Noise shape
    float f = 0.0;
    uv = p * vec2(u_resolution.x / u_resolution.y, 1.0);
    uv *= u_cloudscale;
    uv -= q - time;
    weight = 0.7;
    for (int i = 0; i < 8; i++) {
        f += weight * noise(uv);
        uv = m * uv + time;
        weight *= 0.6;
    }

    f *= r + f;

    // Noise colour
    float c = 0.0;
    float time2 = u_time * u_speed * 2.0;
    uv = p * vec2(u_resolution.x / u_resolution.y, 1.0);
    uv *= u_cloudscale * 2.0;
    uv -= q - time2;
    weight = 0.4;
    for (int i = 0; i < 7; i++) {
        c += weight * noise(uv);
        uv = m * uv + time2;
        weight *= 0.6;
    }

    // Noise ridge colour
    float c1 = 0.0;
    float time3 = u_time * u_speed * 3.0;
    uv = p * vec2(u_resolution.x / u_resolution.y, 1.0);
    uv *= u_cloudscale * 3.0;
    uv -= q - time3;
    weight = 0.4;
    for (int i = 0; i < 7; i++) {
        c1 += abs(weight * noise(uv));
        uv = m * uv + time3;
        weight *= 0.6;
    }

    c += c1;

    vec3 skycolour = mix(u_skycolour2, u_skycolour1, p.y);
    vec3 cloudcolour = vec3(1.1, 1.1, 0.9) * clamp((u_clouddark + u_cloudlight * c), 0.0, 1.0);

    f = u_cloudcover + u_cloudalpha * f * r;

    vec3 result = mix(skycolour, clamp(u_skytint * skycolour + cloudcolour, 0.0, 1.0), clamp(f + c, 0.0, 1.0));

    float a = clamp(u_intensity, 0.0, 1.0);
    gl_FragColor = vec4(result * a, a);
}
