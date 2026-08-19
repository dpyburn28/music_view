// Full procedural sky dome (ported from Three-World sky_desert).
// Built-in: u_time, u_resolution, v_uv  (do not redeclare)

uniform float u_sunAzimuth;
uniform float u_sunElevation;
uniform vec3 u_sunColor;
uniform float u_sunSize;
uniform float u_sunBloom;
uniform vec3 u_zenithColor;
uniform vec3 u_horizonColor;
uniform vec3 u_groundColor;
uniform float u_horizonSharpness;
uniform float u_horizonOffset;
uniform vec3 u_hazeColor;
uniform float u_hazeStrength;
uniform float u_cloudSpeed;
uniform float u_cloudScale;
uniform float u_cloudDensity;
uniform float u_cloudSoftness;
uniform float u_cloudBrightness;
uniform float u_cloudHeight;
uniform vec3 u_cloudColor;
uniform vec3 u_cloudShadowColor;
uniform float u_starDensity;
uniform float u_starBrightness;
uniform float u_starSize;
uniform float u_nightBlend;

float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float hash3(vec3 p) {
    return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
}

float noise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p);
    f = f*f*(3.0-2.0*f);
    return mix(
        mix(hash(i),           hash(i+vec2(1,0)), f.x),
        mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x),
        f.y
    );
}

float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
    for (int i = 0; i < 6; i++) {
        v += a * noise(p);
        p  = rot * p * 2.1 + vec2(5.2, 1.3);
        a *= 0.5;
    }
    return v;
}

float stars(vec3 dir) {
    vec2 uv   = vec2(atan(dir.z, dir.x), asin(clamp(dir.y, -1.0, 1.0)));
    uv       *= u_starDensity;

    vec2 cell = floor(uv);
    vec2 frac = fract(uv);
    float star = 0.0;

    for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
            vec2  nc     = cell + vec2(float(x), float(y));
            float rng    = hash(nc);
            float rng2   = hash(nc + vec2(13.7, 57.3));
            vec2  center = vec2(rng, rng2);
            float dist   = length(frac - vec2(float(x), float(y)) - center);

            float bright = hash(nc + vec2(99.1, 7.3));
            bright       = pow(bright, 3.0);

            float size   = u_starSize * (0.5 + bright * 0.5) * 0.03;
            star        += bright * smoothstep(size, size * 0.3, dist);
        }
    }

    float twinkle = 0.8 + 0.2 * sin(u_time * 1.5 + hash3(dir * 10.0) * 40.0);
    return star * twinkle * u_starBrightness;
}

vec3 sunDisc(vec3 dir, vec3 sunDir) {
    float cosAngle = dot(dir, sunDir);
    float angle    = acos(clamp(cosAngle, -1.0, 1.0));

    float disc   = smoothstep(u_sunSize, u_sunSize * 0.7, angle);
    float bloom1 = exp(-angle * 8.0  / max(u_sunBloom, 0.001)) * 0.6;
    float bloom2 = exp(-angle * 20.0 / max(u_sunBloom, 0.001)) * 0.3;
    float bloom3 = exp(-angle * 2.0  / max(u_sunBloom * 3.0, 0.001)) * 0.15;

    float total  = clamp(disc + bloom1 + bloom2 + bloom3, 0.0, 1.0);
    vec3 coronaColor = mix(u_sunColor * 1.2, vec3(1.0), disc);
    return coronaColor * total;
}

float mieScatter(vec3 dir, vec3 sunDir) {
    float cosTheta = dot(dir, sunDir);
    return u_hazeStrength * pow(max(0.0, cosTheta), 6.0);
}

void main() {
    vec2 p = (v_uv - 0.5) * vec2(u_resolution.x / u_resolution.y, 1.0);
    vec3 dir = normalize(vec3(p, 0.5));
    float h = dir.y;

    vec3 sunDir = normalize(vec3(
        cos(u_sunAzimuth) * cos(u_sunElevation),
        sin(u_sunElevation),
        sin(u_sunAzimuth) * cos(u_sunElevation)
    ));

    // Sky gradient
    float hUp   = clamp( h + u_horizonOffset, 0.0, 1.0);
    float hDown = clamp(-h + u_horizonOffset, 0.0, 1.0);

    vec3 skyColor = mix(u_horizonColor, u_zenithColor, pow(hUp, u_horizonSharpness));
    skyColor      = mix(skyColor, u_groundColor, pow(hDown * 1.5, 0.7));

    // Mie / haze
    float mie     = mieScatter(dir, sunDir);
    float nearH   = exp(-abs(h) * 4.0);
    float sunHemi = max(0.0, dot(dir, sunDir));
    skyColor      = mix(skyColor, u_hazeColor, mie * nearH * sunHemi * 0.7);

    // Clouds
    float cloudProj = max(dir.y + u_cloudHeight, 0.05);
    vec2  cloudUv   = dir.xz / cloudProj * u_cloudScale;

    float c = fbm(cloudUv + u_time * u_cloudSpeed);
    c      += 0.5 * fbm(cloudUv * 2.0 + u_time * u_cloudSpeed * 1.6);
    c      /= 1.5;
    float cloud = smoothstep(u_cloudDensity, u_cloudDensity + u_cloudSoftness, c);

    float cloudMask = smoothstep(u_cloudHeight - 0.05, u_cloudHeight + 0.15, dir.y);
    cloud          *= cloudMask;

    float sunDot   = dot(dir, sunDir);
    float cloudLit = 0.6 + 0.4 * sunDot;
    vec3  cCol     = mix(u_cloudShadowColor, u_cloudColor * u_cloudBrightness, cloudLit);
    skyColor       = mix(skyColor, cCol, cloud * 0.85);

    // Stars
    float starVis = smoothstep(-0.05, 0.1, h) * u_nightBlend;
    starVis      *= (1.0 - cloud * 0.95);
    skyColor     += vec3(0.9, 0.92, 1.0) * stars(dir) * starVis;

    // Sun
    float sunElevation = sunDir.y;
    float sunVis       = smoothstep(-0.1, 0.05, sunElevation);
    skyColor          += sunDisc(dir, sunDir) * sunVis;

    gl_FragColor = vec4(skyColor, 1.0);
}
