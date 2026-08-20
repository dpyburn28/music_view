// Blackbody Audio — physically accurate thermal radiation colored by audio energy.
// Ported from Shadertoy blackbody spectral shader.
//
// blackbody_medium() returns vec3(g/r, b/r, log2(red)) in reduced form.
// Reconstruction: RGB(cd/m^2) = vec3(1, max(v.x,0), max(v.y,0)) * exp2(v.z)

uniform float u_beat;
uniform float u_envelope;
uniform float u_beat_phase;
uniform float u_bass;
uniform float u_audio_mode;
uniform float u_audio_strength;
uniform float u_decay;
uniform float u_temp_lo;
uniform float u_temp_hi;
uniform float u_bg_temp;
uniform float u_spatial_mode;
uniform float u_spatial_scale;
uniform float u_spatial_speed;
uniform float u_falloff;
uniform float u_display;
uniform float u_exposure;
uniform float u_saturation;
uniform float u_intensity;
uniform float u_vignette;
uniform vec3 u_bg_color;

// ============================================================
// Blackbody engine — MEDIUM: quartic/quintic rational approx
// 20 constants, ~17 scalar FMAs, ~11-bit accuracy.
// Returns vec3(g/r, b/r, log2(red)) — reduced form.
// ============================================================

vec3 blackbody_medium(float k) {
    float q = 1.0 + k * (0.0299137719 + k * (1.40601833e-05 + k * (2.94006375e-09 + k * (6.70869556e-13 + k * -1.02836417e-18))));
    vec3 p = vec3(1.01807159e-12, 2.57236094e-12, 2.42448093e-11);
    p = p * k + vec3(2.2798361e-09, -7.58461116e-09, 8.64530918e-08);
    p = p * k + vec3(5.87886871e-06, 6.45831369e-06, 0.000416288938);
    p = p * k + vec3(-0.0104534607, -0.00270667253, 0.655528724);
    p = p * k + vec3(1.69109762, 0.314461112, -1006.27917);
    return p / q;
}

const float K_LO = 798.0;
const float K_HI = 5772.0;
const float REF_LUM = 30720.0;
const float EV_LO = -21.96;
const float EV_HI = 15.87;

// ============================================================
// sRGB gamma
// ============================================================

vec3 srgb_encode(vec3 c) {
    c = clamp(c, 0.0, 1.0);
    vec3 lo = c * 12.92;
    vec3 hi = 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055;
    return mix(hi, lo, step(c, vec3(0.0031308)));
}

// ============================================================
// SMPTE ST.2084 PQ
// ============================================================

const float PQ_M1 = 0.1593017578125;
const float PQ_M2 = 78.84375;
const float PQ_C1 = 0.8359375;
const float PQ_C2 = 18.8515625;
const float PQ_C3 = 18.6875;
const float SCENE_LINEAR_TO_PQ = 203.0 / 10000.0;
const float PQ_TO_SCENE_LINEAR = 10000.0 / 203.0;

vec3 pq_encode3(vec3 x) {
    x = pow(max(x, 0.0), vec3(PQ_M1));
    x = (PQ_C1 + PQ_C2 * x) / (1.0 + PQ_C3 * x);
    return pow(x, vec3(PQ_M2));
}

vec3 pq_decode3(vec3 x) {
    x = pow(max(x, 0.0), vec3(1.0 / PQ_M2));
    x = max(x - PQ_C1, vec3(0.0)) / (PQ_C2 - PQ_C3 * x);
    return pow(x, vec3(1.0 / PQ_M1));
}

// ============================================================
// IPT opponent color space over PQ-encoded LMS
// ============================================================

const mat3 BT709_TO_LMS = mat3(
    0.29576408, 0.15619198, 0.03510228,
    0.62307245, 0.72725164, 0.15658995,
    0.08116675, 0.11655793, 0.80830303);
const mat3 LMS_TO_BT709 = mat3(
    6.17353266, -1.32403191, -0.01159839,
   -5.32089882,  2.56026977, -0.26492145,
    0.14735489, -0.23623862,  1.27652634);
const mat3 LMS_TO_IPT = mat3(
    0.4000,  4.4550,  0.8056,
    0.4000, -4.8510,  0.3572,
    0.2000,  0.3960, -1.1628);
