(function (root) {
const $ = (id) => {
    const scope = root.document.getElementById('dock-controls') || root.document;
    return scope.querySelector('#' + id);
};
function qsAll(sel) {
    const scope = root.document.getElementById('dock-controls') || root.document;
    return scope.querySelectorAll(sel);
}

/* Control panel UI — talks to the display window via window.musicView IPC.
 * Shader uniform widgets are generated from each package's controls.json.
 */

let sceneState = {
    containers: [],
    postprocess: { active: false, layers: [], shaderId: null, shaderPath: null, uniforms: {}, shaderMeta: null },
    bottomPanel: { color: '#2563eb', heightRatio: 0.25, includeInFloatArea: false },
    background: {
        mode: 'solid',
        color: '#ffffff',
        postprocess: { active: false, layers: [] },
    },
    shaders: [],
    activePreset: null,
};

let selectedId = null;
/** Selected postprocess layer id */
let selectedPpLayerId = null;
/** Selected per-container postprocess layer id */
let selectedCppLayerId = null;
/** Selected background postprocess layer id */
let selectedBppLayerId = null;
/** Cached preset list from disk */
let presetList = [];
/** Filtered view for browser list */
let presetFiltered = [];
/** Category filter: all | favorites | looks | recipes | classic | saved */
let presetCategory = 'all';
/** Type filter: all | fx | layout */
let presetTypeFilter = 'all';
/** Sort: category | name | recent | used | favorites */
let presetSort = 'category';
/** Starred preset names (localStorage) */
let presetFavorites = new Set();
/** Recently loaded preset names, newest first (localStorage) */
let presetRecentUsed = [];
/** Debounce timer for Instant load while arrow-navigating */
let presetInstantTimer = null;
const PRESET_CAT_KEY = 'music_view_preset_cat';
const PRESET_SORT_KEY = 'music_view_preset_sort';
const PRESET_TYPE_KEY = 'music_view_preset_type';
const PRESET_INSTANT_KEY = 'music_view_preset_instant';
const PRESET_FAV_KEY = 'music_view_preset_favorites';
const PRESET_USED_KEY = 'music_view_preset_recent_used';
const PRESET_CAT_LABELS = {
    classic: 'Classic',
    looks: 'Looks',
    recipes: 'Recipes',
    saved: 'Saved',
    favorites: 'Favorites',
};
/** Active controls tab: 'look' | 'object' */
let activeTab = 'look';
const TAB_STORAGE_KEY = 'music_view_controls_tab';
/** Object pane segment: transform | style | motion | shader | artef4kt | fx */
let activeObjectSegment = 'transform';
const OBJ_SEG_STORAGE_KEY = 'music_view_controls_obj_seg';
/** Cached ARTEF4KT engine settings for the selected container */
let artef4ktSettings = null;
let artef4ktSettingsId = null;
let artef4ktPresetList = [];
let artef4ktLoading = false;
/** Accumulated engine patch so concurrent slider moves don't race / clobber */
let artef4ktPendingPatch = null;
/** Show uniforms marked advanced: true in controls.json */
let showAdvancedUniforms = false;
const ADV_UNIFORMS_KEY = 'music_view_controls_adv_uniforms';
/** Collapsed uniform groups: session key prefix `music_view_ug:${shaderId}:${group}` */
const UG_OPEN_KEY = 'music_view_ug';
/** Suppress echoing selectContainer back to display while applying remote selection */
let suppressSelectionEcho = false;
/** Handle-only drag for FX rows */
let ppDragAllowed = false;
let ppDragId = null;

/** Song roles: free text is owned by music, not the form */
const SONG_CONTENT_ROLES = new Set([
    'song-cover',
    'song-info',
    'song-lyrics',
    'song-progress',
]);
let suppressPublish = false;
let unsubState = null;
/** After a successful Apply, ignore live full-resets briefly (wander ticks). */
let liveSyncPausedUntil = 0;
/** True when the user has edited fields since the last successful sync. */
let formDirty = false;

/** Debounced live uniform pushes */
const uniformDebounce = new Map();
/** Live modulator readouts (controls-local rAF; GPU remains authoritative) */
const modReadoutTargets = new Set();
let modReadoutRaf = null;
const MOD_SOURCES = [
    { id: 'static', label: 'Static', title: 'Static value' },
    { id: 'time', label: 'Time', title: 'Wrapped bipolar saw' },
    { id: 'sine', label: 'Sine', title: 'Sine LFO' },
    { id: 'triangle', label: 'Tri', title: 'Triangle LFO' },
    { id: 'square', label: 'Sq', title: 'Square LFO' },
    { id: 'noise', label: 'Noise', title: 'Value noise' },
];
const MOD_CLOCKS = [
    { id: 'stack', label: 'Stack' },
    { id: 'wall', label: 'Wall' },
    { id: 'song', label: 'Song' },
];


function setStatus(msg, kind = '') {
    const el = $('status');
    el.textContent = msg || '';
    el.className = 'status' + (kind ? ' ' + kind : '');
}

function markFormDirty() {
    formDirty = true;
}

function pauseLiveSync(ms = 750) {
    liveSyncPausedUntil = Date.now() + ms;
}

async function cmd(command, payload, { retries = 0 } = {}) {
    if (!window.musicView) {
        setStatus('IPC bridge missing (open via Electron)', 'error');
        return { ok: false, error: 'IPC bridge missing' };
    }

    let result;
    try {
        result = await window.musicView.sendCommand(command, payload);
    } catch (e) {
        result = { ok: false, error: String(e && e.message ? e.message : e) };
    }

    if (!result || typeof result !== 'object') {
        result = { ok: false, error: 'No response from display' };
    }

    // Retry while display is still booting
    if (!result.ok && retries > 0 && /not ready|timed out|not available/i.test(result.error || '')) {
        await new Promise((r) => setTimeout(r, 300));
        return cmd(command, payload, { retries: retries - 1 });
    }

    if (!result.ok) {
        setStatus(result.error || 'Command failed', 'error');
        console.warn('Command failed:', command, payload, result);
    } else if (result.state) {
        formDirty = false;
        pauseLiveSync(1000);
        // Continuous uniform/modulator scrubbing: merge state without rebuilding the
        // drawer (avoids killing the active range input mid-drag).
        const softCommands = new Set([
            'setPostprocessLayerUniforms',
            'setPostprocessLayerModulators',
            'setContainerUniforms',
            'setContainerModulators',
            'updateBottomPanel',
            'updateBackground',
            'setBackgroundUniforms',
            'setBackgroundModulators',
            'setBackgroundPostprocessLayerUniforms',
            'setBackgroundPostprocessLayerModulators',
            // ARTEF4KT engine knobs — never rebuild Object form mid-scrub
            'setArtef4ktSettings',
            'getArtef4ktSettings',
        ]);
        if (softCommands.has(command)) {
            mergeSceneStateSoft(result.state);
            if (command === 'updateBottomPanel') renderBottomPanel();
            if (command === 'updateBackground') renderBackgroundChrome();
            // Quiet status for high-frequency engine knobs
            if (command !== 'setArtef4ktSettings') setStatus('Updated', 'ok');
        } else {
            applyState(result.state, { preserveSelection: true, full: true });
            setStatus('Updated', 'ok');
        }
    } else {
        formDirty = false;
        pauseLiveSync(1000);
        setStatus('Updated', 'ok');
    }
    return result;
}

/**
 * Merge getState-shaped payload into sceneState without re-rendering forms.
 * Keeps modulators/uniforms in sync for optimistic UI + later full renders.
 */
function mergeSceneStateSoft(state) {
    if (!state || typeof state !== 'object') return;
    if (Array.isArray(state.containers)) {
        sceneState.containers = state.containers;
    }
    if (state.postprocess) {
        sceneState.postprocess = state.postprocess;
    }
    if (state.bottomPanel) {
        sceneState.bottomPanel = state.bottomPanel;
    }
    if (state.background) {
        sceneState.background = state.background;
    }
    if (state.activePreset != null) sceneState.activePreset = state.activePreset;
    if (Array.isArray(state.shaders)) sceneState.shaders = state.shaders;
}

/**
 * @param {object} state
 * @param {{ preserveSelection?: boolean, full?: boolean, positionsOnly?: boolean }} opts
 */
/**
 * Apply display-side click-to-select without full form thrash.
 * Switches to Object tab when the selection comes from the stage.
 */
function applyRemoteContainerSelection(id, { switchTab = true } = {}) {
    if (id == null || id === '') return false;
    const next = Number(id);
    if (!Number.isFinite(next)) return false;
    const exists = sceneState.containers.some((c) => c.id === next);
    if (!exists) return false;
    if (selectedId === next) {
        if (switchTab && activeTab !== 'object') setActiveTab('object');
        return true;
    }
    selectedId = next;
    selectedCppLayerId = null;
    formDirty = false;
    suppressSelectionEcho = true;
    try {
        renderContainerList();
    } finally {
        suppressSelectionEcho = false;
    }
    if (switchTab) setActiveTab('object');
    renderContainerEditor();
    setStatus(`Selected #${next}`, 'ok');
    return true;
}

/** Mirror controls picker → display selection ring without full cmd() form reset. */
function echoSelectionToDisplay(id) {
    if (suppressSelectionEcho || suppressPublish) return;
    if (!window.musicView?.sendCommand) return;
    // Bypass cmd() so we don't pause live sync / flash "Updated" / full re-render
    window.musicView.sendCommand('selectContainer', { id: id == null ? null : id }).catch(() => {});
}

function applyState(state, opts = {}) {
    if (!state) return;
    const preserveSelection = opts.preserveSelection !== false;
    const positionsOnly = !!opts.positionsOnly;
    const full = opts.full !== false && !positionsOnly;

    if (positionsOnly && Array.isArray(state.containers)) {
        // Merge only left/top from live wander ticks — do not rebuild the form
        const byId = new Map(state.containers.map((c) => [c.id, c]));
        for (const c of sceneState.containers) {
            const live = byId.get(c.id);
            if (!live) continue;
            c.left = live.left;
            c.top = live.top;
        }
        // Optionally refresh position inputs if they aren't focused
        const c = selectedContainer();
        if (c && !formDirty) {
            const active = document.activeElement;
            if (active !== $('c-left')) $('c-left').value = Math.round(c.left);
            if (active !== $('c-top')) $('c-top').value = Math.round(c.top);
        }
        // Click-to-select on display still arrives via publish — pick it up here
        if (state.selectedContainerId != null && Number(state.selectedContainerId) !== Number(selectedId)) {
            applyRemoteContainerSelection(state.selectedContainerId, { switchTab: true });
        }
        return;
    }

    sceneState = {
        containers: state.containers || [],
        postprocess: state.postprocess || sceneState.postprocess,
        bottomPanel: state.bottomPanel || sceneState.bottomPanel || {
            color: '#2563eb',
            heightRatio: 0.25,
            includeInFloatArea: false,
        },
        background: state.background || sceneState.background || {
            mode: 'solid',
            color: '#ffffff',
            postprocess: { active: false, layers: [] },
        },
        shaders: Array.isArray(state.shaders) ? state.shaders : (sceneState.shaders || []),
        activePreset: state.activePreset != null ? state.activePreset : sceneState.activePreset,
    };

    if (!full) {
        if (state.selectedContainerId != null && Number(state.selectedContainerId) !== Number(selectedId)) {
            applyRemoteContainerSelection(state.selectedContainerId, { switchTab: false });
        }
        return;
    }

    suppressPublish = true;
    try {
        renderShaderSelects();
        renderContainerList();
        renderPostprocess();
        renderBottomPanel();
        renderBackground();
        renderPresetActive();
        // Prefer display selection when present (click-to-select / selectContainer)
        if (state.selectedContainerId != null
            && sceneState.containers.some((c) => c.id === Number(state.selectedContainerId))) {
            selectedId = Number(state.selectedContainerId);
        } else if (preserveSelection && selectedId != null) {
            const still = sceneState.containers.some((c) => c.id === selectedId);
            if (!still) selectedId = sceneState.containers[0]?.id ?? null;
        } else if (selectedId == null && sceneState.containers.length) {
            selectedId = sceneState.containers[0].id;
        }
        renderContainerList();
        renderContainerEditor();
    } finally {
        suppressPublish = false;
    }
}

// ── Presets ─────────────────────────────────────────────────────────────

function loadPresetPrefsFromStorage() {
    try {
        const favRaw = localStorage.getItem(PRESET_FAV_KEY);
        if (favRaw) {
            const arr = JSON.parse(favRaw);
            if (Array.isArray(arr)) presetFavorites = new Set(arr.filter((x) => typeof x === 'string'));
        }
        const usedRaw = localStorage.getItem(PRESET_USED_KEY);
        if (usedRaw) {
            const arr = JSON.parse(usedRaw);
            if (Array.isArray(arr)) {
                presetRecentUsed = arr.filter((x) => typeof x === 'string').slice(0, 40);
            }
        }
    } catch (_) { /* ignore */ }
}

function savePresetFavorites() {
    try {
        localStorage.setItem(PRESET_FAV_KEY, JSON.stringify([...presetFavorites]));
    } catch (_) { /* ignore */ }
}

function savePresetRecentUsed() {
    try {
        localStorage.setItem(PRESET_USED_KEY, JSON.stringify(presetRecentUsed.slice(0, 40)));
    } catch (_) { /* ignore */ }
}

function recordPresetUsed(name) {
    if (!name) return;
    presetRecentUsed = [name, ...presetRecentUsed.filter((n) => n !== name)].slice(0, 40);
    savePresetRecentUsed();
}

function togglePresetFavorite(name, { silent } = {}) {
    if (!name) return;
    if (presetFavorites.has(name)) presetFavorites.delete(name);
    else presetFavorites.add(name);
    savePresetFavorites();
    if (!silent) {
        updatePresetCatCounts();
        renderPresetBrowser();
    }
}

function isPresetFavorite(name) {
    return !!name && presetFavorites.has(name);
}

function renderPresetActive() {
    const el = $('preset-active');
    if (!el) return;
    const name = sceneState.activePreset;
    if (!name) {
        el.textContent = '';
        return;
    }
    const p = presetList.find((x) => x.name === name);
    const label = p?.displayName && p.displayName !== name
        ? `${p.displayName}`
        : name;
    el.textContent = `Active: ${label}`;
    el.title = name;
}

function getSelectedPresetName() {
    return $('preset-select')?.value || '';
}

function setSelectedPresetName(name, { syncSaveField = true, scheduleInstant = false } = {}) {
    const select = $('preset-select');
    if (select && name != null) {
        if (select.querySelector(`option[value="${cssEscape(String(name))}"]`)) {
            select.value = String(name);
        }
    }
    if (syncSaveField && $('preset-name') && name && name !== 'default') {
        // Don't overwrite while user is typing a new save name
        const nameEl = $('preset-name');
        if (document.activeElement !== nameEl) {
            nameEl.value = name;
        }
    }
    renderPresetListSelection();
    renderPresetMeta();
    if (scheduleInstant) scheduleInstantPresetLoad();
}

function scheduleInstantPresetLoad() {
    if (!$('preset-instant-load')?.checked) return;
    if (presetInstantTimer) clearTimeout(presetInstantTimer);
    presetInstantTimer = setTimeout(() => {
        presetInstantTimer = null;
        loadSelectedPreset();
    }, 180);
}

function cancelInstantPresetLoad() {
    if (presetInstantTimer) {
        clearTimeout(presetInstantTimer);
        presetInstantTimer = null;
    }
}

/** Multi-token AND search across name, display, category, and shader ids. */
function presetMatchesQuery(p, q) {
    if (!q) return true;
    const tokens = q.split(/\s+/).filter(Boolean);
    if (!tokens.length) return true;
    const shaders = Array.isArray(p.shaderIds) ? p.shaderIds.join(' ') : '';
    const hay = [
        p.name,
        p.displayName,
        p.category,
        PRESET_CAT_LABELS[p.category] || '',
        shaders,
        p.fxOnly ? 'fx-only fxonly effect' : '',
        p.hasContainers ? 'layout scene full' : '',
    ].join(' ').toLowerCase();
    return tokens.every((t) => hay.includes(t));
}

function usedIndex(name) {
    const i = presetRecentUsed.indexOf(name);
    return i < 0 ? 1e9 : i;
}

function sortPresets(list) {
    const arr = list.slice();
    const byName = (a, b) => {
        const an = (a.displayName || a.name).toLowerCase();
        const bn = (b.displayName || b.name).toLowerCase();
        return an.localeCompare(bn) || a.name.localeCompare(b.name);
    };

    if (presetSort === 'recent') {
        arr.sort((a, b) => {
            if (a.isDefault) return -1;
            if (b.isDefault) return 1;
            const ta = a.updatedAt || '';
            const tb = b.updatedAt || '';
            return tb.localeCompare(ta) || byName(a, b);
        });
        return arr;
    }
    if (presetSort === 'used') {
        arr.sort((a, b) => {
            const ua = usedIndex(a.name);
            const ub = usedIndex(b.name);
            if (ua !== ub) return ua - ub;
            return byName(a, b);
        });
        return arr;
    }
    if (presetSort === 'favorites') {
        arr.sort((a, b) => {
            const fa = isPresetFavorite(a.name) ? 0 : 1;
            const fb = isPresetFavorite(b.name) ? 0 : 1;
            if (fa !== fb) return fa - fb;
            return byName(a, b);
        });
        return arr;
    }
    if (presetSort === 'name') {
        arr.sort((a, b) => {
            if (a.isDefault) return -1;
            if (b.isDefault) return 1;
            return byName(a, b);
        });
        return arr;
    }
    // category (server already roughly ordered; re-apply)
    const catOrder = { classic: 0, looks: 1, recipes: 2, saved: 3 };
    arr.sort((a, b) => {
        if (a.isDefault) return -1;
        if (b.isDefault) return 1;
        const ca = catOrder[a.category] != null ? catOrder[a.category] : 9;
        const cb = catOrder[b.category] != null ? catOrder[b.category] : 9;
        if (ca !== cb) return ca - cb;
        return byName(a, b);
    });
    return arr;
}

function computeFilteredPresets() {
    const q = ($('preset-search')?.value || '').trim().toLowerCase();
    let list = presetList.slice();
    if (presetCategory === 'favorites') {
        list = list.filter((p) => isPresetFavorite(p.name));
    } else if (presetCategory && presetCategory !== 'all') {
        list = list.filter((p) => p.category === presetCategory);
    }
    if (presetTypeFilter === 'fx') {
        list = list.filter((p) => p.fxOnly);
    } else if (presetTypeFilter === 'layout') {
        list = list.filter((p) => p.hasContainers);
    }
    if (q) list = list.filter((p) => presetMatchesQuery(p, q));
    presetFiltered = sortPresets(list);
    return presetFiltered;
}

function updatePresetSearchClear() {
    const clear = $('preset-search-clear');
    const search = $('preset-search');
    if (!clear || !search) return;
    clear.classList.toggle('hidden', !(search.value || '').trim());
}

function updatePresetCatCounts() {
    const counts = { all: presetList.length, favorites: 0, looks: 0, recipes: 0, classic: 0, saved: 0 };
    for (const p of presetList) {
        if (counts[p.category] != null) counts[p.category] += 1;
        if (isPresetFavorite(p.name)) counts.favorites += 1;
    }
    qsAll('.preset-cat-btn').forEach((btn) => {
        const cat = btn.dataset.cat || 'all';
        const n = counts[cat];
        const base = cat === 'favorites' ? '★' : (cat === 'all' ? 'All' : (PRESET_CAT_LABELS[cat] || cat));
        if (cat === 'favorites') {
            btn.textContent = n > 0 ? `★ ${n}` : '★';
        } else if (typeof n === 'number') {
            btn.textContent = `${base} ${n}`;
        } else {
            btn.textContent = base;
        }
        btn.title = cat === 'favorites'
            ? (n ? `${n} starred` : 'Star presets with ★ on each row')
            : `${base}: ${n ?? 0}`;
    });
}

function renderPresetMeta() {
    const el = $('preset-meta');
    const shEl = $('preset-shaders');
    if (!el) return;
    const name = getSelectedPresetName();
    const p = presetList.find((x) => x.name === name);
    const total = presetList.length;
    const shown = presetFiltered.length;
    if (!p) {
        el.textContent = shown === total
            ? `${total} presets`
            : `${shown} of ${total} presets`;
        if (shEl) shEl.textContent = '';
        return;
    }
    const bits = [];
    bits.push(p.displayName && p.displayName !== p.name
        ? `${p.displayName} (${p.name})`
        : p.name);
    if (isPresetFavorite(p.name)) bits.push('★');
    if (p.fxOnly) bits.push('FX only — keeps layout');
    else if (p.hasContainers) {
        bits.push(p.containerCount
            ? `layout (${p.containerCount} object${p.containerCount === 1 ? '' : 's'})`
            : 'full layout');
    }
    if (p.layerCount) bits.push(`${p.layerCount} FX layer${p.layerCount === 1 ? '' : 's'}`);
    if (p.category) bits.push(PRESET_CAT_LABELS[p.category] || p.category);
    if (shown !== total) bits.push(`${shown}/${total} shown`);
    el.textContent = bits.join(' · ');

    if (shEl) {
        const ids = Array.isArray(p.shaderIds) ? p.shaderIds : [];
        shEl.textContent = ids.length
            ? `FX: ${ids.join(' → ')}`
            : (p.layerCount ? '' : 'No postprocess layers');
        shEl.title = ids.join(', ');
    }
}

function renderPresetListSelection() {
    const list = $('ctrl-preset-list');
    if (!list) return;
    const sel = getSelectedPresetName();
    const active = sceneState.activePreset;
    list.querySelectorAll('.preset-row').forEach((row) => {
        const id = row.dataset.name;
        row.classList.toggle('is-selected', id === sel);
        row.classList.toggle('is-active', id === active);
        row.setAttribute('aria-selected', id === sel ? 'true' : 'false');
        const star = row.querySelector('.preset-star');
        if (star) {
            const on = isPresetFavorite(id);
            star.classList.toggle('is-on', on);
            star.setAttribute('aria-pressed', on ? 'true' : 'false');
            star.textContent = on ? '★' : '☆';
        }
    });
}

function renderPresetBrowser() {
    const list = $('ctrl-preset-list');
    if (!list) return;
    const filtered = computeFilteredPresets();
    const sel = getSelectedPresetName();
    const active = sceneState.activePreset;
    updatePresetSearchClear();
    updatePresetCatCounts();

    list.innerHTML = '';
    if (!filtered.length) {
        const empty = document.createElement('p');
        empty.className = 'preset-list-empty';
        if (!presetList.length) {
            empty.textContent = 'No presets found.';
        } else if (presetCategory === 'favorites') {
            empty.textContent = 'No favorites yet — click ☆ on a row to star it.';
        } else {
            empty.textContent = 'No presets match this filter.';
        }
        list.appendChild(empty);
        renderPresetMeta();
        return;
    }

    let lastCat = null;
    const showGroups = presetSort === 'category'
        && (presetCategory === 'all' || presetCategory === 'favorites');

    for (const p of filtered) {
        if (showGroups && p.category !== lastCat) {
            lastCat = p.category;
            const lab = document.createElement('div');
            lab.className = 'preset-group-label';
            lab.textContent = PRESET_CAT_LABELS[p.category] || p.category || 'Other';
            list.appendChild(lab);
        }

        const row = document.createElement('div');
        row.className = 'preset-row';
        row.dataset.name = p.name;
        row.setAttribute('role', 'option');
        row.setAttribute('aria-selected', p.name === sel ? 'true' : 'false');
        row.tabIndex = -1;
        if (p.name === sel) row.classList.add('is-selected');
        if (p.name === active) row.classList.add('is-active');

        const star = document.createElement('button');
        star.type = 'button';
        star.className = 'preset-star' + (isPresetFavorite(p.name) ? ' is-on' : '');
        star.textContent = isPresetFavorite(p.name) ? '★' : '☆';
        star.title = isPresetFavorite(p.name) ? 'Unstar' : 'Star favorite';
        star.setAttribute('aria-label', 'Favorite');
        star.setAttribute('aria-pressed', isPresetFavorite(p.name) ? 'true' : 'false');
        star.addEventListener('click', (e) => {
            e.stopPropagation();
            togglePresetFavorite(p.name);
        });

        const main = document.createElement('button');
        main.type = 'button';
        main.className = 'preset-row-main';
        main.title = p.name;

        const title = document.createElement('span');
        title.className = 'preset-row-title';
        title.textContent = p.displayName || p.name;

        const id = document.createElement('span');
        id.className = 'preset-row-id';
        const shaders = Array.isArray(p.shaderIds) ? p.shaderIds : [];
        id.textContent = shaders.length
            ? `${p.name} · ${shaders.slice(0, 3).join(', ')}${shaders.length > 3 ? '…' : ''}`
            : p.name;

        main.appendChild(title);
        main.appendChild(id);

        const badges = document.createElement('span');
        badges.className = 'preset-row-badges';
        if (p.isDefault) {
            const b = document.createElement('span');
            b.className = 'preset-badge is-default';
            b.textContent = 'default';
            badges.appendChild(b);
        }
        if (p.fxOnly) {
            const b = document.createElement('span');
            b.className = 'preset-badge is-fx';
            b.textContent = 'fx';
            badges.appendChild(b);
        } else if (p.hasContainers) {
            const b = document.createElement('span');
            b.className = 'preset-badge is-layout';
            b.textContent = 'layout';
            badges.appendChild(b);
        }
        if (p.layerCount > 0) {
            const b = document.createElement('span');
            b.className = 'preset-badge';
            b.textContent = `${p.layerCount}fx`;
            badges.appendChild(b);
        }

        main.addEventListener('click', () => {
            setSelectedPresetName(p.name);
            renderPresetListSelection();
            if ($('preset-instant-load')?.checked) {
                cancelInstantPresetLoad();
                loadSelectedPreset();
            }
        });
        main.addEventListener('dblclick', (e) => {
            e.preventDefault();
            setSelectedPresetName(p.name);
            cancelInstantPresetLoad();
            loadSelectedPreset();
        });

        row.appendChild(star);
        row.appendChild(main);
        row.appendChild(badges);
        list.appendChild(row);
    }

    // Scroll selected into view
    const selRow = list.querySelector(`.preset-row[data-name="${cssEscape(sel)}"]`);
    if (selRow && typeof selRow.scrollIntoView === 'function') {
        try {
            selRow.scrollIntoView({ block: 'nearest' });
        } catch (_) {
            selRow.scrollIntoView(false);
        }
    }
    renderPresetMeta();
}

function selectPresetByDelta(delta) {
    const filtered = presetFiltered.length ? presetFiltered : computeFilteredPresets();
    if (!filtered.length) return;
    const cur = getSelectedPresetName();
    let idx = filtered.findIndex((p) => p.name === cur);
    if (idx < 0) idx = delta > 0 ? -1 : 0;
    idx = Math.max(0, Math.min(filtered.length - 1, idx + delta));
    setSelectedPresetName(filtered[idx].name, { scheduleInstant: true });
    renderPresetBrowser();
}

function setPresetCategory(cat) {
    presetCategory = cat || 'all';
    try { sessionStorage.setItem(PRESET_CAT_KEY, presetCategory); } catch (_) { /* ignore */ }
    qsAll('.preset-cat-btn').forEach((btn) => {
        const on = btn.dataset.cat === presetCategory;
        btn.classList.toggle('is-active', on);
        btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    renderPresetBrowser();
}

function setPresetTypeFilter(type) {
    presetTypeFilter = type || 'all';
    try { sessionStorage.setItem(PRESET_TYPE_KEY, presetTypeFilter); } catch (_) { /* ignore */ }
    qsAll('.preset-filter-btn').forEach((btn) => {
        const on = btn.dataset.type === presetTypeFilter;
        btn.classList.toggle('is-active', on);
    });
    renderPresetBrowser();
}

function jumpToActivePreset() {
    const name = sceneState.activePreset;
    if (!name) {
        setStatus('No active preset', 'error');
        return;
    }
    if (!presetList.some((p) => p.name === name)) {
        setStatus(`Active preset not in list: ${name}`, 'error');
        return;
    }
    // Clear filters that would hide it so it appears
    if (presetCategory === 'favorites' && !isPresetFavorite(name)) {
        setPresetCategory('all');
    } else if (presetCategory !== 'all' && presetCategory !== 'favorites') {
        const p = presetList.find((x) => x.name === name);
        if (p && p.category !== presetCategory) setPresetCategory('all');
    }
    if (presetTypeFilter !== 'all') {
        const p = presetList.find((x) => x.name === name);
        if (p) {
            if (presetTypeFilter === 'fx' && !p.fxOnly) setPresetTypeFilter('all');
            if (presetTypeFilter === 'layout' && !p.hasContainers) setPresetTypeFilter('all');
        }
    }
    setSelectedPresetName(name);
    renderPresetBrowser();
}

/** Sync bottom-strip controls from sceneState (skips focused inputs). */
function renderBottomPanel() {
    const bp = sceneState.bottomPanel || {
        color: '#2563eb',
        heightRatio: 0.25,
        includeInFloatArea: false,
    };
    const colorEl = $('bp-color');
    const heightEl = $('bp-height');
    const heightVal = $('bp-height-val');
    const includeEl = $('bp-include-float');
    const active = document.activeElement;

    if (colorEl && active !== colorEl) {
        colorEl.value = normalizeColor(bp.color || '#2563eb');
    }
    const pct = Math.round(Math.max(0, Math.min(1, Number(bp.heightRatio) || 0)) * 100);
    if (heightEl && active !== heightEl) {
        heightEl.value = String(pct);
    }
    if (heightVal) {
        heightVal.textContent = `${pct}%`;
    }
    if (includeEl && active !== includeEl) {
        includeEl.checked = !!bp.includeInFloatArea;
    }
}

function readBottomPanelForm() {
    const heightEl = $('bp-height');
    const pct = heightEl ? Number(heightEl.value) : 25;
    return {
        color: $('bp-color')?.value || '#2563eb',
        heightRatio: Math.max(0, Math.min(1, (Number.isFinite(pct) ? pct : 25) / 100)),
        includeInFloatArea: !!$('bp-include-float')?.checked,
    };
}

let bpApplyTimer = null;
function scheduleBottomPanelApply() {
    if (suppressPublish) return;
    if (bpApplyTimer) clearTimeout(bpApplyTimer);
    bpApplyTimer = setTimeout(async () => {
        bpApplyTimer = null;
        const payload = readBottomPanelForm();
        // Optimistic local state
        sceneState.bottomPanel = payload;
        const heightVal = $('bp-height-val');
        if (heightVal) {
            heightVal.textContent = `${Math.round(payload.heightRatio * 100)}%`;
        }
        await cmd('updateBottomPanel', payload);
    }, 40);
}

function backgroundState() {
    return sceneState.background || {
        mode: 'solid',
        color: '#ffffff',
        postprocess: { active: false, layers: [] },
    };
}

function bppLayers() {
    const pp = backgroundState().postprocess;
    if (pp && Array.isArray(pp.layers)) return pp.layers;
    return [];
}

function selectedBppLayer() {
    const layers = bppLayers();
    if (!layers.length) return null;
    if (selectedBppLayerId != null) {
        const found = layers.find((l) => l.id === Number(selectedBppLayerId));
        if (found) return found;
    }
    return layers[0];
}

function setBackgroundModeUi(mode) {
    const next = mode === 'shader' || mode === 'image' || mode === 'video' ? mode : 'solid';
    qsAll('[data-bg-mode]').forEach((btn) => {
        const on = btn.dataset.bgMode === next;
        btn.classList.toggle('is-active', on);
    });
    const panes = ['solid', 'shader', 'image', 'video'];
    for (const id of panes) {
        const el = $(`bg-mode-${id}`);
        if (!el) continue;
        el.classList.toggle('hidden', id !== next);
    }
}

function renderBackgroundChrome() {
    const bg = backgroundState();
    const mode = bg.mode || 'solid';
    setBackgroundModeUi(mode);
    const colorEl = $('bg-color');
    if (colorEl && document.activeElement !== colorEl) {
        colorEl.value = normalizeColor(bg.color || '#ffffff');
    }
    const imgMode = $('bg-image-mode');
    if (imgMode && document.activeElement !== imgMode) {
        imgMode.value = bg.imageMode === 'scale' || bg.imageMode === 'tile' ? bg.imageMode : 'fill';
    }
    const vidMode = $('bg-video-mode');
    if (vidMode && document.activeElement !== vidMode) {
        vidMode.value = bg.videoMode === 'scale' ? 'scale' : 'fill';
    }
    const loopEl = $('bg-video-loop');
    if (loopEl && document.activeElement !== loopEl) {
        loopEl.checked = bg.videoLoop !== false;
    }
    const imgStatus = $('bg-image-status');
    if (imgStatus) {
        if (bg.mediaError && mode === 'image') imgStatus.textContent = bg.mediaError;
        else if (bg.imageName || bg.imagePath) {
            imgStatus.textContent = bg.imageName || bg.imagePath;
        } else {
            imgStatus.textContent = 'No image';
        }
    }
    const vidStatus = $('bg-video-status');
    if (vidStatus) {
        if (bg.mediaError && mode === 'video') vidStatus.textContent = bg.mediaError;
        else if (bg.videoName || bg.videoPath) {
            vidStatus.textContent = bg.videoName || bg.videoPath;
        } else {
            vidStatus.textContent = 'No video';
        }
    }
}

function renderBackgroundShader(opts = {}) {
    const bg = backgroundState();
    const status = $('bg-shader-status');
    const select = $('bg-shader');
    if (status) {
        status.textContent = bg.hasShader || bg.shaderId
            ? `Active: ${findShader(bg.shaderId)?.name || bg.shaderId || 'Shader'}`
            : 'No shader';
    }
    // Keep an in-progress package pick. Forcing select.value back to the live
    // shaderId on every change made it impossible to choose a replacement
    // without clearing first.
    const keepPick = !!(opts.preservePick || (select && document.activeElement === select));
    if (select && bg.shaderId && select.querySelector(`option[value="${cssEscape(bg.shaderId)}"]`)) {
        if (!keepPick) select.value = bg.shaderId;
    }
    const selectId = select?.value || bg.shaderId;
    const meta = findShader(selectId);
    const desc = $('bg-shader-desc');
    if (desc) desc.textContent = meta?.description || '';
    const host = $('bg-uniforms');
    if (!host) return;
    const samePkg = !!(bg.shaderId && meta?.id === bg.shaderId);
    if (!bg.shaderModulators) bg.shaderModulators = {};
    buildUniformControls(
        host,
        meta?.uniforms || [],
        (samePkg ? bg.shaderUniforms : null) || defaultsFromDefs(meta?.uniforms),
        (name, value) => {
            if (!samePkg) return;
            cmd('setBackgroundUniforms', { uniforms: { [name]: value } });
            if (bg.shaderUniforms) bg.shaderUniforms[name] = value;
        },
        'bg-u',
        {
            shaderId: meta?.id || selectId || '',
            modulators: samePkg ? (bg.shaderModulators || {}) : {},
            onModulatorChange: samePkg
                ? (name, mod) => {
                    cmd('setBackgroundModulators', { modulators: { [name]: mod } });
                    if (!bg.shaderModulators) bg.shaderModulators = {};
                    if (mod == null) delete bg.shaderModulators[name];
                    else {
                        bg.shaderModulators[name] = Object.assign(
                            {},
                            bg.shaderModulators[name] || {},
                            mod,
                        );
                    }
                }
                : null,
        },
    );
}

function buildBppLayerRow(layer, index) {
    const meta = metaForShaderId(layer.shaderId, layer.shaderMeta);
    const enabled = layer.enabled !== false;
    const selected = layer.id === Number(selectedBppLayerId);
    const row = document.createElement('div');
    row.className = 'pp-layer-row'
        + (selected ? ' selected' : '')
        + (!enabled ? ' disabled' : '');
    row.dataset.id = String(layer.id);
    row.title = meta?.description || meta?.name || layer.shaderId || '';

    const order = document.createElement('span');
    order.className = 'pp-layer-order';
    order.textContent = String(index + 1);

    const name = document.createElement('span');
    name.className = 'pp-layer-name';
    name.textContent = meta?.name || layer.shaderId || 'Layer';

    const eye = document.createElement('button');
    eye.type = 'button';
    eye.className = 'pp-layer-eye' + (enabled ? '' : ' is-off');
    eye.textContent = enabled ? '◉' : '○';
    eye.title = enabled ? 'Disable layer' : 'Enable layer';
    eye.addEventListener('click', async (e) => {
        e.stopPropagation();
        const result = await cmd('setBackgroundPostprocessLayerEnabled', {
            id: layer.id,
            enabled: !enabled,
        });
        if (result?.ok && result.state) {
            applyState(result.state, { full: true, preserveSelection: true });
        }
    });

    row.appendChild(order);
    row.appendChild(name);
    row.appendChild(eye);
    row.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        selectedBppLayerId = layer.id;
        renderBackgroundPostprocess();
    });
    return row;
}

function renderBackgroundPostprocess() {
    const activeEl = $('bpp-active');
    const list = $('bpp-layer-list');
    const editor = $('bpp-layer-editor');
    const emptyHint = $('bpp-layer-empty-hint');
    if (!activeEl || !list || !editor) return;

    const bg = backgroundState();
    const pp = bg.postprocess || { active: false, layers: [] };
    activeEl.checked = !!pp.active;

    const layers = bppLayers();
    if (selectedBppLayerId == null && layers[0]) {
        selectedBppLayerId = layers[0].id;
    } else if (selectedBppLayerId != null && !layers.some((l) => l.id === Number(selectedBppLayerId))) {
        selectedBppLayerId = layers[0]?.id ?? null;
    }

    list.innerHTML = '';
    if (!layers.length) {
        const empty = document.createElement('p');
        empty.className = 'hint';
        empty.textContent = 'No layers — add an effect below.';
        list.appendChild(empty);
    } else {
        layers.forEach((layer, i) => list.appendChild(buildBppLayerRow(layer, i)));
    }

    const layer = selectedBppLayer();
    if (!layer) {
        editor.classList.add('hidden');
        if (emptyHint) {
            emptyHint.classList.toggle('hidden', !!layers.length);
            emptyHint.textContent = 'Add a postprocess package to stack effects on the background.';
        }
        return;
    }
    editor.classList.remove('hidden');
    if (emptyHint) emptyHint.classList.add('hidden');

    const meta = metaForShaderId(layer.shaderId, layer.shaderMeta);
    const step = (layer.index ?? layers.findIndex((l) => l.id === layer.id)) + 1;
    if ($('bpp-layer-title')) {
        $('bpp-layer-title').textContent = meta?.name || layer.shaderId || 'Layer';
    }
    if ($('bpp-layer-index')) {
        $('bpp-layer-index').textContent = `step ${step}/${layers.length}`;
    }
    if (layer.shaderId && $('bpp-shader')?.querySelector(`option[value="${cssEscape(layer.shaderId)}"]`)) {
        $('bpp-shader').value = layer.shaderId;
    }
    const desc = meta?.description || '';
    const descEl = $('bpp-shader-desc');
    if (descEl) {
        descEl.textContent = desc;
        descEl.title = desc;
    }
    if (!layer.modulators || typeof layer.modulators !== 'object') layer.modulators = {};
    buildUniformControls(
        $('bpp-uniforms'),
        meta?.uniforms || [],
        layer.uniforms || {},
        (name, value) => {
            cmd('setBackgroundPostprocessLayerUniforms', {
                id: layer.id,
                uniforms: { [name]: value },
            });
            if (layer.uniforms) layer.uniforms[name] = value;
        },
        `bpp-l${layer.id}-u`,
        {
            shaderId: layer.shaderId || meta?.id || '',
            modulators: layer.modulators,
            onModulatorChange: (name, mod) => {
                cmd('setBackgroundPostprocessLayerModulators', {
                    id: layer.id,
                    modulators: { [name]: mod },
                });
                if (!layer.modulators) layer.modulators = {};
                if (mod == null) delete layer.modulators[name];
                else {
                    layer.modulators[name] = Object.assign(
                        {},
                        layer.modulators[name] || {},
                        mod,
                    );
                }
            },
        },
    );
}

function renderBackground() {
    renderBackgroundChrome();
    renderBackgroundShader();
    renderBackgroundPostprocess();
}

let bgApplyTimer = null;
function scheduleBackgroundApply(patch) {
    if (suppressPublish) return;
    if (bgApplyTimer) clearTimeout(bgApplyTimer);
    bgApplyTimer = setTimeout(async () => {
        bgApplyTimer = null;
        sceneState.background = Object.assign({}, backgroundState(), patch);
        await cmd('updateBackground', patch);
    }, 40);
}

async function refreshPresetList({ selectName } = {}) {
    if (!window.musicView?.listPresets) {
        setStatus('Preset API missing', 'error');
        return;
    }
    const result = await window.musicView.listPresets();
    if (!result?.ok) {
        setStatus(result?.error || 'Failed to list presets', 'error');
        return;
    }
    presetList = result.presets || [];
    const select = $('preset-select');
    const prev = selectName || select?.value || sceneState.activePreset || 'default';
    fillSelect(
        select,
        presetList.map((p) => ({
            value: p.name,
            label: p.isDefault
                ? `${p.displayName || p.name} (default)`
                : (p.displayName && p.displayName !== p.name
                    ? `${p.displayName} — ${p.name}`
                    : p.name),
        })),
    );
    if (prev && select?.querySelector(`option[value="${cssEscape(prev)}"]`)) {
        select.value = prev;
    } else if (select?.options?.length) {
        select.selectedIndex = 0;
    }
    // Mirror into save-as field if empty
    if ($('preset-name') && !$('preset-name').value && select?.value) {
        $('preset-name').value = select.value === 'default' ? '' : select.value;
    }
    renderPresetBrowser();
    renderPresetActive();
}

async function saveCurrentAsPreset(name, { asDefault } = {}) {
    const safeName = String(name || '').trim();
    if (!safeName) {
        setStatus('Enter a preset name', 'error');
        return;
    }
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(safeName.replace(/\.json$/i, ''))) {
        setStatus('Name: letters, numbers, - or _', 'error');
        return;
    }

    setStatus('Exporting…');
    const exported = await cmd('exportPreset', { name: safeName });
    if (!exported?.ok || !exported.preset) {
        setStatus(exported?.error || 'Export failed', 'error');
        return;
    }

    const fileName = asDefault ? 'default' : safeName.replace(/\.json$/i, '');
    const preset = Object.assign({}, exported.preset, {
        name: asDefault ? 'Default' : (exported.preset.name || safeName),
    });

    if (!window.musicView?.savePresetFile) {
        setStatus('Preset API missing', 'error');
        return;
    }
    const saved = await window.musicView.savePresetFile(fileName, preset);
    if (!saved?.ok) {
        setStatus(saved?.error || 'Save failed', 'error');
        return;
    }

    // Reflect active preset on display
    await cmd('applyPreset', { preset: saved.preset || preset, name: fileName });
    sceneState.activePreset = fileName;
    await refreshPresetList({ selectName: fileName });
    renderPresetActive();
    setStatus(asDefault ? 'Saved as default' : `Saved “${fileName}”`, 'ok');
}

async function loadSelectedPreset() {
    const name = getSelectedPresetName();
    if (!name) {
        setStatus('Select a preset', 'error');
        return;
    }
    const p = presetList.find((x) => x.name === name);
    const label = p?.displayName || name;
    setStatus(`Loading ${label}…`);
    const load = loadUi();
    if (load) load.begin(`Loading ${label}…`);
    let result;
    try {
    // Prefer display-side load (applies + reads file via main)
    result = await cmd('loadPreset', { name });
    if (!result?.ok) {
        // Fallback: load file in controls, push apply
        const file = await window.musicView.loadPresetFile(name);
        if (!file?.ok || !file.preset) {
            setStatus(result?.error || file?.error || 'Load failed', 'error');
            return;
        }
        result = await cmd('applyPreset', { preset: file.preset, name });
    }
    if (result?.ok) {
        if (result.state) applyState(result.state, { full: true, preserveSelection: true });
        sceneState.activePreset = name;
        recordPresetUsed(name);
        renderPresetActive();
        renderPresetListSelection();
        renderPresetMeta();
        if (result.fxOnly || p?.fxOnly) {
            setStatus(`Loaded “${label}” (FX only — layout kept)`, 'ok');
        } else if (result.added || result.removed) {
            setStatus(`Look applied — ${result.added || 0} panels added, ${result.removed || 0} removed.`, 'ok');
        } else {
            setStatus(`Loaded “${label}”`, 'ok');
        }
    } else {
        setStatus(result?.error || 'Load failed', 'error');
    }
    } finally {
        if (load) load.end();
    }
}

async function deleteSelectedPreset() {
    const name = getSelectedPresetName();
    if (!name) return;
    if (name === 'default') {
        setStatus('Cannot delete default', 'error');
        return;
    }
    if (!window.musicView?.deletePresetFile) return;
    const result = await window.musicView.deletePresetFile(name);
    if (!result?.ok) {
        setStatus(result?.error || 'Delete failed', 'error');
        return;
    }
    await refreshPresetList({ selectName: 'default' });
    setStatus(`Deleted “${name}”`, 'ok');
}

// ── Shader package helpers ──────────────────────────────────────────────

function findShader(id) {
    if (!id) return null;
    return (sceneState.shaders || []).find((s) => s.id === id) || null;
}

function shadersForRole(role) {
    return (sceneState.shaders || []).filter((s) => {
        if (!s.roles || !s.roles.length) return true;
        return s.roles.includes(role) || s.roles.includes('any');
    });
}

function metaForShaderId(id, fallbackMeta) {
    return findShader(id) || fallbackMeta || null;
}

// ── Dynamic uniform control builder (widget toolkit) ────────────────────

/**
 * Resolve UI widget for a uniform def (schema v1.1 + heuristics).
 * Order: explicit widget → type → options → int/stepper heuristic → range → number
 * @param {object} def
 * @returns {'slider'|'number'|'stepper'|'toggle'|'select'|'segmented'|'color'|'vec'}
 */
function resolveUniformWidget(def) {
    if (!def) return 'number';
    const type = (def.type || 'float').toLowerCase();
    const explicit = def.widget && String(def.widget).toLowerCase();
    if (explicit && explicit !== 'pair' && explicit !== 'angle') {
        if (explicit === 'slider' || explicit === 'number' || explicit === 'stepper'
            || explicit === 'toggle' || explicit === 'select' || explicit === 'segmented'
            || explicit === 'color') {
            return explicit;
        }
    }
    if (type === 'bool') return 'toggle';
    if (type === 'color') return 'color';
    if (type === 'vec2' || type === 'vec3' || type === 'vec4') return 'vec';
    if (Array.isArray(def.options) && def.options.length) {
        return def.options.length > 5 ? 'select' : 'segmented';
    }
    if (type === 'int') return 'stepper';
    const step = def.step != null ? Number(def.step) : null;
    const min = def.min != null ? Number(def.min) : null;
    const max = def.max != null ? Number(def.max) : null;
    if (
        step != null && step >= 1
        && min != null && max != null
        && Number.isFinite(min) && Number.isFinite(max)
        && Math.abs(min - Math.round(min)) < 1e-9
        && Math.abs(max - Math.round(max)) < 1e-9
        && (max - min) <= 12
        && (max - min) >= 0
    ) {
        return 'stepper';
    }
    if (def.min != null && def.max != null) return 'slider';
    return 'number';
}

/** Continuous float rows eligible for param modulation (Phase 0 rule). */
function isFloatModEligible(def) {
    if (!def || !def.name) return false;
    const type = (def.type || 'float').toLowerCase();
    if (type !== 'float') return false;
    const w = resolveUniformWidget(def);
    return w === 'slider' || w === 'number';
}

/** Package min/max span, or null if unbounded. */
function modSpan(def) {
    const min = def?.min != null ? Number(def.min) : null;
    const max = def?.max != null ? Number(def.max) : null;
    if (min != null && max != null && Number.isFinite(min) && Number.isFinite(max)) {
        return Math.abs(max - min);
    }
    return null;
}

/**
 * Max bipolar amp so [offset−amp, offset+amp] stays inside package min/max.
 * Falls back to full span (or 1) when bounds/offset unknown.
 */
function maxModAmp(def, offset) {
    const span = modSpan(def);
    let cap = span != null ? span : 1;
    const min = def?.min != null ? Number(def.min) : null;
    const max = def?.max != null ? Number(def.max) : null;
    if (min != null && max != null && Number.isFinite(Number(offset))) {
        const o = Number(offset);
        const room = Math.min(o - min, max - o);
        if (Number.isFinite(room) && room >= 0) {
            cap = Math.min(cap, room);
        }
    }
    return Math.max(0, cap);
}

/**
 * Default amp: ~10% of span, never above maxModAmp for the current offset.
 * @param {object} def
 * @param {number} [offset]
 */
function defaultModAmp(def, offset) {
    const span = modSpan(def);
    const base = span != null ? 0.1 * span : 0.1;
    const o = offset != null && Number.isFinite(Number(offset))
        ? Number(offset)
        : (def?.default != null ? Number(def.default) : 0);
    const cap = maxModAmp(def, o);
    if (cap <= 0) return 0;
    return Math.min(base, cap);
}

/** Default LFO rate (Hz / cycles per sec) — Phase 0 lock. */
function defaultModRate() {
    return 0.5;
}

function boundsFromDef(def) {
    if (!def) return null;
    const b = {};
    if (def.min != null && Number.isFinite(Number(def.min))) b.min = Number(def.min);
    if (def.max != null && Number.isFinite(Number(def.max))) b.max = Number(def.max);
    return (b.min != null || b.max != null) ? b : null;
}

function isActiveMod(mod) {
    if (typeof isModSourceActive === 'function') return isModSourceActive(mod);
    return !!(mod && (
        mod.source === 'time'
        || mod.source === 'sine'
        || mod.source === 'triangle'
        || mod.source === 'square'
        || mod.source === 'noise'
    ));
}

/** Clocks for controls-side live readout (mirror of display). */
function controlsModClocks(stackT) {
    return {
        stack: Number.isFinite(stackT) ? stackT : performance.now() / 1000,
        wall: performance.now() / 1000,
        // Song clock only available on display; controls approximate with wall unless injected
        song: (typeof window !== 'undefined' && typeof window.__songModClockHint === 'number')
            ? window.__songModClockHint
            : 0,
    };
}

function resolveModLocal(base, mod, tSec, bounds) {
    if (typeof resolveModulatedValue === 'function') {
        return resolveModulatedValue(base, mod, tSec, bounds, controlsModClocks(tSec));
    }
    return typeof base === 'number' ? base : 0;
}

function startModReadoutLoop() {
    if (modReadoutRaf != null) return;
    const tick = () => {
        const t = performance.now() / 1000;
        for (const target of [...modReadoutTargets]) {
            if (!target.el || !target.el.isConnected) {
                modReadoutTargets.delete(target);
                continue;
            }
            const mod = typeof target.getMod === 'function' ? target.getMod() : null;
            if (!isActiveMod(mod)) continue;
            const base = typeof target.getBase === 'function' ? target.getBase() : 0;
            const v = resolveModLocal(base, mod, t, target.bounds);
            target.el.textContent = formatUniformReadout(v, target.def || {});
            target.el.setAttribute('aria-valuenow', String(v));
        }
        if (modReadoutTargets.size) {
            modReadoutRaf = requestAnimationFrame(tick);
        } else {
            modReadoutRaf = null;
        }
    };
    modReadoutRaf = requestAnimationFrame(tick);
}

function registerModReadout(target) {
    if (!target || !target.el) return;
    modReadoutTargets.add(target);
    startModReadoutLoop();
}

/**
 * Badge on collapsed uniform groups: "N animated" when any modulated floats inside.
 * @param {HTMLElement} details
 */
function refreshGroupModBadge(details) {
    if (!details || details.tagName !== 'DETAILS') return;
    const summary = details.querySelector(':scope > summary.uniform-group-title');
    if (!summary) return;
    let badge = summary.querySelector('.u-group-mod-badge');
    const count = details.querySelectorAll('.u-field.is-modulated').length;
    if (count <= 0) {
        if (badge) badge.remove();
        return;
    }
    if (!badge) {
        badge = document.createElement('span');
        badge.className = 'u-group-mod-badge';
        badge.setAttribute('aria-hidden', 'true');
        summary.appendChild(badge);
    }
    badge.textContent = count === 1 ? '1 animated' : `${count} animated`;
    badge.title = details.open
        ? 'Parameters with active modulation in this group'
        : 'Collapsed — expand to edit modulators';
}

function refreshAllGroupModBadges(host) {
    if (!host) return;
    host.querySelectorAll('details.uniform-group').forEach(refreshGroupModBadge);
}

function coerceOptionValue(raw, type) {
    const t = (type || 'float').toLowerCase();
    if (t === 'float' || t === 'int' || t === 'bool') {
        const n = Number(raw);
        if (!Number.isFinite(n)) return 0;
        return t === 'int' || t === 'bool' ? Math.round(n) : n;
    }
    return raw;
}

function optionList(def) {
    if (!Array.isArray(def.options)) return [];
    return def.options.map((o) => {
        if (o && typeof o === 'object') {
            return {
                value: coerceOptionValue(o.value, def.type),
                label: o.label != null ? String(o.label) : String(o.value),
            };
        }
        const v = coerceOptionValue(o, def.type);
        return { value: v, label: String(v) };
    });
}

function formatUniformReadout(v, def) {
    if (!Number.isFinite(Number(v))) return String(v);
    const n = Number(v);
    const step = def.step != null ? Number(def.step) : 0.01;
    let decimals = def.decimals;
    if (decimals == null || !Number.isFinite(Number(decimals))) {
        decimals = step > 0 && step < 1
            ? Math.min(4, Math.max(0, Math.ceil(-Math.log10(step))))
            : 0;
    } else {
        decimals = Math.max(0, Math.min(6, Number(decimals)));
    }
    if (def.format === 'percent') {
        const pct = n * 100;
        const body = decimals > 0 ? pct.toFixed(Math.min(decimals, 2)) : String(Math.round(pct));
        const unit = def.unit != null ? String(def.unit) : '%';
        return body + unit;
    }
    if (def.format === 'degrees') {
        const body = decimals > 0 ? n.toFixed(decimals) : String(Math.round(n));
        return body + (def.unit != null ? String(def.unit) : '°');
    }
    const body = decimals > 0 ? n.toFixed(decimals) : String(Math.round(n));
    return def.unit ? body + String(def.unit) : body;
}

/** @deprecated use formatUniformReadout */
function formatNumber(v, step) {
    return formatUniformReadout(v, { step });
}

function createUniformFieldShell(def, widget) {
    const field = document.createElement('div');
    field.className = 'field u-field';
    field.dataset.uniform = def.name;
    field.dataset.widget = widget;
    if (def.group) field.dataset.group = def.group;
    if (def.advanced) field.dataset.advanced = '1';
    if (def.pairWith) field.dataset.pairWith = def.pairWith;
    return field;
}

function makeLabelRow(labelText, forId, readoutText) {
    const label = document.createElement('label');
    label.className = 'u-label';
    if (forId) label.htmlFor = forId;
    const text = document.createElement('span');
    text.className = 'u-label-text';
    text.textContent = labelText;
    label.appendChild(text);
    let readout = null;
    if (readoutText != null) {
        readout = document.createElement('span');
        readout.className = 'value-readout';
        readout.textContent = readoutText;
        label.appendChild(readout);
    }
    return { label, readout };
}

function cloneUniformDefault(def) {
    if (!def || def.default === undefined) {
        const t = (def?.type || 'float').toLowerCase();
        if (t === 'color' || t === 'vec3') return [1, 1, 1];
        if (t === 'vec2') return [0, 0];
        if (t === 'vec4') return [1, 1, 1, 1];
        if (t === 'bool') return 0;
        return 0;
    }
    return Array.isArray(def.default) ? def.default.slice() : def.default;
}

/**
 * Push a value into an already-built uniform field DOM (for reset / pairing).
 */
function applyValueToUniformField(field, def, value) {
    if (!field || !def) return;
    const widget = field.dataset.widget || resolveUniformWidget(def);
    const type = (def.type || 'float').toLowerCase();

    if (widget === 'toggle') {
        const input = field.querySelector('input[type="checkbox"]');
        if (input) input.checked = type === 'bool' ? !!value : Number(value) !== 0;
        return;
    }
    if (widget === 'segmented') {
        const cur = coerceOptionValue(value, type);
        field.querySelectorAll('.u-seg-btn').forEach((btn) => {
            const selected = Number(btn.dataset.value) === Number(cur)
                || btn.dataset.value === String(cur);
            btn.classList.toggle('is-active', selected);
            btn.setAttribute('aria-checked', selected ? 'true' : 'false');
            btn.tabIndex = selected ? 0 : -1;
        });
        return;
    }
    if (widget === 'select') {
        const select = field.querySelector('select');
        if (select) select.value = String(coerceOptionValue(value, type));
        return;
    }
    if (widget === 'color') {
        const input = field.querySelector('input[type="color"]');
        const hex = vecToHex(value);
        if (input) input.value = hex;
        const hexOut = field.querySelector('.u-hex-readout');
        if (hexOut) hexOut.textContent = hex.toUpperCase();
        return;
    }
    if (widget === 'vec') {
        const inputs = [...field.querySelectorAll('.vec-row input')];
        const arr = Array.isArray(value) ? value : [];
        inputs.forEach((el, i) => {
            el.value = arr[i] != null ? arr[i] : 0;
        });
        return;
    }
    // slider | number | stepper (prefer static value, not mod sub-sliders)
    const input = field.querySelector('input[data-role="static-value"]')
        || field.querySelector('.u-static-body input')
        || field.querySelector('input[type="range"], input[type="number"], .u-step-input');
    if (input) input.value = String(value);
    const readout = field.querySelector('.u-label > .value-readout, .u-label .u-mod-live')
        || field.querySelector('.value-readout');
    if (readout && !readout.closest('.u-mod-panel')) {
        readout.textContent = formatUniformReadout(Number(value), def);
    }
}

/**
 * Double-click label → package default for this param; a11y title.
 * @param {{ onReset?: (defaultValue: any) => void }} [extra]
 */
function finishUniformField(field, def, onChange, idPrefix, extra = null) {
    if (!field || !def) return;
    const hint = def.hint ? String(def.hint) : '';
    const resetHint = 'Double-click label to reset';
    field.title = hint ? `${hint} · ${resetHint}` : resetHint;

    const labelId = `${idPrefix}-${def.name}-label`;
    const labelTextEl = field.querySelector('.u-label-text');
    if (labelTextEl && !labelTextEl.id) labelTextEl.id = labelId;

    // Segmented: wire aria-labelledby on radiogroup
    const seg = field.querySelector('.u-segmented[role="radiogroup"]');
    if (seg && labelTextEl && !seg.getAttribute('aria-labelledby')) {
        seg.setAttribute('aria-labelledby', labelTextEl.id);
    }

    // Toggle: accessible name
    const toggle = field.querySelector('.u-toggle-input');
    if (toggle) {
        toggle.setAttribute('aria-label', def.label || def.name);
    }

    const onReset = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const v = cloneUniformDefault(def);
        if (typeof extra?.onReset === 'function') {
            extra.onReset(v);
            return;
        }
        applyValueToUniformField(field, def, v);
        const w = field.dataset.widget || '';
        const continuous = w === 'slider' || w === 'number' || w === 'color' || w === 'vec';
        emitUniformChange(onChange, idPrefix, def.name, v, continuous);
    };

    field.querySelectorAll('.u-label-text, .u-label').forEach((el) => {
        // Skip mod sub-row labels (only main label row)
        if (el.closest && el.closest('.u-mod-panel')) return;
        el.classList.add('u-label-resettable');
        el.addEventListener('dblclick', onReset);
    });
}

