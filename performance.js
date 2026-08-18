(function (root) {
const $ = (id) => {
    const scope = root.document.getElementById('dock-show') || root.document;
    return scope.querySelector('#' + id);
};
function qsAll(sel) {
    const scope = root.document.getElementById('dock-show') || root.document;
    return scope.querySelectorAll(sel);
}

/* Performance conductor + cue list / inspector */


function uid(prefix) {
    const c = (globalThis.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()) + Math.random();
    return `${prefix}_${c}`;
}

function formatTime(sec) {
    if (!Number.isFinite(sec) || sec < 0) return '0:00';
    const s = Math.floor(sec % 60);
    const m = Math.floor(sec / 60);
    return `${m}:${String(s).padStart(2, '0')}`;
}

function emptyDoc() {
    return {
        version: 1,
        name: 'Untitled',
        settings: { loop: false },
        showFx: { active: false, layers: [] },
        clips: [],
    };
}

function ensureShowFx() {
    if (!doc.showFx || typeof doc.showFx !== 'object') {
        doc.showFx = { active: false, layers: [] };
    }
    if (!Array.isArray(doc.showFx.layers)) doc.showFx.layers = [];
    return doc.showFx;
}

function cloneShowFxLayer(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const shaderId = typeof raw.shaderId === 'string' && raw.shaderId.trim()
        ? raw.shaderId.trim()
        : (typeof raw.shaderPath === 'string' && raw.shaderPath.trim() ? raw.shaderPath.trim() : '');
    if (!shaderId) return null;
    return {
        shaderId,
        enabled: raw.enabled !== false,
        uniforms: raw.uniforms && typeof raw.uniforms === 'object'
            ? JSON.parse(JSON.stringify(raw.uniforms))
            : {},
        modulators: raw.modulators && typeof raw.modulators === 'object'
            ? JSON.parse(JSON.stringify(raw.modulators))
            : {},
    };
}

/** Look stack first, show-wide layers last (composited on top). */
function sceneWithShowFx(scene) {
    const fx = ensureShowFx();
    if (!scene || !fx.active || !fx.layers.length) return scene;
    const out = JSON.parse(JSON.stringify(scene));
    const look = out.postprocess && typeof out.postprocess === 'object' ? out.postprocess : {};
    const lookLayers = Array.isArray(look.layers) ? look.layers : [];
    const extra = fx.layers.map((l) => Object.assign({}, cloneShowFxLayer(l), { _showFx: true })).filter(Boolean);
    out.postprocess = Object.assign({}, look, {
        active: true,
        layers: lookLayers.concat(extra),
    });
    return out;
}

function renderShowFx() {
    const fx = ensureShowFx();
    const list = $('showfx-list');
    const empty = $('showfx-empty');
    const toggle = $('showfx-active');
    if (!list || !empty || !toggle) return;
    toggle.checked = !!fx.active && fx.layers.length > 0;
    list.innerHTML = '';
    if (!fx.layers.length) {
        empty.classList.remove('hidden');
        return;
    }
    empty.classList.add('hidden');
    fx.layers.forEach((layer, index) => {
        const li = document.createElement('li');
        const on = document.createElement('input');
        on.type = 'checkbox';
        on.checked = layer.enabled !== false;
        on.title = 'Enabled';
        on.addEventListener('change', () => {
            layer.enabled = on.checked;
            markDirty();
        });
        const name = document.createElement('span');
        name.className = 'fx-name';
        name.textContent = layer.shaderId || 'layer';
        const up = document.createElement('button');
        up.type = 'button';
        up.className = 'btn btn-tiny';
        up.textContent = '↑';
        up.disabled = index === 0;
        up.addEventListener('click', () => {
            if (index <= 0) return;
            const cur = fx.layers.splice(index, 1)[0];
            fx.layers.splice(index - 1, 0, cur);
            markDirty();
            renderShowFx();
        });
        const down = document.createElement('button');
        down.type = 'button';
        down.className = 'btn btn-tiny';
        down.textContent = '↓';
        down.disabled = index === fx.layers.length - 1;
        down.addEventListener('click', () => {
            if (index >= fx.layers.length - 1) return;
            const cur = fx.layers.splice(index, 1)[0];
            fx.layers.splice(index + 1, 0, cur);
            markDirty();
            renderShowFx();
        });
        const rm = document.createElement('button');
        rm.type = 'button';
        rm.className = 'btn btn-tiny';
        rm.textContent = '×';
        rm.title = 'Remove';
        rm.addEventListener('click', () => {
            fx.layers.splice(index, 1);
            if (!fx.layers.length) fx.active = false;
            markDirty();
            renderShowFx();
        });
        li.appendChild(on);
        li.appendChild(name);
        li.appendChild(up);
        li.appendChild(down);
        li.appendChild(rm);
        list.appendChild(li);
    });
}

async function openPresetPicker(title) {
    const list = await window.musicView.listPresets();
    const sel = $('perf-preset-list');
    const heading = $('preset-dialog-title');
    if (heading) heading.textContent = title || 'Import look preset';
    sel.innerHTML = '';
    for (const p of (list.presets || [])) {
        const opt = document.createElement('option');
        opt.value = p.name;
        const tag = p.fxOnly ? 'FX' : (p.category || '');
        opt.textContent = tag ? `${p.displayName || p.name} · ${tag}` : (p.displayName || p.name);
        sel.appendChild(opt);
    }
    const dlg = $('preset-dialog');
    return new Promise((resolve) => {
        dlg.showModal();
        dlg.addEventListener('close', function onClose() {
            dlg.removeEventListener('close', onClose);
            if (dlg.returnValue !== 'import') {
                resolve(null);
                return;
            }
            resolve(sel.value || null);
        }, { once: true });
    });
}

async function addShowFxFromPreset(presetName) {
    const file = await window.musicView.loadPresetFile(presetName);
    if (!file?.ok || !file.preset?.scene) {
        setStatusLine(file?.error || 'Preset load failed');
        return;
    }
    const pp = file.preset.scene.postprocess;
    const layers = Array.isArray(pp?.layers) ? pp.layers : [];
    const imported = layers.map(cloneShowFxLayer).filter(Boolean);
    if (!imported.length && pp?.shaderId) {
        const one = cloneShowFxLayer(pp);
        if (one) imported.push(one);
    }
    if (!imported.length) {
        setStatusLine('That preset has no postprocess stack');
        return;
    }
    const fx = ensureShowFx();
    fx.layers.push(...imported);
    fx.active = true;
    markDirty();
    renderShowFx();
    setStatusLine(`Added ${imported.length} show FX layer${imported.length === 1 ? '' : 's'} from ${presetName}`);
}

async function captureShowFxFromLive() {
    const exported = await displayCmd('exportSceneSnapshot', { name: doc.name });
    if (!exported?.ok || !exported.preset?.scene) {
        setStatusLine(exported?.error || 'Capture failed');
        return;
    }
    const pp = exported.preset.scene.postprocess;
    const layers = (Array.isArray(pp?.layers) ? pp.layers : [])
        .filter((l) => !l._showFx)
        .map(cloneShowFxLayer)
        .filter(Boolean);
    if (!layers.length) {
        setStatusLine('Live look has no FX layers');
        return;
    }
    const fx = ensureShowFx();
    fx.layers = layers;
    fx.active = true;
    markDirty();
    renderShowFx();
    setStatusLine(`Captured ${layers.length} live FX layer${layers.length === 1 ? '' : 's'} as show FX`);
}

function defaultAudioTransition() {
    return { type: 'cut', duration: 0, easing: 'linear', offset: 0 };
}

function defaultVisualTransition() {
    return { type: 'auto', duration: 1.2, easing: 'ease-in-out', offset: 0, morphThreshold: 0.65, dipColor: '#000000' };
}

function inheritLook(offset) {
    return {
        id: uid('look'),
        offset: offset || 0,
        lookMode: 'inherit',
        sourcePreset: null,
        capturedAt: null,
        visualTransition: defaultVisualTransition(),
        scene: null,
    };
}

let doc = emptyDoc();
let fileStem = null;
let dirty = false;
let songs = [];
let missingRel = new Set();
let staleLookIds = new Set();
let selectedClipId = null;
let selectedLookId = null;

let status = 'idle';
let clipIndex = 0;
let audioTransitionId = null;
let visualTransitionId = null;
let visualKind = null;
let firedLookCueIds = new Set();
let showTime = 0;
let lastDeckTime = 0;
let showClockLast = 0;
let showRaf = null;
let uAudio = 0;
let uVisual = 0;
let inShow = false;
let arriving = false;
let pendingPreload = null;
let leadShowDeck = 'A';
let statusMsg = 'Ready';

function setStatusLine(msg) {
    statusMsg = msg || '';
    const el = $('status-line');
    if (el) {
        el.textContent = statusMsg;
        el.title = statusMsg;
    }
}

function markDirty(on) {
    dirty = on !== false;
    $('dirty-dot').classList.toggle('hidden', !dirty);
}

function setDocTitle() {
    $('perf-title').textContent = doc.name || 'Untitled';
    $('perf-stem').textContent = fileStem || 'unsaved';
    $('opt-loop').checked = !!(doc.settings && doc.settings.loop);
}

function selectedClip() {
    return (doc.clips || []).find((c) => c.id === selectedClipId) || null;
}

function selectedLook(clip) {
    const c = clip || selectedClip();
    if (!c) return null;
    return (c.lookCues || []).find((l) => l.id === selectedLookId) || c.lookCues[0] || null;
}

function currentClip() {
    return doc.clips[clipIndex] || null;
}

function nextClipIndex() {
    if (clipIndex + 1 < doc.clips.length) return clipIndex + 1;
    if (doc.settings && doc.settings.loop) return 0;
    return -1;
}

function musicCmd(command, payload) {
    if (!window.musicView?.sendMusicCommand) {
        return Promise.resolve({ ok: false, error: 'Music command API missing' });
    }
    return window.musicView.sendMusicCommand(command, payload ?? null);
}

function displayCmd(command, payload) {
    if (!window.musicView?.sendCommand) {
        return Promise.resolve({ ok: false, error: 'Display command API missing' });
    }
    return window.musicView.sendCommand(command, payload ?? null);
}

function clipProgramSpan(clip) {
    if (!clip) return 0;
    const inn = Number(clip.in) || 0;
    const out = Number(clip.out) || 0;
    const hold = Math.max(0, Number(clip.holdAfter) || 0);
    return Math.max(0, out - inn) + hold;
}

function clipAudioOverlap(clip, index) {
    if (index <= 0 || !clip) return 0;
    const t = clip.audioTransition && typeof clip.audioTransition === 'object'
        ? clip.audioTransition
        : {};
    if (!t.type || t.type === 'cut') return 0;
    return Math.max(0, Number(t.duration) || 0);
}

function computeShowDuration(body) {
    const clips = body && Array.isArray(body.clips) ? body.clips : [];
    let total = 0;
    for (let i = 0; i < clips.length; i++) {
        total += Math.max(0, clipProgramSpan(clips[i]) - clipAudioOverlap(clips[i], i));
    }
    return total;
}

function clipPrefixDuration(index) {
    const clips = doc.clips || [];
    const n = Math.max(0, Math.min(Number(index) || 0, clips.length));
    let t = 0;
    for (let i = 0; i < n; i++) {
        t += Math.max(0, clipProgramSpan(clips[i]) - clipAudioOverlap(clips[i], i));
    }
    return t;
}

function clipLocalElapsed(clip, deckTime) {
    if (!clip) return 0;
    const inn = Number(clip.in) || 0;
    const span = clipProgramSpan(clip);
    return Math.max(0, Math.min(span, (Number(deckTime) || 0) - inn));
}

/** Show position from clip index + deck time — not a free-running wall clock. */
function deriveShowTime() {
    const dur = computeShowDuration(doc);
    if (status === 'idle' || status === 'preview') return 0;
    if (status === 'ended') return dur;
    const t = clipPrefixDuration(clipIndex) + clipLocalElapsed(currentClip(), lastDeckTime);
    if (dur > 0 && t > dur) return dur;
    return Math.max(0, t);
}

function publishShowState() {
    if (!window.musicView?.publishShowState) return;
    const clip = currentClip();
    const look = clip && clip.lookCues ? clip.lookCues[0] : null;
    showTime = deriveShowTime();
    window.musicView.publishShowState({
        status,
        inShow,
        audioTransitionId,
        visualTransitionId,
        visualKind,
        clipId: clip ? clip.id : null,
        lookId: look ? look.id : null,
        clipIndex,
        showTime,
        showDuration: computeShowDuration(doc),
        loop: !!(doc.settings && doc.settings.loop),
        uAudio,
        uVisual,
        name: doc.name,
    });
}

function setShowStatus(next) {
    status = next;
    inShow = status === 'playing' || status === 'paused';
    $('show-status').textContent = status;
    $('perf-btn-play').textContent = status === 'playing' ? '❚❚' : '▶';
    publishShowState();
}

function startShowClock() {
    showClockLast = performance.now();
    if (showRaf) return;
    let lastPublish = 0;
    const tick = (now) => {
        showRaf = requestAnimationFrame(tick);
        showClockLast = now;
        showTime = deriveShowTime();
        $('show-clock').textContent = formatTime(showTime);
        const clip = currentClip();
        $('clip-meta').textContent = clip
            ? `${clip.song.title || clip.song.relPath}  ${formatTime(clip.in)}–${formatTime(clip.out)}`
            : 'No clip';
        if (now - lastPublish > 80) {
            lastPublish = now;
            publishShowState();
        }
    };
    showRaf = requestAnimationFrame(tick);
}

async function refreshSongs() {
    if (!window.musicView?.listSongs) return;
    const result = await window.musicView.listSongs();
    songs = (result && result.ok && result.songs) ? result.songs : [];
    missingRel = new Set();
    const known = new Set(songs.map((s) => s.name || s.id));
    for (const c of doc.clips) {
        if (!known.has(c.song.relPath)) missingRel.add(c.song.relPath);
    }
    fillSongSelect();
    renderCueList();
}

function fillSongSelect() {
    const sel = $('insp-song');
    if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = '';
    for (const s of songs) {
        const opt = document.createElement('option');
        opt.value = s.name || s.id;
        opt.textContent = s.title || s.name;
        sel.appendChild(opt);
    }
    if (cur) sel.value = cur;
}

function renderCueList() {
    const list = $('cue-list');
    list.innerHTML = '';
    const clips = doc.clips || [];
    $('cue-empty').classList.toggle('hidden', clips.length > 0);
    clips.forEach((clip, i) => {
        const li = document.createElement('li');
        li.dataset.id = clip.id;
        if (clip.id === selectedClipId) li.classList.add('selected');
        const title = document.createElement('span');
        title.textContent = `${i + 1}. ${clip.song.title || clip.song.relPath}`;
        li.appendChild(title);
        const meta = document.createElement('span');
        meta.className = 'hint';
        meta.textContent = `${formatTime(clip.in)}–${formatTime(clip.out)} · ${clip.audioTransition.type}`;
        li.appendChild(meta);
        if (missingRel.has(clip.song.relPath)) {
            const err = document.createElement('span');
            err.className = 'err';
            err.textContent = 'missing song';
            li.appendChild(err);
        }
        for (const look of clip.lookCues || []) {
            const sub = document.createElement('span');
            sub.className = 'look-sub';
            const stale = staleLookIds.has(look.id) ? ' · stale' : '';
            sub.textContent = `look @${look.offset}s ${look.lookMode}${stale}`;
            if (staleLookIds.has(look.id)) sub.classList.add('stale');
            li.appendChild(sub);
        }
        li.addEventListener('click', () => {
            selectedClipId = clip.id;
            selectedLookId = clip.lookCues[0] ? clip.lookCues[0].id : null;
            renderCueList();
            fillInspector();
        });
        list.appendChild(li);
    });
}

function fillLookSelect(clip) {
    const sel = $('insp-look-sel');
    sel.innerHTML = '';
    for (const look of clip.lookCues || []) {
        const opt = document.createElement('option');
        opt.value = look.id;
        opt.textContent = `@${look.offset}s ${look.lookMode}`;
        sel.appendChild(opt);
    }
    if (selectedLookId) sel.value = selectedLookId;
}

function fillInspector() {
    const clip = selectedClip();
    const form = $('inspector');
    const empty = $('inspector-empty');
    if (!clip) {
        form.classList.add('hidden');
        empty.classList.remove('hidden');
        return;
    }
    empty.classList.add('hidden');
    form.classList.remove('hidden');
    fillSongSelect();
    $('insp-song').value = clip.song.relPath;
    $('insp-in').value = String(clip.in);
    $('insp-out').value = String(clip.out);
    $('insp-vol').value = String(clip.volume);
    $('insp-hold').value = String(clip.holdAfter);
    $('insp-loop-go').checked = !!clip.loopUntilGo;
    $('insp-audio-type').value = clip.audioTransition.type;
    $('insp-audio-dur').value = String(clip.audioTransition.duration);
    $('insp-audio-ease').value = clip.audioTransition.easing;
    $('insp-audio-off').value = String(clip.audioTransition.offset);
    const look = selectedLook(clip);
    fillLookSelect(clip);
    if (look) {
        $('insp-look-off').value = String(look.offset);
        $('insp-vis-type').value = look.visualTransition.type;
        $('insp-vis-dur').value = String(look.visualTransition.duration);
        $('insp-vis-ease').value = look.visualTransition.easing;
        $('insp-vis-off').value = String(look.visualTransition.offset);
        const bits = [`${look.lookMode}`];
        if (look.sourcePreset) bits.push(`from ${look.sourcePreset}`);
        if (staleLookIds.has(look.id)) bits.push('stale');
        if (look.lookMode === 'snapshot' && look.scene) {
            bits.push(`${(look.scene.containers || []).length} containers`);
            const bg = look.scene.background;
            if (bg && bg.mode && bg.mode !== 'solid') {
                const extra = bg.shaderId || bg.imageName || bg.videoName || bg.imagePath || bg.videoPath || '';
                bits.push(extra ? `bg ${bg.mode} (${String(extra).split('/').pop()})` : `bg ${bg.mode}`);
            } else if (bg && bg.mode === 'solid' && bg.color && bg.color.toLowerCase() !== '#ffffff') {
                bits.push(`bg ${bg.color}`);
            }
        }
        $('insp-look-info').textContent = bits.join(' · ');
    }
}

function readInspector() {
    const clip = selectedClip();
    if (!clip) return;
    const rel = $('insp-song').value;
    const song = songs.find((s) => (s.name || s.id) === rel);
    clip.song.relPath = rel;
    clip.song.title = song ? song.title : clip.song.title;
    clip.song.duration = song && Number.isFinite(song.duration) ? song.duration : clip.song.duration;
    clip.in = Number($('insp-in').value);
    clip.out = Number($('insp-out').value);
    clip.volume = Number($('insp-vol').value);
    clip.holdAfter = Number($('insp-hold').value);
    clip.loopUntilGo = $('insp-loop-go').checked;
    clip.audioTransition.type = $('insp-audio-type').value;
    clip.audioTransition.duration = Number($('insp-audio-dur').value);
    clip.audioTransition.easing = $('insp-audio-ease').value;
    clip.audioTransition.offset = Number($('insp-audio-off').value);
    const look = selectedLook(clip);
    if (look) {
        look.offset = Number($('insp-look-off').value);
        look.visualTransition.type = $('insp-vis-type').value;
        look.visualTransition.duration = Number($('insp-vis-dur').value);
        look.visualTransition.easing = $('insp-vis-ease').value;
        look.visualTransition.offset = Number($('insp-vis-off').value);
        selectedLookId = look.id;
    }
    markDirty();
    renderCueList();
}

function newClipFromSong(song) {
    const rel = song ? (song.name || song.id) : '';
    return {
        id: uid('clip'),
        song: {
            relPath: rel,
            title: song ? song.title : '',
            artist: '',
            duration: song && Number.isFinite(song.duration) ? song.duration : null,
        },
        in: 0,
        out: song && Number.isFinite(song.duration) && song.duration > 0 ? song.duration : 30,
        volume: 1,
        holdAfter: 0,
        loopUntilGo: false,
        audioTransition: defaultAudioTransition(),
        lookCues: [inheritLook(0)],
    };
}

async function captureLookInto(look) {
    const exported = await displayCmd('exportSceneSnapshot', { name: doc.name });
    if (!exported?.ok || !exported.preset?.scene) {
        setStatusLine(exported?.error || 'Capture failed');
        return false;
    }
    look.lookMode = 'snapshot';
    const captured = exported.preset.scene;
    if (captured && captured.postprocess && Array.isArray(captured.postprocess.layers)) {
        captured.postprocess.layers = captured.postprocess.layers.filter((l) => !l._showFx);
    }
    look.scene = captured;
    look.capturedAt = new Date().toISOString();
    look.sourcePreset = null;
    staleLookIds.delete(look.id);
    markDirty();
    fillInspector();
    renderCueList();
    setStatusLine('Captured live scene');
    return true;
}

function geometryFromPresetEntry(entry) {
    if (!entry) return entry;
    const hasPx = [entry.left, entry.top, entry.width, entry.height]
        .every((v) => v != null && Number.isFinite(Number(v)));
    if (hasPx) {
        if (!('relative' in entry)) entry.relative = entry.relative || null;
        return entry;
    }
    return entry;
}

async function importPresetInto(look, presetName) {
    const file = await window.musicView.loadPresetFile(presetName);
    if (!file?.ok || !file.preset?.scene) {
        setStatusLine(file?.error || 'Preset load failed');
        return;
    }
    const scene = JSON.parse(JSON.stringify(file.preset.scene));
    const resolved = await displayCmd('resolveSnapshotGeometry', { scene });
    const outScene = (resolved?.ok && resolved.scene) ? resolved.scene : scene;
    if (Array.isArray(outScene.containers)) {
        for (const c of outScene.containers) {
            if (!c.snapshotId) c.snapshotId = uid('snap');
            geometryFromPresetEntry(c);
        }
    }
    look.lookMode = 'snapshot';
    look.scene = outScene;
    look.sourcePreset = presetName;
    look.capturedAt = new Date().toISOString();
    staleLookIds.delete(look.id);
    markDirty();
    fillInspector();
    renderCueList();
    setStatusLine(`Imported ${presetName}`);
}

function clipBlocked() {
    const clip = currentClip();
    if (!clip) return 'No clip';
    if (missingRel.has(clip.song.relPath)) return `Missing song ${clip.song.relPath}`;
    const startLook = (clip.lookCues || []).find((l) => l.offset === 0) || clip.lookCues[0];
    if (startLook && startLook.lookMode === 'snapshot' && !startLook.scene) return 'Corrupt snapshot';
    return null;
}

function goBlocked() {
    if (audioTransitionId) return 'audio';
    if (visualTransitionId && visualKind === 'arrival') return 'arrival visual';
    return null;
}

async function applyLook(look, kind, forceMode) {
    if (!look || look.lookMode === 'inherit' || !look.scene) return { ok: true, skipped: true };
    if (visualTransitionId) {
        await displayCmd('finishSceneTransition', { applyIncoming: true });
        visualTransitionId = null;
        visualKind = null;
    }
    const vt = look.visualTransition || defaultVisualTransition();
    const mode = forceMode || vt.type || 'auto';
    const result = await displayCmd('applySceneTransition', {
        mode,
        duration: forceMode === 'cut' ? 0 : (vt.duration || 0),
        easing: vt.easing || 'ease-in-out',
        dipColor: vt.dipColor || '#000000',
        morphThreshold: vt.morphThreshold || 0.65,
        kind,
        scene: sceneWithShowFx(look.scene),
        name: doc.name,
    });
    if (result?.ok && mode !== 'cut' && (result.modeUsed === 'morph' || result.modeUsed === 'crossfade' || result.modeUsed === 'dip')) {
        visualTransitionId = result.transitionId || 'vis';
        visualKind = kind;
    } else {
        visualTransitionId = null;
        visualKind = null;
    }
    firedLookCueIds.add(look.id);
    publishShowState();
    return result;
}

async function setDriving(on) {
    await musicCmd('setShowDriving', { on: !!on, performanceName: doc.name });
}

function pickIdleDeck(lead) {
    return lead === 'A' ? 'B' : 'A';
}

async function loadClipOnDeck(clip, deck, time) {
    return musicCmd('loadDeck', {
        deck,
        relPath: clip.song.relPath,
        time: time != null ? time : clip.in,
        publish: false,
    });
}

function clipPrepareList(fromIndex) {
    return (doc.clips || []).slice(fromIndex >= 0 ? fromIndex : 0).map((c) => ({
        relPath: c.song.relPath,
        in: c.in,
        out: c.out,
    }));
}

function arrivingClipAfter(index) {
    if (index + 1 < doc.clips.length) return doc.clips[index + 1];
    if (doc.settings && doc.settings.loop && doc.clips.length) return doc.clips[0];
    return null;
}

async function armBounds(clip, deck) {
    const next = arrivingClipAfter(clipIndex);
    const nextOffset = next && next.audioTransition ? Number(next.audioTransition.offset) || 0 : 0;
    await musicCmd('setClipBounds', {
        deck,
        in: clip.in,
        out: clip.out,
        holdAfter: clip.holdAfter || 0,
        audioOffset: nextOffset,
        emitAudioLead: !!next,
        lookCues: (clip.lookCues || []).map((l) => ({ id: l.id, offset: l.offset })),
    });
    await musicCmd('setClipLoop', {
        deck,
        in: clip.in,
        out: clip.out,
        on: !!clip.loopUntilGo,
    });
}

function queuePreload(idleDeck, clip) {
    pendingPreload = clip && idleDeck ? { deck: idleDeck, clip } : null;
}

function flushPreload() {
    const job = pendingPreload;
    if (!job || !job.clip) return;
    pendingPreload = null;
    musicCmd('preloadDeck', {
        deck: job.deck,
        relPath: job.clip.song.relPath,
        time: job.clip.in,
    }).then((r) => {
        if (r && r.ok === false) setStatusLine(`preload miss on ${job.clip.song.title || job.clip.song.relPath}`);
    });
}

async function startClipArrival(index, { fromSilence, go, skip, lookReady } = {}) {
    if (arriving) return;
    if (index < 0 || index >= doc.clips.length) {
        await endShow();
        return;
    }
    arriving = true;
    try {
    await startClipArrivalBody(index, { fromSilence, go, skip, lookReady });
    } finally {
        arriving = false;
    }
}

async function startClipArrivalBody(index, { fromSilence, go, skip, lookReady } = {}) {
    if (index < 0 || index >= doc.clips.length) {
        await endShow();
        return;
    }
    const clip = doc.clips[index];
    const err = (() => {
        if (missingRel.has(clip.song.relPath)) return `Missing song ${clip.song.relPath}`;
        return null;
    })();
    if (err) {
        setStatusLine(err);
        await endShow();
        return;
    }
    clipIndex = index;
    lastDeckTime = Number(clip.in) || 0;
    firedLookCueIds = new Set();
    await displayCmd('finishSceneTransition', { applyIncoming: true });
    visualTransitionId = null;
    visualKind = null;
    const transport = await musicCmd('getTransportState');
    const lead = (transport && transport.lead) || 'A';
    const incoming = fromSilence ? 'A' : pickIdleDeck(lead);
    const outgoing = fromSilence ? null : lead;
    leadShowDeck = incoming;
    setStatusLine(`Readying ${clip.song.title || clip.song.relPath}…`);
    const loaded = await loadClipOnDeck(clip, incoming, clip.in);
    if (!loaded?.ok) {
        setStatusLine(loaded?.error || 'Load failed');
        return;
    }
    await armBounds(clip, incoming);
    const startLook = (clip.lookCues || []).find((l) => l.offset === 0) || clip.lookCues[0];
    const skipLook = !!lookReady;
    if (!skipLook) {
        await applyLook(startLook, 'arrival', skip ? 'cut' : undefined);
    } else if (startLook) {
        firedLookCueIds.add(startLook.id);
    }
    await musicCmd('publishCachedNowPlaying', { relPath: clip.song.relPath });
    await displayCmd('awaitDisplayPrime');
    const at = skip
        ? { type: 'cut', duration: 0, easing: 'linear' }
        : (clip.audioTransition || defaultAudioTransition());
    if (skip) await musicCmd('cancelAudioTransition', { snap: 'incoming' });
    const audio = await musicCmd('startAudioTransition', {
        incomingDeck: incoming,
        outgoingDeck: outgoing,
        type: at.type || 'cut',
        duration: at.duration || 0,
        easing: at.easing || 'linear',
        volIn: clip.volume,
        volOut: skip ? 0 : 1,
        songRelPath: clip.song.relPath,
        publishNow: false,
    });
    audioTransitionId = audio?.transitionId || (at.type === 'cut' || (at.duration || 0) <= 0 ? null : 'aud');
    if (at.type === 'cut' || (at.duration || 0) <= 0) audioTransitionId = null;
    setShowStatus('playing');
    await setDriving(true);
    const afterNext = nextClipIndex();
    if (afterNext >= 0) {
        queuePreload(pickIdleDeck(incoming), doc.clips[afterNext]);
        if (!audioTransitionId) flushPreload();
    } else {
        pendingPreload = null;
    }
    startShowClock();
    renderCueList();
}

async function playShow() {
    if (status === 'playing') {
        await musicCmd('pauseAll');
        await displayCmd('setSceneTransitionPaused', { paused: true });
        setShowStatus('paused');
        return;
    }
    if (status === 'paused') {
        await musicCmd('resumeShow');
        await displayCmd('setSceneTransitionPaused', { paused: false });
        setShowStatus('playing');
        return;
    }
    if (!doc.clips.length) {
        setStatusLine('Add a clip first');
        return;
    }
    const startAt = status === 'preview' ? clipIndex : 0;
    const block = (() => {
        const c = doc.clips[startAt];
        if (!c) return 'No clip';
        if (missingRel.has(c.song.relPath)) return `Missing song ${c.song.relPath}`;
        return null;
    })();
    if (block) {
        setStatusLine(block);
        return;
    }
    showTime = status === 'preview' ? showTime : 0;
    const primed = await primeShow(startAt);
    if (!primed) return;
    await startClipArrival(startAt, { fromSilence: true, lookReady: true });
}

async function primeShow(startAt) {
    const missing = [];
    for (let i = startAt; i < doc.clips.length; i++) {
        const c = doc.clips[i];
        if (missingRel.has(c.song.relPath)) missing.push(c.song.relPath);
        const look = (c.lookCues || []).find((l) => l.offset === 0);
        if (look && look.lookMode === 'snapshot' && !look.scene) missing.push(c.id + ' snapshot');
    }
    if (missing.length) {
        setStatusLine('Cannot start — missing: ' + missing.join(', '));
        return false;
    }
    setStatusLine('Loading songs, covers, and lyrics…');
    $('perf-btn-play').disabled = true;
    try {
        const prep = await musicCmd('prepareShow', { clips: clipPrepareList(startAt) });
        if (!prep?.ok) {
            setStatusLine(prep?.error || 'Prepare failed');
            return false;
        }
        await displayCmd('awaitDisplayPrime');
        const clip = doc.clips[startAt];
        const startLook = (clip.lookCues || []).find((l) => l.offset === 0) || clip.lookCues[0];
        if (startLook && startLook.lookMode === 'snapshot') {
            setStatusLine('Applying first look…');
            await applyLook(startLook, 'arrival', 'cut');
            await displayCmd('awaitDisplayPrime');
        }
        if (prep.nextReady === false) {
            setStatusLine('First clip ready — next track still warming');
        } else {
            setStatusLine('Ready');
        }
        return true;
    } finally {
        $('perf-btn-play').disabled = false;
    }
}

async function stopShow() {
    await musicCmd('cancelAudioTransition', { snap: 'incoming' });
    await displayCmd('finishSceneTransition', { applyIncoming: true });
    await musicCmd('pauseAll');
    const clip = currentClip();
    if (clip) {
        const t = await musicCmd('getTransportState');
        if (t?.lead) await musicCmd('seekDeck', { deck: t.lead, time: clip.in });
    }
    audioTransitionId = null;
    visualTransitionId = null;
    visualKind = null;
    firedLookCueIds = new Set();
    showTime = 0;
    lastDeckTime = currentClip() ? (Number(currentClip().in) || 0) : 0;
    await setDriving(false);
    setShowStatus('idle');
    setStatusLine('Stopped');
}

async function endShow() {
    audioTransitionId = null;
    visualTransitionId = null;
    visualKind = null;
    await musicCmd('pauseAll');
    await setDriving(false);
    setShowStatus('ended');
    setStatusLine('Ended');
}

async function goNext() {
    const why = goBlocked();
    if (why) {
        const left = why === 'audio' ? `${(1 - uAudio).toFixed(1)}s` : `${(1 - uVisual).toFixed(1)}s`;
        const msg = `GO ignored — ${why} ${left} left`;
        setStatusLine(msg);
        console.log('[performance]', msg);
        return;
    }
    if (status !== 'playing' && status !== 'paused') return;
    const ni = nextClipIndex();
    if (ni < 0) {
        await endShow();
        return;
    }
    const clip = currentClip();
    if (clip) await musicCmd('setClipLoop', { deck: 'A', on: false });
    await startClipArrival(ni, { fromSilence: false, go: true });
}

async function skipNext() {
    if (status !== 'playing' && status !== 'paused') return;
    const ni = nextClipIndex();
    if (ni < 0) {
        await endShow();
        return;
    }
    await startClipArrival(ni, { fromSilence: false, skip: true });
}

async function jumpTo(index) {
    if (index < 0 || index >= doc.clips.length) return;
    const keep = status === 'paused' ? 'paused' : (status === 'playing' ? 'playing' : 'playing');
    await startClipArrival(index, { fromSilence: false, skip: true });
    if (keep === 'paused') {
        await musicCmd('pauseAll');
        setShowStatus('paused');
    }
}

async function previewSelected() {
    const clip = selectedClip();
    const look = selectedLook(clip);
    if (!clip) return;
    if (missingRel.has(clip.song.relPath)) {
        setStatusLine(`Missing song ${clip.song.relPath}`);
        return;
    }
    clipIndex = doc.clips.indexOf(clip);
    await musicCmd('prepareShow', { clips: [{ relPath: clip.song.relPath, in: clip.in, out: clip.out }] });
    const t = await musicCmd('getTransportState');
    const deck = (t && t.lead) || 'A';
    await loadClipOnDeck(clip, deck, clip.in + (look ? look.offset : 0));
    await musicCmd('pauseDeck', { deck });
    await applyLook(look, 'arrival', 'cut');
    await setDriving(false);
    setShowStatus('preview');
    setStatusLine('Preview');
}

function onMusicEvent(ev) {
    if (!ev || typeof ev !== 'object') return;
    if (ev.kind === 'showAction') {
        if (ev.action === 'togglePlay') playShow();
        else if (ev.action === 'stop') stopShow();
        return;
    }
    if (ev.kind === 'userTakeover') {
        audioTransitionId = null;
        visualTransitionId = null;
        setShowStatus('idle');
        setStatusLine('Music took over');
        return;
    }
    if (ev.kind === 'transitionDone') {
        audioTransitionId = null;
        flushPreload();
        publishShowState();
        return;
    }
    if (ev.kind === 'preloadMiss') {
        setStatusLine(`preload miss on clip ${clipIndex + 2}`);
        return;
    }
    if (status !== 'playing' && status !== 'paused') return;
    if (ev.kind === 'lookCue') {
        const clip = currentClip();
        if (!clip) return;
        const look = (clip.lookCues || []).find((l) => l.id === ev.id);
        if (!look || firedLookCueIds.has(look.id)) return;
        if (Number(look.offset) <= 0) {
            firedLookCueIds.add(look.id);
            return;
        }
        applyLook(look, 'midclip');
        return;
    }
    if (ev.kind === 'clipBoundary' && ev.which === 'out') {
        const clip = currentClip();
        if (clip && clip.holdAfter > 0 && !audioTransitionId) {
            musicCmd('setDeckGain', { deck: leadShowDeck, gain: 0 });
        }
        if (nextClipIndex() < 0 && !(clip && clip.holdAfter > 0)) {
            endShow();
        }
        return;
    }
    if (ev.kind === 'clipBoundary' && ev.which === 'holdEnd') {
        const clip = currentClip();
        if (clip && clip.loopUntilGo) return;
        const ni = nextClipIndex();
        if (ni < 0) {
            endShow();
            return;
        }
        const next = doc.clips[ni];
        const nextOff = next && next.audioTransition ? Number(next.audioTransition.offset) || 0 : 0;
        if (nextOff > 0) return;
        startClipArrival(ni, { fromSilence: false });
        return;
    }
    if (ev.kind === 'clipBoundary' && ev.which === 'audioLead') {
        const clip = currentClip();
        if (clip && clip.loopUntilGo) return;
        const ni = nextClipIndex();
        if (ni < 0) {
            endShow();
            return;
        }
        startClipArrival(ni, { fromSilence: false });
    }
}

function onSceneUserEdit() {
    if (!inShow) return;
    const clip = currentClip();
    if (!clip) return;
    const look = [...firedLookCueIds].map((id) => (clip.lookCues || []).find((l) => l.id === id)).filter(Boolean).pop()
        || (clip.lookCues || [])[0];
    if (look) {
        staleLookIds.add(look.id);
        renderCueList();
        fillInspector();
        setStatusLine('Look cue marked stale (live edit)');
    }
}

async function saveDoc(asNew) {
    let stem = fileStem;
    if (asNew || !stem) {
        const suggested = (doc.name || 'untitled').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'untitled';
        const typed = window.prompt('File stem (letters, numbers, - _)', suggested);
        if (!typed) return;
        stem = typed;
    }
    if (!doc.name || doc.name === 'Untitled') {
        const n = window.prompt('Performance name', doc.name || stem);
        if (n) doc.name = n;
    }
    const result = await window.musicView.savePerformanceFile(stem, doc);
    if (!result?.ok) {
        setStatusLine(result?.error || 'Save failed');
        return;
    }
    fileStem = result.name;
    doc = result.performance || doc;
    markDirty(false);
    setDocTitle();
    setStatusLine(`Saved ${fileStem}`);
}

async function openDoc() {
    const list = await window.musicView.listPerformances();
    const sel = $('open-list');
    sel.innerHTML = '';
    for (const p of (list.performances || [])) {
        const opt = document.createElement('option');
        opt.value = p.name;
        opt.textContent = `${p.displayName} (${p.clipCount} clips)`;
        sel.appendChild(opt);
    }
    const dlg = $('open-dialog');
    dlg.showModal();
    dlg.addEventListener('close', async function onClose() {
        dlg.removeEventListener('close', onClose);
        if (dlg.returnValue !== 'open') return;
        const name = sel.value;
        if (!name) return;
        const loaded = await window.musicView.loadPerformanceFile(name);
        if (!loaded?.ok) {
            setStatusLine(loaded?.error || 'Open failed');
            return;
        }
        doc = loaded.performance;
        fileStem = loaded.name;
        selectedClipId = doc.clips[0] ? doc.clips[0].id : null;
        selectedLookId = selectedClipId && doc.clips[0].lookCues[0] ? doc.clips[0].lookCues[0].id : null;
        staleLookIds = new Set();
        markDirty(false);
        setDocTitle();
        await refreshSongs();
        renderShowFx();
        fillInspector();
        setStatusLine(`Opened ${fileStem} — warming…`);
        musicCmd('prepareShow', { clips: clipPrepareList(0) }).then((prep) => {
            if (prep?.ok) setStatusLine(`Opened ${fileStem} — assets ready`);
            else if (prep?.error) setStatusLine(prep.error);
        });
    }, { once: true });
}

function newDoc() {
    if (dirty && !window.confirm('Discard unsaved changes?')) return;
    doc = emptyDoc();
    fileStem = null;
    selectedClipId = null;
    selectedLookId = null;
    staleLookIds = new Set();
    markDirty(false);
    setDocTitle();
    renderCueList();
    renderShowFx();
    fillInspector();
    setStatusLine('New performance');
}

async function deleteDoc() {
    if (!fileStem) {
        setStatusLine('Nothing saved to delete');
        return;
    }
    if (!window.confirm(`Delete ${fileStem}?`)) return;
    const result = await window.musicView.deletePerformanceFile(fileStem);
    if (!result?.ok) {
        setStatusLine(result?.error || 'Delete failed');
        return;
    }
    newDoc();
    setStatusLine('Deleted');
}

function wireInspector() {
    const ids = [
        'insp-song', 'insp-in', 'insp-out', 'insp-vol', 'insp-hold', 'insp-loop-go',
        'insp-audio-type', 'insp-audio-dur', 'insp-audio-ease', 'insp-audio-off',
        'insp-look-off', 'insp-vis-type', 'insp-vis-dur', 'insp-vis-ease', 'insp-vis-off',
    ];
    for (const id of ids) {
        const el = $(id);
        if (!el) continue;
        el.addEventListener('change', () => readInspector());
        el.addEventListener('input', () => readInspector());
    }
    $('insp-look-sel').addEventListener('change', () => {
        selectedLookId = $('insp-look-sel').value;
        fillInspector();
    });
}

function wireButtons() {
    $('perf-btn-play').addEventListener('click', () => playShow());
    $('perf-btn-stop').addEventListener('click', () => stopShow());
    $('btn-go').addEventListener('click', () => goNext());
    $('btn-skip').addEventListener('click', () => skipNext());
    $('btn-prev').addEventListener('click', () => jumpTo(Math.max(0, clipIndex - 1)));
    $('btn-new').addEventListener('click', () => newDoc());
    $('btn-open').addEventListener('click', () => openDoc());
    $('btn-save').addEventListener('click', () => saveDoc(false));
    $('btn-save-as').addEventListener('click', () => saveDoc(true));
    $('btn-delete').addEventListener('click', () => deleteDoc());
    $('opt-loop').addEventListener('change', () => {
        doc.settings.loop = $('opt-loop').checked;
        markDirty();
    });
    $('btn-add-clip').addEventListener('click', () => {
        const clip = newClipFromSong(songs[0] || null);
        doc.clips.push(clip);
        selectedClipId = clip.id;
        selectedLookId = clip.lookCues[0].id;
        markDirty();
        renderCueList();
        fillInspector();
    });
    $('btn-capture').addEventListener('click', () => {
        const look = selectedLook();
        if (look) captureLookInto(look);
    });
    $('btn-inherit').addEventListener('click', () => {
        const look = selectedLook();
        if (!look) return;
        look.lookMode = 'inherit';
        look.scene = null;
        markDirty();
        fillInspector();
        renderCueList();
    });
    $('btn-preview').addEventListener('click', () => previewSelected());
    $('btn-add-look').addEventListener('click', () => {
        const clip = selectedClip();
        if (!clip) return;
        const look = inheritLook(Math.max(0.1, (clip.out - clip.in) / 2));
        clip.lookCues.push(look);
        clip.lookCues.sort((a, b) => a.offset - b.offset);
        selectedLookId = look.id;
        markDirty();
        fillInspector();
        renderCueList();
    });
    $('btn-import-look').addEventListener('click', async () => {
        const name = await openPresetPicker('Import look preset');
        const look = selectedLook();
        if (look && name) importPresetInto(look, name);
    });
    const showFxActive = $('showfx-active');
    if (showFxActive) {
        showFxActive.addEventListener('change', () => {
            const fx = ensureShowFx();
            fx.active = !!showFxActive.checked && fx.layers.length > 0;
            if (showFxActive.checked && !fx.layers.length) {
                showFxActive.checked = false;
                fx.active = false;
                setStatusLine('Add a show FX layer first');
                return;
            }
            markDirty();
            renderShowFx();
        });
    }
    $('btn-showfx-add')?.addEventListener('click', async () => {
        const name = await openPresetPicker('Add show FX from preset');
        if (name) await addShowFxFromPreset(name);
    });
    $('btn-showfx-capture')?.addEventListener('click', () => captureShowFxFromLive());
    $('btn-showfx-clear')?.addEventListener('click', () => {
        const fx = ensureShowFx();
        fx.layers = [];
        fx.active = false;
        markDirty();
        renderShowFx();
        setStatusLine('Cleared show FX');
    });
}

function jumpBy(delta) {
    const next = Math.max(0, Math.min(doc.clips.length - 1, clipIndex + (Number(delta) || 0)));
    return jumpTo(next);
}

function exitPreview() {
    if (status !== 'preview') return false;
    setShowStatus('idle');
    setStatusLine('Preview ended');
    return true;
}

function wireKeys() {
    if (root.document.getElementById('dock-show')) return;
    document.addEventListener('keydown', (e) => {
        if (root.__musicViewFocus && root.__musicViewFocus !== 'performance') return;
        const tag = (e.target && e.target.tagName) || '';
        if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
        if (e.code === 'Space') {
            e.preventDefault();
            playShow();
        } else if (e.code === 'Enter' || e.key === 'g' || e.key === 'G') {
            e.preventDefault();
            goNext();
        } else if (e.key === '[') {
            e.preventDefault();
            jumpTo(Math.max(0, clipIndex - 1));
        } else if (e.key === ']') {
            e.preventDefault();
            jumpTo(Math.min(doc.clips.length - 1, clipIndex + 1));
        } else if (e.key === 'Escape') {
            if (status === 'preview') {
                setShowStatus('idle');
                setStatusLine('Preview ended');
            } else if (e.target && e.target.blur) {
                e.target.blur();
            }
        }
    });
}

function wireIpc() {
    if (window.musicView?.onMusicEvent) {
        window.musicView.onMusicEvent(onMusicEvent);
    }
    if (window.musicView?.onSceneUserEdit) {
        window.musicView.onSceneUserEdit(onSceneUserEdit);
    }
    if (window.musicView?.onSceneTransition) {
        window.musicView.onSceneTransition((ev) => {
            if (!ev || !ev.done) return;
            visualTransitionId = null;
            visualKind = null;
            publishShowState();
        });
    }
    if (window.musicView?.onMusicClosed) {
        window.musicView.onMusicClosed(() => {
            status = 'idle';
            inShow = false;
            audioTransitionId = null;
            visualTransitionId = null;
            setShowStatus('idle');
            setStatusLine('Music window closed');
            displayCmd('finishSceneTransition', { applyIncoming: true });
        });
    }
    if (window.musicView?.onPlaybackProgress) {
        window.musicView.onPlaybackProgress((p) => {
            if (!p) return;
            if (Number.isFinite(Number(p.currentTime))) lastDeckTime = Number(p.currentTime);
            if (Number.isFinite(p.uAudio)) uAudio = p.uAudio;
            if (Number.isFinite(p.uVisual)) uVisual = p.uVisual;
        });
    }
}

async function init() {
    setDocTitle();
    wireInspector();
    wireButtons();
    wireKeys();
    wireIpc();
    startShowClock();
    await refreshSongs();
    renderShowFx();
    fillInspector();
    setStatusLine('Ready');
}

document.addEventListener('DOMContentLoaded', init);
root.MusicViewShow = {
    playShow,
    goNext,
    jumpTo,
    jumpBy,
    stopShow,
    exitPreview,
    getStatus: () => status,
    isInShow: () => !!inShow,
};
})(window);
