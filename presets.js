/**
 * Preset storage — JSON files under ./presets/
 * Used by the main process only (Node fs).
 */

const fs = require('fs');
const path = require('path');
const { normalizePreset, LAYOUT_SPACE } = require('./layout-space');

const PRESET_VERSION = 1;
const DEFAULT_NAME = 'default';

function presetsDir() {
  return path.join(__dirname, 'presets');
}

function ensurePresetsDir() {
  const dir = presetsDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Safe preset file stem: letters, numbers, dash, underscore.
 * @param {string} name
 * @returns {string|null}
 */
function sanitizePresetName(name) {
  if (!name || typeof name !== 'string') return null;
  const s = name.trim().replace(/\.json$/i, '');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(s)) return null;
  return s;
}

function presetPath(name) {
  const safe = sanitizePresetName(name);
  if (!safe) return null;
  return path.join(presetsDir(), `${safe}.json`);
}

/** Known hand-authored themed looks (not look-/toolkit- prefixes). */
const CLASSIC_PRESET_NAMES = new Set([
  'default',
  'breathing-crt',
  'gameboy-pocket',
  'led-marquee',
  'night-cinema',
  'phosphor-terminal',
  'thermal-ops',
  'vhs-rental',
  'test-look',
  'testing_fx',
]);

/**
 * @param {string} name file stem
 * @returns {'classic'|'looks'|'recipes'|'saved'}
 */
function categorizePreset(name) {
  if (!name) return 'saved';
  if (name === DEFAULT_NAME || CLASSIC_PRESET_NAMES.has(name)) return 'classic';
  if (name.startsWith('look-')) return 'looks';
  if (name.startsWith('toolkit-')) return 'recipes';
  return 'saved';
}

/**
 * @param {object} preset
 * @returns {{
 *   layerCount: number,
 *   fxOnly: boolean,
 *   hasContainers: boolean,
 *   shaderIds: string[],
 *   containerCount: number,
 * }}
 */
function summarizePreset(preset) {
  const scene = preset && preset.scene ? preset.scene : preset;
  const layers = scene && scene.postprocess && Array.isArray(scene.postprocess.layers)
    ? scene.postprocess.layers
    : [];
  const containers = scene && Array.isArray(scene.containers) ? scene.containers : [];
  const shaderIds = [];
  const seen = new Set();
  for (const layer of layers) {
    const sid = layer && (layer.shaderId || layer.id || layer.shader);
    if (!sid || typeof sid !== 'string') continue;
    const key = sid.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    shaderIds.push(key);
  }
  return {
    layerCount: layers.length,
    hasContainers: containers.length > 0,
    containerCount: containers.length,
    fxOnly: layers.length > 0 && containers.length === 0,
    shaderIds,
  };
}

/**
 * @returns {{ ok: boolean, presets?: Array<object>, error?: string }}
 */
function listPresets() {
  try {
    const dir = ensurePresetsDir();
    const files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.json'));
    const presets = [];
    for (const file of files) {
      const name = file.replace(/\.json$/i, '');
      if (!sanitizePresetName(name)) continue;
      const full = path.join(dir, file);
      let updatedAt = null;
      let metaName = name;
      let layerCount = 0;
      let fxOnly = false;
      let hasContainers = false;
      let containerCount = 0;
      let shaderIds = [];
      try {
        const st = fs.statSync(full);
        updatedAt = st.mtime.toISOString();
        const raw = JSON.parse(fs.readFileSync(full, 'utf8'));
        if (raw && typeof raw.name === 'string' && raw.name.trim()) {
          metaName = raw.name.trim();
        }
        const sum = summarizePreset(raw);
        layerCount = sum.layerCount;
        fxOnly = sum.fxOnly;
        hasContainers = sum.hasContainers;
        containerCount = sum.containerCount;
        shaderIds = sum.shaderIds || [];
      } catch (e) { /* skip bad file stats */ }
      const category = categorizePreset(name);
      presets.push({
        name,
        displayName: metaName,
        path: full,
        updatedAt,
        isDefault: name === DEFAULT_NAME,
        category,
        layerCount,
        fxOnly,
        hasContainers,
        containerCount,
        shaderIds,
      });
    }
    presets.sort((a, b) => {
      if (a.isDefault) return -1;
      if (b.isDefault) return 1;
      const catOrder = { classic: 0, looks: 1, recipes: 2, saved: 3 };
      const ca = catOrder[a.category] != null ? catOrder[a.category] : 9;
      const cb = catOrder[b.category] != null ? catOrder[b.category] : 9;
      if (ca !== cb) return ca - cb;
      const an = (a.displayName || a.name).toLowerCase();
      const bn = (b.displayName || b.name).toLowerCase();
      return an.localeCompare(bn) || a.name.localeCompare(b.name);
    });
    return { ok: true, presets, defaultName: DEFAULT_NAME };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e), presets: [] };
  }
}