/**
 * Emit uniform change: continuous widgets debounced; discrete immediate.
 * @param {(name: string, value: any) => void} onChange
 * @param {string} idPrefix
 * @param {string} name
 * @param {any} value
 * @param {boolean} continuous
 */
function emitUniformChange(onChange, idPrefix, name, value, continuous) {
    if (suppressPublish) return;
    const key = `${idPrefix}:${name}`;
    if (continuous) {
        scheduleUniformPush(key, () => onChange(name, value));
    } else {
        if (uniformDebounce.has(key)) {
            clearTimeout(uniformDebounce.get(key));
            uniformDebounce.delete(key);
        }
        onChange(name, value);
    }
}

function appendToggleField(parent, def, current, onChange, idPrefix) {
    const name = def.name;
    const widget = 'toggle';
    const field = createUniformFieldShell(def, widget);
    const id = `${idPrefix}-${name}`;
    const row = document.createElement('label');
    row.className = 'u-toggle-row';
    row.htmlFor = id;
    const text = document.createElement('span');
    text.className = 'u-label-text';
    text.textContent = def.label || name;
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.className = 'u-toggle-input';
    input.id = id;
    const type = (def.type || 'float').toLowerCase();
    const on = type === 'bool' ? !!current : Number(current) !== 0;
    input.checked = on;
    input.addEventListener('change', () => {
        const v = type === 'bool' ? (input.checked ? 1 : 0) : (input.checked ? 1 : 0);
        emitUniformChange(onChange, idPrefix, name, v, false);
    });
    const track = document.createElement('span');
    track.className = 'u-toggle-track';
    track.setAttribute('aria-hidden', 'true');
    row.appendChild(text);
    row.appendChild(input);
    row.appendChild(track);
    field.appendChild(row);
    finishUniformField(field, def, onChange, idPrefix);
    parent.appendChild(field);
}

