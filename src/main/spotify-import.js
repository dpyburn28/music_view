/**
 * Import a Spotify track URL into the local songs directory.
 * Resolves public metadata, fetches LRCLIB lyrics, and downloads a matching
 * recording with yt-dlp (not Spotify's own streams).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const musicLibrary = require('./music-library');

const APP_UA = 'music_view/0.1.0 (local music library)';
const SPOTIFY_ID_RE = /^[A-Za-z0-9]{16,32}$/;
const FETCH_MS = 20000;
const DOWNLOAD_MS = 180000;
const EXTRA_BIN_DIRS = [
  '/opt/homebrew/bin',
  '/opt/homebrew/sbin',
  '/usr/local/bin',
  '/usr/bin',
];

const BINARY_HINT =
  'Install ffmpeg (e.g. brew install ffmpeg) to import audio.';
/** Refuse Homebrew-era yt-dlp that YouTube now blocks with "Please sign in". */
const MIN_YTDLP_VERSION = 20260101;
const YTDLP_RELEASE = {
  darwin: 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos',
  win32: 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe',
  linux: 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp',
};

let importLock = null;

function withTimeout(ms, label) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return {
    signal: ctrl.signal,
    clear: () => clearTimeout(timer),
    error: () => new Error(label + ' timed out'),
  };
}

function extraEnv() {
  const parts = String(process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const dir of EXTRA_BIN_DIRS) {
    if (!parts.includes(dir)) parts.unshift(dir);
  }
  return Object.assign({}, process.env, { PATH: parts.join(path.delimiter) });
}

function findBinary(name) {
  try {
    const r = spawnSync('which', [name], { env: extraEnv(), encoding: 'utf8' });
    if (r.status === 0 && r.stdout && r.stdout.trim()) {
      return r.stdout.trim().split(/\r?\n/)[0];
    }
  } catch (_) { /* fall through */ }
  for (const dir of EXTRA_BIN_DIRS) {
    const candidate = path.join(dir, name);
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch (_) { /* try next */ }
  }
  return null;
}

function defaultCacheDir() {
  return path.join(os.homedir(), '.music_view', 'bin');
}

function cachedYtdlpPath(cacheDir) {
  const dir = cacheDir || defaultCacheDir();
  return path.join(dir, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
}

function parseYtdlpVersion(raw) {
  const m = String(raw || '').match(/(\d{4})\.(\d{1,2})\.(\d{1,2})/);
  if (!m) return 0;
  return Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3]);
}

function isYtdlpCurrent(raw) {
  return parseYtdlpVersion(raw) >= MIN_YTDLP_VERSION;
}

function readYtdlpVersion(bin) {
  if (!bin) return '';
  try {
    const r = spawnSync(bin, ['--version'], { env: extraEnv(), encoding: 'utf8', timeout: 25000 });
    return String((r.stdout || r.stderr || '')).trim().split(/\r?\n/)[0] || '';
  } catch (_) {
    return '';
  }
}

function ytdlpReleaseUrl(platform) {
  return YTDLP_RELEASE[platform || process.platform] || YTDLP_RELEASE.linux;
}

function isSignInError(text) {
  return /please sign in|sign in to confirm|not a bot|use --cookies/i.test(String(text || ''));
}

function cookieBrowserCandidates() {
  // Safari cookies need Full Disk Access on macOS; skip unless the user grants it later.
  if (process.platform === 'darwin') return ['chrome', 'brave', 'edge', 'chromium', 'firefox'];
  if (process.platform === 'win32') return ['chrome', 'edge', 'firefox', 'brave'];
  return ['chrome', 'chromium', 'firefox', 'brave', 'edge'];
}

function probeTools(opts) {
  const cacheDir = (opts && opts.cacheDir) || defaultCacheDir();
  const ffmpeg = findBinary('ffmpeg');
  const system = findBinary('yt-dlp');
  const cached = cachedYtdlpPath(cacheDir);
  const cachedExists = (() => {
    try { return fs.existsSync(cached); } catch (_) { return false; }
  })();
  const systemVer = system ? readYtdlpVersion(system) : '';
  const cachedVer = cachedExists ? readYtdlpVersion(cached) : '';
  let ytdlp = null;
  let ytdlpVersion = '';
  if (cachedExists && isYtdlpCurrent(cachedVer)) {
    ytdlp = cached;
    ytdlpVersion = cachedVer;
  } else if (system && isYtdlpCurrent(systemVer)) {
    ytdlp = system;
    ytdlpVersion = systemVer;
  } else if (cachedExists) {
    ytdlp = cached;
    ytdlpVersion = cachedVer;
  } else if (system) {
    ytdlp = system;
    ytdlpVersion = systemVer;
  }
  return {
    ytdlp,
    ffmpeg,
    ytdlpVersion,
    ytdlpStale: !isYtdlpCurrent(ytdlpVersion),
    ok: !!ffmpeg,
    hint: ffmpeg ? '' : BINARY_HINT,
  };
}

