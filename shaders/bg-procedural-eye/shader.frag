// Realistic procedural eye (ported from Three-World eye).
// Built-in: u_time, u_resolution, v_uv  (do not redeclare)

uniform float u_eyeRadius;
uniform float u_scleraSqueeze;
uniform float u_scleraAngle;
uniform vec3 u_scleraColor;
uniform vec2 u_pupilPosition;
uniform float u_pupilRadius;
uniform vec3 u_pupilColor;
uniform float u_irisRadius;
uniform vec3 u_irisInnerColor;
uniform vec3 u_irisOuterColor;
uniform vec3 u_irisCryptColor;
uniform float u_limbalWidth;
uniform float u_irisRadialComp;
uniform float u_irisCryptFreq;
uniform float u_fiberFreq;
uniform vec3 u_eyelidColor;
uniform float u_eyelidBias;
uniform float u_eyelidAngle;
uniform float u_blink;
uniform float u_soften;

const float pi = 3.14159265359;

float hash1(vec2 p) {
    p = fract(p * vec2(127.1, 311.7));
    p += dot(p, p + 19.19);
    return fract(p.x * p.y);
}
vec2 hash2(vec2 p) {
    p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
    return fract(sin(p) * 43758.5453);
}
float noise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p);
    vec2 u = f*f*(3.0-2.0*f);
    return mix(
        mix(hash1(i), hash1(i+vec2(1,0)), u.x),
        mix(hash1(i+vec2(0,1)), hash1(i+vec2(1,1)), u.x), u.y);
}
float fbm(vec2 p) {
    float v = 0.0; float a = 0.5;
    mat2 rot = mat2(0.8,0.6,-0.6,0.8);
    for (int i=0;i<6;i++) { v+=a*noise(p); p=rot*p*2.1+vec2(5.2,1.3); a*=0.5; }
    return v;
}
vec2 voronoi(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p);
    float F1=8.0, F2=8.0;
    for (int y=-1;y<=1;y++) for (int x=-1;x<=1;x++) {
        vec2 g = vec2(float(x),float(y));
        vec2 o = hash2(i+g);
        vec2 r = g+o-f; float d = dot(r,r);
        if(d<F1){F2=F1;F1=d;} else if(d<F2){F2=d;}
    }
    return vec2(sqrt(F1),sqrt(F2));
}
float polarU(float theta, float k) {
    return fract((theta/6.28318530718+0.5)*k);
}

vec3 irisTexture(vec2 uv) {
    float r     = length(uv);
    float theta = atan(uv.y, uv.x);
    float t     = clamp((r - u_pupilRadius) / (u_irisRadius - u_pupilRadius), 0.0, 1.0);

    vec2 fc = vec2(polarU(theta, u_fiberFreq)*4.0, r/u_irisRadialComp);
    float fibers = fbm(fc);
    vec2 warp = vec2(fbm(fc+vec2(1.7,9.2)), fbm(fc+vec2(8.3,2.8)));
    float warpedFibers = fbm(fc + 0.4*warp);
    float allFibers = mix(fibers, warpedFibers, 0.45);

    vec2 cc = vec2(polarU(theta, u_irisCryptFreq)*u_irisCryptFreq, r*5.5);
    vec2 voro = voronoi(cc);
    float cryptEdge = 1.0 - smoothstep(0.0, 0.25, voro.x);
    float cryptWall = smoothstep(0.0, 0.1, voro.y - voro.x);

    float collR = u_pupilRadius + (u_irisRadius - u_pupilRadius)*0.38;
    float wobble = 0.012*sin(theta*18.0) + 0.008*sin(theta*31.0+1.3)
                 + 0.006*noise(vec2(theta*6.0, 0.0));
    float collarette = 1.0 - smoothstep(0.0, 0.015, abs(r - collR - wobble));

    float flecks = pow(fbm(vec2(polarU(theta,40.0)*8.0, r*12.0)+3.5), 3.0);

    float innerDark = 1.0 - 0.45*smoothstep(0.35, 0.0, t);
    float midBright = 1.0 + 0.15*smoothstep(0.3,0.7,t)*(1.0-smoothstep(0.7,1.0,t));
    float limbalWidthAbs = u_limbalWidth * u_irisRadius;
    float limbalAmount = smoothstep(u_irisRadius - max(limbalWidthAbs, 0.0001), u_irisRadius, r);
    limbalAmount *= smoothstep(0.0, 0.002, u_limbalWidth);
    float limbalDark = 1.0 - limbalAmount;

    vec3 baseColor = mix(u_irisInnerColor, u_irisOuterColor, smoothstep(0.0,1.0,t));
    vec3 col = baseColor * (0.55 + 0.85*allFibers);
    col -= u_irisCryptColor * cryptEdge * 0.4 * smoothstep(0.0,0.5,t);
    col += vec3(0.06,0.05,0.04)*cryptWall*0.3;
    col += vec3(0.12,0.08,0.04)*collarette;
    col -= vec3(0.08,0.05,0.02)*flecks;
    col *= innerDark * midBright * limbalDark;

    return clamp(col, 0.0, 1.0);
}