const mat3 IPT_TO_LMS = mat3(
    1.0,        1.0,        1.0,
    0.0975689, -0.1138760,  0.0326151,
    0.2052260,  0.1332170, -0.6768870);

vec3 rgb_to_ipt(vec3 rgb) {
    return LMS_TO_IPT * pq_encode3((BT709_TO_LMS * rgb) * SCENE_LINEAR_TO_PQ);
}

vec3 ipt_to_rgb(vec3 ipt) {
    return LMS_TO_BT709 * (pq_decode3(IPT_TO_LMS * ipt) * PQ_TO_SCENE_LINEAR);
}

// ============================================================
// Hue-preserving display clip
// ============================================================

vec3 display_clip(vec3 frame_linear) {
    float x = pow(SCENE_LINEAR_TO_PQ, PQ_M1);
    float I_MAX = pow((PQ_C1 + PQ_C2 * x) / (1.0 + PQ_C3 * x), PQ_M2);

    vec3 ipt = rgb_to_ipt(max(frame_linear, 0.0));
    float i_orig = ipt.x;
    ipt.x = clamp(ipt.x, 0.0, I_MAX);

    vec2 hull = vec2(i_orig, ipt.x);
    hull = ((hull - 6.0) * hull + 9.0) * hull;
    ipt.yz *= min(i_orig / max(ipt.x, 1e-6), hull.y / max(hull.x, 1e-6));

    return ipt_to_rgb(ipt);
}

// ============================================================
// Diverging exposure palette
// ============================================================

vec3 luma_palette_ev(float e) {
    vec3 b2 = vec3(0.03, 0.05, 0.22);
    vec3 b1 = vec3(0.25, 0.45, 0.85);
    vec3 n  = vec3(0.95, 0.95, 0.92);
    vec3 w1 = vec3(0.98, 0.62, 0.20);
    vec3 w2 = vec3(0.45, 0.05, 0.05);
    if (e < 0.0) {
        float u = clamp(1.0 - e / EV_LO, 0.0, 1.0) * 2.0;
        return u < 1.0 ? mix(b2, b1, u) : mix(b1, n, u - 1.0);
    }
    float u = clamp(e / EV_HI, 0.0, 1.0) * 2.0;
    return u < 1.0 ? mix(n, w1, u) : mix(w1, w2, u - 1.0);
}

// ============================================================
// Spatial patterns — each returns a 0..1 weight
// ============================================================

float spatial_radial(vec2 p, float t) {
    float r = length(p);
    float falloff = max(u_falloff, 0.3);
    return exp(-pow(r, falloff) * u_spatial_scale);
}

float spatial_gradient(vec2 p, float t) {
    float shift = t * u_spatial_speed * 0.15;
    float v = p.y + shift;
    v = v * u_spatial_scale * 0.5 + 0.5;
    return clamp(v, 0.0, 1.0);
}

float spatial_rings(vec2 p, float t) {
    float r = length(p);
    float wave = sin((r * 8.0 - t * 3.0 * u_spatial_speed) * u_spatial_scale) * 0.5 + 0.5;
    wave = pow(wave, 2.0);
    float fade = exp(-r * 1.5);
    return wave * fade;
}

float spatial_noise(vec2 p, float t) {
    float n = 0.0;
    float a = 0.5;
    vec2 shift = vec2(100.0);
    vec2 q = p * u_spatial_scale + shift;
    float tScaled = t * u_spatial_speed * 0.5;
    for (int i = 0; i < 4; i++) {
        vec2 r = q;
        r.x += tScaled * float(i) * 0.37;
        r.y += tScaled * float(i) * 0.23;
        q = vec2(
            dot(r, vec2(127.1, 311.7)),
            dot(r, vec2(269.5, 183.3))
        );
        q = -1.0 + 2.0 * fract(sin(q) * 43758.5453);
        n += a * (sin(q.x * 6.28318 + tScaled) * 0.5 + 0.5);
        q = p * u_spatial_scale + shift;
        a *= 0.5;
        q *= 2.0;
    }
    return clamp(n, 0.0, 1.0);
}

