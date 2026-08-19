// Simple shader renderer helper
// Usage: const r = createShaderRenderer(canvas, fragSource); r.start(); r.stop(); r.setUniforms({u_param: value});
function compileShader(gl, src, type) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const info = gl.getShaderInfoLog(shader);
        gl.deleteShader(shader);
        throw new Error('Shader compile error: ' + info);
    }
    return shader;
}

function createProgram(gl, vertSrc, fragSrc) {
    const vs = compileShader(gl, vertSrc, gl.VERTEX_SHADER);
    const fs = compileShader(gl, fragSrc, gl.FRAGMENT_SHADER);
    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        const info = gl.getProgramInfoLog(program);
        gl.deleteProgram(program);
        throw new Error('Program link error: ' + info);
    }
    return program;
}

/** 0 / missing = display refresh. Used by every WebGL rAF loop. */
function getRenderFrameIntervalMs() {
    try {
        const n = Number(typeof window !== 'undefined' ? window.__musicViewRenderFps : 0);
        if (!Number.isFinite(n) || n <= 0) return 0;
        return 1000 / Math.min(240, Math.max(1, n));
    } catch (e) {
        return 0;
    }
}

function createRenderFrameGate() {
    let last = 0;
    return function shouldRender(now) {
        const interval = getRenderFrameIntervalMs();
        if (interval <= 0) return true;
        if (last && now - last < interval - 0.5) return false;
        last = now;
        return true;
    };
}

function setRenderFps(fps) {
    const n = Number(fps);
    const next = Number.isFinite(n) && n > 0 ? Math.min(240, Math.max(1, Math.round(n))) : 0;
    if (typeof window !== 'undefined') window.__musicViewRenderFps = next;
    return next;
}

if (typeof window !== 'undefined') {
    window.__musicViewSetRenderFps = setRenderFps;
}

function defaultVertexShader() {
    return `
    attribute vec2 a_position;
    varying vec2 v_uv;
    void main() {
        v_uv = a_position * 0.5 + 0.5;
        gl_Position = vec4(a_position, 0.0, 1.0);
    }
    `;
}

function buildFragmentSource(userSrc, gl) {
    // Provide common uniforms and varyings; userSrc should include main()
    // WebGL1 needs OES_standard_derivatives for dFdx/dFdy/fwidth.
    // WebGL2 always has derivatives for GLES1 shaders; the extension directive can fail compile.
    const isWebGL2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
    let extBlock = '';
    if (!isWebGL2) {
        try {
            if (gl && gl.getExtension('OES_standard_derivatives')) {
                extBlock = '#extension GL_OES_standard_derivatives : enable\n';
            }
        } catch (e) { /* ignore */ }
    }
    return `
    ${extBlock}precision mediump float;
    varying vec2 v_uv;
    uniform float u_time;
    uniform vec2 u_resolution;

    ${userSrc}
    `;
}

function getRenderableFloatTextureInfo(gl) {
    const isWebGL2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;

    if (isWebGL2) {
        const floatColorExt = gl.getExtension('EXT_color_buffer_float');
        if (floatColorExt && typeof gl.RGBA16F !== 'undefined') {
            return {
                type: gl.FLOAT,
                internalFormat: gl.RGBA16F,
                format: gl.RGBA,
                label: 'float32',
                half: false,
            };
        }
        if (floatColorExt && typeof gl.RGBA32F !== 'undefined') {
            return {
                type: gl.FLOAT,
                internalFormat: gl.RGBA32F,
                format: gl.RGBA,
                label: 'float32',
                half: false,
            };
        }
        const halfColorExt = gl.getExtension('EXT_color_buffer_half_float');
        const halfType = gl.HALF_FLOAT || gl.HALF_FLOAT_OES;
        if (halfColorExt && halfType && typeof gl.RGBA16F !== 'undefined') {
            return {
                type: halfType,
                internalFormat: gl.RGBA16F,
                format: gl.RGBA,
                label: 'half-float',
                half: true,
            };
        }
    }

    const floatExt = gl.getExtension('OES_texture_float');
    const colorFloatExt = gl.getExtension('WEBGL_color_buffer_float');
    if (floatExt && colorFloatExt) {
        return { type: gl.FLOAT, internalFormat: gl.RGBA, format: gl.RGBA, label: 'float32', half: false };
    }

    const halfExt = gl.getExtension('OES_texture_half_float');
    const colorHalfExt = gl.getExtension('EXT_color_buffer_half_float');
    const halfType = gl.HALF_FLOAT_OES || gl.HALF_FLOAT;
    if (halfExt && colorHalfExt && halfType) {
        return { type: halfType, internalFormat: gl.RGBA, format: gl.RGBA, label: 'half-float', half: true };
    }

    return null;
}

