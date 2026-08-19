/**
 * Performance document storage — JSON files under ./performances/
 * Main process only (Node fs).
 */

const fs = require('fs');
const path = require('path');
const { sanitizePresetName } = require('./presets');
const { normalizePerformance } = require('../shared/layout-space');

const PERFORMANCE_VERSION = 1;

const AUDIO_TYPES = new Set(['cut', 'crossfade', 'dip-to-silence']);
const VISUAL_TYPES = new Set(['auto', 'morph', 'crossfade', 'cut', 'dip']);
const EASINGS = new Set(['linear', 'ease-in-out']);
const LOOK_MODES = new Set(['snapshot', 'inherit']);

function performancesDir() {
  return path.join(__dirname, '..', '..', 'performances');
}

function ensurePerformancesDir() {
  const dir = performancesDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function sanitizePerformanceName(name) {
  return sanitizePresetName(name);
}

function performancePath(name) {
  const safe = sanitizePerformanceName(name);
  if (!safe) return null;
  return path.join(performancesDir(), `${safe}.json`);
}

function isSafeRelPath(relPath) {
  if (!relPath || typeof relPath !== 'string') return false;
  const s = relPath.trim();
  if (!s) return false;
  if (s.includes('..')) return false;
  if (path.isAbsolute(s)) return false;
  if (s.includes('/') || s.includes('\\')) return false;
  return true;
}

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function defaultAudioTransition() {
  return { type: 'cut', duration: 0, easing: 'linear', offset: 0 };
}

function defaultVisualTransition() {
  return {
    type: 'auto',
    duration: 1.2,
    easing: 'ease-in-out',
    offset: 0,
    morphThreshold: 0.65,
  };
}

function normalizeAudioTransition(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const type = AUDIO_TYPES.has(src.type) ? src.type : 'cut';
  return {
    type,
    duration: clamp(num(src.duration, type === 'cut' ? 0 : 1.5), 0, 60),
    easing: EASINGS.has(src.easing) ? src.easing : 'linear',
    offset: clamp(num(src.offset, 0), -30, 30),
  };
}

function normalizeVisualTransition(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  return {
    type: VISUAL_TYPES.has(src.type) ? src.type : 'auto',
    duration: clamp(num(src.duration, 1.2), 0, 60),
    easing: EASINGS.has(src.easing) ? src.easing : 'ease-in-out',
    offset: clamp(num(src.offset, 0), -30, 30),
    morphThreshold: clamp(num(src.morphThreshold, 0.65), 0, 1),
    dipColor: typeof src.dipColor === 'string' && src.dipColor.trim()
      ? src.dipColor.trim()
      : '#000000',
  };
}

function normalizeShowFxLayer(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const shaderId = typeof raw.shaderId === 'string' && raw.shaderId.trim()
    ? raw.shaderId.trim()
    : (typeof raw.shaderPath === 'string' && raw.shaderPath.trim() ? raw.shaderPath.trim() : '');
  if (!shaderId) return null;
  const uniforms = raw.uniforms && typeof raw.uniforms === 'object' ? raw.uniforms : {};
  const modulators = raw.modulators && typeof raw.modulators === 'object' ? raw.modulators : {};
  return {
    shaderId,
    enabled: raw.enabled !== false,
    uniforms: JSON.parse(JSON.stringify(uniforms)),
    modulators: JSON.parse(JSON.stringify(modulators)),
  };
}

/** Show-wide postprocess stack (applied after each look's own layers). */
function normalizeShowFx(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const layers = (Array.isArray(src.layers) ? src.layers : [])
    .map(normalizeShowFxLayer)
    .filter(Boolean);
  const explicit = src.active;
  return {
    active: explicit === false ? false : (explicit === true || layers.length > 0),
    layers,
  };
}

/**
 * Look layers first, show-wide layers last (on top).
 * Overlay entries are tagged `_showFx` so capture/export can strip them.
 */
function composeShowFx(scene, showFx) {
  const fx = normalizeShowFx(showFx);
  if (!scene || typeof scene !== 'object' || !fx.active || !fx.layers.length) return scene;
  const out = JSON.parse(JSON.stringify(scene));
  const look = out.postprocess && typeof out.postprocess === 'object' ? out.postprocess : {};
  const lookLayers = Array.isArray(look.layers) ? look.layers : [];
  out.postprocess = Object.assign({}, look, {
    active: look.active !== false,
    layers: lookLayers.concat(fx.layers.map((l) => Object.assign({}, l, { _showFx: true }))),
  });
  if (out.postprocess.layers.length) out.postprocess.active = true;
  return out;
}

/**
 * @param {object} body
 * @returns {{ ok: true, performance: object, warnings: string[] } | { ok: false, error: string }}
 */
function validatePerformance(body) {
  const warnings = [];
  if (!body || typeof body !== 'object') {
    return { ok: false, error: 'Invalid performance JSON' };
  }
  if (body.version !== PERFORMANCE_VERSION) {
    return { ok: false, error: 'Unsupported performance version' };
  }
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) return { ok: false, error: 'Name required' };

  if (!Array.isArray(body.clips) || body.clips.length === 0) {
    return { ok: false, error: 'At least one clip required' };
  }

  const clips = [];
  for (let i = 0; i < body.clips.length; i++) {
    const raw = body.clips[i];
    if (!raw || typeof raw !== 'object') {
      return { ok: false, error: `Clip ${i} invalid` };
    }
    if (!raw.id || typeof raw.id !== 'string') {
      return { ok: false, error: 'Clip id required' };
    }
    const song = raw.song && typeof raw.song === 'object' ? raw.song : {};
    if (!isSafeRelPath(song.relPath)) {
      return { ok: false, error: 'Invalid song relPath' };
    }
    const duration = num(song.duration, null);
    const inT = num(raw.in, NaN);
    const outT = num(raw.out, NaN);
    if (!Number.isFinite(inT) || !Number.isFinite(outT) || inT < 0 || !(inT < outT)) {
      return { ok: false, error: 'Require 0 ≤ in < out' };
    }
    if (duration != null && duration > 0 && inT >= duration) {
      return { ok: false, error: 'Require 0 ≤ in < out' };
    }
    let outClamped = outT;
    if (duration != null && duration > 0 && outT > duration) {
      outClamped = duration;
      warnings.push(`Clip ${raw.id}: out clamped to duration`);
    }

    const holdAfter = num(raw.holdAfter, 0);
    if (holdAfter < 0) return { ok: false, error: 'holdAfter must be ≥ 0' };

    const audioT = raw.audioTransition && typeof raw.audioTransition === 'object'
      ? raw.audioTransition
      : defaultAudioTransition();
    if (num(audioT.duration, 0) < 0 || num(audioT.duration, 0) > 60) {
      return { ok: false, error: 'duration must be 0–60s' };
    }
    if (num(audioT.offset, 0) < -30 || num(audioT.offset, 0) > 30) {
      return { ok: false, error: 'offset must be −30…30s' };
    }
    if (audioT.type && !AUDIO_TYPES.has(audioT.type)) {
      return { ok: false, error: 'Unknown audio type' };
    }

    const lookCuesRaw = Array.isArray(raw.lookCues) ? raw.lookCues : null;
    if (!lookCuesRaw || lookCuesRaw.length === 0) {
      return { ok: false, error: 'Each clip needs a look cue at offset 0' };
    }
    const lookCues = [];
    let hasOffset0 = false;
    for (const lc of lookCuesRaw) {
      if (!lc || typeof lc !== 'object' || !lc.id) {
        return { ok: false, error: 'Look cue id required' };
      }
      const offset = num(lc.offset, NaN);
      if (!Number.isFinite(offset) || offset < 0) {
        return { ok: false, error: 'Look cue offset must be ≥ 0' };
      }
      if (offset === 0) hasOffset0 = true;
      const lookMode = LOOK_MODES.has(lc.lookMode) ? lc.lookMode : 'snapshot';
      let scene = null;
      if (lookMode === 'snapshot') {
        scene = lc.scene && typeof lc.scene === 'object' ? lc.scene : null;
        if (!scene || !Array.isArray(scene.containers)) {
          return { ok: false, error: 'Snapshot look requires scene.containers' };
        }
        for (const c of scene.containers) {
          if (!c || typeof c !== 'object') continue;
          const px = [c.left, c.top, c.width, c.height];
          if (px.some((v) => v == null || !Number.isFinite(Number(v)))) {
            return { ok: false, error: 'Snapshot containers require resolved pixels' };
          }
        }
      }
      const vt = lc.visualTransition && typeof lc.visualTransition === 'object'
        ? lc.visualTransition
        : defaultVisualTransition();
      if (vt.type && !VISUAL_TYPES.has(vt.type)) {
        return { ok: false, error: 'Unknown visual type' };
      }
      if (num(vt.duration, 0) < 0 || num(vt.duration, 0) > 60) {
        return { ok: false, error: 'duration must be 0–60s' };
      }
      lookCues.push({
        id: String(lc.id),
        offset,
        lookMode,
        sourcePreset: typeof lc.sourcePreset === 'string' ? lc.sourcePreset : null,
        capturedAt: typeof lc.capturedAt === 'string' ? lc.capturedAt : null,
        visualTransition: normalizeVisualTransition(vt),
        scene: lookMode === 'snapshot' ? scene : null,
      });
    }
    if (!hasOffset0) {
      return { ok: false, error: 'Each clip needs a look cue at offset 0' };
    }
    lookCues.sort((a, b) => a.offset - b.offset);

    clips.push({
      id: String(raw.id),
      song: {
        relPath: String(song.relPath).trim(),
        title: typeof song.title === 'string' ? song.title : '',
        artist: typeof song.artist === 'string' ? song.artist : '',
        duration: duration != null && duration > 0 ? duration : null,
      },
      in: inT,
      out: outClamped,
      volume: clamp(num(raw.volume, 1), 0, 1),
      holdAfter,
      loopUntilGo: !!raw.loopUntilGo,
      audioTransition: normalizeAudioTransition(audioT),
      lookCues,
    });
  }

  const settingsIn = body.settings && typeof body.settings === 'object' ? body.settings : {};
  const performance = {
    version: PERFORMANCE_VERSION,
    name,
    createdAt: typeof body.createdAt === 'string' ? body.createdAt : null,
    updatedAt: typeof body.updatedAt === 'string' ? body.updatedAt : null,
    settings: { loop: !!settingsIn.loop },
    showFx: normalizeShowFx(body.showFx),
    clips,
  };
  return { ok: true, performance, warnings };
}

