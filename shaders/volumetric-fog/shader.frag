// Volumetric Fog — Sebastien Hillaire's Frostbite SIGGRAPH'15 demo.
// Ported to music_view. Procedural noise replaces iChannel0 texture.
// Optimized: reduced raymarch iterations, configurable quality.

uniform float u_speed;
uniform float u_quality;
uniform float u_fog_noise;
uniform float u_fog_density;
uniform float u_fog_height;
uniform float u_shadow;
uniform float u_light_intensity;
uniform float u_improved;
uniform float u_intensity;
uniform float u_vignette;

// ============================================================
// Procedural noise (replaces iChannel0 texture)
// ============================================================

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

float displacementSimple(vec2 p) {
    float f = 0.0;
    f += 0.6000 * noise(p); p *= 2.1;
    f += 0.4000 * noise(p);
    return f;
}

// ============================================================
// Scene SDF
// ============================================================

float getClosestDistance(vec3 p, out float material) {
    float minD = 1.0;
    material = 0.0;

    float yNoise = 1.0 * clamp(displacementSimple(p.xz * 0.005), 0.0, 1.0);
    float xNoise = 2.0 * clamp(displacementSimple(p.zy * 0.005), 0.0, 1.0);
    float zNoise = 0.5 * clamp(displacementSimple(p.xy * 0.01), 0.0, 1.0);

    float d = max(0.0, p.y - yNoise);
    if (d < minD) { minD = d; material = 2.0; }

    d = max(0.0, p.x - xNoise);
    if (d < minD) { minD = d; material = 1.0; }

    d = max(0.0, 40.0 - p.x - xNoise);
    if (d < minD) { minD = d; material = 1.0; }

    d = max(0.0, -p.z - zNoise);
    if (d < minD) { minD = d; material = 3.0; }

    return minD;
}

vec3 calcNormal(vec3 pos) {
    float m;
    vec3 eps = vec3(0.3, 0.0, 0.0);
    return normalize(vec3(
        getClosestDistance(pos + eps.xyy, m) - getClosestDistance(pos - eps.xyy, m),
        getClosestDistance(pos + eps.yxy, m) - getClosestDistance(pos - eps.yxy, m),
        getClosestDistance(pos + eps.yyx, m) - getClosestDistance(pos - eps.yyx, m)
    ));
}

vec3 getSceneColor(vec3 p, float material) {
    if (material == 1.0) return vec3(1.0, 0.5, 0.5);
    if (material == 2.0) return vec3(0.5, 1.0, 0.5);
    if (material == 3.0) return vec3(0.5, 0.5, 1.0);
    return vec3(0.0);
}

// ============================================================
// Lighting
// ============================================================

vec3 evaluateLight(vec3 pos) {
    vec3 L = vec3(20.0 + 15.0 * sin(u_time * u_speed), 15.0 + 12.0 * cos(u_time * u_speed), -20.0) - pos;
    return (600.0 * u_light_intensity * vec3(1.0, 0.9, 0.5)) / dot(L, L);
}

vec3 evaluateLight(vec3 pos, vec3 normal) {
    vec3 L = vec3(20.0 + 15.0 * sin(u_time * u_speed), 15.0 + 12.0 * cos(u_time * u_speed), -20.0) - pos;
    float d = length(L);
    return max(0.0, dot(normal, L / d)) * evaluateLight(pos);
}

// ============================================================
// Participating media
// ============================================================

void getParticipatingMedia(out float sigmaS, out float sigmaE, vec3 pos) {
    float heightFog = u_fog_height + u_fog_noise * 3.0 * clamp(displacementSimple(pos.xz * 0.005 + u_time * u_speed * 0.01), 0.0, 1.0);
    heightFog = 0.3 * clamp((heightFog - pos.y) * 1.0, 0.0, 1.0);

    float fogFactor = 1.0 + u_fog_density * 5.0;

    float sphereRadius = 5.0;
    float sphereFog = clamp((sphereRadius - length(pos - vec3(20.0, 19.0, -17.0))) / sphereRadius, 0.0, 1.0);

    float constantFog = 0.02;
    sigmaS = constantFog + heightFog * fogFactor + sphereFog;
    sigmaE = max(0.000000001, sigmaS);
}

float phaseFunction() {
    return 1.0 / (4.0 * 3.14159);
}

