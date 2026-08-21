/**
 * In-process facade over window.musicView.
 * Flags default off → every call delegates to the preload object.
 * Not loaded by production HTML until the workspace page exists (PR 3).
 */

/** Every key exposed on window.musicView (preload.js). Keep in sync. */
const MUSIC_VIEW_API_KEYS = [
  'getRole',
  'sendCommand',
  'requestState',
  'onState',
  'publishState',
  'notifyDisplayReady',
  'onDisplayCommand',
  'replyCommand',
  'listSongs',
  'loadLyrics',
  'loadSong',
  'getCover',
  'getSongDisplayInfo',
  'publishNowPlaying',
  'onNowPlaying',
  'publishLyricFocus',
  'onLyricFocus',
  'publishPlaybackProgress',
  'onPlaybackProgress',
  'publishAudioFrame',
  'onAudioFrame',
  'publishEmptyLyricsFx',
  'onEmptyLyricsFx',
  'listPresets',
  'loadPresetFile',
  'savePresetFile',
  'deletePresetFile',
  'getDefaultPresetName',
  'listPerformances',
  'loadPerformanceFile',
  'savePerformanceFile',
  'deletePerformanceFile',
  'sendMusicCommand',
  'notifyMusicReady',
  'notifyMusicClosed',
  'onMusicCommand',
  'replyMusicCommand',
  'publishMusicEvent',
  'onMusicEvent',
  'publishShowState',
  'onShowState',
  'publishSceneUserEdit',
  'onSceneUserEdit',
  'publishSceneTransition',
  'onSceneTransition',
  'onMusicClosed',
  'getSettings',
  'setSettings',
  'resetSettings',
  'onWorkspaceCommand',
  'setWorkspaceFullscreen',
  'setWorkspaceKiosk',
  'openMediaFile',
];

const JSON_CLONE_PUBLISHERS = new Set([
  'publishState',
  'publishNowPlaying',
  'publishLyricFocus',
  'publishPlaybackProgress',
  'publishEmptyLyricsFx',
  'publishMusicEvent',
  'publishShowState',
  'publishSceneUserEdit',
  'publishSceneTransition',
]);

function defaultBusFlags() {
  return {
    role: 'workspace',
    inProcessDisplay: false,
    inProcessMusic: false,
    inProcessAudio: false,
    inProcessState: false,
    inProcessPerfFanout: false,
  };
}

function jsonClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function cloneResult(result) {
  let safe;
  try {
    safe = jsonClone(result ?? { ok: false, error: 'null result' });
  } catch (e) {
    safe = { ok: false, error: 'Failed to serialize result: ' + (e && e.message ? e.message : e) };
  }
  if (typeof safe.ok !== 'boolean') {
    safe = { ok: false, error: 'Invalid result shape', raw: safe };
  }
  return safe;
}

function safeJsonClone(value, label) {
  try {
    return jsonClone(value);
  } catch (e) {
    console.warn(label + ' serialize failed', e);
    return undefined;
  }
}

/**
 * @param {object} ipc preload `window.musicView` (or a fake in tests)
 * @param {object} [flags]
 * @param {object} [root] `window` / `globalThis` for sceneCommand + music hooks
 */