function createContainerSimulation(canvas, fragSource, initialUniforms = {}, options = {}) {
    if (!canvas) throw new Error('Container simulation requires a canvas');
    if (canvas.width === 0 || canvas.height === 0) {
        canvas.width = canvas.clientWidth || 1;
        canvas.height = canvas.clientHeight || 1;
    }

    const contextOptions = {
        alpha: true,
        premultipliedAlpha: false,
        preserveDrawingBuffer: true,
        failIfMajorPerformanceCaveat: false,
        powerPreference: 'high-performance',
    };
    const gl = canvas.getContext('webgl2', contextOptions)
        || canvas.getContext('webgl', contextOptions)
        || canvas.getContext('experimental-webgl', contextOptions);
    if (!gl) throw new Error('WebGL not supported');

    const floatInfo = getRenderableFloatTextureInfo(gl);
    if (!floatInfo) {
        throw new Error('Ferrofluid simulation requires floating-point framebuffer support.');
    }

    const vert = defaultVertexShader();
    const frag = buildFragmentSource(fragSource, gl);
    const program = createProgram(gl, vert, frag);
    const positionLoc = gl.getAttribLocation(program, 'a_position');
    const timeLoc = gl.getUniformLocation(program, 'u_time');
    const resLoc = gl.getUniformLocation(program, 'u_resolution');
    const simResLoc = gl.getUniformLocation(program, 'u_sim_resolution');
    const simPassLoc = gl.getUniformLocation(program, 'u_sim_pass');
    const dtLoc = gl.getUniformLocation(program, 'u_dt');
    const stateLoc = gl.getUniformLocation(program, 'u_state');

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

    const simResolution = { width: 256, height: 256 };
    const simState = { a: null, b: null };
    const simFbos = { a: null, b: null };
    let currentState = 'a';
    let rafId = null;
    let startTime = performance.now();
    let lastFrameTime = performance.now();
    let simInitialized = false;
    let simDirty = true;
    let simPassIterations = 12;
    const uniforms = Object.assign({}, initialUniforms);
    let modulators = Object.assign({}, options.modulators || {});
    let boundsByName = Object.assign({}, options.boundsByName || {});
    const liveUniforms = Object.assign({}, options.liveUniforms || {});
    const textureSlots = {};
    let nextTexUnit = 0;
    const resolvedScratch = {};
    const useAlphaBlend = options.alphaBlend === true;

    function createStateTexture(width, height) {
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        const internalFormat = floatInfo.internalFormat || gl.RGBA;
        gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, width, height, 0, floatInfo.format || gl.RGBA, floatInfo.type, null);
        return tex;
    }

    function bindStateTexture(name, tex) {
        const unit = nextTexUnit++;
        const slot = { texture: tex, unit, width: simResolution.width, height: simResolution.height, loc: stateLoc };
        textureSlots[name] = slot;
        gl.activeTexture(gl.TEXTURE0 + slot.unit);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        if (slot.loc) gl.uniform1i(slot.loc, slot.unit);
    }

    function createFboForTexture(tex, width, height) {
        const fbo = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
        const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        if (status !== gl.FRAMEBUFFER_COMPLETE) {
            console.warn('Ferrofluid simulation framebuffer incomplete; float render target not supported in this WebGL context.');
            try { gl.deleteFramebuffer(fbo); } catch (e) {}
            throw new Error('Ferrofluid simulation framebuffer incomplete');
        }
        return { framebuffer: fbo, width, height, texture: tex };
    }

    function clearTexture(tex, width, height) {
        gl.bindTexture(gl.TEXTURE_2D, tex);
        const zeros = new Float32Array(width * height * 4);
        const internalFormat = floatInfo.internalFormat || gl.RGBA;
        gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, width, height, 0, floatInfo.format || gl.RGBA, floatInfo.type, zeros);
    }

    function ensureSimulationResources() {
        if (simState.a && simState.b) return;
        simState.a = createStateTexture(simResolution.width, simResolution.height);
        simState.b = createStateTexture(simResolution.width, simResolution.height);
        simFbos.a = createFboForTexture(simState.a, simResolution.width, simResolution.height);
        simFbos.b = createFboForTexture(simState.b, simResolution.width, simResolution.height);
        simInitialized = false;
    }

    function destroySimulationResources() {
        for (const key of ['a', 'b']) {
            const tex = simState[key];
            const fbo = simFbos[key];
            if (fbo) {
                try { gl.deleteFramebuffer(fbo.framebuffer); } catch (e) {}
            }
            if (tex) {
                try { gl.deleteTexture(tex); } catch (e) {}
            }
        }
        simState.a = null;
        simState.b = null;
        simFbos.a = null;
        simFbos.b = null;
        currentState = 'a';
        simInitialized = false;
    }

    function uploadUserUniforms(map) {
        for (const k in map) {
            const loc = gl.getUniformLocation(program, k);
            if (!loc) continue;
            const v = map[k];
            if (typeof v === 'number') gl.uniform1f(loc, v);
            else if (Array.isArray(v) && v.length === 2) gl.uniform2f(loc, v[0], v[1]);
            else if (Array.isArray(v) && v.length === 3) gl.uniform3f(loc, v[0], v[1], v[2]);
            else if (Array.isArray(v) && v.length === 4) gl.uniform4f(loc, v[0], v[1], v[2], v[3]);
        }
    }

    function bindTextures() {
        for (const name in textureSlots) {
            const slot = textureSlots[name];
            if (!slot || !slot.texture) continue;
            gl.activeTexture(gl.TEXTURE0 + slot.unit);
            gl.bindTexture(gl.TEXTURE_2D, slot.texture);
            if (slot.loc) gl.uniform1i(slot.loc, slot.unit);
        }
    }

    function renderSimulationPass(pass, readTex, writeFbo, dtValue) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, writeFbo.framebuffer);
        gl.viewport(0, 0, writeFbo.width, writeFbo.height);
        gl.useProgram(program);
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.enableVertexAttribArray(positionLoc);
        gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, 0, 0);

        if (stateLoc) {
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, readTex || null);
            gl.uniform1i(stateLoc, 0);
        }
        if (simPassLoc) gl.uniform1f(simPassLoc, pass);
        if (simResLoc) gl.uniform2f(simResLoc, simResolution.width, simResolution.height);
        if (dtLoc) gl.uniform1f(dtLoc, dtValue);
        if (timeLoc) gl.uniform1f(timeLoc, (performance.now() - startTime) / 1000);
        if (resLoc) gl.uniform2f(resLoc, simResolution.width, simResolution.height);

        const clocks = {
            stack: (performance.now() - startTime) / 1000,
            wall: performance.now() / 1000,
            song: (typeof getSongModClock === 'function') ? getSongModClock() : 0,
        };
        const upload = (typeof resolveUniforms === 'function')
            ? resolveUniforms(uniforms, modulators, clocks.stack, boundsByName, resolvedScratch, clocks)
            : uniforms;
        uploadUserUniforms(upload);
        if (liveUniforms && Object.keys(liveUniforms).length) {
            uploadUserUniforms(liveUniforms);
        }
        gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    function renderVisiblePass(readTex) {
        const width = Math.max(1, Math.floor(canvas.clientWidth * (window.devicePixelRatio || 1)));
        const height = Math.max(1, Math.floor(canvas.clientHeight * (window.devicePixelRatio || 1)));
        if (canvas.width !== width || canvas.height !== height) {
            canvas.width = width;
            canvas.height = height;
        }

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        if (useAlphaBlend) {
            gl.enable(gl.BLEND);
            gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        } else {
            gl.disable(gl.BLEND);
        }

        gl.useProgram(program);
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.enableVertexAttribArray(positionLoc);
        gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, 0, 0);

        if (stateLoc) {
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, readTex || null);
            gl.uniform1i(stateLoc, 0);
        }
        if (simPassLoc) gl.uniform1f(simPassLoc, 4);
        if (simResLoc) gl.uniform2f(simResLoc, simResolution.width, simResolution.height);
        if (dtLoc) gl.uniform1f(dtLoc, Math.min(Math.max((performance.now() - lastFrameTime) / 1000, 0), 0.035));
        if (timeLoc) gl.uniform1f(timeLoc, (performance.now() - startTime) / 1000);
        if (resLoc) gl.uniform2f(resLoc, canvas.width, canvas.height);

        const clocks = {
            stack: (performance.now() - startTime) / 1000,
            wall: performance.now() / 1000,
            song: (typeof getSongModClock === 'function') ? getSongModClock() : 0,
        };
        const upload = (typeof resolveUniforms === 'function')
            ? resolveUniforms(uniforms, modulators, clocks.stack, boundsByName, resolvedScratch, clocks)
            : uniforms;
        uploadUserUniforms(upload);
        if (liveUniforms && Object.keys(liveUniforms).length) {
            uploadUserUniforms(liveUniforms);
        }
        gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    function initializeSimulation() {
        if (simInitialized) return;
        if (!simState.a || !simState.b || !simFbos.a || !simFbos.b) {
            ensureSimulationResources();
        }
        renderSimulationPass(0, null, simFbos.a, 0.016);
        clearTexture(simState.b, simResolution.width, simResolution.height);
        simInitialized = true;
    }

    function renderOnce(time) {
        ensureSimulationResources();
        initializeSimulation();

        const now = performance.now();
        const dtValue = Math.min(Math.max((now - lastFrameTime) / 1000, 0), 0.035);
        lastFrameTime = now;

        const pressureIterations = Math.max(2, Math.min(32, Number(uniforms.u_solver_iterations ?? 12) || 12));
        simPassIterations = pressureIterations;

        const currentKey = currentState;
        const otherKey = currentKey === 'a' ? 'b' : 'a';
        const readTex = simState[currentKey];
        const writeTex = simState[otherKey];
        const writeFbo = simFbos[otherKey];

        renderSimulationPass(1, readTex, writeFbo, dtValue);
        currentState = otherKey;

        for (let i = 0; i < simPassIterations; i++) {
            const read = simState[currentState];
            const next = currentState === 'a' ? 'b' : 'a';
            renderSimulationPass(2, read, simFbos[next], dtValue);
            currentState = next;
        }

        const finalRead = simState[currentState];
        const finalWrite = currentState === 'a' ? 'b' : 'a';
        renderSimulationPass(3, finalRead, simFbos[finalWrite], dtValue);
        currentState = finalWrite;

        renderVisiblePass(simState[currentState]);
    }

    const shouldRender = createRenderFrameGate();

    function loop(now) {
        if (shouldRender(now)) renderOnce(now);
        rafId = requestAnimationFrame(loop);
    }

    return {
        gl,
        start() {
            if (rafId) return;
            lastFrameTime = performance.now();
            renderOnce(lastFrameTime);
            rafId = requestAnimationFrame(loop);
        },
        stop() {
            if (rafId) cancelAnimationFrame(rafId);
            rafId = null;
        },
        render() {
            renderOnce(performance.now());
        },
        setUniforms(obj) {
            Object.assign(uniforms, obj || {});
        },
        setLiveUniforms(obj) {
            if (obj == null) {
                for (const k of Object.keys(liveUniforms)) delete liveUniforms[k];
                return;
            }
            if (typeof obj !== 'object') return;
            for (const k of Object.keys(obj)) {
                if (obj[k] == null) delete liveUniforms[k];
                else liveUniforms[k] = obj[k];
            }
        },
        setTexture2D(name, data, width, height, opts) {
            if (!name || !width || !height) return;
            const o = opts || {};
            const useRgba = o.format === 'rgba';
            const filter = o.filter === 'linear' ? gl.LINEAR : gl.NEAREST;
            const isWebGL2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
            let slot = textureSlots[name];
            if (!slot) {
                const texture = gl.createTexture();
                const unit = nextTexUnit++;
                slot = { texture, unit, width: 0, height: 0, loc: gl.getUniformLocation(program, name) };
                textureSlots[name] = slot;
            }
            gl.activeTexture(gl.TEXTURE0 + slot.unit);
            gl.bindTexture(gl.TEXTURE_2D, slot.texture);
            gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

            let internalFmt = gl.RGBA;
            let fmt = gl.RGBA;
            let bpp = 4;
            if (!useRgba && isWebGL2) {
                internalFmt = gl.R8;
                fmt = gl.RED;
                bpp = 1;
            } else if (!useRgba) {
                internalFmt = gl.LUMINANCE;
                fmt = gl.LUMINANCE;
                bpp = 1;
            }

            const needAlloc = slot.width !== width || slot.height !== height;
            if (data) {
                if (needAlloc) {
                    gl.texImage2D(gl.TEXTURE_2D, 0, internalFmt, width, height, 0, fmt, gl.UNSIGNED_BYTE, data);
                    slot.width = width;
                    slot.height = height;
                } else {
                    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, height, fmt, gl.UNSIGNED_BYTE, data);
                }
            } else if (needAlloc) {
                const empty = new Uint8Array(width * height * bpp);
                gl.texImage2D(gl.TEXTURE_2D, 0, internalFmt, width, height, 0, fmt, gl.UNSIGNED_BYTE, empty);
                slot.width = width;
                slot.height = height;
            }

            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        },
        setModulators(obj) {
            modulators = obj && typeof obj === 'object' ? Object.assign({}, obj) : {};
        },
        setBoundsByName(obj) {
            boundsByName = obj && typeof obj === 'object' ? Object.assign({}, obj) : {};
        },
        destroy() {
            this.stop();
            try { gl.deleteProgram(program); } catch (e) {}
            for (const name in textureSlots) {
                try {
                    if (textureSlots[name]?.texture) gl.deleteTexture(textureSlots[name].texture);
                } catch (e) {}
            }
            destroySimulationResources();
        }
    };
}

