# Ferrofluid Simulation — App Implementation Instructions

## Goal

Add persistent multi-pass simulation support to the existing `audio-beat` container so the supplied `ferrofluid/shader.frag` can run as an actual evolving ferrofluid simulation.

**Do not rewrite or modify `shader.frag` or `controls.json`.** They already define the shader interface.

The existing `audio-beat` role already receives:

- `u_beat`
- `u_envelope`
- `u_beat_phase`
- `u_bass`

Keep using that role. Do not create another audio-analysis role.

## 1. Register the package

Register `ferrofluid` in the shader/package index so it is discoverable as a container shader.

The package contains:

- `controls.json`
- `shader.frag`

Keep its role as:

```json
"roles": ["container"]
```

## 2. Allow `audio-beat` to use the ferrofluid shader

The intended configuration is:

```text
role     = audio-beat
shaderId = ferrofluid
```

Do not create a `ferrofluid` audio role.

The existing live audio routing must continue to supply:

```text
u_beat
u_envelope
u_beat_phase
u_bass
```

The shader's audio inputs must remain live and must not be persisted as ordinary preset values.

## 3. Add a persistent simulation path

The ordinary container renderer is single-pass. Add a dedicated simulation path selected when:

```js
shaderId === "ferrofluid"
```

Prefer a reusable abstraction such as:

```js
createContainerSimulation(...)
```

rather than scattering simulation logic throughout the normal container renderer.

The simulation needs persistent GPU state between frames.

## 4. Simulation state

Each ferrofluid container gets two ping-pong RGBA floating-point/half-floating-point textures:

```text
stateA
stateB
```

State layout:

```text
R = surface displacement / height
G = velocity X
B = velocity Y
A = pressure
```

Use an independent simulation resolution.

Start at:

```text
256 × 256
```

Do not automatically use the visible canvas resolution.

## 5. Floating-point render targets

Detect usable floating-point or half-floating-point framebuffer support.

Prefer available WebGL extensions such as:

```text
OES_texture_float
WEBGL_color_buffer_float
OES_texture_half_float
EXT_color_buffer_half_float
```

Only select formats that are actually framebuffer-renderable.

If no suitable format is available, fail gracefully with a clear warning. Do not silently replace the simulation with a fake procedural effect.

## 6. Initialization

When a ferrofluid simulation is created:

1. Allocate `stateA`.
2. Allocate `stateB`.
3. Run shader pass `0` into one state texture.
4. Clear/initialize the other state texture.
5. Mark the simulation initialized.

Do not initialize every frame.

Reset when:

- the simulation is first created;
- simulation resources are recreated;
- the active song changes, if that is how the app defines visualization resets;
- the WebGL context is restored;
- an explicit simulation reset occurs.

Do not reset on every audio frame.

## 7. Internal shader uniforms

The supplied shader owns these renderer-only uniforms:

```glsl
uniform sampler2D u_state;
uniform vec2 u_sim_resolution;
uniform float u_sim_pass;
uniform float u_dt;
```

Do not expose these through `controls.json`.

Bind them directly from the renderer.

## 8. Simulation passes

The shader uses these pass values:

```text
0 = initialize
1 = advection + physical forces
2 = pressure Jacobi iteration
3 = pressure projection
4 = visible rendering
```

Compile/link the shader once and change `u_sim_pass` between draw calls.

Do not create separate shader sources for each pass.

## 9. Per-frame sequence

For each simulation frame:

```text
stateA
  -> pass 1
stateB

stateB
  -> pass 2
stateA
```

Repeat pass 2 for the configured number of pressure iterations.

Then:

```text
current state
  -> pass 3
other state
```

Finally:

```text
current state
  -> pass 4
visible container framebuffer/canvas
```

Ping-pong the state textures between passes.

Pass 4 must render to the visible target, not back into simulation state.

## 10. Pressure iterations

Read:

```text
u_solver_iterations
```

from the normal shader uniform system.

Clamp it to approximately:

```text
2–32
```

Default is 12.

Run the pressure Jacobi pass multiple times on the GPU. Do not attempt to perform the iterations inside JavaScript CPU arrays.

## 11. Timestep

Calculate the real frame delta in seconds.

Clamp it before sending to the shader, e.g.:

```js
const dt = Math.min(frameDeltaSeconds, 0.035);
```

Do not attempt to catch up several seconds of simulation after the application was suspended.

The shader already applies `u_simulation_speed`.

## 12. Simulation resolution

Keep simulation resolution independent from the visible container dimensions.

Recommended initial resolution:

```text
256 × 256
```

If a future simulation-resolution control is added, recreate and reinitialize the state textures only when the resolution actually changes.

Do not resize the simulation texture every render frame.

## 13. Audio uniforms

Do not change the audio-analysis system.

The existing audio pipeline should continue to provide:

```text
u_beat
u_envelope
u_beat_phase
u_bass
```

The shader intentionally uses these to alter the magnetic field.

The renderer must not directly alter spike geometry based on beat strength.

The intended causal chain is:

