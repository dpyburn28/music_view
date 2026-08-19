// Volumetric cloud sphere — adapted from Shadertoy "first take at a cloud"
// Built-in: u_time, u_resolution, v_uv  (do not redeclare)

uniform float u_cloudDensity;
uniform float u_cloudScale;
uniform float u_octaves;
uniform float u_softness;
uniform float u_sphereRadius;
uniform float u_threshold;
uniform float u_absorption;
uniform float u_shadowDist;
uniform float u_shadowAbsorb;
uniform float u_secondaryScatter;
uniform float u_forwardScatter;
uniform float u_sunIntensity;
uniform float u_ambientIntensity;
uniform float u_powder;
uniform float u_speed;
uniform float u_windX;
uniform float u_windZ;
uniform float u_camDist;
uniform float u_camHeight;
uniform float u_fov;
uniform float u_stepSize;
uniform vec3 u_sunColor;
uniform vec3 u_skyTop;
uniform vec3 u_skyBottom;
uniform float u_audioDensity;
uniform float u_audioGlow;
uniform float u_audioWind;
uniform float u_beat;
uniform float u_envelope;
uniform float u_bass;
uniform float u_intensity;

float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float noise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
        mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x),
            mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
        mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
            mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y),
        f.z);
}

float fbm(vec3 p) {
    float v = 0.0;
    float a = 0.5;
    vec3 shift = vec3(100.0);
    int oct = int(max(u_octaves, 1.0));
    for (int i = 0; i < 8; i++) {
        if (i >= oct) break;
        v += a * noise(p);
        p = p * 2.0 + shift;
        a *= 0.5;
    }
    return v;
}

float phase(float cT, float g) {
    float g2 = g * g;
    return (1.0 - g2) / (4.0 * 3.14159 * pow(1.0 + g2 - 2.0 * g * cT, 1.5));
}

float sampleDensity(vec3 pos) {
    float sphere = length(pos) - u_sphereRadius;
    if (sphere > 0.0) return 0.0;

    vec3 wind = vec3(u_windX, 0.0, u_windZ);
    float spd = max(u_speed, 0.0);
    float bassPush = u_bass * u_audioWind * 1.5;
    vec3 animPos = pos * u_cloudScale + wind * u_time * spd * (1.0 + bassPush);

    float n = fbm(animPos);
    float edgeFade = smoothstep(1.0, 0.0, length(pos) / max(u_sphereRadius, 0.1) * u_softness);

    float beatPulse = u_beat * u_audioDensity * 0.3;
    float density = max(0.0, (n * u_cloudDensity + beatPulse) * edgeFade);

    if (density < u_threshold) return 0.0;
    return density - u_threshold;
}

void main() {
    vec2 uv = (v_uv - 0.5) * vec2(u_resolution.x / max(u_resolution.y, 1.0), 1.0);

    vec3 camPos = vec3(0.0, u_camHeight, u_camDist);
    vec3 rD = normalize(vec3(uv * u_fov, -1.0));

    float sunAngle = u_time * 0.15;
    vec3 lD = normalize(vec3(sin(sunAngle), 0.8, cos(sunAngle)));

    vec3 color = vec3(0.0);
    float transmittance = 1.0;

    float stepSz = max(u_stepSize, 0.01);
    vec3 rPos = camPos;

    vec3 sky = mix(u_skyBottom, u_skyTop, clamp(v_uv.y + 0.2, 0.0, 1.0));

    float cosTheta = dot(rD, lD);
    float g = max(min(u_forwardScatter, 0.95), 0.0);
    float forwardScatter = phase(cosTheta, g);

    float audioGlowBoost = 1.0 + u_beat * u_audioGlow * 1.5;

    for (int i = 0; i < 80; i++) {
        float d = sampleDensity(rPos);

        if (d > 0.01) {
            float shadowD = sampleDensity(rPos + lD * u_shadowDist);

            float primAbsorb = exp(-shadowD * u_shadowAbsorb);
            float secScatter = exp(-shadowD * 1.0) * u_secondaryScatter;
            float glow = primAbsorb + secScatter;

            float powdering = 1.0 - exp(-d * u_powder);
            float lNRG = glow * powdering * (1.0 + forwardScatter * 2.5) * audioGlowBoost;

            vec3 sunContrib = u_sunColor * lNRG * u_sunIntensity;
            vec3 ambContrib = u_skyBottom * (d * u_ambientIntensity * 5.0);
            vec3 stepColor = sunContrib + ambContrib;

            color += stepColor * d * stepSz * transmittance;
            transmittance *= exp(-d * stepSz * u_absorption);

            if (transmittance < 0.01) {
                transmittance = 0.0;
                break;
            }
        }

        rPos += rD * stepSz;
    }

    vec3 finalColor = color + sky * transmittance;
    float env = clamp(u_envelope, 0.0, 1.0);
    finalColor *= 0.85 + 0.15 * env;

    float a = clamp(u_intensity, 0.0, 1.0);
    gl_FragColor = vec4(finalColor * a, a);
}