function createShaderRenderer(canvas, fragSource, initialUniforms = {}, options = {}) {
    const isSimulationShader = /\bu_state\b/.test(fragSource)
        || /\bu_sim_pass\b/.test(fragSource)
        || /\bu_sim_resolution\b/.test(fragSource)
        || /\bu_dt\b/.test(fragSource)
        || /\bu_solver_iterations\b/.test(fragSource); 

    if (isSimulationShader) {
        return createContainerSimulation(canvas, fragSource, initialUniforms, options);
    }

    // Ensure canvas has nonzero size before requesting WebGL context
    if (canvas.width === 0 || canvas.height === 0) {
        canvas.width = canvas.clientWidth || 1;
        canvas.height = canvas.clientHeight || 1;
    }
    const contextOptions = {
        alpha: true,
        premultipliedAlpha: true,
        preserveDrawingBuffer: true,
        failIfMajorPerformanceCaveat: false,
        powerPreference: 'high-performance',
    };
    const gl = canvas.getContext('webgl2', contextOptions)
        || canvas.getContext('webgl', contextOptions)
        || canvas.getContext('experimental-webgl', contextOptions);
    if (!gl) throw new Error('WebGL not supported');

    const vert = defaultVertexShader();
    const frag = buildFragmentSource(fragSource, gl);
    const program = createProgram(gl, vert, frag);

    const positionLoc = gl.getAttribLocation(program, 'a_position');
    const timeLoc = gl.getUniformLocation(program, 'u_time');
    const resLoc = gl.getUniformLocation(program, 'u_resolution');

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    // full-screen triangle
    const vertices = new Float32Array([-1, -1, 3, -1, -1, 3]);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

    let rafId = null;
    let startTime = performance.now();
    const uniforms = Object.assign({}, initialUniforms);
    /** @type {object} optional ParamModulator map (sibling of uniforms) */
    let modulators = Object.assign({}, options.modulators || {});
    /** @type {object} name → {min,max} for clamp */
    let boundsByName = Object.assign({}, options.boundsByName || {});
    /**
     * Live values applied *after* modulators each frame (e.g. audio analysis).
     * Keys override modulated uniforms for that draw.
     * @type {object}
     */
    const liveUniforms = Object.assign({}, options.liveUniforms || {});
    /**
     * Named 2D textures (R8 / LUMINANCE) for audio viz, etc.
     * name → { texture, unit, width, height, loc }
     * @type {Record<string, {texture: WebGLTexture, unit: number, width: number, height: number, loc: WebGLUniformLocation|null}>}
     */
    const textureSlots = {};
    let nextTexUnit = 0;
    /** Reused when modulators active — avoid per-frame alloc */
    const resolvedScratch = {};
    const useAlphaBlend = options.alphaBlend === true;

    function uploadUserUniforms(map) {
        for (const k in map) {
            const loc = gl.getUniformLocation(program, k);
            if (!loc) continue;
            const v = map[k];
            if (typeof v === 'number') gl.uniform1f(loc, v);
            else if (Array.isArray(v) && v.length === 2) gl.uniform2f(loc, v[0], v[1]);
            else if (Array.isArray(v) && v.length === 3) gl.uniform3f(loc, v[0], v[1], v[2]);
            else if (Array.isArray(v) && v.length === 4) gl.uniform4f(loc, v[0], v[1], v[2], v[3]);
        }
    }

    /**
     * Create or update a single-channel (or RGBA) 2D texture and bind its sampler uniform.
     * @param {string} name sampler2D uniform name
     * @param {Uint8Array|Uint8ClampedArray|null} data row-major pixels; null keeps previous texels
     * @param {number} width
     * @param {number} height
     * @param {{ format?: 'luminance'|'rgba', filter?: 'nearest'|'linear' }} [opts]
     */
    function setTexture2D(name, data, width, height, opts) {
        if (!name || !width || !height) return;
        const o = opts || {};
        const useRgba = o.format === 'rgba';
        const filter = o.filter === 'linear' ? gl.LINEAR : gl.NEAREST;
        const isWebGL2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
        let slot = textureSlots[name];
        if (!slot) {
            const texture = gl.createTexture();
            const unit = nextTexUnit++;
            const loc = gl.getUniformLocation(program, name);
            slot = { texture, unit, width: 0, height: 0, loc };
            textureSlots[name] = slot;
        }
        gl.activeTexture(gl.TEXTURE0 + slot.unit);
        gl.bindTexture(gl.TEXTURE_2D, slot.texture);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

        // Single-channel: WebGL2 R8/RED; WebGL1 LUMINANCE (reads as .r in GLES1 shaders via .x)
        let internalFmt;
        let fmt;
        let bpp;
        if (useRgba) {
            internalFmt = gl.RGBA;
            fmt = gl.RGBA;
            bpp = 4;
        } else if (isWebGL2) {
            internalFmt = gl.R8;
            fmt = gl.RED;
            bpp = 1;
        } else {
            internalFmt = gl.LUMINANCE;
            fmt = gl.LUMINANCE;
            bpp = 1;
        }

        const needAlloc = slot.width !== width || slot.height !== height;
        if (data) {
            if (needAlloc) {
                gl.texImage2D(gl.TEXTURE_2D, 0, internalFmt, width, height, 0, fmt, gl.UNSIGNED_BYTE, data);
                slot.width = width;
                slot.height = height;
            } else {
                gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, height, fmt, gl.UNSIGNED_BYTE, data);
            }
        } else if (needAlloc) {
            const empty = new Uint8Array(width * height * bpp);
            gl.texImage2D(gl.TEXTURE_2D, 0, internalFmt, width, height, 0, fmt, gl.UNSIGNED_BYTE, empty);
            slot.width = width;
            slot.height = height;
        }

        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }

    function bindTextures() {
        for (const name in textureSlots) {
            const slot = textureSlots[name];
            if (!slot || !slot.texture) continue;
            gl.activeTexture(gl.TEXTURE0 + slot.unit);
            gl.bindTexture(gl.TEXTURE_2D, slot.texture);
            if (slot.loc) gl.uniform1i(slot.loc, slot.unit);
        }
    }

    function resize() {
        const dpr = window.devicePixelRatio || 1;
        const width = Math.max(1, Math.floor(canvas.clientWidth * dpr));
        const height = Math.max(1, Math.floor(canvas.clientHeight * dpr));
        if (canvas.width !== width || canvas.height !== height) {
            canvas.width = width;
            canvas.height = height;
        }
        gl.viewport(0, 0, canvas.width, canvas.height);
    }

    function renderOnce(time) {
        resize();
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        if (useAlphaBlend) {
            gl.enable(gl.BLEND);
            gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        } else {
            gl.disable(gl.BLEND);
        }

        gl.useProgram(program);
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.enableVertexAttribArray(positionLoc);
        gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, 0, 0);

        const t = (time - startTime) / 1000;
        if (timeLoc) gl.uniform1f(timeLoc, t);
        if (resLoc) gl.uniform2f(resLoc, canvas.width, canvas.height);

        // Resolve modulators each frame when present; else upload base uniforms (fast path)
        const clocks = {
            stack: t,
            wall: performance.now() / 1000,
            song: (typeof getSongModClock === 'function') ? getSongModClock() : 0,
        };
        const upload = (typeof resolveUniforms === 'function')
            ? resolveUniforms(uniforms, modulators, t, boundsByName, resolvedScratch, clocks)
            : uniforms;
        uploadUserUniforms(upload);
        // Live audio / external drivers win over LFOs for the same keys
        if (liveUniforms && Object.keys(liveUniforms).length) {
            uploadUserUniforms(liveUniforms);
        }
        bindTextures();

        gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    const shouldRender = createRenderFrameGate();

    function loop(now) {
        if (shouldRender(now)) renderOnce(now);
        rafId = requestAnimationFrame(loop);
    }

    return {
        gl,
        start() {
            if (rafId) return;
            renderOnce(performance.now());
            rafId = requestAnimationFrame(loop);
        },
        stop() {
            if (rafId) cancelAnimationFrame(rafId);
            rafId = null;
        },
        render() {
            renderOnce(performance.now());
        },
        getTime() {
            return (performance.now() - startTime) / 1000;
        },
        setTime(seconds) {
            const s = Number(seconds);
            startTime = performance.now() - (Number.isFinite(s) ? s : 0) * 1000;
        },
        setUniforms(obj) {
            Object.assign(uniforms, obj);
        },
        /**
         * Override uniforms after modulation (audio analysis).
         * Pass null to clear all live keys; pass object to merge; keys set to null are removed.
         */
        setLiveUniforms(obj) {
            if (obj == null) {
                for (const k of Object.keys(liveUniforms)) delete liveUniforms[k];
                return;
            }
            if (typeof obj !== 'object') return;
            for (const k of Object.keys(obj)) {
                if (obj[k] == null) delete liveUniforms[k];
                else liveUniforms[k] = obj[k];
            }
        },
        /**
         * Upload / allocate a sampler2D texture (see setTexture2D).
         * @param {string} name
         * @param {Uint8Array|null} data
         * @param {number} width
         * @param {number} height
         * @param {object} [opts]
         */
        setTexture2D(name, data, width, height, opts) {
            setTexture2D(name, data, width, height, opts);
        },
        /** Replace modulator map (null/empty = all static). */
        setModulators(obj) {
            modulators = obj && typeof obj === 'object' ? Object.assign({}, obj) : {};
        },
        /** Optional clamp bounds from package meta. */
        setBoundsByName(obj) {
            boundsByName = obj && typeof obj === 'object' ? Object.assign({}, obj) : {};
        },
        destroy() {
            this.stop();
            for (const name in textureSlots) {
                try {
                    if (textureSlots[name]?.texture) gl.deleteTexture(textureSlots[name].texture);
                } catch (e) { /* ignore */ }
            }
            try { gl.deleteProgram(program); } catch (e) {}
        }
    };
}

