/**
 * music_view host for ARTEF4KT (Three.js ferrofluid visualizer).
 *
 * Loads vendored scripts once, constructs embed-mode instances, and maps
 * music_view audio-frame fields into setExternalAnalysis().
 *
 * Global: window.createArtef4ktEmbed / window.Artef4ktHost
 */
(function (root) {
    'use strict';

    const SCRIPT_BASE = 'vendor/artef4kt/';
    const SCRIPT_ORDER = [
        'three.min.js',
        'color-harmonizer.js',
        'grid-cells.js',
        'orbital-blobs.js',
        'shockwave-system.js',
        'performance-monitor.js',
        'gpu-particle-shaders.js',
        'effect-composer.js',
        'filmic-tone-system.js',
        'script.js',
    ];

    let loadPromise = null;

    function loadScript(src) {
        return new Promise((resolve, reject) => {
            const existing = document.querySelector(`script[data-artef4kt-src="${src}"]`);
            if (existing) {
                if (existing.dataset.loaded === '1') {
                    resolve();
                    return;
                }
                existing.addEventListener('load', () => resolve(), { once: true });
                existing.addEventListener('error', () => reject(new Error('Failed to load ' + src)), { once: true });
                return;
            }
            const el = document.createElement('script');
            el.src = src;
            el.async = false;
            el.dataset.artef4ktSrc = src;
            el.onload = () => {
                el.dataset.loaded = '1';
                resolve();
            };
            el.onerror = () => reject(new Error('Failed to load ' + src));
            document.head.appendChild(el);
        });
    }

    function ensureStubs() {
        root.ARTEF4KT_NO_AUTO_INIT = true;
        if (!root.loadingManager) {
            root.loadingManager = {
                updateProgress() {},
                hide() {},
            };
        }
    }

    function ensureScriptsLoaded() {
        if (root.FerrofluidVisualizer) {
            return Promise.resolve();
        }
        if (loadPromise) return loadPromise;
        ensureStubs();
        loadPromise = SCRIPT_ORDER.reduce(
            (p, name) => p.then(() => loadScript(SCRIPT_BASE + name)),
            Promise.resolve(),
        ).then(() => {
            if (!root.FerrofluidVisualizer) {
                throw new Error('FerrofluidVisualizer not defined after loading ARTEF4KT scripts');
            }
        }).catch((err) => {
            loadPromise = null;
            throw err;
        });
        return loadPromise;
    }

    function clamp01(v) {
        const n = Number(v);
        if (!Number.isFinite(n)) return 0;
        return n < 0 ? 0 : n > 1 ? 1 : n;
    }

    /**
     * Map music_view audio-frame → ARTEF4KT band intensities.
     * @param {object} frame
     */
    function mapAudioFrame(frame) {
        if (!frame || typeof frame !== 'object') {
            return { bass: 0, mid: 0, high: 0, beat: 0, envelope: 0 };
        }
        const ch = frame.channels && typeof frame.channels === 'object' ? frame.channels : {};
        const level = (id) => {
            if (ch && Number.isFinite(Number(ch[id]))) return clamp01(ch[id]);
            if (Number.isFinite(Number(frame[id]))) return clamp01(frame[id]);
            return 0;
        };
        // Prefer isolatable channels; fall back to top-level aliases if present
        const bass = Math.max(level('bass'), level('kick') * 0.85);
        const mid = Math.max(level('mid'), level('lowmid') * 0.7, level('presence') * 0.5);
        const high = Math.max(level('treble'), level('presence') * 0.6);
        const beat = Math.max(level('beat'), level('onset') * 0.8);
        const envelope = Math.max(level('envelope'), level('rms'), level('peak') * 0.5);
        return {
            bass: Math.max(bass, envelope * 0.35),
            mid: Math.max(mid, envelope * 0.25),
            high: Math.max(high, envelope * 0.2),
            beat,
            envelope,
            sensitivity: 1.0,
        };
    }

    /**
     * @param {object} options
     * @param {HTMLCanvasElement} options.canvas
     * @param {number} [options.width]
     * @param {number} [options.height]
     * @returns {Promise<{
     *   setSize: (w:number,h:number)=>void,
     *   setAnalysis: (frame:object)=>void,
     *   setPlaying: (p:boolean)=>void,
     *   unmount: ()=>void,
     *   getCanvas: ()=>HTMLCanvasElement|null,
     *   loadSettings: (idOrJson:string|object)=>Promise<void>,
     *   viz: object
     * }>}
     */
    /**
     * Inject ARTEF4KT on-screen info overlays into the floating panel.
     * Uses the same element IDs standalone mode expects so updateUIOpacity /
     * updateFrequencyIndicators keep working. Parent must be position:relative.
     * @param {HTMLElement} parentEl
     * @param {{ showStatus?: boolean, showTrackInfo?: boolean, showFreq?: boolean, showProgress?: boolean, showLogos?: boolean }} [flags]
     */
    function ensureEmbedOverlays(parentEl, flags) {
        if (!parentEl || !parentEl.appendChild) return null;
        const f = flags && typeof flags === 'object' ? flags : {};
        let root = parentEl.querySelector(':scope > .artef4kt-overlay-root');
        if (root) return root;

        // Avoid duplicate global IDs if an orphan exists elsewhere
        const killIds = [
            'status-message', 'track-info-display', 'track-name-vertical',
            'track-bpm', 'track-time-display', 'track-freq-display',
            'performance-fps', 'performance-quality', 'performance-objects',
            'frequency-analyzer-clone', 'bass-level-clone', 'mid-level-clone',
            'high-level-clone', 'track-progress-container', 'track-progress-bar',
            'svg-logos-container',
        ];
        for (const id of killIds) {
            const el = document.getElementById(id);
            if (el && !parentEl.contains(el)) el.remove();
        }

        root = document.createElement('div');
        root.className = 'artef4kt-overlay-root';
        root.setAttribute('aria-hidden', 'true');
        root.innerHTML = [
            '<div id="status-message" class="artef4kt-ov-status">ARTEF4KT · linked to Music</div>',
            '<div id="track-info-display" class="artef4kt-ov-track-info">',
            '  <div id="track-numbers-line" class="artef4kt-ov-numbers">',
            '    <span id="performance-fps">--</span>',
            '    <span id="track-freq-display">0 Hz</span>',
            '    <span id="track-bpm">--</span>',
            '    <span id="track-time-display">00:00 / 00:00</span>',
            '  </div>',
            '  <div id="track-name-vertical" class="artef4kt-ov-track-name">No track</div>',
            '</div>',
            '<div id="frequency-analyzer-clone" class="artef4kt-ov-freq">',
            '  <div class="freq-range-vertical bass-vertical"><div class="freq-bar-vertical"><div class="freq-level-vertical" id="bass-level-clone"></div></div></div>',
            '  <div class="freq-range-vertical mids-vertical"><div class="freq-bar-vertical"><div class="freq-level-vertical" id="mid-level-clone"></div></div></div>',
            '  <div class="freq-range-vertical highs-vertical"><div class="freq-bar-vertical"><div class="freq-level-vertical" id="high-level-clone"></div></div></div>',
            '</div>',
            '<div id="track-progress-container" class="artef4kt-ov-progress">',
            '  <div id="track-progress-bar" class="artef4kt-ov-progress-bar"><div class="artef4kt-ov-progress-fill" id="artef4kt-progress-fill"></div></div>',
            '</div>',
            '<div id="svg-logos-container" class="artef4kt-ov-logos">',
            '  <div class="svg-logo artef4kt-ov-logo-mark" title="ARTEF4KT">',
            '    <svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">',
            '      <circle class="svg-logo-path" cx="16" cy="16" r="10" fill="none" stroke="currentColor" stroke-width="2"/>',
            '      <circle class="svg-logo-path" cx="16" cy="16" r="3" fill="currentColor"/>',
            '    </svg>',
            '  </div>',
            '</div>',
        ].join('\n');

        // Ensure stacking: canvas under overlays
        if (parentEl.style) {
            if (!parentEl.style.position || parentEl.style.position === 'static') {
                // floating-box already absolute; keep
            }
            parentEl.classList.add('artef4kt-panel');
        }
        parentEl.appendChild(root);
        applyOverlayFlags(root, f);
        return root;
    }

    function applyOverlayFlags(root, flags) {
        if (!root) return;
        const f = flags && typeof flags === 'object' ? flags : {};
        const map = {
            status: 'status-message',
            trackInfo: 'track-info-display',
            freq: 'frequency-analyzer-clone',
            progress: 'track-progress-container',
            logos: 'svg-logos-container',
        };
        // Defaults: all visible unless explicitly false
        const show = {
            status: f.showStatus !== false && f.overlayShowStatus !== false,
            trackInfo: f.showTrackInfo !== false && f.overlayShowTrackInfo !== false,
            freq: f.showFreq !== false && f.overlayShowFreq !== false,
            progress: f.showProgress !== false && f.overlayShowProgress !== false,
            logos: f.showLogos !== false && f.overlayShowLogos !== false,
        };
        for (const [key, id] of Object.entries(map)) {
            const el = root.querySelector('#' + id) || document.getElementById(id);
            if (!el) continue;
            el.style.display = show[key] ? '' : 'none';
            el.dataset.artef4ktOverlay = show[key] ? '1' : '0';
        }
    }

    function formatTime(sec) {
        const s = Math.max(0, Math.floor(Number(sec) || 0));
        const m = Math.floor(s / 60);
        const r = s % 60;
        return String(m).padStart(2, '0') + ':' + String(r).padStart(2, '0');
    }

    async function createArtef4ktEmbed(options) {
        const opts = options && typeof options === 'object' ? options : {};
        const canvas = opts.canvas;
        if (!canvas || canvas.tagName !== 'CANVAS') {
            throw new Error('createArtef4ktEmbed requires options.canvas');
        }

        await ensureScriptsLoaded();

        const width = Math.max(1, Math.round(Number(opts.width) || canvas.clientWidth || canvas.width || 320));
        const height = Math.max(1, Math.round(Number(opts.height) || canvas.clientHeight || canvas.height || 320));

        // Drawing buffer size before Three.js attaches
        if (canvas.width !== width) canvas.width = width;
        if (canvas.height !== height) canvas.height = height;
        canvas.style.width = '100%';
        canvas.style.height = '100%';
        canvas.style.display = 'block';
        canvas.style.position = 'absolute';
        canvas.style.left = '0';
        canvas.style.top = '0';
        canvas.style.zIndex = '0';

        const parentEl = opts.parentEl || canvas.parentElement;
        const overlayRoot = parentEl
            ? ensureEmbedOverlays(parentEl, opts.overlay || opts.embedOverlay || {})
            : null;

        const Viz = root.FerrofluidVisualizer;
        const viz = new Viz({
            embed: true,
            externalAnalysis: true,
            canvas,
            width,
            height,
        });

        if (!viz || !viz.renderer) {
            throw new Error('ARTEF4KT embed failed to initialize renderer');
        }

        // Start “playing” false until music_view sends frames
        viz.isPlaying = false;

        // Apply initial info opacity to newly injected overlays
        if (typeof viz.updateUIOpacity === 'function') {
            try { viz.updateUIOpacity(); } catch (_) { /* ignore */ }
        }

        const hostApi = {
            viz,
            overlayRoot,
            setSize(w, h) {
                const nw = Math.max(1, Math.round(Number(w) || width));
                const nh = Math.max(1, Math.round(Number(h) || height));
                if (typeof viz.setEmbedSize === 'function') {
                    viz.setEmbedSize(nw, nh);
                }
            },
            setAnalysis(frame, mappedOverride) {
                const mapped = mappedOverride && typeof mappedOverride === 'object'
                    ? mappedOverride
                    : mapAudioFrame(frame);
                if (typeof viz.setExternalAnalysis === 'function') {
                    viz.setExternalAnalysis(mapped);
                }
                if (frame && typeof frame === 'object' && 'playing' in frame) {
                    viz.isPlaying = !!frame.playing;
                }
            },
            setPlaying(playing) {
                viz.isPlaying = !!playing;
            },
            /** Music → track name / status (no ARTEF4KT file picker). */
            setTrackInfo(info) {
                const title = (info && (info.title || info.name)) || 'No track';
                const artist = info && info.artist ? String(info.artist) : '';
                const nameEl = document.getElementById('track-name-vertical');
                if (nameEl) {
                    nameEl.textContent = artist ? (title + ' · ' + artist) : String(title);
                }
                const status = document.getElementById('status-message');
                if (status && info) {
                    status.textContent = artist
                        ? ('NOW PLAYING · ' + title + ' — ' + artist)
                        : ('NOW PLAYING · ' + title);
                }
            },
            /** Music → progress (0..1) and times. */
            setProgress(payload) {
                const p = payload && typeof payload === 'object' ? payload : {};
                let frac = Number(p.progress);
                const cur = Number(p.currentTime) || 0;
                const dur = Number(p.duration) || 0;
                if (!Number.isFinite(frac)) {
                    frac = dur > 0 ? cur / dur : 0;
                }
                frac = Math.max(0, Math.min(1, frac));
                const fill = document.getElementById('artef4kt-progress-fill');
                if (fill) fill.style.height = Math.round(frac * 100) + '%';
                const timeEl = document.getElementById('track-time-display');
                if (timeEl) {
                    timeEl.textContent = formatTime(cur) + ' / ' + formatTime(dur);
                }
            },
            setStatus(text) {
                const status = document.getElementById('status-message');
                if (status) status.textContent = String(text || '');
            },
            /** Visibility flags for overlay chrome (Controls). */
            setOverlayFlags(flags) {
                applyOverlayFlags(overlayRoot, flags || {});
                // Re-apply opacity so hidden vs opacity-0 stay consistent
                if (typeof viz.updateUIOpacity === 'function') {
                    try { viz.updateUIOpacity(); } catch (_) { /* ignore */ }
                }
            },
            getSettings() {
                if (!viz || typeof viz.getUISettings !== 'function') return null;
                try {
                    const s = viz.getUISettings();
                    // Embed overlay visibility flags (not in standalone getUISettings)
                    if (s && overlayRoot) {
                        s.overlayShowStatus = overlayVisible(overlayRoot, 'status-message');
                        s.overlayShowTrackInfo = overlayVisible(overlayRoot, 'track-info-display');
                        s.overlayShowFreq = overlayVisible(overlayRoot, 'frequency-analyzer-clone');
                        s.overlayShowProgress = overlayVisible(overlayRoot, 'track-progress-container');
                        s.overlayShowLogos = overlayVisible(overlayRoot, 'svg-logos-container');
                    }
                    return s;
                } catch (e) {
                    console.warn('ARTEF4KT getSettings', e);
                    return null;
                }
            },
            /**
             * Apply a full settings object (preset) or merge a patch onto current.
             * @param {object} settingsOrPatch
             * @param {{ partial?: boolean, settingsId?: string|null }} [opts]
             */
            applySettings(settingsOrPatch, opts = {}) {
                if (!viz || !settingsOrPatch || typeof settingsOrPatch !== 'object') return false;
                const partial = !!opts.partial;
                // Partial: apply ONLY the patch keys (no full re-merge). Full presets
                // pass the whole JSON. This avoids slider races and accidental resets.
                const payload = Object.assign({}, settingsOrPatch);
                if (partial) payload._partial = true;
                else if (payload._partial) delete payload._partial;

                try {
                    if (typeof viz.applyUISettings === 'function') {
                        viz.applyUISettings(payload);
                    } else if (typeof viz.applySettings === 'function') {
                        viz.applySettings(payload);
                    } else {
                        return false;
                    }
                    // Overlay show flags (embed-only) — merge with current flags so a
                    // single toggle does not re-show everything else.
                    if (
                        'overlayShowStatus' in settingsOrPatch
                        || 'overlayShowTrackInfo' in settingsOrPatch
                        || 'overlayShowFreq' in settingsOrPatch
                        || 'overlayShowProgress' in settingsOrPatch
                        || 'overlayShowLogos' in settingsOrPatch
                    ) {
                        const cur = {
                            overlayShowStatus: overlayVisible(overlayRoot, 'status-message'),
                            overlayShowTrackInfo: overlayVisible(overlayRoot, 'track-info-display'),
                            overlayShowFreq: overlayVisible(overlayRoot, 'frequency-analyzer-clone'),
                            overlayShowProgress: overlayVisible(overlayRoot, 'track-progress-container'),
                            overlayShowLogos: overlayVisible(overlayRoot, 'svg-logos-container'),
                        };
                        applyOverlayFlags(overlayRoot, Object.assign(cur, settingsOrPatch));
                    }
                    if (typeof viz.updateUIOpacity === 'function' && settingsOrPatch.uiOpacity !== undefined) {
                        try { viz.updateUIOpacity(); } catch (_) { /* ignore */ }
                    }
                    return true;
                } catch (e) {
                    console.warn('ARTEF4KT applySettings', e);
                    return false;
                }
            },
            async loadSettings(idOrJson) {
                if (!viz) return false;
                try {
                    let json = idOrJson;
                    let settingsId = null;
                    if (typeof idOrJson !== 'object' || idOrJson === null) {
                        const id = String(idOrJson || 'default').replace(/\.json$/i, '');
                        settingsId = id;
                        const url = SCRIPT_BASE + 'settings/' + id + '.json';
                        const res = await fetch(url);
                        if (!res.ok) throw new Error('settings ' + id + ' HTTP ' + res.status);
                        json = await res.json();
                    }
                    const ok = this.applySettings(json, { partial: false });
                    return { ok, settingsId, settings: this.getSettings() };
                } catch (e) {
                    console.warn('ARTEF4KT loadSettings failed', e);
                    return { ok: false, error: String(e && e.message ? e.message : e) };
                }
            },
            async listPresets() {
                return listArtef4ktPresets();
            },
            getCanvas() {
                return viz.canvas || canvas;
            },
            unmount() {
                try {
                    if (viz && typeof viz.destroy === 'function') {
                        viz.destroy();
                    }
                } catch (e) {
                    console.warn('ARTEF4KT destroy', e);
                }
                try {
                    if (overlayRoot && overlayRoot.parentNode) {
                        overlayRoot.parentNode.removeChild(overlayRoot);
                    }
                    if (parentEl) parentEl.classList.remove('artef4kt-panel');
                } catch (_) { /* ignore */ }
            },
        };
        return hostApi;
    }

    function overlayVisible(root, id) {
        const el = (root && root.querySelector('#' + id)) || document.getElementById(id);
        if (!el) return true;
        if (el.dataset.artef4ktOverlay === '0') return false;
        return el.style.display !== 'none';
    }

    function deepMerge(base, patch) {
        if (!patch || typeof patch !== 'object') return base;
        const out = Object.assign({}, base);
        for (const key of Object.keys(patch)) {
            const pv = patch[key];
            const bv = base ? base[key] : undefined;
            if (
                pv && typeof pv === 'object' && !Array.isArray(pv)
                && bv && typeof bv === 'object' && !Array.isArray(bv)
            ) {
                out[key] = deepMerge(bv, pv);
            } else {
                out[key] = pv;
            }
        }
        return out;
    }

    async function listArtef4ktPresets() {
        try {
            const res = await fetch(SCRIPT_BASE + 'settings/index.json');
            if (!res.ok) throw new Error('index HTTP ' + res.status);
            const data = await res.json();
            const list = Array.isArray(data.presets) ? data.presets : [];
            return list.map((p) => {
                if (typeof p === 'string') {
                    const file = p.endsWith('.json') ? p : p + '.json';
                    const id = file.replace(/\.json$/i, '');
                    return { id, file, name: id };
                }
                const file = p.file || p.id || p.name;
                const id = String(file || '').replace(/\.json$/i, '');
                return {
                    id,
                    file: id + '.json',
                    name: p.name || id,
                    description: p.description || '',
                };
            }).filter((p) => p.id);
        } catch (e) {
            console.warn('ARTEF4KT listPresets', e);
            return [{ id: 'default', file: 'default.json', name: 'Default' }];
        }
    }

    root.createArtef4ktEmbed = createArtef4ktEmbed;
    root.listArtef4ktPresets = listArtef4ktPresets;
    root.Artef4ktHost = {
        create: createArtef4ktEmbed,
        ensureScriptsLoaded,
        mapAudioFrame,
        listPresets: listArtef4ktPresets,
        SCRIPT_BASE,
    };
})(typeof window !== 'undefined' ? window : globalThis);
