const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  MUSIC_VIEW_API_KEYS,
  createWorkspaceBus,
  defaultBusFlags,
} = require('../src/workspace/workspace-bus');

function extractPreloadKeys(src) {
  const start = src.indexOf("exposeInMainWorld('musicView'");
  assert.ok(start >= 0, 'preload exposeInMainWorld not found');
  const chunk = src.slice(start);
  const keys = [];
  const re = /^\s{2}([a-zA-Z][a-zA-Z0-9]*):/gm;
  let m;
  while ((m = re.exec(chunk))) keys.push(m[1]);
  return keys;
}

function fakeIpc(keys) {
  const ipc = {};
  const calls = [];
  for (const key of keys) {
    ipc[key] = function (...args) {
      calls.push({ key, args });
      if (key.startsWith('on')) return () => {};
      if (key === 'getRole') return Promise.resolve('display');
      if (key.startsWith('send') || key.endsWith('File') || key.startsWith('list')
          || key.startsWith('load') || key.startsWith('get') || key === 'requestState'
          || key === 'setSettings' || key === 'resetSettings') {
        return Promise.resolve({ ok: true });
      }
      return undefined;
    };
  }
  ipc._calls = calls;
  return ipc;
}

test('MUSIC_VIEW_API_KEYS matches preload.js', () => {
  const src = fs.readFileSync(path.join(__dirname, '../preload.js'), 'utf8');
  const preloadKeys = extractPreloadKeys(src).slice().sort();
  const listed = MUSIC_VIEW_API_KEYS.slice().sort();
  assert.deepEqual(preloadKeys, listed);
});

test('createWorkspaceBus key set equals MUSIC_VIEW_API_KEYS', () => {
  const ipc = fakeIpc(MUSIC_VIEW_API_KEYS);
  const bus = createWorkspaceBus(ipc, defaultBusFlags());
  assert.deepEqual(Object.keys(bus).sort(), MUSIC_VIEW_API_KEYS.slice().sort());
});

test('missing preload key fails the fixture check', () => {
  const src = fs.readFileSync(path.join(__dirname, '../preload.js'), 'utf8');
  const preloadKeys = extractPreloadKeys(src);
  assert.ok(preloadKeys.includes('sendCommand'));
  const without = MUSIC_VIEW_API_KEYS.filter((k) => k !== 'sendCommand');
  assert.notDeepEqual(without.slice().sort(), preloadKeys.slice().sort());
});

test('flags off: sendCommand / publishAudioFrame / onState delegate to ipc', async () => {
  const ipc = fakeIpc(MUSIC_VIEW_API_KEYS);
  const bus = createWorkspaceBus(ipc, defaultBusFlags());
  const root = {
    containerAPI: {
      sceneCommand: async () => ({ ok: true, state: { from: 'in-process' } }),
    },
  };
  await bus.sendCommand('getState', null);
  bus.publishAudioFrame({ waveform: new Uint8Array([1, 2]) });
  const unsub = bus.onState(() => {});
  assert.equal(typeof unsub, 'function');
  const keys = ipc._calls.map((c) => c.key);
  assert.ok(keys.includes('sendCommand'));
  assert.ok(keys.includes('publishAudioFrame'));
  assert.ok(keys.includes('onState'));
  assert.equal(keys.filter((k) => k === 'sendCommand').length, 1);
});

test('inProcessDisplay sendCommand uses sceneCommand and clones the result', async () => {
  const ipc = fakeIpc(MUSIC_VIEW_API_KEYS);
  const live = { ok: true, state: { n: 1 } };
  const root = {
    containerAPI: {
      sceneCommand: async (cmd) => {
        assert.equal(cmd, 'getState');
        return live;
      },
    },
  };
  const bus = createWorkspaceBus(ipc, { inProcessDisplay: true }, root);
  const result = await bus.sendCommand('getState', null);
  assert.deepEqual(result, { ok: true, state: { n: 1 } });
  assert.notEqual(result, live);
  assert.notEqual(result.state, live.state);
  assert.equal(ipc._calls.length, 0);
});

test('inProcessAudio flips both publishAudioFrame and onAudioFrame (no JSON clone)', () => {
  const ipc = fakeIpc(MUSIC_VIEW_API_KEYS);
  const bus = createWorkspaceBus(ipc, { inProcessAudio: true });
  const wave = new Uint8Array([9, 8, 7]);
  let seen = null;
  const unsub = bus.onAudioFrame((data) => {
    seen = data;
  });
  bus.publishAudioFrame({ waveform: wave, rms: 0.4 });
  assert.ok(seen);
  assert.equal(seen.waveform, wave);
  assert.equal(seen.rms, 0.4);
  assert.equal(ipc._calls.length, 0);
  unsub();
  bus.publishAudioFrame({ waveform: wave });
  assert.equal(seen.rms, 0.4);
});

test('inProcessAudio publishNowPlaying + onNowPlaying stay paired', () => {
  const ipc = fakeIpc(MUSIC_VIEW_API_KEYS);
  const bus = createWorkspaceBus(ipc, { inProcessAudio: true });
  let seen = null;
  bus.onNowPlaying((data) => {
    seen = data;
  });
  const payload = { title: 'x' };
  bus.publishNowPlaying(payload);
  assert.deepEqual(seen, { title: 'x' });
  assert.notEqual(seen, payload);
  assert.equal(ipc._calls.length, 0);
});