/**
 * @param {string} name
 * @returns {{ ok: boolean, preset?: object, error?: string }}
 */
function loadPreset(name) {
  const file = presetPath(name || DEFAULT_NAME);
  if (!file) return { ok: false, error: 'Invalid preset name' };
  try {
    if (!fs.existsSync(file)) {
      return { ok: false, error: `Preset not found: ${name || DEFAULT_NAME}` };
    }
    const raw = fs.readFileSync(file, 'utf8');
    const preset = JSON.parse(raw);
    if (!preset || typeof preset !== 'object') {
      return { ok: false, error: 'Invalid preset JSON' };
    }
    return {
      ok: true,
      preset: normalizePreset(preset),
      name: sanitizePresetName(name || DEFAULT_NAME),
    };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
}

/**
 * @param {string} name
 * @param {object} presetBody — full preset object (version, scene, …)
 * @returns {{ ok: boolean, name?: string, path?: string, error?: string }}
 */
function savePreset(name, presetBody) {
  const safe = sanitizePresetName(name);
  if (!safe) {
    return { ok: false, error: 'Invalid preset name (use letters, numbers, - or _)' };
  }
  if (!presetBody || typeof presetBody !== 'object') {
    return { ok: false, error: 'Invalid preset data' };
  }

  try {
    ensurePresetsDir();
    const file = presetPath(safe);
    const now = new Date().toISOString();
    const out = {
      version: PRESET_VERSION,
      name: typeof presetBody.name === 'string' && presetBody.name.trim()
        ? presetBody.name.trim()
        : safe,
      createdAt: presetBody.createdAt || now,
      updatedAt: now,
      scene: presetBody.scene || null,
    };
    if (!out.scene || typeof out.scene !== 'object') {
      return { ok: false, error: 'Preset missing scene' };
    }
    // Ensure no music runtime leaked in; persist design-space geometry
    const cleaned = normalizePreset(JSON.parse(JSON.stringify(out)));
    if (cleaned.scene && typeof cleaned.scene === 'object') {
      cleaned.scene.layoutSpace = LAYOUT_SPACE;
    }
    fs.writeFileSync(file, JSON.stringify(cleaned, null, 2), 'utf8');
    return { ok: true, name: safe, path: file, preset: cleaned };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
}

/**
 * @param {string} name
 */
function deletePreset(name) {
  const safe = sanitizePresetName(name);
  if (!safe) return { ok: false, error: 'Invalid preset name' };
  if (safe === DEFAULT_NAME) {
    return { ok: false, error: 'Cannot delete the default preset' };
  }
  const file = presetPath(safe);
  try {
    if (!fs.existsSync(file)) return { ok: false, error: 'Preset not found' };
    fs.unlinkSync(file);
    return { ok: true, name: safe };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
}

/**
 * Ensure default.json exists (write a minimal skeleton if missing).
 * Full default content is better provided as a checked-in file.
 */
function ensureDefaultPreset(fallbackScene) {
  ensurePresetsDir();
  const file = presetPath(DEFAULT_NAME);
  if (fs.existsSync(file)) return { ok: true, created: false, name: DEFAULT_NAME };
  if (!fallbackScene) return { ok: false, error: 'No fallback scene for default preset' };
  return savePreset(DEFAULT_NAME, {
    name: 'Default',
    scene: fallbackScene,
  });
}

module.exports = {
  PRESET_VERSION,
  LAYOUT_SPACE,
  DEFAULT_NAME,
  presetsDir,
  ensurePresetsDir,
  sanitizePresetName,
  listPresets,
  loadPreset,
  savePreset,
  deletePreset,
  ensureDefaultPreset,
};
