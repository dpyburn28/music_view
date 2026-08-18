const { contextBridge, ipcRenderer } = require('electron');

/**
 * Note: do not `await` functions passed in from the page as return values of
 * async handlers — contextBridge proxies can drop Promise results. Instead the
 * page receives the command and explicitly replies via replyCommand().
 */
contextBridge.exposeInMainWorld('musicView', {
  /** 'display' | 'controls' | 'music' | 'performance' | 'workspace' | 'unknown' */
  getRole: () => ipcRenderer.invoke('get-window-role'),

  /**
   * Control window → display window command (via main process).
   * @param {string} command
   * @param {any} [payload]
   * @returns {Promise<{ok: boolean, error?: string, state?: object}>}
   */
  sendCommand: (command, payload) => ipcRenderer.invoke('control-command', command, payload ?? null),

  /** Control window: pull the latest scene state from the display. */
  requestState: () => ipcRenderer.invoke('request-state'),

  /**
   * Control window: subscribe to live state pushes from the display.
   * @param {(state: object) => void} callback
   * @returns {() => void} unsubscribe
   */
  onState: (callback) => {
    const handler = (_event, state) => {
      try {
        callback(state);
      } catch (e) {
        console.warn('onState callback error', e);
      }
    };
    ipcRenderer.on('state-update', handler);
    return () => ipcRenderer.removeListener('state-update', handler);
  },

  /** Display window: publish a serializable state snapshot to the control panel. */
  publishState: (state) => {
    let safe = state;
    try {
      safe = JSON.parse(JSON.stringify(state));
    } catch (e) {
      console.warn('publishState serialize failed', e);
      return;
    }
    ipcRenderer.send('publish-state', safe);
  },

  /** Display signals it is ready to receive commands. */
  notifyDisplayReady: () => ipcRenderer.send('display-ready'),

  /**
   * Display window: listen for commands from main.
   * Callback receives { requestId, command, payload }.
   * Must reply with replyCommand(requestId, result).
   */
  onDisplayCommand: (callback) => {
    ipcRenderer.removeAllListeners('display-command');
    ipcRenderer.on('display-command', (_event, msg) => {
      try {
        callback(msg || {});
      } catch (e) {
        const requestId = msg && msg.requestId;
        if (requestId) {
          ipcRenderer.send('display-command-result', {
            requestId,
            result: { ok: false, error: String(e && e.message ? e.message : e) },
          });
        }
      }
    });
  },

  /**
   * Display window: send command result back to main.
   * Result is JSON-cloned so structured-clone edge cases can't blank it out.
   */
  replyCommand: (requestId, result) => {
    let safe;
    try {
      safe = JSON.parse(JSON.stringify(result ?? { ok: false, error: 'null result' }));
    } catch (e) {
      safe = { ok: false, error: 'Failed to serialize result: ' + (e && e.message ? e.message : e) };
    }
    if (typeof safe.ok !== 'boolean') {
      safe = { ok: false, error: 'Invalid result shape', raw: safe };
    }
    ipcRenderer.send('display-command-result', { requestId, result: safe });
  },

  // ── Music library (music window) ────────────────────────────────────
  listSongs: () => ipcRenderer.invoke('music-list-songs'),
  loadLyrics: (lyricsPath) => ipcRenderer.invoke('music-load-lyrics', lyricsPath),
  loadSong: (songPath) => ipcRenderer.invoke('music-load-song', songPath),
  getCover: (songPath) => ipcRenderer.invoke('music-get-cover', songPath),
  getSongDisplayInfo: (songPath) => ipcRenderer.invoke('music-get-display-info', songPath),
  probeSpotifyImport: () => ipcRenderer.invoke('music-import-spotify-probe'),
  importSpotifyTrack: (url) => ipcRenderer.invoke('music-import-spotify', url),
  onSpotifyImportProgress: (callback) => {
    const handler = (_event, data) => {
      try {
        callback(data);
      } catch (e) {
        console.warn('onSpotifyImportProgress callback error', e);
      }
    };
    ipcRenderer.on('spotify-import-progress', handler);
    return () => ipcRenderer.removeListener('spotify-import-progress', handler);
  },

  /** Music → display: broadcast selected track (title/artist/album/cover). */
  publishNowPlaying: (payload) => {
    let safe = payload;
    try {
      safe = JSON.parse(JSON.stringify(payload ?? null));
    } catch (e) {
      console.warn('publishNowPlaying serialize failed', e);
      return;
    }
    ipcRenderer.send('now-playing', safe);
  },

  /** Display: subscribe to now-playing updates from the music window. */
  onNowPlaying: (callback) => {
    const handler = (_event, data) => {
      try {
        callback(data);
      } catch (e) {
        console.warn('onNowPlaying callback error', e);
      }
    };
    ipcRenderer.on('now-playing', handler);
    return () => ipcRenderer.removeListener('now-playing', handler);
  },

  /** Music → display: current lyric focus (prev / current / next). */
  publishLyricFocus: (payload) => {
    let safe = payload;
    try {
      safe = JSON.parse(JSON.stringify(payload ?? null));
    } catch (e) {
      console.warn('publishLyricFocus serialize failed', e);
      return;
    }
    ipcRenderer.send('lyric-focus', safe);
  },

  /** Display: subscribe to lyric focus updates. */
  onLyricFocus: (callback) => {
    const handler = (_event, data) => {
      try {
        callback(data);
      } catch (e) {
        console.warn('onLyricFocus callback error', e);
      }
    };
    ipcRenderer.on('lyric-focus', handler);
    return () => ipcRenderer.removeListener('lyric-focus', handler);
  },

  /** Music → display: playback position (0..1 progress fill). */
  publishPlaybackProgress: (payload) => {
    let safe = payload;
    try {
      safe = JSON.parse(JSON.stringify(payload ?? null));
    } catch (e) {
      console.warn('publishPlaybackProgress serialize failed', e);
      return;
    }
    ipcRenderer.send('playback-progress', safe);
  },

  /** Display: subscribe to playback progress updates. */
  onPlaybackProgress: (callback) => {
    const handler = (_event, data) => {
      try {
        callback(data);
      } catch (e) {
        console.warn('onPlaybackProgress callback error', e);
      }
    };
    ipcRenderer.on('playback-progress', handler);
    return () => ipcRenderer.removeListener('playback-progress', handler);
  },

  /**
   * Music → display: live audio analysis frame (waveform + scalars).
   * Uses structured clone (not JSON) so Uint8Array waveform stays binary.
   * @param {{
   *   t?: number,
   *   playing?: boolean,
   *   rms?: number,
   *   bass?: number,
   *   envelope?: number,
   *   beat?: number,
   *   waveform?: Uint8Array|number[],
   * }} payload
   */
  publishAudioFrame: (payload) => {
    if (!payload || typeof payload !== 'object') return;
    try {
      ipcRenderer.send('audio-frame', payload);
    } catch (e) {
      console.warn('publishAudioFrame failed', e);
    }
  },

  /** Display: subscribe to live audio analysis frames. */
  onAudioFrame: (callback) => {
    const handler = (_event, data) => {
      try {
        callback(data);
      } catch (e) {
        console.warn('onAudioFrame callback error', e);
      }
    };
    ipcRenderer.on('audio-frame', handler);
    return () => ipcRenderer.removeListener('audio-frame', handler);
  },

  /** Music → display: empty-lyrics glitch effect parameters. */
  publishEmptyLyricsFx: (payload) => {
    let safe = payload;
    try {
      safe = JSON.parse(JSON.stringify(payload ?? null));
    } catch (e) {
      console.warn('publishEmptyLyricsFx serialize failed', e);
      return;
    }
    ipcRenderer.send('empty-lyrics-fx', safe);
  },

  /** Display: subscribe to empty-lyrics FX settings. */
  onEmptyLyricsFx: (callback) => {
    const handler = (_event, data) => {
      try {
        callback(data);
      } catch (e) {
        console.warn('onEmptyLyricsFx callback error', e);
      }
    };
    ipcRenderer.on('empty-lyrics-fx', handler);
    return () => ipcRenderer.removeListener('empty-lyrics-fx', handler);
  },

  // ── Visual presets (layout / postprocess / styles — not music) ───────
  listPresets: () => ipcRenderer.invoke('presets-list'),
  /** Display or controls: load preset JSON from disk */
  loadPresetFile: (name) => ipcRenderer.invoke('presets-load', name),
  /** Controls: save preset JSON to disk */
  savePresetFile: (name, preset) => {
    let safe = preset;
    try {
      safe = JSON.parse(JSON.stringify(preset ?? null));
    } catch (e) {
      return Promise.resolve({ ok: false, error: 'Failed to serialize preset' });
    }
    return ipcRenderer.invoke('presets-save', name, safe);
  },
  deletePresetFile: (name) => ipcRenderer.invoke('presets-delete', name),
  getDefaultPresetName: () => ipcRenderer.invoke('presets-default-name'),

  listPerformances: () => ipcRenderer.invoke('performances-list'),
  loadPerformanceFile: (name) => ipcRenderer.invoke('performances-load', name),
  savePerformanceFile: (name, body) => {
    let safe = body;
    try {
      safe = JSON.parse(JSON.stringify(body ?? null));
    } catch (e) {
      return Promise.resolve({ ok: false, error: 'Failed to serialize performance' });
    }
    return ipcRenderer.invoke('performances-save', name, safe);
  },
  deletePerformanceFile: (name) => ipcRenderer.invoke('performances-delete', name),

  sendMusicCommand: (command, payload) =>
    ipcRenderer.invoke('music-command', command, payload ?? null),

  notifyMusicReady: () => ipcRenderer.send('music-ready'),

  /** Workspace: Music init failed (no Music window to close). */
  notifyMusicClosed: () => ipcRenderer.send('music-closed-notify'),

  onMusicCommand: (callback) => {
    ipcRenderer.removeAllListeners('music-command');
    ipcRenderer.on('music-command', (_event, msg) => {
      try {
        callback(msg || {});
      } catch (e) {
        const requestId = msg && msg.requestId;
        if (requestId) {
          ipcRenderer.send('music-command-result', {
            requestId,
            result: { ok: false, error: String(e && e.message ? e.message : e) },
          });
        }
      }
    });
  },

  replyMusicCommand: (requestId, result) => {
    let safe;
    try {
      safe = JSON.parse(JSON.stringify(result ?? { ok: false, error: 'null result' }));
    } catch (e) {
      safe = { ok: false, error: 'Failed to serialize result: ' + (e && e.message ? e.message : e) };
    }
    if (typeof safe.ok !== 'boolean') {
      safe = { ok: false, error: 'Invalid result shape', raw: safe };
    }
    ipcRenderer.send('music-command-result', { requestId, result: safe });
  },

  publishMusicEvent: (payload) => {
    let safe = payload;
    try {
      safe = JSON.parse(JSON.stringify(payload ?? null));
    } catch (e) {
      console.warn('publishMusicEvent serialize failed', e);
      return;
    }
    ipcRenderer.send('music-event', safe);
  },

  onMusicEvent: (callback) => {
    const handler = (_event, data) => {
      try { callback(data); } catch (e) { console.warn('onMusicEvent', e); }
    };
    ipcRenderer.on('music-event', handler);
    return () => ipcRenderer.removeListener('music-event', handler);
  },

  publishShowState: (state) => {
    let safe = state;
    try {
      safe = JSON.parse(JSON.stringify(state ?? null));
    } catch (e) {
      console.warn('publishShowState serialize failed', e);
      return;
    }
    ipcRenderer.send('show-state', safe);
  },

  onShowState: (callback) => {
    const handler = (_event, data) => {
      try { callback(data); } catch (e) { console.warn('onShowState', e); }
    };
    ipcRenderer.on('show-state', handler);
    return () => ipcRenderer.removeListener('show-state', handler);
  },

  publishSceneUserEdit: (payload) => {
    let safe = payload;
    try {
      safe = JSON.parse(JSON.stringify(payload ?? null));
    } catch (e) {
      return;
    }
    ipcRenderer.send('scene-user-edit', safe);
  },

  onSceneUserEdit: (callback) => {
    const handler = (_event, data) => {
      try { callback(data); } catch (e) { console.warn('onSceneUserEdit', e); }
    };
    ipcRenderer.on('scene-user-edit', handler);
    return () => ipcRenderer.removeListener('scene-user-edit', handler);
  },

  publishSceneTransition: (payload) => {
    let safe = payload;
    try {
      safe = JSON.parse(JSON.stringify(payload ?? null));
    } catch (e) {
      return;
    }
    ipcRenderer.send('scene-transition', safe);
  },

  onSceneTransition: (callback) => {
    const handler = (_event, data) => {
      try { callback(data); } catch (e) { console.warn('onSceneTransition', e); }
    };
    ipcRenderer.on('scene-transition', handler);
    return () => ipcRenderer.removeListener('scene-transition', handler);
  },

  onMusicClosed: (callback) => {
    const handler = () => {
      try { callback(); } catch (e) { console.warn('onMusicClosed', e); }
    };
    ipcRenderer.on('music-closed', handler);
    return () => ipcRenderer.removeListener('music-closed', handler);
  },

  getSettings: () => ipcRenderer.invoke('settings-get'),
  setSettings: (patch) => ipcRenderer.invoke('settings-set', patch ?? {}),
  resetSettings: () => ipcRenderer.invoke('settings-reset'),

  /**
   * Native file picker for stage background image/video.
   * @param {'image'|'video'} [kind]
   * @returns {Promise<{ok:boolean, canceled?:boolean, path?:string, url?:string, name?:string}>}
   */
  openMediaFile: (kind) => ipcRenderer.invoke('open-media-file', kind || 'image'),

  /**
   * Workspace (later): application-menu actions.
   * @param {(name: string) => void} callback
   * @returns {() => void}
   */
  setWorkspaceFullscreen: (on) => ipcRenderer.invoke('workspace-fullscreen', !!on),
  setWorkspaceKiosk: (on) => ipcRenderer.invoke('workspace-kiosk', !!on),

  onWorkspaceCommand: (callback) => {
    const handler = (_event, name) => {
      try {
        callback(name);
      } catch (e) {
        console.warn('onWorkspaceCommand callback error', e);
      }
    };
    ipcRenderer.on('workspace-command', handler);
    return () => ipcRenderer.removeListener('workspace-command', handler);
  },
});
