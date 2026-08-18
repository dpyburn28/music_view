/**
 * Param modulation — pure CPU resolve (display + controls).
 * Formulas locked in docs/roadmap/history/param-modulation-plan.md (Phases 0–5).
 * Living guide: docs/authoring/param-modulation.md
 *
 * Browser: globals. Node: module.exports for unit checks.
 */
(function (root) {
    'use strict';

    const TWO_PI = Math.PI * 2;
    const ACTIVE_SOURCES = {
        time: true,
        sine: true,
        triangle: true,
        square: true,
        noise: true,
    };
    const CLOCKS = { stack: true, wall: true, song: true };
    const AMP_EPS = 1e-12;

    /**
     * Deterministic hash → [0, 1).
     * @param {number} n
     * @returns {number}
     */
    function hash01(n) {
        let x = Math.imul(Math.floor(n) | 0, 374761393);
        x = Math.imul(x ^ (x >>> 13), 1274126177);
        x = (x ^ (x >>> 16)) >>> 0;
        return x / 4294967296;
    }

    /**
     * 1D value noise, bipolar output in [-1, 1].
     * @param {number} x sample position (cycles)
     * @param {number} [seed=0]
     * @returns {number}
     */
    function valueNoise1D(x, seed) {
        const s = seed != null && Number.isFinite(Number(seed)) ? Number(seed) : 0;
        const i0 = Math.floor(x);
        const f = x - i0;
        const u = f * f * (3 - 2 * f); // smoothstep
        const h0 = hash01(i0 + s);
        const h1 = hash01(i0 + 1 + s);
        const n01 = h0 + (h1 - h0) * u;
        return n01 * 2 - 1;
    }

    /** Positive fractional part in [0, 1). */
    function fract01(x) {
        const f = x % 1;
        return f < 0 ? f + 1 : f;
    }

    /**
     * Bipolar triangle in [-1, 1]: rises then falls each cycle.
     * @param {number} phaseCycles
     */
    function triangleBipolar(phaseCycles) {
        const p = fract01(phaseCycles);
        // 0→0.5: -1→+1 ; 0.5→1: +1→-1
        return p < 0.5 ? (4 * p - 1) : (3 - 4 * p);
    }

    /**
     * Bipolar square in [-1, 1].
     * @param {number} phaseCycles
     */
    function squareBipolar(phaseCycles) {
        return fract01(phaseCycles) < 0.5 ? 1 : -1;
    }

    /**
     * @param {object|null|undefined} mod
     * @returns {boolean}
     */
    function isModSourceActive(mod) {
        if (!mod || typeof mod !== 'object') return false;
        return !!ACTIVE_SOURCES[mod.source];
    }

    /**
     * True if any entry has an active (non-static) source.
     * @param {object|null|undefined} modulators
     * @returns {boolean}
     */
    function hasActiveModulators(modulators) {
        if (!modulators || typeof modulators !== 'object') return false;
        for (const k in modulators) {
            if (Object.prototype.hasOwnProperty.call(modulators, k)
                && isModSourceActive(modulators[k])) {
                return true;
            }
        }
        return false;
    }

    function clampNumber(v, bounds) {
        if (!bounds || typeof bounds !== 'object') return v;
        let out = v;
        if (bounds.min != null && Number.isFinite(Number(bounds.min))) {
            out = Math.max(Number(bounds.min), out);
        }
        if (bounds.max != null && Number.isFinite(Number(bounds.max))) {
            out = Math.min(Number(bounds.max), out);
        }
        return out;
    }

    /**
     * Pick time base for a modulator.
     * @param {object|null|undefined} mod
     * @param {number} tSec default / stack seconds
     * @param {{ stack?: number, wall?: number, song?: number }|null|undefined} clocks
     * @returns {number}
     */
    function resolveModTime(mod, tSec, clocks) {
        const fallback = Number.isFinite(tSec) ? tSec : 0;
        if (!clocks || typeof clocks !== 'object') return fallback;
        const c = mod && mod.clock != null ? String(mod.clock).toLowerCase() : 'stack';
        if (c === 'wall' && Number.isFinite(clocks.wall)) return clocks.wall;
        if (c === 'song' && Number.isFinite(clocks.song)) return clocks.song;
        if (Number.isFinite(clocks.stack)) return clocks.stack;
        return fallback;
    }

    /**
     * Normalize optional clock field for export/store.
     * @param {string|null|undefined} clock
     * @returns {'stack'|'wall'|'song'|undefined}
     */
    function sanitizeClock(clock) {
        if (clock == null || clock === '') return undefined;
        const c = String(clock).toLowerCase();
        if (c === 'stack' || !CLOCKS[c]) return undefined; // stack is default — omit
        return c;
    }

    /**
     * Resolve one scalar uniform.
     * @param {number} base fallback / static value (also used if mod missing)
     * @param {object|null|undefined} mod ParamModulator
     * @param {number} tSec time in seconds (stack u_time by default)
     * @param {{min?:number,max?:number}|null|undefined} bounds
     * @param {{ stack?: number, wall?: number, song?: number }|null|undefined} clocks
     * @returns {number}
     */
    function resolveModulatedValue(base, mod, tSec, bounds, clocks) {
        const b = typeof base === 'number' && Number.isFinite(base) ? base : 0;
        if (!isModSourceActive(mod)) return b;

        const offset = mod.offset != null && Number.isFinite(Number(mod.offset))
            ? Number(mod.offset)
            : b;
        const amp = mod.amp != null && Number.isFinite(Number(mod.amp))
            ? Number(mod.amp)
            : 0;

        // Perf: amp≈0 freezes at offset (still "active" for UI/presets)
        let resolved = offset;
        if (Math.abs(amp) >= AMP_EPS) {
            const rate = mod.rate != null && Number.isFinite(Number(mod.rate))
                ? Number(mod.rate)
                : 0;
            const phase = mod.phase != null && Number.isFinite(Number(mod.phase))
                ? Number(mod.phase)
                : 0;
            const t = resolveModTime(mod, tSec, clocks);
            const src = mod.source;
            const cycle = t * rate + phase;

            if (src === 'time') {
                // Bipolar wrapped saw
                resolved = offset + amp * (2 * fract01(cycle) - 1);
            } else if (src === 'sine') {
                // phase is radians for sine
                resolved = offset + amp * Math.sin(TWO_PI * rate * t + phase);
            } else if (src === 'triangle') {
                resolved = offset + amp * triangleBipolar(cycle);
            } else if (src === 'square') {
                resolved = offset + amp * squareBipolar(cycle);
            } else if (src === 'noise') {
                const seed = mod.seed != null && Number.isFinite(Number(mod.seed))
                    ? Number(mod.seed)
                    : 0;
                resolved = offset + amp * valueNoise1D(cycle, seed);
            }
        }

        const doClamp = mod.clamp !== false;
        if (doClamp && bounds) {
            resolved = clampNumber(resolved, bounds);
        }
        return resolved;
    }

    /**
     * Resolve a full uniform map. Static keys pass through.
     * Fast path: if no active modulators, returns `uniforms` (same reference).
     *
     * @param {object} uniforms
     * @param {object|null|undefined} modulators
     * @param {number} tSec
     * @param {object|null|undefined} boundsByName map name → {min,max}
     * @param {object|null|undefined} out optional scratch object
     * @param {{ stack?: number, wall?: number, song?: number }|null|undefined} clocks
     * @returns {object}
     */
    function resolveUniforms(uniforms, modulators, tSec, boundsByName, out, clocks) {
        const map = uniforms && typeof uniforms === 'object' ? uniforms : {};
        if (!hasActiveModulators(modulators)) return map;

        const target = out && typeof out === 'object' ? out : {};
        for (const k in target) {
            if (!Object.prototype.hasOwnProperty.call(map, k)) delete target[k];
        }

        for (const k in map) {
            if (!Object.prototype.hasOwnProperty.call(map, k)) continue;
            const base = map[k];
            const mod = modulators[k];
            if (typeof base === 'number' && isModSourceActive(mod)) {
                const bounds = boundsByName && boundsByName[k] ? boundsByName[k] : null;
                let modUse = mod;
                if (mod.source === 'noise' && (mod.seed == null || !Number.isFinite(Number(mod.seed)))) {
                    modUse = Object.assign({}, mod, { seed: seedFromName(k) });
                }
                target[k] = resolveModulatedValue(base, modUse, tSec, bounds, clocks);
            } else {
                target[k] = base;
            }
        }
        return target;
    }

    /** Stable seed from uniform name when seed omitted. */
    function seedFromName(name) {
        const s = String(name || '');
        let h = 2166136261;
        for (let i = 0; i < s.length; i++) {
            h ^= s.charCodeAt(i);
            h = Math.imul(h, 16777619);
        }
        return h >>> 0;
    }

    const api = {
        hash01,
        valueNoise1D,
        fract01,
        triangleBipolar,
        squareBipolar,
        isModSourceActive,
        hasActiveModulators,
        resolveModTime,
        sanitizeClock,
        resolveModulatedValue,
        resolveUniforms,
        seedFromName,
        ACTIVE_SOURCES,
        AMP_EPS,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (root) {
        root.ParamMod = api;
        root.hash01 = api.hash01;
        root.valueNoise1D = api.valueNoise1D;
        root.isModSourceActive = api.isModSourceActive;
        root.hasActiveModulators = api.hasActiveModulators;
        root.resolveModulatedValue = api.resolveModulatedValue;
        root.resolveUniforms = api.resolveUniforms;
        root.seedFromName = api.seedFromName;
        root.resolveModTime = api.resolveModTime;
        root.sanitizeClock = api.sanitizeClock;
    }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
