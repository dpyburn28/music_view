const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const settings = require('../src/main/user-settings');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'music-view-settings-'));
}

test('missing file returns defaults', () => {
  const dir = tmpDir();
  const loaded = settings.load(dir);
  assert.equal(loaded.version, 1);
  assert.equal(loaded.docks.right.width, 380);
  assert.equal(loaded.docks.bottom.collapsed, true);
  assert.equal(loaded.present.nativeStage, false);
  assert.equal(loaded.window.maximized, true);
  assert.equal(loaded.render.fps, 0);
});

test('unknown keys and mode/fullScreen are dropped', () => {
  const dir = tmpDir();
  fs.writeFileSync(settings.settingsPath(dir), JSON.stringify({
    version: 9,
    mode: 'present',
    fullScreen: true,
    windows: { display: { x: 0 } },
    extra: true,
    docks: { left: { width: 400, weird: 1 } },
    present: { nativeStage: true, lockStage: true, other: 1 },
  }));
  const loaded = settings.load(dir);
  assert.equal(loaded.version, 1);
  assert.equal(loaded.mode, undefined);
  assert.equal(loaded.fullScreen, undefined);
  assert.equal(loaded.windows, undefined);
  assert.equal(loaded.extra, undefined);
  assert.equal(loaded.docks.left.width, 400);
  assert.equal(loaded.docks.left.weird, undefined);
  assert.equal(loaded.present.nativeStage, true);
  assert.equal(loaded.present.other, undefined);
});

test('set merges a patch and reset restores defaults', () => {
  const dir = tmpDir();
  const saved = settings.set(dir, { docks: { right: { width: 420 } } });
  assert.equal(saved.ok, true);
  assert.equal(saved.settings.docks.right.width, 420);
  assert.equal(saved.settings.docks.left.width, 360);
  const fpsSaved = settings.set(dir, { render: { fps: 30 } });
  assert.equal(fpsSaved.settings.render.fps, 30);
  const fpsClamped = settings.set(dir, { render: { fps: 999 } });
  assert.equal(fpsClamped.settings.render.fps, 240);
  const again = settings.load(dir);
  assert.equal(again.docks.right.width, 420);
  const reset = settings.reset(dir);
  assert.equal(reset.ok, true);
  assert.equal(reset.settings.docks.right.width, 380);
});
