const { test } = require('node:test');
const assert = require('node:assert/strict');
const { scoreSceneMatch, pickAutoMode } = require('../scene-match');

const EIGHT = [
  { role: 'song-cover', shaderId: null },
  { role: 'song-info', shaderId: null },
  { role: 'song-lyrics', shaderId: null },
  { role: 'song-progress', shaderId: null },
  { role: 'audio-scope', shaderId: 'audio-scope' },
  { role: 'audio-history', shaderId: 'audio-history' },
  { role: 'audio-beat', shaderId: 'audio-beat' },
  { role: 'artef4kt', shaderId: null },
];

function scene(containers, layers) {
  return {
    containers,
    postprocess: { active: true, layers: (layers || []).map((shaderId) => ({ shaderId })) },
  };
}

test('same 8 roles, same CRT stack, same fills → morph 1.00', () => {
  const a = scene(EIGHT, ['crt']);
  const b = scene(EIGHT, ['crt']);
  const r = scoreSceneMatch(a, b);
  assert.equal(r.score, 1);
  assert.equal(pickAutoMode(a, b).mode, 'morph');
});

test('same roles, default 1-layer vs 5-layer no shared prefix → crossfade', () => {
  const a = scene(EIGHT, ['default']);
  const b = scene(EIGHT, ['bloom', 'warp-ripple', 'feedback-trail', 'chromatic', 'vignette']);
  const r = scoreSceneMatch(a, b);
  assert.ok(r.score < 0.65, `score ${r.score}`);
  assert.equal(pickAutoMode(a, b).mode, 'crossfade');
});

test('same stack, 2/8 fills differ → morph', () => {
  const bContainers = EIGHT.map((c) => Object.assign({}, c));
  bContainers[4] = { role: 'audio-scope', shaderId: 'other-scope' };
  bContainers[6] = { role: 'audio-beat', shaderId: 'other-beat' };
  const a = scene(EIGHT, ['crt', 'grain', 'vignette']);
  const b = scene(bContainers, ['crt', 'grain', 'vignette']);
  const r = scoreSceneMatch(a, b);
  assert.ok(Math.abs(r.fill - 0.75) < 1e-9, `fill ${r.fill}`);
  assert.ok(r.score > 0.9);
  assert.equal(pickAutoMode(a, b).mode, 'morph');
});

test('stacks share only first of 4 layers → barely morph', () => {
  const a = scene(EIGHT, ['crt', 'a', 'b', 'c']);
  const b = scene(EIGHT, ['crt', 'x', 'y', 'z']);
  const r = scoreSceneMatch(a, b);
  assert.ok(Math.abs(r.fx - 0.25) < 1e-9, `fx ${r.fx}`);
  assert.ok(r.score >= 0.65, `score ${r.score}`);
  assert.equal(pickAutoMode(a, b).mode, 'morph');
});

test('incoming missing artef4kt → still morph', () => {
  const without = EIGHT.filter((c) => c.role !== 'artef4kt');
  const a = scene(EIGHT, []);
  const b = scene(without, []);
  const r = scoreSceneMatch(a, b);
  assert.ok(r.score > 0.9);
  assert.equal(pickAutoMode(a, b).mode, 'morph');
});

test('same look, missing background matches default white', () => {
  const a = scene(EIGHT, ['crt']);
  const b = Object.assign({}, scene(EIGHT, ['crt']), {
    background: { mode: 'solid', color: '#ffffff' },
  });
  const r = scoreSceneMatch(a, b);
  assert.equal(r.background, 1);
  assert.equal(pickAutoMode(a, b).mode, 'morph');
});

test('different backgrounds, same layout → morph (live fill fade)', () => {
  const eightCrt = scene(EIGHT, ['crt']);
  const shaderA = Object.assign({}, eightCrt, {
    background: { mode: 'shader', shaderId: 'bg-starburst' },
  });
  const shaderB = Object.assign({}, eightCrt, {
    background: { mode: 'shader', shaderId: 'bg-line-halftone' },
  });
  const image = Object.assign({}, eightCrt, {
    background: { mode: 'image', imagePath: '/tmp/a.jpg' },
  });
  const video = Object.assign({}, eightCrt, {
    background: { mode: 'video', videoPath: '/tmp/b.mp4' },
  });
  for (const [a, b] of [[shaderA, shaderB], [image, video], [shaderA, video], [shaderB, image]]) {
    const r = scoreSceneMatch(a, b);
    assert.equal(r.background, 0);
    assert.equal(pickAutoMode(a, b).mode, 'morph');
  }
  const sameShader = scoreSceneMatch(shaderA, Object.assign({}, eightCrt, {
    background: { mode: 'shader', shaderId: 'bg-starburst' },
  }));
  assert.equal(sameShader.background, 1);
  assert.equal(pickAutoMode(shaderA, shaderA).mode, 'morph');
});

test('shader background vs blank white, same layout → morph', () => {
  const a = Object.assign({}, scene(EIGHT, ['crt']), {
    background: { mode: 'shader', shaderId: 'default' },
  });
  const b = scene(EIGHT, ['crt']);
  const r = scoreSceneMatch(a, b);
  assert.equal(r.background, 0);
  assert.ok(r.score >= 0.65, `score ${r.score}`);
  assert.equal(pickAutoMode(a, b).mode, 'morph');
});