function summarizePerformance(doc) {
  const clips = Array.isArray(doc?.clips) ? doc.clips : [];
  let duration = 0;
  for (const c of clips) {
    const span = Math.max(0, num(c.out, 0) - num(c.in, 0));
    duration += span + Math.max(0, num(c.holdAfter, 0));
  }
  return { clipCount: clips.length, duration };
}

function listPerformances() {
  try {
    const dir = ensurePerformancesDir();
    const files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.json'));
    const items = [];
    for (const file of files) {
      const name = file.replace(/\.json$/i, '');
      if (!sanitizePerformanceName(name)) continue;
      const full = path.join(dir, file);
      let updatedAt = null;
      let displayName = name;
      let clipCount = 0;
      let duration = 0;
      try {
        const st = fs.statSync(full);
        updatedAt = st.mtime.toISOString();
        const raw = JSON.parse(fs.readFileSync(full, 'utf8'));
        if (raw && typeof raw.name === 'string' && raw.name.trim()) {
          displayName = raw.name.trim();
        }
        const sum = summarizePerformance(raw);
        clipCount = sum.clipCount;
        duration = sum.duration;
      } catch (_) { /* skip unreadable */ }
      items.push({ name, displayName, path: full, updatedAt, clipCount, duration });
    }
    items.sort((a, b) => (a.displayName || a.name).localeCompare(b.displayName || b.name));
    return { ok: true, performances: items };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e), performances: [] };
  }
}