float spatial_bars(vec2 p, float t) {
    float barCount = max(u_spatial_scale * 8.0, 2.0);
    float x = p.x * 0.5 + 0.5;
    float bar = floor(x * barCount);
    float h = fract(sin(bar * 127.1 + 311.7) * 43758.5453);
    h = pow(h, 0.6);
    float pulse = sin(bar * 0.5 + t * u_spatial_speed * 2.0) * 0.15;
    return clamp(h + pulse, 0.0, 1.0);
}

// ============================================================
// Audio -> temperature mapping
// ============================================================

float compute_audio_factor(float beat, float env, float bass, float strength) {
    float mode = u_audio_mode;
    if (mode < 0.5) {
        return env * strength;
    } else if (mode < 1.5) {
        float flash = beat * strength;
        float decay = exp(-u_beat_phase * u_decay);
        return flash * decay;
    } else if (mode < 2.5) {
        return bass * strength;
    } else {
        float energy = env * strength * 0.5;
        float flash = beat * strength * exp(-u_beat_phase * u_decay * 2.0) * 0.8;
        float lo = bass * strength * 0.4;
        return clamp(energy + flash + lo, 0.0, 1.0);
    }
}

// ============================================================
// Main pipeline
// ============================================================

void main() {
    vec2 uv = v_uv;
    vec2 p = (uv - 0.5) * vec2(u_resolution.x / max(u_resolution.y, 1.0), 1.0);
    float r = length(p);

    float beat = clamp(u_beat, 0.0, 1.0);
    float env  = clamp(u_envelope, 0.0, 1.0);
    float bass = clamp(u_bass, 0.0, 1.0);

    float strength = max(u_audio_strength, 0.0);
    float audioFactor = compute_audio_factor(beat, env, bass, strength);

    // Spatial pattern
    float tAnim = u_time;
    float sm = u_spatial_mode;
    float sw;
    if (sm < 0.5) {
        sw = spatial_radial(p, tAnim);
    } else if (sm < 1.5) {
        sw = spatial_gradient(p, tAnim);
    } else if (sm < 2.5) {
        sw = spatial_rings(p, tAnim);
    } else if (sm < 3.5) {
        sw = spatial_noise(p, tAnim);
    } else {
        sw = spatial_bars(p, tAnim);
    }
    sw = clamp(sw + bass * 0.15, 0.0, 1.0);

    // Effective temperature
    float lo = max(u_temp_lo, K_LO);
    float hi = max(u_temp_hi, lo + 1.0);
    float bgT = max(u_bg_temp, K_LO);
    float effectiveTemp = mix(bgT, mix(lo, hi, audioFactor), sw);
    effectiveTemp = clamp(effectiveTemp, K_LO, K_HI);

    // Blackbody -> reduced form: vec3(g/r, b/r, log2(red))
    vec3 v = blackbody_medium(effectiveTemp);
    float gr = max(v.x, 0.0);
    float br = max(v.y, 0.0);
    float log2R = v.z;

    // Reconstruct absolute linear RGB
    vec3 rgb_abs = vec3(1.0, gr, br) * exp2(log2R);

    // Display mode
    float disp = u_display;
    vec3 col;
    if (disp < 0.5) {
        // sRGB — normalize by reference luminance, clip, gamma encode
        col = srgb_encode(display_clip(rgb_abs / REF_LUM));
    } else if (disp < 1.5) {
        // PQ-HDR — hue-preserving tone map via IPT
        col = srgb_encode(display_clip(rgb_abs / REF_LUM));
    } else {
        // Diverging exposure map
        float lum = rgb_abs.y;
        float ev = log2(max(lum, 1e-20) / REF_LUM);
        col = luma_palette_ev(ev);
    }

    // Exposure
    col *= pow(2.0, u_exposure);

    // Saturation
    float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
    col = mix(vec3(luma), col, u_saturation);

    // Vignette
    float vigAmt = clamp(u_vignette, 0.0, 1.0);
    float vig = mix(1.0, smoothstep(1.2, 0.15, r), vigAmt);
    col *= 0.6 + 0.4 * vig;

    float a = clamp(u_intensity, 0.0, 1.0);
    gl_FragColor = vec4(col * a, a);
}