function appendSegmentedField(parent, def, current, onChange, idPrefix) {
    const name = def.name;
    const field = createUniformFieldShell(def, 'segmented');
    const label = document.createElement('div');
    label.className = 'u-label';
    const text = document.createElement('span');
    text.className = 'u-label-text';
    text.id = `${idPrefix}-${name}-label`;
    text.textContent = def.label || name;
    label.appendChild(text);
    field.appendChild(label);

    const group = document.createElement('div');
    group.className = 'u-segmented';
    group.setAttribute('role', 'radiogroup');
    group.setAttribute('aria-labelledby', text.id);
    group.setAttribute('aria-label', def.label || name);

    const opts = optionList(def);
    const cur = coerceOptionValue(current, def.type);
    const buttons = [];
    const selectBtn = (btn, opt, focus) => {
        group.querySelectorAll('.u-seg-btn').forEach((b) => {
            b.classList.remove('is-active');
            b.setAttribute('aria-checked', 'false');
            b.tabIndex = -1;
        });
        btn.classList.add('is-active');
        btn.setAttribute('aria-checked', 'true');
        btn.tabIndex = 0;
        if (focus) btn.focus();
        emitUniformChange(onChange, idPrefix, name, opt.value, false);
    };
    for (const opt of opts) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'u-seg-btn';
        btn.setAttribute('role', 'radio');
        btn.dataset.value = String(opt.value);
        btn.textContent = opt.label;
        const selected = Number(opt.value) === Number(cur) || opt.value === cur;
        btn.setAttribute('aria-checked', selected ? 'true' : 'false');
        btn.tabIndex = selected ? 0 : -1;
        if (selected) btn.classList.add('is-active');
        btn.addEventListener('click', () => selectBtn(btn, opt, false));
        btn.addEventListener('keydown', (e) => {
            const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
            if (!keys.includes(e.key)) return;
            e.preventDefault();
            const i = buttons.indexOf(btn);
            if (i < 0) return;
            let next = i;
            if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (i - 1 + buttons.length) % buttons.length;
            else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (i + 1) % buttons.length;
            else if (e.key === 'Home') next = 0;
            else if (e.key === 'End') next = buttons.length - 1;
            selectBtn(buttons[next], opts[next], true);
        });
        buttons.push(btn);
        group.appendChild(btn);
    }
    // If nothing selected (odd value), make first tabbable
    if (buttons.length && !buttons.some((b) => b.tabIndex === 0)) {
        buttons[0].tabIndex = 0;
    }
    field.appendChild(group);
    finishUniformField(field, def, onChange, idPrefix);
    parent.appendChild(field);
}

function appendSelectField(parent, def, current, onChange, idPrefix) {
    const name = def.name;
    const field = createUniformFieldShell(def, 'select');
    const id = `${idPrefix}-${name}`;
    const { label } = makeLabelRow(def.label || name, id, null);
    field.appendChild(label);
    const select = document.createElement('select');
    select.id = id;
    select.className = 'u-select';
    const opts = optionList(def);
    const cur = coerceOptionValue(current, def.type);
    for (const opt of opts) {
        const o = document.createElement('option');
        o.value = String(opt.value);
        o.textContent = opt.label;
        select.appendChild(o);
    }
    // Match current
    const match = opts.find((o) => Number(o.value) === Number(cur) || o.value === cur);
    if (match) select.value = String(match.value);
    select.addEventListener('change', () => {
        emitUniformChange(
            onChange,
            idPrefix,
            name,
            coerceOptionValue(select.value, def.type),
            false,
        );
    });
    field.appendChild(select);
    finishUniformField(field, def, onChange, idPrefix);
    parent.appendChild(field);
}

function appendStepperField(parent, def, current, onChange, idPrefix) {
    const name = def.name;
    const type = (def.type || 'float').toLowerCase();
    const isInt = type === 'int' || (def.step != null && Number(def.step) >= 1);
    const min = def.min != null ? Number(def.min) : null;
    const max = def.max != null ? Number(def.max) : null;
    const step = def.step != null ? Number(def.step) : (isInt ? 1 : 0.1);
    let val = current != null ? Number(current) : Number(def.default) || 0;
    if (isInt) val = Math.round(val);

    const field = createUniformFieldShell(def, 'stepper');
    const id = `${idPrefix}-${name}`;
    const { label, readout } = makeLabelRow(
        def.label || name,
        id,
        formatUniformReadout(val, def),
    );
    field.appendChild(label);

    const row = document.createElement('div');
    row.className = 'u-stepper';
    const minus = document.createElement('button');
    minus.type = 'button';
    minus.className = 'u-step-btn';
    minus.textContent = '−';
    minus.title = 'Decrease';
    const input = document.createElement('input');
    input.type = 'number';
    input.id = id;
    input.className = 'u-step-input';
    input.step = step;
    if (min != null) input.min = min;
    if (max != null) input.max = max;
    input.value = String(val);
    const plus = document.createElement('button');
    plus.type = 'button';
    plus.className = 'u-step-btn';
    plus.textContent = '+';
    plus.title = 'Increase';

    const clamp = (v) => {
        let n = Number(v);
        if (!Number.isFinite(n)) n = min != null ? min : 0;
        if (isInt) n = Math.round(n);
        if (min != null) n = Math.max(min, n);
        if (max != null) n = Math.min(max, n);
        return n;
    };
    const commit = (v) => {
        const n = clamp(v);
        input.value = String(n);
        if (readout) readout.textContent = formatUniformReadout(n, def);
        emitUniformChange(onChange, idPrefix, name, n, false);
    };
    minus.addEventListener('click', () => commit(Number(input.value) - step));
    plus.addEventListener('click', () => commit(Number(input.value) + step));
    input.addEventListener('change', () => commit(input.value));
    // ↑ / ↓ on focused stepper input (and buttons via capture on row)
    const onStepKey = (e) => {
        if (e.key === 'ArrowUp') {
            e.preventDefault();
            commit(Number(input.value) + step);
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            commit(Number(input.value) - step);
        }
    };
    input.addEventListener('keydown', onStepKey);
    minus.addEventListener('keydown', onStepKey);
    plus.addEventListener('keydown', onStepKey);

    row.appendChild(minus);
    row.appendChild(input);
    row.appendChild(plus);
    field.appendChild(row);
    finishUniformField(field, def, onChange, idPrefix);
    parent.appendChild(field);
}

/**
 * Build a compact sub-slider row inside a mod panel.
 */
function makeModSubSlider(opts) {
    const {
        id, labelText, value, min, max, step, unit, onInput, decimals,
    } = opts;
    const row = document.createElement('div');
    row.className = 'u-mod-row';
    const lab = document.createElement('label');
    lab.className = 'u-mod-row-label';
    lab.htmlFor = id;
    const lt = document.createElement('span');
    lt.className = 'u-label-text';
    lt.textContent = labelText;
    const ro = document.createElement('span');
    ro.className = 'value-readout';
    const fmt = (v) => {
        const n = Number(v);
        if (!Number.isFinite(n)) return '—';
        const d = decimals != null ? decimals : 2;
        return d > 0 ? n.toFixed(d) : String(Math.round(n));
    };
    ro.textContent = fmt(value) + (unit || '');
    lab.appendChild(lt);
    lab.appendChild(ro);
    row.appendChild(lab);

    const input = document.createElement('input');
    input.id = id;
    input.className = 'u-slider';
    input.type = 'range';
    if (min != null) input.min = min;
    if (max != null) input.max = max;
    input.step = step != null ? step : 0.01;
    input.value = String(value);
    input.addEventListener('input', () => {
        const v = Number(input.value);
        ro.textContent = fmt(v) + (unit || '');
        onInput(v);
    });
    row.appendChild(input);
    return { row, input, readout: ro };
}

