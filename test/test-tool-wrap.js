const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const FILES = ['src/music/music.js', 'src/controls/controls.js', 'src/renderer/performance.js'];

function src(name) {
  return fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
}

test('each tool script is an IIFE and is valid JS', () => {
  for (const name of FILES) {
    const text = src(name);
    assert.match(text, /^\(function \(root\) \{/, `${name} must start with IIFE`);
    assert.match(text, /\}\)\(window\);\s*$/, `${name} must end with })(window)`);
    assert.doesNotThrow(() => new Function(text), `${name} must parse`);
  }
});

test('three wrapped scripts concatenate without binding collisions', () => {
  const combined = FILES.map(src).join('\n');
  assert.doesNotThrow(() => new Function(combined));
});

test('exports and renamed ids are present', () => {
  const music = src('src/music/music.js');
  const controls = src('src/controls/controls.js');
  const perf = src('src/renderer/performance.js');
  assert.match(music, /root\.MusicViewMusic/);
  assert.match(music, /root\.__musicViewHandleMusicCommand/);
  assert.match(music, /music-btn-play/);
  assert.match(controls, /root\.__musicViewControls/);
  assert.match(controls, /ctrl-preset-list/);
  assert.match(perf, /root\.MusicViewShow/);
  assert.match(perf, /perf-btn-play/);
  assert.match(music, /isShowDriving/);
  assert.match(music, /getElementById\('dock-music'\)/);
  assert.match(perf, /getElementById\('dock-show'\)/);
  assert.match(controls, /getElementById\('dock-controls'\)/);
});