function loadPerformance(name) {
  const file = performancePath(name);
  if (!file) return { ok: false, error: 'Invalid performance name' };
  try {
    if (!fs.existsSync(file)) {
      return { ok: false, error: `Performance not found: ${name}` };
    }
    const raw = normalizePerformance(JSON.parse(fs.readFileSync(file, 'utf8')));
    const checked = validatePerformance(raw);
    if (!checked.ok) return checked;
    return {
      ok: true,
      name: sanitizePerformanceName(name),
      performance: checked.performance,
      warnings: checked.warnings,
    };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
}

function savePerformance(name, body) {
  const safe = sanitizePerformanceName(name);
  if (!safe) {
    return { ok: false, error: 'Invalid performance name (use letters, numbers, - or _)' };
  }
  const now = new Date().toISOString();
  const draft = normalizePerformance(Object.assign({}, body || {}, {
    version: PERFORMANCE_VERSION,
    createdAt: (body && body.createdAt) || now,
    updatedAt: now,
  }));
  if (!draft.name || !String(draft.name).trim()) draft.name = safe;
  const checked = validatePerformance(draft);
  if (!checked.ok) return checked;
  try {
    ensurePerformancesDir();
    const file = performancePath(safe);
    const out = Object.assign({}, checked.performance, {
      createdAt: checked.performance.createdAt || now,
      updatedAt: now,
    });
    fs.writeFileSync(file, JSON.stringify(out, null, 2), 'utf8');
    return {
      ok: true,
      name: safe,
      path: file,
      performance: out,
      warnings: checked.warnings,
    };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
}

function deletePerformance(name) {
  const safe = sanitizePerformanceName(name);
  if (!safe) return { ok: false, error: 'Invalid performance name' };
  const file = performancePath(safe);
  try {
    if (!fs.existsSync(file)) return { ok: false, error: 'Performance not found' };
    fs.unlinkSync(file);
    return { ok: true, name: safe };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
}

module.exports = {
  PERFORMANCE_VERSION,
  sanitizePerformanceName,
  isSafeRelPath,
  normalizeShowFx,
  composeShowFx,
  validatePerformance,
  summarizePerformance,
  listPerformances,
  loadPerformance,
  savePerformance,
  deletePerformance,
  performancesDir,
};