function appendSliderOrNumberField(parent, def, current, onChange, idPrefix, widget, modOpts = null) {
    const name = def.name;
    const type = (def.type || 'float').toLowerCase();
    const isInt = type === 'int';
    const min = def.min != null ? Number(def.min) : null;
    const max = def.max != null ? Number(def.max) : null;
    const step = def.step != null ? Number(def.step) : (isInt ? 1 : 0.01);
    const val = current != null ? Number(current) : Number(def.default) || 0;
    const useRange = widget === 'slider' && min != null && max != null;

    const field = createUniformFieldShell(def, useRange ? 'slider' : 'number');
    const id = `${idPrefix}-${name}`;
    const eligible = isFloatModEligible(def)
        && modOpts
        && typeof modOpts.onModulatorChange === 'function';

    // Local modulator state for this field (mirrors scene + optimistic updates)
    let localMod = eligible && modOpts.modulators && modOpts.modulators[name]
        ? Object.assign({}, modOpts.modulators[name])
        : null;
    if (localMod && !isActiveMod(localMod)) localMod = null;

    const { label, readout } = makeLabelRow(
        def.label || name,
        id,
        formatUniformReadout(val, def),
    );
    if (readout) readout.classList.add('u-mod-live');
    field.appendChild(label);

    // ── Static value input (hidden while modulated) ─────────────────
    const staticBody = document.createElement('div');
    staticBody.className = 'u-static-body';
    const input = document.createElement('input');
    input.id = id;
    input.className = useRange ? 'u-slider' : 'u-number';
    input.dataset.role = 'static-value';
    if (useRange) {
        input.type = 'range';
        input.min = min;
        input.max = max;
        input.step = step;
    } else {
        input.type = 'number';
        if (min != null) input.min = min;
        if (max != null) input.max = max;
        input.step = step;
    }
    input.value = String(val);
    input.addEventListener('input', () => {
        const v = isInt ? Math.round(Number(input.value)) : Number(input.value);
        if (readout && !isActiveMod(localMod)) {
            readout.textContent = formatUniformReadout(v, def);
        }
        emitUniformChange(onChange, idPrefix, name, v, true);
    });
    staticBody.appendChild(input);
    field.appendChild(staticBody);

    if (!eligible) {
        finishUniformField(field, def, onChange, idPrefix);
        parent.appendChild(field);
        return;
    }

    field.dataset.modEligible = '1';
    const bounds = boundsFromDef(def);
    const onModChange = modOpts.onModulatorChange;

    const pushMod = (modOrNull, { immediate = true } = {}) => {
        localMod = modOrNull && isActiveMod(modOrNull) ? Object.assign({}, modOrNull) : null;
        if (modOpts.modulators) {
            if (localMod) modOpts.modulators[name] = Object.assign({}, localMod);
            else delete modOpts.modulators[name];
        }
        const send = () => onModChange(name, localMod);
        if (immediate) send();
        else scheduleUniformPush(`${idPrefix}:mod:${name}`, send);
        applyModUiMode();
    };

    const pushOffset = (offset) => {
        if (!localMod) return;
        localMod = Object.assign({}, localMod, { offset });
        if (modOpts.modulators) modOpts.modulators[name] = Object.assign({}, localMod);
        // Keep base uniform in sync with offset (plan write policy)
        emitUniformChange(onChange, idPrefix, name, offset, true);
        scheduleUniformPush(`${idPrefix}:mod:${name}`, () => onModChange(name, { offset }));
    };

    const pushModField = (key, value) => {
        if (!localMod) return;
        localMod = Object.assign({}, localMod, { [key]: value });
        if (modOpts.modulators) modOpts.modulators[name] = Object.assign({}, localMod);
        scheduleUniformPush(`${idPrefix}:mod:${name}`, () => onModChange(name, { [key]: value }));
    };

    // ── Source segmented control (keyboard-accessible radiogroup) ───
    const sourceRow = document.createElement('div');
    sourceRow.className = 'u-mod-source';
    const sourceGroup = document.createElement('div');
    sourceGroup.className = 'u-segmented u-mod-source-seg';
    sourceGroup.setAttribute('role', 'radiogroup');
    sourceGroup.setAttribute(
        'aria-label',
        `Modulation source for ${def.label || name}`,
    );
    // Prefer labelledby when main label text has an id
    const mainLabelText = field.querySelector('.u-label-text');
    if (mainLabelText) {
        if (!mainLabelText.id) mainLabelText.id = `${id}-label`;
        sourceGroup.setAttribute('aria-labelledby', mainLabelText.id);
    }
    const sourceBtns = {};
    const sourceBtnList = [];
    for (const src of MOD_SOURCES) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'u-seg-btn';
        btn.dataset.source = src.id;
        btn.textContent = src.label;
        btn.title = src.title || src.label;
        btn.setAttribute('role', 'radio');
        btn.setAttribute('aria-label', src.title || src.label);
        btn.addEventListener('click', () => setSource(src.id));
        btn.addEventListener('keydown', (e) => {
            const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
            if (!keys.includes(e.key)) return;
            e.preventDefault();
            const i = sourceBtnList.indexOf(btn);
            if (i < 0) return;
            let next = i;
            if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                next = (i - 1 + sourceBtnList.length) % sourceBtnList.length;
            } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                next = (i + 1) % sourceBtnList.length;
            } else if (e.key === 'Home') next = 0;
            else if (e.key === 'End') next = sourceBtnList.length - 1;
            const nextBtn = sourceBtnList[next];
            nextBtn.focus();
            setSource(nextBtn.dataset.source);
        });
        sourceGroup.appendChild(btn);
        sourceBtns[src.id] = btn;
        sourceBtnList.push(btn);
    }
    sourceRow.appendChild(sourceGroup);
    field.appendChild(sourceRow);

    // ── Mod panel (offset / amp / rate / phase / seed) ───────────────
    const modPanel = document.createElement('div');
    modPanel.className = 'u-mod-panel';
    modPanel.hidden = true;

    const span = modSpan(def);
    const offset0 = localMod && localMod.offset != null ? Number(localMod.offset) : val;
    let ampCap = maxModAmp(def, offset0);
    // Range inputs need a positive max; 0 room → tiny max, value stays 0
    const ampSliderMax = () => Math.max(ampCap, 0.0001);
    const amp0raw = localMod && localMod.amp != null
        ? Number(localMod.amp)
        : defaultModAmp(def, offset0);
    const amp0 = Math.min(Math.max(0, amp0raw), ampCap);
    const rate0 = localMod && localMod.rate != null
        ? Number(localMod.rate)
        : defaultModRate();
    const phase0 = localMod && localMod.phase != null ? Number(localMod.phase) : 0;
    const seed0 = localMod && localMod.seed != null
        ? Number(localMod.seed)
        : (typeof seedFromName === 'function' ? seedFromName(name) : 0);

    const fallbackSpan = span != null ? span : 1;
    const offsetCtl = makeModSubSlider({
        id: `${id}-mod-offset`,
        labelText: 'Offset',
        value: offset0,
        min: min != null ? min : offset0 - fallbackSpan,
        max: max != null ? max : offset0 + fallbackSpan,
        step,
        onInput: (v) => {
            syncAmpCapForOffset(v);
            pushOffset(v);
        },
    });
    const ampCtl = makeModSubSlider({
        id: `${id}-mod-amp`,
        labelText: 'Amp',
        value: amp0,
        min: 0,
        max: ampSliderMax(),
        step: step || 0.01,
        onInput: (v) => {
            // Soft clamp to current cap (range max already enforces)
            const capped = Math.min(Math.max(0, v), ampCap);
            if (capped !== v) {
                ampCtl.input.value = String(capped);
                ampCtl.readout.textContent = Number(capped).toFixed(2);
            }
            pushModField('amp', capped);
        },
    });
    ampCtl.row.title = 'Peak deviation. Capped so offset±amp stays in the package range.';
    const rateCtl = makeModSubSlider({
        id: `${id}-mod-rate`,
        labelText: 'Rate',
        value: rate0,
        min: 0,
        max: 8,
        step: 0.01,
        unit: ' Hz',
        onInput: (v) => pushModField('rate', v),
    });
    rateCtl.row.title = 'Frequency in Hz (sine/noise) or cycles/sec (time saw).';
    const phaseCtl = makeModSubSlider({
        id: `${id}-mod-phase`,
        labelText: 'Phase',
        value: phase0,
        min: 0,
        max: Math.PI * 2,
        step: 0.01,
        onInput: (v) => pushModField('phase', v),
    });
    const seedCtl = makeModSubSlider({
        id: `${id}-mod-seed`,
        labelText: 'Seed',
        value: seed0 % 10000,
        min: 0,
        max: 9999,
        step: 1,
        decimals: 0,
        onInput: (v) => pushModField('seed', Math.round(v)),
    });
    seedCtl.row.classList.add('u-mod-seed-row');

    // Clock: stack (default) | wall | song
    const clockRow = document.createElement('div');
    clockRow.className = 'u-mod-row u-mod-clock-row';
    const clockLab = document.createElement('div');
    clockLab.className = 'u-mod-row-label';
    const clockLabText = document.createElement('span');
    clockLabText.className = 'u-label-text';
    clockLabText.textContent = 'Clock';
    clockLab.appendChild(clockLabText);
    clockRow.appendChild(clockLab);
    const clockGroup = document.createElement('div');
    clockGroup.className = 'u-segmented u-mod-clock-seg';
    clockGroup.setAttribute('role', 'radiogroup');
    clockGroup.setAttribute('aria-label', `Clock for ${def.label || name}`);
    const clock0 = (localMod && localMod.clock) || 'stack';
    const clockBtns = {};
    for (const c of MOD_CLOCKS) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'u-seg-btn';
        btn.dataset.clock = c.id;
        btn.textContent = c.label;
        btn.setAttribute('role', 'radio');
        btn.title = c.id === 'stack'
            ? 'Shader stack time (resets on rebuild)'
            : c.id === 'wall'
                ? 'Wall clock (stable across rebuilds)'
                : 'Song playback time (when music is playing)';
        btn.addEventListener('click', () => setClock(c.id));
        clockGroup.appendChild(btn);
        clockBtns[c.id] = btn;
    }
    clockRow.appendChild(clockGroup);
    clockRow.title = 'Time base for this modulator';

    modPanel.appendChild(offsetCtl.row);
    modPanel.appendChild(ampCtl.row);
    modPanel.appendChild(rateCtl.row);
    modPanel.appendChild(phaseCtl.row);
    modPanel.appendChild(seedCtl.row);
    modPanel.appendChild(clockRow);
    field.appendChild(modPanel);

    function syncClockButtons(clock) {
        const c = clock || 'stack';
        for (const opt of MOD_CLOCKS) {
            const btn = clockBtns[opt.id];
            const on = opt.id === c;
            btn.classList.toggle('is-active', on);
            btn.setAttribute('aria-checked', on ? 'true' : 'false');
            btn.tabIndex = on ? 0 : -1;
        }
    }

    function setClock(nextClock) {
        if (!localMod || suppressPublish) return;
        const c = nextClock === 'wall' || nextClock === 'song' ? nextClock : 'stack';
        localMod = Object.assign({}, localMod);
        if (c === 'stack') delete localMod.clock;
        else localMod.clock = c;
        if (modOpts.modulators) modOpts.modulators[name] = Object.assign({}, localMod);
        syncClockButtons(c);
        // Partial patch; clock: 'stack' clears on display
        onModChange(name, { clock: c });
    }

    /** When offset moves, retighten amp max so bipolar output stays in [min,max]. */
    function syncAmpCapForOffset(offset) {
        ampCap = maxModAmp(def, offset);
        ampCtl.input.max = String(ampSliderMax());
        let amp = Number(ampCtl.input.value);
        if (!Number.isFinite(amp)) amp = 0;
        if (amp > ampCap) {
            amp = ampCap;
            ampCtl.input.value = String(amp);
            ampCtl.readout.textContent = Number(amp).toFixed(2);
            if (localMod) {
                localMod = Object.assign({}, localMod, { amp });
                if (modOpts.modulators) {
                    modOpts.modulators[name] = Object.assign({}, localMod);
                }
                scheduleUniformPush(`${idPrefix}:mod:${name}`, () => onModChange(name, { amp }));
            }
        }
        ampCtl.row.classList.toggle('u-mod-amp-capped', ampCap < (span != null ? span : 1) - 1e-9);
    }

    function syncSourceButtons(source) {
        for (const src of MOD_SOURCES) {
            const btn = sourceBtns[src.id];
            const on = src.id === source;
            btn.classList.toggle('is-active', on);
            btn.setAttribute('aria-checked', on ? 'true' : 'false');
            btn.tabIndex = on ? 0 : -1;
        }
    }

    function applyModUiMode() {
        const active = isActiveMod(localMod);
        const source = active ? localMod.source : 'static';
        field.dataset.modSource = source;
        field.classList.toggle('is-modulated', active);
        staticBody.hidden = active;
        modPanel.hidden = !active;
        seedCtl.row.hidden = !(active && source === 'noise');
        // Phase units: radians for sine; cycles for time/tri/sq/noise
        if (source === 'sine') {
            phaseCtl.input.max = String(Math.PI * 2);
        } else {
            phaseCtl.input.max = '1';
        }
        syncSourceButtons(source);
        syncClockButtons(localMod && localMod.clock ? localMod.clock : 'stack');
        if (readout) {
            readout.classList.toggle('is-live', active);
            readout.setAttribute('aria-live', active ? 'off' : 'off');
            readout.title = active ? 'Live resolved value' : '';
            if (!active) {
                const v = Number(input.value);
                readout.textContent = formatUniformReadout(v, def);
            }
        }
        if (active && localMod) {
            if (localMod.offset != null) {
                offsetCtl.input.value = String(localMod.offset);
                offsetCtl.readout.textContent = Number(localMod.offset).toFixed(2);
            }
        }
        // Update collapsed-group badge counts
        const host = field.closest('.uniform-controls');
        if (host) refreshAllGroupModBadges(host);
    }

    function setSource(nextSource) {
        if (suppressPublish) return;
        const prev = isActiveMod(localMod) ? localMod.source : 'static';
        if (nextSource === prev) return;

        if (nextSource === 'static') {
            // Freeze resolved value into base uniform
            const t = performance.now() / 1000;
            const base = localMod?.offset != null ? Number(localMod.offset) : Number(input.value);
            const frozen = resolveModLocal(base, localMod, t, bounds);
            input.value = String(frozen);
            if (readout) readout.textContent = formatUniformReadout(frozen, def);
            emitUniformChange(onChange, idPrefix, name, frozen, false);
            pushMod(null);
            return;
        }

        // static / other → active source: seed from current slider or offset
        const offset = isActiveMod(localMod) && localMod.offset != null
            ? Number(localMod.offset)
            : Number(input.value);
        const mod = {
            source: nextSource,
            offset: Number.isFinite(offset) ? offset : 0,
            amp: isActiveMod(localMod) && localMod.amp != null
                ? Number(localMod.amp)
                : defaultModAmp(def, offset),
            rate: isActiveMod(localMod) && localMod.rate != null
                ? Number(localMod.rate)
                : defaultModRate(),
            phase: isActiveMod(localMod) && localMod.phase != null
                ? Number(localMod.phase)
                : 0,
        };
        // Cap amp for new offset so first frame stays in package range
        const cap = maxModAmp(def, mod.offset);
        if (mod.amp > cap) mod.amp = cap;
        if (nextSource === 'noise') {
            mod.seed = isActiveMod(localMod) && localMod.seed != null
                ? Number(localMod.seed)
                : (typeof seedFromName === 'function' ? seedFromName(name) : 1);
            seedCtl.input.value = String(mod.seed % 10000);
            seedCtl.readout.textContent = String(Math.round(mod.seed % 10000));
        }
        // Keep uniforms at offset center
        input.value = String(mod.offset);
        offsetCtl.input.value = String(mod.offset);
        offsetCtl.readout.textContent = Number(mod.offset).toFixed(2);
        syncAmpCapForOffset(mod.offset);
        ampCtl.input.value = String(mod.amp);
        ampCtl.readout.textContent = Number(mod.amp).toFixed(2);
        rateCtl.input.value = String(mod.rate);
        rateCtl.readout.textContent = `${Number(mod.rate).toFixed(2)} Hz`;
        phaseCtl.input.value = String(mod.phase);
        phaseCtl.readout.textContent = Number(mod.phase).toFixed(2);
        emitUniformChange(onChange, idPrefix, name, mod.offset, false);
        pushMod(mod);
    }

    // Live readout registration
    registerModReadout({
        el: readout,
        def,
        bounds,
        getMod: () => localMod,
        getBase: () => (localMod && localMod.offset != null
            ? Number(localMod.offset)
            : Number(input.value)),
    });

    applyModUiMode();

    finishUniformField(field, def, onChange, idPrefix, {
        onReset: (defaultVal) => {
            const v = Number(defaultVal) || 0;
            input.value = String(v);
            if (readout) readout.textContent = formatUniformReadout(v, def);
            // Clear modulation + restore package default
            if (isActiveMod(localMod)) {
                localMod = null;
                if (modOpts.modulators) delete modOpts.modulators[name];
                onModChange(name, null);
                applyModUiMode();
            }
            emitUniformChange(onChange, idPrefix, name, v, true);
        },
    });
    parent.appendChild(field);
}

function appendColorField(parent, def, current, onChange, idPrefix) {
    const name = def.name;
    const field = createUniformFieldShell(def, 'color');
    const id = `${idPrefix}-${name}`;
    const hex = vecToHex(current);
    const { label } = makeLabelRow(def.label || name, id, null);
    field.appendChild(label);

    const row = document.createElement('div');
    row.className = 'u-color-row';
    const input = document.createElement('input');
    input.type = 'color';
    input.id = id;
    input.className = 'u-color-input';
    input.value = hex;
    const hexOut = document.createElement('span');
    hexOut.className = 'u-hex-readout';
    hexOut.textContent = hex.toUpperCase();
    input.addEventListener('input', () => {
        hexOut.textContent = input.value.toUpperCase();
        emitUniformChange(onChange, idPrefix, name, hexToVec3(input.value), true);
    });
    row.appendChild(input);
    row.appendChild(hexOut);
    field.appendChild(row);
    finishUniformField(field, def, onChange, idPrefix);
    parent.appendChild(field);
}

function appendVecField(parent, def, current, onChange, idPrefix) {
    const name = def.name;
    const type = (def.type || 'vec3').toLowerCase();
    const n = type === 'vec2' ? 2 : type === 'vec3' ? 3 : 4;
    const field = createUniformFieldShell(def, 'vec');
    const label = document.createElement('div');
    label.className = 'u-label';
    const text = document.createElement('span');
    text.className = 'u-label-text';
    text.textContent = def.label || name;
    label.appendChild(text);
    field.appendChild(label);

    const row = document.createElement('div');
    row.className = 'vec-row';
    const arr = Array.isArray(current) ? current.slice() : new Array(n).fill(0);
    while (arr.length < n) arr.push(0);
    const inputs = [];
    for (let i = 0; i < n; i++) {
        const input = document.createElement('input');
        input.type = 'number';
        input.step = def.step != null ? def.step : 0.01;
        if (def.min != null) input.min = def.min;
        if (def.max != null) input.max = def.max;
        input.value = arr[i];
        input.addEventListener('input', () => {
            const next = inputs.map((el) => Number(el.value));
            emitUniformChange(onChange, idPrefix, name, next, true);
        });
        inputs.push(input);
        row.appendChild(input);
    }
    field.appendChild(row);
    finishUniformField(field, def, onChange, idPrefix);
    parent.appendChild(field);
}

/**
 * Build one uniform field and append to parent.
 * @param {object|null} [modOpts] modulators map + onModulatorChange
 */
function appendUniformField(parent, def, currentValues, onChange, idPrefix, modOpts = null) {
    if (!def || !def.name) return;
    const name = def.name;
    const current = currentValues && currentValues[name] !== undefined
        ? currentValues[name]
        : def.default;
    const widget = resolveUniformWidget(def);

    switch (widget) {
        case 'toggle':
            appendToggleField(parent, def, current, onChange, idPrefix);
            return;
        case 'segmented':
            if (optionList(def).length) {
                appendSegmentedField(parent, def, current, onChange, idPrefix);
                return;
            }
            // Fall through if options missing
            break;
        case 'select':
            if (optionList(def).length) {
                appendSelectField(parent, def, current, onChange, idPrefix);
                return;
            }
            break;
        case 'stepper':
            appendStepperField(parent, def, current, onChange, idPrefix);
            return;
        case 'color':
            appendColorField(parent, def, current, onChange, idPrefix);
            return;
        case 'vec':
            appendVecField(parent, def, current, onChange, idPrefix);
            return;
        case 'slider':
            appendSliderOrNumberField(parent, def, current, onChange, idPrefix, 'slider', modOpts);
            return;
        case 'number':
        default:
            appendSliderOrNumberField(parent, def, current, onChange, idPrefix, 'number', modOpts);
            return;
    }
    // Segmented/select without options → slider/number fallback
    if (def.min != null && def.max != null) {
        appendSliderOrNumberField(parent, def, current, onChange, idPrefix, 'slider', modOpts);
    } else {
        appendSliderOrNumberField(parent, def, current, onChange, idPrefix, 'number', modOpts);
    }
}

/**
 * Default open state for a collapsible uniform group.
 * Short packages: all open. Many groups (>4): open only groups with ≥1 non-advanced param.
 * @param {string} groupName
 * @param {object[]} list  visible defs in this group
 * @param {number} namedGroupCount
 */
function defaultGroupOpen(groupName, list, namedGroupCount) {
    if (!groupName) return true;
    if (namedGroupCount <= 4) return true;
    return list.some((d) => !d.advanced);
}

function groupOpenStorageKey(shaderId, groupName) {
    return `${UG_OPEN_KEY}:${shaderId || '_'}:${groupName}`;
}

function readGroupOpenPref(shaderId, groupName) {
    try {
        const v = sessionStorage.getItem(groupOpenStorageKey(shaderId, groupName));
        if (v === '1') return true;
        if (v === '0') return false;
    } catch (e) { /* ignore */ }
    return null;
}

function writeGroupOpenPref(shaderId, groupName, open) {
    try {
        sessionStorage.setItem(groupOpenStorageKey(shaderId, groupName), open ? '1' : '0');
    } catch (e) { /* ignore */ }
}

/**
 * Build form controls from controls.json uniform defs.
 * Supports optional `group` / `advanced` and schema v1.1 widget fields.
 * Continuous widgets are debounced inside the builder; discrete apply immediately.
 * @param {HTMLElement} host
 * @param {object[]} uniformDefs
 * @param {object} currentValues
 * @param {(name: string, value: any) => void} onChange  raw send (already undebounced)
 * @param {string} idPrefix
 * @param {{
 *   shaderId?: string,
 *   modulators?: object,
 *   onModulatorChange?: (name: string, mod: object|null) => void
 * }} [opts]
 */
function buildUniformControls(host, uniformDefs, currentValues, onChange, idPrefix, opts = {}) {
    host.innerHTML = '';
    const shaderId = opts.shaderId || host.dataset.shaderId || '';
    const defs = Array.isArray(uniformDefs) ? uniformDefs : [];
    // Shared mutable map so field UI can optimistic-update without full re-render
    const modOpts = (typeof opts.onModulatorChange === 'function')
        ? {
            modulators: opts.modulators && typeof opts.modulators === 'object'
                ? opts.modulators
                : {},
            onModulatorChange: opts.onModulatorChange,
        }
        : null;

    if (!defs.length) {
        const p = document.createElement('p');
        p.className = 'empty-uniforms';
        p.textContent = 'No adjustable uniforms for this shader.';
        host.appendChild(p);
        return;
    }

    const hasAdvanced = defs.some((d) => d && d.advanced);
    const visible = defs.filter((d) => d && d.name && (showAdvancedUniforms || !d.advanced));
    const hiddenCount = defs.filter((d) => d && d.name && d.advanced).length;

    if (hasAdvanced) {
        const bar = document.createElement('div');
        bar.className = 'uniform-mode-bar';
        const basicBtn = document.createElement('button');
        basicBtn.type = 'button';
        basicBtn.className = 'uniform-mode-btn' + (!showAdvancedUniforms ? ' is-active' : '');
        basicBtn.textContent = 'Basic';
        basicBtn.title = 'Show primary controls';
        const allBtn = document.createElement('button');
        allBtn.type = 'button';
        allBtn.className = 'uniform-mode-btn' + (showAdvancedUniforms ? ' is-active' : '');
        allBtn.textContent = hiddenCount ? `All (${defs.filter((d) => d?.name).length})` : 'All';
        allBtn.title = 'Show advanced parameters too';
        const setMode = (adv) => {
            showAdvancedUniforms = adv;
            try {
                sessionStorage.setItem(ADV_UNIFORMS_KEY, adv ? '1' : '0');
            } catch (e) { /* ignore */ }
            // Rebuild every uniform host — Look FX, stage background, and
            // Object shader/FX all share this flag. Routing only to
            // renderPostprocess() left Background All/Basic dead.
            if (activeTab === 'look') {
                renderPostprocess();
                renderBackground();
            } else {
                renderContainerEditor();
            }
        };
        basicBtn.addEventListener('click', () => setMode(false));
        allBtn.addEventListener('click', () => setMode(true));
        bar.appendChild(basicBtn);
        bar.appendChild(allBtn);
        if (!showAdvancedUniforms && hiddenCount > 0) {
            const hint = document.createElement('span');
            hint.className = 'uniform-mode-hint';
            hint.textContent = `+${hiddenCount} advanced`;
            bar.appendChild(hint);
        }
        host.appendChild(bar);
    }

    if (!visible.length) {
        const p = document.createElement('p');
        p.className = 'empty-uniforms';
        p.textContent = 'No basic uniforms — switch to All.';
        host.appendChild(p);
        return;
    }

    const groupOrder = [];
    const byGroup = new Map();
    for (const def of visible) {
        const g = (def.group && String(def.group).trim()) || '';
        if (!byGroup.has(g)) {
            byGroup.set(g, []);
            groupOrder.push(g);
        }
        byGroup.get(g).push(def);
    }

    // Drop empty groups (none with zero visible after filter)
    const namedGroups = groupOrder.filter((g) => g);
    const useGroups = namedGroups.length >= 1 && (namedGroups.length > 1 || groupOrder.length > 1);
    const namedGroupCount = namedGroups.length;

    for (const g of groupOrder) {
        const list = byGroup.get(g) || [];
        if (!list.length) continue; // hide empty groups
        let parent = host;
        if (useGroups && g) {
            const details = document.createElement('details');
            details.className = 'uniform-group';
            details.dataset.group = g;
            const pref = readGroupOpenPref(shaderId, g);
            details.open = pref != null ? pref : defaultGroupOpen(g, list, namedGroupCount);
            const summary = document.createElement('summary');
            summary.className = 'uniform-group-title';
            // Text node first so badge can append after
            summary.appendChild(document.createTextNode(g));
            details.appendChild(summary);
            details.addEventListener('toggle', () => {
                writeGroupOpenPref(shaderId, g, details.open);
                refreshGroupModBadge(details);
            });
            host.appendChild(details);
            parent = details;
        } else if (useGroups && !g) {
            const section = document.createElement('div');
            section.className = 'uniform-group uniform-group-ungrouped';
            host.appendChild(section);
            parent = section;
        }
        appendUniformFieldsWithPairs(parent, list, currentValues, onChange, idPrefix, modOpts);
        if (parent && parent.tagName === 'DETAILS') {
            refreshGroupModBadge(parent);
        }
    }
    refreshAllGroupModBadges(host);
}

/**
 * Append visible uniform fields, wrapping mutual/one-way pairWith partners side-by-side.
 */
function appendUniformFieldsWithPairs(parent, list, currentValues, onChange, idPrefix, modOpts = null) {
    const byName = new Map();
    for (const def of list) {
        if (def?.name) byName.set(def.name, def);
    }
    const rendered = new Set();

    for (const def of list) {
        if (!def?.name || rendered.has(def.name)) continue;

        const partnerName = def.pairWith && String(def.pairWith);
        const partner = partnerName ? byName.get(partnerName) : null;
        const canPair = partner
            && !rendered.has(partner.name)
            && (
                !partner.pairWith
                || partner.pairWith === def.name
                || partner.pairWith === def.pairWith
            );

        if (canPair) {
            // Preserve file order within the pair
            const iDef = list.indexOf(def);
            const iPartner = list.indexOf(partner);
            const first = iDef <= iPartner ? def : partner;
            const second = first === def ? partner : def;

            const pair = document.createElement('div');
            pair.className = 'u-pair';
            pair.setAttribute('role', 'group');
            pair.setAttribute(
                'aria-label',
                `${first.label || first.name} / ${second.label || second.name}`,
            );
            appendUniformField(pair, first, currentValues, onChange, idPrefix, modOpts);
            appendUniformField(pair, second, currentValues, onChange, idPrefix, modOpts);
            parent.appendChild(pair);
            rendered.add(first.name);
            rendered.add(second.name);
            continue;
        }

        appendUniformField(parent, def, currentValues, onChange, idPrefix, modOpts);
        rendered.add(def.name);
    }
}

function vecToHex(v) {
    const a = Array.isArray(v) ? v : [1, 1, 1];
    const toByte = (x) => {
        const n = Math.round(Math.max(0, Math.min(1, Number(x))) * 255);
        return n.toString(16).padStart(2, '0');
    };
    return `#${toByte(a[0] ?? 1)}${toByte(a[1] ?? 1)}${toByte(a[2] ?? 1)}`;
}

function hexToVec3(hex) {
    const h = String(hex).replace('#', '');
    if (h.length !== 6) return [1, 1, 1];
    return [
        parseInt(h.slice(0, 2), 16) / 255,
        parseInt(h.slice(2, 4), 16) / 255,
        parseInt(h.slice(4, 6), 16) / 255,
    ];
}

function scheduleUniformPush(key, sendFn) {
    if (uniformDebounce.has(key)) clearTimeout(uniformDebounce.get(key));
    uniformDebounce.set(key, setTimeout(() => {
        uniformDebounce.delete(key);
        sendFn();
    }, 60));
}

// ── Rendering ───────────────────────────────────────────────────────────

function renderShaderSelects() {
    const ppList = shadersForRole('postprocess');
    const cList = shadersForRole('container');
    const options = ppList.map((s) => ({ value: s.id, label: s.name || s.id }));

    fillSelect($('pp-shader'), options);
    fillSelect($('pp-add-shader'), options);
    fillSelect($('cpp-shader'), options);
    fillSelect($('cpp-add-shader'), options);
    fillSelect($('bpp-shader'), options);
    fillSelect($('bpp-add-shader'), options);
    fillSelect(
        $('c-shader'),
        cList.map((s) => ({ value: s.id, label: s.name || s.id })),
    );
    fillSelect(
        $('bg-shader'),
        cList.map((s) => ({ value: s.id, label: s.name || s.id })),
    );

    // Default "add" picker to something useful
    if (!$('pp-add-shader').value && options[0]) {
        const prefer = options.find((o) => o.value === 'grain') || options[0];
        $('pp-add-shader').value = prefer.value;
    }
    if ($('cpp-add-shader') && !$('cpp-add-shader').value && options[0]) {
        const prefer = options.find((o) => o.value === 'grain') || options[0];
        $('cpp-add-shader').value = prefer.value;
    }
    if ($('bpp-add-shader') && !$('bpp-add-shader').value && options[0]) {
        const prefer = options.find((o) => o.value === 'grain') || options[0];
        $('bpp-add-shader').value = prefer.value;
    }
}

function ppLayers() {
    const pp = sceneState.postprocess || {};
    if (Array.isArray(pp.layers) && pp.layers.length) return pp.layers;
    // Legacy single-layer fallback
    if (pp.shaderId) {
        return [{
            id: 1,
            index: 0,
            shaderId: pp.shaderId,
            shaderPath: pp.shaderPath,
            shaderMeta: pp.shaderMeta,
            uniforms: pp.uniforms || {},
            enabled: true,
        }];
    }
    return [];
}

function selectedPpLayer() {
    const layers = ppLayers();
    if (!layers.length) return null;
    if (selectedPpLayerId != null) {
        const found = layers.find((l) => l.id === Number(selectedPpLayerId));
        if (found) return found;
    }
    return layers[0];
}

function cssEscape(s) {
    return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function fillSelect(select, options, { includeEmpty, emptyLabel } = {}) {
    if (!select) return;
    const prev = select.value;
    select.innerHTML = '';
    if (includeEmpty) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = emptyLabel || '— none —';
        select.appendChild(opt);
    }
    for (const o of options) {
        const opt = document.createElement('option');
        opt.value = o.value;
        opt.textContent = o.label;
        select.appendChild(opt);
    }
    if (prev && select.querySelector(`option[value="${cssEscape(prev)}"]`)) {
        select.value = prev;
    }
}

const UNIQUE_PANEL_ROLES = [
    'song-cover', 'song-info', 'song-lyrics', 'song-progress', 'show-progress',
    'audio-scope', 'audio-history', 'audio-beat', 'artef4kt',
];

function genericChip(c) {
    if (c.shaderId) return 'shader';
    if (c.panelKind === 'image' || (c.hasImage && !c.text)) return 'image';
    if (c.text) return 'text';
    return 'blank';
}

function containerChip(c) {
    if (c.role === 'show-progress') return 'show time';
    if (c.role) return String(c.role).replace(/^song-/, '');
    return genericChip(c);
}

function renderContainerSelect() {
    renderContainerList();
}

