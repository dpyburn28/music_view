// Procedural sky dome with animated clouds (ported from Three-World sky).
// Built-in: u_time, u_resolution, v_uv  (do not redeclare)

uniform vec3 u_topColor;
uniform vec3 u_bottomColor;
uniform float u_horizonOffset;
uniform float u_cloudSpeed;
uniform float u_cloudScale;
uniform float u_cloudDensity;
uniform float u_cloudSoftness;
uniform float u_cloudBrightness;
uniform float u_cloudHeight;

float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);

    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));

    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

void main() {
    vec2 p = (v_uv - 0.5) * vec2(u_resolution.x / u_resolution.y, 1.0);
    vec3 dir = normalize(vec3(p, 0.5));

    float h = clamp(dir.y + u_horizonOffset, 0.0, 1.0);
    vec3 skyColor = mix(u_bottomColor, u_topColor, h);

    vec2 cloudUv = vec2(atan(dir.z, dir.x), dir.y) * u_cloudScale;
    float cloud = noise(cloudUv + u_time * u_cloudSpeed);
    cloud += 0.5 * noise(cloudUv * 2.0 + u_time * u_cloudSpeed * 1.6);
    cloud = smoothstep(u_cloudDensity, u_cloudDensity + u_cloudSoftness, cloud);

    float cloudMask = smoothstep(u_cloudHeight - 0.1, u_cloudHeight + 0.1, dir.y);
    cloud *= cloudMask;

    vec3 cloudColor = vec3(u_cloudBrightness);
    vec3 color = mix(skyColor, cloudColor, cloud * 0.8);

    gl_FragColor = vec4(color, 1.0);
}