/**
 * Multi-pass postprocess stack.
 * Each frame: capture scene → run enabled layers in order (each samples previous as u_scene)
 * → blit final result to the visible canvas. Layers may declare u_prev for temporal feedback.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {Array<{key:string, fragSource:string, uniforms?:object, enabled?:boolean}>} initialLayers
 * @param {function(HTMLCanvasElement): void} captureFn
 */
function createPostprocessStack(canvas, initialLayers = [], captureFn = null) {
    if (canvas.width === 0 || canvas.height === 0) {
        canvas.width = canvas.clientWidth || 1;
        canvas.height = canvas.clientHeight || 1;
    }

    const contextOptions = {
        alpha: false,
        premultipliedAlpha: false,
        preserveDrawingBuffer: true,
        failIfMajorPerformanceCaveat: false,
        powerPreference: 'high-performance',
    };
    const gl = canvas.getContext('webgl2', contextOptions)
        || canvas.getContext('webgl', contextOptions)
        || canvas.getContext('experimental-webgl', contextOptions);
    if (!gl) throw new Error('WebGL not supported');

    const vert = defaultVertexShader();
    const passthroughSrc = buildFragmentSource(`
        uniform sampler2D u_scene;
        void main() {
            gl_FragColor = texture2D(u_scene, v_uv);
        }
    `, gl);
    const passthroughProgram = createProgram(gl, vert, passthroughSrc);
    const passPosLoc = gl.getAttribLocation(passthroughProgram, 'a_position');
    const passTimeLoc = gl.getUniformLocation(passthroughProgram, 'u_time');
    const passResLoc = gl.getUniformLocation(passthroughProgram, 'u_resolution');
    const passSceneLoc = gl.getUniformLocation(passthroughProgram, 'u_scene');

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

    // Intermediate FBO targets use RGBA; drawing buffer is RGB (alpha:false).
    const fboFormat = gl.RGBA;
    const drawFormat = contextOptions.alpha === false ? gl.RGB : gl.RGBA;

    function configureTex(tex, format) {
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        return format;
    }

    function allocTex(tex, format, w, h, fill) {
        gl.bindTexture(gl.TEXTURE_2D, tex);
        if (fill) {
            gl.texImage2D(gl.TEXTURE_2D, 0, format, w, h, 0, format, gl.UNSIGNED_BYTE, fill);
        } else {
            gl.texImage2D(gl.TEXTURE_2D, 0, format, w, h, 0, format, gl.UNSIGNED_BYTE, null);
        }
    }

    function makeTex(format, w, h, fill) {
        const tex = gl.createTexture();
        configureTex(tex, format);
        allocTex(tex, format, w, h, fill);
        return tex;
    }

    function makeFbo(w, h) {
        const tex = makeTex(fboFormat, w, h, null);
        const fb = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
        const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        if (!ok) console.warn('Postprocess FBO incomplete');
        return { fb, tex, w, h };
    }

    function destroyFbo(target) {
        if (!target) return;
        try { gl.deleteFramebuffer(target.fb); } catch (e) {}
        try { gl.deleteTexture(target.tex); } catch (e) {}
    }

    const sceneTexture = makeTex(gl.RGBA, 1, 1, new Uint8Array([0, 0, 0, 255]));
    let ping = null;
    let pong = null;
    let targetW = 1;
    let targetH = 1;

    /**
     * @type {Array<{
     *   key:string, program:WebGLProgram, uniforms:object, modulators:object,
     *   boundsByName:object, resolvedScratch:object, enabled:boolean,
     *   wantsFeedback:boolean, prevTex:WebGLTexture|null, locs:object
     * }>}
     */
    let layers = [];

    const captureCanvas = document.createElement('canvas');
    captureCanvas.width = 1;
    captureCanvas.height = 1;

    let rafId = null;
    let startTime = performance.now();
    let capture = captureFn;

    function compileLayer(def) {
        const frag = buildFragmentSource(def.fragSource || '', gl);
        const program = createProgram(gl, vert, frag);
        const prevLoc = gl.getUniformLocation(program, 'u_prev');
        const wantsFeedback = !!prevLoc;
        let prevTex = null;
        if (wantsFeedback) {
            // Feedback always from FBO (RGBA) since all passes render offscreen first
            prevTex = makeTex(fboFormat, targetW, targetH, null);
        }
        return {
            key: String(def.key),
            program,
            uniforms: Object.assign({}, def.uniforms || {}),
            modulators: Object.assign({}, def.modulators || {}),
            boundsByName: Object.assign({}, def.boundsByName || {}),
            resolvedScratch: {},
            enabled: def.enabled !== false,
            wantsFeedback,
            prevTex,
            locs: {
                position: gl.getAttribLocation(program, 'a_position'),
                time: gl.getUniformLocation(program, 'u_time'),
                res: gl.getUniformLocation(program, 'u_resolution'),
                scene: gl.getUniformLocation(program, 'u_scene'),
                prev: prevLoc,
            },
        };
    }

    function destroyLayer(layer) {
        if (!layer) return;
        try { gl.deleteProgram(layer.program); } catch (e) {}
        try { if (layer.prevTex) gl.deleteTexture(layer.prevTex); } catch (e) {}
    }

    function rebuildLayers(defs) {
        const nextDefs = Array.isArray(defs) ? defs : [];
        // Preserve prevTex feedback when the same layer key remains
        const oldByKey = new Map(layers.map((l) => [l.key, l]));
        const next = [];
        for (const def of nextDefs) {
            const key = String(def.key);
            const old = oldByKey.get(key);
            const compiled = compileLayer(def);
            if (old && old.prevTex && compiled.wantsFeedback) {
                try { gl.deleteTexture(compiled.prevTex); } catch (e) {}
                compiled.prevTex = old.prevTex;
                old.prevTex = null;
            }
            if (old) destroyLayer(old);
            oldByKey.delete(key);
            next.push(compiled);
        }
        for (const leftover of oldByKey.values()) destroyLayer(leftover);
        layers = next;
    }

    // Initial compile
    rebuildLayers(initialLayers);

    function ensureTargets(w, h) {
        if (targetW === w && targetH === h && ping && pong) return;
        targetW = w;
        targetH = h;
        destroyFbo(ping);
        destroyFbo(pong);
        ping = makeFbo(w, h);
        pong = makeFbo(w, h);
        for (const layer of layers) {
            if (layer.prevTex) {
                allocTex(layer.prevTex, fboFormat, w, h, null);
            }
        }
    }

    function resizeOutput() {
        const dpr = window.devicePixelRatio || 1;
        const width = Math.max(1, Math.floor((canvas.clientWidth || 1) * dpr));
        const height = Math.max(1, Math.floor((canvas.clientHeight || 1) * dpr));
        if (canvas.width !== width || canvas.height !== height) {
            canvas.width = width;
            canvas.height = height;
        }
        gl.viewport(0, 0, canvas.width, canvas.height);
        ensureTargets(width, height);
    }

    function uploadSceneTexture() {
        if (typeof capture === 'function') {
            try {
                capture(captureCanvas);
            } catch (e) {
                console.warn('Postprocess capture failed:', e);
            }
        }
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, sceneTexture);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, captureCanvas);
    }

    function bindQuad(program, positionLoc) {
        gl.useProgram(program);
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.enableVertexAttribArray(positionLoc);
        gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, 0, 0);
    }

    function setCommonUniforms(locs, t, inputTex, prevTex) {
        if (locs.time) gl.uniform1f(locs.time, t);
        if (locs.res) gl.uniform2f(locs.res, canvas.width, canvas.height);
        if (locs.scene) {
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, inputTex);
            gl.uniform1i(locs.scene, 0);
        }
        if (locs.prev && prevTex) {
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, prevTex);
            gl.uniform1i(locs.prev, 1);
        }
    }

    function setUserUniforms(program, uniforms) {
        for (const k in uniforms) {
            if (k === 'u_scene' || k === 'u_prev') continue;
            const loc = gl.getUniformLocation(program, k);
            if (!loc) continue;
            const v = uniforms[k];
            if (typeof v === 'number') gl.uniform1f(loc, v);
            else if (Array.isArray(v) && v.length === 2) gl.uniform2f(loc, v[0], v[1]);
            else if (Array.isArray(v) && v.length === 3) gl.uniform3f(loc, v[0], v[1], v[2]);
            else if (Array.isArray(v) && v.length === 4) gl.uniform4f(loc, v[0], v[1], v[2], v[3]);
        }
    }

    function drawTo(targetFbo) {
        if (targetFbo) {
            gl.bindFramebuffer(gl.FRAMEBUFFER, targetFbo.fb);
        } else {
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        }
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.disable(gl.BLEND);
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    function copyFeedback(layer) {
        if (!layer.wantsFeedback || !layer.prevTex) return;
        // Current draw target is still bound (FBO). Copy color attachment → prevTex.
        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, layer.prevTex);
        try {
            gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, canvas.width, canvas.height);
        } catch (e) {
            try {
                allocTex(layer.prevTex, fboFormat, canvas.width, canvas.height, null);
                gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, canvas.width, canvas.height);
            } catch (e2) {
                console.warn('Postprocess feedback copy failed:', e2);
            }
        }
    }

    function blitTextureToCanvas(tex, t) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, canvas.width, canvas.height);
        bindQuad(passthroughProgram, passPosLoc);
        if (passTimeLoc) gl.uniform1f(passTimeLoc, t);
        if (passResLoc) gl.uniform2f(passResLoc, canvas.width, canvas.height);
        if (passSceneLoc) {
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, tex);
            gl.uniform1i(passSceneLoc, 0);
        }
        gl.disable(gl.BLEND);
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    function renderOnce(time) {
        resizeOutput();
        uploadSceneTexture();

        const t = (time - startTime) / 1000;
        const clocks = {
            stack: t,
            wall: performance.now() / 1000,
            song: (typeof getSongModClock === 'function') ? getSongModClock() : 0,
        };
        const active = layers.filter((l) => l.enabled);
        let inputTex = sceneTexture;
        let writePing = true;

        if (active.length === 0) {
            blitTextureToCanvas(sceneTexture, t);
            return;
        }

        for (let i = 0; i < active.length; i++) {
            const layer = active[i];
            const out = writePing ? ping : pong;
            writePing = !writePing;

            bindQuad(layer.program, layer.locs.position);
            setCommonUniforms(layer.locs, t, inputTex, layer.prevTex);
            // Fast path: no active modulators → upload base map as stored
            const upload = (typeof resolveUniforms === 'function')
                ? resolveUniforms(
                    layer.uniforms,
                    layer.modulators,
                    t,
                    layer.boundsByName,
                    layer.resolvedScratch,
                    clocks,
                )
                : layer.uniforms;
            setUserUniforms(layer.program, upload);
            drawTo(out);
            copyFeedback(layer);
            inputTex = out.tex;
        }

        // Final blit to visible canvas (drawing buffer)
        blitTextureToCanvas(inputTex, t);
        void drawFormat;
    }

    const shouldRender = createRenderFrameGate();

    function loop(now) {
        if (shouldRender(now)) renderOnce(now);
        rafId = requestAnimationFrame(loop);
    }

    return {
        gl,
        captureCanvas,
        start() {
            if (rafId) return;
            renderOnce(performance.now());
            rafId = requestAnimationFrame(loop);
        },
        stop() {
            if (rafId) cancelAnimationFrame(rafId);
            rafId = null;
        },
        render() {
            renderOnce(performance.now());
        },
        getTime() {
            return (performance.now() - startTime) / 1000;
        },
        setTime(seconds) {
            const s = Number(seconds);
            startTime = performance.now() - (Number.isFinite(s) ? s : 0) * 1000;
        },
        /** Replace full stack. defs: [{key, fragSource, uniforms, modulators?, boundsByName?, enabled}] */
        setLayers(defs) {
            rebuildLayers(defs);
            ensureTargets(targetW, targetH);
        },
        /** Update uniforms for one layer by key */
        setLayerUniforms(key, obj) {
            const layer = layers.find((l) => l.key === String(key));
            if (!layer) return;
            Object.assign(layer.uniforms, obj || {});
        },
        /**
         * Replace modulator map for one layer by key.
         * Pass null/{} for all-static (fast path). Partial merge is caller's job.
         */
        setLayerModulators(key, obj) {
            const layer = layers.find((l) => l.key === String(key));
            if (!layer) return;
            layer.modulators = obj && typeof obj === 'object' ? Object.assign({}, obj) : {};
        },
        /** Optional clamp bounds map for one layer */
        setLayerBoundsByName(key, obj) {
            const layer = layers.find((l) => l.key === String(key));
            if (!layer) return;
            layer.boundsByName = obj && typeof obj === 'object' ? Object.assign({}, obj) : {};
        },
        /** Enable/disable a layer without recompiling */
        setLayerEnabled(key, enabled) {
            const layer = layers.find((l) => l.key === String(key));
            if (!layer) return;
            layer.enabled = !!enabled;
        },
        /** Legacy single-layer helper */
        setUniforms(obj) {
            if (layers[0]) Object.assign(layers[0].uniforms, obj || {});
        },
        setCaptureFn(fn) {
            capture = fn;
        },
        destroy() {
            this.stop();
            for (const layer of layers) destroyLayer(layer);
            layers = [];
            destroyFbo(ping);
            destroyFbo(pong);
            ping = pong = null;
            try { gl.deleteTexture(sceneTexture); } catch (e) {}
            try { gl.deleteProgram(passthroughProgram); } catch (e) {}
        },
    };
}

/**
 * Single-pass convenience wrapper around createPostprocessStack.
 */
function createPostprocessLayer(canvas, fragSource, initialUniforms = {}, captureFn = null) {
    return createPostprocessStack(canvas, [{
        key: 'main',
        fragSource,
        uniforms: initialUniforms,
        enabled: true,
    }], captureFn);
}
