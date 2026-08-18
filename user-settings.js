/**
 * Workspace settings — JSON in Electron userData.
 * Main process only (Node fs). No four-window geometry.
 */

const fs = require('fs');
const path = require('path');

const SETTINGS_VERSION = 1;
const FILE_NAME = 'user-settings.json';

/** Destination schema defaults (PR 1 writes this shape; nothing reads docks yet). */
function defaults() {
  return {
    version: SETTINGS_VERSION,
    window: {
      x: null,
      y: null,
      width: 1600,
      height: 1000,
      maximized: true,
    },
    docks: {
      left: { id: 'music', width: 360, collapsed: false },
      right: { id: 'controls', width: 380, collapsed: false, tab: 'look' },
      bottom: { id: 'performance', height: 240, collapsed: true },
    },
    present: { nativeStage: false, lockStage: false },
    render: { fps: 0 },
  };
}

function settingsPath(userDataDir) {
  return path.join(userDataDir, FILE_NAME);
}

function isFiniteNumber(n) {
  return typeof n === 'number' && Number.isFinite(n);
}

function clampInt(n, min, max, fallback) {
  if (!isFiniteNumber(n)) return fallback;
  const v = Math.round(n);
  if (v < min) return min;
  if (v > max) return max;
  return v;
}

function asBool(v, fallback) {
  return typeof v === 'boolean' ? v : fallback;
}

function normalizeWindow(raw, base) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = {
    x: src.x == null ? base.x : (isFiniteNumber(src.x) ? Math.round(src.x) : base.x),
    y: src.y == null ? base.y : (isFiniteNumber(src.y) ? Math.round(src.y) : base.y),
    width: clampInt(src.width, 320, 16000, base.width),
    height: clampInt(src.height, 240, 16000, base.height),
    maximized: asBool(src.maximized, base.maximized),
  };
  return out;
}

function normalizeDockSide(raw, base, kind) {
  const src = raw && typeof raw === 'object' ? raw : {};
  if (kind === 'bottom') {
    return {
      id: typeof src.id === 'string' && src.id ? src.id : base.id,
      height: clampInt(src.height, 48, 2000, base.height),
      collapsed: asBool(src.collapsed, base.collapsed),
    };
  }
  const tab = src.tab === 'object' || src.tab === 'look' ? src.tab : base.tab;
  const out = {
    id: typeof src.id === 'string' && src.id ? src.id : base.id,
    width: clampInt(src.width, 200, 800, base.width),
    collapsed: asBool(src.collapsed, base.collapsed),
  };
  if (base.tab != null || tab != null) out.tab = tab || 'look';
  return out;
}

/**
 * Overlay a raw object onto defaults. Unknown keys dropped.
 * `mode` / `fullScreen` are never persisted.
 * @param {object|null} raw
 * @returns {object}
 */
function normalize(raw) {
  const base = defaults();
  if (!raw || typeof raw !== 'object') return base;
  return {
    version: SETTINGS_VERSION,
    window: normalizeWindow(raw.window, base.window),
    docks: {
      left: normalizeDockSide(raw.docks && raw.docks.left, base.docks.left, 'side'),
      right: normalizeDockSide(raw.docks && raw.docks.right, base.docks.right, 'side'),
      bottom: normalizeDockSide(raw.docks && raw.docks.bottom, base.docks.bottom, 'bottom'),
    },
    present: {
      nativeStage: asBool(raw.present && raw.present.nativeStage, base.present.nativeStage),
      lockStage: asBool(raw.present && raw.present.lockStage, base.present.lockStage),
    },
    render: {
      fps: clampInt(raw.render && raw.render.fps, 0, 240, base.render.fps),
    },
  };
}

function ensureUserDataDir(userDataDir) {
  if (!fs.existsSync(userDataDir)) {
    fs.mkdirSync(userDataDir, { recursive: true });
  }
}

/**
 * @param {string} userDataDir
 * @returns {object}
 */
function load(userDataDir) {
  const file = settingsPath(userDataDir);
  try {
    if (!fs.existsSync(file)) return defaults();
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    return normalize(raw);
  } catch (e) {
    console.warn('user-settings load failed, using defaults:', e && e.message ? e.message : e);
    return defaults();
  }
}

/**
 * @param {string} userDataDir
 * @param {object} settings
 * @returns {{ ok: boolean, settings?: object, error?: string }}
 */
function save(userDataDir, settings) {
  try {
    ensureUserDataDir(userDataDir);
    const next = normalize(settings);
    fs.writeFileSync(settingsPath(userDataDir), JSON.stringify(next, null, 2) + '\n', 'utf8');
    return { ok: true, settings: next };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
}

/**
 * Merge a partial patch into the current file and write.
 * @param {string} userDataDir
 * @param {object} patch
 * @returns {{ ok: boolean, settings?: object, error?: string }}
 */
function set(userDataDir, patch) {
  const current = load(userDataDir);
  const src = patch && typeof patch === 'object' ? patch : {};
  const merged = {
    version: SETTINGS_VERSION,
    window: Object.assign({}, current.window, src.window || {}),
    docks: {
      left: Object.assign({}, current.docks.left, src.docks && src.docks.left ? src.docks.left : {}),
      right: Object.assign({}, current.docks.right, src.docks && src.docks.right ? src.docks.right : {}),
      bottom: Object.assign({}, current.docks.bottom, src.docks && src.docks.bottom ? src.docks.bottom : {}),
    },
    present: Object.assign({}, current.present, src.present || {}),
    render: Object.assign({}, current.render || { fps: 0 }, src.render || {}),
  };
  return save(userDataDir, merged);
}

/**
 * Write defaults (Reset Layout).
 * @param {string} userDataDir
 * @returns {{ ok: boolean, settings?: object, error?: string }}
 */
function reset(userDataDir) {
  return save(userDataDir, defaults());
}

module.exports = {
  SETTINGS_VERSION,
  FILE_NAME,
  defaults,
  settingsPath,
  normalize,
  load,
  save,
  set,
  reset,
};
