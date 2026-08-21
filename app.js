const { app, BrowserWindow, screen, ipcMain, protocol, Menu, dialog } = require('electron');
const path = require('path');
const { randomUUID } = require('crypto');
const musicLibrary = require('./src/main/music-library');
const presets = require('./src/main/presets');
const performances = require('./src/main/performances');
const userSettings = require('./src/main/user-settings');

// Must be registered before app is ready (for streaming local audio)
const MEDIA_SCHEME_PRIVILEGES = {
  standard: true,
  secure: true,
  supportFetchAPI: true,
  stream: true,
  bypassCSP: true,
  corsEnabled: true,
};

protocol.registerSchemesAsPrivileged([
  { scheme: 'song', privileges: MEDIA_SCHEME_PRIVILEGES },
  { scheme: 'media', privileges: MEDIA_SCHEME_PRIVILEGES },
]);

app.commandLine.appendSwitch('ignore-gpu-blacklist');
app.commandLine.appendSwitch('enable-webgl');
app.commandLine.appendSwitch('enable-accelerated-2d-canvas');

/** @type {BrowserWindow | null} */
let displayWin = null;
/** @type {BrowserWindow | null} */
let workspaceWin = null;
/** @type {BrowserWindow | null} */
let controlWin = null;
/** @type {BrowserWindow | null} */
let musicWin = null;
/** @type {BrowserWindow | null} */
let performanceWin = null;

/** Display page has registered its command listener */
let displayReady = false;
/** Music page has registered its command listener */
let musicReady = false;

/** @type {Map<string, { resolve: Function, timer: NodeJS.Timeout }>} */
const pendingCommands = new Map();
/** @type {Map<string, { resolve: Function, timer: NodeJS.Timeout }>} */
const pendingMusicCommands = new Map();

function preloadPath() {
  return path.join(__dirname, 'preload.js');
}

function bindDisplayHost(win) {
  displayReady = false;
  displayWin = win;
  win.on('closed', () => {
    if (workspaceWin === win) workspaceWin = null;
    displayWin = null;
    displayReady = false;
    for (const [id, entry] of pendingCommands) {
      clearTimeout(entry.timer);
      entry.resolve({ ok: false, error: 'Display window closed' });
      pendingCommands.delete(id);
    }
    if (controlWin && !controlWin.isDestroyed()) controlWin.close();
    if (musicWin && !musicWin.isDestroyed()) musicWin.close();
    if (performanceWin && !performanceWin.isDestroyed()) performanceWin.close();
  });
  win.webContents.on('did-start-loading', () => {
    displayReady = false;
  });
  return win;
}

let persistBoundsTimer = null;
function persistWorkspaceBounds() {
  if (!workspaceWin || workspaceWin.isDestroyed()) return;
  if (workspaceWin.isMaximized() || workspaceWin.isFullScreen()) return;
  const [x, y] = workspaceWin.getPosition();
  const [width, height] = workspaceWin.getSize();
  userSettings.set(userDataDir(), {
    window: { x, y, width, height, maximized: false },
  });
}

function schedulePersistWorkspaceBounds() {
  if (persistBoundsTimer) clearTimeout(persistBoundsTimer);
  persistBoundsTimer = setTimeout(persistWorkspaceBounds, 400);
}

function createWorkspaceWindow() {
  const work = screen.getPrimaryDisplay().workArea;
  const settings = userSettings.load(userDataDir());
  const winCfg = settings.window || {};
  const width = Math.max(1024, Math.min(work.width, winCfg.width || 1600));
  const height = Math.max(640, Math.min(work.height, winCfg.height || 1000));
  const x = winCfg.x == null ? work.x : winCfg.x;
  const y = winCfg.y == null ? work.y : winCfg.y;

  workspaceWin = new BrowserWindow({
    width,
    height,
    x,
    y,
    minWidth: 1024,
    minHeight: 640,
    resizable: true,
    title: 'music_view',
    fullscreenable: true,
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });

  workspaceWin.loadFile('workspace.html');
  bindDisplayHost(workspaceWin);
  if (winCfg.maximized !== false) workspaceWin.maximize();
  workspaceWin.on('move', schedulePersistWorkspaceBounds);
  workspaceWin.on('resize', schedulePersistWorkspaceBounds);
  workspaceWin.on('maximize', () => {
    userSettings.set(userDataDir(), { window: { maximized: true } });
  });
  workspaceWin.on('unmaximize', () => {
    userSettings.set(userDataDir(), { window: { maximized: false } });
    persistWorkspaceBounds();
  });
  return workspaceWin;
}