async function downloadLatestYtdlp(dest, onProgress) {
  const url = ytdlpReleaseUrl();
  if (onProgress) onProgress({ stage: 'tools', message: 'Updating download helper…' });
  const dir = path.dirname(dest);
  fs.mkdirSync(dir, { recursive: true });
  const gate = withTimeout(120000, 'yt-dlp update');
  let res;
  try {
    res = await fetch(url, {
      signal: gate.signal,
      headers: { 'User-Agent': APP_UA, Accept: 'application/octet-stream' },
      redirect: 'follow',
    });
  } finally {
    gate.clear();
  }
  if (!res.ok) {
    return { ok: false, error: 'Could not download a current yt-dlp (' + res.status + ')' };
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 500000) {
    return { ok: false, error: 'yt-dlp download looked too small — try again later' };
  }
  const tmp = dest + '.tmp';
  fs.writeFileSync(tmp, buf);
  try { fs.chmodSync(tmp, 0o755); } catch (_) { /* windows */ }
  fs.renameSync(tmp, dest);
  const ver = readYtdlpVersion(dest);
  if (!isYtdlpCurrent(ver)) {
    return { ok: false, error: 'Downloaded yt-dlp still looks outdated (' + (ver || 'unknown') + ')' };
  }
  return { ok: true, path: dest, version: ver };
}

async function ensureYtdlp(opts) {
  const cacheDir = (opts && opts.cacheDir) || defaultCacheDir();
  const onProgress = opts && opts.onProgress;
  const tools = probeTools({ cacheDir });
  if (tools.ytdlp && !tools.ytdlpStale) {
    return { ok: true, ytdlp: tools.ytdlp, ffmpeg: tools.ffmpeg, version: tools.ytdlpVersion };
  }
  if (!tools.ffmpeg) {
    return { ok: false, error: 'ffmpeg is not installed. ' + BINARY_HINT };
  }
  const dest = cachedYtdlpPath(cacheDir);
  const got = await downloadLatestYtdlp(dest, onProgress);
  if (!got.ok) {
    if (tools.ytdlp) {
      return {
        ok: true,
        ytdlp: tools.ytdlp,
        ffmpeg: tools.ffmpeg,
        version: tools.ytdlpVersion,
        stale: true,
      };
    }
    return got;
  }
  return { ok: true, ytdlp: got.path, ffmpeg: tools.ffmpeg, version: got.version };
}

function parseSpotifyInput(raw) {
  const text = String(raw || '').trim();
  if (!text) return { ok: false, error: 'Paste a Spotify track link' };

  const uri = text.match(/^spotify:track:([A-Za-z0-9]+)/i);
  if (uri) {
    const id = uri[1];
    if (!SPOTIFY_ID_RE.test(id)) return { ok: false, error: 'Invalid Spotify track id' };
    return {
      ok: true,
      type: 'track',
      id,
      url: 'https://open.spotify.com/track/' + id,
    };
  }

  const albumOrList = text.match(
    /(?:open\.)?spotify\.com\/(?:intl-[a-z]{2}\/)?(album|playlist|artist|episode|show)\//i,
  );
  if (albumOrList) {
    return {
      ok: false,
      error: 'Paste a single track link (open.spotify.com/track/…)',
    };
  }

  const track = text.match(
    /(?:open\.)?spotify\.com\/(?:intl-[a-z]{2}\/)?track\/([A-Za-z0-9]+)/i,
  );
  if (track) {
    const id = track[1];
    if (!SPOTIFY_ID_RE.test(id)) return { ok: false, error: 'Invalid Spotify track id' };
    return {
      ok: true,
      type: 'track',
      id,
      url: 'https://open.spotify.com/track/' + id,
    };
  }

  if (/spotify\.(link|fi)\//i.test(text) || /spotify\.app\.link\//i.test(text)) {
    return { ok: true, type: 'short', id: null, url: ensureHttps(text) };
  }

  return { ok: false, error: 'Not a Spotify track link' };
}

