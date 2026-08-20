// Shared scene context for the display window (used by controls IPC + APIs)
const scene = {
    topPanel: null,
    canvas: null,
    overlayCanvas: null,
    ctx: null,
    overlayCtx: null,
    drawableState: null,
    containers: [],
    redraw: null,
    nextContainerId: 1,
    /** @type {{ cover: object|null, info: object|null, lyrics: object|null, progress: object|null }} */
    songPanels: { cover: null, info: null, lyrics: null, progress: null },
    /** Last loaded/saved visual preset name */
    activePreset: null,
    /** UI-only: container currently selected in controls / click-to-select (not saved in presets) */
    selectedContainerId: null,
    /**
     * Blue bottom strip under the white stage.
     * heightRatio: 0–1 of shell height (0 = hidden / top fullscreen).
     * includeInFloatArea: when true, floating containers may occupy the bottom strip.
     */
    bottomPanel: {
        color: "#2563eb",
        heightRatio: 0.25,
        includeInFloatArea: false,
    },
    /**
     * Stage fill behind floating panels.
     * Default is a blank white solid. Optional shader / image / video + FX stack.
     */
    background: null,
    bgCanvas: null,
    bgPostprocessCanvas: null,
    bgVideoEl: null,
    bgCtx: null,
    bgShaderRenderer: null,
    bgImage: null,
    bgPostprocessRenderer: null,
    bgVideoRaf: 0,
    /** Last now-playing payload (for ARTEF4KT overlay seed after mount) */
    lastNowPlaying: null,
};

/** Default bottom-panel settings (matches historical flex 1/4 blue strip). */
function defaultBottomPanel() {
    return {
        color: "#2563eb",
        heightRatio: 0.25,
        includeInFloatArea: false,
    };
}

const BG_MODES = new Set(["solid", "shader", "image", "video"]);
const BG_FIT_MODES = new Set(["fill", "scale", "tile"]);

/** Default stage fill: blank white solid, no FX. */
function defaultBackground() {
    return {
        mode: "solid",
        color: "#ffffff",
        shaderId: null,
        shaderPath: null,
        shaderUniforms: {},
        shaderModulators: {},
        shaderMeta: null,
        shader: null,
        imageSrc: null,
        imagePath: null,
        imageName: null,
        imageMode: "fill",
        videoSrc: null,
        videoPath: null,
        videoName: null,
        videoMode: "fill",
        videoLoop: true,
        videoMuted: true,
        postprocess: { active: false, layers: [], nextLayerId: 1 },
        mediaError: null,
    };
}

function ensureBackgroundState() {
    if (!scene.background || typeof scene.background !== "object") {
        scene.background = defaultBackground();
    }
    const bg = scene.background;
    if (!BG_MODES.has(bg.mode)) bg.mode = "solid";
    if (!bg.shaderUniforms || typeof bg.shaderUniforms !== "object") bg.shaderUniforms = {};
    if (!bg.shaderModulators || typeof bg.shaderModulators !== "object") bg.shaderModulators = {};
    if (!bg.postprocess || typeof bg.postprocess !== "object") {
        bg.postprocess = { active: false, layers: [], nextLayerId: 1 };
    }
    if (!Array.isArray(bg.postprocess.layers)) bg.postprocess.layers = [];
    if (!Number.isFinite(bg.postprocess.nextLayerId)) bg.postprocess.nextLayerId = 1;
    return bg;
}

function normalizeBgFit(mode, fallback = "fill") {
    const s = String(mode || "").toLowerCase();
    if (s === "fit") return "scale";
    return BG_FIT_MODES.has(s) ? s : fallback;
}

function localMediaUrl(filePath) {
    if (!filePath) return null;
    const raw = String(filePath);
    if (/^media:\/\//i.test(raw) || /^https?:\/\//i.test(raw) || /^data:/i.test(raw)) return raw;
    const normalized = raw.replace(/\\/g, "/");
    const withSlash = normalized.startsWith("/") ? normalized : `/${normalized}`;
    return `media://local${encodeURI(withSlash)}`;
}

function normalizeBackground(raw) {
    const base = defaultBackground();
    if (!raw || typeof raw !== "object") return base;
    const mode = BG_MODES.has(raw.mode) ? raw.mode : base.mode;
    const color = normalizeHexColor(raw.color, "#ffffff");
    const imageSrc = raw.imageSrc || (raw.imagePath ? localMediaUrl(raw.imagePath) : null);
    const videoSrc = raw.videoSrc || (raw.videoPath ? localMediaUrl(raw.videoPath) : null);
    const layers = Array.isArray(raw.postprocess?.layers) ? raw.postprocess.layers : [];
    return {
        mode,
        color,
        shaderId: raw.shaderId || raw.shaderPath || null,
        shaderPath: raw.shaderPath || null,
        shaderUniforms: sanitizeUniformMap(raw.shaderUniforms || {}),
        shaderModulators: sanitizeModulatorsMap(raw.shaderModulators),
        shaderMeta: null,
        shader: null,
        imageSrc: imageSrc || null,
        imagePath: raw.imagePath || null,
        imageName: raw.imageName || null,
        imageMode: normalizeBgFit(raw.imageMode, "fill"),
        videoSrc: videoSrc || null,
        videoPath: raw.videoPath || null,
        videoName: raw.videoName || null,
        videoMode: normalizeBgFit(raw.videoMode, "fill") === "tile" ? "fill" : normalizeBgFit(raw.videoMode, "fill"),
        videoLoop: raw.videoLoop !== false,
        videoMuted: raw.videoMuted !== false,
        postprocess: {
            active: !!(raw.postprocess && raw.postprocess.active && layers.length),
            layers: layers.map((l) => ({
                shaderId: l.shaderId || l.shaderPath || null,
                enabled: l.enabled !== false,
                uniforms: sanitizeUniformMap(l.uniforms || {}),
                modulators: sanitizeModulatorsMap(l.modulators),
            })),
            nextLayerId: 1,
        },
        mediaError: null,
    };
}

function normalizeHexColor(c, fallback = "#2563eb") {
    if (c == null || c === "") return fallback;
    const s = String(c).trim();
    if (/^#[0-9a-fA-F]{6}$/.test(s)) return s.toLowerCase();
    if (/^#[0-9a-fA-F]{3}$/.test(s)) {
        const r = s[1];
        const g = s[2];
        const b = s[3];
        return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
    }
    const m = s.match(/^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i);
    if (m) {
        const hex = (n) => Math.max(0, Math.min(255, Number(n))).toString(16).padStart(2, "0");
        return `#${hex(m[1])}${hex(m[2])}${hex(m[3])}`;
    }
    return fallback;
}

function normalizeHeightRatio(v, fallback = 0.25) {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(0, Math.min(1, n));
}

function getAppShell() {
    return document.querySelector(".app-shell");
}

function getBottomPanelEl() {
    return document.querySelector(".bottom-panel");
}

/** Authoring frame. All container layout is stored here and projected live. */
const DESIGN_SHELL_W = 1080;
const DESIGN_SHELL_H = 1920;
let applyingLayoutScale = false;
let lastShellLayout = { width: 0, height: 0 };
let shellReflowRaf = 0;

function getShellSize() {
    const shell = getAppShell();
    if (shell && shell.clientWidth > 0 && shell.clientHeight > 0) {
        return { width: shell.clientWidth, height: shell.clientHeight };
    }
    const slot = document.getElementById("stage-slot") || document.getElementById("stage-root");
    if (slot && slot.clientWidth > 0 && slot.clientHeight > 0) {
        return { width: slot.clientWidth, height: slot.clientHeight };
    }
    return {
        width: window.innerWidth || 400,
        height: window.innerHeight || 700,
    };
}

/** Bottom strip height in CSS pixels (0 when collapsed). */
function getDesignFloatSize() {
    const snap = typeof getBottomPanelSnapshot === "function"
        ? getBottomPanelSnapshot()
        : { heightRatio: 0, includeInFloatArea: false };
    const include = !!snap.includeInFloatArea;
    const ratio = normalizeHeightRatio(snap.heightRatio, 0);
    const height = include || ratio <= 0
        ? DESIGN_SHELL_H
        : Math.max(1, Math.round(DESIGN_SHELL_H * (1 - ratio)));
    return { width: DESIGN_SHELL_W, height };
}

/** Uniform scale from the 1080×1920 design frame onto the live float area. */
function getLayoutScale() {
    const live = getFloatAreaSize();
    const design = getDesignFloatSize();
    const sx = live.width / Math.max(1, design.width);
    const sy = live.height / Math.max(1, design.height);
    const s = Math.min(sx, sy);
    return Number.isFinite(s) && s > 1e-6 ? s : 1;
}

function livePx(designValue) {
    const n = Number(designValue);
    if (!Number.isFinite(n)) return 0;
    return n * getLayoutScale();
}

function liveFontSize(designValue, fallback = 12) {
    const n = Number(designValue);
    const d = Number.isFinite(n) && n > 0 ? n : fallback;
    return Math.max(1, livePx(d));
}

function liveLineWidth(designValue, fallback = 2) {
    const n = Number(designValue);
    const d = Number.isFinite(n) && n > 0 ? n : fallback;
    return Math.max(0.35, livePx(d));
}

function liveDash(dash) {
    if (!Array.isArray(dash) || !dash.length) return [];
    const s = getLayoutScale();
    return dash.map((v) => Math.max(0, Number(v) * s));
}

function normalizeIncomingScene(sceneData, opts) {
    const api = (typeof globalThis !== "undefined" && globalThis.musicViewLayoutSpace)
        || (typeof window !== "undefined" && window.musicViewLayoutSpace);
    if (api && typeof api.normalizeScene === "function") {
        return api.normalizeScene(sceneData, opts);
    }
    return sceneData;
}

function syncDesignFromLive(state) {
    if (applyingLayoutScale || !state) return;
    const s = getLayoutScale();
    state.layoutDesign = {
        left: (state.left || 0) / s,
        top: (state.top || 0) / s,
        width: Math.max(1, (state.width || 1) / s),
        height: Math.max(1, (state.height || 1) / s),
    };
}

function applyLiveFromDesign(state) {
    if (!state) return;
    if (!state.layoutDesign) syncDesignFromLive(state);
    const d = state.layoutDesign;
    if (!d) return;
    const s = getLayoutScale();
    applyingLayoutScale = true;
    try {
        setContainerSize(state, d.width * s, d.height * s);
        setContainerPosition(state, d.left * s, d.top * s);
    } finally {
        applyingLayoutScale = false;
    }
    applyContainerBoxStyle(state);
}

function getBottomHeightPx() {
    const { height } = getShellSize();
    const ratio = normalizeHeightRatio(scene.bottomPanel?.heightRatio, 0);
    return Math.round(ratio * height);
}

/**
 * Size of the white stage region (always above the bottom strip).
 * Used for #top-canvas bitmap size.
 */
function getStageWhiteSize() {
    const { width, height } = getShellSize();
    const bh = getBottomHeightPx();
    return {
        width: Math.max(1, width),
        height: Math.max(0, height - bh),
    };
}

/**
 * Bounds where floating containers may live (relative to top-panel).
 * When includeInFloatArea, this is the full shell; otherwise the white stage only.
 */
function getFloatAreaSize() {
    const { width, height } = getShellSize();
    const bh = getBottomHeightPx();
    const include = !!(scene.bottomPanel && scene.bottomPanel.includeInFloatArea);
    if (include || bh <= 0) {
        return { width: Math.max(1, width), height: Math.max(1, height) };
    }
    return {
        width: Math.max(1, width),
        height: Math.max(1, height - bh),
    };
}

function getBottomPanelSnapshot() {
    const bp = scene.bottomPanel || defaultBottomPanel();
    return {
        color: normalizeHexColor(bp.color),
        heightRatio: normalizeHeightRatio(bp.heightRatio),
        includeInFloatArea: !!bp.includeInFloatArea,
    };
}

/**
 * Apply bottom-panel CSS layout and re-sync float host size.
 * Does not redraw; caller should resize canvases / clamp / redraw as needed.
 */
function applyBottomPanelLayout() {
    const shell = getAppShell();
    const topPanel = scene.topPanel || document.querySelector(".top-panel");
    const bottom = getBottomPanelEl();
    if (!shell || !topPanel) return;

    const snap = getBottomPanelSnapshot();
    scene.bottomPanel = snap;

    const bh = getBottomHeightPx();
    shell.style.setProperty("--bottom-height", `${bh}px`);
    shell.style.setProperty("--bottom-color", snap.color);
    shell.classList.toggle("float-includes-bottom", !!snap.includeInFloatArea);

    if (bottom) {
        bottom.style.background = snap.color;
        bottom.classList.toggle("is-collapsed", bh <= 0);
        if (bh <= 0) {
            bottom.style.height = "0px";
        } else {
            bottom.style.height = `${bh}px`;
        }
    }

    // Float host: full shell when floats may enter the strip (or strip is gone)
    if (snap.includeInFloatArea || bh <= 0) {
        topPanel.style.height = "100%";
    } else {
        topPanel.style.height = `calc(100% - ${bh}px)`;
    }
}

/**
 * Patch bottom-panel settings, reflow layout, clamp floats, redraw.
 * @param {object} patch
 */
function updateBottomPanel(patch = {}) {
    const cur = getBottomPanelSnapshot();
    if ("color" in patch) cur.color = normalizeHexColor(patch.color, cur.color);
    if ("heightRatio" in patch) cur.heightRatio = normalizeHeightRatio(patch.heightRatio, cur.heightRatio);
    // Accept heightPercent 0–100 as alternate
    if ("heightPercent" in patch && !("heightRatio" in patch)) {
        cur.heightRatio = normalizeHeightRatio(Number(patch.heightPercent) / 100, cur.heightRatio);
    }
    if ("includeInFloatArea" in patch) {
        cur.includeInFloatArea = !!patch.includeInFloatArea;
    }
    scene.bottomPanel = cur;
    applyBottomPanelLayout();

    // Keep floating boxes inside the (possibly new) float area
    for (const c of scene.containers) {
        clampContainerInPanel(c);
    }

    // Resize bitmaps to match new stage / shell geometry
    if (typeof window.__musicViewResizeCanvases === "function") {
        window.__musicViewResizeCanvases();
    }

    if (scene.redraw) scene.redraw();
    else publishSceneState();

    return getBottomPanelSnapshot();
}

// ── Stage background (solid / shader / image / video + optional FX) ──────

function getBackgroundSnapshot() {
    const bg = ensureBackgroundState();
    const layers = (bg.postprocess.layers || []).map((l, index) => ({
        id: l.id,
        index,
        shaderId: l.shaderId || null,
        shaderPath: l.shaderPath || null,
        shaderMeta: l.shaderMeta || null,
        uniforms: Object.assign({}, l.uniforms || {}),
        modulators: cloneModulators(l.modulators),
        enabled: l.enabled !== false,
    }));
    return {
        mode: bg.mode || "solid",
        color: normalizeHexColor(bg.color, "#ffffff"),
        shaderId: bg.shaderId || null,
        shaderPath: bg.shaderPath || null,
        shaderMeta: bg.shaderMeta || null,
        shaderUniforms: Object.assign({}, bg.shaderUniforms || {}),
        shaderModulators: cloneModulators(bg.shaderModulators),
        hasShader: !!(bg.shaderId && scene.bgShaderRenderer),
        imageSrc: bg.imageSrc || null,
        imagePath: bg.imagePath || null,
        imageName: bg.imageName || null,
        imageMode: normalizeBgFit(bg.imageMode, "fill"),
        hasImage: !!(bg.imageSrc && scene.bgImage),
        videoSrc: bg.videoSrc || null,
        videoPath: bg.videoPath || null,
        videoName: bg.videoName || null,
        videoMode: normalizeBgFit(bg.videoMode, "fill") === "tile" ? "fill" : normalizeBgFit(bg.videoMode, "fill"),
        videoLoop: bg.videoLoop !== false,
        videoMuted: bg.videoMuted !== false,
        hasVideo: !!(bg.videoSrc && scene.bgVideoEl && scene.bgVideoEl.src),
        mediaError: bg.mediaError || null,
        postprocess: {
            active: !!(bg.postprocess.active && scene.bgPostprocessRenderer
                && layers.some((l) => l.enabled !== false && l.shaderId)),
            layers,
        },
    };
}

function exportBackgroundForPreset() {
    const bg = ensureBackgroundState();
    const out = {
        mode: bg.mode || "solid",
        color: normalizeHexColor(bg.color, "#ffffff"),
        imageMode: normalizeBgFit(bg.imageMode, "fill"),
        videoMode: normalizeBgFit(bg.videoMode, "fill") === "tile" ? "fill" : normalizeBgFit(bg.videoMode, "fill"),
        videoLoop: bg.videoLoop !== false,
        videoMuted: bg.videoMuted !== false,
    };
    if (bg.mode === "shader" && bg.shaderId) {
        out.shaderId = bg.shaderId;
        out.shaderUniforms = sanitizeUniformMap(bg.shaderUniforms || {});
        const mods = exportModulatorsMap(bg.shaderModulators);
        if (Object.keys(mods).length) out.shaderModulators = mods;
    }
    if (bg.imageSrc || bg.imagePath) {
        out.imageSrc = bg.imageSrc || null;
        out.imagePath = bg.imagePath || null;
        out.imageName = bg.imageName || null;
    }
    if (bg.videoSrc || bg.videoPath) {
        out.videoSrc = bg.videoSrc || null;
        out.videoPath = bg.videoPath || null;
        out.videoName = bg.videoName || null;
    }
    const layers = (bg.postprocess.layers || []).filter((l) => l.shaderId || l.shaderPath);
    if (layers.length) {
        out.postprocess = {
            active: bg.postprocess.active !== false,
            layers: layers.map((l) => {
                const le = {
                    shaderId: l.shaderId,
                    enabled: l.enabled !== false,
                    uniforms: sanitizeUniformMap(l.uniforms),
                };
                const mods = exportModulatorsMap(l.modulators);
                if (Object.keys(mods).length) le.modulators = mods;
                return le;
            }),
        };
    }
    return out;
}

function mediaDrawSize(media) {
    if (!media) return { w: 0, h: 0 };
    const w = media.videoWidth || media.naturalWidth || media.width || 0;
    const h = media.videoHeight || media.naturalHeight || media.height || 0;
    return { w, h };
}

function paintFittedMedia(ctx, media, w, h, mode) {
    if (!ctx || !media) return;
    const { w: mw, h: mh } = mediaDrawSize(media);
    if (!mw || !mh) return;
    const fit = normalizeBgFit(mode, "fill");
    if (fit === "tile") {
        try {
            const pat = ctx.createPattern(media, "repeat");
            if (pat) {
                ctx.fillStyle = pat;
                ctx.fillRect(0, 0, w, h);
                return;
            }
        } catch (_) { /* fall through */ }
    }
    const canvasAspect = w / Math.max(1, h);
    const mediaAspect = mw / mh;
    if (fit === "fill") {
        if (mediaAspect > canvasAspect) {
            const sw = mh * canvasAspect;
            const sx = (mw - sw) / 2;
            ctx.drawImage(media, sx, 0, sw, mh, 0, 0, w, h);
        } else {
            const sh = mw / canvasAspect;
            const sy = (mh - sh) / 2;
            ctx.drawImage(media, 0, sy, mw, sh, 0, 0, w, h);
        }
        return;
    }
    const scale = Math.min(w / mw, h / mh);
    const dw = mw * scale;
    const dh = mh * scale;
    ctx.drawImage(media, 0, 0, mw, mh, (w - dw) / 2, (h - dh) / 2, dw, dh);
}

function tryGet2dContext(canvas) {
    if (!canvas) return null;
    try {
        return canvas.getContext("2d");
    } catch (_) {
        return null;
    }
}

function replaceBgCanvas() {
    const old = scene.bgCanvas;
    const next = document.createElement("canvas");
    next.id = "bg-canvas";
    if (old) {
        next.style.cssText = old.style.cssText;
        if (old.parentNode) old.replaceWith(next);
        else {
            const top = scene.topPanel || document.querySelector(".top-panel");
            if (top) top.insertBefore(next, top.firstChild);
        }
    }
    scene.bgCanvas = next;
    scene.bgCtx = null;
    return next;
}

/** Tear down a live fill shader. WebGL canvases cannot become 2D — always replace. */
function teardownBackgroundShaderRuntime() {
    const hadShader = !!scene.bgShaderRenderer;
    if (scene.bgShaderRenderer) {
        try { scene.bgShaderRenderer.stop(); } catch (_) { /* ignore */ }
        try { scene.bgShaderRenderer.destroy(); } catch (_) { /* ignore */ }
        scene.bgShaderRenderer = null;
    }
    if (hadShader) replaceBgCanvas();
}

function ensureBgCanvas2D() {
    teardownBackgroundShaderRuntime();
    if (!scene.bgCanvas) {
        scene.bgCanvas = document.getElementById("bg-canvas");
    }
    if (!scene.bgCanvas) return null;
    if (scene.bgCtx) return scene.bgCanvas;
    const ctx = tryGet2dContext(scene.bgCanvas);
    if (ctx) {
        scene.bgCtx = ctx;
        return scene.bgCanvas;
    }
    replaceBgCanvas();
    scene.bgCtx = tryGet2dContext(scene.bgCanvas);
    return scene.bgCanvas;
}

function ensureBgCanvasWebGL() {
    if (scene.bgCtx || !scene.bgCanvas) {
        if (scene.bgShaderRenderer) {
            try { scene.bgShaderRenderer.destroy(); } catch (_) { /* ignore */ }
            scene.bgShaderRenderer = null;
        }
        replaceBgCanvas();
    }
    return scene.bgCanvas;
}

function layoutBackgroundCanvases() {
    const stage = getStageWhiteSize();
    const cssW = Math.max(1, stage.width);
    const cssH = Math.max(1, stage.height);
    const applyBox = (el) => {
        if (!el) return;
        el.style.position = "absolute";
        el.style.left = "0";
        el.style.top = "0";
        el.style.right = "auto";
        el.style.bottom = "auto";
        el.style.width = `${cssW}px`;
        el.style.height = `${cssH}px`;
        el.style.pointerEvents = "none";
        el.style.zIndex = "0";
    };
    applyBox(scene.bgCanvas);
    applyBox(scene.bgPostprocessCanvas);
    const bgFade = document.getElementById("bg-transition-overlay");
    if (bgFade) {
        applyBox(bgFade);
        bgFade.style.zIndex = "1";
    }
    if (scene.bgCanvas && scene.bgCtx) {
        const bw = Math.max(1, Math.round(cssW));
        const bh = Math.max(1, Math.round(cssH));
        if (scene.bgCanvas.width !== bw || scene.bgCanvas.height !== bh) {
            scene.bgCanvas.width = bw;
            scene.bgCanvas.height = bh;
        }
        paintBackgroundSource();
    } else if (scene.bgShaderRenderer && typeof scene.bgShaderRenderer.render === "function") {
        try { scene.bgShaderRenderer.render(); } catch (_) { /* ignore */ }
    }
    if (scene.bgPostprocessRenderer && typeof scene.bgPostprocessRenderer.render === "function"
        && backgroundPostprocessIsLive()) {
        try { scene.bgPostprocessRenderer.render(); } catch (_) { /* ignore */ }
    }
}

function paintBackgroundSource() {
    const bg = ensureBackgroundState();
    if (bg.mode === "shader" && scene.bgShaderRenderer) return;
    // Shader mode without a live renderer must still cover the stage.
    const canvas = ensureBgCanvas2D();
    const ctx = scene.bgCtx;
    if (!canvas || !ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (bg.mode === "image" && scene.bgImage) {
        paintFittedMedia(ctx, scene.bgImage, w, h, bg.imageMode);
        return;
    }
    if (bg.mode === "video" && scene.bgVideoEl
        && scene.bgVideoEl.readyState >= 2) {
        paintFittedMedia(ctx, scene.bgVideoEl, w, h, bg.videoMode);
        return;
    }
    ctx.fillStyle = normalizeHexColor(bg.color, "#ffffff");
    ctx.fillRect(0, 0, w, h);
}

function stopBackgroundVideoLoop() {
    if (scene.bgVideoRaf) {
        cancelAnimationFrame(scene.bgVideoRaf);
        scene.bgVideoRaf = 0;
    }
}

function startBackgroundVideoLoop() {
    stopBackgroundVideoLoop();
    const shouldRender = typeof createRenderFrameGate === "function"
        ? createRenderFrameGate()
        : () => true;
    const tick = (now) => {
        const bg = scene.background;
        if (!bg || bg.mode !== "video") {
            scene.bgVideoRaf = 0;
            return;
        }
        if (shouldRender(now)) {
            paintBackgroundSource();
            if (scene.bgPostprocessRenderer && backgroundPostprocessIsLive()
                && typeof scene.bgPostprocessRenderer.render === "function") {
                try { scene.bgPostprocessRenderer.render(); } catch (_) { /* ignore */ }
            }
        }
        scene.bgVideoRaf = requestAnimationFrame(tick);
    };
    scene.bgVideoRaf = requestAnimationFrame(tick);
}

function pauseBackgroundVideo() {
    stopBackgroundVideoLoop();
    const el = scene.bgVideoEl;
    if (el) {
        try { el.pause(); } catch (_) { /* ignore */ }
    }
}

function playBackgroundVideo() {
    const bg = ensureBackgroundState();
    const el = scene.bgVideoEl;
    if (!el || !bg.videoSrc) return;
    el.loop = bg.videoLoop !== false;
    el.muted = bg.videoMuted !== false;
    const play = el.play();
    if (play && typeof play.catch === "function") {
        play.catch((e) => {
            console.warn("Background video play failed", e);
        });
    }
    startBackgroundVideoLoop();
}

function clearBackgroundImage() {
    const bg = ensureBackgroundState();
    bg.imageSrc = null;
    bg.imagePath = null;
    bg.imageName = null;
    scene.bgImage = null;
}

function clearBackgroundVideo() {
    const bg = ensureBackgroundState();
    bg.videoSrc = null;
    bg.videoPath = null;
    bg.videoName = null;
    pauseBackgroundVideo();
    if (scene.bgVideoEl) {
        try {
            scene.bgVideoEl.removeAttribute("src");
            scene.bgVideoEl.load();
        } catch (_) { /* ignore */ }
    }
}

function loadBackgroundImage(src) {
    return new Promise((resolve) => {
        if (!src) {
            scene.bgImage = null;
            resolve(false);
            return;
        }
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
            scene.bgImage = img;
            const bg = ensureBackgroundState();
            bg.mediaError = null;
            if (bg.mode === "image") paintBackgroundSource();
            resolve(true);
        };
        img.onerror = () => {
            scene.bgImage = null;
            ensureBackgroundState().mediaError = "Failed to load image";
            console.warn("Failed to load background image:", src);
            resolve(false);
        };
        img.src = src;
    });
}

function loadBackgroundVideo(src) {
    return new Promise((resolve) => {
        const el = scene.bgVideoEl || document.getElementById("bg-video");
        scene.bgVideoEl = el;
        if (!el || !src) {
            resolve(false);
            return;
        }
        const bg = ensureBackgroundState();
        const onReady = () => {
            el.removeEventListener("loadeddata", onReady);
            el.removeEventListener("error", onErr);
            bg.mediaError = null;
            if (bg.mode === "video") playBackgroundVideo();
            resolve(true);
        };
        const onErr = () => {
            el.removeEventListener("loadeddata", onReady);
            el.removeEventListener("error", onErr);
            bg.mediaError = "Failed to load video";
            console.warn("Failed to load background video:", src);
            resolve(false);
        };
        el.addEventListener("loadeddata", onReady);
        el.addEventListener("error", onErr);
        el.crossOrigin = "anonymous";
        el.muted = bg.videoMuted !== false;
        el.loop = bg.videoLoop !== false;
        el.playsInline = true;
        el.src = src;
        try { el.load(); } catch (_) { /* ignore */ }
    });
}

function destroyBackgroundShader() {
    teardownBackgroundShaderRuntime();
}

function clearBackgroundShader() {
    const bg = ensureBackgroundState();
    teardownBackgroundShaderRuntime();
    bg.shader = null;
    bg.shaderId = null;
    bg.shaderPath = null;
    bg.shaderMeta = null;
    bg.shaderUniforms = {};
    bg.shaderModulators = {};
    if (bg.mode === "shader") bg.mode = "solid";
    ensureBgCanvas2D();
    paintBackgroundSource();
}

async function applyBackgroundShader(idOrPath, uniformsOverride = null) {
    const bg = ensureBackgroundState();
    const pkg = await loadShaderPackage(idOrPath);
    const defaults = defaultsFromControls(pkg.uniforms);
    const uniforms = Object.assign({}, defaults, uniformsOverride || bg.shaderUniforms || {});
    const sameLive = !!(
        scene.bgShaderRenderer
        && bg.shader
        && bg.shaderId
        && bg.shaderId === pkg.id
    );
    bg.shaderId = pkg.id;
    bg.shaderPath = pkg.fragPath;
    bg.shaderMeta = packageToClientMeta(pkg);
    bg.shaderUniforms = Object.assign({}, uniforms);
    if (sameLive) {
        if (typeof scene.bgShaderRenderer.setUniforms === "function") {
            scene.bgShaderRenderer.setUniforms(bg.shaderUniforms);
        }
        if (typeof scene.bgShaderRenderer.setBoundsByName === "function") {
            scene.bgShaderRenderer.setBoundsByName(boundsFromShaderMeta(bg.shaderMeta));
        }
        if (typeof scene.bgShaderRenderer.render === "function") {
            try { scene.bgShaderRenderer.render(); } catch (_) { /* ignore */ }
        }
        return pkg;
    }
    bg.shaderModulators = {};
    teardownBackgroundShaderRuntime();
    layoutBackgroundCanvases();
    const canvas = ensureBgCanvasWebGL();
    if (!canvas) throw new Error("Background canvas missing");
    if (canvas.width === 0 || canvas.height === 0) {
        canvas.width = canvas.clientWidth || 1;
        canvas.height = canvas.clientHeight || 1;
    }
    bg.shader = pkg.source;
    scene.bgShaderRenderer = createShaderRenderer(canvas, pkg.source, bg.shaderUniforms, {
        modulators: bg.shaderModulators,
        boundsByName: boundsFromShaderMeta(bg.shaderMeta),
    });
    scene.bgCtx = null;
    if (bg.mode === "shader") scene.bgShaderRenderer.start();
    return pkg;
}

function updateBackgroundUniforms(uniforms) {
    const bg = ensureBackgroundState();
    bg.shaderUniforms = Object.assign({}, bg.shaderUniforms || {}, uniforms || {});
    if (scene.bgShaderRenderer) {
        scene.bgShaderRenderer.setUniforms(bg.shaderUniforms);
    }
}

function updateBackgroundModulators(modulators) {
    const bg = ensureBackgroundState();
    if (!bg.shaderModulators || typeof bg.shaderModulators !== "object") {
        bg.shaderModulators = {};
    }
    if (modulators == null) {
        bg.shaderModulators = {};
    } else if (typeof modulators === "object") {
        for (const k of Object.keys(modulators)) {
            const v = modulators[k];
            if (v == null) {
                delete bg.shaderModulators[k];
                continue;
            }
            if (typeof v !== "object") continue;
            const src = String(v.source != null ? v.source : (bg.shaderModulators[k]?.source || "")).toLowerCase();
            if (v.source != null && (src === "static" || src === "")) {
                delete bg.shaderModulators[k];
                continue;
            }
            const merged = Object.assign({}, bg.shaderModulators[k] || {}, v);
            const s = sanitizeModulatorSpec(merged);
            if (s) bg.shaderModulators[k] = s;
            else delete bg.shaderModulators[k];
        }
    }
    bg.shaderModulators = sanitizeModulatorsMap(bg.shaderModulators);
    if (scene.bgShaderRenderer?.setModulators) {
        scene.bgShaderRenderer.setModulators(bg.shaderModulators);
    }
}

function syncBackgroundSourcePlayback() {
    const bg = ensureBackgroundState();
    if (bg.mode === "shader" && bg.shaderId) {
        pauseBackgroundVideo();
        if (scene.bgShaderRenderer && typeof scene.bgShaderRenderer.start === "function") {
            scene.bgShaderRenderer.start();
        } else if (bg.shaderId && !scene.bgShaderRenderer) {
            applyBackgroundShader(bg.shaderId, bg.shaderUniforms).catch((e) => {
                console.warn("Background shader start failed", e);
            });
        }
        return;
    }
    // Leaving shader mode: destroy + replace the WebGL canvas or the last
    // frame stays on screen (a WebGL canvas cannot gain a 2D context).
    teardownBackgroundShaderRuntime();
    if (bg.mode === "video" && bg.videoSrc) {
        ensureBgCanvas2D();
        playBackgroundVideo();
        return;
    }
    pauseBackgroundVideo();
    ensureBgCanvas2D();
    paintBackgroundSource();
}

async function setBackgroundMode(mode) {
    const bg = ensureBackgroundState();
    const next = BG_MODES.has(mode) ? mode : "solid";
    bg.mode = next;
    if (next === "shader" && !bg.shaderId) {
        // Stay visually solid until a package is applied
        pauseBackgroundVideo();
        teardownBackgroundShaderRuntime();
        ensureBgCanvas2D();
        paintBackgroundSource();
        return;
    }
    if (next === "image" && bg.imageSrc && !scene.bgImage) {
        await loadBackgroundImage(bg.imageSrc);
    }
    if (next === "video" && bg.videoSrc && !(scene.bgVideoEl && scene.bgVideoEl.src)) {
        await loadBackgroundVideo(bg.videoSrc);
    }
    syncBackgroundSourcePlayback();
}

function updateBackgroundSettings(patch = {}) {
    const bg = ensureBackgroundState();
    let modeDirty = false;
    if ("color" in patch) bg.color = normalizeHexColor(patch.color, bg.color || "#ffffff");
    if ("imageMode" in patch) bg.imageMode = normalizeBgFit(patch.imageMode, bg.imageMode);
    if ("videoMode" in patch) {
        const fit = normalizeBgFit(patch.videoMode, bg.videoMode);
        bg.videoMode = fit === "tile" ? "fill" : fit;
    }
    if ("videoLoop" in patch) {
        bg.videoLoop = !!patch.videoLoop;
        if (scene.bgVideoEl) scene.bgVideoEl.loop = bg.videoLoop;
    }
    if ("videoMuted" in patch) {
        bg.videoMuted = patch.videoMuted !== false;
        if (scene.bgVideoEl) scene.bgVideoEl.muted = bg.videoMuted;
    }
    if ("mode" in patch && patch.mode != null) {
        const next = BG_MODES.has(patch.mode) ? patch.mode : bg.mode;
        if (next !== bg.mode) modeDirty = true;
        bg.mode = next;
    }
    if (modeDirty) {
        setBackgroundMode(bg.mode);
    } else {
        syncBackgroundSourcePlayback();
    }
    return getBackgroundSnapshot();
}

function backgroundPostprocessHasEnabledLayers() {
    const bg = ensureBackgroundState();
    return (bg.postprocess.layers || []).some(
        (l) => l.enabled !== false && (l.shaderId || l.shaderPath || l._inlineSource),
    );
}

function backgroundPostprocessIsLive() {
    const bg = ensureBackgroundState();
    return !!(
        bg.postprocess.active
        && scene.bgPostprocessRenderer
        && backgroundPostprocessHasEnabledLayers()
    );
}

function syncBackgroundPostprocessVisibility() {
    const live = backgroundPostprocessIsLive();
    if (scene.bgPostprocessCanvas) {
        scene.bgPostprocessCanvas.classList.toggle("is-live", live);
        scene.bgPostprocessCanvas.style.display = live ? "block" : "none";
    }
}

function captureBackgroundContentToCanvas(dest) {
    if (!dest) return;
    const stage = getStageWhiteSize();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, stage.width);
    const h = Math.max(1, stage.height);
    const outW = Math.max(1, Math.floor(w * dpr));
    const outH = Math.max(1, Math.floor(h * dpr));
    if (dest.width !== outW || dest.height !== outH) {
        dest.width = outW;
        dest.height = outH;
    }
    const ctx = dest.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, outW, outH);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const src = scene.bgCanvas;
    if (src && src.width > 0 && src.height > 0) {
        try {
            ctx.drawImage(src, 0, 0, w, h);
            return;
        } catch (_) { /* fall through */ }
    }
    ctx.fillStyle = normalizeHexColor(ensureBackgroundState().color, "#ffffff");
    ctx.fillRect(0, 0, w, h);
}

async function rebuildBackgroundPostprocessStack() {
    const bg = ensureBackgroundState();
    const canvas = scene.bgPostprocessCanvas || document.getElementById("bg-postprocess-canvas");
    scene.bgPostprocessCanvas = canvas;
    if (!canvas) return;
    const pp = bg.postprocess;
    const stackDefs = [];
    for (const layer of pp.layers) {
        if (!layer.shaderId && !layer.shaderPath && !layer._inlineSource) continue;
        try {
            if (layer._inlineSource) {
                stackDefs.push({
                    key: String(layer.id),
                    fragSource: layer._inlineSource,
                    uniforms: layer.uniforms || {},
                    modulators: sanitizeModulatorsMap(layer.modulators),
                    boundsByName: boundsFromShaderMeta(layer.shaderMeta),
                    enabled: layer.enabled !== false,
                });
                continue;
            }
            const pkg = await loadShaderPackage(layer.shaderId || layer.shaderPath);
            layer.shaderId = pkg.id;
            layer.shaderPath = pkg.fragPath;
            layer.shaderMeta = packageToClientMeta(pkg);
            const defaults = defaultsFromControls(pkg.uniforms);
            layer.uniforms = Object.assign({}, defaults, layer.uniforms || {});
            layer.modulators = sanitizeModulatorsMap(layer.modulators);
            stackDefs.push({
                key: String(layer.id),
                fragSource: pkg.source,
                uniforms: layer.uniforms,
                modulators: layer.modulators,
                boundsByName: boundsFromShaderMeta(layer.shaderMeta),
                enabled: layer.enabled !== false,
            });
        } catch (e) {
            console.warn("Skipping background postprocess layer", layer.id, e);
        }
    }
    const nextKey = postprocessTopologyKey(pp.layers);
    if (scene.bgPostprocessRenderer && scene._bgPpTopologyKey === nextKey) {
        applyDefsToLiveStack(scene.bgPostprocessRenderer, stackDefs);
        if (pp.active) scene.bgPostprocessRenderer.start();
        syncBackgroundPostprocessVisibility();
        return;
    }
    const keepTime = scene.bgPostprocessRenderer && typeof scene.bgPostprocessRenderer.getTime === "function"
        ? scene.bgPostprocessRenderer.getTime()
        : null;
    if (scene.bgPostprocessRenderer) {
        try { scene.bgPostprocessRenderer.destroy(); } catch (_) { /* ignore */ }
        scene.bgPostprocessRenderer = null;
    }
    if (!stackDefs.length) {
        scene._bgPpTopologyKey = nextKey;
        syncBackgroundPostprocessVisibility();
        return;
    }
    try {
        scene.bgPostprocessRenderer = createPostprocessStack(
            canvas,
            stackDefs,
            captureBackgroundContentToCanvas,
        );
        scene._bgPpTopologyKey = nextKey;
        if (keepTime != null && typeof scene.bgPostprocessRenderer.setTime === "function") {
            scene.bgPostprocessRenderer.setTime(keepTime);
        }
    } catch (e) {
        console.warn("Failed to create background postprocess stack", e);
        scene.bgPostprocessRenderer = null;
        syncBackgroundPostprocessVisibility();
        return;
    }
    if (pp.active) scene.bgPostprocessRenderer.start();
    syncBackgroundPostprocessVisibility();
}

function startBackgroundPostprocess() {
    const bg = ensureBackgroundState();
    bg.postprocess.active = true;
    if (!scene.bgPostprocessRenderer) {
        rebuildBackgroundPostprocessStack().catch((e) => {
            console.warn("rebuildBackgroundPostprocessStack failed", e);
        });
        return;
    }
    scene.bgPostprocessRenderer.start();
    syncBackgroundPostprocessVisibility();
}

function stopBackgroundPostprocess() {
    const bg = ensureBackgroundState();
    bg.postprocess.active = false;
    if (scene.bgPostprocessRenderer) {
        try { scene.bgPostprocessRenderer.stop(); } catch (_) { /* ignore */ }
    }
    syncBackgroundPostprocessVisibility();
}

function nextBackgroundPostprocessLayerId() {
    const pp = ensureBackgroundState().postprocess;
    return pp.nextLayerId++;
}

function findBackgroundPostprocessLayer(id) {
    const pp = ensureBackgroundState().postprocess;
    return pp.layers.find((l) => l.id === Number(id)) || null;
}

async function addBackgroundPostprocessLayer(idOrPath, opts = {}) {
    const bg = ensureBackgroundState();
    const pkg = await loadShaderPackage(idOrPath);
    const uniforms = Object.assign(
        {},
        defaultsFromControls(pkg.uniforms),
        opts.uniforms || {},
    );
    const layer = {
        id: nextBackgroundPostprocessLayerId(),
        shaderId: pkg.id,
        shaderPath: pkg.fragPath,
        shaderMeta: packageToClientMeta(pkg),
        uniforms,
        modulators: sanitizeModulatorsMap(opts.modulators),
        enabled: opts.enabled !== false,
    };
    const idx = opts.index;
    if (typeof idx === "number" && idx >= 0 && idx < bg.postprocess.layers.length) {
        bg.postprocess.layers.splice(idx, 0, layer);
    } else {
        bg.postprocess.layers.push(layer);
    }
    if (opts.rebuild !== false) {
        await rebuildBackgroundPostprocessStack();
        if (bg.postprocess.active) startBackgroundPostprocess();
    }
    return layer;
}

async function removeBackgroundPostprocessLayer(id) {
    const pp = ensureBackgroundState().postprocess;
    const before = pp.layers.length;
    pp.layers = pp.layers.filter((l) => l.id !== Number(id));
    if (pp.layers.length !== before) {
        await rebuildBackgroundPostprocessStack();
        if (pp.active && pp.layers.length) startBackgroundPostprocess();
        else if (!pp.layers.length) syncBackgroundPostprocessVisibility();
        return true;
    }
    return false;
}

async function reorderBackgroundPostprocessLayers(orderedIds) {
    const pp = ensureBackgroundState().postprocess;
    const ids = (Array.isArray(orderedIds) ? orderedIds : []).map(Number);
    const byId = new Map(pp.layers.map((l) => [l.id, l]));
    const next = [];
    for (const id of ids) {
        const layer = byId.get(id);
        if (layer) {
            next.push(layer);
            byId.delete(id);
        }
    }
    for (const layer of byId.values()) next.push(layer);
    pp.layers = next;
    await rebuildBackgroundPostprocessStack();
    if (pp.active) startBackgroundPostprocess();
}

async function moveBackgroundPostprocessLayer(id, toIndex) {
    const pp = ensureBackgroundState().postprocess;
    const from = pp.layers.findIndex((l) => l.id === Number(id));
    if (from < 0) return false;
    const [layer] = pp.layers.splice(from, 1);
    const to = Math.max(0, Math.min(pp.layers.length, Number(toIndex) || 0));
    pp.layers.splice(to, 0, layer);
    await rebuildBackgroundPostprocessStack();
    if (pp.active) startBackgroundPostprocess();
    return true;
}

async function setBackgroundPostprocessLayerShader(id, idOrPath, uniformsOverride = null) {
    const layer = findBackgroundPostprocessLayer(id);
    if (!layer) throw new Error("Layer not found");
    const pkg = await loadShaderPackage(idOrPath);
    layer.shaderId = pkg.id;
    layer.shaderPath = pkg.fragPath;
    layer.shaderMeta = packageToClientMeta(pkg);
    layer.uniforms = Object.assign(
        {},
        defaultsFromControls(pkg.uniforms),
        uniformsOverride != null ? uniformsOverride : (layer.uniforms || {}),
    );
    layer.modulators = {};
    delete layer._inlineSource;
    await rebuildBackgroundPostprocessStack();
    if (ensureBackgroundState().postprocess.active) startBackgroundPostprocess();
    return layer;
}

function updateBackgroundPostprocessLayerUniforms(id, uniforms) {
    const layer = findBackgroundPostprocessLayer(id);
    if (!layer) return;
    layer.uniforms = Object.assign({}, layer.uniforms || {}, uniforms || {});
    if (scene.bgPostprocessRenderer) {
        scene.bgPostprocessRenderer.setLayerUniforms(String(layer.id), layer.uniforms);
    }
}

function updateBackgroundPostprocessLayerModulators(id, modulators) {
    const layer = findBackgroundPostprocessLayer(id);
    if (!layer) return;
    if (!layer.modulators || typeof layer.modulators !== "object") layer.modulators = {};
    if (modulators == null) {
        layer.modulators = {};
    } else if (typeof modulators === "object") {
        for (const k of Object.keys(modulators)) {
            const v = modulators[k];
            if (v == null) {
                delete layer.modulators[k];
                continue;
            }
            if (typeof v !== "object") continue;
            const src = String(v.source != null ? v.source : (layer.modulators[k]?.source || "")).toLowerCase();
            if (v.source != null && (src === "static" || src === "")) {
                delete layer.modulators[k];
                continue;
            }
            const merged = Object.assign({}, layer.modulators[k] || {}, v);
            const s = sanitizeModulatorSpec(merged);
            if (s) layer.modulators[k] = s;
            else delete layer.modulators[k];
        }
    }
    layer.modulators = sanitizeModulatorsMap(layer.modulators);
    if (scene.bgPostprocessRenderer?.setLayerModulators) {
        scene.bgPostprocessRenderer.setLayerModulators(String(layer.id), layer.modulators);
    }
}

function setBackgroundPostprocessLayerEnabled(id, enabled) {
    const layer = findBackgroundPostprocessLayer(id);
    if (!layer) return;
    layer.enabled = !!enabled;
    if (scene.bgPostprocessRenderer) {
        scene.bgPostprocessRenderer.setLayerEnabled(String(layer.id), layer.enabled);
    }
    syncBackgroundPostprocessVisibility();
}

async function setBackgroundPostprocessStack(layersSpec, { active } = {}) {
    const bg = ensureBackgroundState();
    const list = Array.isArray(layersSpec) ? layersSpec : [];
    const live = bg.postprocess.layers || [];
    if (live.length === list.length && live.length > 0
        && shaderSeqKey(live) === shaderSeqKey(list)
        && scene.bgPostprocessRenderer) {
        for (let i = 0; i < live.length; i++) {
            const entry = list[i];
            live[i].uniforms = Object.assign({}, live[i].uniforms || {}, sanitizeUniformMap(entry.uniforms || {}));
            live[i].modulators = sanitizeModulatorsMap(entry.modulators);
            live[i].enabled = entry.enabled !== false;
        }
        if (active != null) bg.postprocess.active = !!active;
        await rebuildBackgroundPostprocessStack();
        if (bg.postprocess.active) startBackgroundPostprocess();
        else stopBackgroundPostprocess();
        return;
    }
    bg.postprocess.layers = [];
    bg.postprocess.nextLayerId = 1;
    for (const entry of list) {
        await addBackgroundPostprocessLayer(entry.shaderId || entry.shaderPath || "lcd", {
            uniforms: entry.uniforms,
            modulators: entry.modulators,
            enabled: entry.enabled !== false,
            rebuild: false,
        });
        if (entry.id != null) {
            const last = bg.postprocess.layers[bg.postprocess.layers.length - 1];
            if (last) last.id = Number(entry.id);
            bg.postprocess.nextLayerId = Math.max(bg.postprocess.nextLayerId, Number(entry.id) + 1);
        }
    }
    if (active != null) bg.postprocess.active = !!active;
    await rebuildBackgroundPostprocessStack();
    if (bg.postprocess.active) startBackgroundPostprocess();
    else stopBackgroundPostprocess();
}

function drawBackgroundIntoCapture(ctx, x, y, w, h) {
    if (w <= 0 || h <= 0) return;
    if (backgroundPostprocessIsLive() && scene.bgPostprocessCanvas
        && scene.bgPostprocessCanvas.width > 0 && scene.bgPostprocessCanvas.height > 0) {
        try {
            ctx.drawImage(scene.bgPostprocessCanvas, x, y, w, h);
            return;
        } catch (_) { /* fall through */ }
    }
    if (scene.bgCanvas && scene.bgCanvas.width > 0 && scene.bgCanvas.height > 0) {
        try {
            ctx.drawImage(scene.bgCanvas, x, y, w, h);
            return;
        } catch (_) { /* fall through */ }
    }
    ctx.fillStyle = normalizeHexColor(ensureBackgroundState().color, "#ffffff");
    ctx.fillRect(x, y, w, h);
}

async function applyBackgroundSnapshot(raw, { resetIfMissing } = {}) {
    if (!raw || typeof raw !== "object") {
        if (!resetIfMissing) return;
        raw = defaultBackground();
    }
    const next = normalizeBackground(raw);
    const bg = ensureBackgroundState();
    const prevMode = bg.mode;
    const prevImageSrc = bg.imageSrc;
    const prevVideoSrc = bg.videoSrc;
    const hadLiveShader = !!(scene.bgShaderRenderer && bg.shaderId);

    bg.mode = next.mode;
    bg.color = next.color;
    bg.imageMode = next.imageMode;
    bg.videoMode = next.videoMode;
    bg.videoLoop = next.videoLoop;
    bg.videoMuted = next.videoMuted;
    bg.imageSrc = next.imageSrc;
    bg.imagePath = next.imagePath;
    bg.imageName = next.imageName;
    bg.videoSrc = next.videoSrc;
    bg.videoPath = next.videoPath;
    bg.videoName = next.videoName;
    bg.mediaError = null;

    const wantShader = next.mode === "shader" && !!next.shaderId;
    const keepShader = wantShader && hadLiveShader && bg.shaderId === next.shaderId && scene.bgShaderRenderer;
    if (wantShader) {
        try {
            await applyBackgroundShader(next.shaderId, next.shaderUniforms);
            const mods = sanitizeModulatorsMap(next.shaderModulators);
            if (Object.keys(mods).length) updateBackgroundModulators(mods);
        } catch (e) {
            console.warn("Background shader apply failed", next.shaderId, e);
            clearBackgroundShader();
            bg.mode = next.mode;
        }
    } else if (bg.shaderId || bg.shader || scene.bgShaderRenderer) {
        clearBackgroundShader();
        bg.mode = next.mode;
    }

    if (next.imageSrc) {
        if (next.imageSrc !== prevImageSrc || !scene.bgImage) {
            await loadBackgroundImage(next.imageSrc);
        }
    } else {
        scene.bgImage = null;
    }
    if (next.videoSrc) {
        const liveSrc = scene.bgVideoEl && scene.bgVideoEl.getAttribute("src");
        if (next.videoSrc !== prevVideoSrc || !liveSrc) {
            await loadBackgroundVideo(next.videoSrc);
        }
    } else {
        pauseBackgroundVideo();
        if (scene.bgVideoEl && prevVideoSrc) {
            try {
                scene.bgVideoEl.removeAttribute("src");
                scene.bgVideoEl.load();
            } catch (_) { /* ignore */ }
        }
    }

    const layers = next.postprocess.layers || [];
    if (layers.length) {
        await setBackgroundPostprocessStack(layers, { active: next.postprocess.active !== false });
    } else if ((bg.postprocess.layers || []).length) {
        bg.postprocess.layers = [];
        stopBackgroundPostprocess();
        try { await rebuildBackgroundPostprocessStack(); } catch (_) { /* ignore */ }
    }

    const shaderReady = wantShader && !!scene.bgShaderRenderer;
    if (prevMode !== bg.mode || (wantShader && !shaderReady) || !keepShader) {
        await setBackgroundMode(bg.mode);
    }
    layoutBackgroundCanvases();
}

function stageBackgroundKey(bg) {
    if (window.SceneMatch && typeof window.SceneMatch.backgroundKey === "function") {
        return window.SceneMatch.backgroundKey({ background: bg });
    }
    if (!bg || typeof bg !== "object") return "solid:#ffffff";
    const mode = bg.mode || "solid";
    if (mode === "shader") return `shader:${bg.shaderId || bg.shaderPath || ""}`;
    if (mode === "image") return `image:${bg.imageSrc || bg.imagePath || ""}`;
    if (mode === "video") return `video:${bg.videoSrc || bg.videoPath || ""}`;
    const color = typeof bg.color === "string" && bg.color ? bg.color.toLowerCase() : "#ffffff";
    return `solid:${color}`;
}

function lerpUniformMaps(from, to, u) {
    const a = from && typeof from === "object" ? from : {};
    const b = to && typeof to === "object" ? to : {};
    const out = {};
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
        const av = a[k];
        const bv = b[k];
        if (Array.isArray(av) && Array.isArray(bv)) {
            const n = Math.max(av.length, bv.length);
            const arr = [];
            for (let i = 0; i < n; i++) arr.push(lerpNum(av[i], bv[i], u, bv[i] != null ? bv[i] : av[i]));
            out[k] = arr;
        } else if (typeof av === "number" && typeof bv === "number") {
            out[k] = lerp(av, bv, u);
        } else {
            out[k] = u < 0.5 ? (av !== undefined ? av : bv) : (bv !== undefined ? bv : av);
        }
    }
    return out;
}

function styleBgLayerBox(el, z) {
    const stage = getStageWhiteSize();
    const w = Math.max(1, Math.round(stage.width));
    const h = Math.max(1, Math.round(stage.height));
    if (!el) return { w, h };
    el.style.position = "absolute";
    el.style.left = "0";
    el.style.top = "0";
    el.style.right = "auto";
    el.style.bottom = "auto";
    el.style.width = `${w}px`;
    el.style.height = `${h}px`;
    el.style.pointerEvents = "none";
    el.style.zIndex = String(z);
    return { w, h };
}

function mintIncomingBgCanvases(beforeNode) {
    const parent = (beforeNode && beforeNode.parentNode)
        || scene.topPanel
        || document.querySelector(".top-panel");
    const bgCanvas = document.createElement("canvas");
    bgCanvas.id = "bg-canvas";
    const ppCanvas = document.createElement("canvas");
    ppCanvas.id = "bg-postprocess-canvas";
    if (parent) {
        parent.insertBefore(bgCanvas, beforeNode || parent.firstChild);
        parent.insertBefore(ppCanvas, beforeNode || parent.firstChild);
    }
    scene.bgCanvas = bgCanvas;
    scene.bgPostprocessCanvas = ppCanvas;
    scene.bgCtx = null;
    styleBgLayerBox(bgCanvas, 0);
    styleBgLayerBox(ppCanvas, 0);
}

function cloneOutgoingBackgroundVideo() {
    const src = scene.bgVideoEl;
    if (!src || !(src.currentSrc || src.src)) return null;
    const v = document.createElement("video");
    v.muted = true;
    v.loop = src.loop;
    v.playsInline = true;
    v.preload = "auto";
    v.src = src.currentSrc || src.src;
    try { v.currentTime = src.currentTime || 0; } catch (_) { /* ignore */ }
    v.style.cssText = "position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;";
    (scene.topPanel || document.body).appendChild(v);
    const play = v.play();
    if (play && typeof play.catch === "function") play.catch(() => {});
    return v;
}

/**
 * Keep the outgoing fill renderer/video alive on a fade layer so it does not
 * freeze to its last frame. Incoming fill is created on fresh canvases.
 */
function detachOutgoingBackground() {
    finishBackgroundTransition(scene._bgTransitionJob);
    const wrap = document.createElement("div");
    wrap.id = "bg-transition-overlay";
    const { w, h } = styleBgLayerBox(wrap, 1);
    wrap.style.display = "block";
    wrap.style.opacity = "1";

    const job = {
        kind: "crossfade",
        overlay: wrap,
        renderer: scene.bgShaderRenderer,
        ppRenderer: scene.bgPostprocessRenderer,
        canvas: scene.bgCanvas,
        ppCanvas: scene.bgPostprocessCanvas,
        videoEl: null,
        videoTick: 0,
        outgoingMode: ensureBackgroundState().mode,
        imageMode: ensureBackgroundState().imageMode,
        videoMode: ensureBackgroundState().videoMode,
    };

    const host = (scene.bgCanvas && scene.bgCanvas.parentNode)
        || scene.topPanel
        || document.querySelector(".top-panel");
    if (scene.bgCanvas) {
        scene.bgCanvas.removeAttribute("id");
        scene.bgCanvas.style.zIndex = "0";
        wrap.appendChild(scene.bgCanvas);
    }
    if (scene.bgPostprocessCanvas && scene.bgPostprocessCanvas.classList.contains("is-live")) {
        scene.bgPostprocessCanvas.removeAttribute("id");
        scene.bgPostprocessCanvas.style.zIndex = "1";
        wrap.appendChild(scene.bgPostprocessCanvas);
    }
    if (host) host.appendChild(wrap);

    if (job.outgoingMode === "video") {
        job.videoEl = cloneOutgoingBackgroundVideo();
        const paint = () => {
            if (!job.videoTick) return;
            const canvas = job.canvas;
            const vid = job.videoEl;
            if (canvas && vid && vid.readyState >= 2) {
                let ctx = null;
                try { ctx = canvas.getContext("2d"); } catch (_) { ctx = null; }
                if (ctx) {
                    if (canvas.width !== w || canvas.height !== h) {
                        canvas.width = w;
                        canvas.height = h;
                    }
                    paintFittedMedia(ctx, vid, w, h, job.videoMode);
                }
            }
            job.videoTick = requestAnimationFrame(paint);
        };
        job.videoTick = requestAnimationFrame(paint);
    }

    if (job.renderer && typeof job.renderer.start === "function") {
        try { job.renderer.start(); } catch (_) { /* ignore */ }
    }
    if (job.ppRenderer && typeof job.ppRenderer.start === "function") {
        try { job.ppRenderer.start(); } catch (_) { /* ignore */ }
    }

    scene.bgShaderRenderer = null;
    scene.bgPostprocessRenderer = null;
    scene.bgCanvas = null;
    scene.bgPostprocessCanvas = null;
    scene.bgCtx = null;
    mintIncomingBgCanvases(wrap);
    scene._bgTransitionJob = job;
    return job;
}

function finishBackgroundTransition(job) {
    const active = job || scene._bgTransitionJob;
    if (!active) return;
    if (active.videoTick) {
        cancelAnimationFrame(active.videoTick);
        active.videoTick = 0;
    }
    if (active.renderer) {
        try { active.renderer.stop(); } catch (_) { /* ignore */ }
        try { active.renderer.destroy(); } catch (_) { /* ignore */ }
        active.renderer = null;
    }
    if (active.ppRenderer) {
        try { active.ppRenderer.stop(); } catch (_) { /* ignore */ }
        try { active.ppRenderer.destroy(); } catch (_) { /* ignore */ }
        active.ppRenderer = null;
    }
    if (active.videoEl) {
        try { active.videoEl.pause(); } catch (_) { /* ignore */ }
        try { active.videoEl.removeAttribute("src"); active.videoEl.load(); } catch (_) { /* ignore */ }
        if (active.videoEl.parentNode) active.videoEl.parentNode.removeChild(active.videoEl);
        active.videoEl = null;
    }
    if (active.overlay && active.overlay.parentNode) {
        active.overlay.parentNode.removeChild(active.overlay);
    } else if (active.overlay) {
        active.overlay.style.opacity = "0";
        active.overlay.style.display = "none";
    }
    if (active.kind === "uniforms" && active.modulators) {
        try { updateBackgroundModulators(active.modulators); } catch (_) { /* ignore */ }
    }
    if (scene._bgTransitionJob === active) scene._bgTransitionJob = null;
}

function tickBackgroundTransition(job, u) {
    if (!job || job.kind === "none") return;
    if (job.kind === "crossfade" && job.overlay) {
        job.overlay.style.opacity = String(1 - u);
        return;
    }
    if (job.kind === "color") {
        const bg = ensureBackgroundState();
        bg.color = lerpColor(job.from, job.to, u);
        if (bg.mode === "solid") paintBackgroundSource();
        return;
    }
    if (job.kind === "uniforms") {
        updateBackgroundUniforms(lerpUniformMaps(job.from, job.to, u));
    }
}

/**
 * Prepare a morph-time fill change. Different modes/assets keep the outgoing
 * fill playing on a fade layer while the incoming one starts underneath.
 * Same solid/shader identity lerps color or uniforms.
 */
async function startBackgroundTransition(incomingRaw) {
    const incoming = incomingRaw && typeof incomingRaw === "object"
        ? normalizeBackground(incomingRaw)
        : defaultBackground();
    const live = getBackgroundSnapshot();
    const fromKey = stageBackgroundKey(live);
    const toKey = stageBackgroundKey(incoming);

    if (fromKey === toKey) {
        if (incoming.mode === "solid") {
            return { kind: "color", from: live.color, to: incoming.color };
        }
        if (incoming.mode === "shader" && live.shaderId && live.shaderId === incoming.shaderId) {
            return {
                kind: "uniforms",
                from: Object.assign({}, live.shaderUniforms || {}),
                to: Object.assign({}, incoming.shaderUniforms || {}),
                modulators: incoming.shaderModulators,
            };
        }
        await applyBackgroundSnapshot(incoming, { resetIfMissing: true });
        return { kind: "none" };
    }

    const job = detachOutgoingBackground();
    // Incoming apply must not tear down the detached outgoing renderer.
    const prevShaderId = ensureBackgroundState().shaderId;
    const prevShader = ensureBackgroundState().shader;
    ensureBackgroundState().shaderId = null;
    ensureBackgroundState().shader = null;
    try {
        await applyBackgroundSnapshot(incoming, { resetIfMissing: true });
    } catch (e) {
        ensureBackgroundState().shaderId = prevShaderId;
        ensureBackgroundState().shader = prevShader;
        throw e;
    }
    return job;
}

function initBackgroundLayer() {
    scene.background = defaultBackground();
    scene.bgCanvas = document.getElementById("bg-canvas");
    scene.bgPostprocessCanvas = document.getElementById("bg-postprocess-canvas");
    scene.bgVideoEl = document.getElementById("bg-video");
    if (scene.bgCanvas) {
        try { scene.bgCtx = scene.bgCanvas.getContext("2d"); } catch (_) { scene.bgCtx = null; }
    }
    layoutBackgroundCanvases();
    paintBackgroundSource();
    syncBackgroundPostprocessVisibility();
}

window.addEventListener("DOMContentLoaded", () => {
    reportLoad(10, 'Building stage…');
    const topPanel = document.querySelector(".top-panel");
    const canvas = document.getElementById("top-canvas");
    const overlayCanvas = document.getElementById("overlay-canvas");
    const postprocessCanvas = document.getElementById("postprocess-canvas");
    const ctx = canvas.getContext("2d");
    const overlayCtx = overlayCanvas.getContext("2d");
    const drawableState = {
        strokes: [],
        isDrawing: false,
        lastPoint: null,
    };
    const containers = scene.containers;

    scene.topPanel = topPanel;
    scene.canvas = canvas;
    scene.overlayCanvas = overlayCanvas;
    scene.ctx = ctx;
    scene.overlayCtx = overlayCtx;
    scene.drawableState = drawableState;

    // Apply default bottom-strip layout before measuring panels
    applyBottomPanelLayout();
    initBackgroundLayer();

    const defaultStyle = {
        border: {
            color: "#000",
            lineWidth: 5,
            dash: [],
        },
        connect: {
            color: "#000",
            lineWidth: 5,
            dash: [],
        },
    };

    const redraw = () => {
        redrawCanvas(canvas, topPanel, ctx, drawableState, containers);
        redrawOverlay(overlayCanvas, overlayCtx, topPanel, containers);
        publishSceneState();
    };
    scene.redraw = redraw;

    topPanel.addEventListener("pointerdown", (event) => {
        const clickedContainer = event.target && typeof event.target.closest === "function"
            ? event.target.closest(".floating-box")
            : null;
        if (clickedContainer) return;
        setSelectedContainerId(null);
    });

    setupCanvas(canvas, topPanel, ctx, drawableState, redraw);

    (async () => {
        if (window.musicView?.getSettings) {
            try {
                const settings = await window.musicView.getSettings();
                if (typeof window.__musicViewSetRenderFps === "function") {
                    window.__musicViewSetRenderFps(settings && settings.render && settings.render.fps);
                }
            } catch (_) { /* ignore */ }
        }
        reportLoad(22, 'Initializing effects…');
        // Seed a default single-layer stack first; default preset may replace it
        await setupPostprocess(postprocessCanvas, {
            getSources: () => ({
                shell: document.querySelector(".app-shell"),
                topPanel,
                topCanvas: canvas,
                overlayCanvas,
                containers,
            }),
        });

        reportLoad(36, 'Creating panels…');
        createSongInfoPanels(topPanel, containers, redraw, defaultStyle);
        createAudioVizPanels(topPanel, containers, redraw, defaultStyle);
        redraw();
        installSceneBridge();

        // Apply checked-in default preset (layout + postprocess + styles; not music)
        reportLoad(48, 'Loading default look…');
        try {
            await loadAndApplyPreset("default");
        } catch (e) {
            console.warn("Default preset load failed:", e);
        }

        publishSceneState();
        markDisplayReady();
        reportLoad(62, 'Stage ready');
        if (window.__musicViewLoad && typeof window.__musicViewLoad.mark === 'function') {
            window.__musicViewLoad.mark('stage');
        }
        setTimeout(() => publishSceneState(), 400);
    })().catch((e) => {
        console.warn("Display init failed:", e);
        if (window.__musicViewLoad && typeof window.__musicViewLoad.mark === 'function') {
            window.__musicViewLoad.mark('stage');
        }
    });
});

/**
 * Song display panels:
 *  1) Cover — square, centered in top-panel, wander off
 *  2) Info — title / artist / album text
 *  3) Lyrics — focused current line (prev / current / next)
 */
function createSongInfoPanels(topPanel, containers, redraw, defaultStyle) {
    const panelW = topPanel.clientWidth || 400;
    const panelH = topPanel.clientHeight || 600;

    // Square cover sized relative to the stage, centered
    const coverSize = Math.round(Math.min(panelW, panelH) * 0.48);
    const coverLeft = Math.round((panelW - coverSize) / 2);
    const coverTop = Math.round((panelH - coverSize) / 2 - panelH * 0.06);

    const coverEl = createFloatingContainer(
        topPanel,
        {
            width: coverSize,
            height: coverSize,
            left: coverLeft,
            top: Math.max(16, coverTop),
            text: "",
            label: "Cover",
            labelCorner: "bottom-right",
            wander: false,
            layer: 0,
            style: defaultStyle,
            distancing: 0,
            imageMode: "fill",
            role: "song-cover",
        },
        containers,
        redraw,
    );

    // Start compact; fitSongInfoPanel() will size to content after mount
    const infoW = 160;
    const infoH = 72;
    const coverState = containers.find((c) => c.element === coverEl);
    const coverBottom = (coverState?.top ?? Math.max(16, coverTop)) + coverSize;
    const infoTop = Math.min(panelH - infoH - 16, coverBottom + 16);
    const infoLeft = Math.round((panelW - infoW) / 2);

    const infoEl = createFloatingContainer(
        topPanel,
        {
            width: infoW,
            height: infoH,
            left: infoLeft,
            top: Math.max(16, infoTop),
            text: "",
            label: "Track",
            labelCorner: "bottom-right",
            wander: false,
            layer: 1,
            style: defaultStyle,
            distancing: 0,
            role: "song-info",
        },
        containers,
        redraw,
    );

    // Lyrics focus panel — static size (locked after song load), not per-line
    const lyricsW = Math.min(360, Math.round(panelW * 0.78));
    const lyricsH = 110;
    const lyricsLeft = Math.round((panelW - lyricsW) / 2);
    const lyricsTop = Math.min(panelH - lyricsH - 12, Math.max(16, infoTop) + infoH + 14);

    const lyricsEl = createFloatingContainer(
        topPanel,
        {
            width: lyricsW,
            height: lyricsH,
            left: lyricsLeft,
            top: lyricsTop,
            text: "",
            label: "Lyrics",
            labelCorner: "top-right",
            wander: false,
            layer: 2,
            style: defaultStyle,
            distancing: 0,
            role: "song-lyrics",
        },
        containers,
        redraw,
    );

    // Playback progress bar — wide, short; canvas fills the whole box left→right
    // Time stamps are drawn on the canvas with dual-tone contrast over the fill
    const progressW = Math.min(380, Math.round(panelW * 0.84));
    const progressH = 28;
    const progressLeft = Math.round((panelW - progressW) / 2);
    const progressTop = Math.max(12, panelH - progressH - 20);

    const progressEl = createFloatingContainer(
        topPanel,
        {
            width: progressW,
            height: progressH,
            left: progressLeft,
            top: progressTop,
            text: "",
            label: "Progress",
            labelCorner: "bottom-right",
            wander: false,
            layer: 3,
            style: defaultStyle,
            distancing: 0,
            role: "song-progress",
        },
        containers,
        redraw,
    );

    scene.songPanels.cover = containers.find((c) => c.element === coverEl) || null;
    scene.songPanels.info = containers.find((c) => c.element === infoEl) || null;
    scene.songPanels.lyrics = containers.find((c) => c.element === lyricsEl) || null;
    scene.songPanels.progress = containers.find((c) => c.element === progressEl) || null;

    if (scene.songPanels.cover?.element) {
        scene.songPanels.cover.element.classList.add("song-cover-panel");
    }
    if (scene.songPanels.info?.element) {
        scene.songPanels.info.element.classList.add("song-info-panel");
        setupSongInfoBlock(scene.songPanels.info);
        setSongInfoContent(scene.songPanels.info, {
            title: "No song selected",
            artist: "—",
            album: "—",
        });
    }
    if (scene.songPanels.lyrics?.element) {
        scene.songPanels.lyrics.element.classList.add("song-lyrics-panel");
        setupSongLyricsBlock(scene.songPanels.lyrics);
        rebuildLyricsTrack(scene.songPanels.lyrics, []);
        setSongLyricsFocus(scene.songPanels.lyrics, {
            hasLyrics: false,
            current: "Select a song to show lyrics",
        });
    }
    if (scene.songPanels.progress?.element) {
        scene.songPanels.progress.element.classList.add("song-progress-panel");
        setupSongProgressBar(scene.songPanels.progress);
        setSongProgress(scene.songPanels.progress, 0);
        // Second pass after layout so the bar host has a non-zero width
        requestAnimationFrame(() => {
            const bar = scene.songPanels.progress;
            if (bar) setSongProgress(bar, bar.playbackProgress || 0, {
                currentTime: bar.playbackCurrentTime,
                duration: bar.playbackDuration,
            });
        });
    }
}

/**
 * Floating containers for live audio visualizations (scope / history / beat).
 * Shaders use param modulators (sine / square / time) as placeholders until
 * real analyser → uniform wiring lands.
 */
function createAudioVizPanels(topPanel, containers, redraw, defaultStyle) {
    const panelW = topPanel.clientWidth || 400;
    const panelH = topPanel.clientHeight || 600;

    const vizW = Math.min(220, Math.round(panelW * 0.42));
    const vizH = Math.min(130, Math.round(panelH * 0.16));
    const beatSize = Math.min(vizW, Math.round(vizH * 1.15));
    const margin = 12;
    const gap = 12;
    const left = margin;
    let top = Math.max(16, Math.round(panelH * 0.08));

    const vizStyle = {
        border: {
            color: defaultStyle?.border?.color || "#1a3a44",
            lineWidth: defaultStyle?.border?.lineWidth || 3,
            dash: defaultStyle?.border?.dash || [],
        },
        connect: {
            color: defaultStyle?.connect?.color || "#3d8f9a",
            lineWidth: defaultStyle?.connect?.lineWidth || 2,
            dash: defaultStyle?.connect?.dash || [],
        },
        label: {
            fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
            fontSize: 11,
            fontWeight: "600",
            fontStyle: "normal",
            color: "#8ef0ff",
            background: "rgba(0,16,24,0.8)",
            letterSpacing: 0.4,
            opacity: 1,
        },
    };

    const defs = [
        {
            role: "audio-scope",
            label: "Scope",
            width: vizW,
            height: vizH,
            layer: 4,
            shaderId: "audio-scope",
            shaderUniforms: {
                u_signal: 0.55,
                u_gain: 1.0,
                u_freq: 2.5,
                u_thickness: 0.018,
                u_glow: 0.55,
                u_intensity: 1.0,
            },
            // Placeholder for live waveform energy
            shaderModulators: {
                u_signal: {
                    source: "sine",
                    offset: 0.55,
                    amp: 0.4,
                    rate: 0.85,
                    phase: 0,
                    clock: "stack",
                },
                u_freq: {
                    source: "sine",
                    offset: 2.5,
                    amp: 0.9,
                    rate: 0.12,
                    phase: 0.3,
                    clock: "stack",
                },
            },
        },
        {
            role: "audio-history",
            label: "History",
            width: vizW,
            height: vizH,
            layer: 5,
            shaderId: "audio-history",
            shaderUniforms: {
                u_energy: 0.5,
                u_window: 8.0,
                u_scroll: 1.0,
                u_contrast: 1.2,
                u_intensity: 1.0,
            },
            // Placeholder for per-frame spectral / RMS energy
            shaderModulators: {
                u_energy: {
                    source: "sine",
                    offset: 0.5,
                    amp: 0.42,
                    rate: 0.55,
                    phase: 1.1,
                    clock: "stack",
                },
            },
        },
        {
            role: "audio-beat",
            label: "Beat",
            width: beatSize,
            height: beatSize,
            layer: 6,
            // Ferrofluid speaker — live u_beat / u_envelope / u_bass via role
            shaderId: "audio-ferrofluid",
            shaderUniforms: {
                u_beat: 0.0,
                u_envelope: 0.4,
                u_intensity: 1.0,
                u_spike_count: 7.0,
                u_spike_length: 0.22,
                u_droplets: 0.65,
                u_window: 0.85,
            },
            // Demo motion when analysis is idle; live audio overrides these uniforms
            shaderModulators: {
                u_beat: {
                    source: "square",
                    offset: 0.35,
                    amp: 0.55,
                    rate: 1.4,
                    phase: 0,
                    clock: "stack",
                },
                u_envelope: {
                    source: "sine",
                    offset: 0.45,
                    amp: 0.35,
                    rate: 0.7,
                    phase: 0.5,
                    clock: "stack",
                },
            },
        },
    ];

    for (const def of defs) {
        // Stack on the left edge; clamp if stage is short
        const maxTop = Math.max(margin, panelH - def.height - margin);
        const placedTop = Math.min(top, maxTop);
        createFloatingContainer(
            topPanel,
            {
                width: def.width,
                height: def.height,
                left,
                top: placedTop,
                text: "",
                label: def.label,
                labelCorner: "bottom-right",
                wander: false,
                layer: def.layer,
                style: vizStyle,
                distancing: 0,
                role: def.role,
                shaderId: def.shaderId,
                shaderUniforms: def.shaderUniforms,
                shaderModulators: def.shaderModulators,
            },
            containers,
            redraw,
        );
        top = placedTop + def.height + gap;
    }

    // ARTEF4KT Three.js embed — large panel, right side (host-driven analysis)
    const arteSize = Math.min(
        Math.round(Math.min(panelW, panelH) * 0.48),
        Math.round(panelW * 0.55),
        420,
    );
    const arteW = Math.max(180, arteSize);
    const arteH = Math.max(180, arteSize);
    createFloatingContainer(
        topPanel,
        {
            width: arteW,
            height: arteH,
            left: Math.max(margin, panelW - arteW - margin),
            top: Math.max(margin, Math.round(panelH * 0.12)),
            text: "",
            label: "ARTEF4KT",
            labelCorner: "bottom-left",
            wander: false,
            layer: 7,
            style: vizStyle,
            distancing: 0,
            role: "artef4kt",
            shaderId: null,
            embed: { engine: "artef4kt", settingsId: "default", quality: "auto" },
        },
        containers,
        redraw,
    );
}

// ── ARTEF4KT embed (Three.js vendor host) ─────────────────────────────

/**
 * Mount ARTEF4KT into a container's canvas. Idempotent.
 * @param {object} state container state
 */
async function mountArtef4ktOnContainer(state) {
    if (!state || state.role !== "artef4kt") return null;
    if (state.artef4ktHost) return state.artef4ktHost;
    if (typeof window.createArtef4ktEmbed !== "function") {
        console.warn("createArtef4ktEmbed missing — load artef4kt-host.js");
        return null;
    }

    // Tear down any GLSL / 2D binding so Three.js can own the canvas
    if (state.shaderRenderer) {
        try { clearShader(state); } catch (_) { /* ignore */ }
    }
    if (state.innerCtx) {
        replaceInnerCanvas(state);
        state.innerCtx = null;
    }
    const canvas = ensureCanvasForWebGL(state);
    if (!canvas) return null;

    const w = Math.max(1, state.element?.clientWidth || state.width || 320);
    const h = Math.max(1, state.element?.clientHeight || state.height || 320);

    try {
        state.artef4ktMounting = true;
        const host = await window.createArtef4ktEmbed({
            canvas,
            width: w,
            height: h,
            parentEl: state.element,
            overlay: state.embed?.settings || {},
        });
        state.artef4ktHost = host;
        state.innerCtx = null;
        // Hide generic in-box text chrome; ARTEF4KT uses its own overlays
        if (state.textEl) {
            state.textEl.style.display = "none";
            state.textEl.textContent = "";
        }
        state.element?.classList.add("artef4kt-panel");
        state.embed = state.embed && typeof state.embed === "object"
            ? state.embed
            : { engine: "artef4kt", settingsId: "default", quality: "auto" };
        // Prefer full settings blob from preset; else named settings file
        if (state.embed.settings && typeof state.embed.settings === "object" && host.applySettings) {
            try {
                host.applySettings(state.embed.settings, { partial: false });
                cacheArtef4ktSettings(state);
            } catch (_) { /* optional */ }
        } else {
            const settingsId = state.embed.settingsId || "default";
            if (host.loadSettings) {
                try {
                    const r = await host.loadSettings(settingsId);
                    if (r && r.settings) {
                        state.embed.settingsId = r.settingsId || settingsId;
                        state.embed.settings = r.settings;
                    } else {
                        cacheArtef4ktSettings(state);
                    }
                } catch (_) { /* optional */ }
            }
        }
        // Seed track chrome from last now-playing if available
        if (typeof host.setTrackInfo === "function" && scene.lastNowPlaying) {
            try { host.setTrackInfo(scene.lastNowPlaying); } catch (_) { /* ignore */ }
        }
        return host;
    } catch (e) {
        console.warn("ARTEF4KT mount failed", e);
        state.artef4ktHost = null;
        return null;
    } finally {
        state.artef4ktMounting = false;
    }
}

const SONG_ROLE_CLASS = {
    "song-cover": "song-cover-panel",
    "song-info": "song-info-panel",
    "song-lyrics": "song-lyrics-panel",
    "song-progress": "song-progress-panel",
    "show-progress": "show-progress-panel",
};

function isProgressRole(role) {
    return role === "song-progress" || role === "show-progress";
}

function isProgressContainer(state) {
    if (!state) return false;
    if (isProgressRole(state.role)) return true;
    const el = state.element;
    return !!(el && (el.classList.contains("song-progress-panel") || el.classList.contains("show-progress-panel")));
}

function destroyFloatingContainer(state) {
    if (!state) return;
    stopImageContentFade(state);
    stopTextGlitch(state);
    stopWander(state);
    try { destroyContainerPostprocess(state); } catch (_) { /* ignore */ }
    try { unmountArtef4ktFromContainer(state); } catch (_) { /* ignore */ }
    try { clearShader(state); } catch (_) { /* ignore */ }
    if (state.element && state.element.parentNode) {
        state.element.remove();
    }
    const idx = scene.containers.indexOf(state);
    if (idx >= 0) scene.containers.splice(idx, 1);
    if (scene.songPanels) {
        for (const key of Object.keys(scene.songPanels)) {
            if (scene.songPanels[key] === state) scene.songPanels[key] = null;
        }
    }
}

function rebindSongPanels() {
    if (!scene.songPanels) scene.songPanels = {};
    const map = {
        cover: "song-cover",
        info: "song-info",
        lyrics: "song-lyrics",
        progress: "song-progress",
        showProgress: "show-progress",
    };
    for (const [key, role] of Object.entries(map)) {
        const state = findContainerByRole(role);
        const prev = scene.songPanels[key];
        scene.songPanels[key] = state || null;
        if (!state?.element) continue;
        const cls = SONG_ROLE_CLASS[role];
        if (cls) state.element.classList.add(cls);
        const isNew = !prev || prev.element !== state.element;
        if (!isNew) continue;
        if (role === "song-info") {
            setupSongInfoBlock(state);
            if (scene.lastNowPlaying) {
                setSongInfoContent(state, {
                    title: scene.lastNowPlaying.title || "—",
                    artist: scene.lastNowPlaying.artist || "—",
                    album: scene.lastNowPlaying.album || "—",
                });
            }
        } else if (role === "song-lyrics") {
            setupSongLyricsBlock(state);
            if (scene.lastLyricFocus) setSongLyricsFocus(state, scene.lastLyricFocus);
        } else if (isProgressRole(role)) {
            setupSongProgressBar(state);
        }
    }
}

function morphSetGeometry(state, left, top, width, height) {
    if (!state?.element) return;
    const l = Number(left);
    const t = Number(top);
    const w = Math.max(1, Number(width));
    const h = Math.max(1, Number(height));
    state.left = l;
    state.top = t;
    state.width = w;
    state.height = h;
    state.element.style.left = `${l}px`;
    state.element.style.top = `${t}px`;
    state.element.style.width = `${w}px`;
    state.element.style.height = `${h}px`;
}

function unmountArtef4ktFromContainer(state) {
    if (!state?.artef4ktHost) return;
    try {
        state.artef4ktHost.unmount();
    } catch (e) {
        console.warn("ARTEF4KT unmount", e);
    }
    state.artef4ktHost = null;
    state.element?.classList.remove("artef4kt-panel");
    if (state.textEl) state.textEl.style.display = "";
}

function resizeArtef4ktOnContainer(state) {
    const w = Math.max(1, state.element?.clientWidth || state.width || 1);
    const h = Math.max(1, state.element?.clientHeight || state.height || 1);
    if (state?.artef4ktHost && typeof state.artef4ktHost.setSize === "function") {
        try {
            state.artef4ktHost.setSize(w, h);
        } catch (e) {
            console.warn("ARTEF4KT resize", e);
        }
    }
    const overlay = state?.element?.querySelector(".artef4kt-overlay-root");
    if (overlay) overlay.style.fontSize = `${liveFontSize(10)}px`;
}

function feedArtef4ktAnalysis(frame, mapped) {
    for (const c of scene.containers) {
        if (!c || c.role !== "artef4kt" || !c.artef4ktHost) continue;
        try {
            c.artef4ktHost.setAnalysis(frame, mapped);
        } catch (e) {
            /* ignore per-frame errors */
        }
    }
}

/** Snapshot ARTEF4KT settings onto container.embed for Controls + presets. */
function cacheArtef4ktSettings(state) {
    if (!state?.artef4ktHost || typeof state.artef4ktHost.getSettings !== "function") return null;
    try {
        const settings = state.artef4ktHost.getSettings();
        if (!settings || typeof settings !== "object") return null;
        // Drop non-serializable / host-only keys
        const clean = JSON.parse(JSON.stringify(settings));
        delete clean._partial;
        delete clean.exportDate;
        if (!state.embed || typeof state.embed !== "object") {
            state.embed = { engine: "artef4kt", settingsId: "default", quality: "auto" };
        }
        state.embed.settings = clean;
        return clean;
    } catch (e) {
        console.warn("cacheArtef4ktSettings", e);
        return null;
    }
}

/**
 * @param {object} state
 * @param {object} patch
 * @param {{ partial?: boolean }} [opts]
 */
function applyArtef4ktSettingsToContainer(state, patch, opts = {}) {
    if (!state || state.role !== "artef4kt") {
        return { ok: false, error: "Not an artef4kt container" };
    }
    if (!state.artef4ktHost) {
        return { ok: false, error: "ARTEF4KT not mounted" };
    }
    if (!patch || typeof patch !== "object") {
        return { ok: false, error: "settings/patch required" };
    }
    const partial = opts.partial !== false;
    const ok = state.artef4ktHost.applySettings
        ? state.artef4ktHost.applySettings(patch, { partial })
        : false;
    if (!ok) return { ok: false, error: "applySettings failed" };
    const settings = cacheArtef4ktSettings(state);
    return { ok: true, settings };
}

async function loadArtef4ktPresetOnContainer(state, settingsId) {
    if (!state || state.role !== "artef4kt") {
        return { ok: false, error: "Not an artef4kt container" };
    }
    if (!state.artef4ktHost) {
        await mountArtef4ktOnContainer(state);
    }
    if (!state.artef4ktHost?.loadSettings) {
        return { ok: false, error: "ARTEF4KT not mounted" };
    }
    const id = String(settingsId || "default").replace(/\.json$/i, "");
    const result = await state.artef4ktHost.loadSettings(id);
    if (!result || result.ok === false) {
        return { ok: false, error: result?.error || "load failed" };
    }
    if (!state.embed) state.embed = { engine: "artef4kt", quality: "auto" };
    state.embed.settingsId = id;
    state.embed.settings = result.settings || cacheArtef4ktSettings(state);
    return { ok: true, settingsId: id, settings: state.embed.settings };
}

// ── Live audio analysis → viz containers ──────────────────────────────

const AUDIO_HIST_WIDTH = 512;
let audioLiveActive = false;

function audioInputApi() {
    return (typeof window !== "undefined" && window.AudioInput) || null;
}

function containerAudioInput(state) {
    const api = audioInputApi();
    if (api && typeof api.sanitizeAudioInput === "function") {
        return api.sanitizeAudioInput(state?.audioInput, state?.role);
    }
    return state?.audioInput && typeof state.audioInput === "object" ? state.audioInput : null;
}

function getAudioRuntime(state) {
    if (!state) return null;
    if (!state._audioRt) {
        state._audioRt = {
            signal: 0,
            envelope: 0,
            beat: 0,
            bass: 0,
            lastBeatGate: 0,
            beatPhase: 0,
            lastWall: 0,
            history: new Uint8Array(AUDIO_HIST_WIDTH),
            histWrite: 0,
            histCount: 0,
            sourceKey: "",
        };
    }
    return state._audioRt;
}

function resetAudioRuntime(state) {
    const rt = state?._audioRt;
    if (!rt) return;
    rt.signal = 0;
    rt.envelope = 0;
    rt.beat = 0;
    rt.bass = 0;
    rt.lastBeatGate = 0;
    rt.beatPhase = 0;
    rt.lastWall = 0;
    rt.history.fill(0);
    rt.histWrite = 0;
    rt.histCount = 0;
}

/**
 * Read a named analysis channel from an audio frame (0..1).
 * @param {object} frame
 * @param {string} id
 */
function audioChannelValue(frame, id) {
    if (!frame || !id) return 0;
    if (frame.channels && Number.isFinite(Number(frame.channels[id]))) {
        return clamp01(frame.channels[id]);
    }
    if (Number.isFinite(Number(frame[id]))) return clamp01(frame[id]);
    // aliases
    if (id === 'onset' && Number.isFinite(Number(frame.flux))) return clamp01(frame.flux);
    return 0;
}

function frameWaveform(frame) {
    if (!frame) return null;
    if (frame.waveform instanceof Uint8Array) return frame.waveform;
    if (Array.isArray(frame.waveform) && frame.waveform.length) {
        const wave = new Uint8Array(frame.waveform.length);
        for (let i = 0; i < frame.waveform.length; i++) {
            const v = frame.waveform[i] | 0;
            wave[i] = v < 0 ? 0 : v > 255 ? 255 : v;
        }
        return wave;
    }
    return null;
}

/** Lead tap = incoming track. Mix tap = audible blend (fades). */
function audioFrameForInput(frame, inp) {
    if (!frame) return frame;
    const wantMix = !inp || inp.continuous !== false;
    const tap = wantMix ? (frame.mix || frame) : (frame.lead || frame);
    if (!tap || tap === frame) return frame;
    return {
        playing: tap.playing != null ? tap.playing : frame.playing,
        channels: tap.channels || frame.channels,
        waveform: tap.waveform || frame.waveform,
        rms: tap.rms != null ? tap.rms : frame.rms,
        bass: tap.bass != null ? tap.bass : frame.bass,
        mid: tap.mid != null ? tap.mid : frame.mid,
        envelope: tap.envelope != null ? tap.envelope : frame.envelope,
        beat: tap.beat != null ? tap.beat : frame.beat,
        flux: tap.flux != null ? tap.flux : frame.flux,
        peak: tap.peak != null ? tap.peak : frame.peak,
        onset: tap.onset != null ? tap.onset : frame.onset,
        kick: tap.kick != null ? tap.kick : frame.kick,
    };
}

function ensureAudioInputOnState(state) {
    const api = audioInputApi();
    if (!state || !api) return;
    state.audioInput = api.sanitizeAudioInput(state.audioInput, state.role);
}

/**
 * Apply a live analysis frame from the music window to each viz / ARTEF4KT
 * container using that container's `audioInput` routing (not Music UI).
 * @param {object} frame
 */
function applyAudioFrame(frame) {
    if (!frame || typeof frame !== 'object') return;

    if (frame.disabled) {
        audioLiveActive = false;
        clearAudioLiveUniforms();
        feedArtef4ktAnalysis({ playing: false, channels: {} }, {
            bass: 0, mid: 0, high: 0, beat: 0, envelope: 0, sensitivity: 1,
        });
        return;
    }

    const now = performance.now();
    let anyLive = false;

    for (const c of scene.containers) {
        if (!c) continue;
        const inp = containerAudioInput(c);
        if (!inp) continue;
        const tap = audioFrameForInput(frame, inp);
        const playing = !!(tap && tap.playing);
        const wave = frameWaveform(tap);
        const rt = getAudioRuntime(c);
        const srcKey = [inp.source, inp.envelope || "", inp.bass || "", inp.mid || "", inp.high || ""].join("|");
        if (rt.sourceKey && rt.sourceKey !== srcKey) {
            rt.history.fill(0);
            rt.histWrite = 0;
            rt.histCount = 0;
        }
        rt.sourceKey = srcKey;

        const dt = rt.lastWall > 0
            ? Math.min(0.08, Math.max(0.001, (now - rt.lastWall) / 1000))
            : 1 / 48;
        rt.lastWall = now;
        const envFollow = 1 - Math.exp(-dt * 14);
        const gain = Number.isFinite(Number(inp.gain)) ? Number(inp.gain) : 1;

        if (c.role === "audio-scope" && c.shaderRenderer) {
            const raw = clamp01(audioChannelValue(tap, inp.source) * gain);
            rt.signal += (raw - rt.signal) * envFollow;
            const r = c.shaderRenderer;
            if (wave && wave.length && typeof r.setTexture2D === "function") {
                r.setTexture2D("u_waveform", wave, wave.length, 1, { filter: "linear" });
            }
            if (typeof r.setLiveUniforms === "function") {
                r.setLiveUniforms({
                    u_use_wave: wave && wave.length && playing ? 1 : 0,
                    u_signal: clamp01(rt.signal),
                });
            }
            if (playing) anyLive = true;
        } else if (c.role === "audio-history" && c.shaderRenderer) {
            const raw = clamp01(audioChannelValue(tap, inp.source) * gain);
            if (playing) {
                const compressed = Math.pow(clamp01(raw), 0.72);
                rt.history[rt.histWrite] = Math.round(compressed * 255);
                rt.histWrite = (rt.histWrite + 1) % AUDIO_HIST_WIDTH;
                if (rt.histCount < AUDIO_HIST_WIDTH) rt.histCount += 1;
                anyLive = true;
            }
            const r = c.shaderRenderer;
            if (typeof r.setTexture2D === "function" && rt.histCount) {
                r.setTexture2D("u_history", rt.history, AUDIO_HIST_WIDTH, 1, { filter: "linear" });
            }
            if (typeof r.setLiveUniforms === "function") {
                r.setLiveUniforms({
                    u_use_history: rt.histCount ? 1 : 0,
                    u_write_head: rt.histWrite / AUDIO_HIST_WIDTH,
                    u_history_filled: rt.histCount / AUDIO_HIST_WIDTH,
                    u_energy: clamp01(raw),
                });
            }
        } else if (c.role === "audio-beat" && c.shaderRenderer
            && typeof c.shaderRenderer.setLiveUniforms === "function") {
            const beatIn = clamp01(audioChannelValue(tap, inp.source) * gain);
            const envIn = clamp01(audioChannelValue(tap, inp.envelope || "envelope") * gain);
            const bassIn = clamp01(audioChannelValue(tap, inp.bass || "bass") * gain);
            const kick = audioChannelValue(tap, "kick");
            rt.envelope += (envIn - rt.envelope) * envFollow;
            rt.bass += (bassIn - rt.bass) * envFollow;
            const impulsive = inp.source === "beat" || inp.source === "onset" || inp.source === "kick";
            if (impulsive) {
                rt.beat = Math.max(beatIn, rt.beat * Math.exp(-dt * 5.5));
            } else {
                rt.beat += (beatIn - rt.beat) * envFollow;
            }
            const edgeThr = impulsive ? 0.32 : 0.55;
            if (beatIn > edgeThr && rt.lastBeatGate < edgeThr * 0.7) {
                rt.beatPhase += 1;
            }
            rt.lastBeatGate = beatIn;
            const bassOut = (inp.bass || "bass") === "bass"
                ? Math.max(rt.bass, kick * gain)
                : rt.bass;
            c.shaderRenderer.setLiveUniforms({
                u_beat: clamp01(rt.beat),
                u_envelope: clamp01(rt.envelope),
                u_beat_phase: rt.beatPhase,
                u_bass: clamp01(bassOut),
            });
            if (playing) anyLive = true;
        } else if (c.role === "artef4kt" && c.artef4ktHost) {
            const bassSrc = inp.bass || "bass";
            let bass = clamp01(audioChannelValue(tap, bassSrc) * gain);
            if (bassSrc === "bass") {
                bass = Math.max(bass, clamp01(audioChannelValue(tap, "kick") * 0.85 * gain));
            }
            const mapped = {
                bass,
                mid: clamp01(audioChannelValue(tap, inp.mid || "mid") * gain),
                high: clamp01(audioChannelValue(tap, inp.high || "treble") * gain),
                beat: clamp01(audioChannelValue(tap, inp.source) * gain),
                envelope: clamp01(audioChannelValue(tap, inp.envelope || "envelope") * gain),
                sensitivity: gain,
            };
            try { c.artef4ktHost.setAnalysis(tap, mapped); } catch (_) { /* ignore */ }
            if (playing) anyLive = true;
        }
    }

    audioLiveActive = anyLive;
}

function clearAudioLiveUniforms() {
    for (const c of scene.containers) {
        if (!c) continue;
        if (c.shaderRenderer && typeof c.shaderRenderer.setLiveUniforms === "function") {
            if (c.role === "audio-scope" || c.role === "audio-history" || c.role === "audio-beat") {
                c.shaderRenderer.setLiveUniforms(null);
            }
        }
    }
}

function clamp01(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return 0;
    return n < 0 ? 0 : n > 1 ? 1 : n;
}

/**
 * Clear per-container history / smoothing when a new track starts.
 * Continuous panels keep their ring / smoothing across the change.
 */
function resetAudioHistory() {
    if (!scene?.containers) return;
    for (const c of scene.containers) {
        const inp = containerAudioInput(c);
        if (inp && inp.continuous !== false) continue;
        resetAudioRuntime(c);
    }
}

/**
 * Replace flat text node with stacked title / artist / album lines.
 */
function setupSongInfoBlock(state) {
    if (!state?.element) return;

    // Hide generic single text node
    if (state.textEl) {
        state.textEl.style.display = "none";
    }

    let block = state.element.querySelector(".song-info-block");
    if (!block) {
        block = document.createElement("div");
        block.className = "song-info-block";

        const title = document.createElement("div");
        title.className = "song-info-title";
        const artist = document.createElement("div");
        artist.className = "song-info-artist";
        const album = document.createElement("div");
        album.className = "song-info-album";

        block.appendChild(title);
        block.appendChild(artist);
        block.appendChild(album);
        state.element.appendChild(block);
    }

    state.songInfoBlock = block;
    state.songInfoTitleEl = block.querySelector(".song-info-title");
    state.songInfoArtistEl = block.querySelector(".song-info-artist");
    state.songInfoAlbumEl = block.querySelector(".song-info-album");
    applyContainerBoxStyle(state);
}

function setSongInfoContent(state, { title, artist, album }) {
    if (!state) return;
    if (!state.songInfoBlock) setupSongInfoBlock(state);

    const t = (title || "Unknown Title").trim() || "Unknown Title";
    const a = (artist || "Unknown Artist").trim() || "Unknown Artist";
    const al = (album || "").trim() || "—";
    const nextKey = `${t}\n${a}\n${al}`;
    if (state._infoTextKey === nextKey && !state._textGlitch) {
        fitSongInfoPanel(state);
        return;
    }

    const fade = normalizeTextGlitchSec(state.textGlitch);
    const fromT = state.songInfoTitleEl ? state.songInfoTitleEl.textContent : "";
    const fromA = state.songInfoArtistEl ? state.songInfoArtistEl.textContent : "";
    const fromAl = state.songInfoAlbumEl ? state.songInfoAlbumEl.textContent : "";
    const canGlitch = fade > 0 && state._infoTextKey && nextKey !== state._infoTextKey;

    state._infoTextKey = nextKey;
    state.text = nextKey;
    if (state.textEl) state.textEl.textContent = nextKey;

    if (canGlitch) {
        startTextGlitch(state, [
            { from: fromT, to: t, set: (s) => { if (state.songInfoTitleEl) state.songInfoTitleEl.textContent = s; } },
            { from: fromA, to: a, set: (s) => { if (state.songInfoArtistEl) state.songInfoArtistEl.textContent = s; } },
            { from: fromAl, to: al, set: (s) => { if (state.songInfoAlbumEl) state.songInfoAlbumEl.textContent = s; } },
        ], fade, { onFrame: () => { if (scene.redraw) scene.redraw(); } });
    } else {
        stopTextGlitch(state);
        if (state.songInfoTitleEl) state.songInfoTitleEl.textContent = t;
        if (state.songInfoArtistEl) state.songInfoArtistEl.textContent = a;
        if (state.songInfoAlbumEl) state.songInfoAlbumEl.textContent = al;
    }

    fitSongInfoPanel(state);
}

/**
 * Shrink-wrap the song-info floating box to its text content.
 * Auto-places under cover only when the user (or preset) has not pinned layout.
 */
function fitSongInfoPanel(state) {
    if (!state?.element || !state.songInfoBlock) return;
    if (state.layoutDesign || (state.layoutPinned && state.width && state.height)) {
        if (state.layoutDesign) applyLiveFromDesign(state);
        return;
    }

    const el = state.element;
    const topPanel = state.topPanel || scene.topPanel;
    const panelW = topPanel ? topPanel.clientWidth : 400;
    const panelH = topPanel ? topPanel.clientHeight : 600;
    const maxW = Math.min(420, Math.round(panelW * 0.88));

    const block = state.songInfoBlock;

    // Measure with unconstrained width so long titles don't collapse to 0
    el.style.width = "max-content";
    el.style.height = "auto";
    el.style.maxWidth = `${maxW}px`;
    block.style.whiteSpace = "normal";

    // Force layout
    void el.offsetWidth;
    const rect = block.getBoundingClientRect();
    const contentW = Math.ceil(rect.width || block.scrollWidth || 80);
    const contentH = Math.ceil(rect.height || block.scrollHeight || 40);

    // Include style.padding (uniform) so shrink-wrap matches the painted box
    const pad = normalizeBoxPadding(state.style?.padding);
    const padX = pad * 2;
    const padY = pad * 2;
    const w = Math.max(96, Math.min(maxW, contentW + padX));
    const h = Math.max(56, contentH + padY);

    setContainerSize(state, w, h);

    // Keep user/preset placement; only auto-stack under cover when unpinned
    if (!state.layoutPinned) {
        const cover = scene.songPanels.cover;
        let left = Math.round((panelW - w) / 2);
        let top = state.top != null ? state.top : el.offsetTop;
        if (cover?.element) {
            const coverBottom = (cover.top != null ? cover.top : cover.element.offsetTop)
                + (cover.height != null ? cover.height : cover.element.offsetHeight);
            top = coverBottom + 16;
        }
        top = Math.max(8, Math.min(panelH - h - 8, top));
        left = Math.max(8, Math.min(panelW - w - 8, left));
        setContainerPosition(state, left, top);
    } else {
        // Size change may push past panel edge — clamp without re-centering
        clampContainerInPanel(state);
    }

    el.style.maxWidth = "";
}

function setContainerText(state, text) {
    if (!state) return;
    state.text = text == null ? "" : String(text);
    if (state.textEl) state.textEl.textContent = state.text;
    else {
        const el = state.element?.querySelector(".floating-text");
        if (el) {
            state.textEl = el;
            el.textContent = state.text;
        }
    }
}

function normalizeContentFadeSec(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.min(8, n);
}

function stopImageContentFade(state) {
    if (!state?._imageFade) return;
    if (state._imageFade.raf) cancelAnimationFrame(state._imageFade.raf);
    state._imageFade = null;
}

function paintFittedImage(ctx, img, w, h, mode) {
    if (!ctx || !img || !img.width || !img.height) return;
    const imgW = img.width;
    const imgH = img.height;
    const canvasAspect = w / Math.max(1, h);
    const imgAspect = imgW / imgH;
    if (mode === "fill") {
        if (imgAspect > canvasAspect) {
            const sw = imgH * canvasAspect;
            const sx = (imgW - sw) / 2;
            ctx.drawImage(img, sx, 0, sw, imgH, 0, 0, w, h);
        } else {
            const sh = imgW / canvasAspect;
            const sy = (imgH - sh) / 2;
            ctx.drawImage(img, 0, sy, imgW, sh, 0, 0, w, h);
        }
        return;
    }
    const scale = Math.min(w / imgW, h / imgH);
    const dw = imgW * scale;
    const dh = imgH * scale;
    ctx.drawImage(img, 0, 0, imgW, imgH, (w - dw) / 2, (h - dh) / 2, dw, dh);
}

function startImageContentFade(state, fromImg, toImg, duration) {
    stopImageContentFade(state);
    const ms = Math.max(16, Number(duration) * 1000);
    state.image = toImg || fromImg || null;
    state._imageFade = {
        from: fromImg || null,
        to: toImg || null,
        u: 0,
        t0: performance.now(),
        duration: ms,
        raf: 0,
    };
    const tick = (now) => {
        const fade = state._imageFade;
        if (!fade) return;
        const raw = Math.min(1, (now - fade.t0) / fade.duration);
        fade.u = raw * raw * (3 - 2 * raw);
        drawContainerImage(state);
        if (scene.redraw) scene.redraw();
        if (raw < 1) fade.raf = requestAnimationFrame(tick);
        else {
            state.image = fade.to || null;
            state._imageFade = null;
            drawContainerImage(state);
            if (scene.redraw) scene.redraw();
        }
    };
    state._imageFade.raf = requestAnimationFrame(tick);
}

function setContainerImageFromUrl(state, url) {
    if (!state) return Promise.resolve();
    const next = url || null;
    if (next && next === state.imageSrc && state.image && !state._imageFade) {
        return Promise.resolve();
    }

    if (state.shaderRenderer) {
        clearShader(state);
    }
    if (next && !state.innerCtx) {
        try {
            state.innerCtx = state.innerCanvas.getContext("2d");
        } catch (e) {
            replaceInnerCanvas(state);
            state.innerCtx = state.innerCanvas.getContext("2d");
        }
    }

    const fadeSec = normalizeContentFadeSec(state.contentFade);
    const prevImg = state.image || null;
    const prevSrc = state.imageSrc || null;

    if (!next) {
        state.imageSrc = null;
        if (fadeSec > 0 && prevImg) {
            startImageContentFade(state, prevImg, null, fadeSec);
        } else {
            stopImageContentFade(state);
            state.image = null;
            if (state.innerCtx && state.innerCanvas) {
                state.innerCtx.clearRect(0, 0, state.innerCanvas.width, state.innerCanvas.height);
            }
            if (scene.redraw) scene.redraw();
        }
        return Promise.resolve();
    }

    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            state.imageSrc = next;
            state.imageMode = state.imageMode || "fill";
            if (fadeSec > 0 && prevImg && prevSrc !== next) {
                startImageContentFade(state, prevImg, img, fadeSec);
            } else {
                stopImageContentFade(state);
                state.image = img;
                drawContainerImage(state);
                if (scene.redraw) scene.redraw();
            }
            resolve();
        };
        img.onerror = () => {
            console.warn("Failed to load cover image");
            resolve();
        };
        img.src = next;
    });
}

/**
 * Replace flat text with a scrollable lyrics viewport (smooth vertical scroll).
 */
function setupSongLyricsBlock(state) {
    if (!state?.element) return;

    if (state.textEl) {
        state.textEl.style.display = "none";
    }

    // Prefer dedicated viewport class; migrate legacy prev/current/next block if needed
    let viewport = state.element.querySelector(".song-lyrics-viewport");
    if (!viewport) {
        const old = state.element.querySelector(".song-lyrics-block");
        if (old) old.remove();

        viewport = document.createElement("div");
        viewport.className = "song-lyrics-viewport song-lyrics-block";

        const track = document.createElement("div");
        track.className = "song-lyrics-track";
        viewport.appendChild(track);
        state.element.appendChild(viewport);
    }

    let track = viewport.querySelector(".song-lyrics-track");
    if (!track) {
        track = document.createElement("div");
        track.className = "song-lyrics-track";
        viewport.appendChild(track);
    }

    state.lyricsBlock = viewport;
    state.lyricsViewport = viewport;
    state.lyricsTrack = track;
    if (!Array.isArray(state.lyricLineTexts)) state.lyricLineTexts = [];
    if (state.lyricsFocusIndex == null) state.lyricsFocusIndex = -1;
    applyContainerBoxStyle(state);
}

// ── Empty-lyrics glitch FX (params from Music window) ─────────────────

// Printable specials mixed into glitch pools (punctuation, math, arrows, boxes)
const EMPTY_LYRICS_PUNCT = "!@#$%^&*()_+-=[]{}|;:',.<>/?`~\\\"°§¶†‡•…‰‹›«»¡¿¤¢£¥€©®™";
const EMPTY_LYRICS_MATH = "∫∑∏∆∇∂≠≈≤≥∞±×÷√≡∈∉∪∩∧∨⊕⊗µΩαβγδλπΣ";
const EMPTY_LYRICS_ARROWS = "←↑→↓↔↕⇐⇒⇔◀▶▲▼«»";
const EMPTY_LYRICS_BOX = "─│┌┐└┘├┤┬┴┼═║╔╗╚╝╠╣╦╩╬░▒▓█▄▀▌▐■□▪▫◆◇●○◎";

const EMPTY_LYRICS_CHARSETS = {
    /** Letters + digits + heavy specials (default) */
    mixed:
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
        + EMPTY_LYRICS_PUNCT
        + EMPTY_LYRICS_MATH
        + EMPTY_LYRICS_ARROWS
        + "░▒▓█",
    hex: "0123456789ABCDEF" + "!@#$%&*+-=?|/\\^~<>[]{}",
    binary: "01" + "!@#$%&*+-=?|/",
    ascii:
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
        + EMPTY_LYRICS_PUNCT,
    blocks: EMPTY_LYRICS_BOX + "◆◇●○◎◉▪▫■□▲▼◀▶",
    symbols: EMPTY_LYRICS_MATH + EMPTY_LYRICS_ARROWS + EMPTY_LYRICS_PUNCT + EMPTY_LYRICS_BOX,
    matrix:
        "ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ"
        + "0123456789"
        + EMPTY_LYRICS_PUNCT
        + "░▒▓█¦|",
    /** Specials only — no A–Z / 0–9 */
    special: EMPTY_LYRICS_PUNCT + EMPTY_LYRICS_MATH + EMPTY_LYRICS_ARROWS + EMPTY_LYRICS_BOX,
};

/** Live settings (updated via IPC from Music window). */
const emptyLyricsFx = {
    enabled: true,
    length: 18,
    lines: 3,
    rate: 14,
    change: 0.38,
    charset: "mixed",
};

function normalizeEmptyLyricsFx(raw) {
    const o = raw && typeof raw === "object" ? raw : {};
    const length = Math.round(Number(o.length));
    const lines = Math.round(Number(o.lines));
    const rate = Number(o.rate);
    const change = Number(o.change);
    let charset = String(o.charset || "mixed").toLowerCase();
    // Old default was hex-only; treat bare legacy default as mixed
    if (!EMPTY_LYRICS_CHARSETS[charset]) charset = "mixed";
    return {
        enabled: o.enabled !== false,
        length: Number.isFinite(length) ? Math.max(4, Math.min(48, length)) : 18,
        lines: Number.isFinite(lines) ? Math.max(1, Math.min(5, lines)) : 3,
        rate: Number.isFinite(rate) ? Math.max(0.5, Math.min(40, rate)) : 14,
        change: Number.isFinite(change) ? Math.max(0.02, Math.min(1, change)) : 0.38,
        charset,
    };
}

function normalizeTextGlitchSec(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.min(8, n);
}

function stopTextGlitch(state) {
    if (!state) return;
    if (state._textGlitch?.raf) cancelAnimationFrame(state._textGlitch.raf);
    state._textGlitch = null;
    state.element?.classList.remove("is-text-glitch");
    stopLyricsDecode(state);
}

function stopLyricsDecode(state) {
    if (!state) return;
    state._lyricsDecode = false;
    if (state._lyricsDecodeRaf) {
        cancelAnimationFrame(state._lyricsDecodeRaf);
        state._lyricsDecodeRaf = null;
    }
    state._lyricsDecodeJobs = null;
    state.element?.classList.remove("is-lyrics-decode");
}

function visibleLyricTrio(state) {
    if (state._emptyLyricsActive && Array.isArray(state._emptyLyricsBuffers)) {
        const rows = state._emptyLyricsBuffers.map((b) => (Array.isArray(b) ? b.join("") : String(b || "")));
        return [rows[0] || "", rows[1] || "", rows[2] || ""];
    }
    const texts = Array.isArray(state.lyricLineTexts) ? state.lyricLineTexts : [];
    const els = state.lyricsTrack ? Array.from(state.lyricsTrack.children) : [];
    const at = (i) => {
        if (i == null || i < 0) return "";
        if (els[i] && els[i].textContent) return els[i].textContent;
        return String(texts[i] || "");
    };
    if (els.length <= 3 && texts.length <= 3) {
        return [at(0), at(1), at(2)];
    }
    const idx = state.lyricsFocusIndex >= 0 ? state.lyricsFocusIndex : 0;
    return [at(idx - 1), at(idx), at(idx + 1)];
}

function lyricTrioAt(lines, idx) {
    const t = (Array.isArray(lines) ? lines : []).map((s) => String(s || "").trim());
    if (!t.length) return ["", "…", ""];
    const i = Math.max(0, Math.min(t.length - 1, Number(idx) || 0));
    return [i > 0 ? t[i - 1] : "", t[i] || "…", i < t.length - 1 ? t[i + 1] : ""];
}

function resolveLyricIndex(lines, focus) {
    if (!focus || !Array.isArray(lines) || !lines.length) return -1;
    const idx = Number(focus.index);
    if (Number.isFinite(idx) && idx >= 0 && idx < lines.length) return idx;
    const cur = String(focus.current || "").trim();
    if (cur && cur !== "…" && cur !== "No lyrics for this track") {
        const found = lines.findIndex((row) => String(row || "").trim() === cur);
        if (found >= 0) return found;
    }
    return -1;
}

function commitLyricsTrack(state, texts, focus) {
    const track = state.lyricsTrack;
    if (!track) return;
    state.lyricLineTexts = texts;
    track.innerHTML = "";
    for (let i = 0; i < texts.length; i++) {
        const line = document.createElement("div");
        line.className = "song-lyrics-line";
        line.dataset.index = String(i);
        const t = String(texts[i] || "").trim();
        line.textContent = t || "♪";
        line.classList.toggle("empty", !t);
        track.appendChild(line);
    }
    const idx = resolveLyricIndex(texts, focus);
    if (idx >= 0) {
        state.lyricsFocusIndex = idx;
        scrollLyricsToIndex(state, idx, false, idx);
    } else {
        state.lyricsFocusIndex = -1;
        scrollLyricsToIndex(state, 0, false, -1);
    }
}

function startLyricsDecodeGlitch(state, nextLines, durationSec) {
    if (!state?.lyricsTrack) setupSongLyricsBlock(state);
    const dur = normalizeTextGlitchSec(durationSec);
    if (dur <= 0) {
        stopEmptyLyricsGlitch(state);
        commitLyricsTrack(state, nextLines);
        return;
    }

    const fromTrio = visibleLyricTrio(state);
    const hint = state._pendingLyricFocus || scene.lastLyricFocus || null;
    let focusIdx = resolveLyricIndex(nextLines, hint);
    if (focusIdx < 0) focusIdx = 0;
    const toTrio = lyricTrioAt(nextLines, focusIdx);
    const charset = emptyLyricsFx.charset || "mixed";

    stopEmptyLyricsGlitch(state);
    if (state._textGlitch?.raf) {
        cancelAnimationFrame(state._textGlitch.raf);
        state._textGlitch = null;
        state.element?.classList.remove("is-text-glitch");
    }
    stopLyricsDecode(state);

    const track = state.lyricsTrack;
    track.innerHTML = "";
    const jobs = [];
    for (let i = 0; i < 3; i++) {
        const el = document.createElement("div");
        const from = fromTrio[i] || "";
        const to = toTrio[i] || "";
        const n = Math.max(from.length, to.length, 10);
        const buf = [];
        for (let c = 0; c < n; c++) buf.push(from[c] || randomEmptyLyricsChar(charset));
        el.className = "song-lyrics-line" + (i === 1 ? " active" : " near");
        el.textContent = buf.join("");
        track.appendChild(el);
        jobs.push({ el, buf, to, n });
    }

    state._pendingLyricLines = nextLines;
    state._lyricsDecodeJobs = jobs;
    state._lyricsDecodeIndex = focusIdx;
    state.lyricLineTexts = toTrio.slice();
    state.lyricsFocusIndex = 1;
    state._lyricsDecode = true;
    state.element?.classList.add("is-lyrics-decode");
    scrollLyricsToIndex(state, 1, false, 1);

    const t0 = performance.now();
    const ms = dur * 1000;
    let last = t0;
    const interval = 1000 / Math.max(8, Number(emptyLyricsFx.rate) || 14);

    const tick = (now) => {
        if (!state._lyricsDecode) return;
        if (now - last < interval) {
            state._lyricsDecodeRaf = requestAnimationFrame(tick);
            return;
        }
        last = now;
        const u = Math.min(1, (now - t0) / ms);
        const change = Math.max(0.2, Number(emptyLyricsFx.change) || 0.38);
        for (const job of jobs) {
            const lockCount = Math.floor(job.n * Math.min(1, u * 1.12));
            for (let c = 0; c < job.n; c++) {
                if (c < lockCount) job.buf[c] = job.to[c] ?? " ";
                else if (Math.random() < change) job.buf[c] = randomEmptyLyricsChar(charset);
            }
            job.el.textContent = job.buf.join("");
        }
        if (scene.redraw) scene.redraw();
        if (u < 1) {
            state._lyricsDecodeRaf = requestAnimationFrame(tick);
            return;
        }
        finishLyricsDecode(state);
    };
    state._lyricsDecodeRaf = requestAnimationFrame(tick);
}

function retargetLyricsDecode(state, focus) {
    if (!state?._lyricsDecode || !Array.isArray(state._lyricsDecodeJobs)) return false;
    const lines = state._pendingLyricLines;
    const idx = resolveLyricIndex(lines, focus);
    if (idx < 0) return false;
    const trio = lyricTrioAt(lines, idx);
    const charset = emptyLyricsFx.charset || "mixed";
    state._lyricsDecodeIndex = idx;
    state._pendingLyricFocus = focus;
    for (let i = 0; i < state._lyricsDecodeJobs.length; i++) {
        const job = state._lyricsDecodeJobs[i];
        const nextTo = trio[i] || "";
        job.to = nextTo;
        if (nextTo.length > job.n) {
            while (job.buf.length < nextTo.length) {
                job.buf.push(randomEmptyLyricsChar(charset));
            }
            job.n = nextTo.length;
        }
    }
    return true;
}

function finishLyricsDecode(state) {
    if (!state) return;
    const pending = Array.isArray(state._pendingLyricLines) ? state._pendingLyricLines : null;
    const focus = state._pendingLyricFocus || scene.lastLyricFocus || null;
    const idx = Number.isFinite(state._lyricsDecodeIndex) ? state._lyricsDecodeIndex : -1;
    state._pendingLyricLines = null;
    state._pendingLyricFocus = null;
    state._lyricsDecodeJobs = null;
    stopLyricsDecode(state);
    if (pending && pending.length) {
        commitLyricsTrack(state, pending, focus || { index: idx });
        if (focus && resolveLyricIndex(pending, focus) >= 0) {
            setSongLyricsFocus(state, focus);
        }
    }
    if (scene.redraw) scene.redraw();
}

/**
 * Decode/scramble `from` → `to` the way empty-lyrics glitch looks,
 * settling left-to-right into the target string.
 */
function decodeGlitchFrame(from, to, u, seeds) {
    const target = String(to ?? "");
    const source = String(from ?? "");
    const n = Math.max(target.length, source.length, 1);
    let out = "";
    for (let i = 0; i < n; i++) {
        const gate = seeds[i] != null ? seeds[i] : (0.12 + (i / Math.max(1, n - 1)) * 0.75);
        if (u >= gate) out += target[i] ?? "";
        else if (u < 0.06) out += source[i] ?? randomEmptyLyricsChar("mixed");
        else out += randomEmptyLyricsChar("mixed");
    }
    return out;
}

function startTextGlitch(state, channels, durationSec, opts = {}) {
    if (!state || !Array.isArray(channels) || !channels.length) return false;
    const dur = normalizeTextGlitchSec(durationSec);
    if (dur <= 0) return false;
    stopTextGlitch(state);
    const jobs = channels.map((ch) => {
        const to = String(ch.to ?? "");
        const from = String(ch.from ?? "");
        const n = Math.max(to.length, from.length, 4);
        const seeds = [];
        for (let i = 0; i < n; i++) {
            seeds.push(0.1 + (i / Math.max(1, n - 1)) * 0.72 + Math.random() * 0.16);
        }
        return { set: ch.set, from, to, seeds, n };
    });
    state._textGlitch = { t0: performance.now(), dur: dur * 1000, jobs, raf: 0 };
    state.element?.classList.add("is-text-glitch");
    const tick = (now) => {
        const g = state._textGlitch;
        if (!g) return;
        const u = Math.min(1, (now - g.t0) / g.dur);
        for (const job of g.jobs) {
            if (typeof job.set === "function") {
                job.set(decodeGlitchFrame(job.from, job.to, u, job.seeds));
            }
        }
        if (typeof opts.onFrame === "function") opts.onFrame(u);
        if (u < 1) g.raf = requestAnimationFrame(tick);
        else {
            for (const job of g.jobs) {
                if (typeof job.set === "function") job.set(job.to);
            }
            stopTextGlitch(state);
            if (typeof opts.onDone === "function") opts.onDone();
        }
    };
    state._textGlitch.raf = requestAnimationFrame(tick);
    return true;
}

function applyEmptyLyricsFxSettings(raw) {
    Object.assign(emptyLyricsFx, normalizeEmptyLyricsFx(raw));
    const lyrics = scene.songPanels.lyrics;
    if (!lyrics) return;
    // Only re-run placeholder path when we're currently in empty mode
    const hasList = Array.isArray(lyrics.lyricLineTexts) && lyrics.lyricLineTexts.length > 0;
    if (!hasList || lyrics._emptyLyricsActive) {
        setSongLyricsFocus(lyrics, {
            hasLyrics: false,
            current: emptyLyricsFx.enabled ? "" : "No lyrics for this track",
        });
    }
}

function randomEmptyLyricsChar(charset) {
    const set = EMPTY_LYRICS_CHARSETS[charset] || EMPTY_LYRICS_CHARSETS.mixed;
    return set[Math.floor(Math.random() * set.length)];
}

function randomEmptyLyricsString(len, charset) {
    let s = "";
    const n = Math.max(1, len | 0);
    for (let i = 0; i < n; i++) s += randomEmptyLyricsChar(charset);
    return s;
}

function stopEmptyLyricsGlitch(state) {
    if (!state) return;
    state._emptyLyricsActive = false;
    if (state._emptyLyricsRaf != null) {
        cancelAnimationFrame(state._emptyLyricsRaf);
        state._emptyLyricsRaf = null;
    }
    state._emptyLyricsBuffers = null;
    if (state.element) state.element.classList.remove("is-empty-glitch");
}

/**
 * Build placeholder glitch lines and start the scramble loop.
 * @param {object} state lyrics container state
 */
function startEmptyLyricsGlitch(state) {
    if (!state) return;
    if (!state.lyricsTrack) setupSongLyricsBlock(state);

    stopLyricsDecode(state);
    stopEmptyLyricsGlitch(state);
    if (!emptyLyricsFx.enabled) {
        // Static fallback message
        const track = state.lyricsTrack;
        track.innerHTML = "";
        const line = document.createElement("div");
        line.className = "song-lyrics-line empty placeholder active";
        line.textContent = "No lyrics for this track";
        track.appendChild(line);
        state.lyricLineTexts = [];
        state.lyricsFocusIndex = -1;
        scrollLyricsToIndex(state, 0, false);
        return;
    }

    const nLines = emptyLyricsFx.lines;
    const len = emptyLyricsFx.length;
    const charset = emptyLyricsFx.charset;
    const track = state.lyricsTrack;
    track.innerHTML = "";
    state._emptyLyricsBuffers = [];
    state.lyricLineTexts = [];
    state.lyricsFocusIndex = -1;
    state.element?.classList.add("is-empty-glitch");

    const mid = Math.floor((nLines - 1) / 2);
    for (let i = 0; i < nLines; i++) {
        const buf = randomEmptyLyricsString(len, charset).split("");
        state._emptyLyricsBuffers.push(buf);
        const line = document.createElement("div");
        line.className = "song-lyrics-line empty-glitch" + (i === mid ? " active" : " near");
        line.dataset.glitchIndex = String(i);
        line.textContent = buf.join("");
        track.appendChild(line);
    }
    scrollLyricsToIndex(state, mid, false, mid);

    state._emptyLyricsActive = true;
    let last = performance.now();

    const tick = (now) => {
        if (!state._emptyLyricsActive) return;
        const interval = 1000 / Math.max(0.5, emptyLyricsFx.rate);
        if (now - last >= interval) {
            last = now;
            tickEmptyLyricsGlitch(state);
        }
        state._emptyLyricsRaf = requestAnimationFrame(tick);
    };
    state._emptyLyricsRaf = requestAnimationFrame(tick);
}

function tickEmptyLyricsGlitch(state) {
    const buffers = state._emptyLyricsBuffers;
    const track = state.lyricsTrack;
    if (!buffers || !track) return;

    const charset = emptyLyricsFx.charset;
    const change = emptyLyricsFx.change;
    const targetLen = emptyLyricsFx.length;
    const targetLines = emptyLyricsFx.lines;

    // Rebuild DOM line count if param changed live
    if (buffers.length !== targetLines || track.children.length !== targetLines) {
        startEmptyLyricsGlitch(state);
        return;
    }

    for (let i = 0; i < buffers.length; i++) {
        let buf = buffers[i];
        // Resize string if length param changed
        if (buf.length < targetLen) {
            while (buf.length < targetLen) buf.push(randomEmptyLyricsChar(charset));
        } else if (buf.length > targetLen) {
            buf.length = targetLen;
        }
        for (let c = 0; c < buf.length; c++) {
            if (Math.random() < change) {
                buf[c] = randomEmptyLyricsChar(charset);
            }
        }
        const el = track.children[i];
        if (el) el.textContent = buf.join("");
    }
    state.text = buffers.map((b) => b.join("")).join("\n");
}

/**
 * Rebuild the scroll track from full lyric line list.
 * @param {object} state
 * @param {string[]} lines
 */
function rebuildLyricsTrack(state, lines = []) {
    if (!state) return;
    if (!state.lyricsTrack) setupSongLyricsBlock(state);

    const texts = Array.isArray(lines) ? lines.map((t) => String(t ?? "")) : [];

    // Empty list → glitch FX or static placeholder (do not leave "No lyrics" by default)
    if (!texts.length) {
        startEmptyLyricsGlitch(state);
        return;
    }

    const fade = normalizeTextGlitchSec(state.textGlitch);
    const prevTexts = Array.isArray(state.lyricLineTexts) ? state.lyricLineTexts : [];
    const same = !state._emptyLyricsActive
        && !state._lyricsDecode
        && texts.length === prevTexts.length
        && texts.every((t, i) => t === prevTexts[i]);
    if (same) return;

    if (state._lyricsDecode && Array.isArray(state._pendingLyricLines)
        && state._pendingLyricLines.length === texts.length
        && state._pendingLyricLines.every((t, i) => t === texts[i])) {
        return;
    }

    const hasPrior = !!(state._emptyLyricsActive
        || (state.lyricsTrack && state.lyricsTrack.children.length)
        || prevTexts.length);
    if (fade > 0 && hasPrior) {
        startLyricsDecodeGlitch(state, texts, fade);
        return;
    }

    stopEmptyLyricsGlitch(state);
    stopLyricsDecode(state);
    commitLyricsTrack(state, texts);
}

/**
 * Viewport content-box height (excludes padding) — the region lyrics scroll in.
 * @param {HTMLElement} viewport
 * @param {object} [state]
 * @returns {{ contentH: number, padT: number, padB: number }}
 */
function measureLyricsViewportContent(viewport, state) {
    const cs = getComputedStyle(viewport);
    const padT = parseFloat(cs.paddingTop) || 0;
    const padB = parseFloat(cs.paddingBottom) || 0;
    // clientHeight includes padding; content box is what the track lives in
    const clientH = viewport.clientHeight
        || viewport.getBoundingClientRect().height
        || state?.height
        || 1;
    const contentH = Math.max(1, clientH - padT - padB);
    return { contentH, padT, padB };
}

/**
 * Geometric vertical center of a line inside the track, independent of current
 * translate (both rects include the same transform). Accounts for wrapping,
 * font-size, padding, and multi-line line boxes.
 * @param {HTMLElement} lineEl
 * @param {HTMLElement} track
 * @returns {number}
 */
function measureLyricLineCenterInTrack(lineEl, track) {
    const trackRect = track.getBoundingClientRect();
    const lineRect = lineEl.getBoundingClientRect();
    if (lineRect.height < 0.5 || trackRect.height < 0.5) {
        // Fallback before first layout
        return (lineEl.offsetTop || 0) + (lineEl.offsetHeight || 0) / 2;
    }
    return (lineRect.top - trackRect.top) + lineRect.height / 2;
}

/**
 * Compute translateY that places the target line's box center on the viewport
 * content-box center.
 * @param {HTMLElement} viewport
 * @param {HTMLElement} track
 * @param {HTMLElement} lineEl
 * @param {object} [state]
 * @returns {number}
 */
function computeLyricsScrollY(viewport, track, lineEl, state) {
    const { contentH } = measureLyricsViewportContent(viewport, state);
    const lineCenter = measureLyricLineCenterInTrack(lineEl, track);
    return contentH / 2 - lineCenter;
}

/**
 * Center a lyric line in the viewport. Uses CSS transform transition when animate=true.
 * Measures final layout (active font size, wrapping, padding) with transitions frozen
 * so the line's geometric center lands on the content-box center.
 * @param {object} state
 * @param {number} index — line to center in the viewport
 * @param {boolean} [animate=true]
 * @param {number|null} [activeIndex=index] — line that gets .active (null/-1 = none)
 */
function scrollLyricsToIndex(state, index, animate = true, activeIndex = index) {
    const viewport = state?.lyricsViewport;
    const track = state?.lyricsTrack;
    if (!viewport || !track) return;

    const lines = track.children;
    if (!lines.length) return;

    const i = Math.max(0, Math.min(lines.length - 1, Number(index) || 0));
    const active = (activeIndex == null || activeIndex < 0)
        ? -1
        : Math.max(0, Math.min(lines.length - 1, Number(activeIndex)));

    // Update active / near styling before measuring
    for (let n = 0; n < lines.length; n++) {
        const el = lines[n];
        el.classList.toggle("active", n === active);
        el.classList.toggle("near", active >= 0 && (n === active - 1 || n === active + 1));
    }
    // Soft highlight first line when waiting for first timed lyric
    if (active < 0 && lines[0] && i === 0) {
        lines[0].classList.add("near");
    }

    const applyTransform = () => {
        const lineEl = lines[i];
        if (!lineEl) return;

        // Freeze transitions so font-size / wrap layout is final before measure
        track.classList.add("is-measuring");
        // Force style + layout flush with final active metrics
        void track.offsetHeight;

        const y = Math.round(computeLyricsScrollY(viewport, track, lineEl, state));
        state._lyricsScrollY = y;

        if (!animate) {
            track.style.transition = "none";
            track.style.transform = `translate3d(0, ${y}px, 0)`;
            void track.offsetHeight;
            track.style.transition = "";
        } else {
            track.style.transform = `translate3d(0, ${y}px, 0)`;
        }

        track.classList.remove("is-measuring");
    };

    // Wait two frames so DOM classes/vars, wrap width, and active metrics are committed
    const schedule = () => {
        requestAnimationFrame(() => {
            requestAnimationFrame(applyTransform);
        });
    };

    // If web fonts are still loading, re-center once they settle (metrics can shift)
    if (typeof document !== "undefined" && document.fonts?.status === "loading") {
        document.fonts.ready.then(() => {
            if (state.lyricsTrack === track) {
                requestAnimationFrame(applyTransform);
            }
        }).catch(() => { /* ignore */ });
    }

    schedule();
}

/**
 * Re-center the currently focused lyric after box/typography/size changes.
 * @param {object} state
 * @param {boolean} [animate=false]
 */
function recenterLyrics(state, animate = false) {
    if (!state?.lyricsTrack || !state?.lyricsViewport) return;
    if (state._lyricsDecode) {
        scrollLyricsToIndex(state, 1, false, 1);
        return;
    }
    const idx = state.lyricsFocusIndex >= 0 ? state.lyricsFocusIndex : 0;
    const active = state.lyricsFocusIndex >= 0 ? state.lyricsFocusIndex : -1;
    // When waiting for first cue, keep first line centered with no active
    if (state.lyricsFocusIndex < 0) {
        scrollLyricsToIndex(state, 0, animate, -1);
    } else {
        scrollLyricsToIndex(state, idx, animate, active);
    }
}

/**
 * Update focused lyric line and smoothly scroll it into the center.
 * Does NOT resize the panel (size is locked per song).
 * @param {object} state
 * @param {{ prev?: string, current?: string, next?: string, hasLyrics?: boolean, index?: number }} focus
 */
function setSongLyricsFocus(state, focus = {}) {
    if (!state) return;
    if (state._lyricsDecode) {
        if (!retargetLyricsDecode(state, focus)) state._pendingLyricFocus = focus;
        return;
    }
    if (!state.lyricsTrack) setupSongLyricsBlock(state);

    const hasList = Array.isArray(state.lyricLineTexts) && state.lyricLineTexts.length > 0;
    const hasLyrics = focus.hasLyrics !== false && (
        hasList
        || !!(focus.current && focus.current.trim())
        || !!(focus.prev && focus.prev.trim())
        || !!(focus.next && focus.next.trim())
        || focus.hasLyrics === true
    );

    if (!hasLyrics) {
        // Empty / no-lyrics mode — random-character glitch (or static if FX disabled)
        if (!state._emptyLyricsActive) {
            startEmptyLyricsGlitch(state);
        } else if (!emptyLyricsFx.enabled) {
            startEmptyLyricsGlitch(state); // rebuild static placeholder
        }
        // Do NOT reposition here — live lyric updates would snap user-dragged placement
        return;
    }

    // Real lyrics — stop glitch if it was running
    if (state._emptyLyricsActive) {
        stopEmptyLyricsGlitch(state);
    }

    // Ensure track exists for this song
    if (!hasList) {
        // Fallback: build a tiny 3-line list from prev/current/next
        const fallback = [
            (focus.prev || "").trim(),
            (focus.current || "").trim() || "…",
            (focus.next || "").trim(),
        ];
        rebuildLyricsTrack(state, fallback);
        scrollLyricsToIndex(state, 1, false);
        state.lyricsFocusIndex = 1;
        state.text = fallback.filter(Boolean).join("\n");
        if (state.textEl) state.textEl.textContent = state.text;
        return;
    }

    let idx = Number(focus.index);
    if (!Number.isFinite(idx)) idx = -1;

    // Before first timed line: keep first line centered, no active emphasis
    if (idx < 0) {
        const prevActive = state.lyricsFocusIndex;
        state.lyricsFocusIndex = -1;
        const animate = prevActive != null && prevActive >= 0;
        scrollLyricsToIndex(state, 0, animate, -1);
        state.text = "…";
        if (state.textEl) state.textEl.textContent = state.text;
        return;
    }

    idx = Math.max(0, Math.min(state.lyricLineTexts.length - 1, idx));
    const prevIdx = state.lyricsFocusIndex;
    // Animate whenever the focused line changes (including first cue from -1 → 0)
    const animate = prevIdx !== idx;
    state.lyricsFocusIndex = idx;

    scrollLyricsToIndex(state, idx, animate, idx);

    const cur = (state.lyricLineTexts[idx] || "").trim()
        || (focus.current || "").trim()
        || "…";
    const prev = idx > 0 ? (state.lyricLineTexts[idx - 1] || "").trim() : "";
    const next = idx < state.lyricLineTexts.length - 1
        ? (state.lyricLineTexts[idx + 1] || "").trim()
        : "";
    state.text = [prev, cur, next].filter(Boolean).join("\n");
    if (state.textEl) state.textEl.textContent = state.text;
}

/**
 * Lock lyrics panel to a static size large enough for every line in the song.
 * Width from longest lyric; height from the 3-line focus layout.
 * @param {object} state
 * @param {string[]} [lines]
 */
function lockLyricsPanelSize(state, lines = []) {
    if (!state?.element) return;
    if (!state.lyricsBlock) setupSongLyricsBlock(state);

    // Preset / snapshot / already-baked design geometry is the look.
    // Never rewrite this box in live stage pixels (that unscales lyrics on a small canvas).
    if (state.layoutDesign || state.layoutPinned) {
        state.lyricsSizeLocked = true;
        if (state.layoutDesign) applyLiveFromDesign(state);
        if (state.lyricsViewport) {
            state.lyricsViewport.style.width = "100%";
            state.lyricsViewport.style.maxWidth = "100%";
            state.lyricsViewport.style.height = "100%";
        }
        if (state.lyricsTrack) {
            requestAnimationFrame(() => recenterLyrics(state, false));
        }
        return;
    }

    const design = getDesignFloatSize();
    const maxW = Math.min(440, Math.round(design.width * 0.9));
    const minW = Math.min(200, maxW);

    const texts = (Array.isArray(lines) ? lines : [])
        .map((t) => String(t || "").trim())
        .filter(Boolean);

    const measure = document.createElement("canvas").getContext("2d");
    const base = Math.max(12, Number(state.style?.text?.fontSize) || 12);
    measure.font = `700 ${Math.round(base * 1.5)}px system-ui, -apple-system, "Segoe UI", sans-serif`;

    let maxTextW = 0;
    for (const t of texts) {
        maxTextW = Math.max(maxTextW, measure.measureText(t).width);
    }
    maxTextW = Math.max(maxTextW, measure.measureText("No lyrics for this track").width);

    const w = Math.max(minW, Math.min(maxW, Math.ceil(maxTextW + 40)));
    const h = 118;
    const prev = state.layoutDesign || {};
    state.layoutDesign = {
        left: prev.left != null ? prev.left : 0,
        top: prev.top != null ? prev.top : 0,
        width: w,
        height: h,
    };
    applyLiveFromDesign(state);
    state.lyricsSizeLocked = true;
    state.lyricsLockedWidth = w;
    state.lyricsLockedHeight = h;

    if (state.lyricsViewport) {
        state.lyricsViewport.style.width = "100%";
        state.lyricsViewport.style.maxWidth = "100%";
        state.lyricsViewport.style.height = "100%";
    }
    if (state.lyricsBlock) {
        state.lyricsBlock.style.width = "100%";
        state.lyricsBlock.style.maxWidth = "100%";
    }
    if (state.lyricsTrack) {
        requestAnimationFrame(() => recenterLyrics(state, false));
    }

    repositionLyricsPanel(state);
    void lines;
}

/**
 * Mark geometry as user/preset-owned so auto-layout helpers stop moving the box.
 * @param {object} state
 */
function pinContainerLayout(state) {
    if (state) state.layoutPinned = true;
}

/**
 * Keep a box inside the float area without changing stacking order / auto layout.
 * Float area is the top stage, or full shell when bottom strip is included.
 */
function clampContainerInPanel(state) {
    if (!state?.element) return;
    const area = getFloatAreaSize();
    const panelW = area.width;
    const panelH = area.height;
    const w = state.width != null ? state.width : state.element.offsetWidth;
    const h = state.height != null ? state.height : state.element.offsetHeight;
    let left = state.left != null ? state.left : state.element.offsetLeft;
    let top = state.top != null ? state.top : state.element.offsetTop;
    left = Math.max(0, Math.min(Math.max(0, panelW - w), left));
    top = Math.max(0, Math.min(Math.max(0, panelH - h), top));
    if (left === state.left && top === state.top) return;
    setContainerPosition(state, left, top);
}

/**
 * Place lyrics panel under track info without changing its locked size.
 * Skipped when the user has dragged/resized (or Controls/preset set position).
 * @param {object} state
 * @param {{ force?: boolean }} [opts]
 */
function repositionLyricsPanel(state, opts = {}) {
    if (!state?.element) return;
    if ((state.layoutPinned || state.layoutDesign) && !opts.force) {
        clampContainerInPanel(state);
        return;
    }
    const area = getFloatAreaSize();
    const panelW = area.width;
    const panelH = area.height;
    const w = state.width != null ? state.width : state.element.offsetWidth;
    const h = state.height != null ? state.height : state.element.offsetHeight;

    const info = scene.songPanels.info;
    const cover = scene.songPanels.cover;
    let left = Math.round((panelW - w) / 2);
    let top = state.top != null ? state.top : state.element.offsetTop;

    const anchor = info?.element ? info : cover;
    if (anchor?.element) {
        const aTop = anchor.top != null ? anchor.top : anchor.element.offsetTop;
        const aH = anchor.height != null ? anchor.height : anchor.element.offsetHeight;
        top = aTop + aH + 14;
    }

    top = Math.max(8, Math.min(panelH - h - 8, top));
    left = Math.max(8, Math.min(panelW - w - 8, left));
    setContainerPosition(state, left, top);
}

/** Normalize progress time layout: "ends" (default) | "center". */
function normalizeProgressTimeMode(mode) {
    const m = String(mode || "ends").toLowerCase().trim();
    return m === "center" || m === "2" || m === "stamp" ? "center" : "ends";
}

/** Format seconds as m:ss or h:mm:ss for the progress panel. */
function formatPlaybackTime(seconds) {
    let s = Math.max(0, Math.floor(Number(seconds) || 0));
    const h = Math.floor(s / 3600);
    s %= 3600;
    const m = Math.floor(s / 60);
    const r = s % 60;
    if (h > 0) {
        return `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
    }
    return `${m}:${String(r).padStart(2, "0")}`;
}

/**
 * Wire the song-progress floating box: full-bleed canvas bar + dual-tone times.
 * Layout modes (controls):
 *   - ends (default): current at left, total at right (on the bar)
 *   - center: "1:24 / 3:51" centered on the bar
 * Glyphs over the filled (black) region are white; over the empty region are black.
 */
function setupSongProgressBar(state) {
    if (!state?.element) return;

    if (state.textEl) {
        state.textEl.style.display = "none";
    }

    if (state.shaderRenderer) {
        clearShader(state);
    }

    // Ensure canvas is a direct full-bleed child of the panel (not nested under UI chrome)
    if (state.innerCanvas) {
        state.innerCanvas.classList.add("song-progress-canvas");
        state.innerCanvas.style.position = "absolute";
        state.innerCanvas.style.left = "0";
        state.innerCanvas.style.top = "0";
        state.innerCanvas.style.width = "100%";
        state.innerCanvas.style.height = "100%";
        state.innerCanvas.style.display = "block";
        state.innerCanvas.style.zIndex = "1";
        if (state.innerCanvas.parentElement !== state.element) {
            state.element.appendChild(state.innerCanvas);
        }
    }

    // Remove legacy layout chrome if present from older sessions
    const legacyUi = state.element.querySelector(".song-progress-ui");
    if (legacyUi) legacyUi.remove();

    if (!state.innerCtx && state.innerCanvas) {
        try {
            state.innerCtx = state.innerCanvas.getContext("2d");
        } catch (e) {
            replaceInnerCanvas(state);
            state.innerCtx = state.innerCanvas.getContext("2d");
            if (state.innerCanvas) {
                state.innerCanvas.classList.add("song-progress-canvas");
                state.innerCanvas.style.position = "absolute";
                state.innerCanvas.style.left = "0";
                state.innerCanvas.style.top = "0";
                state.innerCanvas.style.width = "100%";
                state.innerCanvas.style.height = "100%";
            }
        }
    }

    state.playbackProgress = state.playbackProgress || 0;
    state.playbackCurrentTime = state.playbackCurrentTime || 0;
    state.playbackDuration = state.playbackDuration || 0;
    state.progressReady = true;
    applyProgressTimeMode(state, state.progressTimeMode || "ends", { skipDraw: true });
}

/**
 * Switch progress time stamp layout and refresh the bar.
 * @param {object} state
 * @param {string} mode — "center" | "ends"
 * @param {{ skipDraw?: boolean }} [opts]
 */
function applyProgressTimeMode(state, mode, opts = {}) {
    if (!state?.element) return;
    const m = normalizeProgressTimeMode(mode);
    state.progressTimeMode = m;
    state.element.classList.toggle("time-mode-center", m === "center");
    state.element.classList.toggle("time-mode-ends", m === "ends");
    if (!opts.skipDraw) {
        setSongProgress(state, state.playbackProgress || 0, {
            currentTime: state.playbackCurrentTime,
            duration: state.playbackDuration,
        });
    }
}

/**
 * Draw text that stays readable over the progress fill:
 * black on the unfilled (light) region, white on the filled (dark) region.
 * Clips each pass so the split can cut through individual glyphs.
 */
function drawProgressTimeContrasted(ctx, text, x, y, align, fillW, totalW, totalH) {
    if (!text) return;
    ctx.textBaseline = "middle";
    ctx.textAlign = align;

    const fw = Math.max(0, Math.min(totalW, fillW));

    // Black — only over the empty (right) side of the bar
    if (fw < totalW) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(fw, 0, totalW - fw, totalH);
        ctx.clip();
        ctx.fillStyle = "#111111";
        ctx.fillText(text, x, y);
        ctx.restore();
    }

    // White — only over the filled (left) side of the bar
    if (fw > 0) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, fw, totalH);
        ctx.clip();
        ctx.fillStyle = "#ffffff";
        ctx.fillText(text, x, y);
        ctx.restore();
    }
}

/**
 * Draw full-bleed progress fill + dual-tone time stamps on the canvas.
 * progress 0 = empty, 0.5 = half, 1 = full.
 * @param {object} state
 * @param {number} progress — 0..1
 * @param {{ currentTime?: number, duration?: number }} [meta]
 */
function setSongProgress(state, progress, meta = {}) {
    if (!state) return;
    if (!state.progressReady) {
        setupSongProgressBar(state);
    }
    if (!state.innerCtx && state.innerCanvas) {
        try {
            state.innerCtx = state.innerCanvas.getContext("2d");
        } catch (e) {
            replaceInnerCanvas(state);
            state.innerCtx = state.innerCanvas.getContext("2d");
        }
    }
    if (!state.innerCtx || !state.innerCanvas) return;

    const p = Math.min(1, Math.max(0, Number(progress) || 0));
    state.playbackProgress = p;
    if (meta.currentTime != null) state.playbackCurrentTime = Number(meta.currentTime) || 0;
    if (meta.duration != null) state.playbackDuration = Number(meta.duration) || 0;

    const cur = state.playbackCurrentTime || 0;
    const dur = state.playbackDuration || 0;
    let curStr = formatPlaybackTime(cur);
    let durStr = formatPlaybackTime(dur);
    const trackKey = String(Math.round((dur || 0) * 100));
    const fade = normalizeTextGlitchSec(state.textGlitch);
    if (fade > 0 && state._progressTrackKey && state._progressTrackKey !== trackKey) {
        const prevCur = state._progressShownCur || curStr;
        const prevDur = state._progressShownDur || durStr;
        state._progressGlitch = {
            fromCur: prevCur,
            fromDur: prevDur,
            t0: performance.now(),
            dur: fade * 1000,
        };
    }
    if (trackKey) state._progressTrackKey = trackKey;
    if (state._progressGlitch) {
        const g = state._progressGlitch;
        const raw = Math.min(1, (performance.now() - g.t0) / g.dur);
        const u = raw * raw * (3 - 2 * raw);
        if (!g.curSeeds) {
            const n = Math.max(curStr.length, g.fromCur.length, 4);
            g.curSeeds = Array.from({ length: n }, (_, i) => 0.1 + (i / Math.max(1, n - 1)) * 0.75 + Math.random() * 0.12);
            const m = Math.max(durStr.length, g.fromDur.length, 4);
            g.durSeeds = Array.from({ length: m }, (_, i) => 0.1 + (i / Math.max(1, m - 1)) * 0.75 + Math.random() * 0.12);
        }
        curStr = decodeGlitchFrame(g.fromCur, curStr, u, g.curSeeds);
        durStr = decodeGlitchFrame(g.fromDur, durStr, u, g.durSeeds);
        if (raw >= 1) state._progressGlitch = null;
    }
    state._progressShownCur = curStr;
    state._progressShownDur = durStr;

    // Canvas bitmap matches the full container (border-box logical size)
    const cssW = Math.max(1, Math.round(state.width || state.element?.clientWidth || 1));
    const cssH = Math.max(1, Math.round(state.height || state.element?.clientHeight || 1));
    const canvas = state.innerCanvas;
    if (canvas.width !== cssW || canvas.height !== cssH) {
        canvas.width = cssW;
        canvas.height = cssH;
    }

    const w = Math.max(1, canvas.width);
    const h = Math.max(1, canvas.height);
    const ctx = state.innerCtx;
    const fillW = Math.max(0, Math.round(w * p));

    // Full-bleed track + fill
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    if (fillW > 0) {
        ctx.fillStyle = "#111111";
        ctx.fillRect(0, 0, fillW, h);
    }

    // Dual-tone timestamps — design type, or ~42% of the live bar if unset
    const designFont = Number(state.style?.text?.fontSize ?? state.style?.label?.fontSize);
    const fromDesign = Number.isFinite(designFont) && designFont > 0
        ? liveFontSize(designFont)
        : livePx(12);
    const fromBar = h * 0.42;
    const fontSize = Math.max(1, Math.min(fromDesign, Math.max(fromBar, 1)));
    const padX = Math.max(livePx(6), Math.round(h * 0.28));
    ctx.font = `500 ${fontSize}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    // Slight letter-spacing via measure is fine; tabular feel from mono-ish size
    const midY = h * 0.5;
    const mode = normalizeProgressTimeMode(state.progressTimeMode || "ends");

    if (mode === "ends") {
        drawProgressTimeContrasted(ctx, curStr, padX, midY, "left", fillW, w, h);
        drawProgressTimeContrasted(ctx, durStr, w - padX, midY, "right", fillW, w, h);
    } else {
        const stamp = `${curStr} / ${durStr}`;
        drawProgressTimeContrasted(ctx, stamp, w * 0.5, midY, "center", fillW, w, h);
    }

    state.text = `${curStr} / ${durStr}`;
}

/**
 * Apply live playback progress from the music player.
 * @param {{ progress?: number, currentTime?: number, duration?: number }} payload
 */
function applyPlaybackProgress(payload) {
    const bar = scene.songPanels.progress;
    if (bar) {
        let progress = payload?.progress;
        if (progress == null) {
            const cur = Number(payload?.currentTime) || 0;
            const dur = Number(payload?.duration) || 0;
            progress = dur > 0 ? cur / dur : 0;
        }

        setSongProgress(bar, progress, {
            currentTime: payload?.currentTime,
            duration: payload?.duration,
        });
    }
    // ARTEF4KT embed progress chrome
    for (const c of scene.containers) {
        if (c?.role === "artef4kt" && c.artef4ktHost && typeof c.artef4ktHost.setProgress === "function") {
            try { c.artef4ktHost.setProgress(payload || {}); } catch (_) { /* ignore */ }
        }
    }
    // No full scene redraw needed every frame — postprocess captures the canvas live
}

/**
 * Performance / show clock → show-progress bar.
 * @param {{ showTime?: number, showDuration?: number, loop?: boolean, inShow?: boolean, status?: string }} payload
 */
function applyShowProgress(payload) {
    const bar = findContainerByRole("show-progress");
    if (!bar) return;
    const status = payload && payload.status != null ? String(payload.status) : "";
    const dur = Math.max(0, Number(payload?.showDuration) || 0);
    let cur = Math.max(0, Number(payload?.showTime) || 0);
    if (status === "idle" || status === "preview") {
        cur = 0;
    } else if (status === "ended") {
        cur = dur;
    } else if (payload?.loop && dur > 0) {
        cur = cur % dur;
    } else if (dur > 0) {
        cur = Math.min(cur, dur);
    }
    const progress = dur > 0 ? cur / dur : 0;
    setSongProgress(bar, progress, { currentTime: cur, duration: dur });
}

/** Start cover fade + text glitches even while a morph defers the rest. */
function primeContentTransitions(info) {
    if (!info) return;
    const cover = scene.songPanels.cover;
    if (cover && normalizeContentFadeSec(cover.contentFade) > 0) {
        if (info.coverDataUrl) setContainerImageFromUrl(cover, info.coverDataUrl);
        else setContainerImageFromUrl(cover, null);
    }
    const track = scene.songPanels.info;
    if (track && normalizeTextGlitchSec(track.textGlitch) > 0) {
        setSongInfoContent(track, {
            title: info.title,
            artist: info.artist,
            album: info.album,
        });
    }
    const lyrics = scene.songPanels.lyrics;
    if (lyrics && normalizeTextGlitchSec(lyrics.textGlitch) > 0) {
        const lines = Array.isArray(info.lyricLines) ? info.lyricLines : [];
        if (!lyrics.lyricsTrack) setupSongLyricsBlock(lyrics);
        rebuildLyricsTrack(lyrics, lines);
        lockLyricsPanelSize(lyrics, lines);
    }
}

/**
 * Apply now-playing payload from the music window to song panels.
 * @param {{ title?: string, artist?: string, album?: string, coverDataUrl?: string|null, hasLyrics?: boolean }} info
 */
async function applyNowPlaying(info) {
    if (!info) return;
    scene.lastNowPlaying = info;
    const cover = scene.songPanels.cover;
    const track = scene.songPanels.info;
    const lyrics = scene.songPanels.lyrics;
    const progress = scene.songPanels.progress;

    // New track → clear accumulating history strip
    resetAudioHistory();

    // ARTEF4KT on-screen track chrome (Music owns selection — no ARTEF4KT file picker)
    for (const c of scene.containers) {
        if (c?.role === "artef4kt" && c.artef4ktHost && typeof c.artef4ktHost.setTrackInfo === "function") {
            try { c.artef4ktHost.setTrackInfo(info); } catch (_) { /* ignore */ }
        }
    }

    let coverReady = Promise.resolve();
    if (cover) {
        if (info.coverDataUrl) {
            setContainerText(cover, "");
            coverReady = setContainerImageFromUrl(cover, info.coverDataUrl);
        } else {
            coverReady = setContainerImageFromUrl(cover, null);
            setContainerText(cover, "No cover");
        }
    }
    scene._coverReady = coverReady;

    if (track) {
        setSongInfoContent(track, {
            title: info.title,
            artist: info.artist,
            album: info.album,
        });
    }

    if (lyrics) {
        // Lock size for this track (longest line), build full scroll list, then focus
        const lines = Array.isArray(info.lyricLines) ? info.lyricLines : [];
        if (!lyrics.lyricsTrack) setupSongLyricsBlock(lyrics);
        rebuildLyricsTrack(lyrics, lines);
        lockLyricsPanelSize(lyrics, lines);

        if (info.hasLyrics || lines.length) {
            if (!lyrics._lyricsDecode) {
                const hint = scene.lastLyricFocus;
                const idx = resolveLyricIndex(lines, hint);
                setSongLyricsFocus(lyrics, idx >= 0
                    ? hint
                    : { hasLyrics: true, current: "…", prev: "", next: "", index: -1 });
            }
        } else {
            setSongLyricsFocus(lyrics, {
                hasLyrics: false,
                current: "No lyrics for this track",
            });
        }
    }

    // New track starts empty; music window will push live progress while playing
    if (progress) {
        setSongProgress(progress, 0, { currentTime: 0, duration: 0 });
    }

    if (scene.redraw) scene.redraw();
    else publishSceneState();
    await coverReady;
}

/**
 * Apply live lyric focus from the music player.
 */
function applyLyricFocus(focus) {
    scene.lastLyricFocus = focus || null;
    const lyrics = scene.songPanels.lyrics;
    if (!lyrics) return;
    setSongLyricsFocus(lyrics, focus || {});
    // Lightweight redraw: labels + postprocess sources need DOM positions
    if (scene.redraw) scene.redraw();
}

const LABEL_CORNERS = ["bottom-right", "bottom-left", "top-right", "top-left"];

function normalizeLabelCorner(corner) {
    const c = String(corner || "bottom-right").toLowerCase().replace(/_/g, "-");
    return LABEL_CORNERS.includes(c) ? c : "bottom-right";
}

function defaultTextStyle(overrides = {}) {
    return {
        fontFamily: overrides.fontFamily || 'system-ui, -apple-system, "Segoe UI", sans-serif',
        fontSize: overrides.fontSize != null ? Number(overrides.fontSize) : 12,
        fontWeight: overrides.fontWeight != null ? String(overrides.fontWeight) : "600",
        fontStyle: overrides.fontStyle || "normal", // normal | italic
        color: overrides.color || "#111111",
        // transparent by default — no chip fill; no border
        background: overrides.background != null ? overrides.background : "transparent",
        letterSpacing: overrides.letterSpacing != null ? Number(overrides.letterSpacing) : 0,
        opacity: overrides.opacity != null ? Number(overrides.opacity) : 1,
    };
}

function defaultLabelStyle(overrides = {}) {
    return defaultTextStyle(overrides);
}

const TEXT_ALIGNS = ["left", "center", "right", "justify"];

/** Normalize in-box text alignment; default center. */
function normalizeTextAlign(value) {
    const a = String(value == null ? "center" : value).toLowerCase().trim();
    return TEXT_ALIGNS.includes(a) ? a : "center";
}

/** Non-negative box padding in px (uniform on all sides). Default 0. */
function normalizeBoxPadding(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) return 0;
    return n;
}

/**
 * Apply content layout styles (textAlign, padding) to a floating container DOM.
 * Vertical placement uses the box flex center (geometry), not baseline alignment.
 */
function applyContainerTextTypography(state, el, opts = {}) {
    if (!el || !state) return;
    const style = defaultTextStyle(state.style?.text || state.style?.label || {});
    el.style.fontFamily = style.fontFamily;
    if (!opts.skipSize) el.style.fontSize = `${liveFontSize(style.fontSize)}px`;
    else el.style.fontSize = "";
    el.style.fontWeight = style.fontWeight;
    el.style.fontStyle = style.fontStyle === "italic" ? "italic" : "normal";
    el.style.color = style.color || "#111111";
    el.style.letterSpacing = `${livePx(style.letterSpacing)}px`;
    el.style.opacity = String(Math.max(0, Math.min(1, Number(style.opacity) || 1)));
}

function applyContainerBoxStyle(state, opts = {}) {
    if (!state?.element) return;
    const el = state.element;
    const align = normalizeTextAlign(state.style?.textAlign);
    const pad = normalizeBoxPadding(state.style?.padding);
    state.style.textAlign = align;
    state.style.padding = pad;

    el.style.padding = `${livePx(pad)}px`;
    el.style.textAlign = align;
    // Column flex: justify-content centers on the Y axis by the content box center
    el.style.display = "flex";
    el.style.flexDirection = "column";
    el.style.justifyContent = "center";
    el.style.alignItems = "center";

    const textStyle = defaultTextStyle(state.style?.text || state.style?.label || {});
    state.style.text = textStyle;

    if (state.textEl) {
        state.textEl.style.width = "100%";
        state.textEl.style.maxWidth = "100%";
        state.textEl.style.boxSizing = "border-box";
        state.textEl.style.textAlign = align;
        state.textEl.style.padding = "0";
        state.textEl.style.margin = "0";
        applyContainerTextTypography(state, state.textEl);
    }

    // Song info stack: stretch for left/right/justify so text-align is visible
    const infoBlock = state.songInfoBlock || el.querySelector(".song-info-block");
    if (infoBlock) {
        infoBlock.style.textAlign = align;
        infoBlock.style.fontFamily = textStyle.fontFamily;
        infoBlock.style.fontSize = `${liveFontSize(textStyle.fontSize)}px`;
        infoBlock.style.fontWeight = textStyle.fontWeight;
        infoBlock.style.fontStyle = textStyle.fontStyle === "italic" ? "italic" : "normal";
        infoBlock.style.color = textStyle.color || "#111111";
        infoBlock.style.letterSpacing = `${livePx(textStyle.letterSpacing)}px`;
        infoBlock.style.opacity = String(Math.max(0, Math.min(1, Number(textStyle.opacity) || 1)));
        infoBlock.style.gap = `${livePx(3)}px`;
        if (state.songInfoTitleEl) applyContainerTextTypography(state, state.songInfoTitleEl, { skipSize: true });
        if (state.songInfoArtistEl) applyContainerTextTypography(state, state.songInfoArtistEl, { skipSize: true });
        if (state.songInfoAlbumEl) applyContainerTextTypography(state, state.songInfoAlbumEl, { skipSize: true });
        if (align === "left") {
            infoBlock.style.alignItems = "flex-start";
            infoBlock.style.width = "100%";
            infoBlock.style.maxWidth = "100%";
        } else if (align === "right") {
            infoBlock.style.alignItems = "flex-end";
            infoBlock.style.width = "100%";
            infoBlock.style.maxWidth = "100%";
        } else if (align === "justify") {
            infoBlock.style.alignItems = "stretch";
            infoBlock.style.width = "100%";
            infoBlock.style.maxWidth = "100%";
        } else {
            infoBlock.style.alignItems = "center";
            infoBlock.style.width = "max-content";
            infoBlock.style.maxWidth = `${Math.max(40, livePx(400))}px`;
        }
    }

    // Lyrics: drive metrics via CSS vars so .active can scale without inline font-size fights
    const lyricsRoot =
        state.lyricsViewport
        || el.querySelector(".song-lyrics-viewport")
        || el.querySelector(".song-lyrics-block");
    if (lyricsRoot) {
        lyricsRoot.style.textAlign = align;
        const baseDesign = Math.max(1, Number(textStyle.fontSize) || 12);
        const baseSize = liveFontSize(baseDesign);
        // Active line ~1.5× base (matches former 12 → 18 default)
        const activeSize = Math.max(baseSize + livePx(4), Math.round(baseSize * 1.5));
        const baseWeight = textStyle.fontWeight != null ? String(textStyle.fontWeight) : "500";
        const activeWeight = "700";
        lyricsRoot.style.setProperty("--lyrics-size", `${baseSize}px`);
        lyricsRoot.style.setProperty("--lyrics-active-size", `${activeSize}px`);
        lyricsRoot.style.setProperty("--lyrics-weight", baseWeight);
        lyricsRoot.style.setProperty("--lyrics-active-weight", activeWeight);
        lyricsRoot.style.setProperty("--lyrics-line-height", "1.35");
        lyricsRoot.style.setProperty("--lyrics-active-line-height", "1.3");
        lyricsRoot.style.setProperty("--lyrics-pad-y", `${livePx(4)}px`);
        lyricsRoot.style.setProperty("--lyrics-pad-x", `${livePx(2)}px`);
        lyricsRoot.style.setProperty("--lyrics-active-pad-y", `${livePx(6)}px`);
        lyricsRoot.style.setProperty(
            "--lyrics-letter-spacing",
            `${livePx(textStyle.letterSpacing)}px`,
        );
        lyricsRoot.style.setProperty(
            "--lyrics-font-style",
            textStyle.fontStyle === "italic" ? "italic" : "normal",
        );
        lyricsRoot.style.setProperty(
            "--lyrics-font-family",
            textStyle.fontFamily || 'system-ui, -apple-system, "Segoe UI", sans-serif',
        );
        lyricsRoot.style.fontFamily = textStyle.fontFamily
            || 'system-ui, -apple-system, "Segoe UI", sans-serif';
        const track = lyricsRoot.querySelector?.(".song-lyrics-track");
        if (track) {
            track.style.textAlign = align;
            track.querySelectorAll?.(".song-lyrics-line").forEach((line) => {
                line.style.textAlign = align;
                line.style.fontSize = "";
                line.style.fontWeight = "";
                line.style.fontStyle = "";
                line.style.fontFamily = "";
                line.style.letterSpacing = "";
                line.style.lineHeight = "";
                line.style.opacity = "";
                line.style.color = "";
            });
        }
        if (state.lyricsTrack && !opts.skipLyricsRecenter) {
            requestAnimationFrame(() => recenterLyrics(state, false));
        }
    }

    const arteRoot = el.querySelector(".artef4kt-overlay-root");
    if (arteRoot) {
        arteRoot.style.fontSize = `${liveFontSize(10)}px`;
    }
}

function buildCanvasFont(labelStyle) {
    const s = defaultLabelStyle(labelStyle || {});
    const size = liveFontSize(s.fontSize);
    const weight = s.fontWeight || "600";
    const style = s.fontStyle === "italic" ? "italic" : "normal";
    const family = s.fontFamily || "system-ui, sans-serif";
    return `${style} ${weight} ${size}px ${family}`;
}

function createFloatingContainer(
    topPanel,
    {
        width,
        height,
        left,
        top,
        text = null,
        label = null,
        labelCorner = "bottom-right",
        labelEnabled = true,
        labelStyle = {},
        // legacy: older callers used `label` for in-box text
        wander = false,
        wanderAmplitude = 1,
        wanderFrequency = 12,
        attachTo = null,
        anchor = false,
        connect = false,
        layer = 0,
        style = {},
        distancing = 0,
        image = null,
        imageMode = "scale",
        shader = null,
        shaderPath = null,
        shaderId = null,
        shaderUniforms = {},
        shaderModulators = null,
        role = null,
        visible = true,
        panelKind = null,
        embed = null,
        audioInput = null,
        skipPlacementSearch = false,
        snapshotId = null,
        relative = null,
        contentFade = 0,
        textGlitch = 0,
    },
    containers,
    redraw,
) {
    const floatArea = getFloatAreaSize();
    const panelWidth = floatArea.width;
    const panelHeight = floatArea.height;

    const boundedLeft = Math.max(0, Math.min(panelWidth - width, left));
    const boundedTop = Math.max(0, Math.min(Math.max(0, panelHeight - height), top));

    const container = document.createElement("div");
    container.className = "floating-box";
    container.style.width = `${width}px`;
    container.style.height = `${height}px`;
    // initial placement — try to avoid other containers' distancing zones
    let placementLeft = boundedLeft;
    let placementTop = boundedTop;
    if (!skipPlacementSearch) {
        const maxAttempts = 30;
        let attempts = 0;
        while (attempts < maxAttempts) {
            if (isPositionAllowed(placementLeft, placementTop, width, height, containers)) {
                break;
            }
            placementLeft += 12;
            if (placementLeft > panelWidth - width) {
                placementLeft = 0;
                placementTop += 12;
            }
            attempts += 1;
        }
    } else {
        placementLeft = boundedLeft;
        placementTop = boundedTop;
    }

    container.style.left = `${placementLeft}px`;
    container.style.top = `${placementTop}px`;
    // inner canvas that fills the container (optional image or shader draws here)
    const innerCanvas = document.createElement("canvas");
    innerCanvas.width = width;
    innerCanvas.height = height;
    innerCanvas.style.position = "absolute";
    innerCanvas.style.left = "0";
    innerCanvas.style.top = "0";
    innerCanvas.style.width = "100%";
    innerCanvas.style.height = "100%";
    innerCanvas.style.display = "block";
    innerCanvas.style.zIndex = "0";
    container.appendChild(innerCanvas);

    const id = scene.nextContainerId++;

    // text = in-box content; label = external canvas caption
    // Legacy: if only `label` is passed (no `text`), treat it as text content.
    const initialText = text != null
        ? String(text)
        : (label != null ? String(label) : "");
    const initialLabel = text != null
        ? (label != null ? String(label) : `Container ${id}`)
        : (label != null ? String(label) : `Container ${id}`);

    // In-container text content
    const textDiv = document.createElement("div");
    textDiv.className = "floating-text";
    textDiv.textContent = initialText;
    container.appendChild(textDiv);

    const state = {
        id,
        snapshotId: snapshotId || mintSnapshotId(),
        relative: relative && typeof relative === "object" ? relative : null,
        role: role || null,
        visible: visible !== false,
        panelKind: panelKind || null,
        text: initialText,
        label: initialLabel,
        labelEnabled: labelEnabled !== false,
        labelCorner: normalizeLabelCorner(labelCorner),
        element: container,
        textEl: textDiv,
        // Logical layout size (matches style.width/height with border-box)
        width,
        height,
        left: placementLeft,
        top: placementTop,
        wander: !!wander,
        wanderAmplitude,
        wanderFrequency,
        attachTo, // DOM element of another container (or null)
        anchorDistance: typeof anchor === "number" ? anchor : false,
        distancing: Number(distancing || 0),
        connect,
        layer,
        style: {
            border: {
                color: style.border?.color || "#000",
                lineWidth: style.border?.lineWidth || 2,
                dash: style.border?.dash || [],
            },
            connect: {
                color: style.connect?.color || "#000",
                lineWidth: style.connect?.lineWidth || 2,
                dash: style.connect?.dash || [],
            },
            label: defaultLabelStyle(style.label || labelStyle || {}),
            text: defaultTextStyle(style.text || style.label || labelStyle || {}),
            // In-box content layout (defaults: center, 0 padding)
            textAlign: normalizeTextAlign(style.textAlign),
            padding: normalizeBoxPadding(style.padding),
        },
        contentFade: normalizeContentFadeSec(contentFade),
        textGlitch: normalizeTextGlitchSec(textGlitch),
        // canvas and image/shader support
        innerCanvas,
        innerCtx: null,
        image: null,
        imageSrc: image || null,
        imageMode: imageMode || "scale",
        shader: shader || null,
        shaderId: shaderId || null,
        shaderPath: shaderPath || null,
        shaderMeta: null,
        shaderRenderer: null,
        shaderUniforms: Object.assign({}, shaderUniforms || {}),
        /** Optional ParamModulator map for container shader (Phase 1+) */
        shaderModulators: Object.assign({}, shaderModulators || {}),
        /** Per-container postprocess FX stack (layers sample this panel as u_scene) */
        postprocess: { active: false, layers: [], nextLayerId: 1 },
        postprocessCanvas: null,
        postprocessRenderer: null,
        /** External embed engine (e.g. ARTEF4KT) — serializable fields only */
        embed: embed && typeof embed === "object" ? Object.assign({}, embed) : null,
        /** Runtime host handle (not serialized) */
        artef4ktHost: null,
        artef4ktMounting: false,
        audioInput: (typeof window !== "undefined" && window.AudioInput)
            ? window.AudioInput.sanitizeAudioInput(audioInput, role || null)
            : (audioInput && typeof audioInput === "object" ? audioInput : null),
        wanderTimer: null,
        topPanel,
        redraw,
        containers,
    };

    container.dataset.containerId = String(id);
    container.style.zIndex = `${2 + layer}`;
    container.title = `${initialLabel} — drag to move · edges to resize · selected in Controls`;
    topPanel.appendChild(container);
    containers.push(state);
    applyContainerVisibility(state);

    // Keep state.left/top in sync with the final placed position
    state.left = placementLeft;
    state.top = placementTop;
    syncDesignFromLive(state);

    // Interactive move / edge-resize (also selects for Controls)
    setupContainerDragResize(state);

    // Content alignment + padding (vertical center by geometry, not baseline)
    applyContainerBoxStyle(state);

    if (state.wander) {
        startWander(topPanel, state, redraw, containers);
    }

    // Bind context carefully: a canvas can only have one context type for its life.
    // Do NOT call getContext('2d') if we intend to use WebGL (inline shader or package).
    const packageRef = shaderId || shaderPath;
    if (state.shader) {
        try {
            if (innerCanvas.width === 0 || innerCanvas.height === 0) {
                innerCanvas.width = innerCanvas.clientWidth || 1;
                innerCanvas.height = innerCanvas.clientHeight || 1;
            }
            state.shaderRenderer = createShaderRenderer(innerCanvas, state.shader, state.shaderUniforms, {
                modulators: state.shaderModulators,
                boundsByName: boundsFromShaderMeta(state.shaderMeta),
            });
            state.shaderRenderer.start();
        } catch (e) {
            console.warn("Failed to initialize shader renderer:", e);
            replaceInnerCanvas(state);
            state.innerCtx = state.innerCanvas.getContext("2d");
        }
    } else if (packageRef) {
        // Leave canvas unbound; load package (frag + controls) then apply WebGL.
        // applyShaderPackageToState clears modulators — restore any create-time map after.
        const pendingMods = Object.assign({}, state.shaderModulators || {});
        applyShaderPackageToState(state, packageRef, state.shaderUniforms)
            .then(() => {
                if (Object.keys(pendingMods).length) {
                    updateContainerModulators(state, pendingMods);
                }
                publishSceneState();
            })
            .catch((e) => {
                console.warn('Failed to load shader package:', packageRef, e);
                if (!state.innerCtx && !state.shaderRenderer) {
                    state.innerCtx = state.innerCanvas.getContext("2d");
                }
            });
    } else if (role === "artef4kt") {
        // Leave canvas unbound; Three.js attaches via mountArtef4ktOnContainer
        state.innerCtx = null;
        if (!state.embed) {
            state.embed = { engine: "artef4kt", settingsId: "default", quality: "auto" };
        }
        // Mount async so create path stays sync
        Promise.resolve()
            .then(() => mountArtef4ktOnContainer(state))
            .then(() => publishSceneState())
            .catch((e) => console.warn("ARTEF4KT deferred mount failed", e));
    } else {
        state.innerCtx = innerCanvas.getContext("2d");
    }

    // If an image source was provided and no shader is active, load and draw it
    if (!state.shader && !packageRef && image && role !== "artef4kt") {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
            state.image = img;
            drawContainerImage(state);
        };
        img.onerror = () => {
            console.warn("Failed to load container image:", image);
        };
        img.src = image;
    } else if (image) {
        // Keep image for later (e.g. after clearShader); don't force 2D now.
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => { state.image = img; };
        img.onerror = () => {
            console.warn("Failed to load container image:", image);
        };
        img.src = image;
    }

    // Shader / container settings live in the controls window now.
    return container;
}

function drawContainerImage(state) {
    const canvas = state.innerCanvas;
    const ctx = state.innerCtx;
    if (!canvas || !ctx || !state.element) return;
    // Prefer live layout size; fall back to logical border-box size from state
    const w = Math.max(
        1,
        state.element.clientWidth || Math.round(Number(state.width)) || canvas.width || 1,
    );
    const h = Math.max(
        1,
        state.element.clientHeight || Math.round(Number(state.height)) || canvas.height || 1,
    );
    if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
    }

    ctx.clearRect(0, 0, w, h);
    const fade = state._imageFade;
    if (fade && (fade.from || fade.to)) {
        const u = Math.max(0, Math.min(1, fade.u || 0));
        if (fade.from) {
            ctx.save();
            ctx.globalAlpha = 1 - u;
            paintFittedImage(ctx, fade.from, w, h, state.imageMode || "fill");
            ctx.restore();
        }
        if (fade.to) {
            ctx.save();
            ctx.globalAlpha = u;
            paintFittedImage(ctx, fade.to, w, h, state.imageMode || "fill");
            ctx.restore();
        }
        return;
    }
    if (!state.image) return;
    paintFittedImage(ctx, state.image, w, h, state.imageMode || "fill");
}

function startWander(topPanel, state, redraw, containers) {
    if (state.wanderTimer) {
        clearInterval(state.wanderTimer);
        state.wanderTimer = null;
    }

    const tick = () => {
        if (!state.wander || state._userDragging) {
            return;
        }

        const rect = state.element.getBoundingClientRect();
        const panelRect = topPanel.getBoundingClientRect();
        const currentLeft = rect.left - panelRect.left;
        const currentTop = rect.top - panelRect.top;
        const movement = Math.max(0.05, livePx(state.wanderAmplitude));

        let nextLeft = currentLeft + (Math.random() > 0.5 ? movement : -movement);
        let nextTop = currentTop + (Math.random() > 0.5 ? movement : -movement);

        if (state.anchorDistance !== false && state.attachTo) {
            const anchorRect = state.attachTo.getBoundingClientRect();
            const targetCenterX = anchorRect.left - panelRect.left + anchorRect.width / 2;
            const targetCenterY = anchorRect.top - panelRect.top + anchorRect.height / 2;
            const candidateCenterX = nextLeft + rect.width / 2;
            const candidateCenterY = nextTop + rect.height / 2;
            const diffX = candidateCenterX - targetCenterX;
            const diffY = candidateCenterY - targetCenterY;
            const distance = Math.hypot(diffX, diffY);

            const maxDist = livePx(state.anchorDistance);
            if (distance > maxDist) {
                const ratio = maxDist / distance;
                nextLeft = targetCenterX + diffX * ratio - rect.width / 2;
                nextTop = targetCenterY + diffY * ratio - rect.height / 2;
            }
        }

        // Clamp to float area (may include bottom strip when enabled)
        const area = getFloatAreaSize();
        const maxLeft = Math.max(0, area.width - rect.width);
        const maxTop = Math.max(0, area.height - rect.height);

        nextLeft = Math.max(0, Math.min(maxLeft, nextLeft));
        nextTop = Math.max(0, Math.min(maxTop, nextTop));

        // enforce distancing from other containers (others' distancing zones)
        if (!isPositionAllowed(nextLeft, nextTop, rect.width, rect.height, containers, state)) {
            return; // skip this movement
        }

        state.element.style.left = `${nextLeft}px`;
        state.element.style.top = `${nextTop}px`;
        state.left = nextLeft;
        state.top = nextTop;
        redraw();
    };

    const intervalMs = Math.max(1000 / Math.max(0.1, state.wanderFrequency || 1), 16);
    state.wanderTimer = setInterval(tick, intervalMs);
}

function stopWander(state) {
    if (!state) return;
    if (state.wanderTimer != null) {
        clearInterval(state.wanderTimer);
        state.wanderTimer = null;
    }
}

/**
 * Apply logical width/height (border-box) and reflow all contents to match.
 * Canvas CSS is always 100% of the box; bitmap size is updated for 2D draws.
 * WebGL shaders manage their own drawing-buffer size (incl. DPR) each frame.
 */
function setContainerSize(state, width, height) {
    if (!state?.element) return;
    const w = Math.max(1, Math.round(Number(width)));
    const h = Math.max(1, Math.round(Number(height)));
    state.width = w;
    state.height = h;
    state.element.style.width = `${w}px`;
    state.element.style.height = `${h}px`;

    const canvas = state.innerCanvas;
    if (canvas) {
        // Keep CSS fill even if styles were lost after context replace
        canvas.style.position = "absolute";
        canvas.style.left = "0";
        canvas.style.top = "0";
        canvas.style.right = "0";
        canvas.style.bottom = "0";
        canvas.style.width = "100%";
        canvas.style.height = "100%";
        canvas.style.display = "block";

        if (state.shaderRenderer) {
            // Do not stomp WebGL drawing-buffer size here — the shader renderer
            // sizes from clientWidth/Height * dpr. Force an immediate redraw so
            // the buffer matches the new box before the next rAF if possible.
            if (typeof state.shaderRenderer.render === "function") {
                try { state.shaderRenderer.render(); } catch (_) { /* ignore */ }
            }
        } else if (state.artef4ktHost || state.role === "artef4kt") {
            // Three.js owns the drawing buffer — only update CSS fill; host.setSize later
        } else {
            // 2D: bitmap matches the laid-out content box (client size)
            const bw = Math.max(1, state.element.clientWidth || w);
            const bh = Math.max(1, state.element.clientHeight || h);
            if (canvas.width !== bw || canvas.height !== bh) {
                canvas.width = bw;
                canvas.height = bh;
            }
        }
    }

    // Redraw role / media contents at the new size
    if (state.image && state.innerCtx) {
        drawContainerImage(state);
    }
    if (isProgressRole(state.role)) {
        setSongProgress(state, state.playbackProgress || 0, {
            currentTime: state.playbackCurrentTime,
            duration: state.playbackDuration,
        });
    }
    if (state.role === "song-lyrics" || state.lyricsViewport || state.lyricsTrack) {
        // Viewport is percentage-sized; re-center the active line after the box changes
        if (state.lyricsViewport) {
            state.lyricsViewport.style.width = "100%";
            state.lyricsViewport.style.maxWidth = "100%";
            state.lyricsViewport.style.height = "100%";
        }
        if (state.lyricsBlock) {
            state.lyricsBlock.style.width = "100%";
            state.lyricsBlock.style.maxWidth = "100%";
            state.lyricsBlock.style.height = "100%";
        }
        if (state.lyricsTrack) {
            // Double-rAF so layout reflects the new height / wrap width before measuring
            requestAnimationFrame(() => {
                requestAnimationFrame(() => recenterLyrics(state, false));
            });
        }
    }

    if (state.role === "artef4kt" || state.artef4ktHost) {
        resizeArtef4ktOnContainer(state);
    }

    // Local FX stack resizes from client metrics each frame; force a redraw after box change
    if (state.postprocessRenderer && typeof state.postprocessRenderer.render === "function") {
        try { state.postprocessRenderer.render(); } catch (_) { /* ignore */ }
    }
    syncDesignFromLive(state);
}

function setContainerPosition(state, left, top) {
    const l = Number(left);
    const t = Number(top);
    state.left = l;
    state.top = t;
    state.element.style.left = `${l}px`;
    state.element.style.top = `${t}px`;
    syncDesignFromLive(state);
}

/** Hit zone (px) for edge/corner resize on floating boxes. */
const CONTAINER_EDGE_HIT = 10;
const CONTAINER_MIN_W = 48;
const CONTAINER_MIN_H = 28;

/**
 * Which resize edge (if any) is under the pointer, in container-local coords.
 * @returns {'n'|'s'|'e'|'w'|'ne'|'nw'|'se'|'sw'|null}
 */
function hitContainerResizeEdge(el, clientX, clientY) {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const x = clientX - r.left;
    const y = clientY - r.top;
    const w = r.width;
    const h = r.height;
    if (x < 0 || y < 0 || x > w || y > h) return null;
    const edge = CONTAINER_EDGE_HIT;
    const onL = x <= edge;
    const onR = x >= w - edge;
    const onT = y <= edge;
    const onB = y >= h - edge;
    if (onT && onL) return 'nw';
    if (onT && onR) return 'ne';
    if (onB && onL) return 'sw';
    if (onB && onR) return 'se';
    if (onT) return 'n';
    if (onB) return 's';
    if (onL) return 'w';
    if (onR) return 'e';
    return null;
}

function cursorForContainerEdge(edge) {
    switch (edge) {
        case 'n':
        case 's':
            return 'ns-resize';
        case 'e':
        case 'w':
            return 'ew-resize';
        case 'ne':
        case 'sw':
            return 'nesw-resize';
        case 'nw':
        case 'se':
            return 'nwse-resize';
        default:
            return 'grab';
    }
}

/**
 * Click-hold drag to move; drag edges/corners to resize.
 * Coordinates stay panel-relative; clamps inside the top panel.
 * @param {object} state container state from createFloatingContainer
 */
function setupContainerDragResize(state) {
    const el = state?.element;
    if (!el || el.dataset.dragResizeBound === '1') return;
    el.dataset.dragResizeBound = '1';

    let session = null; // { mode, startX, startY, origL, origT, origW, origH, pointerId }

    const panelEl = () => state.topPanel || scene.topPanel;

    const updateHoverCursor = (clientX, clientY) => {
        if (session) return;
        const edge = hitContainerResizeEdge(el, clientX, clientY);
        el.style.cursor = cursorForContainerEdge(edge);
        el.classList.toggle('is-resize-hover', !!edge);
    };

    el.addEventListener('pointermove', (e) => {
        if (session) return;
        // Only update cursor when hovering this box (not during capture from another)
        if (e.target === el || el.contains(e.target)) {
            updateHoverCursor(e.clientX, e.clientY);
        }
    });

    el.addEventListener('pointerleave', () => {
        if (!session) {
            el.style.cursor = '';
            el.classList.remove('is-resize-hover');
        }
    });

    el.addEventListener('pointerdown', (e) => {
        if (state.visible === false) return;
        if (e.button != null && e.button !== 0) return;
        // Ignore multi-touch extras
        if (session) return;

        setSelectedContainerId(state.id);

        const mode = hitContainerResizeEdge(el, e.clientX, e.clientY) || 'move';
        const panel = panelEl();
        if (!panel) return;

        session = {
            mode,
            startX: e.clientX,
            startY: e.clientY,
            origL: state.left != null ? Number(state.left) : el.offsetLeft,
            origT: state.top != null ? Number(state.top) : el.offsetTop,
            origW: state.width != null ? Number(state.width) : el.offsetWidth,
            origH: state.height != null ? Number(state.height) : el.offsetHeight,
            pointerId: e.pointerId,
        };

        state._userDragging = true;
        pinContainerLayout(state);
        el.classList.add(mode === 'move' ? 'is-dragging' : 'is-resizing');
        el.style.cursor = mode === 'move' ? 'grabbing' : cursorForContainerEdge(mode);

        try {
            el.setPointerCapture(e.pointerId);
        } catch (_) { /* ignore */ }

        e.preventDefault();
        e.stopPropagation();
    });

    const endSession = (e) => {
        if (!session) return;
        if (e && e.pointerId != null && e.pointerId !== session.pointerId) return;

        const mode = session.mode;
        session = null;
        state._userDragging = false;
        pinContainerLayout(state);
        el.classList.remove('is-dragging', 'is-resizing');
        el.style.cursor = mode === 'move' ? 'grab' : cursorForContainerEdge(mode);

        try {
            if (e?.pointerId != null) el.releasePointerCapture(e.pointerId);
        } catch (_) { /* ignore */ }

        // Final geometry → controls + presets path
        if (scene.redraw) scene.redraw();
        publishSceneState();
    };

    el.addEventListener('pointermove', (e) => {
        if (!session || e.pointerId !== session.pointerId) return;
        const panel = panelEl();
        if (!panel) return;

        const area = getFloatAreaSize();
        const panelW = area.width;
        const panelH = area.height;
        const dx = e.clientX - session.startX;
        const dy = e.clientY - session.startY;
        const mode = session.mode;

        let left = session.origL;
        let top = session.origT;
        let width = session.origW;
        let height = session.origH;

        if (mode === 'move') {
            left = session.origL + dx;
            top = session.origT + dy;
            const maxL = Math.max(0, panelW - width);
            const maxT = Math.max(0, panelH - height);
            left = Math.max(0, Math.min(maxL, left));
            top = Math.max(0, Math.min(maxT, top));
            setContainerPosition(state, left, top);
        } else {
            // Resize from edges/corners; keep opposite edge fixed when possible
            if (mode.includes('e')) {
                width = session.origW + dx;
            }
            if (mode.includes('w')) {
                width = session.origW - dx;
                left = session.origL + dx;
            }
            if (mode.includes('s')) {
                height = session.origH + dy;
            }
            if (mode.includes('n')) {
                height = session.origH - dy;
                top = session.origT + dy;
            }

            // Enforce minimum size (adjust left/top when shrinking past min from w/n)
            if (width < CONTAINER_MIN_W) {
                if (mode.includes('w')) {
                    left = session.origL + session.origW - CONTAINER_MIN_W;
                }
                width = CONTAINER_MIN_W;
            }
            if (height < CONTAINER_MIN_H) {
                if (mode.includes('n')) {
                    top = session.origT + session.origH - CONTAINER_MIN_H;
                }
                height = CONTAINER_MIN_H;
            }

            // Clamp inside panel
            if (left < 0) {
                if (mode.includes('w')) width += left;
                left = 0;
            }
            if (top < 0) {
                if (mode.includes('n')) height += top;
                top = 0;
            }
            if (left + width > panelW) {
                if (mode.includes('e') || mode.includes('w')) {
                    width = panelW - left;
                } else {
                    left = panelW - width;
                }
            }
            if (top + height > panelH) {
                if (mode.includes('n') || mode.includes('s')) {
                    height = panelH - top;
                } else {
                    top = panelH - height;
                }
            }
            width = Math.max(CONTAINER_MIN_W, width);
            height = Math.max(CONTAINER_MIN_H, height);
            left = Math.max(0, Math.min(panelW - width, left));
            top = Math.max(0, Math.min(panelH - height, top));

            setContainerPosition(state, left, top);
            setContainerSize(state, width, height);
        }

        if (scene.redraw) scene.redraw();
        else if (state.redraw) state.redraw();
        publishSceneState();
        e.preventDefault();
    });

    el.addEventListener('pointerup', endSession);
    el.addEventListener('pointercancel', endSession);
    el.addEventListener('lostpointercapture', () => {
        if (!session) return;
        session = null;
        state._userDragging = false;
        el.classList.remove('is-dragging', 'is-resizing');
        el.style.cursor = '';
        publishSceneState();
    });
}

/** Sync wander timer to state.wander / frequency (single source of truth). */
function syncWanderTimer(state) {
    if (!state) return;
    if (state.wander) {
        startWander(
            state.topPanel || scene.topPanel,
            state,
            state.redraw || scene.redraw,
            state.containers || scene.containers,
        );
    } else {
        stopWander(state);
    }
}

function setupCanvas(canvas, topPanel, ctx, drawableState, redraw) {
    const overlayCanvas = document.getElementById("overlay-canvas");
    const postprocessCanvas = document.getElementById("postprocess-canvas");
    const appShell = document.querySelector(".app-shell");

    const setBitmapSize = (el, w, h) => {
        if (!el) return false;
        const nw = Math.max(1, Math.round(w));
        const nh = Math.max(1, Math.round(h));
        if (el.width === nw && el.height === nh) return false;
        el.width = nw;
        el.height = nh;
        return true;
    };

    const resizeCanvas = () => {
        // Canvas matches the float host so labels/lines work when floats enter the blue strip.
        // White fill is only painted in the stage region (above bottom strip).
        const floatArea = getFloatAreaSize();
        const shellRect = appShell.getBoundingClientRect();
        setBitmapSize(canvas, floatArea.width, floatArea.height);
        canvas.style.width = "100%";
        canvas.style.height = "100%";
        canvas.style.top = "0";
        canvas.style.left = "0";
        canvas.style.right = "0";
        canvas.style.bottom = "0";
        // Transparent where bottom strip shows through (when includeInFloatArea)
        canvas.style.background = "transparent";
        setBitmapSize(overlayCanvas, shellRect.width, shellRect.height);
        // Do not stomp #postprocess-canvas backing store — WebGL owns DPR size.
        // Assigning CSS-pixel width here clears the buffer to black for a frame.
        if (postprocessCanvas) {
            postprocessCanvas.style.width = "100%";
            postprocessCanvas.style.height = "100%";
        }
        layoutBackgroundCanvases();
        redraw();
        if (postprocessState.renderer && typeof postprocessState.renderer.render === "function"
            && postprocessState.active) {
            try { postprocessState.renderer.render(); } catch (_) { /* ignore */ }
        }
    };

    // Expose so bottom-panel height changes can reflow bitmaps without full re-init
    window.__musicViewResizeCanvases = resizeCanvas;
    window.__musicViewReflowScene = reflowSceneToShell;

    resizeCanvas();
    rememberShellLayout();
    installShellResizeWatch();
    window.addEventListener("resize", () => scheduleShellReflow());
}

function redrawCanvas(canvas, topPanel, ctx, drawableState, containers) {
    void topPanel;
    void containers;
    const { width, height } = canvas;
    ctx.clearRect(0, 0, width, height);
    // Stage fill lives on #bg-canvas / #bg-postprocess-canvas. Doodles stay
    // on this transparent canvas so the blue strip can show through below.

    // Freehand strokes stay on the stage canvas (under floats)
    ctx.strokeStyle = "#000";
    ctx.lineWidth = liveLineWidth(2);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.setLineDash([]);

    drawableState.strokes.forEach(([start, end]) => {
        ctx.beginPath();
        ctx.moveTo(start.x, start.y);
        ctx.lineTo(end.x, end.y);
        ctx.stroke();
    });
    // Connection lines + external labels are drawn on #overlay-canvas (full shell)
    // so they composite correctly over the bottom strip.
}

/**
 * Alpha used when compositing a float into the postprocess capture / overlay.
 * CSS `.is-hidden { opacity: 0 }` does not affect canvas `drawImage`, so hide
 * must be applied here. Inline `element.style.opacity` is the morph/fade override
 * (K16) and wins over `state.visible`.
 */
function containerDrawAlpha(state) {
    if (!state) return 0;
    const el = state.element;
    if (el && el.style.opacity !== "") {
        const n = Number.parseFloat(el.style.opacity);
        if (Number.isFinite(n)) return Math.max(0, Math.min(1, n));
    }
    return state.visible === false ? 0 : 1;
}

/**
 * Draw a container's external label outside one of its four corners.
 * Coordinates are in the same space as `box` (typically shell / overlay space).
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} state
 * @param {{ left:number, top:number, right:number, bottom:number }} box
 * @param {{ width:number, height:number }} clampSize
 */
function drawContainerLabel(ctx, state, box, clampSize) {
    const panelAlpha = containerDrawAlpha(state);
    if (panelAlpha <= 0) return;
    if (state.labelEnabled === false) return;
    const text = (state.label || "").trim();
    if (!text) return;

    const ls = defaultLabelStyle(state.style?.label || {});
    const corner = normalizeLabelCorner(state.labelCorner);
    const gap = Math.max(1, livePx(6));
    const fontSize = liveFontSize(ls.fontSize);

    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, Number(ls.opacity) || 1)) * panelAlpha;
    ctx.font = buildCanvasFont(ls);
    ctx.textBaseline = "top";
    ctx.letterSpacing = `${livePx(ls.letterSpacing)}px`;

    const metrics = ctx.measureText(text);
    const textW = metrics.width;
    // Approximate height from font size (measureText height is uneven across engines)
    const textH = fontSize * 1.25;
    const padX = hasVisibleBackground(ls.background) ? livePx(4) : 0;
    const padY = hasVisibleBackground(ls.background) ? livePx(2) : 0;
    const blockW = textW + padX * 2;
    const blockH = textH + padY * 2;

    let x;
    let y;

    switch (corner) {
        case "bottom-left":
            x = box.left - gap - blockW;
            y = box.bottom + gap;
            break;
        case "top-right":
            x = box.right + gap;
            y = box.top - gap - blockH;
            break;
        case "top-left":
            x = box.left - gap - blockW;
            y = box.top - gap - blockH;
            break;
        case "bottom-right":
        default:
            x = box.right + gap;
            y = box.bottom + gap;
            break;
    }

    const maxX = (clampSize?.width || ctx.canvas.width) - blockW;
    const maxY = (clampSize?.height || ctx.canvas.height) - blockH;
    x = Math.max(0, Math.min(maxX, x));
    y = Math.max(0, Math.min(maxY, y));

    // Optional background only (never a border)
    if (hasVisibleBackground(ls.background)) {
        ctx.fillStyle = ls.background;
        ctx.fillRect(x, y, blockW, blockH);
    }

    ctx.fillStyle = ls.color || "#111";
    ctx.textAlign = "left";
    ctx.fillText(text, x + padX, y + padY);

    ctx.restore();
}

function hasVisibleBackground(bg) {
    if (bg == null || bg === "" || bg === "transparent" || bg === "none") return false;
    const s = String(bg).toLowerCase().replace(/\s+/g, "");
    if (s === "rgba(0,0,0,0)" || s === "hsla(0,0%,0%,0)") return false;
    return true;
}

/**
 * Overlay is full-shell: connection lines, labels, and borders.
 * Drawn above the bottom strip so links remain visible when floats sit on it.
 * Lines are punched out under each float so they only show in the gaps (same as
 * when they lived under boxes on #top-canvas).
 */
function redrawOverlay(canvas, ctx, topPanel, containers) {
    const { width, height } = canvas;
    ctx.clearRect(0, 0, width, height);

    const offsetX = topPanel.offsetLeft;
    const offsetY = topPanel.offsetTop;

    const sorted = [...containers].sort((a, b) => (a.layer || 0) - (b.layer || 0));

    // 1) Connection lines in shell space (full height including bottom strip)
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const state of sorted) {
        if (!state?.connect || !state.attachTo) continue;
        const srcAlpha = containerDrawAlpha(state);
        if (srcAlpha <= 0) continue;
        const targetState = sorted.find((s) => s.element === state.attachTo);
        const dstAlpha = targetState ? containerDrawAlpha(targetState) : 1;
        if (dstAlpha <= 0) continue;
        const source = getCenter(state.element, topPanel);
        const target = getCenter(state.attachTo, topPanel);
        const lineStyle = state.style?.connect || {};
        ctx.save();
        ctx.globalAlpha = Math.min(srcAlpha, dstAlpha);
        ctx.strokeStyle = lineStyle.color || "#000";
        ctx.lineWidth = liveLineWidth(lineStyle.lineWidth);
        ctx.setLineDash(liveDash(lineStyle.dash));
        ctx.beginPath();
        ctx.moveTo(offsetX + source.x, offsetY + source.y);
        ctx.lineTo(offsetX + target.x, offsetY + target.y);
        ctx.stroke();
        ctx.restore();
    }
    ctx.setLineDash([]);

    // 2) External labels (shell space — can sit over the bottom strip)
    for (const state of sorted) {
        if (!state?.element) continue;
        const el = state.element;
        const box = {
            left: offsetX + el.offsetLeft,
            top: offsetY + el.offsetTop,
            right: offsetX + el.offsetLeft + el.offsetWidth,
            bottom: offsetY + el.offsetTop + el.offsetHeight,
        };
        drawContainerLabel(ctx, state, box, { width, height });
    }

    // 3) Punch float interiors so connector lines don't cross through panels
    for (const state of sorted) {
        if (!state?.element) continue;
        if (containerDrawAlpha(state) <= 0) continue;
        const el = state.element;
        const x = offsetX + el.offsetLeft;
        const y = offsetY + el.offsetTop;
        const w = el.offsetWidth;
        const h = el.offsetHeight;
        ctx.save();
        ctx.globalCompositeOperation = "destination-out";
        ctx.fillStyle = "rgba(0,0,0,1)";
        ctx.fillRect(x, y, w, h);
        ctx.restore();
    }

    // 4) Borders on top of everything else on this canvas
    sorted.forEach((state, index) => {
        if (!state?.element) return;
        const alpha = containerDrawAlpha(state);
        if (alpha <= 0) return;
        const el = state.element;
        const x = offsetX + el.offsetLeft;
        const y = offsetY + el.offsetTop;
        const w = el.offsetWidth;
        const h = el.offsetHeight;

        // Preserve prior stacking cutout behavior for multi-layer overlaps
        if (index > 0) {
            ctx.save();
            ctx.globalCompositeOperation = "destination-out";
            ctx.fillStyle = "rgba(0,0,0,1)";
            ctx.fillRect(x, y, w, h);
            ctx.restore();
        }

        ctx.save();
        ctx.globalAlpha = alpha;
        const borderStyle = state.style?.border || {};
        ctx.strokeStyle = borderStyle.color || "#000";
        ctx.lineWidth = liveLineWidth(borderStyle.lineWidth);
        ctx.setLineDash(liveDash(borderStyle.dash));
        ctx.beginPath();
        ctx.rect(x - 1, y - 1, w + 2, h + 2);
        ctx.stroke();
        ctx.restore();
    });
}

function getCenter(element, topPanel) {
    void topPanel;
    return {
        x: element.offsetLeft + element.offsetWidth / 2,
        y: element.offsetTop + element.offsetHeight / 2,
    };
}

function distance(x1, y1, x2, y2) {
    const dx = x1 - x2;
    const dy = y1 - y2;
    return Math.hypot(dx, dy);
}

function isPositionAllowed(left, top, width, height, containers, selfState = null) {
    const centerX = left + width / 2;
    const centerY = top + height / 2;

    for (const other of containers) {
        if (!other || !other.element) continue;
        if (selfState && other === selfState) continue;
        const otherCenterX = other.element.offsetLeft + other.element.offsetWidth / 2;
        const otherCenterY = other.element.offsetTop + other.element.offsetHeight / 2;
        const minDist = Number(other.distancing || 0);
        if (minDist > 0) {
            const d = distance(centerX, centerY, otherCenterX, otherCenterY);
            if (d < minDist) return false;
        }
    }

    return true;
}

// ── Final postprocess stack ──────────────────────────────────────────────
// Each frame the full window scene is composited into a texture, then one or
// more fragment shaders process it in order onto #postprocess-canvas.
// Stack is editable from the controls window (add / remove / reorder / uniforms).

let postprocessState = {
    canvas: null,
    renderer: null,
    /** Global enable for the whole stack */
    active: true,
    /** Ordered stack entries */
    layers: [],
    nextLayerId: 1,
    getSources: null,
};

function nextPostprocessLayerId() {
    return postprocessState.nextLayerId++;
}

function findPostprocessLayer(id) {
    return postprocessState.layers.find((l) => l.id === Number(id)) || null;
}

function snapshotPostprocessLayers() {
    return postprocessState.layers
        .filter((l) => !l._showFx)
        .map((l, index) => ({
            id: l.id,
            index,
            shaderId: l.shaderId || null,
            shaderPath: l.shaderPath || null,
            shaderMeta: l.shaderMeta || null,
            uniforms: Object.assign({}, l.uniforms || {}),
            modulators: cloneModulators(l.modulators),
            enabled: l.enabled !== false,
        }));
}

/**
 * Paint the full app-shell scene into `dest` (a 2d canvas) for the postprocess texture.
 * Includes panels, canvases, floating containers, and simple DOM text.
 */
function captureSceneToCanvas(dest) {
    const getSources = postprocessState.getSources;
    if (!getSources || !dest) return;

    const sources = getSources();
    const shell = sources.shell;
    if (!shell) return;

    const dpr = window.devicePixelRatio || 1;
    const sw = Math.max(1, shell.clientWidth);
    const sh = Math.max(1, shell.clientHeight);
    const outW = Math.max(1, Math.floor(sw * dpr));
    const outH = Math.max(1, Math.floor(sh * dpr));

    if (dest.width !== outW || dest.height !== outH) {
        dest.width = outW;
        dest.height = outH;
    }

    const ctx = dest.getContext('2d');
    if (!ctx) return;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, outW, outH);
    // Draw in CSS pixel space, scaled by DPR
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const shellRect = shell.getBoundingClientRect();

    // Shell / body background
    const grad = ctx.createLinearGradient(0, 0, 0, sh);
    grad.addColorStop(0, '#111111');
    grad.addColorStop(1, '#1e1e1e');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, sw, sh);

    // Bottom strip first so stage doodles / overlay lines can composite over it
    {
        const bottomEl = document.querySelector('.bottom-panel');
        const bh = getBottomHeightPx();
        if (bottomEl && bh > 0 && !bottomEl.classList.contains('is-collapsed')) {
            const br = bottomEl.getBoundingClientRect();
            const bx = br.left - shellRect.left;
            const by = br.top - shellRect.top;
            ctx.fillStyle = normalizeHexColor(scene.bottomPanel?.color, '#2563eb');
            ctx.fillRect(bx, by, br.width, Math.max(br.height, bh));
        }
    }

    // Stage fill (solid / shader / image / video + optional background FX)
    const topPanel = sources.topPanel;
    if (topPanel) {
        const tp = topPanel.getBoundingClientRect();
        const tpx = tp.left - shellRect.left;
        const tpy = tp.top - shellRect.top;
        const stage = getStageWhiteSize();
        const whiteH = Math.max(0, Math.min(tp.height, stage.height));
        if (whiteH > 0) {
            drawBackgroundIntoCapture(ctx, tpx, tpy, tp.width, whiteH);
        }

        // Stage doodle canvas (transparent over bottom strip when float area includes it)
        const topCanvas = sources.topCanvas;
        if (topCanvas && topCanvas.width > 0 && topCanvas.height > 0) {
            try {
                ctx.drawImage(topCanvas, tpx, tpy, tp.width, tp.height);
            } catch (e) { /* tainted or lost context */ }
        }
    }

    // Floating containers (back to front by layer)
    // Overlay (connection lines, labels, borders) is drawn after floats so lines
    // sit above the bottom strip; holes under panels are already punched in overlay.
    const containers = sources.containers || [];
    const sorted = [...containers].sort((a, b) => (a.layer || 0) - (b.layer || 0));
    for (const state of sorted) {
        if (!state || !state.element) continue;
        const alpha = containerDrawAlpha(state);
        if (alpha <= 0) continue;
        const el = state.element;
        const r = el.getBoundingClientRect();
        const x = r.left - shellRect.left;
        const y = r.top - shellRect.top;
        const w = r.width;
        const h = r.height;

        ctx.save();
        ctx.globalAlpha = alpha;

        // Prefer per-container postprocess output when the stack is live
        if (containerPostprocessIsLive(state) && state.postprocessCanvas
            && state.postprocessCanvas.width > 0 && state.postprocessCanvas.height > 0) {
            try {
                ctx.drawImage(state.postprocessCanvas, x, y, w, h);
            } catch (e) { /* webgl readback can fail rarely */ }
            ctx.restore();
            continue;
        }

        // Progress bar already paints fill + dual-tone times on its canvas
        const isProgress = isProgressContainer(state);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(x, y, w, h);

        if (state.innerCanvas && state.innerCanvas.width > 0 && state.innerCanvas.height > 0) {
            try {
                ctx.drawImage(state.innerCanvas, x, y, w, h);
            } catch (e) { /* webgl readback can fail rarely */ }
        }

        // Song info: stacked title / artist / album (not .floating-text)
        const infoBlock = el.querySelector('.song-info-block');
        const lyricsBlock = el.querySelector('.song-lyrics-block');
        if (infoBlock) {
            paintSongInfoBlock(ctx, infoBlock, shellRect);
        } else if (lyricsBlock) {
            paintSongLyricsBlock(ctx, lyricsBlock, shellRect);
        } else if (!isProgress) {
            // Generic in-container text content
            const textEl = el.querySelector('.floating-text');
            if (textEl && textEl.style.display !== 'none' && (textEl.textContent || '').trim()) {
                paintDomBox(ctx, textEl, shellRect);
            }
        }
        ctx.restore();
    }

    // Overlay (borders / cutouts) — full shell size
    const overlayCanvas = sources.overlayCanvas;
    if (overlayCanvas && overlayCanvas.width > 0 && overlayCanvas.height > 0) {
        try {
            ctx.drawImage(overlayCanvas, 0, 0, sw, sh);
        } catch (e) { /* ignore */ }
    }
}

/** Paint stacked song title / artist / album for the postprocess capture. */
function paintSongInfoBlock(ctx, block, shellRect) {
    paintStackedTextLines(ctx, block, shellRect, '.song-info-title, .song-info-artist, .song-info-album');
}

/** Word-wrap text to fit maxWidth (canvas measureText). */
function wrapCanvasText(ctx, text, maxWidth) {
    const width = Math.max(4, maxWidth);
    const raw = String(text || '');
    if (!raw) return [''];
    // Honor explicit newlines first
    const paragraphs = raw.split(/\n+/);
    const out = [];
    for (const para of paragraphs) {
        const words = para.split(/\s+/).filter(Boolean);
        if (!words.length) {
            out.push('');
            continue;
        }
        let current = '';
        for (const word of words) {
            const test = current ? `${current} ${word}` : word;
            if (ctx.measureText(test).width <= width) {
                current = test;
                continue;
            }
            if (current) out.push(current);
            // Break overlong single words so they stay inside the container
            if (ctx.measureText(word).width <= width) {
                current = word;
            } else {
                let chunk = '';
                for (const ch of word) {
                    const next = chunk + ch;
                    if (chunk && ctx.measureText(next).width > width) {
                        out.push(chunk);
                        chunk = ch;
                    } else {
                        chunk = next;
                    }
                }
                current = chunk;
            }
        }
        if (current) out.push(current);
    }
    return out.length ? out : [''];
}

/** Paint focused lyrics lines for the postprocess capture (active + nearby). */
function paintSongLyricsBlock(ctx, block, shellRect) {
    if (!block) return;
    // Viewport may be the block itself
    const viewport = block.classList?.contains('song-lyrics-viewport')
        ? block
        : block.querySelector?.('.song-lyrics-viewport') || block;
    const track = viewport.querySelector?.('.song-lyrics-track');
    if (!track) {
        // Legacy fallback
        paintStackedTextLines(ctx, block, shellRect, '.song-lyrics-prev, .song-lyrics-current, .song-lyrics-next');
        return;
    }

    const vp = viewport.getBoundingClientRect();
    const lines = track.querySelectorAll('.song-lyrics-line');
    lines.forEach((line) => {
        const raw = (line.textContent || '').replace(/\u00a0/g, ' ').trim();
        if (!raw) return;
        const r = line.getBoundingClientRect();
        // Skip lines fully outside the viewport
        if (r.bottom < vp.top || r.top > vp.bottom) return;
        if (r.width < 1 || r.height < 1) return;
        const style = getComputedStyle(line);
        if (style.display === 'none' || style.visibility === 'hidden') return;
        const opacity = parseFloat(style.opacity);
        if (opacity === 0) return;

        const x = r.left - shellRect.left;
        const y = r.top - shellRect.top;
        ctx.save();
        // Clip to viewport
        ctx.beginPath();
        ctx.rect(
            vp.left - shellRect.left,
            vp.top - shellRect.top,
            vp.width,
            vp.height,
        );
        ctx.clip();
        ctx.globalAlpha = (opacity || 1) * ctx.globalAlpha;
        ctx.fillStyle = style.color || '#111';
        const fontSize = parseFloat(style.fontSize) || 14;
        const fontWeight = style.fontWeight || 'normal';
        const fontStyle = style.fontStyle || 'normal';
        const fontFamily = style.fontFamily || 'system-ui, sans-serif';
        ctx.font = `${fontStyle} ${fontWeight} ${fontSize}px ${fontFamily}`;
        ctx.textBaseline = 'middle';
        const align = style.textAlign === 'right' ? 'right'
            : style.textAlign === 'left' || style.textAlign === 'start' ? 'left'
            : style.textAlign === 'justify' ? 'left'
            : 'center';
        ctx.textAlign = align;
        const padL = parseFloat(style.paddingLeft) || 0;
        const padR = parseFloat(style.paddingRight) || 0;
        const padT = parseFloat(style.paddingTop) || 0;
        const padB = parseFloat(style.paddingBottom) || 0;
        const contentW = Math.max(4, r.width - padL - padR);
        const tx = align === 'center' ? x + r.width / 2
            : align === 'right' ? x + r.width - padR
            : x + padL;

        // Empty-glitch uses pre/nowrap; normal lyrics wrap to container width
        const noWrap = style.whiteSpace === 'nowrap' || style.whiteSpace === 'pre';
        const wrapped = noWrap ? [raw] : wrapCanvasText(ctx, raw, contentW);
        const lineHeight = parseFloat(style.lineHeight) || fontSize * 1.35;
        const totalH = wrapped.length * lineHeight;
        const contentH = Math.max(0, r.height - padT - padB);
        const startY = y + padT + contentH / 2 - totalH / 2 + lineHeight / 2;
        for (let i = 0; i < wrapped.length; i++) {
            ctx.fillText(wrapped[i], tx, startY + i * lineHeight, contentW);
        }
        ctx.restore();
    });
}

function paintStackedTextLines(ctx, block, shellRect, selector) {
    if (!block) return;
    const lines = block.querySelectorAll(selector);
    lines.forEach((line) => {
        const raw = (line.textContent || '').replace(/\u00a0/g, ' ').trim();
        if (!raw) return;
        const r = line.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) return;
        const x = r.left - shellRect.left;
        const y = r.top - shellRect.top;
        const style = getComputedStyle(line);
        if (style.display === 'none' || style.visibility === 'hidden') return;
        if (parseFloat(style.opacity) === 0) return;

        ctx.save();
        ctx.globalAlpha = (parseFloat(style.opacity) || 1) * ctx.globalAlpha;
        ctx.fillStyle = style.color || '#111';
        const fontSize = parseFloat(style.fontSize) || 14;
        const fontWeight = style.fontWeight || 'normal';
        const fontStyle = style.fontStyle || 'normal';
        const fontFamily = style.fontFamily || 'system-ui, sans-serif';
        ctx.font = `${fontStyle} ${fontWeight} ${fontSize}px ${fontFamily}`;
        // Geometric vertical center (middle), not alphabetic baseline
        ctx.textBaseline = 'middle';
        const align = style.textAlign === 'right' ? 'right'
            : style.textAlign === 'left' || style.textAlign === 'start' ? 'left'
            : style.textAlign === 'justify' ? 'left'
            : 'center';
        ctx.textAlign = align;
        const tx = align === 'center' ? x + r.width / 2
            : align === 'right' ? x + r.width - (parseFloat(style.paddingRight) || 0)
            : x + (parseFloat(style.paddingLeft) || 0);
        ctx.fillText(raw, tx, y + r.height / 2, Math.max(4, r.width));
        ctx.restore();
    });
}

/** Paint a simple styled box + text from a DOM element (e.g. in-container text). */
function paintDomBox(ctx, el, shellRect) {
    const r = el.getBoundingClientRect();
    const x = r.left - shellRect.left;
    const y = r.top - shellRect.top;
    const style = getComputedStyle(el);
    const bg = style.backgroundColor;
    if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
        ctx.fillStyle = bg;
        ctx.fillRect(x, y, r.width, r.height);
    }
    const text = (el.textContent || '').trim();
    if (!text) return;
    ctx.fillStyle = style.color || '#000';
    const fontSize = parseFloat(style.fontSize) || 12;
    const fontFamily = style.fontFamily || 'system-ui, sans-serif';
    ctx.font = `${style.fontWeight || 'normal'} ${fontSize}px ${fontFamily}`;
    // Geometric vertical center (middle), not alphabetic baseline
    ctx.textBaseline = 'middle';
    const align = style.textAlign === 'center' ? 'center'
        : style.textAlign === 'right' ? 'right'
        : style.textAlign === 'justify' ? 'left'
        : 'left';
    ctx.textAlign = align;
    const tx = align === 'center' ? x + r.width / 2
        : align === 'right' ? x + r.width - (parseFloat(style.paddingRight) || 0)
        : x + (parseFloat(style.paddingLeft) || 0);
    ctx.fillText(text, tx, y + r.height / 2, r.width);
}

/** Recursively paint text leaves of a DOM subtree at their screen positions. */
function paintDomTree(ctx, root, shellRect) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
        const text = (node.textContent || '').trim();
        if (!text) continue;
        const parent = node.parentElement;
        if (!parent) continue;
        const style = getComputedStyle(parent);
        if (style.display === 'none' || style.visibility === 'hidden') continue;
        if (parseFloat(style.opacity) === 0) continue;

        const r = parent.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) continue;

        const x = r.left - shellRect.left;
        const y = r.top - shellRect.top;
        const fontSize = parseFloat(style.fontSize) || 16;
        const fontFamily = style.fontFamily || 'system-ui, sans-serif';
        const fontWeight = style.fontWeight || 'normal';
        ctx.fillStyle = style.color || '#000';
        ctx.globalAlpha = parseFloat(style.opacity) || 1;
        ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
        ctx.textAlign = (style.textAlign === 'center') ? 'center'
            : (style.textAlign === 'right') ? 'right' : 'left';
        ctx.textBaseline = 'middle';

        const tx = ctx.textAlign === 'center' ? x + r.width / 2
            : ctx.textAlign === 'right' ? x + r.width
            : x;
        // Multi-line: split on newlines only; long lines left as-is for simplicity
        const lines = text.split(/\n+/);
        const lineHeight = fontSize * 1.25;
        const startY = y + r.height / 2 - ((lines.length - 1) * lineHeight) / 2;
        lines.forEach((line, i) => {
            ctx.fillText(line, tx, startY + i * lineHeight, r.width);
        });
        ctx.globalAlpha = 1;
    }
}

async function setupPostprocess(canvas, options = {}) {
    if (!canvas) {
        console.warn('setupPostprocess: no canvas');
        return null;
    }
    postprocessState.canvas = canvas;
    if (options.getSources) postprocessState.getSources = options.getSources;

    try {
        if (Array.isArray(options.layers) && options.layers.length) {
            postprocessState.layers = [];
            for (const entry of options.layers) {
                await addPostprocessLayer(entry.shaderId || entry.shaderPath || 'lcd', {
                    uniforms: entry.uniforms,
                    enabled: entry.enabled !== false,
                    rebuild: false,
                });
            }
            await rebuildPostprocessStack();
        } else {
            const shaderId = options.shaderId
                || (options.shaderPath ? resolveShaderId(options.shaderPath) : null)
                || 'lcd';
            await addPostprocessLayer(shaderId, {
                uniforms: options.uniforms || null,
                enabled: true,
            });
        }
        postprocessState.active = options.active !== false;
        if (postprocessState.active) startPostprocessStack();
        else stopPostprocess();
    } catch (e) {
        console.warn('Failed to start postprocess stack:', e);
    }
    return postprocessState;
}

function postprocessTopologyKey(layers) {
    return shaderSeqKey(layers);
}

function applyDefsToLiveStack(renderer, stackDefs) {
    if (!renderer) return;
    for (const def of stackDefs) {
        if (typeof renderer.setLayerUniforms === "function") {
            renderer.setLayerUniforms(def.key, def.uniforms || {});
        }
        if (typeof renderer.setLayerModulators === "function") {
            renderer.setLayerModulators(def.key, def.modulators || {});
        }
        if (typeof renderer.setLayerBoundsByName === "function") {
            renderer.setLayerBoundsByName(def.key, def.boundsByName || {});
        }
        if (typeof renderer.setLayerEnabled === "function") {
            renderer.setLayerEnabled(def.key, def.enabled !== false);
        }
    }
}

/** Build / rebuild the GPU stack from postprocessState.layers. */
async function rebuildPostprocessStack() {
    if (!postprocessState.canvas) return;

    const stackDefs = [];
    for (const layer of postprocessState.layers) {
        if (!layer.shaderId && !layer.shaderPath && !layer._inlineSource) continue;
        try {
            if (layer._inlineSource) {
                stackDefs.push({
                    key: String(layer.id),
                    fragSource: layer._inlineSource,
                    uniforms: layer.uniforms || {},
                    modulators: sanitizeModulatorsMap(layer.modulators),
                    boundsByName: boundsFromShaderMeta(layer.shaderMeta),
                    enabled: layer.enabled !== false,
                });
                continue;
            }
            const pkg = await loadShaderPackage(layer.shaderId || layer.shaderPath);
            layer.shaderId = pkg.id;
            layer.shaderPath = pkg.fragPath;
            layer.shaderMeta = packageToClientMeta(pkg);
            const defaults = defaultsFromControls(pkg.uniforms);
            layer.uniforms = Object.assign({}, defaults, layer.uniforms || {});
            // Drop invalid / static entries so live map stays clean across rebuilds
            layer.modulators = sanitizeModulatorsMap(layer.modulators);
            stackDefs.push({
                key: String(layer.id),
                fragSource: pkg.source,
                uniforms: layer.uniforms,
                modulators: layer.modulators,
                boundsByName: boundsFromShaderMeta(layer.shaderMeta),
                enabled: layer.enabled !== false,
            });
        } catch (e) {
            console.warn('Skipping postprocess layer', layer.id, e);
        }
    }

    const nextKey = postprocessTopologyKey(postprocessState.layers);
    if (postprocessState.renderer && postprocessState._topologyKey === nextKey) {
        applyDefsToLiveStack(postprocessState.renderer, stackDefs);
        if (postprocessState.active) startPostprocessStack();
        else stopPostprocess();
        return;
    }

    const keepTime = postprocessState.renderer && typeof postprocessState.renderer.getTime === "function"
        ? postprocessState.renderer.getTime()
        : null;
    if (postprocessState.renderer) {
        try { postprocessState.renderer.destroy(); } catch (e) {}
        postprocessState.renderer = null;
    }

    postprocessState.renderer = createPostprocessStack(
        postprocessState.canvas,
        stackDefs,
        captureSceneToCanvas,
    );
    postprocessState._topologyKey = nextKey;
    if (keepTime != null && typeof postprocessState.renderer.setTime === "function") {
        postprocessState.renderer.setTime(keepTime);
    }

    if (postprocessState.active) {
        postprocessState.canvas.style.visibility = 'visible';
        postprocessState.renderer.start();
    } else {
        postprocessState.canvas.style.visibility = 'hidden';
    }
}

function startPostprocessStack() {
    postprocessState.active = true;
    if (!postprocessState.renderer) {
        // Fire-and-forget rebuild; callers that need completion should await rebuildPostprocessStack
        rebuildPostprocessStack().catch((e) => console.warn('rebuildPostprocessStack failed', e));
        return;
    }
    if (postprocessState.canvas) postprocessState.canvas.style.visibility = 'visible';
    postprocessState.renderer.start();
}

function stopPostprocess() {
    const wasActive = !!postprocessState.active
        || (postprocessState.canvas && postprocessState.canvas.style.visibility !== "hidden");
    postprocessState.active = false;
    if (postprocessState.renderer) {
        try { postprocessState.renderer.stop(); } catch (e) {}
    }
    if (postprocessState.canvas && wasActive) {
        postprocessState.canvas.style.visibility = "hidden";
    }
}

/**
 * Append a layer to the stack.
 * @param {string} idOrPath
 * @param {{ uniforms?: object, enabled?: boolean, index?: number, rebuild?: boolean }} [opts]
 */
async function addPostprocessLayer(idOrPath, opts = {}) {
    const pkg = await loadShaderPackage(idOrPath);
    const uniforms = Object.assign(
        {},
        defaultsFromControls(pkg.uniforms),
        opts.uniforms || {},
    );
    const layer = {
        id: nextPostprocessLayerId(),
        shaderId: pkg.id,
        shaderPath: pkg.fragPath,
        shaderMeta: packageToClientMeta(pkg),
        uniforms,
        /** Optional ParamModulator map (sibling of uniforms; Phase 1+) */
        modulators: sanitizeModulatorsMap(opts.modulators),
        enabled: opts.enabled !== false,
        _showFx: !!opts._showFx,
    };

    const idx = opts.index;
    if (typeof idx === 'number' && idx >= 0 && idx < postprocessState.layers.length) {
        postprocessState.layers.splice(idx, 0, layer);
    } else {
        postprocessState.layers.push(layer);
    }

    if (opts.rebuild !== false) {
        await rebuildPostprocessStack();
    }
    return layer;
}

async function removePostprocessLayer(id) {
    const before = postprocessState.layers.length;
    postprocessState.layers = postprocessState.layers.filter((l) => l.id !== Number(id));
    if (postprocessState.layers.length !== before) {
        await rebuildPostprocessStack();
        return true;
    }
    return false;
}

async function reorderPostprocessLayers(orderedIds) {
    const ids = (Array.isArray(orderedIds) ? orderedIds : []).map(Number);
    const byId = new Map(postprocessState.layers.map((l) => [l.id, l]));
    const next = [];
    for (const id of ids) {
        const layer = byId.get(id);
        if (layer) {
            next.push(layer);
            byId.delete(id);
        }
    }
    for (const layer of byId.values()) next.push(layer);
    postprocessState.layers = next;
    await rebuildPostprocessStack();
}

async function movePostprocessLayer(id, toIndex) {
    const from = postprocessState.layers.findIndex((l) => l.id === Number(id));
    if (from < 0) return false;
    const [layer] = postprocessState.layers.splice(from, 1);
    const to = Math.max(0, Math.min(postprocessState.layers.length, Number(toIndex) || 0));
    postprocessState.layers.splice(to, 0, layer);
    await rebuildPostprocessStack();
    return true;
}

async function setPostprocessLayerShader(id, idOrPath, uniformsOverride = null) {
    const layer = findPostprocessLayer(id);
    if (!layer) throw new Error('Layer not found');
    const pkg = await loadShaderPackage(idOrPath);
    const uniforms = Object.assign(
        {},
        defaultsFromControls(pkg.uniforms),
        uniformsOverride != null ? uniformsOverride : (layer.uniforms || {}),
    );
    layer.shaderId = pkg.id;
    layer.shaderPath = pkg.fragPath;
    layer.shaderMeta = packageToClientMeta(pkg);
    layer.uniforms = uniforms;
    // Package change clears modulators (Phase 0 lock)
    layer.modulators = {};
    delete layer._inlineSource;
    await rebuildPostprocessStack();
    return layer;
}

function updatePostprocessLayerUniforms(id, uniforms) {
    const layer = findPostprocessLayer(id);
    if (!layer) return;
    layer.uniforms = Object.assign({}, layer.uniforms || {}, uniforms || {});
    if (postprocessState.renderer) {
        postprocessState.renderer.setLayerUniforms(String(layer.id), layer.uniforms);
    }
}

/**
 * Partial-merge modulator specs for a postprocess layer.
 * Pass `{ name: null }` to clear one key; pass `{}` only updates nothing.
 * Replaces GPU stack modulators with the full map after merge.
 * @param {number|string} id
 * @param {Record<string, object|null>|null} modulators
 */
function updatePostprocessLayerModulators(id, modulators) {
    const layer = findPostprocessLayer(id);
    if (!layer) return;
    if (!layer.modulators || typeof layer.modulators !== 'object') {
        layer.modulators = {};
    }
    if (modulators == null) {
        layer.modulators = {};
    } else if (typeof modulators === 'object') {
        for (const k of Object.keys(modulators)) {
            const v = modulators[k];
            // null / static clears one key
            if (v == null) {
                delete layer.modulators[k];
                continue;
            }
            if (typeof v !== 'object') continue;
            const src = String(v.source != null ? v.source : (layer.modulators[k]?.source || '')).toLowerCase();
            if (v.source != null && (src === 'static' || src === '')) {
                delete layer.modulators[k];
                continue;
            }
            // Field-level merge so rate-only patches do not zero offset/amp
            const merged = Object.assign({}, layer.modulators[k] || {}, v);
            // Explicit stack/null clock clears wall|song
            if (v.clock === 'stack' || v.clock === null || v.clock === '') {
                delete merged.clock;
            }
            const s = sanitizeModulatorSpec(merged);
            if (s) layer.modulators[k] = s;
            else delete layer.modulators[k];
        }
    }
    layer.modulators = sanitizeModulatorsMap(layer.modulators);
    if (postprocessState.renderer && typeof postprocessState.renderer.setLayerModulators === 'function') {
        postprocessState.renderer.setLayerModulators(String(layer.id), layer.modulators);
    }
    if (postprocessState.renderer && typeof postprocessState.renderer.setLayerBoundsByName === 'function') {
        postprocessState.renderer.setLayerBoundsByName(
            String(layer.id),
            boundsFromShaderMeta(layer.shaderMeta),
        );
    }
}

function setPostprocessLayerEnabled(id, enabled) {
    const layer = findPostprocessLayer(id);
    if (!layer) return;
    layer.enabled = !!enabled;
    if (postprocessState.renderer) {
        postprocessState.renderer.setLayerEnabled(String(layer.id), layer.enabled);
    }
}

/** Replace entire stack from a serializable description. */
async function setPostprocessStack(layersSpec, { active } = {}) {
    const list = Array.isArray(layersSpec) ? layersSpec : [];
    const live = postprocessState.layers || [];
    if (live.length === list.length && live.length > 0
        && shaderSeqKey(live) === shaderSeqKey(list)
        && postprocessState.renderer) {
        for (let i = 0; i < live.length; i++) {
            const entry = list[i];
            live[i].uniforms = Object.assign({}, live[i].uniforms || {}, sanitizeUniformMap(entry.uniforms || {}));
            live[i].modulators = sanitizeModulatorsMap(entry.modulators);
            live[i].enabled = entry.enabled !== false;
            if (entry._showFx) live[i]._showFx = true;
        }
        if (active != null) postprocessState.active = !!active;
        await rebuildPostprocessStack();
        if (postprocessState.active) startPostprocessStack();
        else stopPostprocess();
        return;
    }
    postprocessState.layers = [];
    for (const entry of list) {
        await addPostprocessLayer(entry.shaderId || entry.shaderPath || 'lcd', {
            uniforms: entry.uniforms,
            modulators: entry.modulators,
            enabled: entry.enabled !== false,
            rebuild: false,
            _showFx: !!entry._showFx,
        });
        if (entry.id != null) {
            const last = postprocessState.layers[postprocessState.layers.length - 1];
            if (last) last.id = Number(entry.id);
            postprocessState.nextLayerId = Math.max(
                postprocessState.nextLayerId,
                Number(entry.id) + 1,
            );
        }
    }
    if (active != null) postprocessState.active = !!active;
    await rebuildPostprocessStack();
    if (postprocessState.active) startPostprocessStack();
    else stopPostprocess();
}

// Legacy: replace stack with a single package layer
async function applyPostprocessPackage(idOrPath, uniformsOverride = null) {
    postprocessState.layers = [];
    await addPostprocessLayer(idOrPath, { uniforms: uniformsOverride, enabled: true });
    postprocessState.active = true;
    startPostprocessStack();
}

async function setPostprocessShaderPath(path, uniforms) {
    await applyPostprocessPackage(path, uniforms);
}

function updatePostprocessUniforms(uniforms) {
    const layer = postprocessState.layers[0];
    if (!layer) return;
    updatePostprocessLayerUniforms(layer.id, uniforms);
}

function applyPostprocessShader(fragSource, uniforms = {}) {
    if (!postprocessState.canvas) return;
    const layer = {
        id: nextPostprocessLayerId(),
        shaderId: null,
        shaderPath: null,
        shaderMeta: { id: null, name: 'Inline', description: '', uniforms: [] },
        uniforms: Object.assign({}, uniforms || {}),
        modulators: {},
        enabled: true,
        _inlineSource: fragSource,
    };
    postprocessState.layers = [layer];
    if (postprocessState.renderer) {
        try { postprocessState.renderer.destroy(); } catch (e) {}
    }
    postprocessState.renderer = createPostprocessStack(
        postprocessState.canvas,
        [{
            key: String(layer.id),
            fragSource,
            uniforms: layer.uniforms,
            modulators: {},
            boundsByName: {},
            enabled: true,
        }],
        captureSceneToCanvas,
    );
    postprocessState.active = true;
    postprocessState.canvas.style.visibility = 'visible';
    postprocessState.renderer.start();
}

window.postprocessAPI = {
    setup: setupPostprocess,
    setShaderPath: setPostprocessShaderPath,
    applyPackage: applyPostprocessPackage,
    applyShader: applyPostprocessShader,
    setUniforms: updatePostprocessUniforms,
    stop: stopPostprocess,
    start: startPostprocessStack,
    rebuild: rebuildPostprocessStack,
    addLayer: addPostprocessLayer,
    removeLayer: removePostprocessLayer,
    reorder: reorderPostprocessLayers,
    moveLayer: movePostprocessLayer,
    setLayerShader: setPostprocessLayerShader,
    setLayerUniforms: updatePostprocessLayerUniforms,
    setLayerModulators: updatePostprocessLayerModulators,
    setLayerEnabled: setPostprocessLayerEnabled,
    setStack: setPostprocessStack,
    getState: () => postprocessState,
    captureSceneToCanvas,
};

// ── Per-container postprocess stacks ─────────────────────────────────────
// Each floating box can run its own FX stack: capture panel content (fill,
// inner canvas, DOM text) → multi-pass postprocess shaders → output canvas
// covering the panel. Global postprocess then composites those outputs.

function ensureContainerPostprocessState(state) {
    if (!state) return null;
    if (!state.postprocess || typeof state.postprocess !== "object") {
        state.postprocess = { active: false, layers: [], nextLayerId: 1 };
    }
    if (!Array.isArray(state.postprocess.layers)) state.postprocess.layers = [];
    if (!Number.isFinite(state.postprocess.nextLayerId)) state.postprocess.nextLayerId = 1;
    return state.postprocess;
}

function nextContainerPostprocessLayerId(state) {
    const pp = ensureContainerPostprocessState(state);
    const id = pp.nextLayerId++;
    return id;
}

function findContainerPostprocessLayer(state, id) {
    const pp = ensureContainerPostprocessState(state);
    return pp.layers.find((l) => l.id === Number(id)) || null;
}

function snapshotContainerPostprocess(state) {
    const pp = ensureContainerPostprocessState(state);
    return {
        active: !!pp.active,
        layers: pp.layers.map((l, index) => ({
            id: l.id,
            index,
            shaderId: l.shaderId || null,
            shaderPath: l.shaderPath || null,
            shaderMeta: l.shaderMeta || null,
            uniforms: Object.assign({}, l.uniforms || {}),
            modulators: cloneModulators(l.modulators),
            enabled: l.enabled !== false,
        })),
    };
}

function containerPostprocessHasEnabledLayers(state) {
    const pp = state?.postprocess;
    if (!pp || !Array.isArray(pp.layers)) return false;
    return pp.layers.some((l) => l.enabled !== false && (l.shaderId || l.shaderPath || l._inlineSource));
}

function containerPostprocessIsLive(state) {
    return !!(
        state
        && state.postprocess?.active
        && state.postprocessRenderer
        && containerPostprocessHasEnabledLayers(state)
    );
}

/**
 * Ensure the WebGL output canvas exists as a child of the floating box.
 * @param {object} state
 */
function ensureContainerPostprocessDom(state) {
    if (!state?.element) return null;
    let canvas = state.postprocessCanvas;
    if (canvas && canvas.parentElement === state.element) return canvas;

    if (canvas && canvas.parentElement) {
        try { canvas.parentElement.removeChild(canvas); } catch (_) { /* ignore */ }
    }
    canvas = document.createElement("canvas");
    canvas.className = "container-postprocess-canvas";
    canvas.setAttribute("aria-hidden", "true");
    // CSS fill; drawing buffer sized by createPostprocessStack
    canvas.style.position = "absolute";
    canvas.style.left = "0";
    canvas.style.top = "0";
    canvas.style.right = "0";
    canvas.style.bottom = "0";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.pointerEvents = "none";
    state.element.appendChild(canvas);
    state.postprocessCanvas = canvas;
    return canvas;
}

function syncContainerPostprocessVisibility(state) {
    if (!state?.element) return;
    const live = containerPostprocessIsLive(state);
    state.element.classList.toggle("has-container-postprocess", live);
    if (state.postprocessCanvas) {
        state.postprocessCanvas.style.display = live ? "block" : "none";
    }
}

/**
 * Paint this container's unprocessed content into `dest` for the local FX stack.
 * Origin is the container's content box (0,0); uses shellRect = element rect
 * so existing paint* helpers work.
 */
function captureContainerContentToCanvas(state, dest) {
    if (!state?.element || !dest) return;
    const el = state.element;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, el.clientWidth || state.width || 1);
    const h = Math.max(1, el.clientHeight || state.height || 1);
    const outW = Math.max(1, Math.floor(w * dpr));
    const outH = Math.max(1, Math.floor(h * dpr));
    if (dest.width !== outW || dest.height !== outH) {
        dest.width = outW;
        dest.height = outH;
    }
    const ctx = dest.getContext("2d");
    if (!ctx) return;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, outW, outH);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Panel background
    let bg = "#ffffff";
    try {
        const cs = getComputedStyle(el);
        if (cs.backgroundColor && cs.backgroundColor !== "rgba(0, 0, 0, 0)"
            && cs.backgroundColor !== "transparent") {
            bg = cs.backgroundColor;
        }
    } catch (_) { /* ignore */ }
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    // Inner fill (shader / image / progress)
    if (state.innerCanvas && state.innerCanvas.width > 0 && state.innerCanvas.height > 0) {
        try {
            ctx.drawImage(state.innerCanvas, 0, 0, w, h);
        } catch (e) { /* webgl readback */ }
    }

    // DOM text relative to this container
    const shellRect = el.getBoundingClientRect();
    const isProgress = isProgressContainer(state);
    const infoBlock = el.querySelector(".song-info-block");
    const lyricsBlock = el.querySelector(".song-lyrics-block")
        || el.querySelector(".song-lyrics-viewport");
    if (infoBlock) {
        paintSongInfoBlock(ctx, infoBlock, shellRect);
    } else if (lyricsBlock) {
        paintSongLyricsBlock(ctx, lyricsBlock, shellRect);
    } else if (!isProgress) {
        const textEl = el.querySelector(".floating-text");
        if (textEl && textEl.style.display !== "none" && (textEl.textContent || "").trim()) {
            paintDomBox(ctx, textEl, shellRect);
        }
    }
}

/** Build / rebuild the GPU stack for one container. */
async function rebuildContainerPostprocessStack(state) {
    if (!state) return;
    const pp = ensureContainerPostprocessState(state);
    const canvas = ensureContainerPostprocessDom(state);
    if (!canvas) return;

    const stackDefs = [];
    for (const layer of pp.layers) {
        if (!layer.shaderId && !layer.shaderPath && !layer._inlineSource) continue;
        try {
            if (layer._inlineSource) {
                stackDefs.push({
                    key: String(layer.id),
                    fragSource: layer._inlineSource,
                    uniforms: layer.uniforms || {},
                    modulators: sanitizeModulatorsMap(layer.modulators),
                    boundsByName: boundsFromShaderMeta(layer.shaderMeta),
                    enabled: layer.enabled !== false,
                });
                continue;
            }
            const pkg = await loadShaderPackage(layer.shaderId || layer.shaderPath);
            layer.shaderId = pkg.id;
            layer.shaderPath = pkg.fragPath;
            layer.shaderMeta = packageToClientMeta(pkg);
            const defaults = defaultsFromControls(pkg.uniforms);
            layer.uniforms = Object.assign({}, defaults, layer.uniforms || {});
            layer.modulators = sanitizeModulatorsMap(layer.modulators);
            stackDefs.push({
                key: String(layer.id),
                fragSource: pkg.source,
                uniforms: layer.uniforms,
                modulators: layer.modulators,
                boundsByName: boundsFromShaderMeta(layer.shaderMeta),
                enabled: layer.enabled !== false,
            });
        } catch (e) {
            console.warn("Skipping container postprocess layer", state.id, layer.id, e);
        }
    }

    const nextKey = postprocessTopologyKey(pp.layers);
    if (state.postprocessRenderer && state._cppTopologyKey === nextKey) {
        applyDefsToLiveStack(state.postprocessRenderer, stackDefs);
        if (pp.active) startContainerPostprocess(state);
        else stopContainerPostprocess(state);
        syncContainerPostprocessVisibility(state);
        return;
    }
    const keepTime = state.postprocessRenderer && typeof state.postprocessRenderer.getTime === "function"
        ? state.postprocessRenderer.getTime()
        : null;
    if (state.postprocessRenderer) {
        try { state.postprocessRenderer.destroy(); } catch (e) { /* ignore */ }
        state.postprocessRenderer = null;
    }

    if (!stackDefs.length) {
        syncContainerPostprocessVisibility(state);
        return;
    }

    const captureFn = (dest) => captureContainerContentToCanvas(state, dest);
    try {
        state.postprocessRenderer = createPostprocessStack(canvas, stackDefs, captureFn);
        state._cppTopologyKey = nextKey;
        if (keepTime != null && typeof state.postprocessRenderer.setTime === "function") {
            state.postprocessRenderer.setTime(keepTime);
        }
    } catch (e) {
        console.warn("Failed to create container postprocess stack", state.id, e);
        state.postprocessRenderer = null;
        syncContainerPostprocessVisibility(state);
        return;
    }

    if (pp.active) {
        state.postprocessRenderer.start();
    }
    syncContainerPostprocessVisibility(state);
}

function startContainerPostprocess(state) {
    const pp = ensureContainerPostprocessState(state);
    pp.active = true;
    if (!state.postprocessRenderer) {
        rebuildContainerPostprocessStack(state).catch((e) => {
            console.warn("rebuildContainerPostprocessStack failed", e);
        });
        return;
    }
    state.postprocessRenderer.start();
    syncContainerPostprocessVisibility(state);
}

function stopContainerPostprocess(state) {
    const pp = ensureContainerPostprocessState(state);
    pp.active = false;
    if (state.postprocessRenderer) {
        try { state.postprocessRenderer.stop(); } catch (e) { /* ignore */ }
    }
    syncContainerPostprocessVisibility(state);
}

function destroyContainerPostprocess(state) {
    if (!state) return;
    if (state.postprocessRenderer) {
        try { state.postprocessRenderer.destroy(); } catch (e) { /* ignore */ }
        state.postprocessRenderer = null;
    }
    if (state.postprocessCanvas?.parentElement) {
        try { state.postprocessCanvas.parentElement.removeChild(state.postprocessCanvas); } catch (_) { /* ignore */ }
    }
    state.postprocessCanvas = null;
    if (state.element) state.element.classList.remove("has-container-postprocess");
}

/**
 * @param {object} state
 * @param {string} idOrPath
 * @param {{ uniforms?: object, modulators?: object, enabled?: boolean, index?: number, rebuild?: boolean }} [opts]
 */
async function addContainerPostprocessLayer(state, idOrPath, opts = {}) {
    const pp = ensureContainerPostprocessState(state);
    const pkg = await loadShaderPackage(idOrPath);
    const uniforms = Object.assign(
        {},
        defaultsFromControls(pkg.uniforms),
        opts.uniforms || {},
    );
    const layer = {
        id: nextContainerPostprocessLayerId(state),
        shaderId: pkg.id,
        shaderPath: pkg.fragPath,
        shaderMeta: packageToClientMeta(pkg),
        uniforms,
        modulators: sanitizeModulatorsMap(opts.modulators),
        enabled: opts.enabled !== false,
    };
    const idx = opts.index;
    if (typeof idx === "number" && idx >= 0 && idx < pp.layers.length) {
        pp.layers.splice(idx, 0, layer);
    } else {
        pp.layers.push(layer);
    }
    if (opts.rebuild !== false) {
        await rebuildContainerPostprocessStack(state);
        if (pp.active) startContainerPostprocess(state);
    }
    return layer;
}

async function removeContainerPostprocessLayer(state, id) {
    const pp = ensureContainerPostprocessState(state);
    const before = pp.layers.length;
    pp.layers = pp.layers.filter((l) => l.id !== Number(id));
    if (pp.layers.length !== before) {
        await rebuildContainerPostprocessStack(state);
        if (pp.active && pp.layers.length) startContainerPostprocess(state);
        else if (!pp.layers.length) syncContainerPostprocessVisibility(state);
        return true;
    }
    return false;
}

async function reorderContainerPostprocessLayers(state, orderedIds) {
    const pp = ensureContainerPostprocessState(state);
    const ids = (Array.isArray(orderedIds) ? orderedIds : []).map(Number);
    const byId = new Map(pp.layers.map((l) => [l.id, l]));
    const next = [];
    for (const id of ids) {
        const layer = byId.get(id);
        if (layer) {
            next.push(layer);
            byId.delete(id);
        }
    }
    for (const layer of byId.values()) next.push(layer);
    pp.layers = next;
    await rebuildContainerPostprocessStack(state);
    if (pp.active) startContainerPostprocess(state);
}

async function moveContainerPostprocessLayer(state, id, toIndex) {
    const pp = ensureContainerPostprocessState(state);
    const from = pp.layers.findIndex((l) => l.id === Number(id));
    if (from < 0) return false;
    const [layer] = pp.layers.splice(from, 1);
    const to = Math.max(0, Math.min(pp.layers.length, Number(toIndex) || 0));
    pp.layers.splice(to, 0, layer);
    await rebuildContainerPostprocessStack(state);
    if (pp.active) startContainerPostprocess(state);
    return true;
}

async function setContainerPostprocessLayerShader(state, id, idOrPath, uniformsOverride = null) {
    const layer = findContainerPostprocessLayer(state, id);
    if (!layer) throw new Error("Layer not found");
    const pkg = await loadShaderPackage(idOrPath);
    const uniforms = Object.assign(
        {},
        defaultsFromControls(pkg.uniforms),
        uniformsOverride != null ? uniformsOverride : (layer.uniforms || {}),
    );
    layer.shaderId = pkg.id;
    layer.shaderPath = pkg.fragPath;
    layer.shaderMeta = packageToClientMeta(pkg);
    layer.uniforms = uniforms;
    layer.modulators = {};
    delete layer._inlineSource;
    await rebuildContainerPostprocessStack(state);
    if (state.postprocess?.active) startContainerPostprocess(state);
    return layer;
}

function updateContainerPostprocessLayerUniforms(state, id, uniforms) {
    const layer = findContainerPostprocessLayer(state, id);
    if (!layer) return;
    layer.uniforms = Object.assign({}, layer.uniforms || {}, uniforms || {});
    if (state.postprocessRenderer) {
        state.postprocessRenderer.setLayerUniforms(String(layer.id), layer.uniforms);
    }
}

function updateContainerPostprocessLayerModulators(state, id, modulators) {
    const layer = findContainerPostprocessLayer(state, id);
    if (!layer) return;
    if (!layer.modulators || typeof layer.modulators !== "object") {
        layer.modulators = {};
    }
    if (modulators == null) {
        layer.modulators = {};
    } else if (typeof modulators === "object") {
        for (const k of Object.keys(modulators)) {
            const v = modulators[k];
            if (v == null) {
                delete layer.modulators[k];
                continue;
            }
            if (typeof v !== "object") continue;
            const src = String(v.source != null ? v.source : (layer.modulators[k]?.source || "")).toLowerCase();
            if (v.source != null && (src === "static" || src === "")) {
                delete layer.modulators[k];
                continue;
            }
            const merged = Object.assign({}, layer.modulators[k] || {}, v);
            if (v.clock === "stack" || v.clock === null || v.clock === "") {
                delete merged.clock;
            }
            const s = sanitizeModulatorSpec(merged);
            if (s) layer.modulators[k] = s;
            else delete layer.modulators[k];
        }
    }
    layer.modulators = sanitizeModulatorsMap(layer.modulators);
    if (state.postprocessRenderer?.setLayerModulators) {
        state.postprocessRenderer.setLayerModulators(String(layer.id), layer.modulators);
    }
    if (state.postprocessRenderer?.setLayerBoundsByName) {
        state.postprocessRenderer.setLayerBoundsByName(
            String(layer.id),
            boundsFromShaderMeta(layer.shaderMeta),
        );
    }
}

function setContainerPostprocessLayerEnabled(state, id, enabled) {
    const layer = findContainerPostprocessLayer(state, id);
    if (!layer) return;
    layer.enabled = !!enabled;
    if (state.postprocessRenderer) {
        state.postprocessRenderer.setLayerEnabled(String(layer.id), layer.enabled);
    }
    syncContainerPostprocessVisibility(state);
}

/** Replace entire container stack from a serializable description. */
async function setContainerPostprocessStack(state, layersSpec, { active } = {}) {
    const pp = ensureContainerPostprocessState(state);
    const list = Array.isArray(layersSpec) ? layersSpec : [];
    const live = pp.layers || [];
    if (live.length === list.length && live.length > 0
        && shaderSeqKey(live) === shaderSeqKey(list)
        && state.postprocessRenderer) {
        for (let i = 0; i < live.length; i++) {
            const entry = list[i];
            live[i].uniforms = Object.assign({}, live[i].uniforms || {}, sanitizeUniformMap(entry.uniforms || {}));
            live[i].modulators = sanitizeModulatorsMap(entry.modulators);
            live[i].enabled = entry.enabled !== false;
        }
        if (active != null) pp.active = !!active;
        await rebuildContainerPostprocessStack(state);
        if (pp.active) startContainerPostprocess(state);
        else stopContainerPostprocess(state);
        return;
    }
    pp.layers = [];
    for (const entry of list) {
        await addContainerPostprocessLayer(state, entry.shaderId || entry.shaderPath || "lcd", {
            uniforms: entry.uniforms,
            modulators: entry.modulators,
            enabled: entry.enabled !== false,
            rebuild: false,
        });
        if (entry.id != null) {
            const last = pp.layers[pp.layers.length - 1];
            if (last) last.id = Number(entry.id);
            pp.nextLayerId = Math.max(pp.nextLayerId, Number(entry.id) + 1);
        }
    }
    if (active != null) pp.active = !!active;
    await rebuildContainerPostprocessStack(state);
    if (pp.active) startContainerPostprocess(state);
    else stopContainerPostprocess(state);
}

// Shader package helpers
// Layout: shaders/<id>/shader.frag + shaders/<id>/controls.json
// index.json lists package ids: ["default", "grain", "lcd"]

const shaderPackageCache = new Map();

/** Normalize package id or path → package id (e.g. "lcd"). */
function resolveShaderId(idOrPath) {
    if (!idOrPath) return null;
    let s = String(idOrPath).trim();
    // strip leading ./shaders/ or shaders/
    s = s.replace(/^\.\/shaders\//, '').replace(/^shaders\//, '');
    // strip trailing entry filenames
    s = s.replace(/\/(shader\.frag|controls\.json)$/i, '');
    // legacy flat files: grain.frag → grain
    s = s.replace(/\.frag$/i, '');
    // drop trailing slash
    s = s.replace(/\/$/, '');
    if (!s || s === 'ferrofluid') return 'audio-ferrofluid';
    return s || null;
}

function shaderPackageBase(id) {
    return `./shaders/${id}`;
}

async function fetchJson(path) {
    const res = await fetch(path);
    if (!res.ok) throw new Error(`Failed to load ${path}: ${res.statusText}`);
    return await res.json();
}

async function loadShaderSource(path) {
    const res = await fetch(path);
    if (!res.ok) throw new Error('Failed to load shader: ' + res.statusText);
    return await res.text();
}

const shaderMetaCache = new Map();

function reportLoad(pct, label) {
    const api = window.__musicViewLoad;
    if (api && typeof api.set === 'function') api.set(pct, label);
}

function packageFromControls(id, controls) {
    const entry = (controls && controls.entry) || 'shader.frag';
    const base = shaderPackageBase(id);
    return {
        id: (controls && controls.id) || id,
        name: (controls && controls.name) || id,
        description: (controls && controls.description) || '',
        roles: Array.isArray(controls && controls.roles) ? controls.roles : ['container', 'postprocess'],
        entry,
        fragPath: `${base}/${entry}`,
        packagePath: base,
        uniforms: Array.isArray(controls && controls.uniforms) ? controls.uniforms : [],
        ui: controls && controls.ui && typeof controls.ui === 'object' ? controls.ui : undefined,
        source: null,
    };
}

/** Catalog meta only — does not fetch the fragment source. */
async function loadShaderControls(idOrPath) {
    const id = resolveShaderId(idOrPath);
    if (!id) throw new Error('Invalid shader package id');
    if (shaderPackageCache.has(id)) return shaderPackageCache.get(id);
    if (shaderMetaCache.has(id)) return shaderMetaCache.get(id);

    const base = shaderPackageBase(id);
    let controls;
    try {
        controls = await fetchJson(`${base}/controls.json`);
    } catch (e) {
        controls = {
            id,
            name: id,
            description: '',
            roles: ['container', 'postprocess'],
            entry: 'shader.frag',
            uniforms: [],
        };
    }
    const pkg = packageFromControls(id, controls);
    shaderMetaCache.set(id, pkg);
    return pkg;
}

/**
 * Load a shader package (controls.json + frag source).
 * @param {string} idOrPath - package id ("lcd") or path ("./shaders/lcd")
 * @returns {Promise<object>} package meta + source
 */
async function loadShaderPackage(idOrPath) {
    const id = resolveShaderId(idOrPath);
    if (!id) throw new Error('Invalid shader package id');

    const cached = shaderPackageCache.get(id);
    if (cached && cached.source) return cached;

    const meta = await loadShaderControls(id);
    const source = await loadShaderSource(meta.fragPath);
    const pkg = Object.assign({}, meta, { source });
    shaderPackageCache.set(id, pkg);
    return pkg;
}

/** Build default uniform values object from controls.json uniform defs. */
function defaultsFromControls(uniformsDef) {
    const out = {};
    if (!Array.isArray(uniformsDef)) return out;
    for (const u of uniformsDef) {
        if (!u || !u.name) continue;
        if (u.default !== undefined) {
            out[u.name] = cloneUniformValue(u.default);
        } else if (u.type === 'bool') {
            out[u.name] = false;
        } else if (u.type === 'vec2') {
            out[u.name] = [0, 0];
        } else if (u.type === 'vec3' || u.type === 'color') {
            out[u.name] = [1, 1, 1];
        } else if (u.type === 'vec4') {
            out[u.name] = [1, 1, 1, 1];
        } else {
            out[u.name] = 0;
        }
    }
    return out;
}

function cloneUniformValue(v) {
    if (Array.isArray(v)) return v.slice();
    return v;
}

/**
 * Build name → {min,max} clamp map from package/client meta uniforms list.
 * Used by param-mod resolve (Phase 1+).
 * @param {{ uniforms?: Array<{name?:string, min?:number, max?:number}> }|null} meta
 * @returns {Record<string, {min?:number, max?:number}>}
 */
function boundsFromShaderMeta(meta) {
    const out = {};
    const list = meta && Array.isArray(meta.uniforms) ? meta.uniforms : [];
    for (const u of list) {
        if (!u || !u.name) continue;
        if (u.min == null && u.max == null) continue;
        const b = {};
        if (u.min != null && Number.isFinite(Number(u.min))) b.min = Number(u.min);
        if (u.max != null && Number.isFinite(Number(u.max))) b.max = Number(u.max);
        if (b.min != null || b.max != null) out[u.name] = b;
    }
    return out;
}

/**
 * Clone modulator map (shallow clone each spec). Drops non-object entries.
 * @param {object|null|undefined} mods
 * @returns {Record<string, object>}
 */
function cloneModulators(mods) {
    const out = {};
    if (!mods || typeof mods !== 'object') return out;
    for (const k of Object.keys(mods)) {
        const m = mods[k];
        if (m && typeof m === 'object') out[k] = Object.assign({}, m);
    }
    return out;
}

/** Active (non-static) modulator sources (v1 + Phase 5 tri/sq). */
const MOD_ACTIVE_SOURCES = {
    time: true,
    sine: true,
    triangle: true,
    square: true,
    noise: true,
};
let _modUnknownSourceWarned = false;

/**
 * Sanitize one modulator spec for load/export.
 * Unknown / static sources → null (caller drops key).
 * @param {object|null|undefined} mod
 * @returns {object|null}
 */
function sanitizeModulatorSpec(mod) {
    if (!mod || typeof mod !== 'object') return null;
    const source = String(mod.source || '').toLowerCase();
    if (!MOD_ACTIVE_SOURCES[source]) {
        if (source && source !== 'static' && !_modUnknownSourceWarned) {
            console.warn('Unknown modulator source ignored:', source);
            _modUnknownSourceWarned = true;
        }
        return null;
    }
    const out = {
        source,
        offset: Number.isFinite(Number(mod.offset)) ? Number(mod.offset) : 0,
        amp: Number.isFinite(Number(mod.amp)) ? Number(mod.amp) : 0,
        rate: Number.isFinite(Number(mod.rate)) ? Number(mod.rate) : 0,
    };
    if (mod.phase != null && Number.isFinite(Number(mod.phase))) {
        out.phase = Number(mod.phase);
    }
    if (mod.seed != null && Number.isFinite(Number(mod.seed))) {
        out.seed = Number(mod.seed);
    }
    if (mod.clamp === false) out.clamp = false;
    // clock: omit stack (default); keep wall | song
    const clock = typeof sanitizeClock === 'function'
        ? sanitizeClock(mod.clock)
        : (mod.clock === 'wall' || mod.clock === 'song' ? mod.clock : undefined);
    if (clock) out.clock = clock;
    return out;
}

/**
 * Song playback position in seconds for modulator clock: 'song'.
 * Uses the song-progress container when music has pushed live time.
 * @returns {number}
 */
function getSongModClock() {
    try {
        const bar = scene.containers.find((c) => c.role === 'song-progress');
        const t = bar && bar.playbackCurrentTime != null
            ? Number(bar.playbackCurrentTime)
            : 0;
        return Number.isFinite(t) ? t : 0;
    } catch (e) {
        return 0;
    }
}

/**
 * Keep only active, well-formed modulator entries (for presets / load).
 * @param {object|null|undefined} mods
 * @returns {Record<string, object>}
 */
function sanitizeModulatorsMap(mods) {
    const out = {};
    if (!mods || typeof mods !== 'object' || Array.isArray(mods)) return out;
    for (const k of Object.keys(mods)) {
        const s = sanitizeModulatorSpec(mods[k]);
        if (s) out[k] = s;
    }
    return out;
}

/**
 * Export modulators for presets: only active sources (omit empty map via caller).
 * @param {object|null|undefined} mods
 * @returns {Record<string, object>}
 */
function exportModulatorsMap(mods) {
    return sanitizeModulatorsMap(mods);
}

/**
 * Ensure uniforms stay numbers/arrays only (never modulator objects).
 * @param {object|null|undefined} uniforms
 * @returns {Record<string, number|number[]>}
 */
function sanitizeUniformMap(uniforms) {
    const out = {};
    if (!uniforms || typeof uniforms !== 'object' || Array.isArray(uniforms)) return out;
    for (const k of Object.keys(uniforms)) {
        const v = uniforms[k];
        if (typeof v === 'number' && Number.isFinite(v)) {
            out[k] = v;
        } else if (typeof v === 'boolean') {
            out[k] = v ? 1 : 0;
        } else if (Array.isArray(v)) {
            const nums = v.map(Number);
            if (nums.length && nums.every((n) => Number.isFinite(n))) out[k] = nums;
        }
        // skip objects / strings
    }
    return out;
}

/**
 * Map one controls.json uniform def to client meta (explicit allow-list).
 * Passes group / advanced / schema v1.1 widget fields; never copies unknown keys.
 */
function uniformDefToClientMeta(u) {
    if (!u || !u.name) return null;
    const out = {
        name: u.name,
        label: u.label || u.name,
        type: u.type || 'float',
        default: u.default,
        min: u.min,
        max: u.max,
        step: u.step,
    };
    // Grouping / Basic|All (already used by controls.js)
    if (u.group != null && String(u.group).trim() !== '') out.group = String(u.group);
    if (u.advanced != null) out.advanced = !!u.advanced;
    // Schema v1.1 (widget toolkit — ignored until Phase 2)
    if (u.widget != null && u.widget !== '') out.widget = u.widget;
    if (Array.isArray(u.options) && u.options.length) out.options = u.options;
    if (u.unit != null && u.unit !== '') out.unit = u.unit;
    if (u.format != null && u.format !== '') out.format = u.format;
    if (u.decimals != null && Number.isFinite(Number(u.decimals))) out.decimals = Number(u.decimals);
    if (u.hint != null && u.hint !== '') out.hint = u.hint;
    if (u.description != null && u.description !== '') out.description = u.description;
    if (u.pairWith != null && u.pairWith !== '') out.pairWith = u.pairWith;
    if (u.order != null && Number.isFinite(Number(u.order))) out.order = Number(u.order);
    if (u.importance != null && u.importance !== '') out.importance = u.importance;
    return out;
}

/** Serializable control defs for the control panel (no frag source). */
function packageToClientMeta(pkg) {
    if (!pkg) return null;
    const meta = {
        id: pkg.id,
        name: pkg.name,
        description: pkg.description,
        roles: pkg.roles,
        entry: pkg.entry,
        fragPath: pkg.fragPath,
        packagePath: pkg.packagePath,
        uniforms: (pkg.uniforms || [])
            .map(uniformDefToClientMeta)
            .filter(Boolean),
    };
    // Optional package-level UI hints (controls chrome only; runtime ignores)
    if (pkg.ui && typeof pkg.ui === 'object') meta.ui = pkg.ui;
    return meta;
}

/**
 * List all shader packages from index.json, with controls metadata.
 * @returns {Promise<object[]>}
 */
async function listShaders(opts = {}) {
    const res = await fetch('./shaders/index.json');
    if (!res.ok) throw new Error('Failed to list shaders');
    const index = await res.json();
    const ids = Array.isArray(index)
        ? index.map((item) => (typeof item === 'string' ? item : item.id)).filter(Boolean)
        : [];

    const out = new Array(ids.length);
    let completed = 0;
    let cursor = 0;
    const workers = Math.min(12, Math.max(1, ids.length));

    async function worker() {
        while (cursor < ids.length) {
            const i = cursor++;
            const id = ids[i];
            try {
                const pkg = await loadShaderControls(id);
                out[i] = packageToClientMeta(pkg);
            } catch (e) {
                console.warn('Skipping shader package', id, e);
                out[i] = null;
            }
            completed += 1;
            if (typeof opts.onProgress === 'function') {
                opts.onProgress(completed, ids.length, id);
            }
        }
    }

    await Promise.all(Array.from({ length: workers }, () => worker()));
    return out.filter(Boolean);
}

async function applyShaderPackageToState(state, idOrPath, uniformsOverride = null) {
    const pkg = await loadShaderPackage(idOrPath);
    const defaults = defaultsFromControls(pkg.uniforms);
    const uniforms = Object.assign({}, defaults, uniformsOverride || state.shaderUniforms || {});
    const sameLive = !!(
        state.shaderRenderer
        && state.shader
        && state.shaderId
        && state.shaderId === pkg.id
    );
    state.shaderId = pkg.id;
    state.shaderPath = pkg.fragPath;
    state.shaderMeta = packageToClientMeta(pkg);
    if (sameLive) {
        // Morph / snapshot commit re-applies the same package. Replacing the
        // inner canvas clears the drawing buffer and flashes white for a frame.
        state.shaderUniforms = Object.assign({}, uniforms || {});
        if (typeof state.shaderRenderer.setUniforms === "function") {
            state.shaderRenderer.setUniforms(state.shaderUniforms);
        }
        if (typeof state.shaderRenderer.setBoundsByName === "function") {
            state.shaderRenderer.setBoundsByName(boundsFromShaderMeta(state.shaderMeta));
        }
        if (typeof state.shaderRenderer.render === "function") {
            try { state.shaderRenderer.render(); } catch (_) { /* ignore */ }
        }
        return pkg;
    }
    // Package change clears modulators (Phase 0 lock)
    state.shaderModulators = {};
    applyShaderToState(state, pkg.source, uniforms);
    return pkg;
}

/**
 * Replace the container's inner <canvas> so we can switch context type.
 * HTMLCanvasElement only allows one context API (2d vs webgl) per element.
 */
function replaceInnerCanvas(state) {
    if (!state || !state.element) return null;

    const old = state.innerCanvas;
    const next = document.createElement("canvas");
    const w = (old && old.width) || state.element.clientWidth || 1;
    const h = (old && old.height) || state.element.clientHeight || 1;
    next.width = w;
    next.height = h;
    next.style.position = "absolute";
    next.style.left = "0";
    next.style.top = "0";
    next.style.width = "100%";
    next.style.height = "100%";
    next.style.display = "block";
    next.style.zIndex = "0";

    if (old && old.parentNode) {
        old.replaceWith(next);
    } else {
        state.element.insertBefore(next, state.element.firstChild);
    }
    state.innerCanvas = next;
    state.innerCtx = null;
    return next;
}

/** Canvas for WebGL: reuse if unbound; replace if 2D was already bound. */
function ensureCanvasForWebGL(state) {
    if (!state.innerCanvas) return replaceInnerCanvas(state);
    // state.innerCtx is only set when we successfully got a 2d context.
    if (state.innerCtx) return replaceInnerCanvas(state);
    return state.innerCanvas;
}

function applyShaderToState(state, fragSource, uniforms = {}) {
    if (!state) return;
    try {
        if (state.shaderRenderer) {
            try { state.shaderRenderer.destroy(); } catch (e) {}
            state.shaderRenderer = null;
        }

        // Fresh canvas when re-applying after a previous GL session, or when
        // leaving 2D. Reusing a live WebGL canvas can fail after destroy().
        let canvas;
        if (state.innerCtx || state.shader) {
            canvas = replaceInnerCanvas(state);
        } else {
            canvas = ensureCanvasForWebGL(state);
        }

        state.shader = fragSource;
        state.shaderUniforms = Object.assign({}, uniforms || {});
        if (!state.shaderModulators || typeof state.shaderModulators !== 'object') {
            state.shaderModulators = {};
        }
        if (canvas.width === 0 || canvas.height === 0) {
            canvas.width = canvas.clientWidth || state.element.clientWidth || 1;
            canvas.height = canvas.clientHeight || state.element.clientHeight || 1;
        }
        state.shaderRenderer = createShaderRenderer(canvas, fragSource, state.shaderUniforms, {
            modulators: state.shaderModulators,
            boundsByName: boundsFromShaderMeta(state.shaderMeta),
        });
        state.innerCtx = null;
        state.shaderRenderer.start();
    } catch (e) {
        console.warn('Failed to apply shader, falling back to 2D:', e);
        try {
            if (state.shaderRenderer) {
                try { state.shaderRenderer.destroy(); } catch (_) {}
                state.shaderRenderer = null;
            }
            replaceInnerCanvas(state);
            state.innerCtx = state.innerCanvas.getContext('2d');
        } catch (e2) {
            console.warn('Failed to fall back to 2D:', e2);
        }
        state.shader = null;
        state.shaderRenderer = null;
        if (state.image) drawContainerImage(state);
    }
}

function clearShader(state) {
    if (!state) return;
    // Do not steal canvas from ARTEF4KT embed
    if (state.role === 'artef4kt' && state.artef4ktHost) return;
    if (state.shaderRenderer) {
        try { state.shaderRenderer.destroy(); } catch (e) {}
        state.shaderRenderer = null;
    }
    state.shader = null;
    state.shaderId = null;
    state.shaderPath = null;
    state.shaderMeta = null;
    state.shaderUniforms = {};
    state.shaderModulators = {};
    // WebGL canvas cannot become 2D — replace first.
    replaceInnerCanvas(state);
    state.innerCtx = state.innerCanvas.getContext('2d');
    if (state.image) drawContainerImage(state);
}

function updateContainerUniforms(state, uniforms) {
    if (!state) return;
    state.shaderUniforms = Object.assign({}, state.shaderUniforms || {}, uniforms || {});
    if (state.shaderRenderer) {
        state.shaderRenderer.setUniforms(state.shaderUniforms);
    }
}

/**
 * Partial-merge container shader modulators (Phase 1 runtime; IPC in Phase 2).
 * @param {object} state container state
 * @param {Record<string, object|null>|null} modulators
 */
function updateContainerModulators(state, modulators) {
    if (!state) return;
    if (!state.shaderModulators || typeof state.shaderModulators !== 'object') {
        state.shaderModulators = {};
    }
    if (modulators == null) {
        state.shaderModulators = {};
    } else if (typeof modulators === 'object') {
        for (const k of Object.keys(modulators)) {
            const v = modulators[k];
            if (v == null) {
                delete state.shaderModulators[k];
                continue;
            }
            if (typeof v !== 'object') continue;
            const src = String(v.source != null ? v.source : (state.shaderModulators[k]?.source || '')).toLowerCase();
            if (v.source != null && (src === 'static' || src === '')) {
                delete state.shaderModulators[k];
                continue;
            }
            const merged = Object.assign({}, state.shaderModulators[k] || {}, v);
            if (v.clock === 'stack' || v.clock === null || v.clock === '') {
                delete merged.clock;
            }
            const s = sanitizeModulatorSpec(merged);
            if (s) state.shaderModulators[k] = s;
            else delete state.shaderModulators[k];
        }
    }
    state.shaderModulators = sanitizeModulatorsMap(state.shaderModulators);
    if (state.shaderRenderer) {
        if (typeof state.shaderRenderer.setModulators === 'function') {
            state.shaderRenderer.setModulators(state.shaderModulators);
        }
        if (typeof state.shaderRenderer.setBoundsByName === 'function') {
            state.shaderRenderer.setBoundsByName(boundsFromShaderMeta(state.shaderMeta));
        }
    }
}

// ── Scene bridge (display ↔ control window) ─────────────────────────────

function findContainerById(id) {
    return scene.containers.find((c) => c.id === Number(id)) || null;
}

function findContainerIdByElement(el) {
    if (!el) return null;
    const found = scene.containers.find((c) => c.element === el);
    return found ? found.id : null;
}

/**
 * UI selection only — never written into presets.
 * @param {number|null} id
 * @param {{ publish?: boolean }} [opts]
 */
function setSelectedContainerId(id, opts = {}) {
    const publish = opts.publish !== false;
    const next = id == null || id === '' ? null : Number(id);
    if (next != null && !Number.isFinite(next)) return;
    if (next != null && !findContainerById(next)) return;
    if (scene.selectedContainerId === next) {
        updateSelectionRings();
        return;
    }
    scene.selectedContainerId = next;
    updateSelectionRings();
    if (publish) publishSceneState();
}

function updateSelectionRings() {
    const selected = scene.selectedContainerId;
    for (const c of scene.containers) {
        if (!c?.element) continue;
        c.element.classList.toggle('is-selected', c.id === selected);
    }
}

function getContainerSnapshot(state) {
    if (!state || !state.element) return null;
    // Prefer stored logical layout (set on create / apply). Falling back to
    // offset* is only for legacy states; with border-box it matches style size.
    const d = state.layoutDesign;
    const width = d && d.width != null ? d.width
        : (state.width != null ? state.width : state.element.offsetWidth);
    const height = d && d.height != null ? d.height
        : (state.height != null ? state.height : state.element.offsetHeight);
    const left = d && d.left != null ? d.left
        : (state.left != null ? state.left : state.element.offsetLeft);
    const top = d && d.top != null ? d.top
        : (state.top != null ? state.top : state.element.offsetTop);
    return {
        id: state.id,
        snapshotId: state.snapshotId || null,
        relative: state.relative && typeof state.relative === "object" ? state.relative : null,
        role: state.role || null,
        visible: state.visible !== false,
        panelKind: state.panelKind || null,
        text: state.text || '',
        label: state.label || '',
        labelEnabled: state.labelEnabled !== false,
        labelCorner: normalizeLabelCorner(state.labelCorner),
        left,
        top,
        width,
        height,
        wander: !!state.wander,
        wanderAmplitude: state.wanderAmplitude,
        wanderFrequency: state.wanderFrequency,
        layer: state.layer,
        distancing: state.distancing,
        connect: !!state.connect,
        anchorDistance: state.anchorDistance === false ? null : state.anchorDistance,
        attachToId: findContainerIdByElement(state.attachTo),
        hasShader: !!state.shaderRenderer,
        shaderId: state.shaderId || null,
        shaderPath: state.shaderPath || null,
        shaderMeta: state.shaderMeta || null,
        shaderUniforms: Object.assign({}, state.shaderUniforms || {}),
        shaderModulators: cloneModulators(state.shaderModulators),
        imageMode: state.imageMode || 'scale',
        contentFade: normalizeContentFadeSec(state.contentFade),
        textGlitch: normalizeTextGlitchSec(state.textGlitch),
        hasImage: !!state.image,
        progressTimeMode: isProgressRole(state.role)
            ? normalizeProgressTimeMode(state.progressTimeMode || 'ends')
            : null,
        /** External embed (ARTEF4KT) — serializable only */
        embed: state.embed && typeof state.embed === 'object'
            ? {
                engine: state.embed.engine || 'artef4kt',
                settingsId: state.embed.settingsId || 'default',
                quality: state.embed.quality || 'auto',
                // Live engine knobs for Controls (may be large; serializable)
                settings: state.embed.settings && typeof state.embed.settings === 'object'
                    ? state.embed.settings
                    : null,
            }
            : (state.role === 'artef4kt'
                ? { engine: 'artef4kt', settingsId: 'default', quality: 'auto', settings: null }
                : null),
        audioInput: containerAudioInput(state),
        /** Per-container FX stack (mirrors global postprocess shape) */
        postprocess: snapshotContainerPostprocess(state),
        style: {
            border: Object.assign({}, state.style?.border || {}),
            connect: Object.assign({}, state.style?.connect || {}),
            label: defaultLabelStyle(state.style?.label || {}),
            text: defaultTextStyle(state.style?.text || state.style?.label || {}),
            textAlign: normalizeTextAlign(state.style?.textAlign),
            padding: normalizeBoxPadding(state.style?.padding),
        },
    };
}

function getSceneState() {
    const layers = snapshotPostprocessLayers();
    const first = layers[0] || null;
    // Drop stale selection if the container was removed
    if (scene.selectedContainerId != null && !findContainerById(scene.selectedContainerId)) {
        scene.selectedContainerId = null;
        updateSelectionRings();
    }
    return {
        containers: scene.containers.map(getContainerSnapshot).filter(Boolean),
        postprocess: {
            active: !!(postprocessState && postprocessState.active && postprocessState.renderer),
            // Stack (primary)
            layers,
            // Legacy single-layer fields (first layer) for older UI paths
            shaderId: first?.shaderId || null,
            shaderPath: first?.shaderPath || null,
            shaderMeta: first?.shaderMeta || null,
            uniforms: first ? Object.assign({}, first.uniforms || {}) : {},
        },
        /** Blue bottom strip (color, height, float-area inclusion) */
        bottomPanel: getBottomPanelSnapshot(),
        /** Stage fill behind panels (solid white default; shader / image / video + FX) */
        background: getBackgroundSnapshot(),
        /** Name of last loaded/saved preset (not music-related) */
        activePreset: scene.activePreset || null,
        /** UI-only selection for controls Object pane (not saved in presets) */
        selectedContainerId: scene.selectedContainerId,
        shaders: null, // filled async when requested
    };
}

// ── Scene presets (visual layout / postprocess / styles — never music) ──

const PRESET_VERSION = 1;

/**
 * Build a serializable visual preset from the live scene.
 * Excludes song content, covers, lyrics text, and playback progress.
 */
function exportScenePreset(displayName = "Preset") {
    const containers = scene.containers.map((state) => {
        const snap = getContainerSnapshot(state);
        if (!snap) return null;
        const entry = {
            snapshotId: snap.snapshotId || mintSnapshotId(),
            relative: snap.relative && typeof snap.relative === "object" ? snap.relative : null,
            role: snap.role,
            visible: snap.visible !== false,
            panelKind: snap.panelKind || null,
            text: snap.role && String(snap.role).startsWith("song-") ? undefined : (snap.text || ""),
            label: snap.label,
            labelEnabled: snap.labelEnabled !== false,
            labelCorner: snap.labelCorner,
            left: snap.left,
            top: snap.top,
            width: snap.width,
            height: snap.height,
            wander: snap.wander,
            wanderAmplitude: snap.wanderAmplitude,
            wanderFrequency: snap.wanderFrequency,
            layer: snap.layer,
            distancing: snap.distancing,
            connect: snap.connect,
            anchorDistance: snap.anchorDistance,
            // Prefer role-based attach when possible
            attachToRole: (() => {
                if (!snap.attachToId) return null;
                const other = findContainerById(snap.attachToId);
                return other?.role || null;
            })(),
            attachToId: snap.attachToId,
            shaderId: snap.shaderId,
            shaderUniforms: sanitizeUniformMap(snap.shaderUniforms),
            imageMode: snap.imageMode,
            contentFade: snap.contentFade,
            textGlitch: snap.textGlitch,
            progressTimeMode: snap.progressTimeMode,
            style: {
                border: Object.assign({}, snap.style?.border || {}),
                connect: Object.assign({}, snap.style?.connect || {}),
                label: defaultLabelStyle(snap.style?.label || {}),
                text: defaultTextStyle(snap.style?.text || snap.style?.label || {}),
                textAlign: normalizeTextAlign(snap.style?.textAlign),
                padding: normalizeBoxPadding(snap.style?.padding),
            },
        };
        if (snap.embed && typeof snap.embed === "object") {
            entry.embed = {
                engine: snap.embed.engine || "artef4kt",
                settingsId: snap.embed.settingsId || "default",
                quality: snap.embed.quality || "auto",
            };
            if (snap.embed.settings && typeof snap.embed.settings === "object") {
                entry.embed.settings = snap.embed.settings;
            }
        }
        if (snap.audioInput && typeof snap.audioInput === "object") {
            entry.audioInput = snap.audioInput;
        }
        const cMods = exportModulatorsMap(snap.shaderModulators);
        if (Object.keys(cMods).length) entry.shaderModulators = cMods;
        // Per-container postprocess (omit empty stacks to keep presets lean)
        const cpp = snap.postprocess;
        if (cpp && Array.isArray(cpp.layers) && cpp.layers.length) {
            entry.postprocess = {
                active: cpp.active !== false,
                layers: cpp.layers.map((l) => {
                    const le = {
                        shaderId: l.shaderId,
                        enabled: l.enabled !== false,
                        uniforms: sanitizeUniformMap(l.uniforms),
                    };
                    const mods = exportModulatorsMap(l.modulators);
                    if (Object.keys(mods).length) le.modulators = mods;
                    return le;
                }),
            };
        }
        return entry;
    }).filter(Boolean);

    // Write minted snapshotIds back to live state in export order
    const live = scene.containers.filter(Boolean);
    for (let i = 0; i < containers.length && i < live.length; i++) {
        if (containers[i].snapshotId && !live[i].snapshotId) {
            live[i].snapshotId = containers[i].snapshotId;
        } else if (containers[i].snapshotId) {
            live[i].snapshotId = containers[i].snapshotId;
        }
        if (containers[i].snapshotId == null && live[i]) {
            live[i].snapshotId = mintSnapshotId();
            containers[i].snapshotId = live[i].snapshotId;
        }
    }

    const layers = snapshotPostprocessLayers().map((l) => {
        const entry = {
            shaderId: l.shaderId,
            enabled: l.enabled !== false,
            uniforms: sanitizeUniformMap(l.uniforms),
        };
        const mods = exportModulatorsMap(l.modulators);
        if (Object.keys(mods).length) entry.modulators = mods;
        return entry;
    });

    return {
        version: PRESET_VERSION,
        name: displayName || "Preset",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        scene: {
            containers,
            postprocess: {
                active: !!(postprocessState && postprocessState.active),
                layers,
            },
            bottomPanel: getBottomPanelSnapshot(),
            background: exportBackgroundForPreset(),
            layoutSpace: (typeof globalThis !== "undefined"
                && globalThis.musicViewLayoutSpace
                && globalThis.musicViewLayoutSpace.LAYOUT_SPACE)
                || "design-1080x1920",
        },
    };
}

function rememberShellLayout() {
    const { width, height } = getFloatAreaSize();
    if (width > 1 && height > 1) lastShellLayout = { width, height };
}

/**
 * Project every panel from the 1080×1920 design frame onto the live stage.
 * Does not re-solve relative hints (that would drift). Safe mid-playback / show.
 */
function reflowSceneToShell() {
    applyBottomPanelLayout();
    const next = getFloatAreaSize();
    if (next.width < 2 || next.height < 2) return;
    const same = lastShellLayout.width > 1
        && Math.abs(next.width - lastShellLayout.width) < 0.5
        && Math.abs(next.height - lastShellLayout.height) < 0.5;
    if (!same) {
        for (const c of scene.containers) {
            if (!c || !c.element) continue;
            if (!c.layoutDesign) syncDesignFromLive(c);
            applyLiveFromDesign(c);
            applyContainerBoxStyle(c);
        }
    }
    lastShellLayout = { width: next.width, height: next.height };
    if (typeof window.__musicViewResizeCanvases === "function") {
        window.__musicViewResizeCanvases();
    } else if (scene.redraw) {
        scene.redraw();
    }
}

function scheduleShellReflow() {
    if (shellReflowRaf) return;
    shellReflowRaf = requestAnimationFrame(() => {
        shellReflowRaf = 0;
        reflowSceneToShell();
    });
}

function installShellResizeWatch() {
    const shell = getAppShell();
    if (shell && typeof ResizeObserver !== "undefined") {
        let lw = 0;
        let lh = 0;
        const ro = new ResizeObserver(() => {
            const w = shell.clientWidth;
            const h = shell.clientHeight;
            if (w === lw && h === lh) return;
            lw = w;
            lh = h;
            scheduleShellReflow();
        });
        ro.observe(shell);
        return;
    }
    window.addEventListener("resize", () => scheduleShellReflow());
}

function findContainerByRole(role) {
    if (!role) return null;
    return scene.containers.find((c) => c.role === role) || null;
}

/**
 * Resolve absolute geometry for a preset container entry.
 * Uses explicit left/top/width/height when numeric; otherwise relative layout hints.
 */
function resolvePresetGeometry(entry, topPanel, areaOverride) {
    // Prefer float-area size so relative layout respects includeInFloatArea
    const area = areaOverride || getFloatAreaSize();
    const panelW = area.width || topPanel?.clientWidth || 400;
    const panelH = area.height || topPanel?.clientHeight || 600;
    const rel = entry.relative || {};

    let width = entry.width != null && Number.isFinite(Number(entry.width))
        ? Math.round(Number(entry.width))
        : null;
    let height = entry.height != null && Number.isFinite(Number(entry.height))
        ? Math.round(Number(entry.height))
        : null;
    let left = entry.left != null && Number.isFinite(Number(entry.left))
        ? Math.round(Number(entry.left))
        : null;
    let top = entry.top != null && Number.isFinite(Number(entry.top))
        ? Math.round(Number(entry.top))
        : null;

    if (width == null && rel.widthOfMin != null) {
        width = Math.round(Math.min(panelW, panelH) * Number(rel.widthOfMin));
    }
    if (width == null && rel.widthOfPanel != null) {
        width = Math.round(panelW * Number(rel.widthOfPanel));
        if (rel.maxWidth != null) width = Math.min(width, Number(rel.maxWidth));
    }
    if (height == null && width != null && (rel.square || entry.role === "song-cover")) {
        height = width;
    }

    if (left == null && rel.centerX && width != null) {
        left = Math.round((panelW - width) / 2);
    }
    if (top == null && rel.centerYOffset != null && height != null) {
        top = Math.round((panelH - height) / 2 + panelH * Number(rel.centerYOffset));
        top = Math.max(16, top);
    }
    if (top == null && rel.belowRole && height != null) {
        const anchor = findContainerByRole(rel.belowRole);
        if (anchor) {
            const useDesign = !!areaOverride && anchor.layoutDesign;
            const aTop = useDesign ? anchor.layoutDesign.top
                : (anchor.top != null ? anchor.top : 0);
            const aH = useDesign ? anchor.layoutDesign.height
                : (anchor.height != null ? anchor.height : 0);
            top = aTop + aH + (Number(rel.gap) || 14);
        }
    }
    if (top == null && rel.bottomInset != null && height != null) {
        top = Math.max(12, panelH - height - Number(rel.bottomInset));
    }
    if (left == null && width != null) {
        left = Math.round((panelW - width) / 2);
    }

    return { left, top, width, height };
}

/**
 * Relative hints only fill missing fields. A performance snapshot's stored
 * design pixels are the saved look — do not re-solve them into 1080 squares.
 */
function snapshotEntryForApply(entry) {
    if (!entry || !entry.relative || typeof entry.relative !== "object") return entry;
    const complete = [entry.left, entry.top, entry.width, entry.height]
        .every((v) => v != null && Number.isFinite(Number(v)));
    if (complete) return entry;
    const rel = entry.relative;
    const out = Object.assign({}, entry);
    if (out.width == null && (rel.widthOfMin != null || rel.widthOfPanel != null || rel.square)) {
        out.width = null;
        if (out.height == null) out.height = null;
    }
    if (out.left == null && rel.centerX) out.left = null;
    if (out.top == null && (rel.centerYOffset != null || rel.belowRole || rel.bottomInset != null)) {
        out.top = null;
    }
    return out;
}

function prepareSnapshotScene(sceneData) {
    if (!sceneData || typeof sceneData !== "object") return sceneData;
    const out = JSON.parse(JSON.stringify(sceneData));
    if (Array.isArray(out.containers)) {
        out.containers = out.containers.map(snapshotEntryForApply);
    }
    return out;
}

/**
 * Apply a visual preset to the live scene (no music/song data).
 * @param {object} preset
 * @param {{ name?: string }} [opts]
 */
async function applyScenePreset(preset, opts = {}) {
    if (!preset || typeof preset !== "object") {
        throw new Error("Invalid preset");
    }
    const sceneData = normalizeIncomingScene(preset.scene || preset);
    if (!sceneData || typeof sceneData !== "object") {
        throw new Error("Preset missing scene");
    }

    // ── Bottom strip (before containers so geometry uses correct float area)
    const bp = sceneData.bottomPanel;
    if (bp && typeof bp === "object") {
        scene.bottomPanel = {
            color: normalizeHexColor(bp.color, scene.bottomPanel?.color),
            heightRatio: "heightRatio" in bp
                ? normalizeHeightRatio(bp.heightRatio)
                : ("heightPercent" in bp
                    ? normalizeHeightRatio(Number(bp.heightPercent) / 100)
                    : normalizeHeightRatio(scene.bottomPanel?.heightRatio)),
            includeInFloatArea: "includeInFloatArea" in bp
                ? !!bp.includeInFloatArea
                : !!scene.bottomPanel?.includeInFloatArea,
        };
        applyBottomPanelLayout();
        if (typeof window.__musicViewResizeCanvases === "function") {
            window.__musicViewResizeCanvases();
        }
    }

    try {
        await applyBackgroundSnapshot(sceneData.background, { resetIfMissing: true });
    } catch (e) {
        console.warn("Preset background apply failed", e);
    }

    // ── Containers: match by role (song panels) or id ─────────────────
    const entries = Array.isArray(sceneData.containers) ? sceneData.containers : [];
    const topPanel = scene.topPanel;

    for (const entry of entries) {
        let state = null;
        if (entry.role) state = findContainerByRole(entry.role);
        if (!state && entry.id != null) state = findContainerById(entry.id);
        if (!state) {
            // Unknown extra container — skip (presets are visual chrome for known panels)
            continue;
        }

        const geo = resolvePresetGeometry(snapshotEntryForApply(entry), topPanel, getDesignFloatSize());
        const updates = {
            label: entry.label,
            labelEnabled: entry.labelEnabled,
            labelCorner: entry.labelCorner,
            wander: entry.wander,
            wanderAmplitude: entry.wanderAmplitude,
            wanderFrequency: entry.wanderFrequency,
            layer: entry.layer,
            distancing: entry.distancing,
            connect: entry.connect,
            anchorDistance: entry.anchorDistance,
            style: entry.style,
            imageMode: entry.imageMode,
            contentFade: entry.contentFade,
            textGlitch: entry.textGlitch,
            progressTimeMode: entry.progressTimeMode,
            audioInput: entry.audioInput,
        };
        // Resolve attach by role first
        if (entry.attachToRole) {
            const other = findContainerByRole(entry.attachToRole);
            updates.attachToId = other ? other.id : null;
        } else if ("attachToId" in entry) {
            updates.attachToId = entry.attachToId;
        }

        applyContainerUpdates(state, updates);
        ensureAudioInputOnState(state);
        if (entry.snapshotId) state.snapshotId = entry.snapshotId;
        if ("relative" in entry) state.relative = entry.relative && typeof entry.relative === "object" ? entry.relative : null;
        if (geo.left != null || geo.top != null || geo.width != null || geo.height != null) {
            const prev = state.layoutDesign || {};
            state.layoutDesign = {
                left: geo.left != null ? geo.left : (prev.left || 0),
                top: geo.top != null ? geo.top : (prev.top || 0),
                width: geo.width != null ? geo.width : (prev.width || 100),
                height: geo.height != null ? geo.height : (prev.height || 100),
            };
            applyLiveFromDesign(state);
            pinContainerLayout(state);
        }

        // ARTEF4KT embed settings (role must already exist in live scene)
        if (state.role === "artef4kt" || entry.role === "artef4kt") {
            if (entry.embed && typeof entry.embed === "object") {
                state.embed = {
                    engine: entry.embed.engine || "artef4kt",
                    settingsId: entry.embed.settingsId || "default",
                    quality: entry.embed.quality || "auto",
                    settings: entry.embed.settings && typeof entry.embed.settings === "object"
                        ? entry.embed.settings
                        : null,
                };
            } else if (!state.embed) {
                state.embed = { engine: "artef4kt", settingsId: "default", quality: "auto", settings: null };
            }
            try {
                if (!state.artef4ktHost) {
                    await mountArtef4ktOnContainer(state);
                } else if (state.embed.settings && state.artef4ktHost.applySettings) {
                    state.artef4ktHost.applySettings(state.embed.settings, { partial: false });
                    cacheArtef4ktSettings(state);
                } else if (state.artef4ktHost.loadSettings && state.embed.settingsId) {
                    await loadArtef4ktPresetOnContainer(state, state.embed.settingsId);
                }
                resizeArtef4ktOnContainer(state);
            } catch (e) {
                console.warn("Preset ARTEF4KT apply failed", e);
            }
        }

        // Container shader package (+ optional modulators; additive, safe if missing)
        if (entry.shaderId && state.role !== "artef4kt") {
            try {
                await applyShaderPackageToState(
                    state,
                    entry.shaderId,
                    sanitizeUniformMap(entry.shaderUniforms || {}),
                );
                // applyShaderPackageToState clears modulators; restore from preset
                const cMods = sanitizeModulatorsMap(entry.shaderModulators);
                if (Object.keys(cMods).length) {
                    updateContainerModulators(state, cMods);
                }
            } catch (e) {
                console.warn("Preset shader apply failed", entry.shaderId, e);
            }
        } else if (state.role !== "artef4kt" && (state.shaderRenderer || state.shaderId)) {
            clearShader(state);
        }

        // Per-container postprocess stack
        if (entry.postprocess && typeof entry.postprocess === "object") {
            const cpp = entry.postprocess;
            const layers = Array.isArray(cpp.layers) ? cpp.layers : [];
            try {
                if (layers.length) {
                    await setContainerPostprocessStack(
                        state,
                        layers.map((l) => ({
                            shaderId: l.shaderId || l.shaderPath || "lcd",
                            uniforms: sanitizeUniformMap(l.uniforms || {}),
                            modulators: sanitizeModulatorsMap(l.modulators),
                            enabled: l.enabled !== false,
                        })),
                        { active: cpp.active !== false },
                    );
                } else {
                    ensureContainerPostprocessState(state).layers = [];
                    stopContainerPostprocess(state);
                    await rebuildContainerPostprocessStack(state);
                }
            } catch (e) {
                console.warn("Preset container postprocess apply failed", state.role || state.id, e);
            }
        } else if (state.postprocess?.layers?.length) {
            // Preset has no container FX — clear any live stack
            ensureContainerPostprocessState(state).layers = [];
            stopContainerPostprocess(state);
            try { await rebuildContainerPostprocessStack(state); } catch (_) { /* ignore */ }
        }
    }

    // ── Postprocess stack ─────────────────────────────────────────────
    const pp = sceneData.postprocess;
    if (pp && typeof pp === "object") {
        const layers = Array.isArray(pp.layers) ? pp.layers : [];
        if (layers.length) {
            await setPostprocessStack(
                layers.map((l) => ({
                    shaderId: l.shaderId || l.shaderPath || "lcd",
                    uniforms: sanitizeUniformMap(l.uniforms || {}),
                    modulators: sanitizeModulatorsMap(l.modulators),
                    enabled: l.enabled !== false,
                    _showFx: !!l._showFx,
                })),
                { active: pp.active !== false },
            );
        } else if (pp.active === false) {
            stopPostprocess();
        } else if (pp.shaderId) {
            // Legacy single-layer (no modulators field historically)
            await setPostprocessStack([{
                shaderId: pp.shaderId,
                uniforms: sanitizeUniformMap(pp.uniforms || {}),
                modulators: sanitizeModulatorsMap(pp.modulators),
                enabled: true,
            }], { active: pp.active !== false });
        }
    }

    scene.activePreset = opts.name || preset.name || null;

    if (scene.redraw) scene.redraw();
    else publishSceneState();

    return getSceneState();
}

const UNIQUE_SNAPSHOT_ROLES = new Set([
    "song-cover", "song-info", "song-lyrics", "song-progress", "show-progress",
    "audio-scope", "audio-history", "audio-beat", "artef4kt",
]);

function matchSnapshotEntries(entries) {
    const used = new Set();
    const pairs = [];
    for (const entry of entries) {
        let state = null;
        const unique = entry.role && UNIQUE_SNAPSHOT_ROLES.has(entry.role);
        if (unique) {
            state = scene.containers.find((c) => c.role === entry.role && !used.has(c)) || null;
        } else {
            if (entry.snapshotId) {
                state = scene.containers.find((c) => !c.role && c.snapshotId === entry.snapshotId && !used.has(c)) || null;
            }
            if (!state) {
                state = scene.containers.find((c) => !c.role && !used.has(c)) || null;
            }
        }
        if (state) used.add(state);
        pairs.push({ entry, state });
    }
    return { pairs, used };
}

function mintSnapshotId() {
    if (globalThis.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "snap_" + Date.now() + "_" + Math.random().toString(36).slice(2);
}

function exportPerformanceSnapshot(displayName) {
    return exportScenePreset(displayName);
}

function resolveSnapshotGeometryScene(sceneData) {
    const topPanel = scene.topPanel;
    const out = prepareSnapshotScene(sceneData || {});
    if (!Array.isArray(out.containers)) return out;
    const placed = [];
    for (const entry of out.containers) {
        const geo = resolvePresetGeometry(entry, topPanel, getDesignFloatSize());
        if (geo.left != null) entry.left = geo.left;
        if (geo.top != null) entry.top = geo.top;
        if (geo.width != null) entry.width = geo.width;
        if (geo.height != null) entry.height = geo.height;
        if (!("relative" in entry)) entry.relative = entry.relative || null;
        if (!entry.snapshotId) entry.snapshotId = mintSnapshotId();
        placed.push(entry);
    }
    return out;
}

function applyContainerVisibility(state) {
    if (!state) return;
    const on = state.visible !== false;
    state.visible = on;
    const el = state.element;
    if (!el) return;
    el.classList.toggle("is-hidden", !on);
    if (!sceneTransition) el.style.opacity = "";
    el.setAttribute("aria-hidden", on ? "false" : "true");
}

const MULTI_INSTANCE_AUDIO_ROLES = new Set(["audio-scope", "audio-history", "audio-beat"]);

function roleTaken(role, exceptId) {
    if (!role || !UNIQUE_SNAPSHOT_ROLES.has(role)) return false;
    if (MULTI_INSTANCE_AUDIO_ROLES.has(role)) return false;
    return scene.containers.some((c) => c.role === role && c.id !== exceptId);
}

function teardownRoleChrome(state, prevRole) {
    if (!state?.element || !prevRole) return;
    const cls = SONG_ROLE_CLASS[prevRole];
    if (cls) state.element.classList.remove(cls);
    if (prevRole === "song-info") {
        state.element.querySelectorAll(".song-info-block").forEach((n) => n.remove());
        state.songInfoBlock = null;
        if (state.textEl) state.textEl.style.display = "";
    } else if (prevRole === "song-lyrics") {
        state.element.querySelectorAll(".song-lyrics-viewport, .song-lyrics-block").forEach((n) => n.remove());
        state.lyricsViewport = null;
        state.lyricsBlock = null;
        state.lyricsTrack = null;
        if (state.textEl) state.textEl.style.display = "";
    } else if (isProgressRole(prevRole)) {
        if (state.innerCanvas) state.innerCanvas.classList.remove("song-progress-canvas");
        state.progressReady = false;
        if (state.textEl) state.textEl.style.display = "";
    } else if (prevRole === "song-cover") {
        state.image = null;
        state.imageSrc = null;
        if (state.innerCtx && state.innerCanvas) {
            state.innerCtx.clearRect(0, 0, state.innerCanvas.width, state.innerCanvas.height);
        }
    } else if (prevRole === "artef4kt") {
        try { unmountArtef4ktFromContainer(state); } catch (_) { /* ignore */ }
        state.embed = null;
    }
}

async function setupRoleChrome(state, prevRole = null) {
    if (!state) return;
    if (prevRole && prevRole !== state.role) teardownRoleChrome(state, prevRole);
    const role = state.role;
    if (role && SONG_ROLE_CLASS[role]) {
        state.element.classList.add(SONG_ROLE_CLASS[role]);
    }
    if (role === "song-info") {
        if (state.textEl) state.textEl.style.display = "none";
        setupSongInfoBlock(state);
    } else if (role === "song-lyrics") {
        if (state.textEl) state.textEl.style.display = "none";
        setupSongLyricsBlock(state);
    } else if (isProgressRole(role)) {
        if (state.textEl) state.textEl.style.display = "none";
        setupSongProgressBar(state);
    } else if (role === "audio-scope" || role === "audio-history" || role === "audio-beat") {
        ensureAudioInputOnState(state);
        if (!state.shaderId) {
            const def = role === "audio-beat" ? "audio-ferrofluid" : role;
            try { await applyShaderPackageToState(state, def, {}); } catch (e) {
                console.warn("setupRoleChrome viz shader", e);
            }
        }
    } else if (role === "artef4kt") {
        ensureAudioInputOnState(state);
        if (state.shaderRenderer) clearShader(state);
        if (!state.embed) state.embed = { engine: "artef4kt", settingsId: "default", quality: "auto" };
        if (!state.artef4ktHost) {
            try { await mountArtef4ktOnContainer(state); } catch (e) {
                console.warn("setupRoleChrome artef4kt", e);
            }
        }
    } else if (!role) {
        if (state.textEl && !state.shaderRenderer) state.textEl.style.display = "";
    }
    rebindSongPanels();
}

async function spawnSnapshotContainer(entry) {
    const role = UNIQUE_SNAPSHOT_ROLES.has(entry.role) ? entry.role : null;
    const geo = resolvePresetGeometry(snapshotEntryForApply(entry), scene.topPanel, getDesignFloatSize());
    const s = getLayoutScale();
    const w = (geo.width || 160) * s;
    const h = (geo.height || 100) * s;
    const el = createFloatingContainer(
        scene.topPanel,
        {
            width: w,
            height: h,
            left: (geo.left || 0) * s,
            top: (geo.top || 0) * s,
            text: role ? "" : (entry.text || ""),
            label: entry.label || role || "Panel",
            role,
            wander: false,
            layer: entry.layer || 0,
            style: entry.style || {},
            skipPlacementSearch: true,
            snapshotId: entry.snapshotId || mintSnapshotId(),
            relative: entry.relative || null,
            visible: entry.visible !== false,
            panelKind: entry.panelKind || null,
            contentFade: entry.contentFade,
            textGlitch: entry.textGlitch,
            audioInput: entry.audioInput || null,
        },
        scene.containers,
        scene.redraw,
    );
    const state = scene.containers.find((c) => c.element === el) || scene.containers[scene.containers.length - 1];
    if (state) {
        applyContainerVisibility(state);
        pinContainerLayout(state);
        await setupRoleChrome(state, null);
    }
    return state;
}

async function applyPresetEntryToState(state, entry) {
    if (!state || !entry) return;
    const topPanel = scene.topPanel;
    const geo = resolvePresetGeometry(snapshotEntryForApply(entry), topPanel, getDesignFloatSize());
    const songRole = state.role && String(state.role).startsWith("song-");
    const updates = {
        label: entry.label,
        labelEnabled: entry.labelEnabled,
        labelCorner: entry.labelCorner,
        wander: entry.wander,
        wanderAmplitude: entry.wanderAmplitude,
        wanderFrequency: entry.wanderFrequency,
        layer: entry.layer,
        distancing: entry.distancing,
        connect: entry.connect,
        anchorDistance: entry.anchorDistance,
        style: entry.style,
        imageMode: entry.imageMode,
        contentFade: entry.contentFade,
        textGlitch: entry.textGlitch,
        progressTimeMode: entry.progressTimeMode,
        visible: entry.visible !== false,
        audioInput: entry.audioInput,
    };
    if (!songRole && "text" in entry) updates.text = entry.text;
    if (entry.attachToRole) {
        const other = findContainerByRole(entry.attachToRole);
        updates.attachToId = other ? other.id : null;
    } else if ("attachToId" in entry) {
        updates.attachToId = entry.attachToId;
    }
    applyContainerUpdates(state, updates);
    if (entry.snapshotId) state.snapshotId = entry.snapshotId;
    if ("relative" in entry) {
        state.relative = entry.relative && typeof entry.relative === "object" ? entry.relative : null;
    }
    if (geo.left != null || geo.top != null || geo.width != null || geo.height != null) {
        const prev = state.layoutDesign || {};
        state.layoutDesign = {
            left: geo.left != null ? geo.left : (prev.left || 0),
            top: geo.top != null ? geo.top : (prev.top || 0),
            width: geo.width != null ? geo.width : (prev.width || 100),
            height: geo.height != null ? geo.height : (prev.height || 100),
        };
        applyLiveFromDesign(state);
        pinContainerLayout(state);
    }
    if (entry.panelKind) state.panelKind = entry.panelKind;
    applyContainerVisibility(state);

    if (state.role === "artef4kt") {
        if (entry.embed && typeof entry.embed === "object") {
            state.embed = {
                engine: entry.embed.engine || "artef4kt",
                settingsId: entry.embed.settingsId || "default",
                quality: entry.embed.quality || "auto",
                settings: entry.embed.settings && typeof entry.embed.settings === "object"
                    ? entry.embed.settings
                    : null,
            };
        } else if (!state.embed) {
            state.embed = { engine: "artef4kt", settingsId: "default", quality: "auto", settings: null };
        }
        try {
            if (!state.artef4ktHost) await mountArtef4ktOnContainer(state);
            else if (state.embed.settings && state.artef4ktHost.applySettings) {
                state.artef4ktHost.applySettings(state.embed.settings, { partial: false });
                cacheArtef4ktSettings(state);
            } else if (state.artef4ktHost.loadSettings && state.embed.settingsId) {
                await loadArtef4ktPresetOnContainer(state, state.embed.settingsId);
            }
            resizeArtef4ktOnContainer(state);
        } catch (e) {
            console.warn("Preset ARTEF4KT apply failed", e);
        }
    }

    if (entry.shaderId && state.role !== "artef4kt") {
        try {
            await applyShaderPackageToState(
                state,
                entry.shaderId,
                sanitizeUniformMap(entry.shaderUniforms || {}),
            );
            const cMods = sanitizeModulatorsMap(entry.shaderModulators);
            if (Object.keys(cMods).length) updateContainerModulators(state, cMods);
        } catch (e) {
            console.warn("Preset shader apply failed", entry.shaderId, e);
        }
    } else if (state.role !== "artef4kt" && (state.shaderRenderer || state.shaderId) && !entry.shaderId) {
        clearShader(state);
    }

    if (entry.postprocess && typeof entry.postprocess === "object") {
        const cpp = entry.postprocess;
        const layers = Array.isArray(cpp.layers) ? cpp.layers : [];
        try {
            if (layers.length) {
                await setContainerPostprocessStack(
                    state,
                    layers.map((l) => ({
                        shaderId: l.shaderId || l.shaderPath || "lcd",
                        uniforms: sanitizeUniformMap(l.uniforms || {}),
                        modulators: sanitizeModulatorsMap(l.modulators),
                        enabled: l.enabled !== false,
                    })),
                    { active: cpp.active !== false },
                );
            } else {
                ensureContainerPostprocessState(state).layers = [];
                stopContainerPostprocess(state);
                await rebuildContainerPostprocessStack(state);
            }
        } catch (e) {
            console.warn("Preset container postprocess apply failed", state.role || state.id, e);
        }
    } else if (state.postprocess?.layers?.length) {
        ensureContainerPostprocessState(state).layers = [];
        stopContainerPostprocess(state);
        try { await rebuildContainerPostprocessStack(state); } catch (_) { /* ignore */ }
    }
}

function bottomPanelEquals(a, b) {
    if (!a && !b) return true;
    if (!a || !b) return false;
    return a.color === b.color
        && Number(a.heightRatio) === Number(b.heightRatio)
        && !!a.includeInFloatArea === !!b.includeInFloatArea;
}

function postprocessSpecKey(layers, active) {
    const ids = (Array.isArray(layers) ? layers : [])
        .map((l) => `${l && l.enabled === false ? "0" : "1"}:${l && (l.shaderId || l.shaderPath) || ""}`)
        .join("|");
    return `${active ? 1 : 0}:${ids}`;
}

function shaderSeqKey(layers) {
    return (Array.isArray(layers) ? layers : [])
        .map((l) => `${l && l.enabled === false ? "0" : "1"}:${l && (l.shaderId || l.shaderPath || (l._inlineSource ? "inline" : "")) || ""}`)
        .join("|");
}

async function applySceneChromeOnly(preset, opts = {}) {
    const sceneData = (preset && (preset.scene || preset)) || {};
    const bp = sceneData.bottomPanel;
    if (bp && typeof bp === "object") {
        const next = {
            color: normalizeHexColor(bp.color, scene.bottomPanel?.color),
            heightRatio: "heightRatio" in bp
                ? normalizeHeightRatio(bp.heightRatio)
                : ("heightPercent" in bp
                    ? normalizeHeightRatio(Number(bp.heightPercent) / 100)
                    : normalizeHeightRatio(scene.bottomPanel?.heightRatio)),
            includeInFloatArea: "includeInFloatArea" in bp
                ? !!bp.includeInFloatArea
                : !!scene.bottomPanel?.includeInFloatArea,
        };
        const changed = !bottomPanelEquals(scene.bottomPanel, next);
        scene.bottomPanel = next;
        if (changed) {
            applyBottomPanelLayout();
            if (typeof window.__musicViewResizeCanvases === "function") {
                window.__musicViewResizeCanvases();
            }
        }
    }
    if (!opts.skipBackground && sceneData.background && typeof sceneData.background === "object") {
        try {
            await applyBackgroundSnapshot(sceneData.background, { resetIfMissing: false });
        } catch (e) {
            console.warn("FX-only background apply failed", e);
        }
    }
    const pp = sceneData.postprocess;
    if (pp && typeof pp === "object") {
        const layers = Array.isArray(pp.layers) ? pp.layers : [];
        const wantActive = layers.length ? pp.active !== false : pp.active === true;
        const incomingKey = postprocessSpecKey(layers, wantActive);
        const liveKey = postprocessSpecKey(postprocessState.layers, !!postprocessState.active);
        if (incomingKey !== liveKey) {
            if (layers.length) {
                await setPostprocessStack(
                    layers.map((l) => ({
                        shaderId: l.shaderId || l.shaderPath || "lcd",
                        uniforms: sanitizeUniformMap(l.uniforms || {}),
                        modulators: sanitizeModulatorsMap(l.modulators),
                        enabled: l.enabled !== false,
                        _showFx: !!l._showFx,
                    })),
                    { active: pp.active !== false },
                );
            } else if (pp.active === false) {
                stopPostprocess();
            } else if (pp.shaderId) {
                await setPostprocessStack([{
                    shaderId: pp.shaderId,
                    uniforms: sanitizeUniformMap(pp.uniforms || {}),
                    modulators: sanitizeModulatorsMap(pp.modulators),
                    enabled: true,
                }], { active: pp.active !== false });
            }
        }
    }
    scene.activePreset = opts.name || preset?.name || null;
}

function hasLayoutContainers(sceneData) {
    return !!(sceneData && Array.isArray(sceneData.containers) && sceneData.containers.length > 0);
}

async function applyLayoutPreset(preset, opts = {}) {
    const sceneData = preset.scene || preset;
    const name = opts.name || preset.name;
    if (!hasLayoutContainers(sceneData)) {
        await applySceneChromeOnly(preset, { name });
        if (scene.redraw) scene.redraw();
        else publishSceneState();
        return { state: getSceneState(), added: 0, removed: 0, kept: scene.containers.length, fxOnly: true };
    }
    const result = await applySceneSnapshot(sceneData, {
        spawnMissing: true,
        pruneExtra: "generics",
        name,
    });
    return Object.assign({ fxOnly: false }, result);
}

const CONTAINER_LIMIT = 32;
const NAMED_ROLE_TEMPLATES = new Set([
    "song-cover", "song-info", "song-lyrics", "song-progress", "show-progress",
    "audio-scope", "audio-history", "audio-beat", "artef4kt",
]);

function nextContainerLayer() {
    let max = 0;
    for (const c of scene.containers) {
        const n = Number(c.layer) || 0;
        if (n > max) max = n;
    }
    return max + 1;
}

function defaultSpawnRect(width, height) {
    const area = getDesignFloatSize();
    const w = Math.max(40, Number(width) || 160);
    const h = Math.max(28, Number(height) || 100);
    return {
        width: w,
        height: h,
        left: Math.round((area.width - w) / 2),
        top: Math.round((area.height - h) / 2),
    };
}

function isContainerFillShader(meta) {
    if (!meta) return false;
    const roles = meta.roles;
    if (!roles || !roles.length) return true;
    return roles.includes("container") || roles.includes("any");
}

function selectNeighborAfterRemove(removedId) {
    const list = scene.containers;
    if (!list.length) {
        setSelectedContainerId(null);
        return null;
    }
    const prev = list[list.length - 1];
    setSelectedContainerId(prev.id);
    return prev.id;
}

async function commandAddContainer(payload) {
    if (scene.containers.length >= CONTAINER_LIMIT) {
        return { ok: false, error: "Container limit (32)" };
    }
    let template = payload.template || null;
    let role = payload.role != null && payload.role !== "" ? payload.role : null;
    if (role && !UNIQUE_SNAPSHOT_ROLES.has(role)) role = null;
    if (template && NAMED_ROLE_TEMPLATES.has(template)) {
        if (role && role !== template) return { ok: false, error: "template/role mismatch" };
        role = template;
        template = role;
    }
    if (role && roleTaken(role)) {
        return { ok: false, error: "Role already exists: " + role };
    }
    if (payload.shaderId) {
        try {
            const pkg = await loadShaderControls(payload.shaderId);
            const meta = packageToClientMeta(pkg);
            if (!isContainerFillShader(meta)) {
                return { ok: false, error: "Unknown or non-container shader" };
            }
        } catch (e) {
            return { ok: false, error: "Unknown or non-container shader" };
        }
    }

    const area = getDesignFloatSize();
    const scale = getLayoutScale();
    let w = payload.width, h = payload.height, left = payload.left, top = payload.top;
    let text = payload.text != null ? String(payload.text) : "";
    let label = payload.label || "Panel";
    let panelKind = null;
    let shaderId = payload.shaderId || null;
    let embed = null;

    if (role === "song-cover") {
        const s = Math.round(Math.min(area.width, area.height) * 0.48);
        w = w || s; h = h || s; label = label === "Panel" ? "Cover" : label;
    } else if (role === "song-info") {
        w = w || 160; h = h || 72; label = label === "Panel" ? "Track" : label;
    } else if (role === "song-lyrics") {
        w = w || Math.min(360, Math.round(area.width * 0.78));
        h = h || 110; label = label === "Panel" ? "Lyrics" : label;
    } else if (role === "song-progress") {
        w = w || Math.min(380, Math.round(area.width * 0.84));
        h = h || 28; label = label === "Panel" ? "Progress" : label;
    } else if (role === "show-progress") {
        w = w || Math.min(380, Math.round(area.width * 0.84));
        h = h || 28; label = label === "Panel" ? "Show" : label;
    } else if (role === "audio-scope") {
        w = w || 160; h = h || 90; label = "Scope"; shaderId = shaderId || "audio-scope";
    } else if (role === "audio-history") {
        w = w || 160; h = h || 90; label = "History"; shaderId = shaderId || "audio-history";
    } else if (role === "audio-beat") {
        w = w || 120; h = h || 120; label = "Beat"; shaderId = shaderId || "audio-ferrofluid";
    } else if (role === "artef4kt") {
        const s = Math.min(420, Math.round(Math.min(area.width, area.height) * 0.48));
        w = w || Math.max(180, s); h = h || Math.max(180, s); label = "ARTEF4KT";
        embed = { engine: "artef4kt", settingsId: "default", quality: "auto" };
    } else if (template === "text") {
        w = w || 200; h = h || 80; text = text || "Text"; label = label === "Panel" ? "Text" : label;
    } else if (template === "shader") {
        w = w || 220; h = h || 130; label = label === "Panel" ? "Shader" : label;
    } else if (template === "image") {
        w = w || 180; h = h || 180; panelKind = "image"; label = label === "Panel" ? "Image" : label;
    } else {
        w = w || 160; h = h || 100;
    }

    const rect = defaultSpawnRect(w, h);
    if (left == null) left = rect.left;
    if (top == null) top = rect.top;

    const el = createFloatingContainer(
        scene.topPanel,
        {
            width: w * scale,
            height: h * scale,
            left: left * scale,
            top: top * scale,
            text: role ? "" : text,
            label,
            role,
            layer: nextContainerLayer(),
            style: {},
            skipPlacementSearch: false,
            panelKind,
            imageMode: panelKind === "image" ? "fill" : "scale",
            embed,
            audioInput: payload.audioInput || null,
        },
        scene.containers,
        scene.redraw,
    );
    const state = scene.containers.find((c) => c.element === el) || scene.containers[scene.containers.length - 1];
    applyContainerVisibility(state);
    await setupRoleChrome(state, null);
    if (shaderId && state.role !== "artef4kt") {
        try { await applyShaderPackageToState(state, shaderId, {}); } catch (e) {
            console.warn("addContainer shader", e);
        }
    }
    if (role && String(role).startsWith("song-")) await flushNowPlaying();
    setSelectedContainerId(state.id);
    if (scene.redraw) scene.redraw();
    return { ok: true, id: state.id, state: getSceneState() };
}

function commandRemoveContainer(payload) {
    const state = findContainerById(payload?.id);
    if (!state) return { ok: false, error: "Container not found" };
    const removedId = state.id;
    const idx = scene.containers.indexOf(state);
    destroyFloatingContainer(state);
    rebindSongPanels();
    if (scene.containers.length) {
        const neighbor = scene.containers[Math.max(0, idx - 1)] || scene.containers[0];
        setSelectedContainerId(neighbor.id);
    } else {
        setSelectedContainerId(null);
    }
    if (scene.redraw) scene.redraw();
    return { ok: true, removedId, state: getSceneState() };
}

async function commandDuplicateContainer(payload) {
    const src = findContainerById(payload?.id);
    if (!src) return { ok: false, error: "Container not found" };
    if (scene.containers.length >= CONTAINER_LIMIT) {
        return { ok: false, error: "Container limit (32)" };
    }
    const area = getFloatAreaSize();
    const w = src.width || 160;
    const h = src.height || 100;
    const left = Math.min(area.width - w, (src.left || 0) + 16);
    const top = Math.min(area.height - h, (src.top || 0) + 16);
    const el = createFloatingContainer(
        scene.topPanel,
        {
            width: w,
            height: h,
            left: Math.max(0, left),
            top: Math.max(0, top),
            text: src.text || "",
            label: (src.label || "Panel") + " copy",
            role: src.role || null,
            layer: nextContainerLayer(),
            style: JSON.parse(JSON.stringify(src.style || {})),
            wander: !!src.wander,
            wanderAmplitude: src.wanderAmplitude,
            wanderFrequency: src.wanderFrequency,
            distancing: src.distancing,
            connect: false,
            imageMode: src.imageMode || "scale",
            panelKind: src.panelKind || null,
            skipPlacementSearch: false,
        },
        scene.containers,
        scene.redraw,
    );
    const state = scene.containers.find((c) => c.element === el) || scene.containers[scene.containers.length - 1];
    applyContainerVisibility(state);
    if (src.audioInput) state.audioInput = src.audioInput;
    ensureAudioInputOnState(state);
    if (src.shaderId && src.role !== "artef4kt") {
        try {
            await applyShaderPackageToState(state, src.shaderId, sanitizeUniformMap(src.shaderUniforms || {}));
            const mods = sanitizeModulatorsMap(src.shaderModulators);
            if (Object.keys(mods).length) updateContainerModulators(state, mods);
        } catch (e) {
            console.warn("duplicate shader", e);
        }
    }
    if (src.postprocess && src.postprocess.layers && src.postprocess.layers.length) {
        try {
            await setContainerPostprocessStack(state, src.postprocess.layers, { active: src.postprocess.active !== false });
        } catch (_) { /* ignore */ }
    }
    setSelectedContainerId(state.id);
    if (scene.redraw) scene.redraw();
    return { ok: true, id: state.id, state: getSceneState() };
}

async function commandSetContainerRole(payload) {
    const state = findContainerById(payload?.id);
    if (!state) return { ok: false, error: "Container not found" };
    let role = payload.role;
    if (role === "" || role === undefined) role = null;
    if (role && !UNIQUE_SNAPSHOT_ROLES.has(role)) role = null;
    if (role && roleTaken(role, state.id)) {
        return { ok: false, error: "Role already exists: " + role };
    }
    const prev = state.role;
    state.role = role;
    await setupRoleChrome(state, prev);
    if (role && String(role).startsWith("song-")) await flushNowPlaying();
    if (scene.redraw) scene.redraw();
    return { ok: true, state: getSceneState() };
}

async function applySceneSnapshot(sceneData, opts = {}) {
    const spawnMissing = !!opts.spawnMissing;
    let pruneExtra = opts.pruneExtra;
    if (pruneExtra === undefined || pruneExtra === null) pruneExtra = true;
    if (pruneExtra === true || pruneExtra === "all") pruneExtra = true;
    if (!sceneData || typeof sceneData !== "object") {
        throw new Error("Invalid snapshot");
    }
    sceneData = prepareSnapshotScene(normalizeIncomingScene(sceneData, { snapshot: true }));
    await applySceneChromeOnly({ scene: sceneData }, { name: opts.name, skipBackground: opts.skipBackground });
    if (!opts.skipBackground && !sceneData.background) {
        try {
            await applyBackgroundSnapshot(null, { resetIfMissing: true });
        } catch (e) {
            console.warn("Background reset on snapshot failed", e);
        }
    }

    const entries = Array.isArray(sceneData.containers) ? sceneData.containers : [];
    const { pairs } = matchSnapshotEntries(entries);
    let added = 0;
    for (const pair of pairs) {
        if (!pair.state && spawnMissing) {
            const uniqueRestore = pair.entry.role && UNIQUE_SNAPSHOT_ROLES.has(pair.entry.role);
            if (!uniqueRestore && scene.containers.length >= 32) continue;
            pair.state = await spawnSnapshotContainer(pair.entry);
            if (pair.state) added += 1;
        }
        if (pair.state) await applyPresetEntryToState(pair.state, pair.entry);
    }
    const keep = new Set(pairs.map((p) => p.state).filter(Boolean));
    let removed = 0;
    if (pruneExtra === true) {
        const extras = scene.containers.filter((c) => !keep.has(c));
        for (const extra of extras) {
            destroyFloatingContainer(extra);
            removed += 1;
        }
    } else if (pruneExtra === "generics") {
        const extras = scene.containers.filter((c) => !keep.has(c) && !c.role);
        for (const extra of extras) {
            destroyFloatingContainer(extra);
            removed += 1;
        }
    }
    rebindSongPanels();
    for (const c of scene.containers) clampContainerInPanel(c);
    await flushNowPlaying();
    if (scene.lastLyricFocus) applyLyricFocus(scene.lastLyricFocus);
    if (scene.redraw) scene.redraw();
    else publishSceneState();
    const kept = keep.size;
    return { state: getSceneState(), added, removed, kept };
}

function lerp(a, b, u) {
    return a + (b - a) * u;
}

function lerpNum(a, b, u, fallback) {
    const aa = Number(a);
    const bb = Number(b);
    if (Number.isFinite(aa) && Number.isFinite(bb)) return lerp(aa, bb, u);
    if (Number.isFinite(bb)) return bb;
    if (Number.isFinite(aa)) return aa;
    return fallback;
}

function parseColorToRgb(c) {
    if (c == null) return null;
    const s = String(c).trim().toLowerCase();
    if (!s || s === "transparent" || s === "none") return { r: 0, g: 0, b: 0, a: 0 };
    if (s[0] === "#") {
        let h = s.slice(1);
        if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
        if (h.length !== 6) return null;
        const n = parseInt(h, 16);
        if (!Number.isFinite(n)) return null;
        return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 };
    }
    const m = s.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)/i);
    if (!m) return null;
    return {
        r: Number(m[1]),
        g: Number(m[2]),
        b: Number(m[3]),
        a: m[4] != null ? Number(m[4]) : 1,
    };
}

function formatRgb(c) {
    const r = Math.max(0, Math.min(255, Math.round(c.r)));
    const g = Math.max(0, Math.min(255, Math.round(c.g)));
    const b = Math.max(0, Math.min(255, Math.round(c.b)));
    const a = Math.max(0, Math.min(1, c.a));
    if (a <= 0) return "transparent";
    if (a < 0.999) return `rgba(${r}, ${g}, ${b}, ${Math.round(a * 1000) / 1000})`;
    return "#" + [r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("");
}

function lerpColor(a, b, u) {
    const pa = parseColorToRgb(a);
    const pb = parseColorToRgb(b);
    if (!pa && !pb) return b || a || "#000000";
    if (!pa) return b;
    if (!pb) return a;
    return formatRgb({
        r: lerp(pa.r, pb.r, u),
        g: lerp(pa.g, pb.g, u),
        b: lerp(pa.b, pb.b, u),
        a: lerp(pa.a, pb.a, u),
    });
}

function lerpTextStyle(from, to, u) {
    const a = defaultTextStyle(from || {});
    const b = defaultTextStyle(to || {});
    const aw = Number(a.fontWeight);
    const bw = Number(b.fontWeight);
    return {
        fontFamily: u < 0.5 ? a.fontFamily : b.fontFamily,
        fontSize: lerpNum(a.fontSize, b.fontSize, u, 12),
        fontWeight: (Number.isFinite(aw) && Number.isFinite(bw))
            ? String(Math.round(lerp(aw, bw, u)))
            : (u < 0.5 ? a.fontWeight : b.fontWeight),
        fontStyle: u < 0.5 ? a.fontStyle : b.fontStyle,
        color: lerpColor(a.color, b.color, u),
        background: lerpColor(a.background, b.background, u),
        letterSpacing: lerpNum(a.letterSpacing, b.letterSpacing, u, 0),
        opacity: lerpNum(a.opacity, b.opacity, u, 1),
    };
}

function lerpStrokeStyle(from, to, u, fallbackWidth) {
    const a = from && typeof from === "object" ? from : {};
    const b = to && typeof to === "object" ? to : {};
    return {
        color: lerpColor(a.color || "#000", b.color || "#000", u),
        lineWidth: lerpNum(a.lineWidth, b.lineWidth, u, fallbackWidth),
        dash: u < 0.5 ? (Array.isArray(a.dash) ? a.dash : []) : (Array.isArray(b.dash) ? b.dash : []),
    };
}

function lerpContainerStyle(from, to, u) {
    const a = from && typeof from === "object" ? from : {};
    const b = to && typeof to === "object" ? to : {};
    return {
        border: lerpStrokeStyle(a.border, b.border, u, 2),
        connect: lerpStrokeStyle(a.connect, b.connect, u, 2),
        label: lerpTextStyle(a.label, b.label, u),
        text: lerpTextStyle(a.text || a.label, b.text || b.label, u),
        textAlign: u < 0.5 ? normalizeTextAlign(a.textAlign) : normalizeTextAlign(b.textAlign),
        padding: lerpNum(a.padding, b.padding, u, 0),
    };
}

function lerpHex(a, b, u) {
    return lerpColor(a, b, u);
}

let sceneTransition = null;

function emitSceneTransition(payload) {
    if (window.musicView && typeof window.musicView.publishSceneTransition === "function") {
        window.musicView.publishSceneTransition(payload);
    }
}

function deferNowPlaying() {
    return !!(
        sceneTransition
        && (sceneTransition.mode === "morph" || sceneTransition.mode === "dip")
        && !sceneTransition._contentApplied
    );
}

async function flushNowPlaying() {
    const info = scene._pendingNowPlaying || scene.lastNowPlaying;
    scene._pendingNowPlaying = null;
    if (info) await applyNowPlaying(info);
}

function easeU(u, easing) {
    const x = Math.max(0, Math.min(1, u));
    if (easing === "ease-in-out") return x * x * (3 - 2 * x);
    return x;
}

function ensureTransitionOverlay() {
    let el = document.getElementById("scene-transition-overlay");
    if (el) return el;
    el = document.createElement("div");
    el.id = "scene-transition-overlay";
    el.style.position = "absolute";
    el.style.inset = "0";
    el.style.pointerEvents = "none";
    el.style.zIndex = "40";
    el.style.opacity = "0";
    const canvas = document.createElement("canvas");
    canvas.id = "scene-transition-canvas";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    el.appendChild(canvas);
    const shell = document.querySelector(".app-shell") || document.body;
    shell.appendChild(el);
    return el;
}

function sizeOverlayToPostprocess(overlay) {
    const src = document.getElementById("postprocess-canvas");
    const canvas = overlay.querySelector("canvas");
    if (!src || !canvas) return;
    canvas.width = src.width;
    canvas.height = src.height;
    overlay.style.width = src.clientWidth + "px";
    overlay.style.height = src.clientHeight + "px";
    overlay.style.left = src.offsetLeft + "px";
    overlay.style.top = src.offsetTop + "px";
}

async function preloadSceneShaderPackages(sceneData) {
    if (!sceneData || typeof sceneData !== "object") return;
    const ids = new Set();
    const add = (id) => {
        if (id && typeof id === "string") ids.add(id);
    };
    const addLayers = (layers) => {
        for (const layer of layers || []) {
            if (!layer) continue;
            add(layer.shaderId || layer.shaderPath);
        }
    };
    const bg = sceneData.background;
    if (bg && bg.mode === "shader") add(bg.shaderId || bg.shaderPath);
    addLayers(bg && bg.postprocess && bg.postprocess.layers);
    addLayers(sceneData.postprocess && sceneData.postprocess.layers);
    for (const c of sceneData.containers || []) {
        if (!c) continue;
        add(c.shaderId);
        addLayers(c.postprocess && c.postprocess.layers);
    }
    await Promise.all([...ids].map((id) => loadShaderPackage(id).catch(() => null)));
}

async function applySceneTransition(payload) {
    const sceneData = payload?.scene
        ? prepareSnapshotScene(normalizeIncomingScene(payload.scene, { snapshot: true }))
        : null;
    if (!sceneData) return { ok: false, error: "scene required" };
    try {
        await preloadSceneShaderPackages(sceneData);
    } catch (e) {
        console.warn("Preload incoming shaders failed", e);
    }
    let mode = payload.mode || "cut";
    const duration = Number(payload.duration) || 0;
    const easing = payload.easing || "linear";
    const kind = payload.kind || "arrival";
    let matchScore = null;

    if (mode === "auto" || mode === "morph" || mode === "crossfade") {
        const matcher = window.SceneMatch;
        if (matcher && mode === "auto") {
            const live = exportPerformanceSnapshot("live").scene;
            const picked = matcher.pickAutoMode(live, sceneData, payload.morphThreshold || 0.65);
            mode = picked.mode;
            matchScore = picked.matchScore;
        }
        if (!matcher && (mode === "auto" || mode === "morph" || mode === "crossfade")) {
            mode = "cut";
        }
    }

    const transitionId = "vis_" + Date.now();
    if (mode === "cut" || duration <= 0) {
        await applySceneSnapshot(sceneData, { spawnMissing: true, pruneExtra: true, name: payload.name });
        emitSceneTransition({ id: transitionId, done: true, mode: "cut", u: 1 });
        return { ok: true, modeUsed: "cut", matchScore, transitionId };
    }

    if (mode === "dip") {
        const overlay = ensureTransitionOverlay();
        overlay.style.background = payload.dipColor || "#000000";
        overlay.style.opacity = "0";
        sizeOverlayToPostprocess(overlay);
        sceneTransition = {
            id: transitionId, mode: "dip", paused: false, u: 0, duration, easing, kind,
            incoming: sceneData, _applied: false, _contentApplied: false,
        };
        const t0 = performance.now();
        const run = async (now) => {
            if (!sceneTransition || sceneTransition.id !== transitionId) return;
            if (sceneTransition.paused) {
                sceneTransition._hold = (sceneTransition._hold || 0) + (now - (sceneTransition._last || now));
                sceneTransition._last = now;
                requestAnimationFrame(run);
                return;
            }
            sceneTransition._last = now;
            const u = easeU((now - t0 - (sceneTransition._hold || 0)) / (duration * 1000), easing);
            sceneTransition.u = u;
            if (u < 0.5) {
                overlay.style.opacity = String(u / 0.5);
            } else if (!sceneTransition._applied) {
                overlay.style.opacity = "1";
                sceneTransition._applied = true;
                await applySceneSnapshot(sceneData, { spawnMissing: true, pruneExtra: true, name: payload.name });
                if (sceneTransition && sceneTransition.id === transitionId) {
                    sceneTransition._contentApplied = true;
                }
            } else {
                overlay.style.opacity = String(1 - (u - 0.5) / 0.5);
            }
            if (u >= 1) {
                overlay.style.opacity = "0";
                if (sceneTransition && sceneTransition.id === transitionId) sceneTransition = null;
                emitSceneTransition({ id: transitionId, done: true, mode: "dip", u: 1 });
                return;
            }
            requestAnimationFrame(run);
        };
        requestAnimationFrame(run);
        return { ok: true, modeUsed: "dip", matchScore, transitionId };
    }

    if (mode === "crossfade") {
        const overlay = ensureTransitionOverlay();
        const src = document.getElementById("postprocess-canvas");
        const canvas = overlay.querySelector("canvas");
        sizeOverlayToPostprocess(overlay);
        if (src && canvas) {
            const ctx = canvas.getContext("2d");
            try { ctx.drawImage(src, 0, 0, canvas.width, canvas.height); } catch (e) {
                console.warn("[transition] freeze failed", e);
            }
        }
        overlay.style.background = "transparent";
        overlay.style.opacity = "1";
        canvas.style.opacity = "1";
        sceneTransition = {
            id: transitionId, mode: "crossfade", paused: false, u: 0, duration, easing, kind,
            incoming: sceneData, _contentApplied: true,
        };
        await applySceneSnapshot(sceneData, { spawnMissing: true, pruneExtra: true, name: payload.name });
        const t0 = performance.now();
        const run = (now) => {
            if (!sceneTransition || sceneTransition.id !== transitionId) return;
            if (sceneTransition.paused) {
                sceneTransition._hold = (sceneTransition._hold || 0) + (now - (sceneTransition._last || now));
                sceneTransition._last = now;
                requestAnimationFrame(run);
                return;
            }
            sceneTransition._last = now;
            const u = easeU((now - t0 - (sceneTransition._hold || 0)) / (duration * 1000), easing);
            sceneTransition.u = u;
            overlay.style.opacity = String(1 - u);
            if (u >= 1) {
                overlay.style.opacity = "0";
                if (sceneTransition && sceneTransition.id === transitionId) sceneTransition = null;
                emitSceneTransition({ id: transitionId, done: true, mode: "crossfade", u: 1 });
                return;
            }
            requestAnimationFrame(run);
        };
        requestAnimationFrame(run);
        return { ok: true, modeUsed: "crossfade", matchScore, transitionId };
    }

    // morph
    for (const c of scene.containers) stopWander(c);
    const s0 = getLayoutScale();
    const fromLive = scene.containers.map((c) => {
        const d = c.layoutDesign;
        return {
            state: c,
            left: d ? d.left : (c.left || 0) / s0,
            top: d ? d.top : (c.top || 0) / s0,
            width: d ? d.width : (c.width || 1) / s0,
            height: d ? d.height : (c.height || 1) / s0,
            layer: c.layer || 0,
            wander: c.wander,
            visible: c.visible !== false,
            style: JSON.parse(JSON.stringify(c.style || {})),
        };
    });
    const frozenInclude = scene.bottomPanel?.includeInFloatArea;
    const toBp = sceneData.bottomPanel || {};
    const fromBp = Object.assign({}, scene.bottomPanel || {});
    // Different fills (shader↔video, image↔shader, …) fade on a dedicated
    // overlay; same solid/shader identity lerps. Snapshot commit at u=1.
    let bgJob = { kind: "none" };
    try {
        bgJob = await startBackgroundTransition(sceneData.background) || { kind: "none" };
    } catch (e) {
        console.warn("Morph background transition failed", e);
        try {
            await applyBackgroundSnapshot(sceneData.background, { resetIfMissing: true });
        } catch (e2) {
            console.warn("Morph background apply failed", e2);
        }
    }
    sceneTransition = {
        id: transitionId, mode: "morph", paused: false, u: 0, duration, easing, kind,
        incoming: sceneData, _contentApplied: false, bgJob,
    };
    const { pairs } = matchSnapshotEntries(Array.isArray(sceneData.containers) ? sceneData.containers : []);
    const t0 = performance.now();
    let lastResize = 0;
    const run = async (now) => {
        if (!sceneTransition || sceneTransition.id !== transitionId) return;
        if (sceneTransition.paused) {
            sceneTransition._hold = (sceneTransition._hold || 0) + (now - (sceneTransition._last || now));
            sceneTransition._last = now;
            requestAnimationFrame(run);
            return;
        }
        sceneTransition._last = now;
        const u = easeU((now - t0 - (sceneTransition._hold || 0)) / (duration * 1000), easing);
        sceneTransition.u = u;
        for (const pair of pairs) {
            const state = pair.state;
            const entry = pair.entry;
            if (!state || !entry) continue;
            const geo = resolvePresetGeometry(entry, scene.topPanel, getDesignFloatSize());
            const from = fromLive.find((f) => f.state === state);
            if (!from || geo.left == null) continue;
            const sc = getLayoutScale();
            morphSetGeometry(
                state,
                lerp(from.left, geo.left, u) * sc,
                lerp(from.top, geo.top, u) * sc,
                lerp(from.width, geo.width || from.width, u) * sc,
                lerp(from.height, geo.height || from.height, u) * sc,
            );
            if (entry.style || from.style) {
                state.style = lerpContainerStyle(from.style, entry.style, u);
                applyContainerBoxStyle(state, { skipLyricsRecenter: true });
                if (isProgressRole(state.role)) {
                    setSongProgress(state, state.playbackProgress || 0, {
                        currentTime: state.playbackCurrentTime,
                        duration: state.playbackDuration,
                    });
                }
            }
            const inVis = entry.visible !== false;
            const outVis = from.visible !== false;
            if (state.element && !inVis && outVis) {
                state.element.style.opacity = String(1 - u);
            } else if (state.element && !outVis && inVis) {
                state.element.style.opacity = "0";
            } else if (state.element && !outVis && !inVis) {
                state.element.style.opacity = "0";
            }
            if (now - lastResize > 250 || u >= 1) {
                setContainerSize(state, state.width, state.height);
                lastResize = now;
            }
        }
        if (toBp && fromBp) {
            if (typeof toBp.heightRatio === "number") {
                scene.bottomPanel.heightRatio = lerp(
                    Number(fromBp.heightRatio) || 0,
                    Number(toBp.heightRatio) || 0,
                    u,
                );
            }
            if (toBp.color && fromBp.color) {
                scene.bottomPanel.color = lerpHex(fromBp.color, toBp.color, u);
            }
            scene.bottomPanel.includeInFloatArea = frozenInclude;
            applyBottomPanelLayout();
        }
        tickBackgroundTransition(bgJob, u);
        if (scene.redraw) scene.redraw();
        if (u >= 1) {
            await applySceneSnapshot(sceneData, {
                spawnMissing: true,
                pruneExtra: true,
                name: payload.name,
                skipBackground: true,
            });
            finishBackgroundTransition(bgJob);
            const fadeIns = [];
            for (const pair of pairs) {
                if (!pair.state?.element) continue;
                const inVis = pair.entry.visible !== false;
                const from = fromLive.find((f) => f.state === pair.state);
                const outVis = from ? from.visible !== false : true;
                if (!outVis && inVis) fadeIns.push(pair.state);
            }
            if (sceneTransition && sceneTransition.id === transitionId) {
                sceneTransition._contentApplied = true;
                sceneTransition = null;
            }
            if (fadeIns.length) {
                const fadeT0 = performance.now();
                const fade = (tnow) => {
                    const fu = Math.min(1, (tnow - fadeT0) / 180);
                    for (const st of fadeIns) {
                        if (st.element) st.element.style.opacity = String(fu);
                    }
                    if (fu < 1) requestAnimationFrame(fade);
                    else {
                        for (const st of fadeIns) {
                            if (st.element) st.element.style.opacity = "";
                            applyContainerVisibility(st);
                        }
                    }
                };
                requestAnimationFrame(fade);
            }
            emitSceneTransition({ id: transitionId, done: true, mode: "morph", u: 1 });
            return;
        }
        requestAnimationFrame(run);
    };
    requestAnimationFrame(run);
    return { ok: true, modeUsed: "morph", matchScore, transitionId };
}

/**
 * Load a named preset from disk (main process) and apply it.
 * @param {string} name
 */
async function loadAndApplyPreset(name) {
    if (!window.musicView?.loadPresetFile) {
        console.warn("loadPresetFile bridge missing");
        return { ok: false, error: "Preset bridge missing" };
    }
    const result = await window.musicView.loadPresetFile(name || "default");
    if (!result?.ok || !result.preset) {
        return result || { ok: false, error: "Failed to load preset" };
    }
    const applied = await applyLayoutPreset(result.preset, { name: result.name || name });
    return Object.assign({ ok: true, name: result.name || name }, applied);
}

let publishTimer = null;
function publishSceneState() {
    // Coalesce rapid updates (wander redraws)
    if (publishTimer) return;
    publishTimer = setTimeout(() => {
        publishTimer = null;
        const state = getSceneState();
        if (window.musicView && typeof window.musicView.publishState === 'function') {
            window.musicView.publishState(state);
        }
    }, 50);
}

const AUTHORING_COMMANDS = new Set([
    'updateContainer', 'applyContainerShader', 'clearContainerShader',
    'setContainerUniforms', 'setContainerModulators',
    'startPostprocess', 'stopPostprocess',
    'addPostprocessLayer', 'removePostprocessLayer', 'movePostprocessLayer',
    'reorderPostprocessLayers', 'setPostprocessLayerShader',
    'setPostprocessLayerUniforms', 'setPostprocessLayerModulators',
    'setPostprocessLayerEnabled', 'setPostprocessStack',
    'setPostprocessUniforms', 'setPostprocessShader',
    'startContainerPostprocess', 'stopContainerPostprocess',
    'addContainerPostprocessLayer', 'removeContainerPostprocessLayer',
    'moveContainerPostprocessLayer', 'reorderContainerPostprocessLayers',
    'setContainerPostprocessLayerShader', 'setContainerPostprocessLayerUniforms',
    'setContainerPostprocessLayerModulators', 'setContainerPostprocessLayerEnabled',
    'setContainerPostprocessStack',
    'updateBottomPanel',
    'updateBackground', 'applyBackgroundShader', 'clearBackgroundShader',
    'setBackgroundUniforms', 'setBackgroundModulators',
    'setBackgroundMedia', 'clearBackgroundMedia',
    'startBackgroundPostprocess', 'stopBackgroundPostprocess',
    'addBackgroundPostprocessLayer', 'removeBackgroundPostprocessLayer',
    'moveBackgroundPostprocessLayer', 'reorderBackgroundPostprocessLayers',
    'setBackgroundPostprocessLayerShader', 'setBackgroundPostprocessLayerUniforms',
    'setBackgroundPostprocessLayerModulators', 'setBackgroundPostprocessLayerEnabled',
    'setBackgroundPostprocessStack',
    'setArtef4ktSettings', 'loadArtef4ktPreset',
    'applyPreset', 'loadPreset',
    'addContainer', 'removeContainer', 'duplicateContainer',
    'setContainerVisible', 'setContainerRole',
]);

function maybeEmitSceneUserEdit(command) {
    if (!AUTHORING_COMMANDS.has(command)) return;
    if (window.musicView && typeof window.musicView.publishSceneUserEdit === 'function') {
        window.musicView.publishSceneUserEdit({ command, at: Date.now() });
    }
}

async function sceneCommand(command, payload) {
    try {
        const result = await sceneCommandDispatch(command, payload);
        if (result && result.ok) maybeEmitSceneUserEdit(command);
        return result;
    } catch (e) {
        console.warn('sceneCommand failed:', command, e);
        return { ok: false, error: String(e && e.message ? e.message : e) };
    }
}

async function sceneCommandDispatch(command, payload) {
    switch (command) {
            case 'getState': {
                const state = getSceneState();
                try {
                    state.shaders = await listShaders({
                        onProgress: (i, n) => {
                            const t = n > 0 ? i / n : 1;
                            reportLoad(64 + t * 22, `Shader catalog ${i} / ${n}`);
                        },
                    });
                } catch (e) {
                    state.shaders = [];
                }
                return { ok: true, state };
            }

            case 'listShaders': {
                const shaders = await listShaders();
                return { ok: true, shaders };
            }

            case 'selectContainer': {
                // UI-only selection sync (click-to-select / controls picker). Not in presets.
                if (payload?.id == null || payload.id === '') {
                    setSelectedContainerId(null);
                    return { ok: true, state: getSceneState() };
                }
                const found = findContainerById(payload.id);
                if (!found) return { ok: false, error: 'Container not found' };
                setSelectedContainerId(found.id);
                return { ok: true, state: getSceneState() };
            }

            case 'updateContainer': {
                const state = findContainerById(payload?.id);
                if (!state) return { ok: false, error: 'Container not found' };
                applyContainerUpdates(state, payload || {});
                if (scene.redraw) scene.redraw();
                else publishSceneState();
                return { ok: true, state: getSceneState() };
            }

            case 'listArtef4ktPresets': {
                let presets = [];
                if (typeof window.listArtef4ktPresets === 'function') {
                    presets = await window.listArtef4ktPresets();
                } else if (typeof window.Artef4ktHost?.listPresets === 'function') {
                    presets = await window.Artef4ktHost.listPresets();
                }
                return { ok: true, presets };
            }

            case 'getArtef4ktSettings': {
                const state = findContainerById(payload?.id);
                if (!state) return { ok: false, error: 'Container not found' };
                if (state.role !== 'artef4kt') return { ok: false, error: 'Not an artef4kt container' };
                if (!state.artef4ktHost) {
                    await mountArtef4ktOnContainer(state);
                }
                const settings = cacheArtef4ktSettings(state)
                    || state.embed?.settings
                    || null;
                let presets = [];
                try {
                    if (typeof window.listArtef4ktPresets === 'function') {
                        presets = await window.listArtef4ktPresets();
                    }
                } catch (_) { /* ignore */ }
                return {
                    ok: true,
                    settings,
                    settingsId: state.embed?.settingsId || 'default',
                    quality: state.embed?.quality || 'auto',
                    presets,
                    state: getSceneState(),
                };
            }

            case 'setArtef4ktSettings': {
                const state = findContainerById(payload?.id);
                if (!state) return { ok: false, error: 'Container not found' };
                if (!state.artef4ktHost) {
                    await mountArtef4ktOnContainer(state);
                }
                // Prefer explicit patch (partial merge). Full `settings` replaces.
                const hasPatch = payload?.patch && typeof payload.patch === 'object';
                const data = hasPatch ? payload.patch : (payload?.settings || null);
                const usePartial = hasPatch || payload?.partial === true;
                const result = applyArtef4ktSettingsToContainer(state, data, { partial: usePartial });
                if (!result.ok) return result;
                if (payload?.settingsId != null) {
                    if (!state.embed) state.embed = { engine: 'artef4kt' };
                    state.embed.settingsId = String(payload.settingsId);
                } else if (hasPatch && state.embed) {
                    // Live knob tweak — clear named preset id only if caller asks
                    if (payload?.clearSettingsId) state.embed.settingsId = null;
                }
                if (payload?.quality != null) {
                    if (!state.embed) state.embed = { engine: 'artef4kt' };
                    state.embed.quality = String(payload.quality);
                }
                // Soft-update only — avoid full Controls form rebuild on every knob tick
                return {
                    ok: true,
                    settings: result.settings,
                    settingsId: state.embed?.settingsId || null,
                    state: getSceneState(),
                };
            }

            case 'loadArtef4ktPreset': {
                const state = findContainerById(payload?.id);
                if (!state) return { ok: false, error: 'Container not found' };
                const result = await loadArtef4ktPresetOnContainer(state, payload?.settingsId || payload?.presetId);
                if (!result.ok) return result;
                publishSceneState();
                return {
                    ok: true,
                    settingsId: result.settingsId,
                    settings: result.settings,
                    state: getSceneState(),
                };
            }

            case 'applyContainerShader': {
                const state = findContainerById(payload?.id);
                if (!state) return { ok: false, error: 'Container not found' };
                const idOrPath = payload?.shaderId || payload?.shaderPath;
                if (!idOrPath) return { ok: false, error: 'shaderId required' };
                await applyShaderPackageToState(state, idOrPath, payload?.uniforms || null);
                publishSceneState();
                return { ok: true, state: getSceneState() };
            }

            case 'clearContainerShader': {
                const state = findContainerById(payload?.id);
                if (!state) return { ok: false, error: 'Container not found' };
                clearShader(state);
                publishSceneState();
                return { ok: true, state: getSceneState() };
            }

            case 'setContainerUniforms': {
                const state = findContainerById(payload?.id);
                if (!state) return { ok: false, error: 'Container not found' };
                updateContainerUniforms(state, payload?.uniforms || {});
                publishSceneState();
                return { ok: true, state: getSceneState() };
            }

            case 'setContainerModulators': {
                const state = findContainerById(payload?.id);
                if (!state) return { ok: false, error: 'Container not found' };
                if (!payload || !('modulators' in payload)) {
                    return { ok: false, error: 'modulators required (use null to clear all)' };
                }
                // Partial field merge; null modulators clears all; null entry clears one key
                updateContainerModulators(state, payload.modulators);
                publishSceneState();
                return { ok: true, state: getSceneState() };
            }

            // ── Per-container postprocess stack ─────────────────────────
            case 'startContainerPostprocess': {
                const state = findContainerById(payload?.id ?? payload?.containerId);
                if (!state) return { ok: false, error: 'Container not found' };
                if (!state.postprocess?.layers?.length && (payload?.shaderId || payload?.shaderPath)) {
                    await addContainerPostprocessLayer(
                        state,
                        payload.shaderId || payload.shaderPath,
                        { uniforms: payload?.uniforms, enabled: true },
                    );
                }
                startContainerPostprocess(state);
                publishSceneState();
                return { ok: true, state: getSceneState() };
            }

            case 'stopContainerPostprocess': {
                const state = findContainerById(payload?.id ?? payload?.containerId);
                if (!state) return { ok: false, error: 'Container not found' };
                stopContainerPostprocess(state);
                publishSceneState();
                return { ok: true, state: getSceneState() };
            }

            case 'addContainerPostprocessLayer': {
                const state = findContainerById(payload?.id ?? payload?.containerId);
                if (!state) return { ok: false, error: 'Container not found' };
                const idOrPath = payload?.shaderId || payload?.shaderPath || 'lcd';
                const layer = await addContainerPostprocessLayer(state, idOrPath, {
                    uniforms: payload?.uniforms,
                    modulators: payload?.modulators,
                    enabled: payload?.enabled !== false,
                    index: payload?.index,
                });
                // Auto-enable stack when first layer is added
                if (state.postprocess && !state.postprocess.active) {
                    startContainerPostprocess(state);
                } else if (state.postprocess?.active) {
                    startContainerPostprocess(state);
                }
                publishSceneState();
                return { ok: true, layerId: layer.id, state: getSceneState() };
            }

            case 'removeContainerPostprocessLayer': {
                const state = findContainerById(payload?.id ?? payload?.containerId);
                if (!state) return { ok: false, error: 'Container not found' };
                if (payload?.layerId == null && payload?.layer_id == null) {
                    return { ok: false, error: 'layerId required' };
                }
                const layerId = payload.layerId != null ? payload.layerId : payload.layer_id;
                await removeContainerPostprocessLayer(state, layerId);
                publishSceneState();
                return { ok: true, state: getSceneState() };
            }

            case 'reorderContainerPostprocessLayers': {
                const state = findContainerById(payload?.id ?? payload?.containerId);
                if (!state) return { ok: false, error: 'Container not found' };
                await reorderContainerPostprocessLayers(
                    state,
                    payload?.ids || payload?.orderedIds || [],
                );
                publishSceneState();
                return { ok: true, state: getSceneState() };
            }

            case 'moveContainerPostprocessLayer': {
                const state = findContainerById(payload?.id ?? payload?.containerId);
                if (!state) return { ok: false, error: 'Container not found' };
                if (payload?.layerId == null) return { ok: false, error: 'layerId required' };
                await moveContainerPostprocessLayer(
                    state,
                    payload.layerId,
                    payload?.toIndex ?? payload?.index ?? 0,
                );
                publishSceneState();
                return { ok: true, state: getSceneState() };
            }

            case 'setContainerPostprocessLayerShader': {
                const state = findContainerById(payload?.id ?? payload?.containerId);
                if (!state) return { ok: false, error: 'Container not found' };
                if (payload?.layerId == null) return { ok: false, error: 'layerId required' };
                const idOrPath = payload?.shaderId || payload?.shaderPath;
                if (!idOrPath) return { ok: false, error: 'shaderId required' };
                await setContainerPostprocessLayerShader(
                    state,
                    payload.layerId,
                    idOrPath,
                    payload?.uniforms,
                );
                publishSceneState();
                return { ok: true, state: getSceneState() };
            }

            case 'setContainerPostprocessLayerUniforms': {
                const state = findContainerById(payload?.id ?? payload?.containerId);
                if (!state) return { ok: false, error: 'Container not found' };
                if (payload?.layerId == null) return { ok: false, error: 'layerId required' };
                updateContainerPostprocessLayerUniforms(
                    state,
                    payload.layerId,
                    payload?.uniforms || {},
                );
                publishSceneState();
                return { ok: true, state: getSceneState() };
            }

            case 'setContainerPostprocessLayerModulators': {
                const state = findContainerById(payload?.id ?? payload?.containerId);
                if (!state) return { ok: false, error: 'Container not found' };
                if (payload?.layerId == null) return { ok: false, error: 'layerId required' };
                if (!payload || !('modulators' in payload)) {
                    return { ok: false, error: 'modulators required (use null to clear all)' };
                }
                updateContainerPostprocessLayerModulators(
                    state,
                    payload.layerId,
                    payload.modulators,
                );
                publishSceneState();
                return { ok: true, state: getSceneState() };
            }

            case 'setContainerPostprocessLayerEnabled': {
                const state = findContainerById(payload?.id ?? payload?.containerId);
                if (!state) return { ok: false, error: 'Container not found' };
                if (payload?.layerId == null) return { ok: false, error: 'layerId required' };
                setContainerPostprocessLayerEnabled(
                    state,
                    payload.layerId,
                    payload?.enabled !== false,
                );
                publishSceneState();
                return { ok: true, state: getSceneState() };
            }

            case 'setContainerPostprocessStack': {
                const state = findContainerById(payload?.id ?? payload?.containerId);
                if (!state) return { ok: false, error: 'Container not found' };
                const rawLayers = Array.isArray(payload?.layers) ? payload.layers : [];
                await setContainerPostprocessStack(
                    state,
                    rawLayers.map((l) => ({
                        shaderId: l.shaderId || l.shaderPath,
                        uniforms: l.uniforms,
                        modulators: sanitizeModulatorsMap(l.modulators),
                        enabled: l.enabled,
                        id: l.id,
                    })),
                    { active: payload?.active },
                );
                publishSceneState();
                return { ok: true, state: getSceneState() };
            }

            case 'setPostprocessUniforms': {
                // Legacy: first layer, or payload.layerId
                if (payload?.layerId != null) {
                    updatePostprocessLayerUniforms(payload.layerId, payload?.uniforms || {});
                } else {
                    updatePostprocessUniforms(payload?.uniforms || {});
                }
                publishSceneState();
                return { ok: true, state: getSceneState() };
            }

            case 'setPostprocessShader': {
                // Legacy: replace entire stack with one layer
                const idOrPath = payload?.shaderId || payload?.shaderPath || 'lcd';
                await applyPostprocessPackage(idOrPath, payload?.uniforms || null);
                publishSceneState();
                return { ok: true, state: getSceneState() };
            }

            case 'stopPostprocess': {
                stopPostprocess();
                publishSceneState();
                return { ok: true, state: getSceneState() };
            }

            case 'startPostprocess': {
                if (!postprocessState.canvas) {
                    const el = document.getElementById('postprocess-canvas');
                    if (el) postprocessState.canvas = el;
                }
                // If stack empty and a shader is provided, seed one layer
                if (!postprocessState.layers.length) {
                    const idOrPath = payload?.shaderId || payload?.shaderPath || 'lcd';
                    await applyPostprocessPackage(idOrPath, payload?.uniforms || null);
                } else {
                    startPostprocessStack();
                }
                publishSceneState();
                return { ok: true, state: getSceneState() };
            }

            case 'addPostprocessLayer': {
                if (!postprocessState.canvas) {
                    const el = document.getElementById('postprocess-canvas');
                    if (el) postprocessState.canvas = el;
                }
                const idOrPath = payload?.shaderId || payload?.shaderPath || 'lcd';
                const layer = await addPostprocessLayer(idOrPath, {
                    uniforms: payload?.uniforms,
                    enabled: payload?.enabled !== false,
                    index: payload?.index,
                });
                if (postprocessState.active) startPostprocessStack();
                publishSceneState();
                return { ok: true, layerId: layer.id, state: getSceneState() };
            }

            case 'removePostprocessLayer': {
                if (payload?.id == null) return { ok: false, error: 'id required' };
                await removePostprocessLayer(payload.id);
                publishSceneState();
                return { ok: true, state: getSceneState() };
            }

            case 'reorderPostprocessLayers': {
                await reorderPostprocessLayers(payload?.ids || payload?.orderedIds || []);
                publishSceneState();
                return { ok: true, state: getSceneState() };
            }

            case 'movePostprocessLayer': {
                if (payload?.id == null) return { ok: false, error: 'id required' };
                await movePostprocessLayer(payload.id, payload?.toIndex ?? payload?.index ?? 0);
                publishSceneState();
                return { ok: true, state: getSceneState() };
            }

            case 'setPostprocessLayerShader': {
                if (payload?.id == null) return { ok: false, error: 'id required' };
                const idOrPath = payload?.shaderId || payload?.shaderPath;
                if (!idOrPath) return { ok: false, error: 'shaderId required' };
                await setPostprocessLayerShader(payload.id, idOrPath, payload?.uniforms);
                publishSceneState();
                return { ok: true, state: getSceneState() };
            }

            case 'setPostprocessLayerUniforms': {
                if (payload?.id == null) return { ok: false, error: 'id required' };
                updatePostprocessLayerUniforms(payload.id, payload?.uniforms || {});
                publishSceneState();
                return { ok: true, state: getSceneState() };
            }

            case 'setPostprocessLayerModulators': {
                if (payload?.id == null) return { ok: false, error: 'id required' };
                if (!payload || !('modulators' in payload)) {
                    return { ok: false, error: 'modulators required (use null to clear all)' };
                }
                // Partial field merge; null modulators clears all; null entry clears one key
                updatePostprocessLayerModulators(payload.id, payload.modulators);
                publishSceneState();
                return { ok: true, state: getSceneState() };
            }

            case 'setPostprocessLayerEnabled': {
                if (payload?.id == null) return { ok: false, error: 'id required' };
                setPostprocessLayerEnabled(payload.id, payload?.enabled !== false);
                publishSceneState();
                return { ok: true, state: getSceneState() };
            }

            case 'setPostprocessStack': {
                const rawLayers = Array.isArray(payload?.layers) ? payload.layers : [];
                await setPostprocessStack(
                    rawLayers.map((l) => ({
                        shaderId: l.shaderId || l.shaderPath,
                        uniforms: l.uniforms,
                        modulators: sanitizeModulatorsMap(l.modulators),
                        enabled: l.enabled,
                        id: l.id,
                        _showFx: !!l._showFx,
                    })),
                    { active: payload?.active },
                );
                publishSceneState();
                return { ok: true, state: getSceneState() };
            }

            case 'updateBottomPanel': {
                updateBottomPanel(payload || {});
                return { ok: true, state: getSceneState() };
            }

            case 'updateBackground': {
                updateBackgroundSettings(payload || {});
                publishSceneState();
                return { ok: true, state: getSceneState() };
            }

            case 'applyBackgroundShader': {
                const idOrPath = payload?.shaderId || payload?.shaderPath;
                if (!idOrPath) return { ok: false, error: 'shaderId required' };
                ensureBackgroundState().mode = 'shader';
                await applyBackgroundShader(idOrPath, payload?.uniforms || null);
                if (payload?.modulators) updateBackgroundModulators(payload.modulators);
                syncBackgroundSourcePlayback();
                publishSceneState();
                return { ok: true, state: getSceneState() };
            }

            case 'clearBackgroundShader': {
                clearBackgroundShader();
                if (ensureBackgroundState().mode === 'shader') {
                    ensureBackgroundState().mode = 'solid';
                }
                syncBackgroundSourcePlayback();
                publishSceneState();
                return { ok: true, state: getSceneState() };
            }

            case 'setBackgroundUniforms': {
                updateBackgroundUniforms(payload?.uniforms || {});
                publishSceneState();
                return { ok: true, state: getSceneState() };
            }

            case 'setBackgroundModulators': {
                if (!payload || !('modulators' in payload)) {
                    return { ok: false, error: 'modulators required (use null to clear all)' };
                }
                updateBackgroundModulators(payload.modulators);
                publishSceneState();
                return { ok: true, state: getSceneState() };
            }

            case 'setBackgroundMedia': {
                const kind = payload?.kind === 'video' ? 'video' : 'image';
                const src = payload?.src || payload?.url
                    || (payload?.path ? localMediaUrl(payload.path) : null);
                if (!src) return { ok: false, error: 'src or path required' };
                const bg = ensureBackgroundState();
                bg.mediaError = null;
                if (kind === 'video') {
                    bg.videoSrc = src;
                    bg.videoPath = payload?.path || bg.videoPath;
                    bg.videoName = payload?.name || bg.videoName;
                    bg.mode = 'video';
                    if (payload?.videoMode) {
                        const fit = normalizeBgFit(payload.videoMode, bg.videoMode);
                        bg.videoMode = fit === 'tile' ? 'fill' : fit;
                    }
                    if ('videoLoop' in (payload || {})) bg.videoLoop = payload.videoLoop !== false;
                    await loadBackgroundVideo(src);
                } else {
                    bg.imageSrc = src;
                    bg.imagePath = payload?.path || bg.imagePath;
                    bg.imageName = payload?.name || bg.imageName;
                    bg.mode = 'image';
                    if (payload?.imageMode) bg.imageMode = normalizeBgFit(payload.imageMode, bg.imageMode);
                    await loadBackgroundImage(src);
                }
                syncBackgroundSourcePlayback();
                publishSceneState();
                return { ok: true, state: getSceneState() };
            }

            case 'clearBackgroundMedia': {
                const kind = payload?.kind;
                if (kind === 'video' || kind === 'all' || kind == null) {
                    clearBackgroundVideo();
                    if (ensureBackgroundState().mode === 'video') {
                        ensureBackgroundState().mode = 'solid';
                    }
                }
                if (kind === 'image' || kind === 'all' || kind == null) {
                    clearBackgroundImage();
                    if (ensureBackgroundState().mode === 'image') {
                        ensureBackgroundState().mode = 'solid';
                    }
                }
                syncBackgroundSourcePlayback();
                publishSceneState();
                return { ok: true, state: getSceneState() };
            }

            case 'startBackgroundPostprocess': {
                if (!ensureBackgroundState().postprocess.layers.length
                    && (payload?.shaderId || payload?.shaderPath)) {
                    await addBackgroundPostprocessLayer(
                        payload.shaderId || payload.shaderPath,
                        { uniforms: payload?.uniforms, enabled: true },
                    );
                }
                startBackgroundPostprocess();
                publishSceneState();
                return { ok: true, state: getSceneState() };
            }

            case 'stopBackgroundPostprocess': {
                stopBackgroundPostprocess();
                publishSceneState();
                return { ok: true, state: getSceneState() };
            }

            case 'addBackgroundPostprocessLayer': {
                const idOrPath = payload?.shaderId || payload?.shaderPath || 'lcd';
                const layer = await addBackgroundPostprocessLayer(idOrPath, {
                    uniforms: payload?.uniforms,
                    modulators: payload?.modulators,
                    enabled: payload?.enabled !== false,
                    index: payload?.index,
                });
                const bg = ensureBackgroundState();
                if (!bg.postprocess.active) startBackgroundPostprocess();
                else startBackgroundPostprocess();
                publishSceneState();
                return { ok: true, layerId: layer.id, state: getSceneState() };
            }

            case 'removeBackgroundPostprocessLayer': {
                if (payload?.id == null && payload?.layerId == null) {
                    return { ok: false, error: 'id required' };
                }
                await removeBackgroundPostprocessLayer(payload.layerId ?? payload.id);
                publishSceneState();
                return { ok: true, state: getSceneState() };
            }

            case 'reorderBackgroundPostprocessLayers': {
                await reorderBackgroundPostprocessLayers(payload?.ids || payload?.orderedIds || []);
                publishSceneState();
                return { ok: true, state: getSceneState() };
            }

            case 'moveBackgroundPostprocessLayer': {
                if (payload?.id == null && payload?.layerId == null) {
                    return { ok: false, error: 'id required' };
                }
                await moveBackgroundPostprocessLayer(
                    payload.layerId ?? payload.id,
                    payload?.toIndex ?? payload?.index ?? 0,
                );
                publishSceneState();
                return { ok: true, state: getSceneState() };
            }

            case 'setBackgroundPostprocessLayerShader': {
                if (payload?.id == null && payload?.layerId == null) {
                    return { ok: false, error: 'id required' };
                }
                const idOrPath = payload?.shaderId || payload?.shaderPath;
                if (!idOrPath) return { ok: false, error: 'shaderId required' };
                await setBackgroundPostprocessLayerShader(
                    payload.layerId ?? payload.id,
                    idOrPath,
                    payload?.uniforms,
                );
                publishSceneState();
                return { ok: true, state: getSceneState() };
            }

            case 'setBackgroundPostprocessLayerUniforms': {
                if (payload?.id == null && payload?.layerId == null) {
                    return { ok: false, error: 'id required' };
                }
                updateBackgroundPostprocessLayerUniforms(
                    payload.layerId ?? payload.id,
                    payload?.uniforms || {},
                );
                publishSceneState();
                return { ok: true, state: getSceneState() };
            }

            case 'setBackgroundPostprocessLayerModulators': {
                if (payload?.id == null && payload?.layerId == null) {
                    return { ok: false, error: 'id required' };
                }
                if (!payload || !('modulators' in payload)) {
                    return { ok: false, error: 'modulators required (use null to clear all)' };
                }
                updateBackgroundPostprocessLayerModulators(
                    payload.layerId ?? payload.id,
                    payload.modulators,
                );
                publishSceneState();
                return { ok: true, state: getSceneState() };
            }

            case 'setBackgroundPostprocessLayerEnabled': {
                if (payload?.id == null && payload?.layerId == null) {
                    return { ok: false, error: 'id required' };
                }
                setBackgroundPostprocessLayerEnabled(
                    payload.layerId ?? payload.id,
                    payload?.enabled !== false,
                );
                publishSceneState();
                return { ok: true, state: getSceneState() };
            }

            case 'setBackgroundPostprocessStack': {
                const rawLayers = Array.isArray(payload?.layers) ? payload.layers : [];
                await setBackgroundPostprocessStack(
                    rawLayers.map((l) => ({
                        shaderId: l.shaderId || l.shaderPath,
                        uniforms: l.uniforms,
                        modulators: sanitizeModulatorsMap(l.modulators),
                        enabled: l.enabled,
                        id: l.id,
                    })),
                    { active: payload?.active },
                );
                publishSceneState();
                return { ok: true, state: getSceneState() };
            }

            case 'exportPreset': {
                const name = payload?.name || scene.activePreset || 'Preset';
                const preset = exportScenePreset(name);
                return { ok: true, preset };
            }

            case 'applyPreset': {
                if (!payload?.preset && !payload?.scene) {
                    return { ok: false, error: 'preset required' };
                }
                const preset = payload.preset || { scene: payload.scene, name: payload.name };
                const applied = await applyLayoutPreset(preset, { name: payload?.name || preset.name });
                publishSceneState();
                return Object.assign({ ok: true, activePreset: scene.activePreset }, applied);
            }

            case 'loadPreset': {
                const name = payload?.name || 'default';
                const result = await loadAndApplyPreset(name);
                publishSceneState();
                return result;
            }

            case 'exportSceneSnapshot': {
                const preset = exportPerformanceSnapshot(payload?.name || 'Snapshot');
                return { ok: true, preset };
            }

            case 'resolveSnapshotGeometry': {
                const sceneOut = resolveSnapshotGeometryScene(payload?.scene);
                return { ok: true, scene: sceneOut };
            }

            case 'applySceneSnapshot': {
                let prune = payload?.pruneExtra;
                if (prune !== 'generics' && prune !== false) prune = payload?.pruneExtra !== false;
                const applied = await applySceneSnapshot(payload?.scene || payload, {
                    spawnMissing: payload?.spawnMissing !== false,
                    pruneExtra: prune,
                    name: payload?.name,
                });
                publishSceneState();
                return Object.assign({ ok: true }, applied);
            }

            case 'applySceneTransition': {
                const result = await applySceneTransition(payload || {});
                return result;
            }

            case 'setSceneTransitionPaused': {
                if (sceneTransition) sceneTransition.paused = !!payload?.paused;
                return { ok: true };
            }

            case 'awaitDisplayPrime': {
                if (scene._coverReady) await scene._coverReady;
                return { ok: true };
            }

            case 'finishSceneTransition': {
                const active = sceneTransition;
                const incoming = active && active.incoming;
                const id = active && active.id;
                finishBackgroundTransition(active && active.bgJob);
                sceneTransition = null;
                const overlay = document.getElementById('scene-transition-overlay');
                if (overlay) overlay.style.opacity = '0';
                if (payload?.applyIncoming !== false && incoming) {
                    await applySceneSnapshot(incoming, { spawnMissing: true, pruneExtra: true });
                } else {
                    await flushNowPlaying();
                }
                if (id) emitSceneTransition({ id, done: true, mode: active?.mode || 'cut', u: 1, flushed: true });
                return { ok: true };
            }

            case 'addContainer': {
                const result = await commandAddContainer(payload || {});
                if (result.ok) publishSceneState();
                return result;
            }
            case 'removeContainer': {
                const result = commandRemoveContainer(payload || {});
                if (result.ok) publishSceneState();
                return result;
            }
            case 'duplicateContainer': {
                const result = await commandDuplicateContainer(payload || {});
                if (result.ok) publishSceneState();
                return result;
            }
            case 'setContainerVisible': {
                const state = findContainerById(payload?.id);
                if (!state) return { ok: false, error: 'Container not found' };
                state.visible = payload?.visible !== false;
                applyContainerVisibility(state);
                if (scene.redraw) scene.redraw();
                else publishSceneState();
                return { ok: true, state: getSceneState() };
            }
            case 'setContainerRole': {
                const result = await commandSetContainerRole(payload || {});
                if (result.ok) publishSceneState();
                return result;
            }

            default:
                return { ok: false, error: 'Unknown command: ' + command };
        }
}

function applyContainerUpdates(state, updates) {
    if (!state || !updates) return;

    if ("role" in updates) {
        // Role changes must go through setContainerRole / setupRoleChrome
        delete updates.role;
    }

    if ("visible" in updates) {
        state.visible = updates.visible !== false;
        applyContainerVisibility(state);
    }

    let wanderDirty = false;

    if ('text' in updates) {
        state.text = String(updates.text ?? '');
        if (state.textEl) {
            state.textEl.textContent = state.text;
        } else {
            const el = state.element.querySelector('.floating-text');
            if (el) {
                state.textEl = el;
                el.textContent = state.text;
            }
        }
    }

    if ('label' in updates) {
        // External canvas label (not DOM)
        state.label = String(updates.label ?? '');
    }

    if ('labelEnabled' in updates) {
        state.labelEnabled = updates.labelEnabled !== false && updates.labelEnabled !== 'false';
    }

    if ('labelCorner' in updates) {
        state.labelCorner = normalizeLabelCorner(updates.labelCorner);
    }

    if (updates.labelStyle && typeof updates.labelStyle === 'object') {
        state.style.label = defaultLabelStyle(
            Object.assign({}, state.style?.label || {}, updates.labelStyle),
        );
    }

    if (updates.style?.text && typeof updates.style.text === 'object') {
        state.style.text = defaultTextStyle(
            Object.assign({}, state.style?.text || state.style?.label || {}, updates.style.text),
        );
        // Text metrics affect lyrics wrap + vertical center
        if (state.role === "song-lyrics" || state.lyricsViewport) {
            applyContainerBoxStyle(state);
        }
    }

    if ('left' in updates || 'top' in updates || 'width' in updates || 'height' in updates) {
        // Controls / snapshots publish design-space geometry (1080×1920).
        if (!state.layoutDesign) syncDesignFromLive(state);
        const d = state.layoutDesign || { left: 0, top: 0, width: 100, height: 100 };
        if ('left' in updates && Number.isFinite(Number(updates.left))) d.left = Number(updates.left);
        if ('top' in updates && Number.isFinite(Number(updates.top))) d.top = Number(updates.top);
        if ('width' in updates && Number.isFinite(Number(updates.width))) {
            d.width = Math.max(1, Number(updates.width));
        }
        if ('height' in updates && Number.isFinite(Number(updates.height))) {
            d.height = Math.max(1, Number(updates.height));
        }
        state.layoutDesign = d;
        applyLiveFromDesign(state);
        pinContainerLayout(state);
    }

    if ('layer' in updates) {
        state.layer = Number(updates.layer) || 0;
        state.element.style.zIndex = `${2 + state.layer}`;
    }

    if ('distancing' in updates) {
        state.distancing = Number(updates.distancing) || 0;
    }

    if ('connect' in updates) {
        state.connect = !!updates.connect;
    }

    if ('anchorDistance' in updates) {
        const v = updates.anchorDistance;
        state.anchorDistance = (v === null || v === false || v === '') ? false : Number(v);
    }

    if ('attachToId' in updates) {
        if (updates.attachToId === null || updates.attachToId === '' || updates.attachToId === undefined) {
            state.attachTo = null;
        } else {
            const other = findContainerById(updates.attachToId);
            state.attachTo = other ? other.element : null;
        }
    }

    if ('contentFade' in updates) {
        state.contentFade = normalizeContentFadeSec(updates.contentFade);
    }

    if ('textGlitch' in updates) {
        state.textGlitch = normalizeTextGlitchSec(updates.textGlitch);
    }

    if ('audioInput' in updates) {
        const prevSrc = state.audioInput && state.audioInput.source;
        const api = audioInputApi();
        state.audioInput = api
            ? api.sanitizeAudioInput(updates.audioInput, state.role)
            : (updates.audioInput && typeof updates.audioInput === 'object' ? updates.audioInput : null);
        if (state._audioRt && state.audioInput && state.audioInput.source !== prevSrc) {
            state._audioRt.history.fill(0);
            state._audioRt.histWrite = 0;
            state._audioRt.histCount = 0;
        }
    }

    if ('wanderAmplitude' in updates) {
        state.wanderAmplitude = Number(updates.wanderAmplitude);
        wanderDirty = true;
    }

    if ('wanderFrequency' in updates) {
        state.wanderFrequency = Number(updates.wanderFrequency);
        wanderDirty = true;
    }

    if ('wander' in updates) {
        // Explicit boolean — do not use truthiness on missing fields
        state.wander = updates.wander === true || updates.wander === 1 || updates.wander === 'true';
        wanderDirty = true;
    }

    // Apply timer once from the final flags (avoids restart-then-stop races)
    if (wanderDirty) {
        syncWanderTimer(state);
    }

    if (updates.style) {
        if (updates.style.border) {
            state.style.border = Object.assign({}, state.style.border, updates.style.border);
        }
        if (updates.style.connect) {
            state.style.connect = Object.assign({}, state.style.connect, updates.style.connect);
        }
        if (updates.style.label) {
            state.style.label = defaultLabelStyle(
                Object.assign({}, state.style.label || {}, updates.style.label),
            );
        }
        if (updates.style.text) {
            state.style.text = defaultTextStyle(
                Object.assign({}, state.style.text || state.style.label || {}, updates.style.text),
            );
        }
        let boxStyleDirty = false;
        if ("textAlign" in updates.style) {
            state.style.textAlign = normalizeTextAlign(updates.style.textAlign);
            boxStyleDirty = true;
        }
        if ("padding" in updates.style) {
            state.style.padding = normalizeBoxPadding(updates.style.padding);
            boxStyleDirty = true;
        }
        if (updates.style.text) {
            boxStyleDirty = true;
        }
        if (boxStyleDirty) {
            applyContainerBoxStyle(state);
            if (state.role === "song-info") {
                fitSongInfoPanel(state);
            }
            if (state.role === "song-lyrics" || state.lyricsViewport) {
                recenterLyrics(state, false);
            }
        }
    }

    if (updates.imageMode) {
        state.imageMode = updates.imageMode;
        if (state.image && state.innerCtx) drawContainerImage(state);
    }

    if ('progressTimeMode' in updates && isProgressRole(state.role)) {
        applyProgressTimeMode(state, updates.progressTimeMode);
    }
}

function musicViewApi() {
    return window.__musicViewIpc || window.musicView;
}

function installSceneBridge() {
    // Kept for debugging in DevTools
    window.__sceneGetState = getSceneState;
    window.__sceneCommand = sceneCommand;
    window.__applyNowPlaying = applyNowPlaying;

    const musicView = musicViewApi();
    if (!musicView) {
        console.warn('musicView bridge missing — control panel commands will not work');
        return;
    }

    // Page receives commands and explicitly replies (do not return values
    // through contextBridge function proxies — they can drop Promise results).
    if (typeof musicView.onDisplayCommand === 'function') {
        musicView.onDisplayCommand(async (msg) => {
            const requestId = msg && msg.requestId;
            if (!requestId) return;
            try {
                const result = await sceneCommand(msg.command, msg.payload);
                musicView.replyCommand(requestId, result || { ok: false, error: 'No result' });
            } catch (e) {
                console.warn('display command error', msg && msg.command, e);
                musicView.replyCommand(requestId, {
                    ok: false,
                    error: String(e && e.message ? e.message : e),
                });
            }
        });
    } else {
        console.warn('musicView.onDisplayCommand missing');
    }

    // Now-playing from music window → song cover + info panels
    if (typeof musicView.onNowPlaying === 'function') {
        musicView.onNowPlaying((info) => {
            scene.lastNowPlaying = info;
            if (deferNowPlaying()) {
                scene._pendingNowPlaying = info;
                primeContentTransitions(info);
                return;
            }
            applyNowPlaying(info);
        });
    }

    // Live lyric focus from music playback
    if (typeof musicView.onLyricFocus === 'function') {
        musicView.onLyricFocus((focus) => {
            scene.lastLyricFocus = focus || null;
            const lyrics = scene.songPanels.lyrics;
            if (lyrics && lyrics._lyricsDecode) {
                retargetLyricsDecode(lyrics, focus);
                return;
            }
            if (deferNowPlaying()) return;
            applyLyricFocus(focus);
        });
    }

    // Empty-lyrics glitch FX params from Music window
    if (typeof musicView.onEmptyLyricsFx === 'function') {
        musicView.onEmptyLyricsFx((settings) => {
            applyEmptyLyricsFxSettings(settings);
        });
    }

    // Live song progress → progress bar container canvas
    if (typeof musicView.onPlaybackProgress === 'function') {
        musicView.onPlaybackProgress((payload) => {
            applyPlaybackProgress(payload);
        });
    }

    if (typeof musicView.onShowState === 'function') {
        musicView.onShowState((payload) => {
            applyShowProgress(payload || {});
        });
    }

    // Live audio analysis → scope / history / beat shaders
    if (typeof musicView.onAudioFrame === 'function') {
        musicView.onAudioFrame((frame) => {
            applyAudioFrame(frame);
        });
    }

    if (typeof musicView.notifyDisplayReady === 'function') {
        musicView.notifyDisplayReady();
    }
}

function markDisplayReady() {
    window.__musicViewDisplayReady = true;
    try {
        window.dispatchEvent(new Event('music-view-display-ready'));
    } catch (e) { /* ignore */ }
}

if (!window.containerAPI) window.containerAPI = {};
window.containerAPI.loadShaderSource = loadShaderSource;
window.containerAPI.loadShaderPackage = loadShaderPackage;
window.containerAPI.listShaders = listShaders;
window.containerAPI.applyShaderToState = applyShaderToState;
window.containerAPI.applyShaderPackageToState = applyShaderPackageToState;
window.containerAPI.clearShader = clearShader;
window.containerAPI.updateContainerUniforms = updateContainerUniforms;
window.containerAPI.getSceneState = getSceneState;
window.containerAPI.sceneCommand = sceneCommand;
window.containerAPI.getOutputCanvas = () => document.getElementById("postprocess-canvas");
