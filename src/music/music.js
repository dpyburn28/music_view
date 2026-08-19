(function (root) {
const $ = (id) => {
    const scope = root.document.getElementById('dock-music') || root.document;
    return scope.querySelector('#' + id);
};
function qsAll(sel) {
    const scope = root.document.getElementById('dock-music') || root.document;
    return scope.querySelectorAll(sel);
}
function musicViewApi() {
    // Invokes must hit the contextBridge object, not the workspace-bus Proxy.
    return root.__musicViewIpc || root.musicView;
}

/* Music control window — library, transport, scrubbing, LRC lyrics */


let songs = [];
let filtered = [];
let selectedId = null;
let lyricsLines = []; // { time, text }
let lyricsMeta = {};
let seeking = false;
let rafId = null;
/** Last lyric index pushed to the display (avoid spamming IPC). */
let lastPublishedLyricIdx = null;
/** Last progress ratio pushed to the display (throttle IPC). */
let lastPublishedProgress = -1;
let lastProgressPublishAt = 0;

/** @type {ReturnType<typeof window.AudioAnalysis.createAudioAnalyser>|null} */
let audioAnalyser = null;
/** Throttle audio-frame IPC slightly under display refresh when needed. */
let lastAudioFramePublishAt = 0;
/** Extra rAF ticks after pause so beat/envelope can decay gracefully. */
let decayTicksLeft = 0;
const DECAY_TICKS = 18;

const VIZ_STORAGE_KEY = 'music_view_audio_viz';
const TAB_STORAGE_KEY = 'music_view_music_tab';
const vizDefaults = {
    enabled: true,
    localPreview: true,
    // Slightly hot defaults: flux peak-picker + lower FFT smooth
    sensitivity: 1.45,
    inputGain: 1.0,
    refractoryMs: 150,
    pulseDecayMs: 130,
    smoothing: 0.2,
    sendRateHz: 50,
};

/** CSS fill class per channel id */
const METER_FILL_CLASS = {
    full: 'full',
    bass: 'bass',
    lowmid: 'lowmid',
    mid: 'mid',
    presence: 'presence',
    treble: 'treble',
    vocals: 'vocals',
    rms: 'level',
    peak: 'peak',
    envelope: 'env',
    onset: 'flux',
    kick: 'kick',
    beat: 'beat',
};
/** @type {typeof vizDefaults} */
let vizSettings = Object.assign({}, vizDefaults);
/** Reused waveform copy buffers (avoid alloc every frame). */
let waveCopyBuf = null;
let mixWaveCopyBuf = null;
/** Last frame for local canvas painting when not sampling. */
let lastVizFrame = null;
/** Active workspace tab id */
let activeTab = 'lib';

const EMPTY_FX_STORAGE_KEY = 'music_view_empty_lyrics_fx';
const emptyLyricsFxDefaults = {
    enabled: true,
    length: 18,
    lines: 3,
    rate: 14,
    change: 0.38,
    charset: 'mixed',
};
/** @type {typeof emptyLyricsFxDefaults} */
let emptyLyricsFx = Object.assign({}, emptyLyricsFxDefaults);

const DUAL_DECK = true;

/** @type {{ A: HTMLAudioElement, B: HTMLAudioElement } | null} */
let decks = null;
let leadDeck = 'A';
let showDriving = false;
let deckMixer = null;
let audioFade = null;
let clipArm = null;
let clipArmFired = null;

function deckEl(which) {
    if (!decks) {
        decks = { A: $('audio-a'), B: $('audio-b') };
    }
    return which === 'B' ? decks.B : decks.A;
}

const audio = () => deckEl(leadDeck);

function emitMusicEvent(kind, extra) {
    if (!musicViewApi()?.publishMusicEvent) return;
    musicViewApi().publishMusicEvent(Object.assign({ kind }, extra || {}));
}

function easingFn(name) {
    if (name === 'ease-in-out') return (u) => u * u * (3 - 2 * u);
    return (u) => u;
}

function setMixGain(value) {
    const g = Math.max(0, Math.min(1, Number(value)));
    if (deckMixer && deckMixer.mixGain) {
        deckMixer.mixGain.gain.value = g;
    }
}

function setDeckGain(which, value) {
    const g = Math.max(0, Math.min(1, Number(value)));
    if (!deckMixer) return;
    const node = which === 'B' ? deckMixer.gainB : deckMixer.gainA;
    if (node) node.gain.value = g;
}

function getDeckGain(which) {
    if (!deckMixer) return which === leadDeck ? 1 : 0;
    const node = which === 'B' ? deckMixer.gainB : deckMixer.gainA;
    return node ? node.gain.value : 0;
}

function setStatus(msg, kind = '') {
    const el = $('player-status');
    el.textContent = msg || '';
    el.title = msg || '';
    el.className = 'status' + (kind ? ' ' + kind : '');
}

function setSongsDirLabel(dir) {
    const el = $('songs-dir');
    if (!el) return;
    el.title = dir || '';
    // Show only the last two path segments to save header space
    if (!dir) {
        el.textContent = '';
        return;
    }
    const parts = String(dir).replace(/\\/g, '/').split('/').filter(Boolean);
    el.textContent = parts.length >= 2
        ? '…/' + parts.slice(-2).join('/')
        : dir;
}

function formatTime(sec) {
    if (!Number.isFinite(sec) || sec < 0) return '0:00';
    const s = Math.floor(sec % 60);
    const m = Math.floor(sec / 60);
    return `${m}:${String(s).padStart(2, '0')}`;
}

function selectedSong() {
    return songs.find((s) => s.id === selectedId) || null;
}

function loadUi() {
    return window.__musicViewLoad || null;
}

async function refreshLibrary() {
    if (!musicViewApi()?.listSongs) {
        setStatus('Music API missing', 'error');
        return;
    }
    const load = loadUi();
    if (load) load.begin('Scanning library…');
    let result;
    try {
        result = await musicViewApi().listSongs();
    } finally {
        if (load) load.end();
    }
    if (!result?.ok) {
        setSongsDirLabel(result?.dir || 'Unavailable');
        setStatus(result?.error || 'Failed to list songs', 'error');
        songs = [];
    } else {
        songs = result.songs || [];
        setSongsDirLabel(result.dir || '');
        setStatus(`${songs.length} song${songs.length === 1 ? '' : 's'}`);
    }
    applyFilter();
}

function applyFilter() {
    const q = ($('song-filter').value || '').trim().toLowerCase();
    filtered = !q
        ? songs.slice()
        : songs.filter((s) =>
            s.title.toLowerCase().includes(q)
            || s.name.toLowerCase().includes(q)
            || (s.artist && s.artist.toLowerCase().includes(q))
            || (s.genre && s.genre.toLowerCase().includes(q)),
        );
    renderSongList();
}

function renderSongList() {
    const list = $('song-list');
    list.innerHTML = '';
    $('library-empty').classList.toggle('hidden', filtered.length > 0);

    for (const song of filtered) {
        const li = document.createElement('li');
        li.dataset.id = song.id;
        if (song.id === selectedId) li.classList.add('selected');

        const thumb = document.createElement('img');
        thumb.className = 'song-thumb';
        thumb.alt = '';
        thumb.loading = 'lazy';
        li.appendChild(thumb);

        const info = document.createElement('span');
        info.className = 'song-info';

        const title = document.createElement('span');
        title.className = 'song-title';
        title.textContent = song.title;
        title.title = song.name;
        info.appendChild(title);

        const metaParts = [];
        if (song.artist) metaParts.push(song.artist);
        if (song.genre) metaParts.push(song.genre);
        if (metaParts.length) {
            const sub = document.createElement('span');
            sub.className = 'song-meta';
            sub.textContent = metaParts.join(' \u00B7 ');
            info.appendChild(sub);
        }

        li.appendChild(info);

        const badge = document.createElement('span');
        badge.className = 'badge' + (song.hasLyrics ? '' : ' muted');
        badge.textContent = song.hasLyrics ? 'LRC' : '—';
        badge.title = song.hasLyrics ? 'Synced lyrics available' : 'No .lrc file';
        li.appendChild(badge);

        li.addEventListener('click', () => selectSong(song.id));
        list.appendChild(li);
    }
    loadVisibleCovers();
}

const coverCache = new Map();
let coverObserver = null;

function loadVisibleCovers() {
    const list = $('song-list');
    if (!list) return;

    if (coverObserver) coverObserver.disconnect();

    const thumbs = list.querySelectorAll('.song-thumb:not([src])');
    if (!thumbs.length) return;

    if (!coverObserver) {
        coverObserver = new IntersectionObserver((entries) => {
            for (const entry of entries) {
                if (!entry.isIntersecting) continue;
                const img = entry.target;
                coverObserver.unobserve(img);
                fetchCoverForThumb(img);
            }
        }, { root: $('song-list'), rootMargin: '200px' });
    }

    for (const thumb of thumbs) {
        const li = thumb.closest('li');
        const songId = li?.dataset?.id;
        if (!songId) continue;

        if (coverCache.has(songId)) {
            const cached = coverCache.get(songId);
            if (cached) thumb.src = cached;
            continue;
        }
        coverObserver.observe(thumb);
    }
}

async function fetchCoverForThumb(img) {
    const li = img.closest('li');
    const songId = li?.dataset?.id;
    if (!songId) return;
    if (coverCache.has(songId)) {
        const cached = coverCache.get(songId);
        if (cached) img.src = cached;
        return;
    }

    const song = songs.find(s => s.id === songId);
    if (!song?.path || !musicViewApi()?.getCover) return;

    try {
        const result = await musicViewApi().getCover(song.path);
        if (result?.ok && result.dataUrl) {
            coverCache.set(songId, result.dataUrl);
            if (img.isConnected) img.src = result.dataUrl;
        } else {
            coverCache.set(songId, null);
        }
    } catch (_) {
        coverCache.set(songId, null);
    }
}

const COVER_PRELOAD_CONCURRENCY = 4;

async function preloadCovers() {
    if (!songs.length || !musicViewApi()?.getCover) return;
    const load = loadUi();
    let loaded = 0;
    const total = songs.length;
    const queue = songs.filter((s) => !coverCache.has(s.id));
    if (!queue.length) return;

    const workers = Array.from({ length: Math.min(COVER_PRELOAD_CONCURRENCY, queue.length) }, async () => {
        while (queue.length) {
            const song = queue.shift();
            try {
                const result = await musicViewApi().getCover(song.path);
                if (result?.ok && result.dataUrl) {
                    coverCache.set(song.id, result.dataUrl);
                } else {
                    coverCache.set(song.id, null);
                }
            } catch (_) {
                coverCache.set(song.id, null);
            }
            loaded++;
            if (load && loaded % 4 === 0) {
                load.set(60 + Math.round((loaded / total) * 35), `Loading covers\u2026 ${loaded}/${total}`);
            }
        }
    });
    await Promise.allSettled(workers);
}

function clearCoverArt() {
    const img = $('cover-art');
    const wrap = $('cover-wrap');
    const ph = $('cover-placeholder');
    if (img) {
        img.removeAttribute('src');
        img.classList.add('hidden');
        img.alt = '';
    }
    if (ph) ph.classList.remove('hidden');
    if (wrap) wrap.classList.add('empty');
}

function showCoverArt(dataUrl, title) {
    const img = $('cover-art');
    const wrap = $('cover-wrap');
    const ph = $('cover-placeholder');
    if (!img || !dataUrl) {
        clearCoverArt();
        return;
    }
    img.src = dataUrl;
    img.alt = title ? `Cover · ${title}` : 'Album cover';
    img.classList.remove('hidden');
    if (ph) ph.classList.add('hidden');
    if (wrap) wrap.classList.remove('empty');
}

async function loadCoverForSong(song) {
    clearCoverArt();
    if (!song?.path || !musicViewApi()?.getCover) return;
    try {
        const result = await musicViewApi().getCover(song.path);
        // Ignore if user already selected another track
        if (selectedId !== song.id) return;
        if (result?.ok && result.dataUrl) {
            showCoverArt(result.dataUrl, song.title);
        }
    } catch (e) {
        console.warn('Cover load failed', e);
    }
}

async function selectSong(id) {
    if (showDriving) {
        setStatus('Performance driving playback', 'error');
        return;
    }
    selectedId = id;
    renderSongList();

    const song = selectedSong();
    if (!song) return;

    $('now-title').textContent = song.title;
    $('now-meta').textContent = song.name;
    clearCoverArt();

    // Load audio (preload enough for reliable seeking)
    const a = audio();
    a.pause();
    stopTick();
    seeking = false;
    a.preload = 'auto';
    a.src = song.fileUrl;
    a.load();
    if (audioAnalyser) audioAnalyser.resetDetectors();
    lastPublishedProgress = -1;
    publishPlaybackProgressToDisplay(true);
    publishAudioAnalysisFrame(true);

    $('music-btn-play').disabled = false;
    $('music-btn-stop').disabled = false;
    $('seek').disabled = true; // enabled after metadata
    $('seek').value = '0';
    $('seek').max = '0';
    $('music-btn-play').textContent = '▶';
    $('music-btn-play').title = 'Play';
    setStatus('Loading…');

    const load = loadUi();
    if (load) load.begin('Loading track…');
    try {
    // Cover (local UI) + lyrics + push display panels
    await Promise.all([
        loadCoverForSong(song),
        loadLyricsForSong(song),
        publishNowPlayingToDisplay(song),
    ]);
    } finally {
        if (load) load.end();
    }
}

/** Tell the display window to update cover + track info panels. */
async function publishNowPlayingToDisplay(song) {
    if (!song?.path || !musicViewApi()?.getSongDisplayInfo) return;
    try {
        const info = await musicViewApi().getSongDisplayInfo(song.path);
        if (selectedId !== song.id) return;
        // Annotate lyrics availability from library list
        info.hasLyrics = !!song.hasLyrics;
        if (musicViewApi().publishNowPlaying) {
            musicViewApi().publishNowPlaying(info);
        }
        // Reset display lyric focus + progress for the new track
        lastPublishedLyricIdx = null;
        lastPublishedProgress = -1;
        publishLyricFocusToDisplay(true);
        publishPlaybackProgressToDisplay(true);
    } catch (e) {
        console.warn('publishNowPlaying failed', e);
    }
}

/**
 * Push focused lyric (prev / current / next) to the display floating panel.
 * @param {boolean} [force] — send even if index unchanged
 */
function publishLyricFocusToDisplay(force = false) {
    if (!musicViewApi()?.publishLyricFocus) return;

    if (!lyricsLines.length) {
        if (force || lastPublishedLyricIdx !== -2) {
            lastPublishedLyricIdx = -2;
            musicViewApi().publishLyricFocus({
                hasLyrics: false,
                index: -1,
                prev: '',
                current: 'No lyrics for this track',
                next: '',
            });
        }
        return;
    }

    const t = audio().currentTime || 0;
    const idx = activeLyricIndex(t);
    if (!force && idx === lastPublishedLyricIdx) return;
    lastPublishedLyricIdx = idx;

    const prev = idx > 0 ? (lyricsLines[idx - 1].text || '') : '';
    const current = idx >= 0 ? (lyricsLines[idx].text || '') : '';
    const next = (idx >= 0 && idx < lyricsLines.length - 1)
        ? (lyricsLines[idx + 1].text || '')
        : (idx < 0 && lyricsLines[0] ? lyricsLines[0].text : '');

    musicViewApi().publishLyricFocus({
        hasLyrics: true,
        index: idx,
        time: t,
        prev,
        current: current || (idx < 0 ? '…' : ''),
        next: idx < 0 ? next : (idx < lyricsLines.length - 1 ? next : ''),
    });
}

/**
 * Push song progress (0..1) to the display progress-bar container.
 * Throttled while playing; force on seek/stop/load.
 * @param {boolean} [force]
 */
function publishPlaybackProgressToDisplay(force = false) {
    if (!musicViewApi()?.publishPlaybackProgress) return;

    const a = audio();
    const cur = a.currentTime || 0;
    const dur = Number.isFinite(a.duration) && a.duration > 0 ? a.duration : 0;
    const progress = dur > 0 ? Math.min(1, Math.max(0, cur / dur)) : 0;
    const now = performance.now();

    // ~20 updates/sec while scrubbing/playing; always send meaningful jumps
    if (
        !force &&
        Math.abs(progress - lastPublishedProgress) < 0.002 &&
        now - lastProgressPublishAt < 50
    ) {
        return;
    }
    lastPublishedProgress = progress;
    lastProgressPublishAt = now;

    musicViewApi().publishPlaybackProgress({
        currentTime: cur,
        duration: dur,
        progress,
        paused: !!a.paused,
    });
}

async function loadLyricsForSong(song) {
    lyricsLines = [];
    lyricsMeta = {};
    const status = $('lyrics-status');
    const metaEl = $('lyrics-meta');
    const view = $('lyrics-view');

    if (!song.hasLyrics || !song.lyricsPath) {
        status.textContent = 'No .lrc lyrics for this song.';
        status.classList.remove('hidden');
        metaEl.classList.add('hidden');
        metaEl.textContent = '';
        view.innerHTML = '<div class="placeholder">No synced lyrics file<br><code>' +
            escapeHtml(song.title) + '.lrc</code></div>';
        return;
    }

    status.textContent = 'Loading lyrics…';
    const result = await musicViewApi().loadLyrics(song.lyricsPath);
    if (!result?.ok) {
        status.textContent = result?.error || 'Failed to load lyrics';
        metaEl.classList.add('hidden');
        view.innerHTML = '<div class="placeholder">Could not read lyrics file</div>';
        return;
    }

    lyricsLines = result.lines || [];
    lyricsMeta = result.meta || {};
    lastPublishedLyricIdx = null;

    const bits = [];
    if (lyricsMeta.ti) bits.push(lyricsMeta.ti);
    if (lyricsMeta.ar) bits.push(lyricsMeta.ar);
    if (lyricsMeta.al) bits.push(lyricsMeta.al);
    metaEl.textContent = bits.length
        ? bits.join(' · ') + ` · ${lyricsLines.length} lines`
        : `${lyricsLines.length} lyric line${lyricsLines.length === 1 ? '' : 's'}`;
    metaEl.classList.remove('hidden');
    status.textContent = `Lyrics: ${song.title}.lrc`;
    renderLyrics(0);
    publishLyricFocusToDisplay(true);
}

function renderLyrics(activeIndex) {
    const view = $('lyrics-view');
    if (!lyricsLines.length) {
        view.innerHTML = '<div class="placeholder">Empty lyrics file</div>';
        return;
    }

    const frag = document.createDocumentFragment();
    lyricsLines.forEach((line, i) => {
        const div = document.createElement('div');
        div.className = 'line' + (i === activeIndex ? ' active' : '') + (!line.text ? ' empty' : '');
        div.dataset.index = String(i);
        div.textContent = line.text || '♪';
        div.title = formatTime(line.time);
        div.addEventListener('click', () => {
            seekTo(line.time);
        });
        frag.appendChild(div);
    });
    view.innerHTML = '';
    view.appendChild(frag);

    const active = view.querySelector('.line.active');
    if (active) {
        active.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
}

function activeLyricIndex(time) {
    if (!lyricsLines.length) return -1;
    let idx = -1;
    for (let i = 0; i < lyricsLines.length; i++) {
        if (lyricsLines[i].time <= time + 0.02) idx = i;
        else break;
    }
    return idx;
}

function updateUiFromAudio() {
    const a = audio();
    const cur = a.currentTime || 0;
    const dur = Number.isFinite(a.duration) ? a.duration : 0;

    $('time-cur').textContent = formatTime(cur);
    $('time-dur').textContent = formatTime(dur);

    if (!seeking) {
        const seek = $('seek');
        if (dur > 0) {
            seek.max = String(dur);
            seek.value = String(cur);
        } else {
            seek.max = '0';
            seek.value = '0';
        }
    }

    $('music-btn-play').textContent = a.paused ? '▶' : '❚❚';
    $('music-btn-play').title = a.paused ? 'Play' : 'Pause';

    if (lyricsLines.length) {
        const idx = activeLyricIndex(cur);
        const view = $('lyrics-view');
        const prev = view.querySelector('.line.active');
        const next = idx >= 0 ? view.querySelector(`.line[data-index="${idx}"]`) : null;
        if (prev !== next) {
            if (prev) prev.classList.remove('active');
            if (next) {
                next.classList.add('active');
                next.scrollIntoView({ block: 'center', behavior: 'smooth' });
            }
        }
    }

    // Keep display floating lyrics panel in sync (throttled by index change)
    publishLyricFocusToDisplay(false);
    // Keep display progress bar canvas in sync
    publishPlaybackProgressToDisplay(false);
    // Live waveform / beat → display shaders
    publishAudioAnalysisFrame(false);
}

function audioFrameMinMs() {
    const hz = Number(vizSettings.sendRateHz) || 48;
    return 1000 / Math.max(10, Math.min(60, hz));
}

function applyAnalyserConfig(analyser) {
    if (!analyser) return;
    analyser.setSensitivity(vizSettings.sensitivity);
    if (typeof analyser.setInputGain === 'function') {
        analyser.setInputGain(vizSettings.inputGain);
    }
    if (typeof analyser.setRefractoryMs === 'function') {
        analyser.setRefractoryMs(vizSettings.refractoryMs);
    }
    if (typeof analyser.setPulseDecayMs === 'function') {
        analyser.setPulseDecayMs(vizSettings.pulseDecayMs);
    }
    if (typeof analyser.setSmoothing === 'function') {
        analyser.setSmoothing(vizSettings.smoothing);
    }
    if (typeof analyser.setWaveSource === 'function') {
        analyser.setWaveSource('full');
    }
}

function applyAllAnalyserConfig() {
    applyAnalyserConfig(audioAnalyser);
    if (deckMixer && deckMixer.mixAnalyser) applyAnalyserConfig(deckMixer.mixAnalyser);
}

function ensureDeckMixer() {
    if (deckMixer || !DUAL_DECK) return deckMixer;
    if (!window.AudioAnalysis?.createDeckMixer) return null;
    const a = deckEl('A');
    const b = deckEl('B');
    if (!a || !b) return null;
    try {
        deckMixer = window.AudioAnalysis.createDeckMixer(a, b, {
            sensitivity: vizSettings.sensitivity,
            inputGain: vizSettings.inputGain,
            refractoryMs: vizSettings.refractoryMs,
            pulseDecayMs: vizSettings.pulseDecayMs,
            waveSource: 'full',
        });
        audioAnalyser = deckMixer.analyser;
        a.volume = 1;
        b.volume = 1;
        setMixGain(Number($('volume')?.value) || 1);
        setDeckGain('A', 1);
        setDeckGain('B', 0);
    } catch (e) {
        console.warn('Deck mixer failed', e);
        setStatus('Dual-deck unavailable — cut only', 'error');
        deckMixer = null;
    }
    return deckMixer;
}

function ensureAudioAnalyser() {
    if (DUAL_DECK && window.AudioAnalysis?.createDeckMixer) {
        ensureDeckMixer();
        applyAllAnalyserConfig();
        return audioAnalyser;
    }
    if (!window.AudioAnalysis?.createAudioAnalyser) return null;
    if (!audioAnalyser) {
        audioAnalyser = window.AudioAnalysis.createAudioAnalyser(audio(), {
            sensitivity: vizSettings.sensitivity,
            inputGain: vizSettings.inputGain,
            refractoryMs: vizSettings.refractoryMs,
            pulseDecayMs: vizSettings.pulseDecayMs,
            waveSource: 'full',
        });
    }
    applyAllAnalyserConfig();
    return audioAnalyser;
}

function analysisChannels() {
    return (window.AudioAnalysis && window.AudioAnalysis.CHANNELS) || [];
}

function channelValue(frame, id) {
    if (window.AudioAnalysis && typeof window.AudioAnalysis.channelValue === 'function') {
        return window.AudioAnalysis.channelValue(frame, id);
    }
    if (!frame) return 0;
    if (frame.channels && Number.isFinite(frame.channels[id])) return frame.channels[id];
    if (Number.isFinite(frame[id])) return frame[id];
    return 0;
}

function buildMeterGrid() {
    const grid = $('viz-meter-grid');
    if (!grid) return;
    const chans = analysisChannels();
    if (!chans.length) {
        grid.innerHTML = '<p class="hint">Analysis catalog unavailable</p>';
        return;
    }
    grid.innerHTML = '';
    for (const ch of chans) {
        const fill = METER_FILL_CLASS[ch.id] || 'level';
        const cell = document.createElement('div');
        cell.className = 'meter-cell';
        cell.dataset.channel = ch.id;
        cell.title = [ch.label, ch.hz, ch.hint].filter(Boolean).join(' · ');
        cell.innerHTML =
            `<div class="meter-head"><span>${escapeHtml(ch.label)}</span>`
            + `<span id="viz-n-${ch.id}" class="meter-num">0.00</span></div>`
            + `<div class="viz-meter-track">`
            + `<div id="viz-meter-${ch.id}" class="viz-meter-fill ${fill}"></div></div>`;
        grid.appendChild(cell);
    }
}

function fmt01(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return '0.00';
    return Math.max(0, Math.min(1, n)).toFixed(2);
}

function updateVizMeters(frame) {
    const setBar = (id, v) => {
        const el = $(id);
        if (!el) return;
        const pct = Math.round(Math.max(0, Math.min(1, Number(v) || 0)) * 100);
        el.style.width = pct + '%';
    };
    const setNum = (id, v) => {
        const el = $(id);
        if (el) el.textContent = fmt01(v);
    };

    const chans = analysisChannels();
    if (!frame) {
        for (const ch of chans) {
            setBar('viz-meter-' + ch.id, 0);
            setNum('viz-n-' + ch.id, 0);
        }
        setNum('viz-beat-val', 0);
        setNum('viz-env-val', 0);
        const thr = $('viz-thr-val');
        const agc = $('viz-agc-val');
        if (thr) thr.textContent = '—';
        if (agc) agc.textContent = '—';
        const lamp = $('viz-beat-lamp');
        if (lamp) lamp.classList.remove('on');
        return;
    }

    for (const ch of chans) {
        const v = channelValue(frame, ch.id);
        setBar('viz-meter-' + ch.id, v);
        setNum('viz-n-' + ch.id, v);
    }

    const beatV = channelValue(frame, 'beat');
    const envV = channelValue(frame, 'envelope');
    setNum('viz-beat-val', beatV);
    setNum('viz-env-val', envV);

    const thrEl = $('viz-thr-val');
    if (thrEl) thrEl.textContent = frame.threshold != null ? fmt01(frame.threshold) : '—';
    const agcEl = $('viz-agc-val');
    if (agcEl) agcEl.textContent = frame.agc != null ? fmt01(frame.agc) : '—';

    const lamp = $('viz-beat-lamp');
    if (lamp) lamp.classList.toggle('on', beatV > 0.28);

    if (vizSettings.localPreview && activeTab === 'analysis') {
        drawVizScope(frame);
        drawVizSpectrum(frame);
    }
}

function resizeVizCanvas(canvas) {
    if (!canvas) return null;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.floor(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
    }
    return canvas.getContext('2d');
}

function drawVizScope(frame) {
    const canvas = $('viz-scope');
    const ctx = resizeVizCanvas(canvas);
    if (!ctx || !canvas) return;
    const w = canvas.width;
    const h = canvas.height;
    ctx.fillStyle = '#0a0c10';
    ctx.fillRect(0, 0, w, h);

    // Grid
    ctx.strokeStyle = 'rgba(90, 110, 140, 0.22)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, h * 0.5);
    ctx.lineTo(w, h * 0.5);
    ctx.stroke();
    for (let i = 1; i < 4; i++) {
        const x = (w * i) / 4;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
    }

    const wave = frame.waveform;
    if (!wave || !wave.length) return;

    const mid = h * 0.5;
    const amp = h * 0.42;
    ctx.strokeStyle = '#5eead4';
    ctx.lineWidth = Math.max(1, w / 280);
    ctx.beginPath();
    for (let i = 0; i < wave.length; i++) {
        const x = (i / (wave.length - 1)) * w;
        const y = mid - ((wave[i] - 128) / 128) * amp;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Glow pass
    ctx.strokeStyle = 'rgba(94, 234, 212, 0.25)';
    ctx.lineWidth = Math.max(2, w / 120);
    ctx.stroke();

    const hint = $('viz-scope-hint');
    if (hint) {
        const src = frame.waveSource || 'full';
        let extra = `${src} · ${fmt01(channelValue(frame, src))}`;
        if ((src === 'vocals' || src === 'center') && frame.stereoWidth != null) {
            const w = Number(frame.stereoWidth) || 0;
            extra += w < 0.06 ? ' · mono-ish' : ` · stereo ${fmt01(w)}`;
        }
        hint.textContent = extra;
    }
}

function drawVizSpectrum(frame) {
    const canvas = $('viz-spectrum');
    const ctx = resizeVizCanvas(canvas);
    if (!ctx || !canvas) return;
    const w = canvas.width;
    const h = canvas.height;
    ctx.fillStyle = '#0a0c10';
    ctx.fillRect(0, 0, w, h);

    const freq = frame.frequency;
    if (!freq || !freq.length) {
        const hint = $('viz-spec-hint');
        if (hint) hint.textContent = 'no FFT';
        return;
    }

    // Log-ish bins: take lower half of spectrum (musical range)
    const usable = Math.min(freq.length, Math.floor(freq.length * 0.55));
    const bars = Math.min(64, usable);
    const gap = Math.max(1, Math.floor(w / bars) > 3 ? 1 : 0);
    const barW = w / bars;

    for (let i = 0; i < bars; i++) {
        // Map bar index with mild log emphasis toward lows
        const t = i / (bars - 1);
        const src = Math.floor(Math.pow(t, 1.35) * (usable - 1));
        const v = freq[src] / 255;
        const bh = Math.max(1, v * h * 0.92);
        const x = i * barW;
        const g = ctx.createLinearGradient(0, h - bh, 0, h);
        g.addColorStop(0, '#a78bfa');
        g.addColorStop(0.5, '#5b8cff');
        g.addColorStop(1, '#3d8f9a');
        ctx.fillStyle = g;
        ctx.fillRect(x + gap, h - bh, Math.max(1, barW - gap), bh);
    }

    // Bass / mid region markers
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(0, 0, barW * 8, 2);

    const hint = $('viz-spec-hint');
    if (hint) {
        hint.textContent = `${usable} bins · bass ${fmt01(frame.bass)} mid ${fmt01(frame.mid)}`;
    }
}

function setVizStatus(text) {
    const el = $('viz-status');
    if (!el) return;
    el.textContent = text || '';
    el.classList.remove('live', 'off', 'error');
    const t = String(text || '').toLowerCase();
    if (t === 'live') el.classList.add('live');
    else if (t === 'off') el.classList.add('off');
    else if (t === 'error' || t === 'unavailable') el.classList.add('error');
}

function deckIsPlaying(el) {
    return !!(el && el.src && !el.paused && !el.ended);
}

function anyDeckPlaying() {
    if (deckIsPlaying(deckEl('A')) || deckIsPlaying(deckEl('B'))) return true;
    return deckIsPlaying(audio());
}

function copyWaveform(src, reuse) {
    if (!(src instanceof Uint8Array) && !Array.isArray(src)) return reuse || null;
    const n = src.length;
    const buf = (reuse && reuse.length === n) ? reuse : new Uint8Array(n);
    if (src instanceof Uint8Array) buf.set(src);
    else {
        for (let i = 0; i < n; i++) {
            const v = src[i] | 0;
            buf[i] = v < 0 ? 0 : v > 255 ? 255 : v;
        }
    }
    return buf;
}

function compactAudioTap(frame, waveBuf, playing) {
    if (!frame) return null;
    const wave = copyWaveform(frame.waveform, waveBuf);
    const channels = frame.channels
        ? Object.assign({}, frame.channels)
        : {
            full: frame.full,
            bass: frame.bass,
            lowmid: frame.lowmid,
            mid: frame.mid,
            presence: frame.presence,
            treble: frame.treble,
            vocals: frame.vocals,
            rms: frame.rms,
            peak: frame.peak,
            envelope: frame.envelope,
            onset: frame.onset != null ? frame.onset : frame.flux,
            kick: frame.kick,
            beat: frame.beat,
        };
    return {
        playing: !!playing,
        rms: frame.rms,
        bass: frame.bass,
        mid: frame.mid,
        envelope: frame.envelope,
        beat: frame.beat,
        flux: frame.flux,
        peak: frame.peak,
        onset: frame.onset,
        kick: frame.kick,
        channels,
        waveform: wave,
        waveSource: 'full',
    };
}

/**
 * Ensure Web Audio graph exists and sample → IPC for display shaders.
 * Publishes lead (incoming track) and mix (audible blend) taps.
 * @param {boolean} [force]
 */
function publishAudioAnalysisFrame(force = false) {
    if (!window.AudioAnalysis?.createAudioAnalyser) {
        setVizStatus('Unavailable');
        return;
    }

    // Sample when streaming to display, or when the Analysis tab needs a local preview
    const wantSample = vizSettings.enabled
        || (vizSettings.localPreview && activeTab === 'analysis');

    if (!wantSample) {
        updateVizMeters(null);
        setVizStatus(vizSettings.enabled ? 'Idle' : 'Off');
        return;
    }

    const analyser = ensureAudioAnalyser();
    if (!analyser) return;

    const a = audio();
    const now = performance.now();
    if (!force && now - lastAudioFramePublishAt < audioFrameMinMs()) return;

    const playing = anyDeckPlaying();
    let frame = null;
    let mixRaw = null;

    if (playing || decayTicksLeft > 0 || (vizSettings.localPreview && activeTab === 'analysis' && playing)) {
        frame = analyser.sample();
        if (deckMixer && deckMixer.mixAnalyser && typeof deckMixer.mixAnalyser.sample === 'function') {
            mixRaw = deckMixer.mixAnalyser.sample();
        }
        if (!playing && frame) {
            frame = Object.assign({}, frame, {
                playing: false,
                rms: (frame.rms || 0) * 0.35,
                bass: (frame.bass || 0) * 0.3,
                mid: (frame.mid || 0) * 0.3,
                envelope: (frame.envelope || 0) * 0.5,
                peak: (frame.peak || 0) * 0.35,
            });
            if (decayTicksLeft > 0) decayTicksLeft = Math.max(0, decayTicksLeft - 1);
        }
    }

    if (!frame) {
        const n = window.AudioAnalysis.WAVE_BINS || 256;
        if (!waveCopyBuf || waveCopyBuf.length !== n) waveCopyBuf = new Uint8Array(n);
        waveCopyBuf.fill(128);
        frame = {
            t: a.currentTime || 0,
            playing: false,
            rms: 0,
            bass: 0,
            mid: 0,
            envelope: 0,
            beat: 0,
            flux: 0,
            peak: 0,
            waveform: waveCopyBuf,
            frequency: null,
        };
    } else if (frame.waveform instanceof Uint8Array) {
        waveCopyBuf = copyWaveform(frame.waveform, waveCopyBuf);
        // Keep frequency reference only for local UI (not sent over IPC)
        frame = Object.assign({}, frame, { waveform: waveCopyBuf, playing });
    }

    const uiFrame = (audioFade && mixRaw) ? Object.assign({}, frame, {
        waveform: copyWaveform(mixRaw.waveform, mixWaveCopyBuf) || frame.waveform,
        channels: mixRaw.channels || frame.channels,
        rms: mixRaw.rms,
        bass: mixRaw.bass,
        mid: mixRaw.mid,
        envelope: mixRaw.envelope,
        beat: mixRaw.beat,
        playing,
    }) : frame;
    if (audioFade && mixRaw && mixRaw.waveform instanceof Uint8Array) {
        mixWaveCopyBuf = copyWaveform(mixRaw.waveform, mixWaveCopyBuf);
    }

    lastAudioFramePublishAt = now;
    lastVizFrame = uiFrame;
    updateVizMeters(uiFrame);

    if (analyser.getError && analyser.getError()) {
        setVizStatus('Error');
    } else if (playing) {
        setVizStatus(analyser.isReady() ? 'Live' : 'Starting…');
    } else if (decayTicksLeft > 0) {
        setVizStatus('Decay');
    } else {
        setVizStatus(analyser.isReady() ? 'Ready' : 'Idle');
    }

    if (!vizSettings.enabled) return;
    if (!musicViewApi()?.publishAudioFrame) return;

    const leadTap = compactAudioTap(frame, waveCopyBuf, playing);
    let mixTap = null;
    if (mixRaw) {
        mixWaveCopyBuf = copyWaveform(mixRaw.waveform, mixWaveCopyBuf);
        mixTap = compactAudioTap(mixRaw, mixWaveCopyBuf, playing);
    }

    const published = leadTap || {
        t: frame.t,
        playing,
        rms: frame.rms,
        bass: frame.bass,
        mid: frame.mid,
        envelope: frame.envelope,
        beat: frame.beat,
        flux: frame.flux,
        peak: frame.peak,
        onset: frame.onset,
        kick: frame.kick,
        channels: frame.channels,
        waveform: frame.waveform,
        waveSource: 'full',
    };
    musicViewApi().publishAudioFrame(Object.assign({
        t: frame.t,
        waveSource: 'full',
    }, published, {
        playing,
        lead: leadTap,
        mix: mixTap || leadTap,
    }));
}

function ensureAudioAnalysisOnPlay() {
    const analyser = ensureAudioAnalyser();
    if (!analyser) return;
    decayTicksLeft = 0;
    analyser.resume().catch(() => { /* autoplay policies */ });
    if (deckMixer?.mixAnalyser && typeof deckMixer.mixAnalyser.resume === 'function') {
        deckMixer.mixAnalyser.resume().catch(() => { /* autoplay policies */ });
    }
}

function tick() {
    updateUiFromAudio();
    try { tickClipArm(); } catch (_) { /* ignore */ }
    const armedPlaying = !!(clipArm && deckEl(clipArm.deck) && !deckEl(clipArm.deck).paused);
    if (!audio().paused || armedPlaying || anyDeckPlaying() || audioFade) {
        rafId = requestAnimationFrame(tick);
    } else if (decayTicksLeft > 0 && vizSettings.enabled) {
        rafId = requestAnimationFrame(tick);
    } else {
        rafId = null;
        publishAudioAnalysisFrame(true);
    }
}

function startTick() {
    if (rafId == null) rafId = requestAnimationFrame(tick);
}

function stopTick() {
    if (rafId != null) {
        cancelAnimationFrame(rafId);
        rafId = null;
    }
}

function togglePlay() {
    if (showDriving) {
        emitMusicEvent('showAction', { action: 'togglePlay' });
        return;
    }
    const a = audio();
    if (!a.src) return;
    if (a.paused) {
        ensureAudioAnalysisOnPlay();
        a.play().then(() => {
            setStatus('Playing');
            startTick();
        }).catch((e) => {
            setStatus(String(e && e.message ? e.message : e), 'error');
        });
    } else {
        a.pause();
        setStatus('Paused');
        decayTicksLeft = DECAY_TICKS;
        updateUiFromAudio();
        startTick(); // keep sampling briefly so beat decays
    }
}

function stopPlayback() {
    if (showDriving) {
        emitMusicEvent('showAction', { action: 'stop' });
        return;
    }
    const a = audio();
    a.pause();
    a.currentTime = 0;
    if (audioAnalyser) audioAnalyser.resetDetectors();
    decayTicksLeft = DECAY_TICKS;
    setStatus('Stopped');
    updateUiFromAudio();
    startTick();
}

function escapeHtml(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// ── Empty lyrics glitch FX (Music → display) ──────────────────────────

function loadEmptyLyricsFxFromStorage() {
    try {
        const raw = localStorage.getItem(EMPTY_FX_STORAGE_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
            emptyLyricsFx = normalizeEmptyLyricsFxLocal(parsed);
        }
    } catch (e) { /* ignore */ }
}

function saveEmptyLyricsFxToStorage() {
    try {
        localStorage.setItem(EMPTY_FX_STORAGE_KEY, JSON.stringify(emptyLyricsFx));
    } catch (e) { /* ignore */ }
}

function normalizeEmptyLyricsFxLocal(o) {
    const length = Math.round(Number(o.length));
    const lines = Math.round(Number(o.lines));
    const rate = Number(o.rate);
    const change = Number(o.change);
    let charset = String(o.charset || 'mixed').toLowerCase();
    const allowed = new Set([
        'mixed', 'hex', 'binary', 'ascii', 'blocks', 'symbols', 'matrix', 'special',
    ]);
    if (!allowed.has(charset)) charset = 'mixed';
    return {
        enabled: o.enabled !== false,
        length: Number.isFinite(length) ? Math.max(4, Math.min(48, length)) : 18,
        lines: Number.isFinite(lines) ? Math.max(1, Math.min(5, lines)) : 3,
        rate: Number.isFinite(rate) ? Math.max(0.5, Math.min(40, rate)) : 14,
        change: Number.isFinite(change) ? Math.max(0.05, Math.min(1, change)) : 0.38,
        charset,
    };
}

function readEmptyLyricsFxFromForm() {
    return normalizeEmptyLyricsFxLocal({
        enabled: !!$('elfx-enabled')?.checked,
        length: Number($('elfx-length')?.value),
        lines: Number($('elfx-lines')?.value),
        rate: Number($('elfx-rate')?.value),
        change: Number($('elfx-change')?.value),
        charset: $('elfx-charset')?.value,
    });
}

function writeEmptyLyricsFxToForm(fx) {
    const s = normalizeEmptyLyricsFxLocal(fx || emptyLyricsFx);
    if ($('elfx-enabled')) $('elfx-enabled').checked = !!s.enabled;
    if ($('elfx-length')) $('elfx-length').value = String(s.length);
    if ($('elfx-lines')) $('elfx-lines').value = String(s.lines);
    if ($('elfx-rate')) $('elfx-rate').value = String(s.rate);
    if ($('elfx-change')) $('elfx-change').value = String(s.change);
    if ($('elfx-charset')) $('elfx-charset').value = s.charset;
    updateEmptyLyricsFxReadouts(s);
}

function updateEmptyLyricsFxReadouts(fx) {
    const s = fx || emptyLyricsFx;
    const lv = $('elfx-length-val');
    const ln = $('elfx-lines-val');
    const rv = $('elfx-rate-val');
    const cv = $('elfx-change-val');
    if (lv) lv.textContent = String(s.length);
    if (ln) ln.textContent = String(s.lines);
    if (rv) rv.textContent = String(s.rate);
    if (cv) cv.textContent = String(Math.round(s.change * 100));
}

function publishEmptyLyricsFxToDisplay() {
    if (!musicViewApi()?.publishEmptyLyricsFx) return;
    musicViewApi().publishEmptyLyricsFx(emptyLyricsFx);
}

function onEmptyLyricsFxFormChange() {
    emptyLyricsFx = readEmptyLyricsFxFromForm();
    updateEmptyLyricsFxReadouts(emptyLyricsFx);
    saveEmptyLyricsFxToStorage();
    publishEmptyLyricsFxToDisplay();
}

function wireEmptyLyricsFxControls() {
    loadEmptyLyricsFxFromStorage();
    writeEmptyLyricsFxToForm(emptyLyricsFx);
    const ids = ['elfx-enabled', 'elfx-charset', 'elfx-length', 'elfx-lines', 'elfx-rate', 'elfx-change'];
    for (const id of ids) {
        const el = $(id);
        if (!el) continue;
        el.addEventListener('input', () => onEmptyLyricsFxFormChange());
        el.addEventListener('change', () => onEmptyLyricsFxFormChange());
    }
    // Push defaults / stored settings as soon as the display can receive them
    publishEmptyLyricsFxToDisplay();
    // Re-send shortly after startup so a late-ready display picks them up
    setTimeout(() => publishEmptyLyricsFxToDisplay(), 600);
    setTimeout(() => publishEmptyLyricsFxToDisplay(), 2000);
}

/**
 * Seek the audio element. Waits for seekable ranges when needed.
 * @param {number} seconds
 */
function seekTo(seconds, deckName) {
    const a = deckName ? deckEl(deckName) : audio();
    if (!a || !a.src) return;
    if (showDriving && !deckName) return;

    const dur = Number.isFinite(a.duration) && a.duration > 0 ? a.duration : null;
    let t = Number(seconds);
    if (!Number.isFinite(t) || t < 0) t = 0;
    if (dur != null) t = Math.min(dur, t);

    const apply = () => {
        try {
            a.currentTime = t;
        } catch (e) {
            console.warn('seek failed', e);
            setStatus('Seek failed', 'error');
            return;
        }
        // Confirm we didn't bounce to 0 unexpectedly
        requestAnimationFrame(() => {
            lastPublishedLyricIdx = null;
            lastPublishedProgress = -1;
            updateUiFromAudio();
            publishLyricFocusToDisplay(true);
            publishPlaybackProgressToDisplay(true);
            if (Math.abs((a.currentTime || 0) - t) > 1 && t > 1) {
                // Retry once after a short delay (decoder may not be ready)
                setTimeout(() => {
                    try { a.currentTime = t; } catch (_) { /* ignore */ }
                    lastPublishedLyricIdx = null;
                    lastPublishedProgress = -1;
                    updateUiFromAudio();
                    publishLyricFocusToDisplay(true);
                    publishPlaybackProgressToDisplay(true);
                }, 50);
            }
        });
    };

    if (a.readyState >= 1 && Number.isFinite(a.duration)) {
        apply();
    } else {
        const onMeta = () => {
            a.removeEventListener('loadedmetadata', onMeta);
            apply();
        };
        a.addEventListener('loadedmetadata', onMeta);
    }
}

function setSpotifyImportStatus(msg, kind) {
    const el = $('spotify-import-status');
    if (!el) return;
    const text = msg || '';
    el.textContent = text;
    el.hidden = !text;
    el.classList.toggle('is-error', kind === 'error');
    el.classList.toggle('is-ok', kind === 'ok');
}

async function probeSpotifyImportTools() {
    if (!musicViewApi()?.probeSpotifyImport) return;
    try {
        const tools = await musicViewApi().probeSpotifyImport();
        if (tools && tools.ok === false && tools.hint) {
            setSpotifyImportStatus(tools.hint, '');
        }
    } catch (_) { /* optional */ }
}

async function importFromSpotify(ev) {
    if (ev) ev.preventDefault();
    const input = $('spotify-url');
    const btn = $('btn-spotify-import');
    const url = (input && input.value || '').trim();
    if (!url) {
        setSpotifyImportStatus('Paste a Spotify track link', 'error');
        if (input) input.focus();
        return;
    }
    if (!musicViewApi()?.importSpotifyTrack) {
        setSpotifyImportStatus('Import API missing', 'error');
        return;
    }
    if (btn) btn.disabled = true;
    if (input) input.disabled = true;
    setSpotifyImportStatus('Looking up track…', '');
    const load = loadUi();
    if (load) load.begin('Importing from Spotify…');
    let result;
    try {
        result = await musicViewApi().importSpotifyTrack(url);
    } catch (e) {
        result = { ok: false, error: String(e && e.message ? e.message : e) };
    } finally {
        if (load) load.end();
        if (btn) btn.disabled = false;
        if (input) input.disabled = false;
    }
    if (!result?.ok) {
        setSpotifyImportStatus(result?.error || 'Import failed', 'error');
        return;
    }
    const bits = [];
    if (result.skippedAudio) bits.push('already on disk');
    if (result.lyrics?.wrote && result.lyrics.synced) bits.push('synced lyrics');
    else if (result.lyrics?.wrote) bits.push('unsynced lyrics');
    else if (result.lyrics?.found) bits.push('lyrics already present');
    else bits.push('no lyrics found');
    const title = result.meta?.title || result.song?.title || 'Track';
    setSpotifyImportStatus(`Imported ${title} (${bits.join(', ')})`, 'ok');
    if (input) input.value = '';
    await refreshLibrary();
    if (result.song?.id && !showDriving) {
        await selectSong(result.song.id);
    }
}

function wireEvents() {
    $('music-btn-refresh').addEventListener('click', () => refreshLibrary());
    $('song-filter').addEventListener('input', () => applyFilter());
    const songList = $('song-list');
    if (songList) {
        songList.addEventListener('wheel', (e) => {
            if (songList.scrollHeight <= songList.clientHeight + 1) return;
            e.stopPropagation();
        }, { capture: true });
    }
    const spotifyForm = $('spotify-import');
    if (spotifyForm) {
        spotifyForm.addEventListener('submit', (e) => { importFromSpotify(e); });
    }
    if (musicViewApi()?.onSpotifyImportProgress) {
        musicViewApi().onSpotifyImportProgress((payload) => {
            if (payload && payload.message) setSpotifyImportStatus(payload.message, '');
        });
    }
    $('music-btn-play').addEventListener('click', () => {
        if (showDriving) emitMusicEvent('showAction', { action: 'togglePlay' });
        else togglePlay();
    });
    $('music-btn-stop').addEventListener('click', () => {
        if (showDriving) emitMusicEvent('showAction', { action: 'stop' });
        else stopPlayback();
    });
    const takeover = $('btn-takeover');
    if (takeover) {
        takeover.addEventListener('click', () => takeOver());
    }

    const seek = $('seek');
    // Drag scrub: hold seeking=true so the tick loop doesn't fight the slider
    seek.addEventListener('pointerdown', (e) => {
        seeking = true;
        try { seek.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    });
    seek.addEventListener('pointerup', (e) => {
        if (!seeking) return;
        seeking = false;
        try { seek.releasePointerCapture(e.pointerId); } catch (_) { /* ignore */ }
        seekTo(Number(seek.value));
    });
    seek.addEventListener('pointercancel', () => {
        seeking = false;
    });
    // Keyboard / accessibility change
    seek.addEventListener('change', () => {
        if (seeking) return; // pointerup already committed
        seekTo(Number(seek.value));
    });
    seek.addEventListener('input', () => {
        const t = Number(seek.value);
        if (Number.isFinite(t)) {
            $('time-cur').textContent = formatTime(t);
        }
    });

    $('volume').addEventListener('input', () => {
        setMixGain(Number($('volume').value));
        if (!deckMixer) audio().volume = Number($('volume').value);
    });

    const a = audio();
    a.addEventListener('loadedmetadata', () => {
        const seekEl = $('seek');
        if (Number.isFinite(a.duration) && a.duration > 0) {
            seekEl.max = String(a.duration);
            seekEl.disabled = false;
        }
        updateUiFromAudio();
        setStatus('Ready · ' + formatTime(a.duration));
    });
    a.addEventListener('durationchange', () => {
        if (Number.isFinite(a.duration) && a.duration > 0) {
            $('seek').max = String(a.duration);
            $('seek').disabled = false;
        }
    });
    a.addEventListener('seeked', () => {
        if (audioAnalyser) audioAnalyser.resetDetectors();
        updateUiFromAudio();
        publishAudioAnalysisFrame(true);
    });
    const onEnded = (el, which) => {
        if (el !== audio() && showDriving) {
            emitMusicEvent('ended', { deck: which });
            return;
        }
        setStatus('Ended');
        $('music-btn-play').textContent = '▶';
        $('music-btn-play').title = 'Play';
        decayTicksLeft = DECAY_TICKS;
        updateUiFromAudio();
        startTick();
        emitMusicEvent('ended', { deck: which });
        flushClipArmIfPast();
    };
    a.addEventListener('ended', () => onEnded(a, 'A'));
    a.addEventListener('play', () => {
        ensureAudioAnalysisOnPlay();
        startTick();
    });
    a.addEventListener('pause', () => {
        decayTicksLeft = DECAY_TICKS;
        updateUiFromAudio();
        startTick();
    });
    a.addEventListener('error', () => {
        const err = a.error;
        setStatus(err ? `Audio error ${err.code}` : 'Audio error', 'error');
    });
    const b = deckEl('B');
    if (b && b !== a) {
        b.addEventListener('ended', () => onEnded(b, 'B'));
        b.addEventListener('error', () => {
            const err = b.error;
            if (leadDeck === 'B') setStatus(err ? `Audio error ${err.code}` : 'Audio error', 'error');
        });
        b.addEventListener('loadedmetadata', () => {
            emitMusicEvent('deckReady', { deck: 'B', duration: b.duration });
        });
    }

    if (!root.document.getElementById('dock-music')) {
        document.addEventListener('keydown', (e) => {
            if (e.code === 'Space' && e.target === document.body) {
                e.preventDefault();
                if (showDriving) {
                    emitMusicEvent('showAction', { action: 'togglePlay' });
                    return;
                }
                togglePlay();
            }
        });
    }
}

// ── Tabs ──────────────────────────────────────────────────────────────

function setActiveTab(tabId) {
    const id = ['lib', 'lyrics', 'analysis', 'fx'].includes(tabId) ? tabId : 'lib';
    activeTab = id;
    qsAll('.tab').forEach((btn) => {
        const on = btn.dataset.tab === id;
        btn.classList.toggle('active', on);
        btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    qsAll('.tab-panel').forEach((panel) => {
        const on = panel.id === `panel-${id}`;
        panel.classList.toggle('active', on);
        if (on) panel.removeAttribute('hidden');
        else panel.setAttribute('hidden', '');
    });
    try {
        localStorage.setItem(TAB_STORAGE_KEY, id);
    } catch (e) { /* ignore */ }

    // Refresh analysis canvases when opening the tab
    if (id === 'analysis' && lastVizFrame) {
        updateVizMeters(lastVizFrame);
    }
}

function wireTabs() {
    try {
        const saved = localStorage.getItem(TAB_STORAGE_KEY);
        if (saved) activeTab = saved;
    } catch (e) { /* ignore */ }
    qsAll('.tab').forEach((btn) => {
        btn.addEventListener('click', () => setActiveTab(btn.dataset.tab));
    });
    setActiveTab(activeTab);
}

// ── Audio viz settings ────────────────────────────────────────────────

function loadVizSettings() {
    try {
        const raw = localStorage.getItem(VIZ_STORAGE_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
            vizSettings = normalizeVizSettings(parsed);
        }
    } catch (e) { /* ignore */ }
}

function saveVizSettings() {
    try {
        const out = Object.assign({}, vizSettings, { _beatV: 2 });
        localStorage.setItem(VIZ_STORAGE_KEY, JSON.stringify(out));
    } catch (e) { /* ignore */ }
}

function normalizeChannelId(id, fallback) {
    const ids = (window.AudioAnalysis && window.AudioAnalysis.CHANNEL_IDS)
        || ['full', 'bass', 'mid', 'envelope', 'beat', 'onset'];
    const s = String(id || '');
    return ids.indexOf(s) >= 0 ? s : fallback;
}

function normalizeVizSettings(o) {
    const sens = Number(o.sensitivity);
    const gain = Number(o.inputGain);
    const ref = Number(o.refractoryMs);
    const pulse = Number(o.pulseDecayMs);
    const smooth = Number(o.smoothing);
    const rate = Number(o.sendRateHz);
    // Migrate older saved prefs that made onsets hard to catch
    let sensitivity = Number.isFinite(sens) ? Math.max(0.5, Math.min(2.5, sens)) : 1.45;
    let refractoryMs = Number.isFinite(ref) ? Math.max(60, Math.min(500, ref)) : 150;
    let pulseDecayMs = Number.isFinite(pulse) ? Math.max(40, Math.min(500, pulse)) : 130;
    let smoothing = Number.isFinite(smooth) ? Math.max(0, Math.min(0.9, smooth)) : 0.2;
    // One-time soft migration: previous defaults were 1.25 / 200 / 0.5
    if (o._beatV < 2) {
        if (!Number.isFinite(sens) || Math.abs(sens - 1.25) < 0.02) sensitivity = 1.45;
        if (!Number.isFinite(ref) || Math.abs(ref - 200) < 1) refractoryMs = 150;
        if (!Number.isFinite(smooth) || Math.abs(smooth - 0.5) < 0.02) smoothing = 0.2;
        if (!Number.isFinite(pulse) || Math.abs(pulse - 180) < 1) pulseDecayMs = 130;
    }
    return {
        enabled: o.enabled !== false,
        localPreview: o.localPreview !== false,
        sensitivity,
        inputGain: Number.isFinite(gain) ? Math.max(0.4, Math.min(2.5, gain)) : 1.0,
        refractoryMs,
        pulseDecayMs,
        smoothing,
        sendRateHz: Number.isFinite(rate) ? Math.max(15, Math.min(60, Math.round(rate))) : 50,
        _beatV: 2,
    };
}

function writeVizSettingsToForm() {
    const s = vizSettings;
    if ($('viz-enabled')) $('viz-enabled').checked = !!s.enabled;
    if ($('viz-local-preview')) $('viz-local-preview').checked = !!s.localPreview;
    if ($('viz-sensitivity')) $('viz-sensitivity').value = String(s.sensitivity);
    if ($('viz-gain')) $('viz-gain').value = String(s.inputGain);
    if ($('viz-refractory')) {
        $('viz-refractory').min = '60';
        $('viz-refractory').value = String(s.refractoryMs);
    }
    if ($('viz-pulse')) $('viz-pulse').value = String(s.pulseDecayMs);
    if ($('viz-smoothing')) $('viz-smoothing').value = String(s.smoothing);
    if ($('viz-rate')) $('viz-rate').value = String(s.sendRateHz);
    updateVizReadouts();
}

function updateVizReadouts() {
    const set = (id, text) => {
        const el = $(id);
        if (el) el.textContent = text;
    };
    set('viz-sens-val', vizSettings.sensitivity.toFixed(2));
    set('viz-gain-val', vizSettings.inputGain.toFixed(2));
    set('viz-ref-val', `${Math.round(vizSettings.refractoryMs)}ms`);
    set('viz-pulse-val', `${Math.round(vizSettings.pulseDecayMs)}ms`);
    set('viz-smooth-val', vizSettings.smoothing.toFixed(2));
    set('viz-rate-val', `${Math.round(vizSettings.sendRateHz)} Hz`);
}

function applyVizSettingsFromForm() {
    vizSettings = normalizeVizSettings({
        enabled: !!$('viz-enabled')?.checked,
        localPreview: !!$('viz-local-preview')?.checked,
        sensitivity: Number($('viz-sensitivity')?.value),
        inputGain: Number($('viz-gain')?.value),
        refractoryMs: Number($('viz-refractory')?.value),
        pulseDecayMs: Number($('viz-pulse')?.value),
        smoothing: Number($('viz-smoothing')?.value),
        sendRateHz: Number($('viz-rate')?.value),
    });
    updateVizReadouts();
    saveVizSettings();
    ensureAudioAnalyser();
    applyAllAnalyserConfig();

    if (!vizSettings.enabled) {
        if (musicViewApi()?.publishAudioFrame) {
            const n = window.AudioAnalysis?.WAVE_BINS || 256;
            const silent = new Uint8Array(n);
            silent.fill(128);
            musicViewApi().publishAudioFrame({
                t: audio().currentTime || 0,
                playing: false,
                rms: 0,
                bass: 0,
                mid: 0,
                envelope: 0,
                beat: 0,
                flux: 0,
                peak: 0,
                waveform: silent,
                disabled: true,
            });
        }
        if (!vizSettings.localPreview) {
            updateVizMeters(null);
            setVizStatus('Off');
        } else {
            setVizStatus('Local');
        }
    }
}

function wireVizControls() {
    loadVizSettings();
    buildMeterGrid();
    writeVizSettingsToForm();
    const ids = [
        'viz-enabled', 'viz-local-preview',
        'viz-sensitivity', 'viz-gain', 'viz-refractory',
        'viz-pulse', 'viz-smoothing', 'viz-rate',
    ];
    for (const id of ids) {
        const el = $(id);
        if (!el) continue;
        el.addEventListener('input', () => applyVizSettingsFromForm());
        el.addEventListener('change', () => applyVizSettingsFromForm());
    }
    const resetBtn = $('viz-reset');
    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            if (audioAnalyser) audioAnalyser.resetDetectors();
            lastVizFrame = null;
            updateVizMeters(null);
            setVizStatus(vizSettings.enabled ? 'Reset' : 'Off');
        });
    }
    setVizStatus(vizSettings.enabled ? 'Idle' : 'Off');

    window.addEventListener('resize', () => {
        if (activeTab === 'analysis' && lastVizFrame && vizSettings.localPreview) {
            drawVizScope(lastVizFrame);
            drawVizSpectrum(lastVizFrame);
        }
    });
}

function setDrivingUi(on, name) {
    showDriving = !!on;
    if (on) resumeAudioGraph();
    const bar = $('show-driving-bar');
    if (bar) bar.classList.toggle('hidden', !showDriving);
    if ($('music-btn-play')) $('music-btn-play').disabled = !!showDriving && !$('music-btn-play').disabled ? false : $('music-btn-play').disabled;
    if (showDriving) {
        if ($('music-btn-play')) $('music-btn-play').disabled = true;
        if ($('music-btn-stop')) $('music-btn-stop').disabled = true;
        if ($('seek')) $('seek').disabled = true;
        setStatus(name ? `Driven · ${name}` : 'Performance driving');
    } else {
        if ($('music-btn-play')) $('music-btn-play').disabled = !audio().src;
        if ($('music-btn-stop')) $('music-btn-stop').disabled = !audio().src;
        if ($('seek') && Number.isFinite(audio().duration)) $('seek').disabled = false;
    }
}

function takeOver() {
    setDrivingUi(false);
    emitMusicEvent('userTakeover', {});
}

function resolveRelPathOnMusic(relPath) {
    const song = songs.find((s) => s.name === relPath || s.id === relPath);
    if (song && song.fileUrl) return { ok: true, song, fileUrl: song.fileUrl };
    return { ok: false, error: 'Song not in library: ' + relPath };
}

/** @type {Map<string, { ok: boolean, song?: object, fileUrl?: string, display?: object, lyrics?: { lines: any[], meta: object }, error?: string }>} */
const showAssetCache = new Map();
/** @type {{ A: string|null, B: string|null }} */
const deckRel = { A: null, B: null };

function waitElEvent(el, name, timeoutMs) {
    return new Promise((resolve) => {
        if (!el) {
            resolve(false);
            return;
        }
        let done = false;
        const finish = (ok) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            el.removeEventListener(name, onOk);
            el.removeEventListener('error', onErr);
            resolve(ok);
        };
        const onOk = () => finish(true);
        const onErr = () => finish(false);
        const timer = setTimeout(() => finish(false), Math.max(50, timeoutMs || 8000));
        el.addEventListener(name, onOk);
        el.addEventListener('error', onErr);
    });
}

function bufferCovers(el, time, aheadSec) {
    if (!el || !el.buffered || el.buffered.length === 0) return false;
    const t = Math.max(0, Number(time) || 0);
    const need = t + (Number.isFinite(aheadSec) ? aheadSec : 3);
    const cap = Number.isFinite(el.duration) ? el.duration : need;
    const target = Math.min(need, cap);
    for (let i = 0; i < el.buffered.length; i++) {
        if (el.buffered.start(i) <= t + 0.25 && el.buffered.end(i) >= target - 0.05) return true;
    }
    return false;
}

async function seekElement(el, seconds) {
    if (!el || !el.src) return false;
    const dur = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : null;
    let t = Number(seconds);
    if (!Number.isFinite(t) || t < 0) t = 0;
    if (dur != null) t = Math.min(dur, t);
    if (el.readyState < 1) {
        await waitElEvent(el, 'loadedmetadata', 8000);
    }
    if (Math.abs((el.currentTime || 0) - t) < 0.05) return true;
    try {
        el.currentTime = t;
    } catch (e) {
        console.warn('seek failed', e);
        return false;
    }
    await waitElEvent(el, 'seeked', 4000);
    if (Math.abs((el.currentTime || 0) - t) > 1 && t > 1) {
        try { el.currentTime = t; } catch (_) { /* ignore */ }
        await waitElEvent(el, 'seeked', 2000);
    }
    return true;
}

async function waitUntilPlayable(el, time, timeoutMs) {
    const budget = timeoutMs || 15000;
    const start = Date.now();
    if (el.readyState < 1) {
        const ok = await waitElEvent(el, 'loadedmetadata', budget);
        if (!ok && el.readyState < 1) return false;
    }
    await seekElement(el, time);
    while (Date.now() - start < budget) {
        if (el.readyState >= 4 || el.readyState >= 3 || bufferCovers(el, time, 3)) return true;
        const left = budget - (Date.now() - start);
        await Promise.race([
            waitElEvent(el, 'canplaythrough', Math.min(left, 2000)),
            waitElEvent(el, 'progress', 400),
        ]);
    }
    return el.readyState >= 2;
}

async function cacheShowAssets(relPath) {
    if (showAssetCache.has(relPath)) return showAssetCache.get(relPath);
    const found = resolveRelPathOnMusic(relPath);
    if (!found.ok) {
        showAssetCache.set(relPath, found);
        return found;
    }
    let display = null;
    let lyrics = { lines: [], meta: {} };
    try {
        if (musicViewApi()?.getSongDisplayInfo && found.song.path) {
            display = await musicViewApi().getSongDisplayInfo(found.song.path);
        }
    } catch (e) {
        console.warn('display info failed', relPath, e);
    }
    try {
        if (found.song.hasLyrics && found.song.lyricsPath && musicViewApi()?.loadLyrics) {
            const res = await musicViewApi().loadLyrics(found.song.lyricsPath);
            if (res?.ok) lyrics = { lines: res.lines || [], meta: res.meta || {} };
        }
    } catch (e) {
        console.warn('lyrics failed', relPath, e);
    }
    const entry = { ok: true, song: found.song, fileUrl: found.fileUrl, display, lyrics };
    showAssetCache.set(relPath, entry);
    return entry;
}

function applyCachedNowPlaying(relPath) {
    const entry = showAssetCache.get(relPath);
    const song = entry?.song || resolveRelPathOnMusic(relPath).song;
    if (!song) return;
    selectedId = song.id;
    renderSongList();
    if ($('now-title')) $('now-title').textContent = (entry?.display && entry.display.title) || song.title;
    if ($('now-meta')) $('now-meta').textContent = (entry?.display && entry.display.artist) || song.name;
    const coverUrl = entry?.display && entry.display.coverDataUrl;
    if (coverUrl) showCoverArt(coverUrl, song.title);
    else clearCoverArt();

    if (entry?.lyrics) {
        lyricsLines = entry.lyrics.lines || [];
        lyricsMeta = entry.lyrics.meta || {};
    } else {
        lyricsLines = [];
        lyricsMeta = {};
    }
    lastPublishedLyricIdx = null;
    lastPublishedProgress = -1;

    if (musicViewApi()?.publishNowPlaying) {
        const info = entry?.display && entry.display.ok
            ? Object.assign({}, entry.display, { hasLyrics: !!(entry.display.hasLyrics || lyricsLines.length) })
            : {
                title: song.title,
                artist: song.artist || '',
                album: song.album || '',
                name: song.name,
                hasLyrics: !!song.hasLyrics,
                coverDataUrl: null,
                lyricLines: [],
            };
        if (lyricsLines.length && (!info.lyricLines || !info.lyricLines.length)) {
            info.lyricLines = lyricsLines.map((row) => String(row.text || row || '').trim());
            info.hasLyrics = true;
        }
        musicViewApi().publishNowPlaying(info);
    }
    publishLyricFocusToDisplay(true);
    publishPlaybackProgressToDisplay(true);
}

async function loadDeck(which, relPath, opts) {
    const options = opts || {};
    const found = resolveRelPathOnMusic(relPath);
    if (!found.ok) return found;
    const el = deckEl(which);
    if (!el) return { ok: false, error: 'Unknown deck' };
    await cacheShowAssets(relPath);
    el.volume = 1;
    el.preload = 'auto';
    const already = deckRel[which] === relPath && el.src;
    if (!already) {
        el.src = found.fileUrl;
        el.load();
        deckRel[which] = relPath;
    }
    const at = options.time != null ? Number(options.time) : 0;
    const ready = await waitUntilPlayable(el, at, options.timeoutMs || 15000);
    if (!ready) {
        emitMusicEvent('preloadMiss', { relPath, deck: which });
        return { ok: false, error: 'Audio not buffered: ' + relPath };
    }
    if (options.publish || which === leadDeck) {
        applyCachedNowPlaying(relPath);
    }
    emitMusicEvent('deckReady', { deck: which, duration: el.duration || 0, relPath });
    return { ok: true, duration: el.duration || 0, fileUrl: found.fileUrl, cached: already };
}

function setLeadDeck(which, { publish } = {}) {
    if (which !== 'A' && which !== 'B') return { ok: false, error: 'Bad deck' };
    leadDeck = which;
    const mes = deckMixer && (which === 'B' ? deckMixer.mesB : deckMixer.mesA);
    if (audioAnalyser && typeof audioAnalyser.retarget === 'function' && mes) {
        audioAnalyser.retarget(mes);
        audioAnalyser.resetDetectors();
    }
    if (publish !== false) {
        const rel = deckRel[which];
        if (rel) applyCachedNowPlaying(rel);
        else {
            const song = songs.find((s) => s.id === selectedId);
            if (song) applyCachedNowPlaying(song.name || song.id);
        }
    }
    return { ok: true, lead: leadDeck };
}

function publishNowPlayingForSong(song) {
    if (!song) return;
    cacheShowAssets(song.name || song.id).then(() => {
        applyCachedNowPlaying(song.name || song.id);
    }).catch(() => { /* ignore */ });
}

function resumeAudioGraph() {
    ensureDeckMixer();
    try {
        if (deckMixer?.ctx && deckMixer.ctx.state === 'suspended') {
            deckMixer.ctx.resume();
        }
    } catch (_) { /* ignore */ }
    if (audioAnalyser && typeof audioAnalyser.resume === 'function') {
        audioAnalyser.resume().catch(() => { /* autoplay */ });
    }
}

function pauseAudioFadeClock() {
    if (audioFade) audioFade.paused = true;
}

function resumeAudioFadeClock() {
    if (!audioFade) return;
    audioFade.paused = false;
    audioFade.last = performance.now();
}

function resumeShowDecks() {
    resumeAudioGraph();
    const play = (which) => {
        const el = deckEl(which);
        if (el && el.src) el.play().catch((e) => console.warn('[deck] resume', e));
    };
    if (audioFade) {
        resumeAudioFadeClock();
        play(audioFade.incoming);
        if (audioFade.outgoing) play(audioFade.outgoing);
    } else {
        play(leadDeck);
    }
    startTick();
    return { ok: true };
}

function startAudioFade(payload) {
    const incoming = payload.incomingDeck === 'B' ? 'B' : 'A';
    const outgoing = payload.outgoingDeck === 'A' || payload.outgoingDeck === 'B' ? payload.outgoingDeck : null;
    const type = payload.type || 'cut';
    const duration = Math.max(0, Number(payload.duration) || 0);
    const ease = easingFn(payload.easing);
    const volIn = Number.isFinite(payload.volIn) ? payload.volIn : 1;
    const volOut = Number.isFinite(payload.volOut) ? payload.volOut : 1;
    const transitionId = 'aud_' + Date.now();

    const inEl = deckEl(incoming);
    resumeAudioGraph();
    setLeadDeck(incoming, { publish: false });
    if (payload.publishNow !== false && payload.songRelPath) {
        applyCachedNowPlaying(payload.songRelPath);
    }

    const finish = () => {
        audioFade = null;
        if (outgoing && outgoing !== incoming) {
            const outEl = deckEl(outgoing);
            try { outEl.pause(); } catch (_) { /* ignore */ }
            setDeckGain(outgoing, 0);
        }
        setDeckGain(incoming, volIn);
        emitMusicEvent('transitionDone', { transitionId });
    };

    if (type === 'cut' || duration <= 0) {
        setDeckGain(incoming, volIn);
        if (outgoing && outgoing !== incoming) setDeckGain(outgoing, 0);
        inEl.play().catch((e) => console.warn('[deck] play', e));
        startTick();
        finish();
        return { ok: true, transitionId };
    }

    setDeckGain(incoming, 0);
    inEl.play().catch((e) => console.warn('[deck] play', e));
    if (outgoing && outgoing !== incoming) {
        const outEl = deckEl(outgoing);
        if (outEl && outEl.paused && outEl.src) outEl.play().catch(() => { /* tail may already be playing */ });
    }
    startTick();
    const t0 = performance.now();
    audioFade = {
        id: transitionId, type, incoming, outgoing, paused: false, hold: 0, last: t0,
    };
    const step = (now) => {
        if (!audioFade || audioFade.id !== transitionId) return;
        if (audioFade.paused) {
            audioFade.hold += now - (audioFade.last || now);
            audioFade.last = now;
            requestAnimationFrame(step);
            return;
        }
        audioFade.last = now;
        const u = Math.min(1, (now - t0 - (audioFade.hold || 0)) / (duration * 1000));
        const e = ease(u);
        if (type === 'dip-to-silence') {
            if (u < 0.5) {
                if (outgoing) setDeckGain(outgoing, volOut * (1 - u / 0.5));
                setDeckGain(incoming, 0);
            } else {
                if (outgoing) setDeckGain(outgoing, 0);
                setDeckGain(incoming, volIn * ((u - 0.5) / 0.5));
            }
        } else {
            if (outgoing) setDeckGain(outgoing, volOut * (1 - e));
            setDeckGain(incoming, volIn * e);
        }
        if (u >= 1) {
            finish();
            return;
        }
        requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
    return { ok: true, transitionId };
}

function armClipBounds(payload) {
    const deck = payload.deck === 'B' ? 'B' : 'A';
    clipArm = {
        deck,
        in: Number(payload.in) || 0,
        out: Number(payload.out),
        holdAfter: Math.max(0, Number(payload.holdAfter) || 0),
        audioOffset: Number(payload.audioOffset) || 0,
        emitAudioLead: payload.emitAudioLead !== false,
        lookCues: Array.isArray(payload.lookCues) ? payload.lookCues.slice() : [],
        loopOn: false,
    };
    clipArmFired = { out: false, holdEnd: false, audioLead: false, looks: new Set() };
    return { ok: true };
}

function flushClipArmIfPast() {
    if (!clipArm || !clipArmFired) return;
    const el = deckEl(clipArm.deck);
    const t = el ? (el.currentTime || 0) : clipArm.out;
    maybeFireArm(t, true);
}

function maybeFireArm(t, ended) {
    if (!clipArm || !clipArmFired) return;
    const tArrive = clipArm.out + (clipArm.holdAfter > 0 ? clipArm.holdAfter : 0);
    const audioLeadAt = tArrive + clipArm.audioOffset;
    if (!clipArmFired.out && (t >= clipArm.out || ended)) {
        clipArmFired.out = true;
        emitMusicEvent('clipBoundary', { which: 'out', t: clipArm.out, deck: clipArm.deck });
    }
    if (clipArm.holdAfter > 0 && !clipArmFired.holdEnd && (t >= clipArm.out + clipArm.holdAfter || ended)) {
        clipArmFired.holdEnd = true;
        emitMusicEvent('clipBoundary', { which: 'holdEnd', t: clipArm.out + clipArm.holdAfter, deck: clipArm.deck });
    }
    if (
        clipArm.emitAudioLead
        && !clipArmFired.audioLead
        && (t >= audioLeadAt || (ended && audioLeadAt <= (clipArm.out + clipArm.holdAfter)))
    ) {
        clipArmFired.audioLead = true;
        emitMusicEvent('clipBoundary', { which: 'audioLead', t: audioLeadAt, deck: clipArm.deck });
    }
    for (const lc of clipArm.lookCues) {
        if (!lc || clipArmFired.looks.has(lc.id)) continue;
        // Arrival look (offset 0) is applied by the conductor, not this clock
        if (Number(lc.offset) <= 0) {
            clipArmFired.looks.add(lc.id);
            continue;
        }
        if (t >= clipArm.in + Number(lc.offset) || ended) {
            clipArmFired.looks.add(lc.id);
            emitMusicEvent('lookCue', { id: lc.id, offset: lc.offset, t: clipArm.in + Number(lc.offset) });
        }
    }
}

function tickClipArm() {
    if (!clipArm || showDriving === false && statusClockIdle()) return;
    const el = deckEl(clipArm.deck);
    if (!el) return;
    if (clipArm.loopOn && Number.isFinite(clipArm.out) && el.currentTime >= clipArm.out) {
        try { el.currentTime = clipArm.in; } catch (_) { /* ignore */ }
        return;
    }
    maybeFireArm(el.currentTime || 0, false);
}

function statusClockIdle() {
    return !clipArm;
}

const _origStartTick = typeof startTick === 'function' ? startTick : null;

async function prepareShow(payload) {
    const clips = Array.isArray(payload?.clips) ? payload.clips : [];
    if (!clips.length) return { ok: false, error: 'No clips to prepare' };
    ensureDeckMixer();
    resumeAudioGraph();
    const unique = [];
    const seen = new Set();
    for (const c of clips) {
        const rel = c && c.relPath;
        if (!rel || seen.has(rel)) continue;
        seen.add(rel);
        unique.push(rel);
    }
    const misses = [];
    await Promise.all(unique.map(async (rel) => {
        const entry = await cacheShowAssets(rel);
        if (!entry || !entry.ok) misses.push(rel + ': ' + (entry && entry.error ? entry.error : 'missing'));
    }));
    if (misses.length) return { ok: false, error: misses.join('; ') };

    const first = clips[0];
    const second = clips[1] || null;
    const a = await loadDeck('A', first.relPath, {
        time: first.in,
        publish: true,
        timeoutMs: 20000,
    });
    if (!a.ok) return a;
    leadDeck = 'A';
    applyCachedNowPlaying(first.relPath);
    setDeckGain('A', 0);
    setDeckGain('B', 0);
    deckEl('A')?.pause();

    let secondOk = true;
    if (second && second.relPath !== first.relPath) {
        const b = await loadDeck('B', second.relPath, {
            time: second.in,
            publish: false,
            timeoutMs: 20000,
        });
        if (!b.ok) secondOk = false;
        deckEl('B')?.pause();
    } else if (second && second.relPath === first.relPath) {
        // Same file twice: second deck can share after first clip; no second src
        secondOk = true;
    }
    return {
        ok: true,
        warmed: second && second.relPath !== first.relPath ? ['A', 'B'] : ['A'],
        nextReady: secondOk,
        assets: unique.length,
    };
}

function handleMusicCommand(command, payload) {
    const p = payload || {};
    switch (command) {
        case 'getTransportState': {
            const a = deckEl('A');
            const b = deckEl('B');
            return {
                ok: true,
                lead: leadDeck,
                playing: !audio().paused,
                showDriving,
                decks: {
                    A: { t: a ? a.currentTime : 0, dur: a ? a.duration : 0, src: !!(a && a.src) },
                    B: { t: b ? b.currentTime : 0, dur: b ? b.duration : 0, src: !!(b && b.src) },
                },
            };
        }
        case 'setShowDriving':
            setDrivingUi(!!p.on, p.performanceName);
            return { ok: true };
        case 'loadDeck':
            return loadDeck(p.deck, p.relPath, { time: p.time, publish: p.publish });
        case 'seekDeck': {
            const el = p.deck ? deckEl(p.deck) : audio();
            return seekElement(el, p.time).then((ok) => ({ ok }));
        }
        case 'prepareShow':
            return prepareShow(p);
        case 'playDeck': {
            const el = p.deck ? deckEl(p.deck) : audio();
            resumeAudioGraph();
            return el.play().then(() => ({ ok: true })).catch((e) => ({ ok: false, error: String(e) }));
        }
        case 'resumeShow':
            return resumeShowDecks();
        case 'pauseDeck': {
            const el = p.deck ? deckEl(p.deck) : audio();
            el.pause();
            return { ok: true };
        }
        case 'pauseAll':
            pauseAudioFadeClock();
            deckEl('A')?.pause();
            deckEl('B')?.pause();
            return { ok: true };
        case 'setDeckGain':
            setDeckGain(p.deck, p.gain);
            return { ok: true };
        case 'startAudioTransition':
            return startAudioFade(p);
        case 'cancelAudioTransition':
            audioFade = null;
            if (p.snap === 'outgoing') {
                setDeckGain(leadDeck === 'A' ? 'B' : 'A', 0);
            } else {
                setDeckGain(leadDeck, 1);
                const other = leadDeck === 'A' ? 'B' : 'A';
                setDeckGain(other, 0);
                try { deckEl(other).pause(); } catch (_) { /* ignore */ }
            }
            return { ok: true };
        case 'preloadDeck': {
            return loadDeck(p.deck, p.relPath, { time: p.time, publish: false }).then((res) => {
                deckEl(p.deck)?.pause();
                if (!res.ok) emitMusicEvent('preloadMiss', { relPath: p.relPath, deck: p.deck });
                return res;
            });
        }
        case 'setClipBounds':
            return armClipBounds(p);
        case 'setClipLoop':
            if (clipArm && (!p.deck || p.deck === clipArm.deck)) {
                clipArm.loopOn = !!p.on;
                if (Number.isFinite(p.in)) clipArm.in = p.in;
                if (Number.isFinite(p.out)) clipArm.out = p.out;
            }
            return { ok: true };
        case 'setLead':
            return setLeadDeck(p.deck, { publish: true });
        case 'publishCachedNowPlaying':
            if (!p.relPath) return { ok: false, error: 'relPath required' };
            applyCachedNowPlaying(p.relPath);
            return { ok: true };
        default:
            return { ok: false, error: 'Unknown music command: ' + command };
    }
}

function wireMusicCommands() {
    root.__musicViewHandleMusicCommand = handleMusicCommand;
    if (!musicViewApi()?.onMusicCommand) return;
    musicViewApi().onMusicCommand(async (msg) => {
        const requestId = msg && msg.requestId;
        let result;
        try {
            result = await handleMusicCommand(msg.command, msg.payload);
        } catch (e) {
            result = { ok: false, error: String(e && e.message ? e.message : e) };
        }
        if (requestId && musicViewApi().replyMusicCommand) {
            musicViewApi().replyMusicCommand(requestId, result || { ok: false, error: 'empty' });
        }
    });
    if (musicViewApi().notifyMusicReady) musicViewApi().notifyMusicReady();
}

async function init() {
    const load = loadUi();
    try {
        if (load) load.set(40, 'Starting music…');
        wireTabs();
        wireEvents();
        wireEmptyLyricsFxControls();
        wireVizControls();
        ensureDeckMixer();
        setMixGain(Number($('volume').value));
        document.addEventListener('pointerdown', () => resumeAudioGraph(), { once: true });
        wireMusicCommands();
        if (load) load.set(52, 'Scanning library…');
        await refreshLibrary();
        if (load) load.set(60, 'Loading cover art…');
        await preloadCovers();
        probeSpotifyImportTools();
        // Clip-arm clock rides the existing tick via a patched progress publisher
        window.__musicViewTickClipArm = tickClipArm;
    } catch (e) {
        console.warn('Music init failed', e);
        if (root.document.getElementById('dock-music') && musicViewApi() && musicViewApi().notifyMusicClosed) {
            musicViewApi().notifyMusicClosed();
        }
    } finally {
        if (load && typeof load.mark === 'function') load.mark('music');
    }
}

document.addEventListener('DOMContentLoaded', init);
root.__musicViewHandleMusicCommand = handleMusicCommand;
root.MusicViewMusic = {
    handleMusicCommand,
    setActiveTab,
    togglePlay,
    isShowDriving: () => !!showDriving,
};
})(window);
