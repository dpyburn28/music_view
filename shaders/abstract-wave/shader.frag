// Abstract Wave — psychedelic color loops with rotating UV and modular wave distortion.

uniform float u_speed;
uniform float u_rot_speed;
uniform float u_detail;
uniform float u_wave_freq;
uniform float u_wave_amp;
uniform float u_mod_size;
uniform float u_channel_sep;
uniform float u_time_offset;
uniform float u_mix;
uniform float u_intensity;

mat2 rot(float a) {
    float c = cos(a), s = sin(a);
    return mat2(c, s, -s, c);
}

void main() {
    vec2 fragCoord = v_uv * u_resolution;
    vec2 uv = u_resolution;
    uv = (fragCoord + fragCoord - vec2(uv.x, 0.0)) / uv.y;

    float T = u_time * u_speed;
    float l = length(uv);
    uv *= rot(l * u_rot_speed);
    uv *= uv / l * u_detail;

    vec3 color;
    for (int i = 0; i < 3; i++) {
        float fi = float(i);
        float v = length(mod(uv, u_mod_size) - uv.x * 0.25);
        uv.y *= (sin(v * u_wave_freq) * u_wave_amp) * (sin(T - length(uv) * 0.5) + u_time_offset) * 0.4;
        color[i] = cos(T + pow(length(uv), fi * u_channel_sep));
    }

    vec3 color2 = vec3(pow(uv.y, 1.0) * 0.5);
    vec3 col = mix(color, color2, length(uv) * u_mix);

    float a = clamp(u_intensity, 0.0, 1.0);
    gl_FragColor = vec4(col * a, a);
}
