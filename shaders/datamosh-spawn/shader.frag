// Datamosh variant from Three-World: threshold + spawn rate.
// Built-in: u_time, u_resolution, v_uv · Required: u_scene, u_prev

uniform sampler2D u_scene;
uniform sampler2D u_prev;
uniform float u_thresholdMax;
uniform float u_thresholdRamp;
uniform float u_deltaScale;
uniform float u_spawnRate;
uniform float u_spawnScale;
uniform float u_spawnSpeed;
uniform float u_spawnSeed;
uniform float u_intensity;

float hash11(float p) {
    p = fract(p * 0.1031);
    p *= p + 33.33;
    p *= p + p;
    return fract(p);
}

float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

void main() {
    vec3  src        = texture2D(u_scene, v_uv).rgb;
    float currentLum = dot(src, vec3(0.2126, 0.7152, 0.0722));

    vec3  prev    = texture2D(u_prev, v_uv).rgb;
    float prevLum = dot(prev, vec3(0.2126, 0.7152, 0.0722));

    float delta     = abs(currentLum - prevLum) * u_deltaScale;
    float threshold = u_thresholdMax * (1.0 - exp(-u_thresholdRamp * u_time));

    float time  = u_time * max(u_spawnSpeed, 0.0);
    float index = floor(time);
    float chunk = max(u_spawnScale, 1.0);
    bool  spawn = hash12(floor(v_uv * hash11(index + u_spawnSeed) * chunk) + index) > u_spawnRate;

    vec3 result;
    if (u_frame < 1.0 || spawn) {
        result = src;
    } else if (delta < threshold) {
        result = prev;
    } else {
        result = src;
    }

    float m = clamp(u_intensity, 0.0, 1.0);
    gl_FragColor = vec4(mix(src, result, m), 1.0);
}