vec4 drawCircle(float radius, vec2 center, vec4 color, float squeeze, float angle, bool invert) {
    angle += pi/2.;
    vec2 uv = v_uv;
    vec2 fromCenter = (center - uv);
    float uvLength = length(fromCenter);
    float angleFromCenter = atan(fromCenter.y, fromCenter.x) - angle;
    uv.x = cos(angleFromCenter) * uvLength;
    uv.y = sin(angleFromCenter) * uvLength;
    uv += center;

    float squeezeDirection = (uv.x < center.x) ? -squeeze : squeeze;
    squeezeDirection *= radius;
    vec2 squeezedAngled = vec2(cos(angle), sin(angle)) * squeezeDirection;

    float dist = distance(v_uv, center + squeezedAngled);

    if (dist <= radius) {
        float lerp = clamp((radius - dist) / u_soften, 0.0, 1.0);
        vec4 col = mix(invert ? gl_FragColor : color, invert ? color : gl_FragColor, 1.0-lerp);
        return col;
    }

    return invert ? color : gl_FragColor;
}

vec4 drawEyelid(vec4 color, float squeeze, float bias, float angle, float blink) {
    vec2 center = vec2(0.5) + vec2(0.0, (bias * blink));
    return drawCircle(0.5, center, color, squeeze + blink, angle, true);
}

void drawEye(vec2 uv) {
    gl_FragColor = drawCircle(0.5, vec2(0.5), u_scleraColor, u_scleraSqueeze, u_scleraAngle, false);

    vec2 irisUV = v_uv - u_pupilPosition;
    vec3 irisTex = irisTexture(irisUV);

    float irisDist = distance(v_uv, u_pupilPosition);
    float irisMask = clamp((u_irisRadius - irisDist) / u_soften, 0.0, 1.0);
    gl_FragColor   = mix(gl_FragColor, vec4(irisTex, 1.0), irisMask);

    float pupilDist = distance(v_uv, u_pupilPosition);
    float pupilMask = clamp((u_pupilRadius - pupilDist) / u_soften, 0.0, 1.0);
    gl_FragColor    = mix(gl_FragColor, u_pupilColor, pupilMask);

    vec2 sv = v_uv - u_pupilPosition - vec2(0.02, -0.02);
    float spec = smoothstep(u_soften, 0.0, length(sv * vec2(1.0, 0.8))) * pupilMask;
    gl_FragColor.rgb += vec3(1.0) * spec * 0.9;

    float eyelidBias = u_eyelidBias;
    eyelidBias -= .5 - u_pupilPosition.y;
    gl_FragColor = drawEyelid(u_eyelidColor, u_scleraSqueeze, eyelidBias, u_eyelidAngle, u_blink);
}

void main() {
    gl_FragColor = vec4(0.0);
    drawEye(v_uv - 0.5);
}