function createWindows() {
  createWorkspaceWindow();
}

function userDataDir() {
  return app.getPath('userData');
}

function sendWorkspaceCommand(name) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('workspace-command', name);
  }
}

/** PR 1 skeleton. View items broadcast workspace-command; layout apply is later PRs. */
function installApplicationMenu() {
  const isMac = process.platform === 'darwin';
  const stub = { enabled: false };
  const template = [
    ...(isMac
      ? [{
          label: app.name,
          submenu: [
            { label: 'About music_view', enabled: false },
            { type: 'separator' },
            { role: 'hide' },
            { role: 'hideOthers' },
            { role: 'unhide' },
            { type: 'separator' },
            { role: 'quit' },
          ],
        }]
      : []),
    {
      label: 'File',
      submenu: [
        { label: 'Load Look…', ...stub },
        { label: 'Save Look', ...stub },
        { type: 'separator' },
        { label: 'New Performance', ...stub },
        { label: 'Open Performance…', ...stub },
        { label: 'Save Performance', ...stub },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        ...(isMac ? [{ role: 'pasteAndMatchStyle' }, { role: 'delete' }, { role: 'selectAll' }] : [
          { role: 'delete' },
          { type: 'separator' },
          { role: 'selectAll' },
        ]),
      ],
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Present Stage',
          accelerator: 'CmdOrCtrl+Shift+P',
          click: () => sendWorkspaceCommand('present'),
        },
        {
          label: 'Fullscreen Stage',
          accelerator: isMac ? 'Cmd+Ctrl+F' : 'F11',
          click: () => sendWorkspaceCommand('fullscreen'),
        },
        {
          label: 'Toggle Docks',
          click: () => sendWorkspaceCommand('toggle-docks'),
        },
        {
          label: 'Reset Layout',
          click: () => {
            userSettings.reset(userDataDir());
            sendWorkspaceCommand('reset-layout');
          },
        },
        {
          label: 'Kiosk',
          click: () => sendWorkspaceCommand('kiosk'),
        },
      ],
    },
    {
      label: 'Playback',
      submenu: [
        { label: 'Play/Pause', enabled: false },
        { label: 'Stop', enabled: false },
      ],
    },
    {
      label: 'Show',
      submenu: [
        { label: 'Go', enabled: false },
        { label: 'Skip', enabled: false },
        { label: 'Previous', enabled: false },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function failPending(requestId, error) {
  const entry = pendingCommands.get(requestId);
  if (!entry) return;
  clearTimeout(entry.timer);
  pendingCommands.delete(requestId);
  entry.resolve({ ok: false, error });
}

/**
 * Send a command to the display and wait for display-command-result.
 * Retries a few times if the display is not ready yet.
 */
function sendDisplayCommand(command, payload, { timeoutMs = 8000, retries = 12 } = {}) {
  return new Promise((resolve) => {
    if (!displayWin || displayWin.isDestroyed()) {
      resolve({ ok: false, error: 'Display window is not available' });
      return;
    }

    const attempt = (left) => {
      if (!displayWin || displayWin.isDestroyed()) {
        resolve({ ok: false, error: 'Display window is not available' });
        return;
      }

      if (!displayReady) {
        if (left <= 0) {
          resolve({ ok: false, error: 'Display is not ready (command handler not registered)' });
          return;
        }
        setTimeout(() => attempt(left - 1), 250);
        return;
      }

      const requestId = randomUUID();
      const timer = setTimeout(() => {
        failPending(requestId, `Command timed out: ${command}`);
      }, timeoutMs);

      pendingCommands.set(requestId, {
        resolve: (result) => resolve(result),
        timer,
      });

      try {
        displayWin.webContents.send('display-command', {
          requestId,
          command,
          payload: payload ?? null,
        });
      } catch (e) {
        failPending(requestId, String(e && e.message ? e.message : e));
      }
    };

    attempt(retries);
  });
}

// ── IPC bridge: controls ↔ display ──────────────────────────────────────

ipcMain.handle('get-window-role', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (workspaceWin && win === workspaceWin) return 'workspace';
  if (win === displayWin) return 'display';
  if (win === controlWin) return 'controls';
  if (win === musicWin) return 'music';
  if (win === performanceWin) return 'performance';
  return 'unknown';
});

ipcMain.handle('settings-get', () => userSettings.load(userDataDir()));

ipcMain.handle('settings-set', (_event, patch) => userSettings.set(userDataDir(), patch));

ipcMain.handle('settings-reset', () => userSettings.reset(userDataDir()));

ipcMain.handle('workspace-fullscreen', (_event, on) => {
  if (!workspaceWin || workspaceWin.isDestroyed()) return { ok: false };
  workspaceWin.setFullScreen(!!on);
  return { ok: true, fullScreen: workspaceWin.isFullScreen() };
});

ipcMain.handle('open-media-file', async (event, kind) => {
  const win = BrowserWindow.fromWebContents(event.sender)
    || workspaceWin
    || displayWin;
  const isVideo = kind === 'video';
  const result = await dialog.showOpenDialog(win || undefined, {
    title: isVideo ? 'Choose background video' : 'Choose background image',
    properties: ['openFile'],
    filters: isVideo
      ? [
          { name: 'Videos', extensions: ['mp4', 'webm', 'mov', 'm4v', 'ogv', 'mkv'] },
          { name: 'All files', extensions: ['*'] },
        ]
      : [
          { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg'] },
          { name: 'All files', extensions: ['*'] },
        ],
  });
  if (result.canceled || !result.filePaths || !result.filePaths[0]) {
    return { ok: false, canceled: true };
  }
  const filePath = result.filePaths[0];
  return {
    ok: true,
    path: filePath,
    url: pathToMediaUrl(filePath),
    name: path.basename(filePath),
  };
});

ipcMain.handle('workspace-kiosk', (_event, on) => {
  if (!workspaceWin || workspaceWin.isDestroyed()) return { ok: false };
  workspaceWin.setFullScreen(!!on);
  workspaceWin.setAutoHideMenuBar(!!on);
  if (!on) workspaceWin.setMenuBarVisibility(true);
  return { ok: true, fullScreen: workspaceWin.isFullScreen() };
});

// ── Music library IPC ───────────────────────────────────────────────────

ipcMain.handle('music-list-songs', async () => {
  return musicLibrary.listSongs();
});

ipcMain.handle('music-load-lyrics', async (_event, lyricsPath) => {
  // Only allow reading .lrc under the songs directory
  if (!lyricsPath || typeof lyricsPath !== 'string') {
    return { ok: false, error: 'Invalid lyrics path', meta: {}, lines: [] };
  }
  const dir = musicLibrary.resolveSongsDir();
  const resolved = path.resolve(lyricsPath);
  if (!resolved.startsWith(path.resolve(dir) + path.sep) && resolved !== path.resolve(dir)) {
    return { ok: false, error: 'Lyrics path outside songs directory', meta: {}, lines: [] };
  }
  if (!resolved.toLowerCase().endsWith('.lrc')) {
    return { ok: false, error: 'Not an .lrc file', meta: {}, lines: [] };
  }
  return musicLibrary.loadLyrics(resolved);
});

ipcMain.handle('music-load-song', async (_event, songPath) => {
  if (!songPath || typeof songPath !== 'string') {
    return { ok: false, error: 'Invalid song path' };
  }
  const dir = musicLibrary.resolveSongsDir();
  const resolved = path.resolve(songPath);
  if (!resolved.startsWith(path.resolve(dir) + path.sep)) {
    return { ok: false, error: 'Song path outside songs directory' };
  }
  return musicLibrary.loadSongBundle(resolved);
});

ipcMain.handle('music-get-cover', async (_event, songPath) => {
  if (!songPath || typeof songPath !== 'string') {
    return { ok: false, error: 'Invalid song path' };
  }
  const dir = musicLibrary.resolveSongsDir();
  const resolved = path.resolve(songPath);
  if (!resolved.startsWith(path.resolve(dir) + path.sep)) {
    return { ok: false, error: 'Song path outside songs directory' };
  }
  return musicLibrary.extractCoverArt(resolved);
});

ipcMain.handle('music-get-display-info', async (_event, songPath) => {
  if (!songPath || typeof songPath !== 'string') {
    return { ok: false, error: 'Invalid song path' };
  }
  const dir = musicLibrary.resolveSongsDir();
  const resolved = path.resolve(songPath);
  if (!resolved.startsWith(path.resolve(dir) + path.sep)) {
    return { ok: false, error: 'Song path outside songs directory' };
  }
  return musicLibrary.extractSongDisplayInfo(resolved);
});

/** Music window → main → display: selected track for song panels */
function isMusicHost(win) {
  return !!(win && (win === musicWin || win === workspaceWin));
}

function musicHostWin() {
  if (musicWin && !musicWin.isDestroyed()) return musicWin;
  if (workspaceWin && !workspaceWin.isDestroyed()) return workspaceWin;
  return null;
}

function sendToWorkspace(channel, payload) {
  const dest = (workspaceWin && !workspaceWin.isDestroyed())
    ? workspaceWin
    : (displayWin && !displayWin.isDestroyed() ? displayWin : null);
  if (dest) dest.webContents.send(channel, payload);
}

ipcMain.on('now-playing', (event, payload) => {
  const sender = BrowserWindow.fromWebContents(event.sender);
  if (!isMusicHost(sender)) return;
  if (displayWin && !displayWin.isDestroyed()) {
    displayWin.webContents.send('now-playing', payload);
  }
  if (performanceWin && !performanceWin.isDestroyed()) {
    performanceWin.webContents.send('now-playing', payload);
  }
});

/** Music window → main → display: focused lyric lines */
ipcMain.on('lyric-focus', (event, payload) => {
  const sender = BrowserWindow.fromWebContents(event.sender);
  if (!isMusicHost(sender)) return;
  if (displayWin && !displayWin.isDestroyed()) {
    displayWin.webContents.send('lyric-focus', payload);
  }
});

/** Music window → main → display + performance: playback progress (UI-only for conductor) */
ipcMain.on('playback-progress', (event, payload) => {
  const sender = BrowserWindow.fromWebContents(event.sender);
  if (!isMusicHost(sender)) return;
  if (displayWin && !displayWin.isDestroyed()) {
    displayWin.webContents.send('playback-progress', payload);
  }
  if (performanceWin && !performanceWin.isDestroyed()) {
    performanceWin.webContents.send('playback-progress', payload);
  }
});

/** Music window → main → display: live audio analysis (waveform + beat) */
ipcMain.on('audio-frame', (event, payload) => {
  const sender = BrowserWindow.fromWebContents(event.sender);
  if (!isMusicHost(sender)) return;
  if (displayWin && !displayWin.isDestroyed()) {
    displayWin.webContents.send('audio-frame', payload);
  }
});

/** Music window → main → display: empty-lyrics glitch FX settings */
ipcMain.on('empty-lyrics-fx', (event, payload) => {
  const sender = BrowserWindow.fromWebContents(event.sender);
  if (!isMusicHost(sender)) return;
  if (displayWin && !displayWin.isDestroyed()) {
    displayWin.webContents.send('empty-lyrics-fx', payload);
  }
});

/**
 * Stream local audio with Accept-Ranges / 206 Partial Content so HTMLAudioElement
 * can seek. A plain net.fetch(fileURL) often cannot satisfy Range requests, which
 * makes currentTime seeks jump back to 0.
 */
function pathToMediaUrl(filePath) {
  const normalized = String(filePath || '').replace(/\\/g, '/');
  const withSlash = normalized.startsWith('/') ? normalized : `/${normalized}`;
  return `media://local${encodeURI(withSlash)}`;
}

function resolveCustomFileUrl(requestUrl, schemeHost) {
  const u = new URL(requestUrl);
  let filePath = decodeURIComponent(u.pathname || '');
  if (u.hostname && u.hostname !== schemeHost) {
    filePath = '/' + u.hostname + filePath;
  }
  if (process.platform === 'win32') {
    if (filePath.startsWith('/')) filePath = filePath.slice(1);
  } else if (!filePath.startsWith('/')) {
    filePath = '/' + filePath;
  }
  return path.resolve(filePath);
}

const MEDIA_EXT_OK = new Set([
  '.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.svg',
  '.mp4', '.webm', '.mov', '.m4v', '.ogv', '.mkv',
]);

function registerFileProtocols() {
  const fs = require('fs');
  const { Readable } = require('stream');

  const mimeFor = (filePath) => {
    const ext = path.extname(filePath).toLowerCase();
    const map = {
      '.mp3': 'audio/mpeg',
      '.wav': 'audio/wav',
      '.flac': 'audio/flac',
      '.m4a': 'audio/mp4',
      '.aac': 'audio/aac',
      '.ogg': 'audio/ogg',
      '.opus': 'audio/ogg',
      '.aiff': 'audio/aiff',
      '.aif': 'audio/aiff',
      '.wma': 'audio/x-ms-wma',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.webp': 'image/webp',
      '.gif': 'image/gif',
      '.bmp': 'image/bmp',
      '.svg': 'image/svg+xml',
      '.mp4': 'video/mp4',
      '.m4v': 'video/mp4',
      '.webm': 'video/webm',
      '.mov': 'video/quicktime',
      '.ogv': 'video/ogg',
      '.mkv': 'video/x-matroska',
    };
    return map[ext] || 'application/octet-stream';
  };

  const streamFileResponse = async (request, resolved) => {
    const stat = await fs.promises.stat(resolved);
    if (!stat.isFile()) {
      return new Response('Not found', { status: 404 });
    }

    const size = stat.size;
    const mime = mimeFor(resolved);
    const rangeHeader = request.headers.get('range') || request.headers.get('Range');

    if (rangeHeader) {
      const m = /bytes=(\d*)-(\d*)/i.exec(rangeHeader);
      if (!m) {
        return new Response('Invalid Range', { status: 416 });
      }
      let start = m[1] !== '' ? parseInt(m[1], 10) : 0;
      let end = m[2] !== '' ? parseInt(m[2], 10) : size - 1;
      if (!Number.isFinite(start) || start < 0) start = 0;
      if (!Number.isFinite(end) || end >= size) end = size - 1;
      if (start > end || start >= size) {
        return new Response('Range Not Satisfiable', {
          status: 416,
          headers: { 'Content-Range': `bytes */${size}` },
        });
      }

      const chunkSize = end - start + 1;
      const nodeStream = fs.createReadStream(resolved, { start, end });
      const webStream = Readable.toWeb(nodeStream);

      return new Response(webStream, {
        status: 206,
        headers: {
          'Content-Type': mime,
          'Content-Length': String(chunkSize),
          'Content-Range': `bytes ${start}-${end}/${size}`,
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'no-cache',
        },
      });
    }

    const nodeStream = fs.createReadStream(resolved);
    const webStream = Readable.toWeb(nodeStream);
    return new Response(webStream, {
      status: 200,
      headers: {
        'Content-Type': mime,
        'Content-Length': String(size),
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-cache',
      },
    });
  };

  const resolveSongPath = (requestUrl) => {
    const u = new URL(requestUrl);
    let filePath = decodeURIComponent(u.pathname || '');
    if (u.hostname && u.hostname !== 'local') {
      filePath = '/' + u.hostname + filePath;
    }
    if (!filePath.startsWith('/')) filePath = '/' + filePath;

    const dir = path.resolve(musicLibrary.resolveSongsDir());
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(dir + path.sep)) {
      return null;
    }
    return resolved;
  };

  // song://local/Volumes/ARCHIVE/.../track.mp3
  protocol.handle('song', async (request) => {
    try {
      const resolved = resolveSongPath(request.url);
      if (!resolved) {
        return new Response('Forbidden', { status: 403 });
      }
      return await streamFileResponse(request, resolved);
    } catch (e) {
      return new Response(String(e && e.message ? e.message : e), { status: 500 });
    }
  });

  // media://local/Volumes/.../photo.jpg — user-picked background image/video
  protocol.handle('media', async (request) => {
    try {
      const resolved = resolveCustomFileUrl(request.url, 'local');
      if (!resolved) {
        return new Response('Forbidden', { status: 403 });
      }
      const ext = path.extname(resolved).toLowerCase();
      if (!MEDIA_EXT_OK.has(ext)) {
        return new Response('Unsupported media type', { status: 415 });
      }
      return await streamFileResponse(request, resolved);
    } catch (e) {
      return new Response(String(e && e.message ? e.message : e), { status: 500 });
    }
  });
}

ipcMain.on('display-ready', (event) => {
  const sender = BrowserWindow.fromWebContents(event.sender);
  if (sender === displayWin) {
    displayReady = true;
  }
});

ipcMain.handle('control-command', async (_event, command, payload) => {
  return sendDisplayCommand(command, payload);
});

// ── Visual presets (JSON under ./presets/) ───────────────────────────────

ipcMain.handle('presets-list', async () => {
  return presets.listPresets();
});

ipcMain.handle('presets-load', async (_event, name) => {
  return presets.loadPreset(name);
});

ipcMain.handle('presets-save', async (_event, name, presetBody) => {
  return presets.savePreset(name, presetBody);
});

ipcMain.handle('presets-delete', async (_event, name) => {
  return presets.deletePreset(name);
});

ipcMain.handle('presets-default-name', async () => {
  return { ok: true, name: presets.DEFAULT_NAME };
});

ipcMain.handle('performances-list', async () => {
  return performances.listPerformances();
});

ipcMain.handle('performances-load', async (_event, name) => {
  return performances.loadPerformance(name);
});

ipcMain.handle('performances-save', async (_event, name, body) => {
  return performances.savePerformance(name, body);
});

ipcMain.handle('performances-delete', async (_event, name) => {
  return performances.deletePerformance(name);
});

function failPendingMusic(requestId, error) {
  const entry = pendingMusicCommands.get(requestId);
  if (!entry) return;
  clearTimeout(entry.timer);
  pendingMusicCommands.delete(requestId);
  entry.resolve({ ok: false, error });
}

function sendMusicCommand(command, payload, { timeoutMs = 8000, retries = 12 } = {}) {
  return new Promise((resolve) => {
    const host = musicHostWin();
    if (!host) {
      resolve({ ok: false, error: 'Music window is not available' });
      return;
    }
    const attempt = (left) => {
      const live = musicHostWin();
      if (!live) {
        resolve({ ok: false, error: 'Music window is not available' });
        return;
      }
      if (!musicReady) {
        if (left <= 0) {
          resolve({ ok: false, error: 'Music is not ready (command handler not registered)' });
          return;
        }
        setTimeout(() => attempt(left - 1), 250);
        return;
      }
      const requestId = randomUUID();
      const timer = setTimeout(() => {
        failPendingMusic(requestId, `Music command timed out: ${command}`);
      }, timeoutMs);
      pendingMusicCommands.set(requestId, {
        resolve: (result) => resolve(result),
        timer,
      });
      try {
        live.webContents.send('music-command', {
          requestId,
          command,
          payload: payload ?? null,
        });
      } catch (e) {
        failPendingMusic(requestId, String(e && e.message ? e.message : e));
      }
    };
    attempt(retries);
  });
}

ipcMain.handle('music-command', async (event, command, payload) => {
  const sender = BrowserWindow.fromWebContents(event.sender);
  if (sender !== performanceWin && !isMusicHost(sender)) {
    return { ok: false, error: 'music-command not allowed from this window' };
  }
  const long = command === 'prepareShow' || command === 'loadDeck' || command === 'preloadDeck';
  return sendMusicCommand(command, payload, { timeoutMs: long ? 25000 : 8000 });
});

ipcMain.on('music-ready', (event) => {
  const sender = BrowserWindow.fromWebContents(event.sender);
  if (isMusicHost(sender)) musicReady = true;
});

ipcMain.on('music-closed-notify', (event) => {
  const sender = BrowserWindow.fromWebContents(event.sender);
  if (!isMusicHost(sender)) return;
  const dest = (performanceWin && !performanceWin.isDestroyed())
    ? performanceWin
    : (workspaceWin && !workspaceWin.isDestroyed() ? workspaceWin : null);
  if (dest) dest.webContents.send('music-closed');
});

ipcMain.on('music-command-result', (event, msg) => {
  const sender = BrowserWindow.fromWebContents(event.sender);
  if (!isMusicHost(sender)) return;
  if (!msg || !msg.requestId) return;
  const entry = pendingMusicCommands.get(msg.requestId);
  if (!entry) return;
  clearTimeout(entry.timer);
  pendingMusicCommands.delete(msg.requestId);
  const result = msg.result;
  if (!result || typeof result !== 'object') {
    entry.resolve({ ok: false, error: 'Empty or invalid result from music' });
    return;
  }
  entry.resolve(result);
});

ipcMain.on('music-event', (event, payload) => {
  const sender = BrowserWindow.fromWebContents(event.sender);
  if (!isMusicHost(sender)) return;
  if (performanceWin && !performanceWin.isDestroyed()) {
    performanceWin.webContents.send('music-event', payload);
  } else {
    sendToWorkspace('music-event', payload);
  }
});

ipcMain.on('show-state', (event, payload) => {
  const sender = BrowserWindow.fromWebContents(event.sender);
  if (sender !== performanceWin && sender !== workspaceWin && sender !== displayWin) return;
  if (displayWin && !displayWin.isDestroyed() && displayWin !== workspaceWin) {
    displayWin.webContents.send('show-state', payload);
  }
  if (controlWin && !controlWin.isDestroyed()) {
    controlWin.webContents.send('show-state', payload);
  }
  if (musicWin && !musicWin.isDestroyed()) {
    musicWin.webContents.send('show-state', payload);
  }
  sendToWorkspace('show-state', payload);
});

ipcMain.on('scene-user-edit', (event, payload) => {
  const sender = BrowserWindow.fromWebContents(event.sender);
  if (sender !== displayWin && sender !== workspaceWin) return;
  if (performanceWin && !performanceWin.isDestroyed()) {
    performanceWin.webContents.send('scene-user-edit', payload);
  } else {
    sendToWorkspace('scene-user-edit', payload);
  }
});

ipcMain.on('scene-transition', (event, payload) => {
  const sender = BrowserWindow.fromWebContents(event.sender);
  if (sender !== displayWin && sender !== workspaceWin) return;
  if (performanceWin && !performanceWin.isDestroyed()) {
    performanceWin.webContents.send('scene-transition', payload);
  } else {
    sendToWorkspace('scene-transition', payload);
  }
});

ipcMain.on('display-command-result', (event, msg) => {
  const sender = BrowserWindow.fromWebContents(event.sender);
  if (sender !== displayWin) return;
  if (!msg || !msg.requestId) return;

  const entry = pendingCommands.get(msg.requestId);
  if (!entry) return;

  clearTimeout(entry.timer);
  pendingCommands.delete(msg.requestId);

  const result = msg.result;
  if (!result || typeof result !== 'object') {
    entry.resolve({ ok: false, error: 'Empty or invalid result from display' });
    return;
  }
  entry.resolve(result);
});

ipcMain.on('publish-state', (event, state) => {
  const sender = BrowserWindow.fromWebContents(event.sender);
  if (sender !== displayWin && sender !== workspaceWin) return;
  if (controlWin && !controlWin.isDestroyed()) {
    controlWin.webContents.send('state-update', state);
  } else {
    sendToWorkspace('state-update', state);
  }
});

ipcMain.handle('request-state', async () => {
  const result = await sendDisplayCommand('getState', null);
  return result && result.ok ? result.state : null;
});

app.whenReady().then(() => {
  registerFileProtocols();
  installApplicationMenu();
  createWindows();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindows();
  }
});
