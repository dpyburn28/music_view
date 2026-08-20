// Computer Lab Gear — retro lab equipment tiles with CRT screens, keypads, and blinking LEDs.

uniform float u_speed;
uniform float u_tiles;
uniform float u_screen_glow;
uniform float u_dirt;
uniform float u_warmth;
uniform float u_saturation;
uniform float u_contrast;
uniform float u_blink_speed;

float hash11(float p){
    p = fract(p * 0.1031);
    p *= p + 33.33;
    p *= p + p;
    return fract(p);
}

float hash21(vec2 p){
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

vec2 hash22(vec2 p){
    float n = hash21(p);
    return vec2(n, hash11(n + 13.7));
}

float sdBox(vec2 p, vec2 b){
    vec2 d = abs(p) - b;
    return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

float boxMask(vec2 p, vec2 b, float blur){
    return 1.0 - smoothstep(0.0, blur, sdBox(p, b));
}

float circleMask(vec2 p, float r, float blur){
    return 1.0 - smoothstep(r, r + blur, length(p));
}

mat2 rot(float a){
    float c = cos(a), s = sin(a);
    return mat2(c,-s,s,c);
}

float noise2(vec2 p){
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f*f*(3.0-2.0*f);
    float a = hash21(i);
    float b = hash21(i+vec2(1,0));
    float c = hash21(i+vec2(0,1));
    float d = hash21(i+vec2(1,1));
    return mix(mix(a,b,f.x), mix(c,d,f.x), f.y);
}

float fbm3(vec2 p){
    float v = 0.0;
    v += 0.55 * noise2(p); p *= 2.02;
    v += 0.28 * noise2(p); p *= 2.03;
    v += 0.17 * noise2(p);
    return v;
}

vec3 screenColor(vec2 p, float seed, float t, float glowAmt){
    float glass = boxMask(p, vec2(0.23, 0.15), 0.005);
    vec2 q = p / vec2(0.23, 0.15);
    float vign = 1.0 - dot(q, q) * 0.35;
    vign = clamp(vign, 0.0, 1.0);

    float lines = 0.82 + 0.18 * sin((p.y * 220.0) + t * 20.0);
    float bars  = 0.5 + 0.5 * sin(p.x * 36.0 + seed * 8.0 + t * (1.5 + seed));
    float wave  = 0.5 + 0.5 * sin(p.x * 12.0 - p.y * 8.0 + t * 2.0 + seed * 6.0);

    float content = mix(bars, wave, 0.45);
    content *= lines;
    content *= vign;

    vec3 c1 = vec3(0.05, 0.70, 0.42);
    vec3 c2 = vec3(0.10, 0.85, 0.95);
    vec3 c = mix(c1, c2, 0.35 + 0.35 * sin(seed * 9.0));

    float flick = 0.92 + 0.08 * sin(t * (17.0 + seed * 3.0) + seed * 20.0);
    float hot = exp(-18.0 * dot(p - vec2(-0.04, 0.03), p - vec2(-0.04, 0.03)));

    vec3 outc = c * content * flick * glowAmt;
    outc += hot * 0.18 * c;
    outc *= glass;

    return outc;
}

void main(){
    vec2 fragCoord = v_uv * u_resolution;
    vec2 uv = fragCoord / u_resolution.xy;
    vec2 p = uv;
    p.x *= u_resolution.x / u_resolution.y;

    float t = u_time * u_speed;

    vec2 tp = p * u_tiles;
    vec2 gid = floor(tp);
    vec2 gv = fract(tp) - 0.5;

    float r0 = hash21(gid);
    float r1 = hash21(gid + 11.7);
    float r2 = hash21(gid + 29.4);
    float r3 = hash21(gid + 71.2);

    // Base plastic / painted metal
    vec3 baseA = vec3(0.72, 0.70, 0.64);
    vec3 baseB = vec3(0.56, 0.59, 0.62);
    vec3 base  = mix(baseA, baseB, step(0.58, r1) * 0.9);
    base = mix(base, base * vec3(1.0, 0.96, 0.82), u_warmth);

    vec3 col = base;

    // Main panel body + border
    float outer = boxMask(gv, vec2(0.47, 0.47), 0.006);
    float inner = boxMask(gv, vec2(0.41, 0.41), 0.006);
    float bezel = clamp(outer - inner, 0.0, 1.0);

    col *= 0.96 + 0.06 * noise2(gid * 1.13 + 3.0);
    col += bezel * (0.05 * vec3(1.0) - 0.03);

    // Recess
    float recess = boxMask(gv, vec2(0.38, 0.38), 0.005);
    col *= 1.0 - 0.06 * recess;

    // Panel split seam
    float seamV = smoothstep(0.44, 0.495, abs(gv.x));
    float seamH = smoothstep(0.44, 0.495, abs(gv.y));
    col *= 1.0 - 0.11 * max(seamV, seamH);

    // Choose layout
    float type = floor(r0 * 4.0);

    // TYPE 0: screen + leds + knob
    if(type < 0.5){
        vec2 sp = gv - vec2(-0.10, 0.02);
        float frame = boxMask(sp, vec2(0.28, 0.19), 0.005);
        float glassFrame = boxMask(sp, vec2(0.24, 0.16), 0.005);
        col = mix(col, vec3(0.10, 0.11, 0.12), frame * 0.95);
        col += screenColor(sp, r1, t, u_screen_glow) * glassFrame;

        // tiny text bars under screen
        vec2 tp2 = gv - vec2(-0.10, -0.23);
        for(int i=0;i<4;i++){
            float fi = float(i);
            vec2 bp = tp2 - vec2(-0.12 + fi * 0.08, 0.0);
            float b = boxMask(bp, vec2(0.025 + 0.01 * hash11(fi + r2 * 10.0), 0.01), 0.003);
            col = mix(col, vec3(0.2), b * 0.7);
        }

        // LEDs on right
        for(int i=0;i<3;i++){
            float fi = float(i);
            vec2 lp = gv - vec2(0.27, 0.12 - fi * 0.12);
            float led = circleMask(lp, 0.022, 0.004);
            float blink = step(0.42, sin(t * (u_blink_speed * (1.3 + fi*0.37)) + r3 * 20.0 + fi * 1.7) * 0.5 + 0.5);
            vec3 ledCol;
            if(i==0) ledCol = vec3(1.0,0.15,0.10);
            else if(i==1) ledCol = vec3(1.0,0.8,0.1);
            else ledCol = vec3(0.1,1.0,0.2);
            col = mix(col, vec3(0.10), led * 0.7);
            col += led * ledCol * (0.25 + 0.95 * blink);
        }

        // knob
        vec2 kp = gv - vec2(0.23, -0.20);
        float k0 = circleMask(kp, 0.065, 0.004);
        float k1 = circleMask(kp, 0.050, 0.004);
        col = mix(col, vec3(0.32,0.33,0.35), k0);
        col = mix(col, vec3(0.52,0.53,0.55), k1);

        float ang = r2 * 2.4 * 3.14159 + 0.35 * sin(t * 0.7 + r1 * 8.0);
        vec2 rp = (kp * rot(-ang));
        float tick = boxMask(rp - vec2(0.035, 0.0), vec2(0.018, 0.005), 0.002);
        col = mix(col, vec3(0.08), tick);
    }

    // TYPE 1: keypad + status row
    else if(type < 1.5){
        vec2 cp = gv - vec2(-0.02, 0.02);
        float plate = boxMask(cp, vec2(0.26, 0.22), 0.006);
        col = mix(col, vec3(0.42,0.44,0.47), plate * 0.55);

        for(int y=0;y<3;y++){
            for(int x=0;x<4;x++){
                vec2 bp = cp - vec2(-0.15 + float(x)*0.10, 0.10 - float(y)*0.10);
                float bOuter = boxMask(bp, vec2(0.035, 0.028), 0.003);
                float bInner = boxMask(bp - vec2(-0.004, 0.004), vec2(0.026, 0.020), 0.003);
                col = mix(col, vec3(0.22,0.23,0.24), bOuter);
                col = mix(col, vec3(0.72,0.73,0.74), bInner * 0.85);
            }
        }

        // led row
        for(int i=0;i<5;i++){
            vec2 lp = gv - vec2(-0.16 + float(i)*0.08, -0.24);
            float led = circleMask(lp, 0.016, 0.003);
            float blink = step(0.55, sin(t * (u_blink_speed * (0.8 + float(i)*0.19)) + r0 * 30.0 + float(i)) * 0.5 + 0.5);
            vec3 lc = mix(vec3(0.0,0.6,0.1), vec3(1.0,0.2,0.08), step(0.7, hash11(float(i)+r1*7.0)));
            col = mix(col, vec3(0.08), led * 0.65);
            col += led * lc * (0.2 + 0.85 * blink);
        }

        // tiny label
        vec2 lab = gv - vec2(0.20, 0.24);
        float lb = boxMask(lab, vec2(0.09, 0.03), 0.003);
        col = mix(col, vec3(0.86,0.83,0.67), lb * 0.9);
    }

    // TYPE 2: big vents + switches
    else if(type < 2.5){
        vec2 vp = gv - vec2(0.00, 0.08);
        float vbox = boxMask(vp, vec2(0.28, 0.16), 0.004);
        float slits = 0.0;
        for(int i=0;i<6;i++){
            float y = -0.11 + float(i) * 0.044;
            float slit = boxMask(vp - vec2(0.0, y), vec2(0.24, 0.010), 0.002);
            slits += slit;
        }
        col = mix(col, vec3(0.18,0.20,0.21), min(slits,1.0) * vbox);

        // 2 toggle switches
        for(int i=0;i<2;i++){
            vec2 sw = gv - vec2(-0.14 + float(i)*0.28, -0.22);
            float baseSw = boxMask(sw, vec2(0.05, 0.025), 0.003);
            col = mix(col, vec3(0.24,0.25,0.27), baseSw);

            float on = step(0.5, hash11(float(i)+r3*9.0));
            vec2 leverP = sw * rot(mix(-0.7, 0.7, on));
            float lever = boxMask(leverP - vec2(0.0, 0.03), vec2(0.008, 0.035), 0.002);
            col = mix(col, vec3(0.75,0.76,0.78), lever);

            float led = circleMask(sw - vec2(0.07, 0.0), 0.014, 0.003);
            float blink = step(0.5, sin(t * u_blink_speed * (1.1 + float(i)*0.7) + r2*11.0) * 0.5 + 0.5);
            col += led * vec3(1.0,0.18,0.08) * (0.15 + 0.8 * blink * on);
        }

        // warning stripe label
        vec2 wp = gv - vec2(0.0, 0.30);
        float wbox = boxMask(wp, vec2(0.18,0.03), 0.003);
        float diag = step(0.5, fract((wp.x + wp.y) * 20.0));
        vec3 warn = mix(vec3(0.15), vec3(0.95,0.80,0.12), diag);
        col = mix(col, warn, wbox * 0.9);
    }

    // TYPE 3: twin knobs + mini screen + buttons
    else{
        vec2 ms = gv - vec2(0.0, 0.18);
        float mframe = boxMask(ms, vec2(0.20, 0.10), 0.004);
        col = mix(col, vec3(0.10,0.11,0.12), mframe * 0.95);
        col += screenColor(ms, r2, t * 0.8, u_screen_glow * 0.8) * boxMask(ms, vec2(0.17,0.075), 0.004);

        // buttons row
        for(int i=0;i<4;i++){
            vec2 bp = gv - vec2(-0.18 + float(i)*0.12, -0.06);
            float b = boxMask(bp, vec2(0.035, 0.025), 0.003);
            float cap = boxMask(bp - vec2(-0.003, 0.003), vec2(0.026, 0.018), 0.003);
            col = mix(col, vec3(0.22,0.23,0.25), b);
            col = mix(col, vec3(0.66,0.67,0.69), cap * 0.9);
        }

        // twin knobs
        for(int i=0;i<2;i++){
            vec2 kp = gv - vec2(-0.12 + float(i)*0.24, -0.25);
            float ring = circleMask(kp, 0.07, 0.004);
            float core = circleMask(kp, 0.05, 0.004);
            col = mix(col, vec3(0.30,0.31,0.33), ring);
            col = mix(col, vec3(0.52,0.53,0.54), core);

            float ang = (0.2 + hash11(float(i)+r1*8.0)) * 2.0 * 3.14159 + 0.2 * sin(t * (0.5 + float(i)*0.3));
            vec2 rp = kp * rot(-ang);
            float marker = boxMask(rp - vec2(0.032, 0.0), vec2(0.016, 0.004), 0.002);
            col = mix(col, vec3(0.06), marker);
        }

        // 3 LEDs near top
        for(int i=0;i<3;i++){
            vec2 lp = gv - vec2(-0.10 + float(i)*0.10, 0.33);
            float led = circleMask(lp, 0.014, 0.003);
            float blink = step(0.45, sin(t * u_blink_speed * (1.0 + float(i)*0.31) + float(i)*1.9 + r0*14.0) * 0.5 + 0.5);
            vec3 lc = (i==1) ? vec3(1.0,0.75,0.08) : vec3(0.08,1.0,0.25);
            col += led * lc * (0.18 + 0.85 * blink);
        }
    }

    // Corner screws on some tiles
    if(r2 > 0.35){
        for(int i=0;i<4;i++){
            vec2 s = vec2((i==0||i==2)?-1.0:1.0, (i<2)?-1.0:1.0);
            vec2 sp = gv - s * 0.40;
            float screw = circleMask(sp, 0.018, 0.003);
            col = mix(col, vec3(0.55,0.56,0.58), screw);
            float slot = boxMask((sp * rot(3.14159*0.25*floor(r3*4.0))), vec2(0.010,0.0025), 0.0015);
            col = mix(col, vec3(0.12), slot * screw);
        }
    }

    // Labels / serial stickers
    if(r1 > 0.28){
        vec2 lp = gv - vec2(0.22 - 0.10*r2, 0.34 - 0.08*r3);
        float label = boxMask(lp, vec2(0.09, 0.028), 0.003);
        col = mix(col, vec3(0.87,0.86,0.77), label * 0.9);

        for(int i=0;i<3;i++){
            vec2 t = lp - vec2(-0.05 + float(i)*0.03, 0.0);
            float txt = boxMask(t, vec2(0.010 + 0.004*hash11(float(i)+r0*5.0), 0.0035), 0.0015);
            col = mix(col, vec3(0.18), txt * label);
        }
    }

    // Tiny grime / age
    float grime = fbm3(tp * 1.7 + 9.0);
    float edgeWear = smoothstep(0.18, 0.48, max(abs(gv.x), abs(gv.y)));
    col *= 1.0 - u_dirt * grime * 0.20;
    col = mix(col, col * vec3(0.84,0.78,0.66), u_dirt * edgeWear * 0.35);

    // Subtle scratches
    float sc = smoothstep(0.965, 0.995, fract((gv.x * 24.0 + gv.y * 2.0 + r0 * 10.0)));
    sc *= (0.4 + 0.6 * recess);
    col += sc * 0.018;

    // Lighting bias
    float shade = 1.0 + gv.y * -0.06 + gv.x * -0.02;
    col *= shade;

    // Contrast / saturation
    float luma = dot(col, vec3(0.299,0.587,0.114));
    col = mix(vec3(luma), col, u_saturation);
    col = (col - 0.5) * u_contrast + 0.5;

    gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