```text
audio
→ magnetic field
→ magnetization
→ magnetic pressure
→ surface instability
→ evolving ferrofluid
```

## 14. Uniform ownership

Static shader controls come from the normal shader/preset system.

Examples:

```text
u_density
u_viscosity
u_surface_tension
u_gravity
u_magnetic_susceptibility
u_saturation_magnetization
u_field_strength
u_field_gradient
u_magnetic_relaxation
u_audio_field_gain
u_audio_bass_gain
u_audio_beat_gain
u_simulation_speed
u_solver_iterations
u_dissipation
u_height_damping
u_seed_strength
...
```

Live audio owns:

```text
u_beat
u_envelope
u_beat_phase
u_bass
```

Renderer-internal uniforms own:

```text
u_state
u_sim_resolution
u_sim_pass
u_dt
```

Do not expose renderer-internal uniforms to Controls.

## 15. Preserve normal preset behavior

The existing preset architecture should continue to save:

```text
shaderId
shaderUniforms
shaderModulators
```

for the container.

Do not save the current simulation texture contents into presets.

Do not save live audio values into presets.

When a preset restores:

```text
shaderId = ferrofluid
```

create a fresh simulation state and allow the existing audio binding to resume.

## 16. Modulator precedence

Preserve the existing uniform precedence:

```text
base value
→ shader modulators
→ live audio override
```

The four audio uniforms should remain authoritative when live audio is active.

## 17. Multiple ferrofluid containers

Simulation state must belong to the individual container instance.

Do not use one global ferrofluid state.

Each ferrofluid container needs independent:

```text
stateA
stateB
framebuffer resources
initialization state
```

## 18. Lifecycle and cleanup

When a container changes away from `ferrofluid`:

- destroy its simulation textures;
- destroy its simulation framebuffers;
- release associated GPU resources;
- stop any simulation-specific work.

When the container is destroyed, perform the same cleanup.

Do not leave simulation resources or render loops alive.

## 19. WebGL state isolation

Before every simulation pass explicitly bind:

- correct framebuffer;
- correct viewport;
- correct shader program;
- correct source texture;
- simulation uniforms.

Do not rely on WebGL state left behind by another renderer.

After the simulation render, restore the normal container rendering state so other containers, overlays, and postprocessing continue to work.

## 20. Do not use CPU readback

Never implement simulation feedback using:

```text
gl.readPixels()
→ JavaScript
→ upload texture
```

The simulation must remain entirely GPU-side:

```text
GPU state texture
→ simulation pass
→ GPU state texture
```

## 21. Rendering integration

The final pass (`u_sim_pass = 4`) should render the current simulated surface into the normal visible container target.

The result must then continue through the application's ordinary container compositing/postprocessing pipeline.

Do not bypass the existing scene composition system.

## 22. Numerical stability

The supplied shader already clamps height and velocity.

The renderer should additionally:

- clamp `dt`;
- avoid giant catch-up steps after stalls;
- handle framebuffer allocation failure;
- handle WebGL context loss/restoration;
- reinitialize state if simulation resources become invalid.

Do not allow NaN/invalid state to persist indefinitely.

## 23. Performance target

Initial target:

```text
simulation resolution: 256 × 256
pressure iterations:   12
```

A typical frame is approximately:

```text
1 × force/advection
12 × pressure
1 × projection
1 × render
```

Avoid unnecessarily increasing simulation resolution.

If performance protection is required, temporarily reduce pressure iterations under heavy load rather than resizing the simulation every frame.

## 24. Required testing

Verify:

### Registration
`ferrofluid` appears as an available shader.

### Assignment
An `audio-beat` container can use:

```text
shaderId = ferrofluid
```

### Audio
Verify that:

```text
u_beat
u_envelope
u_bass
u_beat_phase
```

reach the simulation.

### Persistence
The fluid continues evolving between audio frames and does not reset every frame.

### Physics controls
Changing:

```text
Viscosity
Surface Tension
Gravity
Magnetic Susceptibility
Saturation Magnetization
Field Strength
Field Gradient
```

must change the simulated behavior rather than merely changing colors or geometry.

### Audio causality
Beat/bass should modify the magnetic field and consequently the simulated instability. There must not be code that directly constructs or scales predefined spikes from `u_beat`.

### Pressure solver
Test at least:

```text
2 iterations
12 iterations
32 iterations
```

and verify stability.

### Lifecycle
Test:

```text
ferrofluid
→ another shader
→ ferrofluid
```

and verify that GPU resources are correctly destroyed/recreated.

### Resize
Resize the visible container and verify that the simulation remains stable and does not cause CPU pixel readback.

### Presets
Save/load a preset containing the ferrofluid container. Static controls should restore; live audio values should continue coming from the `audio-beat` role.

## 25. Important architectural constraint

Do not solve this by making the fragment shader a procedural ferrofluid effect.

The supplied shader is designed around persistent simulation state. The application must provide the persistent ping-pong render targets and multi-pass execution described above.

The result should be an evolving reduced-order ferrohydrodynamic simulation, not a visual approximation based on sine waves, radial spike functions, or direct beat-to-spike scaling.
