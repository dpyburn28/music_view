const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeShowFx, composeShowFx, validatePerformance } = require('../src/main/performances');

test('normalizeShowFx drops empty layers and stays off by default', () => {
  assert.deepEqual(normalizeShowFx(null), { active: false, layers: [] });
  assert.deepEqual(normalizeShowFx({}), { active: false, layers: [] });
  const on = normalizeShowFx({
    active: true,
    layers: [
      { shaderId: 'crt', enabled: true, uniforms: { u_scanline: 0.4 } },
      { shaderId: '', uniforms: {} },
      null,
    ],
  });
  assert.equal(on.active, true);
  assert.equal(on.layers.length, 1);
  assert.equal(on.layers[0].shaderId, 'crt');
  assert.equal(on.layers[0].uniforms.u_scanline, 0.4);
});

test('composeShowFx appends show layers after the look stack', () => {
  const scene = {
    containers: [],
    postprocess: {
      active: true,
      layers: [{ shaderId: 'oled', enabled: true, uniforms: {} }],
    },
  };
  const merged = composeShowFx(scene, {
    active: true,
    layers: [{ shaderId: 'crt', enabled: true, uniforms: { u_mask: 0.2 } }],
  });
  assert.equal(merged.postprocess.layers.length, 2);
  assert.equal(merged.postprocess.layers[0].shaderId, 'oled');
  assert.equal(merged.postprocess.layers[1].shaderId, 'crt');
  assert.equal(merged.postprocess.layers[1]._showFx, true);
  assert.equal(scene.postprocess.layers.length, 1);
});

test('composeShowFx is a no-op when show FX is off', () => {
  const scene = { postprocess: { layers: [{ shaderId: 'oled' }] } };
  assert.equal(composeShowFx(scene, { active: false, layers: [{ shaderId: 'crt' }] }), scene);
});

test('validatePerformance persists showFx', () => {
  const checked = validatePerformance({
    version: 1,
    name: 'fx-show',
    showFx: {
      active: true,
      layers: [{ shaderId: 'grain', enabled: true, uniforms: { u_amount: 0.2 } }],
    },
    clips: [{
      id: 'c1',
      song: { relPath: 'a.mp3', title: 'A', duration: 10 },
      in: 0,
      out: 4,
      lookCues: [{
        id: 'l1',
        offset: 0,
        lookMode: 'snapshot',
        scene: {
          containers: [{ role: 'song-cover', left: 0, top: 0, width: 100, height: 100 }],
        },
      }],
    }],
  });
  assert.equal(checked.ok, true, checked.error);
  assert.equal(checked.performance.showFx.active, true);
  assert.equal(checked.performance.showFx.layers[0].shaderId, 'grain');
});

test('validatePerformance keeps clip background', () => {
  const checked = validatePerformance({
    version: 1,
    name: 'bg-show',
    clips: [{
      id: 'c1',
      song: { relPath: 'a.mp3', title: 'A', duration: 10 },
      in: 0,
      out: 4,
      lookCues: [{
        id: 'l1',
        offset: 0,
        lookMode: 'snapshot',
        scene: {
          containers: [{ role: 'song-cover', left: 0, top: 0, width: 100, height: 100 }],
          background: {
            mode: 'shader',
            color: '#ffffff',
            shaderId: 'default',
            shaderUniforms: { u_intensity: 0.4 },
          },
        },
      }],
    }],
  });
  assert.equal(checked.ok, true, checked.error);
  const bg = checked.performance.clips[0].lookCues[0].scene.background;
  assert.equal(bg.mode, 'shader');
  assert.equal(bg.shaderId, 'default');
  assert.equal(bg.shaderUniforms.u_intensity, 0.4);
});

test('composeShowFx keeps scene.background', () => {
  const scene = {
    containers: [],
    background: { mode: 'image', imagePath: '/tmp/a.png' },
    postprocess: { active: true, layers: [{ shaderId: 'oled' }] },
  };
  const merged = composeShowFx(scene, {
    active: true,
    layers: [{ shaderId: 'crt' }],
  });
  assert.equal(merged.background.mode, 'image');
  assert.equal(merged.background.imagePath, '/tmp/a.png');
});