// ============================================================
// Volumetric shadow
// ============================================================

float volumetricShadow(vec3 from, vec3 to) {
    float numStep = mix(2.0, 8.0, u_quality);
    float shadow = 1.0;
    float sigmaS = 0.0;
    float sigmaE = 0.0;
    float dd = length(to - from) / numStep;

    for (int s = 0; s < 8; s++) {
        float sf = float(s) + 0.5;
        if (sf >= numStep) break;
        vec3 pos = from + (to - from) * (sf / numStep);
        getParticipatingMedia(sigmaS, sigmaE, pos);
        shadow *= exp(-sigmaE * dd);
    }
    return mix(1.0, shadow, u_shadow);
}

// ============================================================
// Raymarch
// ============================================================

void traceScene(vec3 rO, vec3 rD, inout vec3 finalPos, inout vec3 normal, inout vec3 albedo, inout vec4 scatTrans) {
    float sigmaS = 0.0;
    float sigmaE = 0.0;

    vec3 lightPos = vec3(20.0 + 15.0 * sin(u_time * u_speed), 15.0 + 12.0 * cos(u_time * u_speed), -20.0);

    float transmittance = 1.0;
    vec3 scatteredLight = vec3(0.0);

    float d = 1.0;
    float material = 0.0;
    float dd = 0.0;

    int maxIter = int(mix(16.0, 48.0, u_quality));

    for (int i = 0; i < 48; i++) {
        if (i >= maxIter) break;

        vec3 p = rO + d * rD;

        getParticipatingMedia(sigmaS, sigmaE, p);

        if (u_improved > 0.5) {
            vec3 S = evaluateLight(p) * sigmaS * phaseFunction() * volumetricShadow(p, lightPos);
            vec3 Sint = (S - S * exp(-sigmaE * dd)) / sigmaE;
            scatteredLight += transmittance * Sint;
            transmittance *= exp(-sigmaE * dd);
        } else {
            scatteredLight += sigmaS * evaluateLight(p) * phaseFunction() * volumetricShadow(p, lightPos) * transmittance * dd;
            transmittance *= exp(-sigmaE * dd);
        }

        dd = getClosestDistance(p, material);
        if (dd < 0.2) break;
        d += dd;
    }

    albedo = getSceneColor(rO + d * rD, material);
    finalPos = rO + d * rD;
    normal = calcNormal(finalPos);
    scatTrans = vec4(scatteredLight, transmittance);
}

// ============================================================
// Main
// ============================================================

void main() {
    vec2 fragCoord = v_uv * u_resolution;
    vec2 uv = fragCoord / u_resolution;

    float hfactor = u_resolution.y / u_resolution.x;
    vec2 uv2 = vec2(2.0, 2.0 * hfactor) * fragCoord / u_resolution - vec2(1.0, hfactor);

    vec3 camPos = vec3(20.0, 18.0, -50.0);
    vec3 rO = camPos;
    vec3 rD = normalize(uv2.x * vec3(1.0, 0.0, 0.0) + uv2.y * vec3(0.0, 1.0, 0.0) + vec3(0.0, 0.0, 1.0));

    vec3 finalPos = rO;
    vec3 albedo = vec3(0.0);
    vec3 normal = vec3(0.0);
    vec4 scatTrans = vec4(0.0);

    traceScene(rO, rD, finalPos, normal, albedo, scatTrans);

    vec3 color = (albedo / 3.14159) * evaluateLight(finalPos, normal) * volumetricShadow(finalPos, vec3(20.0 + 15.0 * sin(u_time * u_speed), 15.0 + 12.0 * cos(u_time * u_speed), -20.0));
    color = color * scatTrans.w + scatTrans.xyz;
    color = pow(color, vec3(1.0 / 2.2));

    float vigAmt = clamp(u_vignette, 0.0, 1.0);
    if (vigAmt > 0.0) {
        vec2 p = (uv - 0.5) * vec2(u_resolution.x / max(u_resolution.y, 1.0), 1.0);
        float r = length(p);
        float vig = mix(1.0, smoothstep(1.2, 0.15, r), vigAmt);
        color *= 0.6 + 0.4 * vig;
    }

    float a = clamp(u_intensity, 0.0, 1.0);
    gl_FragColor = vec4(color * a, a);
}