function ensureHttps(url) {
  const s = String(url || '').trim();
  if (/^https?:\/\//i.test(s)) return s;
  return 'https://' + s.replace(/^\/+/, '');
}

function sanitizeFilename(name) {
  let s = String(name || '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .replace(/\.+$/, '');
  if (s.length > 180) s = s.slice(0, 180).trim();
  return s;
}

function defaultBasename(artist, title) {
  const t = sanitizeFilename(title) || 'untitled';
  const a = sanitizeFilename(artist);
  return a ? `${a} - ${t}` : t;
}

function uniqueDest(dir, base, ext) {
  const e = ext.startsWith('.') ? ext : '.' + ext;
  let name = base + e;
  let n = 2;
  while (fs.existsSync(path.join(dir, name))) {
    name = `${base} (${n})${e}`;
    n += 1;
    if (n > 99) throw new Error('Could not pick a free filename');
  }
  return path.join(dir, name);
}

function formatLrcTime(sec) {
  const t = Math.max(0, Number(sec) || 0);
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  const whole = Math.floor(s);
  const cs = Math.round((s - whole) * 100);
  return `${String(m).padStart(2, '0')}:${String(whole).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

function stampPlainLyrics(plain, durationSec) {
  const lines = String(plain || '')
    .split(/\r?\n/)
    .map((row) => row.trim())
    .filter(Boolean);
  if (!lines.length) return '';
  const span = Math.max(2, (Number(durationSec) > 0 ? Number(durationSec) : 180) / lines.length);
  return lines.map((text, i) => `[${formatLrcTime(i * span)}] ${text}`).join('\n');
}

function buildLrc(meta) {
  const headers = [];
  if (meta.title) headers.push(`[ti:${meta.title}]`);
  if (meta.artist) headers.push(`[ar:${meta.artist}]`);
  if (meta.album) headers.push(`[al:${meta.album}]`);
  if (meta.duration > 0) headers.push(`[length:${formatLrcTime(meta.duration)}]`);
  headers.push('[re:music_view]');
  const synced = String(meta.synced || '').trim();
  if (synced) return headers.join('\n') + '\n' + synced.replace(/\s+$/, '') + '\n';
  const stamped = stampPlainLyrics(meta.plain, meta.duration);
  if (!stamped) return '';
  headers.push('[by:lrclib unsynced]');
  return headers.join('\n') + '\n' + stamped + '\n';
}

function normKey(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function scoreLrcHit(hit, want) {
  if (!hit) return -100;
  let score = 0;
  if (normKey(hit.trackName) === normKey(want.title)) score += 5;
  else if (normKey(hit.trackName).includes(normKey(want.title)) || normKey(want.title).includes(normKey(hit.trackName))) {
    score += 2;
  }
  if (normKey(hit.artistName) === normKey(want.artist)) score += 5;
  else if (normKey(hit.artistName).includes(normKey(want.artist)) || normKey(want.artist).includes(normKey(hit.artistName))) {
    score += 2;
  }
  if (hit.syncedLyrics) score += 3;
  else if (hit.plainLyrics) score += 1;
  if (want.duration > 0 && Number(hit.duration) > 0) {
    const d = Math.abs(Number(hit.duration) - want.duration);
    if (d <= 2) score += 4;
    else if (d <= 5) score += 2;
    else if (d > 25) score -= 3;
  }
  if (hit.instrumental && !hit.syncedLyrics && !hit.plainLyrics) score -= 4;
  return score;
}

function pickLrcHit(hits, want) {
  if (!Array.isArray(hits) || !hits.length) return null;
  let best = null;
  let bestScore = -50;
  for (const hit of hits) {
    const s = scoreLrcHit(hit, want);
    if (s > bestScore) {
      best = hit;
      bestScore = s;
    }
  }
  return bestScore >= 4 ? best : null;
}

function parseEmbedHtml(html) {
  const m = String(html || '').match(
    /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/,
  );
  if (!m) return null;
  let data;
  try {
    data = JSON.parse(m[1]);
  } catch (_) {
    return null;
  }
  const entity = data && data.props && data.props.pageProps
    && data.props.pageProps.state && data.props.pageProps.state.data
    && data.props.pageProps.state.data.entity;
  if (!entity || (entity.type && entity.type !== 'track')) return null;
  const artists = Array.isArray(entity.artists)
    ? entity.artists.map((a) => a && a.name).filter(Boolean)
    : [];
  const images = entity.visualIdentity && Array.isArray(entity.visualIdentity.image)
    ? entity.visualIdentity.image
    : [];
  const cover = images.slice().sort((a, b) => (b.maxWidth || 0) - (a.maxWidth || 0))[0];
  const durationMs = Number(entity.duration) || 0;
  return {
    id: entity.id || null,
    title: entity.name || entity.title || '',
    artist: artists.join(', '),
    album: entity.album && entity.album.name ? entity.album.name : '',
    duration: durationMs > 0 ? durationMs / 1000 : 0,
    coverUrl: cover && cover.url ? cover.url : '',
  };
}

function parseOembed(json) {
  if (!json || typeof json !== 'object') return null;
  const title = String(json.title || '').trim();
  if (!title) return null;
  return {
    title,
    artist: '',
    album: '',
    duration: 0,
    coverUrl: json.thumbnail_url || '',
  };
}

function parseSongLink(json) {
  if (!json || typeof json !== 'object') return null;
  const entities = json.entitiesByUniqueId || {};
  let spotify = null;
  for (const ent of Object.values(entities)) {
    if (ent && ent.apiProvider === 'spotify') {
      spotify = ent;
      break;
    }
  }
  const first = spotify || Object.values(entities)[0];
  if (!first) return null;
  const platforms = json.linksByPlatform || {};
  const yt = (platforms.youtube && platforms.youtube.url)
    || (platforms.youtubeMusic && platforms.youtubeMusic.url)
    || '';
  return {
    title: first.title || '',
    artist: first.artistName || '',
    album: '',
    duration: 0,
    coverUrl: first.thumbnailUrl || '',
    youtubeUrl: yt,
  };
}

async function fetchText(url, timeoutMs) {
  const gate = withTimeout(timeoutMs || FETCH_MS, 'Request');
  try {
    const res = await fetch(url, {
      signal: gate.signal,
      headers: { 'User-Agent': APP_UA, Accept: '*/*' },
      redirect: 'follow',
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, url: res.url, text };
  } catch (e) {
    if (e && e.name === 'AbortError') throw gate.error();
    throw e;
  } finally {
    gate.clear();
  }
}

async function fetchJson(url, timeoutMs) {
  const r = await fetchText(url, timeoutMs);
  let json = null;
  try {
    json = r.text ? JSON.parse(r.text) : null;
  } catch (_) {
    json = null;
  }
  return { ok: r.ok, status: r.status, url: r.url, json };
}

async function resolveShortUrl(url) {
  const r = await fetchText(url, FETCH_MS);
  const parsed = parseSpotifyInput(r.url || '');
  if (parsed.ok && parsed.type === 'track') return parsed;
  const href = (r.text || '').match(/https?:\/\/open\.spotify\.com\/(?:intl-[a-z]{2}\/)?track\/[A-Za-z0-9]+/i);
  if (href) {
    const again = parseSpotifyInput(href[0]);
    if (again.ok && again.type === 'track') return again;
  }
  return { ok: false, error: 'Could not resolve that Spotify short link to a track' };
}

async function resolveTrack(inputUrl, fetchImpl) {
  const getJson = fetchImpl && fetchImpl.json ? fetchImpl.json : fetchJson;
  const getText = fetchImpl && fetchImpl.text ? fetchImpl.text : fetchText;

  let parsed = parseSpotifyInput(inputUrl);
  if (!parsed.ok) return parsed;
  if (parsed.type === 'short') {
    parsed = await resolveShortUrl(parsed.url);
    if (!parsed.ok) return parsed;
  }

  const trackUrl = parsed.url;
  const embedUrl = 'https://open.spotify.com/embed/track/' + parsed.id;
  let meta = {
    id: parsed.id,
    url: trackUrl,
    title: '',
    artist: '',
    album: '',
    duration: 0,
    coverUrl: '',
    youtubeUrl: '',
  };

  try {
    const embed = await getText(embedUrl, FETCH_MS);
    const fromEmbed = parseEmbedHtml(embed && embed.text);
    if (fromEmbed) Object.assign(meta, fromEmbed, { id: parsed.id, url: trackUrl });
  } catch (_) { /* try other sources */ }

  if (!meta.title || !meta.artist) {
    try {
      const oembed = await getJson(
        'https://open.spotify.com/oembed?url=' + encodeURIComponent(trackUrl),
        FETCH_MS,
      );
      const fromOe = parseOembed(oembed && oembed.json);
      if (fromOe) {
        if (!meta.title) meta.title = fromOe.title;
        if (!meta.coverUrl) meta.coverUrl = fromOe.coverUrl;
      }
    } catch (_) { /* continue */ }
  }

  try {
    const sl = await getJson(
      'https://api.song.link/v1-alpha.1/links?url=' + encodeURIComponent(trackUrl) + '&userCountry=US',
      FETCH_MS,
    );
    const fromSl = parseSongLink(sl && sl.json);
    if (fromSl) {
      if (!meta.title) meta.title = fromSl.title;
      if (!meta.artist) meta.artist = fromSl.artist;
      if (!meta.coverUrl) meta.coverUrl = fromSl.coverUrl;
      if (fromSl.youtubeUrl) meta.youtubeUrl = fromSl.youtubeUrl;
    }
  } catch (_) { /* optional */ }

  if (!meta.title) {
    return { ok: false, error: 'Could not resolve that Spotify track' };
  }
  return { ok: true, meta };
}

async function fetchLyrics(meta, fetchImpl) {
  const getJson = fetchImpl && fetchImpl.json ? fetchImpl.json : fetchJson;
  const params = new URLSearchParams();
  if (meta.title) params.set('track_name', meta.title);
  if (meta.artist) params.set('artist_name', meta.artist);
  if (meta.album) params.set('album_name', meta.album);
  const searchUrl = 'https://lrclib.net/api/search?' + params.toString();
  let hits = [];
  try {
    const r = await getJson(searchUrl, FETCH_MS);
    if (r.ok && Array.isArray(r.json)) hits = r.json;
  } catch (_) {
    return { found: false, synced: false, text: '', error: 'Lyrics lookup failed' };
  }
  const hit = pickLrcHit(hits, meta);
  if (!hit) return { found: false, synced: false, text: '' };
  const body = buildLrc({
    title: hit.trackName || meta.title,
    artist: hit.artistName || meta.artist,
    album: hit.albumName || meta.album,
    duration: Number(hit.duration) || meta.duration,
    synced: hit.syncedLyrics,
    plain: hit.plainLyrics,
  });
  if (!body) return { found: false, synced: false, text: '' };
  return {
    found: true,
    synced: !!String(hit.syncedLyrics || '').trim(),
    text: body,
    source: 'lrclib',
  };
}

function spawnCaptured(bin, args, opts) {
  return new Promise((resolve) => {
    const child = spawn(bin, args, {
      env: extraEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      try { child.kill('SIGTERM'); } catch (_) { /* ignore */ }
    }, (opts && opts.timeoutMs) || DOWNLOAD_MS);
    child.stdout.on('data', (buf) => {
      const chunk = buf.toString();
      stdout += chunk;
      if (opts && opts.onStdout) opts.onStdout(chunk);
    });
    child.stderr.on('data', (buf) => {
      stderr += buf.toString();
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr, error: String(err && err.message ? err.message : err) });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code == null ? -1 : code, stdout, stderr });
    });
  });
}

function parseYtdlpPercent(chunk) {
  const m = String(chunk).match(/\[download\]\s+(\d+(?:\.\d+)?)%/);
  return m ? Number(m[1]) : null;
}

function parseSearchHits(text) {
  const hits = [];
  const seen = new Set();
  for (const line of String(text || '').split(/\r?\n/)) {
    const parts = line.split('\t');
    const id = (parts[0] || '').trim();
    if (!/^[A-Za-z0-9_-]{11}$/.test(id) || seen.has(id)) continue;
    seen.add(id);
    const duration = Number(parts[2]);
    hits.push({
      id,
      title: (parts[1] || '').trim(),
      duration: Number.isFinite(duration) ? duration : 0,
      channel: (parts[3] || '').trim(),
      uploader: (parts[4] || '').trim(),
      url: 'https://www.youtube.com/watch?v=' + id,
    });
  }
  return hits;
}

function primaryArtist(artist) {
  return String(artist || '').split(/\s*(?:,|&| feat\.?| ft\.?| featuring )\s*/i)[0].trim();
}

const TITLE_STOP = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on']);

function tokenList(s) {
  return normKey(s).split(' ').filter((w) => w.length > 1 && !TITLE_STOP.has(w));
}

function hayHasTokens(hay, needle) {
  const h = normKey(hay);
  const tokens = tokenList(needle);
  if (!tokens.length || !h) return false;
  return tokens.every((t) => h.includes(t));
}

function wantedVersionFlags(title) {
  const t = normKey(title);
  return {
    live: /\blive\b/.test(t),
    remix: /\bremix\b/.test(t),
    cover: /\bcover\b/.test(t),
    karaoke: /\bkaraoke\b/.test(t),
    instrumental: /\binstrumental\b/.test(t),
    slowed: /\bslowed\b/.test(t) || /\bsped up\b/.test(t),
  };
}

const MIN_YOUTUBE_SCORE = 10;

function scoreYoutubeHit(hit, meta) {
  if (!hit || !meta) return -100;
  const title = hit.title || '';
  const channel = hit.channel || hit.uploader || '';
  const blob = title + ' ' + channel;
  const artist = primaryArtist(meta.artist);
  const want = wantedVersionFlags(meta.title);
  const got = wantedVersionFlags(title);

  const titleOk = hayHasTokens(title, meta.title);
  const artistInTitle = artist && (hayHasTokens(title, artist) || hayHasTokens(title, meta.artist));
  const artistInChannel = artist && (hayHasTokens(channel, artist) || hayHasTokens(blob, artist));

  if (!titleOk) return -100;
  if (artist && !artistInTitle && !artistInChannel) return -100;

  let score = 0;
  if (titleOk) score += 8;
  if (artistInTitle) score += 8;
  if (artistInChannel) score += 6;

  if (/- topic$/i.test(channel) || /\btopic\b/i.test(channel)) score += 6;
  if (/vevo/i.test(channel)) score += 5;
  if (/official audio|official video|official music video/i.test(title)) score += 3;

  if (!want.karaoke && /\bkaraoke\b/i.test(title)) score -= 20;
  if (!want.cover && /\bcover(?:ed)?\b/i.test(title)) score -= 16;
  if (!want.remix && /\bremix\b/i.test(title)) score -= 10;
  if (!want.live && /\blive\b/i.test(title)) score -= 8;
  if (!want.instrumental && /\binstrumental\b/i.test(title)) score -= 8;
  if (!want.slowed && (/\bslowed\b/i.test(title) || /\bsped up\b/i.test(title) || /\bnightcore\b/i.test(title))) {
    score -= 12;
  }
  if (/\blyrics?\b/i.test(title) && !/\blyrics?\b/i.test(meta.title || '')) score -= 2;

  const wantDur = Number(meta.duration) || 0;
  const gotDur = Number(hit.duration) || 0;
  if (wantDur > 30 && gotDur > 0) {
    const delta = Math.abs(gotDur - wantDur);
    const slack = Math.max(15, wantDur * 0.15);
    if (delta <= 3) score += 6;
    else if (delta <= 8) score += 3;
    else if (delta <= slack) score += 0;
    else return -100;
  }

  return score;
}

function isAcceptableYoutubeHit(hit, meta) {
  return scoreYoutubeHit(hit, meta) >= MIN_YOUTUBE_SCORE;
}

function rankSearchHits(hits, metaOrDuration) {
  const meta = metaOrDuration && typeof metaOrDuration === 'object'
    ? metaOrDuration
    : { duration: metaOrDuration, title: '', artist: '' };
  return hits.slice()
    .map((hit) => Object.assign({}, hit, { score: scoreYoutubeHit(hit, meta) }))
    .filter((hit) => hit.score >= MIN_YOUTUBE_SCORE)
    .sort((a, b) => b.score - a.score || Math.abs((a.duration || 0) - (meta.duration || 0)) - Math.abs((b.duration || 0) - (meta.duration || 0)));
}

function combinedOutput(result) {
  return [result && result.stderr, result && result.stdout, result && result.error].filter(Boolean).join('\n');
}

function ytdlpDownloadArgs(outTpl, source, extra) {
  return [
    '--no-playlist',
    '--no-warnings',
    '--newline',
    '-x',
    '--audio-format', 'mp3',
    '--audio-quality', '0',
    '--embed-metadata',
    '--no-overwrites',
    '-o', outTpl,
  ].concat(extra || []).concat([source]);
}

const YT_PRINT = '%(id)s\t%(title)s\t%(duration)s\t%(channel)s\t%(uploader)s';

async function searchYoutube(ytdlp, meta) {
  const artist = primaryArtist(meta.artist);
  const title = meta.title || '';
  const queries = [];
  if (artist && title) {
    queries.push(`ytsearch10:"${artist}" "${title}"`);
    queries.push(`ytsearch8:${artist} - ${title} official audio`);
  } else if (title) {
    queries.push(`ytsearch8:${title}`);
  }
  const hits = [];
  const seen = new Set();
  for (const query of queries) {
    const result = await spawnCaptured(ytdlp, [
      '--flat-playlist',
      '--no-warnings',
      '--print', YT_PRINT,
      query,
    ], { timeoutMs: 45000 });
    for (const hit of parseSearchHits((result.stdout || '') + '\n' + combinedOutput(result))) {
      if (seen.has(hit.id)) continue;
      seen.add(hit.id);
      hits.push(hit);
    }
  }
  return rankSearchHits(hits, meta);
}

async function inspectYoutube(ytdlp, url) {
  if (!url) return null;
  const result = await spawnCaptured(ytdlp, [
    '--skip-download',
    '--no-playlist',
    '--no-warnings',
    '--print', YT_PRINT,
    url,
  ], { timeoutMs: 30000 });
  const hits = parseSearchHits(result.stdout || '');
  return hits[0] || null;
}

async function tryYtdlpExtract(ytdlp, outTpl, source, extra, onProgress, timeoutMs) {
  const args = ytdlpDownloadArgs(outTpl, source, extra);
  return spawnCaptured(ytdlp, args, {
    timeoutMs: timeoutMs || DOWNLOAD_MS,
    onStdout: (chunk) => {
      const pct = parseYtdlpPercent(chunk);
      if (pct != null && onProgress) {
        onProgress({ stage: 'audio', message: `Downloading… ${Math.round(pct)}%`, percent: pct });
      }
    },
  });
}

async function downloadAudio(meta, destMp3, onProgress, opts) {
  const tools = await ensureYtdlp({
    cacheDir: opts && opts.cacheDir,
    onProgress,
  });
  if (!tools.ok || !tools.ytdlp) {
    return { ok: false, error: tools.error || ('yt-dlp is not available. ' + BINARY_HINT) };
  }
  if (!tools.ffmpeg) {
    return { ok: false, error: 'ffmpeg is not installed. ' + BINARY_HINT };
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'music_view-import-'));
  const outTpl = path.join(tmpDir, 'audio.%(ext)s');

  if (onProgress) onProgress({ stage: 'audio', message: 'Finding a matching recording…', percent: 0 });

  const ranked = [];
  const seen = new Set();
  function consider(hit) {
    if (!hit || !hit.url || seen.has(hit.url)) return;
    if (!isAcceptableYoutubeHit(hit, meta)) return;
    seen.add(hit.url);
    ranked.push(Object.assign({}, hit, { score: scoreYoutubeHit(hit, meta) }));
  }

  if (meta.youtubeUrl) {
    try {
      consider(await inspectYoutube(tools.ytdlp, meta.youtubeUrl) || { url: meta.youtubeUrl, title: '', duration: 0 });
    } catch (_) { /* optional */ }
  }
  try {
    for (const hit of await searchYoutube(tools.ytdlp, meta)) consider(hit);
  } catch (_) { /* search is best-effort */ }

  ranked.sort((a, b) => (b.score || 0) - (a.score || 0));
  const sourcesCapped = ranked.slice(0, 4).map((hit) => hit.url);
  if (!sourcesCapped.length) {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) { /* ignore */ }
    const who = [meta.artist, meta.title].filter(Boolean).join(' — ') || 'that track';
    return {
      ok: false,
      error: 'No YouTube match for ' + who + ' (same title by someone else was ignored). Try a more specific track, or add the file yourself.',
    };
  }
  let lastResult = null;
  let sawSignIn = false;
  let produced = null;

  async function extract(source, extra, timeoutMs) {
    const result = await tryYtdlpExtract(
      tools.ytdlp, outTpl, source, extra, onProgress, timeoutMs,
    );
    lastResult = result;
    if (result.code === 0) {
      produced = fs.readdirSync(tmpDir).find((n) => /\.(mp3|m4a|opus|ogg|wav)$/i.test(n));
      return !!produced;
    }
    if (isSignInError(combinedOutput(result))) sawSignIn = true;
    return false;
  }

  for (let i = 0; i < sourcesCapped.length && !produced; i++) {
    if (onProgress) {
      onProgress({
        stage: 'audio',
        message: sourcesCapped.length > 1
          ? `Downloading match ${i + 1} of ${sourcesCapped.length}…`
          : 'Downloading matching recording…',
        percent: 0,
      });
    }
    await extract(sourcesCapped[i], [], DOWNLOAD_MS);
  }

  if (!produced && sawSignIn) {
    const browsers = cookieBrowserCandidates();
    cookieLoop:
    for (let i = 0; i < Math.min(2, sourcesCapped.length); i++) {
      for (const browser of browsers) {
        if (onProgress) {
          onProgress({
            stage: 'audio',
            message: `Retrying with ${browser} YouTube sign-in…`,
            percent: 0,
          });
        }
        const ok = await extract(
          sourcesCapped[i],
          ['--cookies-from-browser', browser],
          45000,
        );
        if (ok) break cookieLoop;
      }
    }
  }

  if (!produced) {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) { /* ignore */ }
    const detail = combinedOutput(lastResult || {}).trim().split(/\r?\n/).slice(-4).join(' ');
    if (sawSignIn) {
      return {
        ok: false,
        error: 'YouTube asked to sign in. Sign into YouTube in Chrome (or Brave/Edge), then try Import again.',
      };
    }
    return {
      ok: false,
      error: 'Audio download failed' + (detail ? ': ' + detail.slice(0, 280) : ''),
    };
  }

  const src = path.join(tmpDir, produced);
  let coverPath = null;
  if (meta.coverUrl) {
    try {
      if (onProgress) onProgress({ stage: 'cover', message: 'Saving cover art…' });
      const gate = withTimeout(FETCH_MS, 'Cover');
      let res;
      try {
        res = await fetch(meta.coverUrl, {
          signal: gate.signal,
          headers: { 'User-Agent': APP_UA },
        });
      } finally {
        gate.clear();
      }
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length > 32 && buf.length < 4 * 1024 * 1024) {
          coverPath = path.join(tmpDir, 'cover.jpg');
          fs.writeFileSync(coverPath, buf);
        }
      }
    } catch (_) { /* cover is optional */ }
  }

  const ffmpegArgs = ['-y', '-i', src];
  if (coverPath) ffmpegArgs.push('-i', coverPath);
  ffmpegArgs.push('-map', '0:a');
  if (coverPath) {
    ffmpegArgs.push('-map', '1', '-c:v', 'mjpeg', '-disposition:v', 'attached_pic');
  }
  ffmpegArgs.push(
    '-c:a', 'copy',
    '-id3v2_version', '3',
  );
  if (meta.title) ffmpegArgs.push('-metadata', 'title=' + meta.title);
  if (meta.artist) ffmpegArgs.push('-metadata', 'artist=' + meta.artist);
  if (meta.album) ffmpegArgs.push('-metadata', 'album=' + meta.album);
  ffmpegArgs.push(destMp3);

  if (onProgress) onProgress({ stage: 'save', message: 'Writing library file…' });
  const tagged = await spawnCaptured(tools.ffmpeg, ffmpegArgs, { timeoutMs: 60000 });
  if (tagged.code !== 0) {
    try { fs.copyFileSync(src, destMp3); } catch (e) {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) { /* ignore */ }
      return { ok: false, error: 'Could not write the audio file' };
    }
  }

  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  if (!fs.existsSync(destMp3)) {
    return { ok: false, error: 'Could not write the audio file' };
  }
  return { ok: true, path: destMp3 };
}

function existingAudioForBase(dir, base) {
  for (const ext of ['.mp3', '.m4a', '.flac', '.wav', '.ogg', '.opus', '.aac']) {
    const p = path.join(dir, base + ext);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

async function songFromPath(audioPath) {
  const listed = await musicLibrary.listSongs();
  if (listed.ok && Array.isArray(listed.songs)) {
    const hit = listed.songs.find((s) => s.path === audioPath);
    if (hit) return hit;
  }
  const ext = path.extname(audioPath);
  const base = path.basename(audioPath, ext);
  const lrcPath = path.join(path.dirname(audioPath), base + '.lrc');
  const hasLyrics = fs.existsSync(lrcPath);
  return {
    id: path.basename(audioPath),
    name: path.basename(audioPath),
    title: base,
    ext,
    path: audioPath,
    fileUrl: musicLibrary.songFileUrl(audioPath),
    hasLyrics,
    lyricsPath: hasLyrics ? lrcPath : null,
  };
}

async function importSpotifyTrack(rawUrl, opts) {
  const onProgress = opts && opts.onProgress ? opts.onProgress : () => {};
  const fetchImpl = opts && opts.fetchImpl ? opts.fetchImpl : null;

  if (importLock) {
    return { ok: false, error: 'An import is already running' };
  }

  const run = (async () => {
    const dir = (opts && opts.songsDir) || musicLibrary.resolveSongsDir();
    if (!dir || !fs.existsSync(dir)) {
      return { ok: false, error: 'Songs directory not found: ' + dir };
    }

    onProgress({ stage: 'resolve', message: 'Looking up track…' });
    const resolved = await resolveTrack(rawUrl, fetchImpl);
    if (!resolved.ok) return resolved;
    const meta = resolved.meta;

    const base = defaultBasename(meta.artist, meta.title);
    const dest = path.join(dir, base + '.mp3');
    let audioPath = dest;
    let skippedAudio = false;

    const dl = await downloadAudio(meta, dest, onProgress, {
      cacheDir: opts && opts.cacheDir,
    });
    if (!dl.ok) return dl;
    audioPath = dl.path;

    onProgress({ stage: 'lyrics', message: 'Fetching lyrics…' });
    const lyrics = await fetchLyrics(meta, fetchImpl);
    const lrcPath = path.join(dir, path.basename(audioPath, path.extname(audioPath)) + '.lrc');
    let wroteLyrics = false;
    if (lyrics.found && lyrics.text) {
      if (!fs.existsSync(lrcPath) || (opts && opts.overwriteLyrics)) {
        fs.writeFileSync(lrcPath, lyrics.text, 'utf8');
        wroteLyrics = true;
      }
    }

    const song = songFromPath(audioPath);
    onProgress({
      stage: 'done',
      message: lyrics.found
        ? (lyrics.synced ? 'Imported with synced lyrics' : 'Imported with unsynced lyrics')
        : 'Imported (no lyrics found)',
    });
    return {
      ok: true,
      song,
      meta: {
        title: meta.title,
        artist: meta.artist,
        album: meta.album,
        duration: meta.duration,
        spotifyId: meta.id,
      },
      lyrics: {
        found: !!lyrics.found,
        synced: !!lyrics.synced,
        wrote: wroteLyrics,
      },
      skippedAudio,
    };
  })();

  importLock = run;
  try {
    return await run;
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  } finally {
    importLock = null;
  }
}

module.exports = {
  APP_UA,
  parseSpotifyInput,
  sanitizeFilename,
  defaultBasename,
  uniqueDest,
  formatLrcTime,
  stampPlainLyrics,
  buildLrc,
  scoreLrcHit,
  pickLrcHit,
  primaryArtist,
  scoreYoutubeHit,
  isAcceptableYoutubeHit,
  parseEmbedHtml,
  parseOembed,
  parseSongLink,
  probeTools,
  ensureYtdlp,
  parseYtdlpVersion,
  isYtdlpCurrent,
  ytdlpReleaseUrl,
  isSignInError,
  cookieBrowserCandidates,
  parseSearchHits,
  rankSearchHits,
  resolveTrack,
  fetchLyrics,
  importSpotifyTrack,
};