function renderContainerList() {
    const list = $('container-list');
    const empty = $('container-list-empty');
    if (!list) return;
    list.innerHTML = '';
    const items = sceneState.containers || [];
    if (empty) empty.classList.toggle('hidden', items.length > 0);
    for (const c of items) {
        const row = document.createElement('div');
        row.className = 'container-list-row'
            + (Number(c.id) === Number(selectedId) ? ' selected' : '')
            + (c.visible === false ? ' is-hidden-row' : '');
        row.dataset.id = String(c.id);
        row.setAttribute('role', 'option');
        row.setAttribute('aria-selected', Number(c.id) === Number(selectedId) ? 'true' : 'false');

        const eye = document.createElement('button');
        eye.type = 'button';
        eye.className = 'row-eye';
        eye.textContent = c.visible === false ? '○' : '◉';
        eye.title = c.visible === false ? 'Show panel' : 'Hide panel';
        eye.addEventListener('click', async (e) => {
            e.stopPropagation();
            const result = await cmd('setContainerVisible', { id: c.id, visible: c.visible === false });
            if (result?.ok && result.state) applyState(result.state, { full: true, preserveSelection: true });
        });

        const name = document.createElement('span');
        name.className = 'row-name';
        name.textContent = c.label || c.text || `Panel ${c.id}`;

        const chip = document.createElement('span');
        chip.className = 'row-chip';
        chip.textContent = containerChip(c);

        row.appendChild(eye);
        row.appendChild(name);
        row.appendChild(chip);
        row.addEventListener('click', () => {
            selectedId = c.id;
            selectedCppLayerId = null;
            formDirty = false;
            renderContainerList();
            renderContainerEditor();
            echoSelectionToDisplay(selectedId);
        });
        list.appendChild(row);
    }
}

function takenRoles() {
    const set = new Set();
    for (const c of sceneState.containers || []) {
        if (c.role) set.add(c.role);
    }
    return set;
}

function fillRoleSelect(current) {
    const sel = $('c-role');
    if (!sel) return;
    const taken = takenRoles();
    sel.innerHTML = '';
    const none = document.createElement('option');
    none.value = '';
    none.textContent = 'generic';
    sel.appendChild(none);
    for (const role of UNIQUE_PANEL_ROLES) {
        const opt = document.createElement('option');
        opt.value = role;
        opt.textContent = role === 'show-progress' ? 'show time' : role.replace(/^song-/, '');
        if (taken.has(role) && role !== current) opt.disabled = true;
        sel.appendChild(opt);
    }
    sel.value = current || '';
}

function closeContainerAddMenu() {
    $('container-add-menu')?.classList.add('hidden');
}

function renderContainerAddMenu() {
    const menu = $('container-add-menu');
    if (!menu) return;
    const taken = takenRoles();
    const items = [
        { template: 'blank', label: 'Blank' },
        { template: 'text', label: 'Text' },
        { template: 'shader', label: 'Shader' },
        { template: 'image', label: 'Image' },
        { role: 'song-cover', label: 'Cover' },
        { role: 'song-info', label: 'Track info' },
        { role: 'song-lyrics', label: 'Lyrics' },
        { role: 'song-progress', label: 'Progress' },
        { role: 'show-progress', label: 'Show progress' },
        { role: 'audio-scope', label: 'Scope' },
        { role: 'audio-history', label: 'History' },
        { role: 'audio-beat', label: 'Beat' },
        { role: 'artef4kt', label: 'ARTEF4KT' },
    ];
    menu.innerHTML = '';
    for (const item of items) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn-menu-item';
        btn.setAttribute('role', 'menuitem');
        btn.textContent = item.label;
        if (item.role && taken.has(item.role)) {
            btn.disabled = true;
            btn.title = 'Already on stage';
        }
        btn.addEventListener('click', async () => {
            closeContainerAddMenu();
            const payload = item.role ? { role: item.role } : { template: item.template };
            const result = await cmd('addContainer', payload);
            if (!result?.ok) {
                setStatus(result?.error || 'Add failed', 'error');
                return;
            }
            if (result.state) applyState(result.state, { full: true, preserveSelection: true });
            if (result.id != null) selectedId = result.id;
            if (item.template === 'shader') setObjectSegment('shader');
            renderContainerList();
            renderContainerEditor();
            setStatus('Panel added', 'ok');
        });
        menu.appendChild(btn);
    }
}

/** Close any open per-layer overflow menus */
function closePpLayerMenus() {
    qsAll('.pp-layer-row-menu').forEach((m) => m.classList.add('hidden'));
}

/**
 * Build one FX stack row: drag handle · order · name · eye · ⋮
 */
function buildPpLayerRow(layer, index, layersLen) {
    const meta = metaForShaderId(layer.shaderId, layer.shaderMeta);
    const enabled = layer.enabled !== false;
    const selected = layer.id === Number(selectedPpLayerId);

    const row = document.createElement('div');
    row.className = 'pp-layer-row'
        + (selected ? ' selected' : '')
        + (!enabled ? ' disabled' : '');
    row.dataset.id = String(layer.id);
    row.draggable = false; // armed only from handle pointerdown
    row.title = meta?.description || meta?.name || layer.shaderId || '';

    const handle = document.createElement('span');
    handle.className = 'pp-layer-handle';
    handle.textContent = '⠿';
    handle.title = 'Drag to reorder';
    handle.setAttribute('aria-hidden', 'true');
    // Handle-only drag: arm drag on handle press so click-to-select still works on the row
    handle.addEventListener('pointerdown', () => {
        ppDragAllowed = true;
        row.draggable = true;
    });
    const disarmIfNoDrag = () => {
        // dragend handles cleanup after a real drag; this covers click-without-drag
        requestAnimationFrame(() => {
            if (ppDragId != null) return;
            ppDragAllowed = false;
            row.draggable = false;
        });
    };
    handle.addEventListener('pointerup', disarmIfNoDrag);
    handle.addEventListener('pointercancel', disarmIfNoDrag);

    const order = document.createElement('span');
    order.className = 'pp-layer-order';
    order.textContent = String(index + 1);

    const name = document.createElement('span');
    name.className = 'pp-layer-name';
    name.textContent = meta?.name || layer.shaderId || 'Layer';

    const eye = document.createElement('button');
    eye.type = 'button';
    eye.className = 'pp-layer-eye' + (enabled ? '' : ' is-off');
    eye.textContent = enabled ? '◉' : '○';
    eye.title = enabled ? 'Disable layer' : 'Enable layer';
    eye.setAttribute('aria-label', enabled ? 'Disable layer' : 'Enable layer');
    eye.addEventListener('click', async (e) => {
        e.stopPropagation();
        closePpLayerMenus();
        const result = await cmd('setPostprocessLayerEnabled', {
            id: layer.id,
            enabled: !enabled,
        });
        if (result?.ok && result.state) {
            applyState(result.state, { full: true, preserveSelection: true });
        }
    });

    const menuWrap = document.createElement('div');
    menuWrap.className = 'pp-layer-row-menu-wrap btn-menu-wrap';

    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'pp-layer-more';
    more.textContent = '⋮';
    more.title = 'Layer actions';
    more.setAttribute('aria-haspopup', 'true');
    more.setAttribute('aria-expanded', 'false');

    const menu = document.createElement('div');
    menu.className = 'btn-menu pp-layer-row-menu hidden';
    menu.setAttribute('role', 'menu');

    const mkItem = (label, { danger, onClick } = {}) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn-menu-item' + (danger ? ' danger' : '');
        b.setAttribute('role', 'menuitem');
        b.textContent = label;
        b.addEventListener('click', async (e) => {
            e.stopPropagation();
            closePpLayerMenus();
            await onClick();
        });
        return b;
    };

    menu.appendChild(mkItem('Move up', {
        onClick: async () => {
            if (index <= 0) return;
            const result = await cmd('movePostprocessLayer', { id: layer.id, toIndex: index - 1 });
            if (result?.ok && result.state) applyState(result.state, { full: true, preserveSelection: true });
        },
    }));
    menu.appendChild(mkItem('Move down', {
        onClick: async () => {
            if (index >= layersLen - 1) return;
            const result = await cmd('movePostprocessLayer', { id: layer.id, toIndex: index + 1 });
            if (result?.ok && result.state) applyState(result.state, { full: true, preserveSelection: true });
        },
    }));
    menu.appendChild(mkItem('Remove', {
        danger: true,
        onClick: async () => {
            const result = await cmd('removePostprocessLayer', { id: layer.id });
            if (selectedPpLayerId === layer.id) selectedPpLayerId = null;
            if (result?.ok && result.state) applyState(result.state, { full: true, preserveSelection: true });
        },
    }));

    more.addEventListener('click', (e) => {
        e.stopPropagation();
        const wasOpen = !menu.classList.contains('hidden');
        closePpLayerMenus();
        if (!wasOpen) {
            menu.classList.remove('hidden');
            more.setAttribute('aria-expanded', 'true');
        }
    });

    menuWrap.appendChild(more);
    menuWrap.appendChild(menu);

    row.appendChild(handle);
    row.appendChild(order);
    row.appendChild(name);
    row.appendChild(eye);
    row.appendChild(menuWrap);

    row.addEventListener('click', (e) => {
        if (e.target.closest('button') || e.target.closest('.btn-menu')) return;
        selectedPpLayerId = layer.id;
        closePpLayerMenus();
        renderPostprocess();
    });

    const clearDragMarkers = () => {
        qsAll('.pp-layer-row.drag-over, .pp-layer-row.drag-over-before, .pp-layer-row.drag-over-after')
            .forEach((el) => {
                el.classList.remove('drag-over', 'drag-over-before', 'drag-over-after');
            });
    };

    // ── Drag & drop reorder (handle-armed; insert before/after by mid-point) ──
    row.addEventListener('dragstart', (e) => {
        if (!ppDragAllowed) {
            e.preventDefault();
            return;
        }
        closePpLayerMenus();
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(layer.id));
        try {
            e.dataTransfer.setDragImage(row, 12, 12);
        } catch (err) { /* ignore */ }
        row.classList.add('dragging');
        ppDragId = layer.id;
    });
    row.addEventListener('dragend', () => {
        row.classList.remove('dragging');
        clearDragMarkers();
        ppDragId = null;
        ppDragAllowed = false;
        row.draggable = false;
    });
    row.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const rect = row.getBoundingClientRect();
        const before = e.clientY < rect.top + rect.height / 2;
        row.classList.toggle('drag-over-before', before);
        row.classList.toggle('drag-over-after', !before);
        row.classList.remove('drag-over');
    });
    row.addEventListener('dragleave', () => {
        row.classList.remove('drag-over', 'drag-over-before', 'drag-over-after');
    });
    row.addEventListener('drop', async (e) => {
        e.preventDefault();
        const rect = row.getBoundingClientRect();
        const insertAfter = e.clientY >= rect.top + rect.height / 2;
        clearDragMarkers();
        const fromId = Number(e.dataTransfer.getData('text/plain') || ppDragId);
        const toId = layer.id;
        if (!fromId || fromId === toId) return;

        const layers = ppLayers();
        const ids = layers.map((l) => l.id);
        const from = ids.indexOf(fromId);
        let to = ids.indexOf(toId);
        if (from < 0 || to < 0) return;
        ids.splice(from, 1);
        // After removal, re-find target index
        to = ids.indexOf(toId);
        if (to < 0) return;
        const insertAt = insertAfter ? to + 1 : to;
        ids.splice(insertAt, 0, fromId);

        const result = await cmd('reorderPostprocessLayers', { ids });
        if (result?.ok && result.state) {
            applyState(result.state, { full: true, preserveSelection: true });
        }
    });

    return row;
}

function renderPostprocess() {
    const pp = sceneState.postprocess || {};
    $('pp-active').checked = !!pp.active;

    const layers = ppLayers();
    if (selectedPpLayerId == null && layers[0]) {
        selectedPpLayerId = layers[0].id;
    } else if (selectedPpLayerId != null && !layers.some((l) => l.id === Number(selectedPpLayerId))) {
        selectedPpLayerId = layers[0]?.id ?? null;
    }

    // Layer list
    const list = $('pp-layer-list');
    list.innerHTML = '';
    if (!layers.length) {
        const empty = document.createElement('p');
        empty.className = 'hint';
        empty.textContent = 'No layers — add an effect below.';
        list.appendChild(empty);
    } else {
        layers.forEach((layer, i) => {
            list.appendChild(buildPpLayerRow(layer, i, layers.length));
        });
    }

    // Params drawer for selected layer
    const editor = $('pp-layer-editor');
    const emptyHint = $('pp-layer-empty-hint');
    const layer = selectedPpLayer();
    if (!layer) {
        editor.classList.add('hidden');
        if (emptyHint) emptyHint.classList.toggle('hidden', !layers.length);
        return;
    }
    editor.classList.remove('hidden');
    if (emptyHint) emptyHint.classList.add('hidden');

    const meta = metaForShaderId(layer.shaderId, layer.shaderMeta);
    const step = (layer.index ?? layers.findIndex((l) => l.id === layer.id)) + 1;
    $('pp-layer-title').textContent = meta?.name || layer.shaderId || 'Layer';
    $('pp-layer-index').textContent = `step ${step}/${layers.length}`;
    $('pp-layer-enabled').checked = layer.enabled !== false;

    if (layer.shaderId && $('pp-shader').querySelector(`option[value="${cssEscape(layer.shaderId)}"]`)) {
        $('pp-shader').value = layer.shaderId;
    }
    const desc = meta?.description || '';
    const descEl = $('pp-shader-desc');
    descEl.textContent = desc;
    descEl.title = desc;

    if (!layer.modulators || typeof layer.modulators !== 'object') {
        layer.modulators = {};
    }
    buildUniformControls(
        $('pp-uniforms'),
        meta?.uniforms || [],
        layer.uniforms || {},
        (name, value) => {
            // Debounce is handled inside the widget toolkit (continuous only)
            cmd('setPostprocessLayerUniforms', {
                id: layer.id,
                uniforms: { [name]: value },
            });
            // Optimistic local merge so re-renders keep the value
            if (layer.uniforms) layer.uniforms[name] = value;
        },
        `pp${layer.id}-u`,
        {
            shaderId: layer.shaderId || meta?.id || '',
            modulators: layer.modulators,
            onModulatorChange: (name, mod) => {
                cmd('setPostprocessLayerModulators', {
                    id: layer.id,
                    modulators: { [name]: mod },
                });
                if (!layer.modulators) layer.modulators = {};
                if (mod == null) delete layer.modulators[name];
                else layer.modulators[name] = Object.assign({}, layer.modulators[name] || {}, mod);
            },
        },
    );
}

/**
 * Restore package default uniforms for the selected FX layer (does not remove the layer).
 * Also clears all modulators on that layer.
 */
async function resetSelectedPpLayerDefaults() {
    const layer = selectedPpLayer();
    if (!layer) return;
    const meta = metaForShaderId(layer.shaderId, layer.shaderMeta);
    const defaults = defaultsFromDefs(meta?.uniforms);
    // Clear modulators first so static defaults stick
    await cmd('setPostprocessLayerModulators', {
        id: layer.id,
        modulators: null,
    });
    layer.modulators = {};
    // Full map merge replaces every known package key
    const result = await cmd('setPostprocessLayerUniforms', {
        id: layer.id,
        uniforms: defaults,
    });
    layer.uniforms = Object.assign({}, defaults);
    if (result?.ok && result.state) {
        applyState(result.state, { full: true, preserveSelection: true });
    } else {
        renderPostprocess();
    }
    setStatus('Layer defaults restored', 'ok');
}

function selectedContainer() {
    return sceneState.containers.find((c) => c.id === Number(selectedId)) || null;
}

function audioInputLib() {
    return (typeof window !== 'undefined' && window.AudioInput) || null;
}

function fillAudioChannelSelects() {
    const api = audioInputLib();
    const chans = (api && api.CHANNELS) || [];
    const ids = ['c-audio-source', 'c-audio-envelope', 'c-audio-bass', 'c-audio-mid', 'c-audio-high'];
    for (const id of ids) {
        const sel = $(id);
        if (!sel) continue;
        const prev = sel.value;
        sel.innerHTML = '';
        for (const ch of chans) {
            const opt = document.createElement('option');
            opt.value = ch.id;
            opt.textContent = ch.hz ? `${ch.label} (${ch.hz})` : ch.label;
            sel.appendChild(opt);
        }
        if (prev && chans.some((c) => c.id === prev)) sel.value = prev;
    }
}

function applyAudioFieldVisibility(role) {
    const api = audioInputLib();
    const show = !!(api && api.isAudioInputRole(role));
    const extra = {
        envelope: role === 'audio-beat' || role === 'artef4kt',
        bass: role === 'audio-beat' || role === 'artef4kt',
        mid: role === 'artef4kt',
        high: role === 'artef4kt',
    };
    const wrap = (id, on) => {
        const el = $(id);
        if (el) el.classList.toggle('obj-field-hidden', !on);
    };
    wrap('c-audio-source-wrap', show);
    wrap('c-audio-gain-wrap', show);
    wrap('c-audio-continuous-wrap', show);
    wrap('c-audio-envelope-wrap', extra.envelope);
    wrap('c-audio-bass-wrap', extra.bass);
    wrap('c-audio-mid-wrap', extra.mid);
    wrap('c-audio-high-wrap', extra.high);
    const label = $('c-audio-source-label');
    if (label && api) label.textContent = api.sourceLabel(role);
    const hint = $('c-audio-hint');
    if (hint) {
        if (role === 'audio-scope') {
            hint.textContent = 'Scope uses the full-mix waveform. Source scales the live signal / glow.';
        } else if (role === 'audio-history') {
            hint.textContent = 'History accumulates this channel over time.';
        } else if (role === 'audio-beat') {
            hint.textContent = 'Beat pulse, envelope, and bass each pick their own analysis channel.';
        } else if (role === 'artef4kt') {
            hint.textContent = 'ARTEF4KT band intensities come from these channels. Track still plays from Music.';
        } else {
            hint.textContent = 'This panel listens to Music analysis.';
        }
    }
}

function readAudioInputFromForm(role) {
    const api = audioInputLib();
    if (!api || !api.isAudioInputRole(role)) return null;
    return api.sanitizeAudioInput({
        source: $('c-audio-source')?.value,
        envelope: $('c-audio-envelope')?.value,
        bass: $('c-audio-bass')?.value,
        mid: $('c-audio-mid')?.value,
        high: $('c-audio-high')?.value,
        gain: Number($('c-audio-gain')?.value),
        continuous: !!$('c-audio-continuous')?.checked,
    }, role);
}

function writeAudioInputToForm(c, skipFill) {
    const api = audioInputLib();
    const role = c?.role || null;
    applyAudioFieldVisibility(role);
    if (!api || !api.isAudioInputRole(role)) return;
    fillAudioChannelSelects();
    const inp = api.sanitizeAudioInput(c.audioInput, role);
    const setSel = (id, value) => {
        const el = $(id);
        if (!el || skipFill(id)) return;
        if (value && [...el.options].some((o) => o.value === value)) el.value = value;
    };
    setSel('c-audio-source', inp.source);
    setSel('c-audio-envelope', inp.envelope);
    setSel('c-audio-bass', inp.bass);
    setSel('c-audio-mid', inp.mid);
    setSel('c-audio-high', inp.high);
    if (!skipFill('c-audio-gain') && $('c-audio-gain')) {
        $('c-audio-gain').value = String(inp.gain);
    }
    if (!skipFill('c-audio-continuous') && $('c-audio-continuous')) {
        $('c-audio-continuous').checked = inp.continuous !== false;
    }
    const gv = $('c-audio-gain-val');
    if (gv) gv.textContent = Number(inp.gain).toFixed(2);
}

function setObjectSegment(seg) {
    const allowed = new Set(['transform', 'style', 'motion', 'shader', 'audio', 'artef4kt', 'fx']);
    const next = allowed.has(seg) ? seg : 'transform';
    activeObjectSegment = next;
    try {
        sessionStorage.setItem(OBJ_SEG_STORAGE_KEY, next);
    } catch (e) { /* ignore */ }

    qsAll('.segment-btn').forEach((btn) => {
        btn.classList.toggle('is-active', btn.dataset.segment === next);
    });
    qsAll('.obj-segment').forEach((panel) => {
        const on = panel.dataset.segment === next;
        panel.classList.toggle('is-active', on);
        if (on) panel.removeAttribute('hidden');
        else panel.setAttribute('hidden', '');
    });

    if (next === 'artef4kt') {
        refreshArtef4ktEditor({ force: false });
    }
}

/**
 * Role-aware visibility for Object form regions.
 * Does not remove nodes (ids stay for read/write); toggles .obj-field-hidden / segment availability.
 */
function applyRoleFieldVisibility(c) {
    const role = c?.role || null;
    const isSong = role && SONG_CONTENT_ROLES.has(role);
    const isProgress = role === 'song-progress' || role === 'show-progress';
    // Shader useful for cover / generic; less critical for text-only song panels but still allowed
    const showShader = !role || role === 'song-cover' || role === null || role === undefined
        || !isSong
        || role === 'song-cover';

    // Free text: only non-song containers
    const textWrap = $('c-text-wrap');
    if (textWrap) textWrap.classList.toggle('obj-field-hidden', !!isSong || isProgress);

    // Progress time layout
    const progressTimeWrap = $('c-progress-time-wrap');
    if (progressTimeWrap) {
        if (isProgress) progressTimeWrap.classList.remove('hidden', 'obj-field-hidden');
        else progressTimeWrap.classList.add('hidden');
    }

    // Role badge
    const badge = $('c-role-badge');
    if (badge) {
        if (role) {
            badge.hidden = false;
            badge.textContent = role === 'show-progress' ? 'show time' : role.replace(/^song-/, '');
        } else {
            badge.hidden = true;
            badge.textContent = '';
        }
    }

    // Motion segment: always available
    // Shader segment: hide for song text panels and ARTEF4KT (uses Engine segment instead)
    const isArtef4kt = role === 'artef4kt';
    const hideShaderSeg = isArtef4kt
        || role === 'song-info'
        || role === 'song-lyrics'
        || role === 'song-progress'
        || role === 'show-progress';
    const shaderBtn = $('seg-btn-shader');
    if (shaderBtn) {
        shaderBtn.classList.toggle('obj-field-hidden', hideShaderSeg);
        if (hideShaderSeg && activeObjectSegment === 'shader') {
            setObjectSegment(isArtef4kt ? 'artef4kt' : 'transform');
        }
    }

    const arteBtn = $('seg-btn-artef4kt');
    if (arteBtn) {
        arteBtn.classList.toggle('obj-field-hidden', !isArtef4kt);
        if (!isArtef4kt && activeObjectSegment === 'artef4kt') {
            setObjectSegment('transform');
        }
    }

    const isAudioViz = !!(window.AudioInput && window.AudioInput.isAudioInputRole(role));
    const audioBtn = $('seg-btn-audio');
    if (audioBtn) {
        audioBtn.classList.toggle('obj-field-hidden', !isAudioViz);
        if (!isAudioViz && activeObjectSegment === 'audio') {
            setObjectSegment(isArtef4kt ? 'artef4kt' : 'transform');
        }
    }
    void showShader;
}

// ── ARTEF4KT engine controls (Controls Object → Engine) ───────────────

