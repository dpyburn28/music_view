/**
 * Pure scene-match scorer for Performance visual `auto` mode.
 * Node-requireable (no DOM).
 */

function uniqueRoles(containers) {
  const set = new Set();
  if (!Array.isArray(containers)) return set;
  for (const c of containers) {
    if (c && c.role) set.add(String(c.role));
  }
  return set;
}

function jaccard(a, b) {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter += 1;
  const union = a.size + b.size - inter;
  return union === 0 ? 1 : inter / union;
}

function fxShaderSeq(scene) {
  const layers = scene && scene.postprocess && Array.isArray(scene.postprocess.layers)
    ? scene.postprocess.layers
    : [];
  return layers.map((l) => (l && l.shaderId) || '');
}

function lcpRatio(a, b) {
  const n = Math.max(a.length, b.length);
  if (n === 0) return 1;
  const m = Math.min(a.length, b.length);
  let i = 0;
  while (i < m && a[i] === b[i]) i += 1;
  return i / n;
}

function fxTopology(a, b) {
  const sa = fxShaderSeq(a);
  const sb = fxShaderSeq(b);
  if (sa.length === sb.length && sa.every((id, i) => id === sb[i])) return 1;
  return lcpRatio(sa, sb);
}

function matchContainers(aList, bList) {
  const UNIQUE = new Set([
    'song-cover', 'song-info', 'song-lyrics', 'song-progress', 'show-progress',
    'audio-scope', 'audio-history', 'audio-beat', 'artef4kt',
  ]);
  const usedB = new Set();
  const pairs = [];
  const listA = Array.isArray(aList) ? aList : [];
  const listB = Array.isArray(bList) ? bList : [];

  for (const a of listA) {
    if (!a) continue;
    let idx = -1;
    if (a.role && UNIQUE.has(a.role)) {
      idx = listB.findIndex((b, i) => !usedB.has(i) && b && b.role === a.role);
    }
    if (idx < 0 && a.snapshotId) {
      idx = listB.findIndex((b, i) => !usedB.has(i) && b && b.snapshotId === a.snapshotId);
    }
    if (idx >= 0) {
      usedB.add(idx);
      pairs.push([a, listB[idx]]);
    }
  }
  return pairs;
}

function fillMatch(a, b) {
  const pairs = matchContainers(a && a.containers, b && b.containers);
  if (pairs.length === 0) return 1;
  let same = 0;
  for (const [ca, cb] of pairs) {
    const arte = ca.role === 'artef4kt' && cb.role === 'artef4kt';
    if (arte || (ca.shaderId || null) === (cb.shaderId || null)) same += 1;
  }
  return same / pairs.length;
}

/** Stable key for the stage fill so auto-mode treats shader vs white as a hard cut. */
function backgroundKey(scene) {
  const bg = scene && scene.background;
  if (!bg || typeof bg !== 'object') return 'solid:#ffffff';
  const mode = bg.mode || 'solid';
  if (mode === 'shader') return `shader:${bg.shaderId || bg.shaderPath || ''}`;
  if (mode === 'image') return `image:${bg.imageSrc || bg.imagePath || ''}`;
  if (mode === 'video') return `video:${bg.videoSrc || bg.videoPath || ''}`;
  const color = typeof bg.color === 'string' && bg.color ? bg.color.toLowerCase() : '#ffffff';
  return `solid:${color}`;
}

function backgroundMatch(a, b) {
  return backgroundKey(a) === backgroundKey(b) ? 1 : 0;
}

/**
 * @param {object} a outgoing scene
 * @param {object} b incoming scene
 * @returns {{ score: number, roleJaccard: number, countRatio: number, fx: number, fill: number }}
 */
function scoreSceneMatch(a, b) {
  const ca = (a && Array.isArray(a.containers)) ? a.containers : [];
  const cb = (b && Array.isArray(b.containers)) ? b.containers : [];
  const ra = uniqueRoles(ca);
  const rb = uniqueRoles(cb);
  const roleJaccard = jaccard(ra, rb);
  const nA = ca.length || 0;
  const nB = cb.length || 0;
  const countRatio = (nA === 0 && nB === 0) ? 1 : (Math.max(nA, nB) === 0 ? 1 : Math.min(nA, nB) / Math.max(nA, nB));
  const fx = fxTopology(a || {}, b || {});
  const fill = fillMatch(a || {}, b || {});
  const background = backgroundMatch(a || {}, b || {});
  let score = roleJaccard * 0.40 + countRatio * 0.10 + fx * 0.30 + fill * 0.20;
  // Shared 8-role looks would otherwise always morph. No shared FX prefix → fallback.
  const sa = fxShaderSeq(a || {});
  const sb = fxShaderSeq(b || {});
  if (fx === 0 && sa.length > 0 && sb.length > 0) {
    score = Math.min(score, 0.64);
  }
  // Fill identity is handled by a live background fade during morph.
  return { score, roleJaccard, countRatio, fx, fill, background };
}

function pickAutoMode(a, b, threshold) {
  const t = Number.isFinite(threshold) ? threshold : 0.65;
  const detail = scoreSceneMatch(a, b);
  return {
    mode: detail.score >= t ? 'morph' : 'crossfade',
    matchScore: detail.score,
    detail,
  };
}

const SceneMatchApi = { scoreSceneMatch, pickAutoMode, matchContainers, backgroundKey };
if (typeof module !== 'undefined' && module.exports) {
  module.exports = SceneMatchApi;
}
if (typeof window !== 'undefined') {
  window.SceneMatch = SceneMatchApi;
}
