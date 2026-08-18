uniform sampler2D u_scene;
uniform float u_colorSteps;
uniform float u_pixelSize;
uniform float u_spread;

uniform float u_usePalette;
uniform vec3 u_colorLight;
uniform vec3 u_colorDark;

uniform float u_intensity;

void main() {
    vec3 original = texture2D(u_scene, v_uv).rgb;

    // Scale coordinates for macro-pixels
    vec2 pixelPos = floor((v_uv * u_resolution) / max(u_pixelSize, 1.0));
    vec2 p = mod(pixelPos, 4.0);

    // Algebraic coordinate masks to bypass matrix indexing limits
    vec4 sx = step(vec4(0.0, 1.0, 2.0, 3.0), vec4(p.x)) * step(vec4(p.x), vec4(0.0, 1.0, 2.0, 3.0));
    vec4 sy = step(vec4(0.0, 1.0, 2.0, 3.0), vec4(p.y)) * step(vec4(p.y), vec4(0.0, 1.0, 2.0, 3.0));

    vec4 col0 = vec4(0.0, 12.0,  3.0, 15.0) / 16.0;
    vec4 col1 = vec4(8.0,  4.0, 11.0,  7.0) / 16.0;
    vec4 col2 = vec4(2.0, 14.0,  1.0, 13.0) / 16.0;
    vec4 col3 = vec4(10.0, 6.0,  9.0,  5.0) / 16.0;

    // Extract the active bayer value
    vec4 activeCol = col0 * sx.x + col1 * sx.y + col2 * sx.z + col3 * sx.w;
    float bayerValue = dot(activeCol, sy);

    // Calculate spread: u_spread of 1.0 perfectly spans a single quantization step
    float ditherOffset = (bayerValue - 0.5) * u_spread / u_colorSteps;

    // Collapse into luminance if the custom palette toggle is active
    float luma = dot(original, vec3(0.299, 0.587, 0.114));
    vec3 baseVal = mix(original, vec3(luma), u_usePalette);

    // Apply the offset and quantize
    vec3 dithered = baseVal + ditherOffset;
    dithered = floor(dithered * u_colorSteps + 0.5) / u_colorSteps;
    dithered = clamp(dithered, 0.0, 1.0);

    // Map the 1D grayscale result to the custom color bounds
    vec3 mappedPalette = mix(u_colorDark, u_colorLight, dithered.r);
    
    // Final output selection: Standard RGB vs Custom Palette
    vec3 finalColor = mix(dithered, mappedPalette, u_usePalette);

    float m = clamp(u_intensity, 0.0, 1.0);
    gl_FragColor = vec4(mix(original, finalColor, m), 1.0);
}