/** Schema for host-editable ARTEF4KT knobs (no track / transport). */
const ARTEF4KT_CONTROL_SCHEMA = [
    { group: 'Audio reaction', key: 'sensitivity', label: 'Sensitivity', type: 'float', min: 0.1, max: 3, step: 0.05 },
    { group: 'Audio reaction', key: 'smoothing', label: 'Smoothing', type: 'float', min: 0, max: 1, step: 0.05 },
    { group: 'Grid', key: 'gridVisible', label: 'Grid visible', type: 'bool' },
    { group: 'Grid', key: 'gridSize', label: 'Grid size', type: 'float', min: 5, max: 40, step: 1 },
    { group: 'Grid', key: 'gridOpacity', label: 'Grid opacity', type: 'float', min: 0, max: 1, step: 0.05 },
    { group: 'Grid', key: 'gridColor', label: 'Grid color', type: 'colorHex' },
    { group: 'Grid', key: 'gridCellsActivityEnabled', label: 'Grid cells react', type: 'bool' },
    { group: 'Scene', key: 'backgroundColor', label: 'Background', type: 'colorHex' },
    { group: 'Scene', key: 'shadowTransparency', label: 'Shadow opacity', type: 'float', min: 0, max: 1, step: 0.05 },
    { group: 'Scene', key: 'shadowColor', label: 'Shadow color', type: 'colorHex' },
    { group: 'Scene', key: 'linkShadowColor', label: 'Link shadow to grid', type: 'bool' },
    { group: 'Lights', key: 'lightsEnabled', label: 'Lights on', type: 'bool' },
    { group: 'Lights', key: 'lightKeyEnabled', label: 'Key / fill / ambient', type: 'bool' },
    { group: 'Lights', key: 'lightBassEnabled', label: 'Bass spot on', type: 'bool' },
    { group: 'Lights', key: 'lightBassColor', label: 'Bass light', type: 'colorHex' },
    { group: 'Lights', key: 'lightMidEnabled', label: 'Mid spot on', type: 'bool' },
    { group: 'Lights', key: 'lightMidColor', label: 'Mid light', type: 'colorHex' },
    { group: 'Lights', key: 'lightHighEnabled', label: 'High spot on', type: 'bool' },
    { group: 'Lights', key: 'lightHighColor', label: 'High light', type: 'colorHex' },
    { group: 'Environment', key: 'envSphereColor', label: 'Env color', type: 'colorHex' },
    { group: 'Environment', key: 'envSphereSize', label: 'Env size', type: 'float', min: 20, max: 200, step: 1 },
    { group: 'Environment', key: 'envVisibility', label: 'Env visibility', type: 'float', min: 0, max: 1, step: 0.05 },
    // On-screen info overlays (track text, meters, logos) — same as ARTEF4KT “Info Opacity”
    { group: 'Overlays', key: 'uiOpacity', label: 'Info opacity', type: 'float', min: 0, max: 1, step: 0.05 },
    { group: 'Overlays', key: 'overlayShowStatus', label: 'Status line', type: 'bool' },
    { group: 'Overlays', key: 'overlayShowTrackInfo', label: 'Track / time', type: 'bool' },
    { group: 'Overlays', key: 'overlayShowFreq', label: 'Freq bars', type: 'bool' },
    { group: 'Overlays', key: 'overlayShowProgress', label: 'Progress strip', type: 'bool' },
    { group: 'Overlays', key: 'overlayShowLogos', label: 'Logo mark', type: 'bool' },
    // Camera — auto music motion + manual pose + canvas orbit
    { group: 'Camera', key: 'cameraAutoMove', label: 'Auto move (music)', type: 'bool' },
    { group: 'Camera', key: 'cameraOrbitEnabled', label: 'Drag canvas to orbit', type: 'bool' },
    { group: 'Camera', key: 'cameraRotationSpeed', label: 'Orbit speed', type: 'float', min: 0, max: 3, step: 0.05 },
    { group: 'Camera', key: 'cameraElevationIntensity', label: 'Elevation motion', type: 'float', min: 0, max: 15, step: 0.25 },
    { group: 'Camera', key: 'cameraZoomIntensity', label: 'Zoom / breathe', type: 'float', min: 0, max: 6, step: 0.1 },
    { group: 'Camera', key: 'cameraFlyAround', label: 'Fly-around peaks', type: 'bool' },
    { group: 'Camera', key: 'cameraFlyPeak', label: 'Fly-around threshold', type: 'float', min: 0.2, max: 1, step: 0.05 },
    { group: 'Camera', key: 'cameraFlySpeed', label: 'Fly-around speed', type: 'float', min: 1, max: 5, step: 0.1 },
    { group: 'Camera', key: 'cameraOverrideSeconds', label: 'Manual hold (s)', type: 'float', min: 0.5, max: 15, step: 0.5 },
    { group: 'Camera', key: 'cameraAzimuth', label: 'Azimuth (°)', type: 'float', min: -180, max: 180, step: 1 },
    { group: 'Camera', key: 'cameraElevation', label: 'Elevation (°)', type: 'float', min: -25, max: 60, step: 1 },
    { group: 'Camera', key: 'cameraDistance', label: 'Distance', type: 'float', min: 4, max: 120, step: 0.5 },
    { group: 'Shockwave', key: 'shockwaveEnabled', label: 'Shockwaves', type: 'bool' },
    { group: 'Shockwave', key: 'shockwaveIntensity', label: 'Intensity', type: 'float', min: 0, max: 3, step: 0.1 },
    { group: 'Shockwave', key: 'shockwaveLifetime', label: 'Lifetime', type: 'float', min: 0.5, max: 10, step: 0.1 },
    { group: 'Shockwave', key: 'shockwaveOpacity', label: 'Opacity', type: 'float', min: 0, max: 1, step: 0.05 },
    { group: 'Filmic', key: 'filmicTones.enabled', label: 'Filmic on', type: 'bool' },
    { group: 'Filmic', key: 'filmicTones.exposure', label: 'Exposure', type: 'float', min: 0.1, max: 3, step: 0.05 },
    { group: 'Filmic', key: 'filmicTones.contrast', label: 'Contrast', type: 'float', min: 0.1, max: 2.5, step: 0.05 },
    { group: 'Filmic', key: 'filmicTones.saturation', label: 'Saturation', type: 'float', min: 0, max: 2.5, step: 0.05 },
    { group: 'Filmic', key: 'filmicTones.vibrance', label: 'Vibrance', type: 'float', min: -1, max: 1, step: 0.05 },
    { group: 'Filmic', key: 'filmicTones.gamma', label: 'Gamma', type: 'float', min: 0.3, max: 2.5, step: 0.05 },
    { group: 'Filmic', key: 'filmicTones.filmGrainIntensity', label: 'Film grain', type: 'float', min: 0, max: 1, step: 0.01 },
    { group: 'Filmic', key: 'filmicTones.vignetteStrength', label: 'Vignette', type: 'float', min: 0, max: 1, step: 0.01 },
    { group: 'Filmic', key: 'filmicTones.chromaticAberration', label: 'Chromatic', type: 'float', min: 0, max: 2, step: 0.05 },
    { group: 'Filmic', key: 'filmicTones.lensDistortion', label: 'Lens distort', type: 'float', min: 0, max: 1, step: 0.01 },
    { group: 'Filmic', key: 'filmicTones.colorTemperature', label: 'Temperature', type: 'float', min: 2000, max: 10000, step: 50 },
    { group: 'Filmic', key: 'filmicTones.tint', label: 'Tint', type: 'float', min: -1, max: 1, step: 0.05 },
    { group: 'Filmic', key: 'filmicTones.filmHalation', label: 'Halation', type: 'float', min: 0, max: 1, step: 0.01 },
    { group: 'Filmic', key: 'filmicTones.scanlines', label: 'Scanlines', type: 'float', min: 0, max: 1, step: 0.01 },
];

function hexNumToCss(n) {
    let v = Number(n);
    if (!Number.isFinite(v)) v = 0;
    v = Math.max(0, Math.min(0xffffff, Math.round(v))) >>> 0;
    return '#' + v.toString(16).padStart(6, '0');
}

function cssToHexNum(css) {
    const s = String(css || '').trim();
    if (s.startsWith('#')) {
        const h = s.slice(1);
        if (h.length === 3) {
            const r = parseInt(h[0] + h[0], 16);
            const g = parseInt(h[1] + h[1], 16);
            const b = parseInt(h[2] + h[2], 16);
            return (r << 16) | (g << 8) | b;
        }
        const n = parseInt(h.slice(0, 6), 16);
        return Number.isFinite(n) ? n : 0;
    }
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
}

function getArtef4ktPath(obj, path) {
    if (!obj || !path) return undefined;
    const parts = String(path).split('.');
    let cur = obj;
    for (const p of parts) {
        if (cur == null || typeof cur !== 'object') return undefined;
        cur = cur[p];
    }
    return cur;
}

function setArtef4ktPath(obj, path, value) {
    const parts = String(path).split('.');
    const out = {};
    let cur = out;
    for (let i = 0; i < parts.length - 1; i++) {
        cur[parts[i]] = {};
        cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = value;
    // If path is nested under filmicTones, return { filmicTones: { ... } }
    return out;
}

function fillArtef4ktPresetSelect() {
    const sel = $('artef4kt-preset');
    if (!sel) return;
    const prev = sel.value;
    sel.innerHTML = '';
    const opt0 = document.createElement('option');
    opt0.value = '';
    opt0.textContent = '— choose look —';
    sel.appendChild(opt0);
    for (const p of artef4ktPresetList) {
        const o = document.createElement('option');
        o.value = p.id;
        o.textContent = p.name || p.id;
        if (p.description) o.title = p.description;
        sel.appendChild(o);
    }
    const want = artef4ktSettingsId || prev;
    if (want && sel.querySelector(`option[value="${cssEscape(want)}"]`)) {
        sel.value = want;
    }
}

function renderArtef4ktControls() {
    const root = $('artef4kt-controls');
    const status = $('artef4kt-status');
    if (!root) return;

    const c = selectedContainer();
    if (!c || c.role !== 'artef4kt') {
        root.innerHTML = '';
        if (status) status.textContent = 'Select the ARTEF4KT panel to edit engine knobs.';
        return;
    }
    // Never wipe the form while the user is mid-scrub
    const active = document.activeElement;
    const scrubbing = !!(active && root.contains(active)
        && (active.matches('input[type="range"], input[type="number"], input[type="color"], input[type="checkbox"]')));
    if (scrubbing && root.children.length) {
        updateArtef4ktStatusLine();
        return;
    }

    root.innerHTML = '';

    if (artef4ktLoading) {
        updateArtef4ktStatusLine();
        return;
    }
    if (!artef4ktSettings) {
        updateArtef4ktStatusLine();
        return;
    }
    updateArtef4ktStatusLine();

    let lastGroup = null;
    let parent = root;
    for (const def of ARTEF4KT_CONTROL_SCHEMA) {
        if (def.group !== lastGroup) {
            lastGroup = def.group;
            const details = document.createElement('details');
            details.className = 'uniform-group';
            details.open = def.group === 'Audio reaction'
                || def.group === 'Grid'
                || def.group === 'Scene'
                || def.group === 'Overlays'
                || def.group === 'Environment'
                || def.group === 'Camera'
                || def.group === 'Lights';
            const summary = document.createElement('summary');
            summary.className = 'uniform-group-title';
            summary.textContent = def.group;
            details.appendChild(summary);
            root.appendChild(details);
            parent = details;
        }
        let val = getArtef4ktPath(artef4ktSettings, def.key);
        // Overlay / camera toggles default ON when unset
        if (def.type === 'bool' && (val === undefined || val === null)) {
            const k = String(def.key);
            if (k.startsWith('overlayShow')
                || k === 'cameraOrbitEnabled' // manual drag still available
                || k === 'lightsEnabled'
                || k === 'lightKeyEnabled'
                || k === 'lightBassEnabled'
                || k === 'lightMidEnabled'
                || k === 'lightHighEnabled') {
                val = true;
            }
            // Static head-on by default — auto motion off unless settings say otherwise
            if (k === 'cameraAutoMove' || k === 'cameraFlyAround') {
                val = false;
            }
        }
        const field = document.createElement('div');
        field.className = 'u-field';
        field.dataset.artef4ktKey = def.key;

        const label = document.createElement('div');
        label.className = 'u-label';
        const nameSpan = document.createElement('span');
        nameSpan.className = 'u-label-text';
        nameSpan.textContent = def.label || def.key;
        label.appendChild(nameSpan);

        if (def.type === 'bool') {
            const row = document.createElement('label');
            row.className = 'check tight';
            const input = document.createElement('input');
            input.type = 'checkbox';
            input.checked = !!val;
            input.addEventListener('change', () => {
                pushArtef4ktPatch(def.key, !!input.checked);
            });
            row.appendChild(input);
            row.appendChild(document.createTextNode(' ' + (def.label || def.key)));
            field.appendChild(row);
        } else if (def.type === 'colorHex') {
            const row = document.createElement('div');
            row.className = 'u-color-row';
            const input = document.createElement('input');
            input.type = 'color';
            input.value = hexNumToCss(val != null ? val : 0xbbbbbb);
            input.addEventListener('input', () => {
                pushArtef4ktPatch(def.key, cssToHexNum(input.value));
            });
            row.appendChild(input);
            field.appendChild(label);
            field.appendChild(row);
        } else {
            // float slider + number
            const pair = document.createElement('div');
            pair.className = 'u-pair';
            const slider = document.createElement('input');
            slider.type = 'range';
            slider.className = 'u-slider';
            slider.min = String(def.min ?? 0);
            slider.max = String(def.max ?? 1);
            slider.step = String(def.step ?? 0.01);
            const num = Number(val);
            const fallback = def.key === 'uiOpacity' ? 1 : (def.min ?? 0);
            slider.value = String(Number.isFinite(num) ? num : fallback);
            const number = document.createElement('input');
            number.type = 'number';
            number.className = 'u-number';
            number.min = slider.min;
            number.max = slider.max;
            number.step = slider.step;
            number.value = slider.value;
            const sync = (from) => {
                const v = Number(from.value);
                if (!Number.isFinite(v)) return;
                const lo = Number(def.min);
                const hi = Number(def.max);
                const clamped = Number.isFinite(lo) && Number.isFinite(hi)
                    ? Math.min(hi, Math.max(lo, v))
                    : v;
                slider.value = String(clamped);
                number.value = String(clamped);
                pushArtef4ktPatch(def.key, clamped);
            };
            slider.addEventListener('input', () => sync(slider));
            number.addEventListener('change', () => sync(number));
            // Prevent container-editor change handler from also firing updateContainer
            slider.addEventListener('change', (e) => e.stopPropagation());
            number.addEventListener('change', (e) => e.stopPropagation());
            pair.appendChild(slider);
            pair.appendChild(number);
            field.appendChild(label);
            field.appendChild(pair);
        }
        parent.appendChild(field);
    }
}

function mergeArtef4ktPending(path, value) {
    if (!artef4ktPendingPatch || typeof artef4ktPendingPatch !== 'object') {
        artef4ktPendingPatch = {};
    }
    const parts = String(path).split('.');
    let cur = artef4ktPendingPatch;
    for (let i = 0; i < parts.length - 1; i++) {
        if (!cur[parts[i]] || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
        cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = value;
}

function pushArtef4ktPatch(path, value) {
    if (selectedId == null) return;
    const c = selectedContainer();
    if (!c || c.role !== 'artef4kt') return;

    // Optimistic local update
    if (artef4ktSettings) {
        const parts = String(path).split('.');
        let cur = artef4ktSettings;
        for (let i = 0; i < parts.length - 1; i++) {
            if (!cur[parts[i]] || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
            cur = cur[parts[i]];
        }
        cur[parts[parts.length - 1]] = value;
    }

    // Batch concurrent knobs into one IPC patch (avoids clobber races)
    mergeArtef4ktPending(path, value);
    const containerId = Number(selectedId);
    scheduleUniformPush(`artef4kt:batch:${containerId}`, async () => {
        if (selectedId == null) return;
        const patch = artef4ktPendingPatch;
        artef4ktPendingPatch = null;
        if (!patch || !Object.keys(patch).length) return;
        const result = await cmd('setArtef4ktSettings', {
            id: containerId,
            patch,
            partial: true,
        });
        if (result?.ok && result.settings) {
            // Keep optimistic local values; fill any server-only keys
            artef4ktSettings = Object.assign({}, result.settings, artef4ktSettings || {});
            // Re-apply optimistic nested keys that may have been overwritten by stale server snapshot
            if (artef4ktPendingPatch) {
                // another scrub started — leave local as-is
            }
            if (result.settingsId != null) artef4ktSettingsId = result.settingsId;
            if (result.state?.containers) {
                sceneState.containers = result.state.containers;
            }
        } else if (result && !result.ok) {
            setStatus(result.error || 'ARTEF4KT update failed', 'error');
        }
    });
}

async function refreshArtef4ktEditor({ force = true } = {}) {
    const c = selectedContainer();
    const status = $('artef4kt-status');
    if (!c || c.role !== 'artef4kt') {
        artef4ktSettings = null;
        renderArtef4ktControls();
        return;
    }
    const root = $('artef4kt-controls');
    const hasUi = !!(root && root.children.length);
    // Already loaded: do not rebuild the form (kills active sliders)
    if (!force && artef4ktSettings && hasUi) {
        fillArtef4ktPresetSelect();
        updateArtef4ktStatusLine();
        return;
    }
    if (!force && artef4ktSettings && !hasUi) {
        fillArtef4ktPresetSelect();
        renderArtef4ktControls();
        return;
    }
    artef4ktLoading = true;
    if (!hasUi) renderArtef4ktControls();
    else updateArtef4ktStatusLine();
    try {
        const result = await cmd('getArtef4ktSettings', { id: c.id });
        if (result?.ok) {
            artef4ktSettings = result.settings || null;
            artef4ktSettingsId = result.settingsId || null;
            if (Array.isArray(result.presets)) artef4ktPresetList = result.presets;
            if (result.state?.containers) sceneState.containers = result.state.containers;
        } else if (status) {
            status.textContent = result?.error || 'Could not read ARTEF4KT settings';
        }
    } catch (e) {
        if (status) status.textContent = String(e && e.message ? e.message : e);
    } finally {
        artef4ktLoading = false;
        fillArtef4ktPresetSelect();
        // Rebuild only when needed (first open / force refresh)
        renderArtef4ktControls();
    }
}

function updateArtef4ktStatusLine() {
    const status = $('artef4kt-status');
    if (!status) return;
    if (artef4ktLoading) {
        status.textContent = 'Loading engine settings…';
        return;
    }
    if (!artef4ktSettings) {
        status.textContent = 'No settings yet — click ↻ or wait for the embed to mount.';
        return;
    }
    status.textContent = artef4ktSettingsId
        ? `Live engine · look “${artef4ktSettingsId}” · song from Music`
        : 'Live engine · custom knobs · song from Music';
}

async function loadSelectedArtef4ktPreset() {
    const c = selectedContainer();
    if (!c || c.role !== 'artef4kt') return;
    const id = $('artef4kt-preset')?.value;
    if (!id) {
        setStatus('Choose an ARTEF4KT look preset', 'error');
        return;
    }
    setStatus('Loading ARTEF4KT look…');
    const result = await cmd('loadArtef4ktPreset', {
        id: c.id,
        settingsId: id,
    });
    if (result?.ok) {
        artef4ktSettings = result.settings || null;
        artef4ktSettingsId = result.settingsId || id;
        if (result.state?.containers) sceneState.containers = result.state.containers;
        fillArtef4ktPresetSelect();
        renderArtef4ktControls();
        setStatus(`ARTEF4KT look “${artef4ktSettingsId}”`, 'ok');
    } else {
        setStatus(result?.error || 'Load failed', 'error');
    }
}

/**
 * Build updateContainer payload from visible / role-allowed fields only.
 * Never sends `text` for song-* roles (music owns content).
 */
function readContainerForm() {
    const c = selectedContainer();
    const role = c?.role || null;
    const isSong = role && SONG_CONTENT_ROLES.has(role);
    const anchorRaw = $('c-anchor').value.trim();
    const bgOn = $('c-label-bg-on').checked;

    const payload = {
        id: Number(selectedId),
        label: $('c-label').value,
        labelEnabled: $('c-label-enabled').checked,
        labelCorner: $('c-label-corner').value || 'bottom-right',
        left: Number($('c-left').value),
        top: Number($('c-top').value),
        width: Number($('c-width').value),
        height: Number($('c-height').value),
        layer: Number($('c-layer').value),
        distancing: Number($('c-distancing').value),
        wander: $('c-wander').checked,
        connect: $('c-connect').checked,
        wanderAmplitude: Number($('c-amp').value),
        wanderFrequency: Number($('c-freq').value),
        anchorDistance: anchorRaw === '' ? null : Number(anchorRaw),
        attachToId: $('c-attach').value === '' ? null : Number($('c-attach').value),
        labelStyle: {
            fontFamily: $('c-label-font').value,
            fontSize: Number($('c-label-size').value),
            fontWeight: $('c-label-weight').value,
            fontStyle: $('c-label-style').value,
            color: $('c-label-color').value,
            background: bgOn ? $('c-label-bg').value : 'transparent',
            letterSpacing: Number($('c-label-tracking').value),
            opacity: Number($('c-label-opacity').value),
        },
        style: {
            border: {
                color: $('c-border-color').value,
                lineWidth: Number($('c-border-width').value),
            },
            connect: {
                color: $('c-connect-color').value,
                lineWidth: Number($('c-connect-width').value),
            },
            label: {
                fontFamily: $('c-label-font').value,
                fontSize: Number($('c-label-size').value),
                fontWeight: $('c-label-weight').value,
                fontStyle: $('c-label-style').value,
                color: $('c-label-color').value,
                background: bgOn ? $('c-label-bg').value : 'transparent',
                letterSpacing: Number($('c-label-tracking').value),
                opacity: Number($('c-label-opacity').value),
            },
            text: {
                fontFamily: $('c-label-font').value,
                fontSize: Number($('c-label-size').value),
                fontWeight: $('c-label-weight').value,
                fontStyle: $('c-label-style').value,
                color: $('c-label-color').value,
                letterSpacing: Number($('c-label-tracking').value),
                opacity: Number($('c-label-opacity').value),
            },
            textAlign: ($('c-text-align')?.value || 'center'),
            padding: Number($('c-padding')?.value ?? 0),
        },
    };

    // Only send free text for non-song containers
    if (!isSong) {
        payload.text = $('c-text').value;
    }

    if (role === 'song-progress' || role === 'show-progress') {
        payload.progressTimeMode = $('c-progress-time-mode').value === 'center' ? 'center' : 'ends';
    }

    const audioInput = readAudioInputFromForm(role);
    if (audioInput) payload.audioInput = audioInput;

    return payload;
}

/** Debounced live push of container fields (not shaders). */
function scheduleContainerLiveApply() {
    if (selectedId == null) return;
    scheduleUniformPush(`container-live:${selectedId}`, async () => {
        if (selectedId == null) return;
        const payload = readContainerForm();
        // Live apply should not thrash formDirty forever — clear after success path
        const result = await cmd('updateContainer', payload);
        if (result?.ok) {
            formDirty = false;
            // Soft merge: full state may reset segment; only update scene snapshot lightly
            if (result.state) {
                applyState(result.state, { full: false, preserveSelection: true });
                // Keep local container fields if full re-render skipped
                if (result.state.containers) {
                    sceneState.containers = result.state.containers;
                }
            }
        }
    });
}

function renderContainerEditor() {
    const c = selectedContainer();
    const editor = $('container-editor');
    if (!c) {
        editor.classList.add('hidden');
        return;
    }
    editor.classList.remove('hidden');

    applyRoleFieldVisibility(c);
    fillRoleSelect(c.role);
    setObjectSegment(activeObjectSegment);
    writeAudioInputToForm(c, (id) => document.activeElement && document.activeElement.id === id);

    // ARTEF4KT Engine segment: seed / refresh without thrashing live knobs
    if (c.role === 'artef4kt') {
        if (!artef4ktSettings && c.embed?.settings && typeof c.embed.settings === 'object') {
            artef4ktSettings = c.embed.settings;
            artef4ktSettingsId = c.embed.settingsId || artef4ktSettingsId;
        }
        if (activeObjectSegment === 'artef4kt') {
            // force only when we have no settings yet
            refreshArtef4ktEditor({ force: !artef4ktSettings });
        }
    } else if (artef4ktSettings) {
        artef4ktSettings = null;
        artef4ktPendingPatch = null;
    }

    // Don't clobber focused inputs during live apply re-render
    const active = document.activeElement;
    const activeId = active && active.id ? active.id : null;
    const skipFill = (id) => activeId === id;

    if (!skipFill('c-text')) $('c-text').value = c.text || '';
    if (!skipFill('c-label')) $('c-label').value = c.label || '';
    if (!skipFill('c-label-enabled')) $('c-label-enabled').checked = c.labelEnabled !== false;
    if (!skipFill('c-label-corner')) $('c-label-corner').value = c.labelCorner || 'bottom-right';

    const ls = c.style?.label || c.style?.text || {};
    const fontVal = ls.fontFamily || 'system-ui, -apple-system, "Segoe UI", sans-serif';
    const fontSelect = $('c-label-font');
    if (!skipFill('c-label-font')) {
        if (fontSelect.querySelector(`option[value="${cssEscape(fontVal)}"]`)) {
            fontSelect.value = fontVal;
        } else {
            fontSelect.value = fontSelect.options[0]?.value || fontVal;
        }
    }
    if (!skipFill('c-label-size')) $('c-label-size').value = ls.fontSize != null ? ls.fontSize : 12;
    if (!skipFill('c-label-weight')) $('c-label-weight').value = String(ls.fontWeight != null ? ls.fontWeight : '600');
    if (!skipFill('c-label-style')) $('c-label-style').value = ls.fontStyle === 'italic' ? 'italic' : 'normal';
    if (!skipFill('c-label-color')) $('c-label-color').value = normalizeColor(ls.color || '#111111');
    const bgOn = ls.background && ls.background !== 'transparent' && ls.background !== 'none';
    if (!skipFill('c-label-bg-on')) $('c-label-bg-on').checked = !!bgOn;
    if (!skipFill('c-label-bg')) $('c-label-bg').value = bgOn ? normalizeColor(ls.background) : '#ffffff';
    $('c-label-bg').disabled = !$('c-label-bg-on').checked;
    if (!skipFill('c-label-tracking')) $('c-label-tracking').value = ls.letterSpacing != null ? ls.letterSpacing : 0;
    if (!skipFill('c-label-opacity')) $('c-label-opacity').value = ls.opacity != null ? ls.opacity : 1;

    if (!skipFill('c-left')) $('c-left').value = Math.round(c.left);
    if (!skipFill('c-top')) $('c-top').value = Math.round(c.top);
    if (!skipFill('c-width')) $('c-width').value = Math.round(c.width);
    if (!skipFill('c-height')) $('c-height').value = Math.round(c.height);
    if (!skipFill('c-layer')) $('c-layer').value = c.layer ?? 0;
    if (!skipFill('c-distancing')) $('c-distancing').value = c.distancing ?? 0;
    if (!skipFill('c-wander')) $('c-wander').checked = !!c.wander;
    if (!skipFill('c-connect')) $('c-connect').checked = !!c.connect;
    if (!skipFill('c-amp')) $('c-amp').value = c.wanderAmplitude ?? 1;
    if (!skipFill('c-freq')) $('c-freq').value = c.wanderFrequency ?? 12;
    if (!skipFill('c-anchor')) $('c-anchor').value = c.anchorDistance == null ? '' : c.anchorDistance;

    fillSelect(
        $('c-attach'),
        sceneState.containers
            .filter((o) => o.id !== c.id)
            .map((o) => ({ value: String(o.id), label: `#${o.id} — ${o.label || o.text || 'Container'}` })),
        { includeEmpty: true, emptyLabel: '— none —' },
    );
    if (!skipFill('c-attach')) {
        $('c-attach').value = c.attachToId != null ? String(c.attachToId) : '';
    }

    if (!skipFill('c-border-color')) $('c-border-color').value = normalizeColor(c.style?.border?.color || '#000000');
    if (!skipFill('c-border-width')) $('c-border-width').value = c.style?.border?.lineWidth ?? 2;
    if (!skipFill('c-connect-color')) $('c-connect-color').value = normalizeColor(c.style?.connect?.color || '#000000');
    if (!skipFill('c-connect-width')) $('c-connect-width').value = c.style?.connect?.lineWidth ?? 2;

    const textAlignVal = (c.style?.textAlign || 'center').toLowerCase();
    if (!skipFill('c-text-align') && $('c-text-align')) {
        const allowed = ['center', 'left', 'right', 'justify'];
        $('c-text-align').value = allowed.includes(textAlignVal) ? textAlignVal : 'center';
    }
    if (!skipFill('c-padding') && $('c-padding')) {
        const pad = Number(c.style?.padding);
        $('c-padding').value = Number.isFinite(pad) && pad >= 0 ? pad : 0;
    }

    if ((c.role === 'song-progress' || c.role === 'show-progress') && !skipFill('c-progress-time-mode')) {
        $('c-progress-time-mode').value =
            c.progressTimeMode === 'center' ? 'center' : 'ends';
    }

    // Shader package select + generated uniforms
    const status = $('c-shader-status');
    if (c.hasShader) {
        const meta = metaForShaderId(c.shaderId, c.shaderMeta);
        status.textContent = `Active: ${meta?.name || c.shaderId || '(inline)'}`;
    } else {
        status.textContent = 'No shader';
    }

    const selectId = c.shaderId || $('c-shader').value;
    if (selectId && $('c-shader').querySelector(`option[value="${cssEscape(selectId)}"]`)) {
        if (!skipFill('c-shader')) $('c-shader').value = selectId;
    }

    const previewId = c.hasShader ? (c.shaderId || $('c-shader').value) : $('c-shader').value;
    const meta = metaForShaderId(previewId, c.shaderMeta);
    $('c-shader-desc').textContent = meta?.description || '';

    if (!c.shaderModulators || typeof c.shaderModulators !== 'object') {
        c.shaderModulators = {};
    }
    buildUniformControls(
        $('c-uniforms'),
        meta?.uniforms || [],
        c.shaderUniforms || {},
        (name, value) => {
            if (!c.hasShader) return;
            cmd('setContainerUniforms', {
                id: c.id,
                uniforms: { [name]: value },
            });
            if (c.shaderUniforms) c.shaderUniforms[name] = value;
        },
        `c${c.id}-u`,
        {
            shaderId: previewId || c.shaderId || meta?.id || '',
            // Only live-modulate when package is active on the container
            modulators: c.hasShader ? c.shaderModulators : {},
            onModulatorChange: c.hasShader
                ? (name, mod) => {
                    cmd('setContainerModulators', {
                        id: c.id,
                        modulators: { [name]: mod },
                    });
                    if (!c.shaderModulators) c.shaderModulators = {};
                    if (mod == null) delete c.shaderModulators[name];
                    else {
                        c.shaderModulators[name] = Object.assign(
                            {},
                            c.shaderModulators[name] || {},
                            mod,
                        );
                    }
                }
                : null,
        },
    );

    renderContainerPostprocess();
}

// ── Per-container FX stack (Object → FX) ────────────────────────────────

function cppLayers() {
    const c = selectedContainer();
    const pp = c?.postprocess;
    if (pp && Array.isArray(pp.layers)) return pp.layers;
    return [];
}

function selectedCppLayer() {
    const layers = cppLayers();
    if (!layers.length) return null;
    if (selectedCppLayerId != null) {
        const found = layers.find((l) => l.id === Number(selectedCppLayerId));
        if (found) return found;
    }
    return layers[0];
}

/**
 * Build one row for the selected container's FX stack.
 */
function buildCppLayerRow(layer, index, layersLen) {
    const meta = metaForShaderId(layer.shaderId, layer.shaderMeta);
    const enabled = layer.enabled !== false;
    const selected = layer.id === Number(selectedCppLayerId);
    const c = selectedContainer();
    const containerId = c?.id;

    const row = document.createElement('div');
    row.className = 'pp-layer-row'
        + (selected ? ' selected' : '')
        + (!enabled ? ' disabled' : '');
    row.dataset.id = String(layer.id);
    row.title = meta?.description || meta?.name || layer.shaderId || '';

    const order = document.createElement('span');
    order.className = 'pp-layer-order';
    order.textContent = String(index + 1);

    const name = document.createElement('span');
    name.className = 'pp-layer-name';
    name.textContent = meta?.name || layer.shaderId || 'Layer';

    const eye = document.createElement('button');
    eye.type = 'button';
    eye.className = 'pp-layer-eye' + (enabled ? '' : ' is-off');
    eye.textContent = enabled ? '◉' : '○';
    eye.title = enabled ? 'Disable layer' : 'Enable layer';
    eye.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (containerId == null) return;
        const result = await cmd('setContainerPostprocessLayerEnabled', {
            id: containerId,
            layerId: layer.id,
            enabled: !enabled,
        });
        if (result?.ok && result.state) {
            applyState(result.state, { full: true, preserveSelection: true });
        }
    });

    row.appendChild(order);
    row.appendChild(name);
    row.appendChild(eye);

    row.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        selectedCppLayerId = layer.id;
        renderContainerPostprocess();
    });

    return row;
}