function createWorkspaceBus(ipc, flags, root) {
  const opts = Object.assign(defaultBusFlags(), flags || {});
  const g = root || (typeof window !== 'undefined' ? window : globalThis);
  const listeners = new Map();

  function on(channel, cb) {
    if (typeof cb !== 'function') return () => {};
    let set = listeners.get(channel);
    if (!set) {
      set = new Set();
      listeners.set(channel, set);
    }
    set.add(cb);
    return () => {
      set.delete(cb);
    };
  }

  function emit(channel, data) {
    const set = listeners.get(channel);
    if (!set) return;
    for (const cb of Array.from(set)) {
      try {
        cb(data);
      } catch (e) {
        console.warn('workspace-bus emit', channel, e);
      }
    }
  }

  const overrides = {
    getRole: () => Promise.resolve(opts.role || 'workspace'),

    async sendCommand(command, payload) {
      if (
        opts.inProcessDisplay
        && g.containerAPI
        && typeof g.containerAPI.sceneCommand === 'function'
      ) {
        return cloneResult(await g.containerAPI.sceneCommand(command, payload));
      }
      return ipc.sendCommand(command, payload);
    },

    async sendMusicCommand(command, payload) {
      const fn = g.__musicViewHandleMusicCommand;
      if (opts.inProcessMusic && typeof fn === 'function') {
        return cloneResult(await fn(command, payload));
      }
      return ipc.sendMusicCommand(command, payload);
    },

    publishAudioFrame(payload) {
      if (opts.inProcessAudio) {
        emit('audio-frame', payload);
        return;
      }
      return ipc.publishAudioFrame(payload);
    },
    onAudioFrame(cb) {
      if (opts.inProcessAudio) return on('audio-frame', cb);
      return ipc.onAudioFrame(cb);
    },

    publishNowPlaying(p) {
      if (!opts.inProcessAudio) return ipc.publishNowPlaying(p);
      const safe = safeJsonClone(p, 'publishNowPlaying');
      if (safe === undefined) return;
      emit('now-playing', safe);
    },
    onNowPlaying(cb) {
      return opts.inProcessAudio ? on('now-playing', cb) : ipc.onNowPlaying(cb);
    },
    publishLyricFocus(p) {
      if (!opts.inProcessAudio) return ipc.publishLyricFocus(p);
      const safe = safeJsonClone(p, 'publishLyricFocus');
      if (safe === undefined) return;
      emit('lyric-focus', safe);
    },
    onLyricFocus(cb) {
      return opts.inProcessAudio ? on('lyric-focus', cb) : ipc.onLyricFocus(cb);
    },
    publishEmptyLyricsFx(p) {
      if (!opts.inProcessAudio) return ipc.publishEmptyLyricsFx(p);
      const safe = safeJsonClone(p, 'publishEmptyLyricsFx');
      if (safe === undefined) return;
      emit('empty-lyrics-fx', safe);
    },
    onEmptyLyricsFx(cb) {
      return opts.inProcessAudio ? on('empty-lyrics-fx', cb) : ipc.onEmptyLyricsFx(cb);
    },

    publishPlaybackProgress(p) {
      if (!opts.inProcessPerfFanout) return ipc.publishPlaybackProgress(p);
      const safe = safeJsonClone(p, 'publishPlaybackProgress');
      if (safe === undefined) return;
      emit('playback-progress', safe);
    },
    onPlaybackProgress(cb) {
      return opts.inProcessPerfFanout ? on('playback-progress', cb) : ipc.onPlaybackProgress(cb);
    },
    publishMusicEvent(p) {
      if (!opts.inProcessPerfFanout) return ipc.publishMusicEvent(p);
      const safe = safeJsonClone(p, 'publishMusicEvent');
      if (safe === undefined) return;
      emit('music-event', safe);
    },
    onMusicEvent(cb) {
      return opts.inProcessPerfFanout ? on('music-event', cb) : ipc.onMusicEvent(cb);
    },

    publishState(state) {
      const safe = safeJsonClone(state, 'publishState');
      if (safe === undefined) return;
      return opts.inProcessState ? emit('state-update', safe) : ipc.publishState(safe);
    },
    onState(cb) {
      return opts.inProcessState ? on('state-update', cb) : ipc.onState(cb);
    },

    publishShowState(p) {
      if (!opts.inProcessPerfFanout) return ipc.publishShowState(p);
      const safe = safeJsonClone(p, 'publishShowState');
      if (safe === undefined) return;
      emit('show-state', safe);
    },
    onShowState(cb) {
      return opts.inProcessPerfFanout ? on('show-state', cb) : ipc.onShowState(cb);
    },

    publishSceneUserEdit(p) {
      if (!opts.inProcessPerfFanout) return ipc.publishSceneUserEdit(p);
      const safe = safeJsonClone(p, 'publishSceneUserEdit');
      if (safe === undefined) return;
      emit('scene-user-edit', safe);
    },
    onSceneUserEdit(cb) {
      return opts.inProcessPerfFanout ? on('scene-user-edit', cb) : ipc.onSceneUserEdit(cb);
    },
    publishSceneTransition(p) {
      if (!opts.inProcessPerfFanout) return ipc.publishSceneTransition(p);
      const safe = safeJsonClone(p, 'publishSceneTransition');
      if (safe === undefined) return;
      emit('scene-transition', safe);
    },
    onSceneTransition(cb) {
      return opts.inProcessPerfFanout ? on('scene-transition', cb) : ipc.onSceneTransition(cb);
    },
  };

  return new Proxy(ipc, {
    get(target, prop) {
      if (typeof prop === 'string' && Object.prototype.hasOwnProperty.call(overrides, prop)) {
        return overrides[prop];
      }
      const v = target[prop];
      if (typeof v !== 'function') return v;
      // Do not .bind() contextBridge methods — Electron drops those calls.
      return (...args) => target[prop](...args);
    },
    has(target, prop) {
      return (typeof prop === 'string' && Object.prototype.hasOwnProperty.call(overrides, prop))
        || prop in target;
    },
    ownKeys() {
      return MUSIC_VIEW_API_KEYS.slice();
    },
    getOwnPropertyDescriptor(target, prop) {
      if (Object.prototype.hasOwnProperty.call(target, prop)) {
        return Reflect.getOwnPropertyDescriptor(target, prop);
      }
      if (typeof prop === 'string' && MUSIC_VIEW_API_KEYS.includes(prop)) {
        return { configurable: true, enumerable: true, writable: true, value: overrides[prop] };
      }
      return undefined;
    },
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    MUSIC_VIEW_API_KEYS,
    JSON_CLONE_PUBLISHERS,
    defaultBusFlags,
    createWorkspaceBus,
    cloneResult,
  };
}

if (typeof window !== 'undefined') {
  window.createWorkspaceBus = createWorkspaceBus;
  window.MUSIC_VIEW_API_KEYS = MUSIC_VIEW_API_KEYS;
}
