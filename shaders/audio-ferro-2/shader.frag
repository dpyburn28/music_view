/*
    FERROFLUID — AUDIO BEAT CONTAINER

    Designed specifically for the existing audio-beat container.

    Live inputs supplied by the audio pipeline:

        u_beat
        u_envelope
        u_beat_phase
        u_bass

    The fluid behaves like a magnetic ferrofluid:
      - bass expands the body
      - beat creates sharp magnetic spikes
      - beat phase animates the spikes
      - envelope controls overall agitation
*/

uniform float u_beat;
uniform float u_envelope;
uniform float u_beat_phase;
uniform float u_bass;

uniform float u_size;
uniform float u_spikes;
uniform float u_spike_count;
uniform float u_reactivity;

uniform float u_gloss;
uniform float u_black;
uniform float u_edge;

#define PI 3.14159265359
#define TAU 6.28318530718


float hash11(float p)
{
    p = fract(p * 0.1031);
    p *= p + 33.33;
    p *= p + p;
    return fract(p);
}


float noise1(float p)
{
    float i = floor(p);
    float f = fract(p);

    f = f * f * (3.0 - 2.0 * f);

    return mix(
        hash11(i),
        hash11(i + 1.0),
        f
    );
}


/*
    Magnetic pole shape.

    u_beat_phase makes the peaks travel around the
    ferrofluid instead of simply scaling uniformly.
*/
float pole(float angle)
{
    float phase =
        angle / TAU;

    float movingPhase =
        u_beat_phase * TAU;

    float wave =
        0.5 +
        0.5 * sin(
            angle * u_spike_count
            - movingPhase
        );

    /*
        Very sharp peaks are what gives the shape
        the characteristic ferrofluid appearance.
    */
    wave = pow(
        max(wave, 0.0),
        8.0
    );

    return wave;
}


/*
    Secondary irregularity prevents perfect radial symmetry.
*/
float secondaryPole(float angle)
{
    float phase = angle / TAU;

    float n =
        noise1(
            phase * 17.0
            + u_beat_phase * 2.0
        );

    float wave =
        0.5 +
        0.5 * sin(
            angle * (u_spike_count * 0.47)
            + 2.1
        );

    wave = pow(
        max(wave, 0.0),
        6.0
    );

    return wave * n;
}


/*
    Ferrofluid radial boundary.

    Beat is deliberately nonlinear:
    small beats barely move the fluid,
    strong beats suddenly produce spikes.
*/
float fluidRadius(float angle)
{
    float beat =
        clamp(u_beat, 0.0, 1.0);

    float envelope =
        clamp(u_envelope, 0.0, 1.0);

    float bass =
        clamp(u_bass, 0.0, 1.0);

    float impact =
        pow(
            beat,
            1.7
        );

    float magneticEnergy =
        clamp(
            impact * 0.78
            + envelope * 0.20
            + bass * 0.35,
            0.0,
            1.5
        );

    float primary =
        pole(angle);

    float secondary =
        secondaryPole(angle);

    /*
        Bass makes the entire ferrofluid swell.
    */
    float body =
        bass * 0.055;

    /*
        Beat energy turns into magnetic spikes.
    */
    float spikes =
        (
            primary * 0.82
            +
            secondary * 0.18
        )
        *
        u_spikes
        *
        magneticEnergy
        *
        (0.65 + u_reactivity);

    return
        u_size
        + body
        + spikes;
}


/*
    Signed distance-like field.
*/
float fluidField(vec2 p)
{
    float angle =
        atan(p.y, p.x);

    float radius =
        length(p);

    return
        fluidRadius(angle)
        - radius;
}


/*
    Small detached ferrofluid droplets.
    Their size responds to beat impact.
*/
float droplet(
    vec2 p,
    vec2 center,
    float radius
)
{
    return radius - length(p - center);
}


void main()
{
    vec2 p =
        v_uv - 0.5;

    float aspect =
        u_resolution.x /
        max(u_resolution.y, 1.0);

    p.x *= aspect;


    /* -------------------------------------------------------- */
    /* Fluid shape                                               */
    /* -------------------------------------------------------- */

    float field =
        fluidField(p);


    /*
        Beat briefly throws tiny droplets outward.
    */
    float beat =
        clamp(u_beat, 0.0, 1.0);

    float d1 =
        droplet(
            p,
            vec2(
                -0.32,
                0.23
            ),
            0.009 + beat * 0.014
        );

    float d2 =
        droplet(
            p,
            vec2(
                0.34,
                -0.24
            ),
            0.007 + beat * 0.012
        );

    float d3 =
        droplet(
            p,
            vec2(
                -0.24,
                -0.34
            ),
            0.005 + beat * 0.009
        );


    float fluid =
        max(
            field,
            max(
                d1,
                max(d2, d3)
            )
        );


    float alpha =
        smoothstep(
            -u_edge,
            u_edge,
            fluid
        );


    /* -------------------------------------------------------- */
    /* Surface normal                                             */
    /* -------------------------------------------------------- */

    float eps = 0.002;

    float dx =
        fluidField(
            p + vec2(eps, 0.0)
        )
        -
        fluidField(
            p - vec2(eps, 0.0)
        );

    float dy =
        fluidField(
            p + vec2(0.0, eps)
        )
        -
        fluidField(
            p - vec2(0.0, eps)
        );

    vec2 normal =
        normalize(
            vec2(dx, dy)
            + vec2(0.00001)
        );


    /* -------------------------------------------------------- */
    /* Liquid-metal lighting                                     */
    /* -------------------------------------------------------- */

    vec2 lightDir =
        normalize(
            vec2(-0.48, -0.72)
        );

    float diffuse =
        max(
            0.0,
            dot(normal, lightDir)
        );

    float specular =
        pow(
            diffuse,
            mix(
                5.0,
                28.0,
                u_gloss
            )
        );


    /*
        Stronger highlights on a beat make the ferrofluid
        look like it is physically deforming toward a magnet.
    */
    float beatHighlight =
        1.0
        + beat * 0.65;


    vec3 fluidColor =
        vec3(
            0.008
            + 0.035 * diffuse
            + 0.82
                * specular
                * u_gloss
                * beatHighlight
        );


    /*
        Very subtle cool reflection.
    */
    float reflection =
        0.5
        +
        0.5 *
        sin(
            p.x * 21.0
            +
            p.y * 11.0
            +
            u_beat_phase * TAU
        );

    fluidColor +=
        vec3(0.035)
        *
        reflection
        *
        diffuse
        *
        u_gloss;


    /* -------------------------------------------------------- */
    /* Physical-looking background                               */
    /* -------------------------------------------------------- */

    vec3 background =
        vec3(
            0.91,
            0.90,
            0.88
        );


    float vignette =
        smoothstep(
            0.82,
            0.12,
            length(p)
        );

    background *=
        0.94
        +
        vignette * 0.06;


    /*
        Soft contact shadow beneath the ferrofluid.
    */
    float shadow =
        smoothstep(
            0.58,
            0.0,
            length(
                p -
                vec2(
                    0.018,
                    -0.018
                )
            )
        );

    background -=
        shadow * 0.065;


    /* -------------------------------------------------------- */
    /* Composite                                                 */
    /* -------------------------------------------------------- */

    vec3 color =
        mix(
            background,
            fluidColor,
            alpha
        );


    /*
        Wet rim.
    */
    float rim =
        smoothstep(
            0.045,
            0.0,
            abs(fluid)
        );

    color +=
        vec3(0.13)
        *
        rim
        *
        diffuse
        *
        u_gloss
        *
        alpha;


    gl_FragColor =
        vec4(
            color,
            1.0
        );
}