function renderContainerPostprocess() {
    const c = selectedContainer();
    const activeEl = $('cpp-active');
    const list = $('cpp-layer-list');
    const editor = $('cpp-layer-editor');
    const emptyHint = $('cpp-layer-empty-hint');
    if (!activeEl || !list || !editor) return;

    if (!c) {
        activeEl.checked = false;
        list.innerHTML = '';
        editor.classList.add('hidden');
        if (emptyHint) {
            emptyHint.classList.remove('hidden');
            emptyHint.textContent = 'Select a panel to edit its FX stack.';
        }
        return;
    }

    const pp = c.postprocess || { active: false, layers: [] };
    activeEl.checked = !!pp.active;

    const layers = cppLayers();
    if (selectedCppLayerId == null && layers[0]) {
        selectedCppLayerId = layers[0].id;
    } else if (selectedCppLayerId != null && !layers.some((l) => l.id === Number(selectedCppLayerId))) {
        selectedCppLayerId = layers[0]?.id ?? null;
    }

    list.innerHTML = '';
    if (!layers.length) {
        const empty = document.createElement('p');
        empty.className = 'hint';
        empty.textContent = 'No layers — add an effect below.';
        list.appendChild(empty);
    } else {
        layers.forEach((layer, i) => {
            list.appendChild(buildCppLayerRow(layer, i, layers.length));
        });
    }

    const layer = selectedCppLayer();
    if (!layer) {
        editor.classList.add('hidden');
        if (emptyHint) {
            emptyHint.classList.toggle('hidden', !!layers.length);
            emptyHint.textContent = 'Add a postprocess package to stack effects on this panel.';
        }
        return;
    }
    editor.classList.remove('hidden');
    if (emptyHint) emptyHint.classList.add('hidden');

    const meta = metaForShaderId(layer.shaderId, layer.shaderMeta);
    const step = (layer.index ?? layers.findIndex((l) => l.id === layer.id)) + 1;
    if ($('cpp-layer-title')) {
        $('cpp-layer-title').textContent = meta?.name || layer.shaderId || 'Layer';
    }
    if ($('cpp-layer-index')) {
        $('cpp-layer-index').textContent = `step ${step}/${layers.length}`;
    }
    if ($('cpp-layer-enabled')) {
        $('cpp-layer-enabled').checked = layer.enabled !== false;
    }

    if (layer.shaderId && $('cpp-shader')?.querySelector(`option[value="${cssEscape(layer.shaderId)}"]`)) {
        $('cpp-shader').value = layer.shaderId;
    }
    const desc = meta?.description || '';
    const descEl = $('cpp-shader-desc');
    if (descEl) {
        descEl.textContent = desc;
        descEl.title = desc;
    }

    if (!layer.modulators || typeof layer.modulators !== 'object') {
        layer.modulators = {};
    }
    buildUniformControls(
        $('cpp-uniforms'),
        meta?.uniforms || [],
        layer.uniforms || {},
        (name, value) => {
            cmd('setContainerPostprocessLayerUniforms', {
                id: c.id,
                layerId: layer.id,
                uniforms: { [name]: value },
            });
            if (layer.uniforms) layer.uniforms[name] = value;
        },
        `cpp${c.id}-l${layer.id}-u`,
        {
            shaderId: layer.shaderId || meta?.id || '',
            modulators: layer.modulators,
            onModulatorChange: (name, mod) => {
                cmd('setContainerPostprocessLayerModulators', {
                    id: c.id,
                    layerId: layer.id,
                    modulators: { [name]: mod },
                });
                if (!layer.modulators) layer.modulators = {};
                if (mod == null) delete layer.modulators[name];
                else {
                    layer.modulators[name] = Object.assign(
                        {},
                        layer.modulators[name] || {},
                        mod,
                    );
                }
            },
        },
    );
}

function normalizeColor(c) {
    if (!c) return '#000000';
    if (c.startsWith('#') && c.length === 7) return c;
    const m = String(c).match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
    if (m) {
        const hex = (n) => Number(n).toString(16).padStart(2, '0');
        return `#${hex(m[1])}${hex(m[2])}${hex(m[3])}`;
    }
    return '#000000';
}

/**
 * Read current values from a uniform host by walking defs + inputs.
 * Fields hidden by Basic mode (advanced collapsed) fall back to baseValues, then defaults —
 * so Apply never wipes advanced uniforms that aren't on screen.
 * @param {HTMLElement} host
 * @param {object[]} uniformDefs
 * @param {object|null} [baseValues]
 */
function readUniformsFromHost(host, uniformDefs, baseValues = null) {
    const out = {};
    const defs = Array.isArray(uniformDefs) ? uniformDefs : [];
    for (const def of defs) {
        if (!def?.name) continue;
        const field = host.querySelector(`[data-uniform="${cssEscape(def.name)}"]`);
        if (!field) {
            if (baseValues && baseValues[def.name] !== undefined) {
                const v = baseValues[def.name];
                out[def.name] = Array.isArray(v) ? v.slice() : v;
            } else if (def.default !== undefined) {
                out[def.name] = Array.isArray(def.default) ? def.default.slice() : def.default;
            }
            continue;
        }
        const type = (def.type || 'float').toLowerCase();
        const widget = field.dataset.widget || resolveUniformWidget(def);

        if (widget === 'toggle' || type === 'bool') {
            const input = field.querySelector('input[type="checkbox"]');
            out[def.name] = input && input.checked ? 1 : 0;
            continue;
        }
        if (widget === 'segmented') {
            const active = field.querySelector('.u-seg-btn.is-active, .u-seg-btn[aria-checked="true"]');
            out[def.name] = coerceOptionValue(active?.dataset.value ?? def.default ?? 0, type);
            continue;
        }
        if (widget === 'select') {
            const select = field.querySelector('select');
            out[def.name] = coerceOptionValue(select?.value ?? def.default ?? 0, type);
            continue;
        }
        if (widget === 'color' || type === 'color') {
            const input = field.querySelector('input[type="color"]');
            out[def.name] = hexToVec3(input?.value || '#ffffff');
            continue;
        }
        if (widget === 'vec' || type === 'vec2' || type === 'vec3' || type === 'vec4') {
            const inputs = [...field.querySelectorAll('.vec-row input')];
            out[def.name] = inputs.map((el) => Number(el.value));
            continue;
        }
        // slider | number | stepper (prefer static value over mod sub-sliders)
        const input = field.querySelector('input[data-role="static-value"]')
            || field.querySelector('.u-static-body input')
            || field.querySelector('input[type="range"], input[type="number"], .u-step-input, input');
        const v = Number(input?.value);
        out[def.name] = type === 'int' ? Math.round(v) : v;
    }
    return out;
}

function loadUi() {
    return window.__musicViewLoad || null;
}

async function refreshFull() {
    setStatus('Loading…');
    const load = loadUi();
    if (load) load.set(70, 'Syncing scene…');
    const result = await cmd('getState', null, { retries: 20 });
    if (result?.ok && result.state) {
        if (result.state.shaders) sceneState.shaders = result.state.shaders;
        applyState(result.state, { preserveSelection: true, full: true });
        setStatus('Synced', 'ok');
    } else if (!result?.ok) {
        setStatus(result?.error || 'Failed to sync', 'error');
    }
}

function closeWorkspaceMenus() {
    closePresetSaveMenu();
    closePpLayerMenus();
}

function focusPresetSearch() {
    const el = $('preset-search');
    if (!el) return;
    el.focus();
    if (el.select) el.select();
}

function cycleObject(delta) {
    const list = sceneState.containers || [];
    if (!list.length) return;
    const cur = list.findIndex((c) => c.id === Number(selectedId));
    const dir = Number(delta) >= 0 ? 1 : -1;
    const nextIdx = dir > 0
        ? (cur < 0 ? 0 : (cur + 1) % list.length)
        : (cur <= 0 ? list.length - 1 : cur - 1);
    selectedId = list[nextIdx].id;
    formDirty = false;
    renderContainerList();
    renderContainerEditor();
    echoSelectionToDisplay(selectedId);
}

function toggleLookLayer() {
    const layer = selectedPpLayer();
    if (!layer) return;
    const enabled = layer.enabled !== false;
    cmd('setPostprocessLayerEnabled', {
        id: layer.id,
        enabled: !enabled,
    }).then((result) => {
        if (result?.ok && result.state) {
            applyState(result.state, { full: true, preserveSelection: true });
        }
    });
}

function removeLookLayer() {
    const layer = selectedPpLayer();
    if (!layer) return;
    cmd('removePostprocessLayer', { id: layer.id }).then((result) => {
        selectedPpLayerId = null;
        if (result?.ok && result.state) {
            applyState(result.state, { full: true, preserveSelection: true });
        }
    });
}

function moveLookLayer(delta) {
    if (selectedPpLayerId == null) return;
    const layers = ppLayers();
    const idx = layers.findIndex((l) => l.id === Number(selectedPpLayerId));
    if (idx < 0) return;
    const toIndex = idx + (Number(delta) || 0);
    if (toIndex < 0 || toIndex >= layers.length) return;
    cmd('movePostprocessLayer', { id: selectedPpLayerId, toIndex }).then((result) => {
        if (result?.ok && result.state) {
            applyState(result.state, { full: true, preserveSelection: true });
        }
    });
}

function setActiveTab(tab) {
    const next = tab === 'object' ? 'object' : 'look';
    activeTab = next;
    try {
        sessionStorage.setItem(TAB_STORAGE_KEY, next);
    } catch (e) { /* private mode */ }

    qsAll('.tab-btn').forEach((btn) => {
        const on = btn.dataset.tab === next;
        btn.classList.toggle('is-active', on);
        btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    qsAll('.tab-panel').forEach((panel) => {
        const on = panel.id === `tab-${next}`;
        panel.classList.toggle('is-active', on);
        if (on) panel.removeAttribute('hidden');
        else panel.setAttribute('hidden', '');
    });
}

function closePresetSaveMenu() {
    const menu = $('preset-save-menu');
    const caret = $('preset-save-menu-btn');
    if (menu) menu.classList.add('hidden');
    if (caret) caret.setAttribute('aria-expanded', 'false');
}

function wireEvents() {
    $('ctrl-btn-refresh').addEventListener('click', () => {
        formDirty = false;
        refreshFull();
        refreshPresetList();
    });

    // ── Tabs ─────────────────────────────────────────────────────────
    qsAll('.tab-btn').forEach((btn) => {
        btn.addEventListener('click', () => setActiveTab(btn.dataset.tab));
    });

    const renderFps = $('render-fps');
    if (renderFps) {
        renderFps.addEventListener('change', async () => {
            const fps = Number(renderFps.value) || 0;
            if (typeof window.__musicViewSetRenderFps === 'function') {
                window.__musicViewSetRenderFps(fps);
            } else {
                window.__musicViewRenderFps = fps;
            }
            if (window.musicView?.setSettings) {
                await window.musicView.setSettings({ render: { fps } });
            }
            setStatus(fps > 0 ? `Render ${fps} fps` : 'Render native', 'ok');
        });
    }

    // ── Bottom strip ─────────────────────────────────────────────────
    const bpColor = $('bp-color');
    const bpHeight = $('bp-height');
    const bpInclude = $('bp-include-float');
    if (bpColor) {
        bpColor.addEventListener('input', () => scheduleBottomPanelApply());
        bpColor.addEventListener('change', () => scheduleBottomPanelApply());
    }
    if (bpHeight) {
        bpHeight.addEventListener('input', () => {
            const heightVal = $('bp-height-val');
            if (heightVal) heightVal.textContent = `${bpHeight.value}%`;
            scheduleBottomPanelApply();
        });
        bpHeight.addEventListener('change', () => scheduleBottomPanelApply());
    }
    if (bpInclude) {
        bpInclude.addEventListener('change', () => scheduleBottomPanelApply());
    }

    // ── Background ───────────────────────────────────────────────────
    qsAll('[data-bg-mode]').forEach((btn) => {
        btn.addEventListener('click', async () => {
            const mode = btn.dataset.bgMode || 'solid';
            setBackgroundModeUi(mode);
            const result = await cmd('updateBackground', { mode });
            if (result?.ok && result.state) {
                applyState(result.state, { full: true, preserveSelection: true });
            }
        });
    });
    const bgColor = $('bg-color');
    if (bgColor) {
        bgColor.addEventListener('input', () => scheduleBackgroundApply({ color: bgColor.value }));
        bgColor.addEventListener('change', () => scheduleBackgroundApply({ color: bgColor.value }));
    }
    if ($('bg-shader')) {
        $('bg-shader').addEventListener('change', () => {
            renderBackgroundShader({ preservePick: true });
        });
    }
    if ($('bg-shader-apply')) {
        $('bg-shader-apply').addEventListener('click', async () => {
            const shaderId = $('bg-shader')?.value;
            if (!shaderId) return;
            const meta = findShader(shaderId);
            const bg = backgroundState();
            const base = (bg.shaderId === shaderId ? bg.shaderUniforms : null)
                || defaultsFromDefs(meta?.uniforms);
            const uniforms = readUniformsFromHost($('bg-uniforms'), meta?.uniforms || [], base);
            const load = loadUi();
            if (load) load.begin('Applying shader…');
            try {
                await cmd('applyBackgroundShader', { shaderId, uniforms });
            } finally {
                if (load) load.end();
            }
        });
    }
    if ($('bg-shader-clear')) {
        $('bg-shader-clear').addEventListener('click', async () => {
            await cmd('clearBackgroundShader');
        });
    }
    if ($('bg-image-pick')) {
        $('bg-image-pick').addEventListener('click', async () => {
            if (!window.musicView?.openMediaFile) {
                setStatus('File picker unavailable', 'error');
                return;
            }
            const picked = await window.musicView.openMediaFile('image');
            if (!picked?.ok || picked.canceled) return;
            await cmd('setBackgroundMedia', {
                kind: 'image',
                src: picked.url,
                path: picked.path,
                name: picked.name,
                imageMode: $('bg-image-mode')?.value || 'fill',
            });
        });
    }
    if ($('bg-image-clear')) {
        $('bg-image-clear').addEventListener('click', async () => {
            await cmd('clearBackgroundMedia', { kind: 'image' });
        });
    }
    if ($('bg-image-mode')) {
        $('bg-image-mode').addEventListener('change', () => {
            scheduleBackgroundApply({ imageMode: $('bg-image-mode').value });
        });
    }
    if ($('bg-video-pick')) {
        $('bg-video-pick').addEventListener('click', async () => {
            if (!window.musicView?.openMediaFile) {
                setStatus('File picker unavailable', 'error');
                return;
            }
            const picked = await window.musicView.openMediaFile('video');
            if (!picked?.ok || picked.canceled) return;
            await cmd('setBackgroundMedia', {
                kind: 'video',
                src: picked.url,
                path: picked.path,
                name: picked.name,
                videoMode: $('bg-video-mode')?.value || 'fill',
                videoLoop: $('bg-video-loop') ? $('bg-video-loop').checked : true,
            });
        });
    }
    if ($('bg-video-clear')) {
        $('bg-video-clear').addEventListener('click', async () => {
            await cmd('clearBackgroundMedia', { kind: 'video' });
        });
    }
    if ($('bg-video-mode')) {
        $('bg-video-mode').addEventListener('change', () => {
            scheduleBackgroundApply({ videoMode: $('bg-video-mode').value });
        });
    }
    if ($('bg-video-loop')) {
        $('bg-video-loop').addEventListener('change', () => {
            scheduleBackgroundApply({ videoLoop: $('bg-video-loop').checked });
        });
    }
    if ($('bpp-active')) {
        $('bpp-active').addEventListener('change', async () => {
            if (suppressPublish) return;
            const result = $('bpp-active').checked
                ? await cmd('startBackgroundPostprocess')
                : await cmd('stopBackgroundPostprocess');
            if (result?.ok && result.state) {
                applyState(result.state, { full: true, preserveSelection: true });
            }
        });
    }
    if ($('bpp-add-layer')) {
        $('bpp-add-layer').addEventListener('click', async () => {
            const shaderId = $('bpp-add-shader')?.value || 'lcd';
            const result = await cmd('addBackgroundPostprocessLayer', { shaderId });
            if (result?.ok) {
                if (result.layerId != null) selectedBppLayerId = result.layerId;
                if (result.state) applyState(result.state, { full: true, preserveSelection: true });
                setStatus('Background FX layer added', 'ok');
            }
        });
    }
    if ($('bpp-shader')) {
        $('bpp-shader').addEventListener('change', async () => {
            const layer = selectedBppLayer();
            if (!layer) return;
            const shaderId = $('bpp-shader').value;
            if (!shaderId) return;
            const meta = findShader(shaderId);
            if ($('bpp-shader-desc')) {
                $('bpp-shader-desc').textContent = meta?.description || '';
                $('bpp-shader-desc').title = meta?.description || '';
            }
            const uniforms = layer.shaderId === shaderId
                ? (layer.uniforms || {})
                : defaultsFromDefs(meta?.uniforms);
            const result = await cmd('setBackgroundPostprocessLayerShader', {
                id: layer.id,
                shaderId,
                uniforms,
            });
            if (result?.ok && result.state) {
                applyState(result.state, { full: true, preserveSelection: true });
            }
        });
    }
    if ($('bpp-reset-defaults')) {
        $('bpp-reset-defaults').addEventListener('click', async () => {
            const layer = selectedBppLayer();
            if (!layer) return;
            const meta = findShader(layer.shaderId);
            const uniforms = defaultsFromDefs(meta?.uniforms);
            const result = await cmd('setBackgroundPostprocessLayerUniforms', {
                id: layer.id,
                uniforms,
            });
            await cmd('setBackgroundPostprocessLayerModulators', {
                id: layer.id,
                modulators: null,
            });
            if (result?.ok && result.state) {
                applyState(result.state, { full: true, preserveSelection: true });
            } else {
                if (layer.uniforms) Object.assign(layer.uniforms, uniforms);
                renderBackgroundPostprocess();
            }
        });
    }
    if ($('bpp-layer-remove')) {
        $('bpp-layer-remove').addEventListener('click', async () => {
            const layer = selectedBppLayer();
            if (!layer) return;
            const result = await cmd('removeBackgroundPostprocessLayer', { id: layer.id });
            selectedBppLayerId = null;
            if (result?.ok && result.state) {
                applyState(result.state, { full: true, preserveSelection: true });
            }
        });
    }
    if ($('bpp-layer-up')) {
        $('bpp-layer-up').addEventListener('click', async () => {
            const layers = bppLayers();
            const layer = selectedBppLayer();
            if (!layer) return;
            const idx = layers.findIndex((l) => l.id === layer.id);
            if (idx <= 0) return;
            const result = await cmd('moveBackgroundPostprocessLayer', {
                id: layer.id,
                toIndex: idx - 1,
            });
            if (result?.ok && result.state) {
                applyState(result.state, { full: true, preserveSelection: true });
            }
        });
    }
    if ($('bpp-layer-down')) {
        $('bpp-layer-down').addEventListener('click', async () => {
            const layers = bppLayers();
            const layer = selectedBppLayer();
            if (!layer) return;
            const idx = layers.findIndex((l) => l.id === layer.id);
            if (idx < 0 || idx >= layers.length - 1) return;
            const result = await cmd('moveBackgroundPostprocessLayer', {
                id: layer.id,
                toIndex: idx + 1,
            });
            if (result?.ok && result.state) {
                applyState(result.state, { full: true, preserveSelection: true });
            }
        });
    }

    // ── Presets ──────────────────────────────────────────────────────
    loadPresetPrefsFromStorage();
    // Restore preset browser prefs
    try {
        const cat = sessionStorage.getItem(PRESET_CAT_KEY);
        if (cat) presetCategory = cat;
        const sort = sessionStorage.getItem(PRESET_SORT_KEY);
        if (sort) presetSort = sort;
        const type = sessionStorage.getItem(PRESET_TYPE_KEY);
        if (type) presetTypeFilter = type;
        const instant = sessionStorage.getItem(PRESET_INSTANT_KEY);
        if ($('preset-instant-load') && instant != null) {
            $('preset-instant-load').checked = instant === '1';
        }
        if ($('preset-sort')) $('preset-sort').value = presetSort;
    } catch (_) { /* ignore */ }
    setPresetCategory(presetCategory);
    setPresetTypeFilter(presetTypeFilter);

    $('preset-load')?.addEventListener('click', () => {
        cancelInstantPresetLoad();
        loadSelectedPreset();
    });
    $('preset-refresh')?.addEventListener('click', () => refreshPresetList());
    $('preset-prev')?.addEventListener('click', () => selectPresetByDelta(-1));
    $('preset-next')?.addEventListener('click', () => selectPresetByDelta(1));
    $('preset-jump-active')?.addEventListener('click', () => jumpToActivePreset());
    $('preset-search')?.addEventListener('input', () => {
        renderPresetBrowser();
    });
    $('preset-search-clear')?.addEventListener('click', () => {
        if ($('preset-search')) {
            $('preset-search').value = '';
            $('preset-search').focus();
            renderPresetBrowser();
        }
    });
    $('preset-search')?.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            selectPresetByDelta(1);
            $('ctrl-preset-list')?.focus();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            selectPresetByDelta(-1);
            $('ctrl-preset-list')?.focus();
        } else if (e.key === 'Enter') {
            e.preventDefault();
            cancelInstantPresetLoad();
            loadSelectedPreset();
        } else if (e.key === 'Escape') {
            if (($('preset-search').value || '').trim()) {
                e.preventDefault();
                $('preset-search').value = '';
                renderPresetBrowser();
            }
        }
    });
    $('preset-sort')?.addEventListener('change', () => {
        presetSort = $('preset-sort').value || 'category';
        try { sessionStorage.setItem(PRESET_SORT_KEY, presetSort); } catch (_) { /* ignore */ }
        renderPresetBrowser();
    });
    qsAll('.preset-cat-btn').forEach((btn) => {
        btn.addEventListener('click', () => setPresetCategory(btn.dataset.cat || 'all'));
    });
    qsAll('.preset-filter-btn').forEach((btn) => {
        btn.addEventListener('click', () => setPresetTypeFilter(btn.dataset.type || 'all'));
    });
    $('preset-instant-load')?.addEventListener('change', () => {
        try {
            sessionStorage.setItem(
                PRESET_INSTANT_KEY,
                $('preset-instant-load').checked ? '1' : '0',
            );
        } catch (_) { /* ignore */ }
        if (!$('preset-instant-load').checked) cancelInstantPresetLoad();
    });
    $('ctrl-preset-list')?.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            selectPresetByDelta(1);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            selectPresetByDelta(-1);
        } else if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            cancelInstantPresetLoad();
            loadSelectedPreset();
        } else if (e.key === 'f' || e.key === 'F') {
            e.preventDefault();
            togglePresetFavorite(getSelectedPresetName());
        } else if (e.key === 'Home') {
            e.preventDefault();
            if (presetFiltered[0]) {
                setSelectedPresetName(presetFiltered[0].name, { scheduleInstant: true });
                renderPresetBrowser();
            }
        } else if (e.key === 'End') {
            e.preventDefault();
            const last = presetFiltered[presetFiltered.length - 1];
            if (last) {
                setSelectedPresetName(last.name, { scheduleInstant: true });
                renderPresetBrowser();
            }
        }
    });
    // Global / focuses search when not typing in an input
    if (!root.document.getElementById('dock-controls')) document.addEventListener('keydown', (e) => {
        if (root.__musicViewFocus
            && root.__musicViewFocus !== 'look'
            && root.__musicViewFocus !== 'object') return;
        if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
        const t = e.target;
        const tag = (t && t.tagName) ? t.tagName.toLowerCase() : '';
        if (tag === 'input' || tag === 'textarea' || tag === 'select' || t?.isContentEditable) return;
        if (activeTab !== 'look') return;
        e.preventDefault();
        $('preset-search')?.focus();
        $('preset-search')?.select?.();
    });
    $('preset-save')?.addEventListener('click', () => {
        closePresetSaveMenu();
        const name = $('preset-name').value.trim() || getSelectedPresetName();
        saveCurrentAsPreset(name);
    });
    $('preset-save-menu-btn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        const menu = $('preset-save-menu');
        const caret = $('preset-save-menu-btn');
        const open = menu.classList.contains('hidden');
        menu.classList.toggle('hidden', !open);
        caret.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    $('preset-save-default')?.addEventListener('click', () => {
        closePresetSaveMenu();
        saveCurrentAsPreset('default', { asDefault: true });
    });
    $('preset-delete')?.addEventListener('click', () => {
        closePresetSaveMenu();
        deleteSelectedPreset();
    });
    document.addEventListener('click', (e) => {
        const wrap = e.target.closest?.('.btn-menu-wrap');
        if (!wrap || !wrap.contains($('preset-save-menu-btn'))) {
            closePresetSaveMenu();
        }
        // Close layer overflow menus unless click is inside one
        if (!e.target.closest?.('.pp-layer-row-menu-wrap')) {
            closePpLayerMenus();
        }
    });
    $('preset-select')?.addEventListener('change', () => {
        setSelectedPresetName($('preset-select').value, { syncSaveField: true });
        renderPresetBrowser();
    });

    $('container-add')?.addEventListener('click', (e) => {
        e.stopPropagation();
        const menu = $('container-add-menu');
        if (!menu) return;
        const open = menu.classList.contains('hidden');
        closeContainerAddMenu();
        if (open) {
            renderContainerAddMenu();
            menu.classList.remove('hidden');
        }
    });
    $('container-dup')?.addEventListener('click', async () => {
        if (selectedId == null) return;
        const result = await cmd('duplicateContainer', { id: selectedId });
        if (!result?.ok) {
            setStatus(result?.error || 'Duplicate failed', 'error');
            return;
        }
        if (result.state) applyState(result.state, { full: true, preserveSelection: true });
        if (result.id != null) selectedId = result.id;
        renderContainerList();
        renderContainerEditor();
        setStatus('Duplicated as generic', 'ok');
    });
    $('container-del')?.addEventListener('click', async () => {
        const c = selectedContainer();
        if (!c) return;
        if (c.role) {
            const nice = String(c.role).replace(/^song-/, '');
            if (!window.confirm(`${nice} will disappear until you add a ${nice} panel.`)) return;
        }
        const result = await cmd('removeContainer', { id: c.id });
        if (!result?.ok) {
            setStatus(result?.error || 'Delete failed', 'error');
            return;
        }
        if (result.state) applyState(result.state, { full: true, preserveSelection: true });
        setStatus('Panel removed', 'ok');
    });
    $('c-role')?.addEventListener('change', async () => {
        const c = selectedContainer();
        if (!c) return;
        const role = $('c-role').value || null;
        const result = await cmd('setContainerRole', { id: c.id, role });
        if (!result?.ok) {
            setStatus(result?.error || 'Role change failed', 'error');
            fillRoleSelect(c.role);
            return;
        }
        if (result.state) applyState(result.state, { full: true, preserveSelection: true });
        setStatus(role ? `Role set to ${role}` : 'Role cleared (generic)', 'ok');
    });
    document.addEventListener('click', (e) => {
        if (!e.target.closest?.('#container-add-menu') && !e.target.closest?.('#container-add')) {
            closeContainerAddMenu();
        }
    });

    // Object segments
    qsAll('.segment-btn').forEach((btn) => {
        btn.addEventListener('click', () => setObjectSegment(btn.dataset.segment));
    });

    // ARTEF4KT Engine segment actions
    $('artef4kt-preset-load')?.addEventListener('click', () => {
        loadSelectedArtef4ktPreset();
    });
    $('artef4kt-refresh')?.addEventListener('click', () => {
        refreshArtef4ktEditor({ force: true });
    });
    $('artef4kt-camera-reset')?.addEventListener('click', async () => {
        const c = selectedContainer();
        if (!c || c.role !== 'artef4kt') return;
        // Full static head-on default (pose + auto/fly off) — matches first-load camera
        const result = await cmd('setArtef4ktSettings', {
            id: c.id,
            patch: {
                cameraReset: true,
                cameraAutoMove: false,
                cameraFlyAround: false,
                cameraAzimuth: 0,
                cameraElevation: 0,
            },
            partial: true,
        });
        if (result?.ok) {
            if (result.settings) {
                artef4ktSettings = result.settings;
            } else if (artef4ktSettings) {
                artef4ktSettings.cameraAutoMove = false;
                artef4ktSettings.cameraFlyAround = false;
                artef4ktSettings.cameraAzimuth = 0;
                artef4ktSettings.cameraElevation = 0;
            }
            renderArtef4ktControls();
            setStatus('Camera reset to head-on (static)', 'ok');
        }
    });
    $('artef4kt-preset')?.addEventListener('change', () => {
        // Selecting a look does not auto-apply (explicit Load), except double-use: Enter via Load
    });

    // Live apply: container fields (debounced). Marks dirty so wander ticks don't reset mid-edit.
    const containerEditor = $('container-editor');
    containerEditor.addEventListener('input', (e) => {
        // Shader package select is handled separately
        if (e.target?.id === 'c-shader') return;
        // ARTEF4KT knobs have their own push path (must not run updateContainer)
        if (e.target?.closest?.('#artef4kt-controls, #seg-artef4kt')
            || e.target?.id === 'artef4kt-preset'
            || e.target?.id === 'artef4kt-preset-load'
            || e.target?.id === 'artef4kt-refresh'
            || e.target?.id === 'artef4kt-camera-reset') {
            return;
        }
        markFormDirty();
        scheduleContainerLiveApply();
    });
    containerEditor.addEventListener('change', (e) => {
        if (e.target?.id === 'c-shader') return;
        if (e.target?.closest?.('#artef4kt-controls, #seg-artef4kt')
            || e.target?.id === 'artef4kt-preset'
            || e.target?.id === 'artef4kt-preset-load'
            || e.target?.id === 'artef4kt-refresh'
            || e.target?.id === 'artef4kt-camera-reset') {
            return;
        }
        markFormDirty();
        scheduleContainerLiveApply();
    });

    $('c-label-bg-on').addEventListener('change', () => {
        $('c-label-bg').disabled = !$('c-label-bg-on').checked;
        markFormDirty();
        scheduleContainerLiveApply();
    });

    // Manual full apply (same payload; useful if debounce interrupted)
    $('c-apply').addEventListener('click', async () => {
        if (selectedId == null) return;
        const payload = readContainerForm();
        const result = await cmd('updateContainer', payload);
        formDirty = false;
        if (result?.ok && result.state) {
            applyState(result.state, { full: true, preserveSelection: true });
        }
        setStatus('Container applied', 'ok');
    });

    // Progress time still goes through live path via change listener above

    $('c-shader').addEventListener('change', () => {
        // Preview controls for the selected package before apply
        const meta = findShader($('c-shader').value);
        $('c-shader-desc').textContent = meta?.description || '';
        const c = selectedContainer();
        const samePkg = !!(c?.hasShader && c.shaderId === meta?.id);
        if (c && !c.shaderModulators) c.shaderModulators = {};
        buildUniformControls(
            $('c-uniforms'),
            meta?.uniforms || [],
            // Keep current values if same package is already active
            (samePkg ? c.shaderUniforms : null) || defaultsFromDefs(meta?.uniforms),
            (name, value) => {
                if (!c?.hasShader || c.shaderId !== meta?.id) return;
                cmd('setContainerUniforms', { id: c.id, uniforms: { [name]: value } });
                if (c.shaderUniforms) c.shaderUniforms[name] = value;
            },
            `c${selectedId}-u`,
            {
                shaderId: meta?.id || $('c-shader').value || '',
                modulators: samePkg ? (c.shaderModulators || {}) : {},
                onModulatorChange: samePkg
                    ? (name, mod) => {
                        cmd('setContainerModulators', {
                            id: c.id,
                            modulators: { [name]: mod },
                        });
                        if (!c.shaderModulators) c.shaderModulators = {};
                        if (mod == null) delete c.shaderModulators[name];
                        else {
                            c.shaderModulators[name] = Object.assign(
                                {},
                                c.shaderModulators[name] || {},
                                mod,
                            );
                        }
                    }
                    : null,
            },
        );
    });

    $('c-shader-apply').addEventListener('click', async () => {
        if (selectedId == null) return;
        const shaderId = $('c-shader').value;
        if (!shaderId) return;
        const meta = findShader(shaderId);
        const c = selectedContainer();
        const base = (c?.shaderId === shaderId ? c.shaderUniforms : null)
            || defaultsFromDefs(meta?.uniforms);
        const uniforms = readUniformsFromHost($('c-uniforms'), meta?.uniforms || [], base);
        const load = loadUi();
        if (load) load.begin('Applying shader…');
        try {
            await cmd('applyContainerShader', { id: selectedId, shaderId, uniforms });
        } finally {
            if (load) load.end();
        }
    });

    $('c-shader-clear').addEventListener('click', async () => {
        if (selectedId == null) return;
        await cmd('clearContainerShader', { id: selectedId });
    });

    // ── Container FX stack ────────────────────────────────────────────
    if ($('cpp-active')) {
        $('cpp-active').addEventListener('change', async () => {
            if (suppressPublish || selectedId == null) return;
            const result = $('cpp-active').checked
                ? await cmd('startContainerPostprocess', { id: selectedId })
                : await cmd('stopContainerPostprocess', { id: selectedId });
            if (result?.ok && result.state) {
                applyState(result.state, { full: true, preserveSelection: true });
            }
        });
    }

    if ($('cpp-add-layer')) {
        $('cpp-add-layer').addEventListener('click', async () => {
            if (selectedId == null) return;
            const shaderId = $('cpp-add-shader')?.value || 'lcd';
            const result = await cmd('addContainerPostprocessLayer', {
                id: selectedId,
                shaderId,
            });
            if (result?.ok) {
                if (result.layerId != null) selectedCppLayerId = result.layerId;
                if (result.state) applyState(result.state, { full: true, preserveSelection: true });
                setStatus('Panel FX layer added', 'ok');
            }
        });
    }

    if ($('cpp-shader')) {
        $('cpp-shader').addEventListener('change', async () => {
            const layer = selectedCppLayer();
            if (!layer || selectedId == null) return;
            const shaderId = $('cpp-shader').value;
            if (!shaderId) return;
            const meta = findShader(shaderId);
            if ($('cpp-shader-desc')) {
                $('cpp-shader-desc').textContent = meta?.description || '';
                $('cpp-shader-desc').title = meta?.description || '';
            }
            const uniforms = layer.shaderId === shaderId
                ? (layer.uniforms || {})
                : defaultsFromDefs(meta?.uniforms);
            const result = await cmd('setContainerPostprocessLayerShader', {
                id: selectedId,
                layerId: layer.id,
                shaderId,
                uniforms,
            });
            if (result?.ok && result.state) {
                applyState(result.state, { full: true, preserveSelection: true });
            }
        });
    }

    if ($('cpp-reset-defaults')) {
        $('cpp-reset-defaults').addEventListener('click', async () => {
            const layer = selectedCppLayer();
            if (!layer || selectedId == null) return;
            const meta = findShader(layer.shaderId);
            const uniforms = defaultsFromDefs(meta?.uniforms);
            const result = await cmd('setContainerPostprocessLayerUniforms', {
                id: selectedId,
                layerId: layer.id,
                uniforms,
            });
            // Also clear modulators by re-setting package defaults path
            await cmd('setContainerPostprocessLayerModulators', {
                id: selectedId,
                layerId: layer.id,
                modulators: null,
            });
            if (result?.ok && result.state) {
                applyState(result.state, { full: true, preserveSelection: true });
            } else {
                // Force local uniforms if full state missing
                if (layer.uniforms) Object.assign(layer.uniforms, uniforms);
                renderContainerPostprocess();
            }
        });
    }

    if ($('cpp-layer-remove')) {
        $('cpp-layer-remove').addEventListener('click', async () => {
            const layer = selectedCppLayer();
            if (!layer || selectedId == null) return;
            const result = await cmd('removeContainerPostprocessLayer', {
                id: selectedId,
                layerId: layer.id,
            });
            selectedCppLayerId = null;
            if (result?.ok && result.state) {
                applyState(result.state, { full: true, preserveSelection: true });
            }
        });
    }

    if ($('cpp-layer-up')) {
        $('cpp-layer-up').addEventListener('click', async () => {
            const layers = cppLayers();
            const layer = selectedCppLayer();
            if (!layer || selectedId == null) return;
            const idx = layers.findIndex((l) => l.id === layer.id);
            if (idx <= 0) return;
            const result = await cmd('moveContainerPostprocessLayer', {
                id: selectedId,
                layerId: layer.id,
                toIndex: idx - 1,
            });
            if (result?.ok && result.state) {
                applyState(result.state, { full: true, preserveSelection: true });
            }
        });
    }

    if ($('cpp-layer-down')) {
        $('cpp-layer-down').addEventListener('click', async () => {
            const layers = cppLayers();
            const layer = selectedCppLayer();
            if (!layer || selectedId == null) return;
            const idx = layers.findIndex((l) => l.id === layer.id);
            if (idx < 0 || idx >= layers.length - 1) return;
            const result = await cmd('moveContainerPostprocessLayer', {
                id: selectedId,
                layerId: layer.id,
                toIndex: idx + 1,
            });
            if (result?.ok && result.state) {
                applyState(result.state, { full: true, preserveSelection: true });
            }
        });
    }

    $('pp-shader').addEventListener('change', async () => {
        const layer = selectedPpLayer();
        if (!layer) return;
        const shaderId = $('pp-shader').value;
        if (!shaderId) return;
        const meta = findShader(shaderId);
        $('pp-shader-desc').textContent = meta?.description || '';
        $('pp-shader-desc').title = meta?.description || '';
        // Keep current slider values when switching only if same package; else defaults
        const uniforms = layer.shaderId === shaderId
            ? (layer.uniforms || {})
            : defaultsFromDefs(meta?.uniforms);
        const result = await cmd('setPostprocessLayerShader', {
            id: layer.id,
            shaderId,
            uniforms,
        });
        if (result?.ok && result.state) applyState(result.state, { full: true, preserveSelection: true });
    });

    const resetBtn = $('pp-reset-defaults');
    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            resetSelectedPpLayerDefaults();
        });
    }

    // Hidden enable checkbox kept in sync from row eye; still wired for completeness
    $('pp-layer-enabled').addEventListener('change', async () => {
        if (suppressPublish) return;
        const layer = selectedPpLayer();
        if (!layer) return;
        const result = await cmd('setPostprocessLayerEnabled', {
            id: layer.id,
            enabled: $('pp-layer-enabled').checked,
        });
        if (result?.ok && result.state) applyState(result.state, { full: true, preserveSelection: true });
    });

    $('pp-add-layer').addEventListener('click', async () => {
        const shaderId = $('pp-add-shader').value || 'lcd';
        const result = await cmd('addPostprocessLayer', { shaderId });
        if (result?.ok) {
            if (result.layerId != null) selectedPpLayerId = result.layerId;
            if (result.state) applyState(result.state, { full: true, preserveSelection: true });
            setStatus('Layer added', 'ok');
        }
    });

    // Hidden legacy buttons — still wired so programmatic clicks / tests keep working
    $('pp-layer-remove').addEventListener('click', async () => {
        const layer = selectedPpLayer();
        if (!layer) return;
        const result = await cmd('removePostprocessLayer', { id: layer.id });
        selectedPpLayerId = null;
        if (result?.ok && result.state) applyState(result.state, { full: true, preserveSelection: true });
    });

    $('pp-layer-up').addEventListener('click', async () => {
        const layers = ppLayers();
        const layer = selectedPpLayer();
        if (!layer) return;
        const idx = layers.findIndex((l) => l.id === layer.id);
        if (idx <= 0) return;
        const result = await cmd('movePostprocessLayer', { id: layer.id, toIndex: idx - 1 });
        if (result?.ok && result.state) applyState(result.state, { full: true, preserveSelection: true });
    });

    $('pp-layer-down').addEventListener('click', async () => {
        const layers = ppLayers();
        const layer = selectedPpLayer();
        if (!layer) return;
        const idx = layers.findIndex((l) => l.id === layer.id);
        if (idx < 0 || idx >= layers.length - 1) return;
        const result = await cmd('movePostprocessLayer', { id: layer.id, toIndex: idx + 1 });
        if (result?.ok && result.state) applyState(result.state, { full: true, preserveSelection: true });
    });

    $('pp-active').addEventListener('change', async () => {
        if (suppressPublish) return;
        // Must not clear layers — start/stop only toggles the stack output
        const result = $('pp-active').checked
            ? await cmd('startPostprocess', {})
            : await cmd('stopPostprocess');
        if (result?.ok && result.state) applyState(result.state, { full: true, preserveSelection: true });
    });

    // ── Keyboard shortcuts (when not typing in a field) ───────────────
    if (!root.document.getElementById('dock-controls')) document.addEventListener('keydown', (e) => {
        if (root.__musicViewFocus
            && root.__musicViewFocus !== 'look'
            && root.__musicViewFocus !== 'object') return;
        const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
        const typing = tag === 'input' || tag === 'textarea' || tag === 'select'
            || e.target?.isContentEditable;

        if (e.key === 'Escape') {
            closePresetSaveMenu();
            closePpLayerMenus();
            if (typing && e.target?.blur) e.target.blur();
            return;
        }

        if (typing) return;
        if (e.metaKey || e.ctrlKey || e.altKey) {
            // ⌥↑ / ⌥↓ reorder selected FX layer
            if (activeTab === 'look' && selectedPpLayerId != null
                && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
                e.preventDefault();
                const layers = ppLayers();
                const idx = layers.findIndex((l) => l.id === Number(selectedPpLayerId));
                if (idx < 0) return;
                const toIndex = e.key === 'ArrowUp' ? idx - 1 : idx + 1;
                if (toIndex < 0 || toIndex >= layers.length) return;
                cmd('movePostprocessLayer', { id: selectedPpLayerId, toIndex }).then((result) => {
                    if (result?.ok && result.state) {
                        applyState(result.state, { full: true, preserveSelection: true });
                    }
                });
            }
            return;
        }

        if (e.key === '1') {
            e.preventDefault();
            setActiveTab('look');
            return;
        }
        if (e.key === '2') {
            e.preventDefault();
            setActiveTab('object');
            return;
        }

        // Object: [ ] cycle containers
        if (activeTab === 'object' && (e.key === '[' || e.key === ']')) {
            const list = sceneState.containers || [];
            if (!list.length) return;
            e.preventDefault();
            const cur = list.findIndex((c) => c.id === Number(selectedId));
            const nextIdx = e.key === ']'
                ? (cur < 0 ? 0 : (cur + 1) % list.length)
                : (cur <= 0 ? list.length - 1 : cur - 1);
            selectedId = list[nextIdx].id;
            formDirty = false;
            renderContainerList();
            renderContainerEditor();
            echoSelectionToDisplay(selectedId);
            return;
        }

        // Look: layer enable / remove
        if (activeTab === 'look' && selectedPpLayerId != null) {
            if (e.key === 'e' || e.key === 'E') {
                e.preventDefault();
                const layer = selectedPpLayer();
                if (!layer) return;
                const enabled = layer.enabled !== false;
                cmd('setPostprocessLayerEnabled', {
                    id: layer.id,
                    enabled: !enabled,
                }).then((result) => {
                    if (result?.ok && result.state) {
                        applyState(result.state, { full: true, preserveSelection: true });
                    }
                });
                return;
            }
            if (e.key === 'Delete' || e.key === 'Backspace') {
                e.preventDefault();
                const layer = selectedPpLayer();
                if (!layer) return;
                cmd('removePostprocessLayer', { id: layer.id }).then((result) => {
                    selectedPpLayerId = null;
                    if (result?.ok && result.state) {
                        applyState(result.state, { full: true, preserveSelection: true });
                    }
                });
            }
        }
    });
}

function defaultsFromDefs(uniformDefs) {
    const out = {};
    if (!Array.isArray(uniformDefs)) return out;
    for (const u of uniformDefs) {
        if (!u?.name) continue;
        if (u.default !== undefined) {
            out[u.name] = Array.isArray(u.default) ? u.default.slice() : u.default;
        }
    }
    return out;
}

function waitForDisplayIfDocked() {
    if (!root.document.getElementById('dock-controls')) return Promise.resolve();
    if (root.__musicViewDisplayReady) return Promise.resolve();
    return new Promise((resolve) => {
        const done = () => {
            root.removeEventListener('music-view-display-ready', done);
            resolve();
        };
        root.addEventListener('music-view-display-ready', done);
        setTimeout(done, 8000);
    });
}

async function init() {
    wireEvents();

    // Restore last tab / object segment / advanced uniforms (controls-only; not presets)
    let initialTab = 'look';
    try {
        const stored = sessionStorage.getItem(TAB_STORAGE_KEY);
        if (stored === 'object' || stored === 'look') initialTab = stored;
        const seg = sessionStorage.getItem(OBJ_SEG_STORAGE_KEY);
        if (seg === 'transform' || seg === 'style' || seg === 'motion' || seg === 'shader') {
            activeObjectSegment = seg;
        }
        showAdvancedUniforms = sessionStorage.getItem(ADV_UNIFORMS_KEY) === '1';
    } catch (e) { /* ignore */ }
    setActiveTab(initialTab);
    setObjectSegment(activeObjectSegment);

    try {
        if (window.musicView?.getSettings) {
            const settings = await window.musicView.getSettings();
            const fps = settings && settings.render ? Number(settings.render.fps) : 0;
            const sel = $('render-fps');
            if (sel) {
                const v = String(Number.isFinite(fps) ? fps : 0);
                if (sel.querySelector(`option[value="${v}"]`)) sel.value = v;
            }
            if (typeof window.__musicViewSetRenderFps === 'function') {
                window.__musicViewSetRenderFps(fps);
            }
        }
    } catch (e) { /* ignore */ }

    if (window.musicView?.onState) {
        unsubState = window.musicView.onState((state) => {
            if (!state) return;

            // Live wander publishes fire often. Never rebuild the whole form from
            // them — that was reverting every control change on Apply.
            if (Date.now() < liveSyncPausedUntil || formDirty) {
                applyState(state, { positionsOnly: true });
                return;
            }

            // Idle: still only merge positions so we don't reset checkboxes/sliders
            // mid-interaction from high-frequency redraw publishes.
            applyState(state, { positionsOnly: true });
        });
    }

    const load = loadUi();
    try {
        if (load) load.set(66, 'Waiting for stage…');
        await waitForDisplayIfDocked();
        await refreshFull();
        if (load) load.set(90, 'Loading presets…');
        await refreshPresetList({ selectName: sceneState.activePreset || 'default' });
        renderPresetActive();
        if (load) load.set(96, 'Controls ready');
    } finally {
        if (load && typeof load.mark === 'function') load.mark('controls');
    }
}

document.addEventListener('DOMContentLoaded', init);
root.__musicViewControls = {
    setActiveTab,
    closeMenus: closeWorkspaceMenus,
    focusPresetSearch,
    cycleObject,
    toggleLookLayer,
    removeLookLayer,
    moveLookLayer,
};
})(window);
