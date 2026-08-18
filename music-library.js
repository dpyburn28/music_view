/**
 * Main-process music library helpers: song listing + LRC parse.
 * Songs directory: /Volumes/ARCHIVE/Assets/Music/Songs
 */

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const SONG_DIR_CANDIDATES = [
  '/Volumes/ARCHIVE/Assets/Music/Songs',
  '/Volumes/ARCHIVE/Assets/Music/Songs ', // user-specified variant with trailing space
];

const AUDIO_EXTS = new Set([
  '.mp3', '.wav', '.flac', '.m4a', '.aac', '.ogg', '.opus', '.aiff', '.aif', '.wma',
]);

/** Build a song:// URL for the audio element (pathname = absolute path). */
function songFileUrl(absolutePath) {
  // song://local/Volumes/.../file.mp3  — encode path segments, keep slashes
  const encoded = absolutePath
    .split('/')
    .map((seg, i) => (i === 0 ? seg : encodeURIComponent(seg)))
    .join('/');
  return 'song://local' + (encoded.startsWith('/') ? encoded : '/' + encoded);
}

/**
 * Resolve a performance/library relative path (filename today) under the songs dir.
 * Rejects traversal and absolute paths.
 */
function resolveSongRelPath(relPath) {
  if (!relPath || typeof relPath !== 'string') return null;
  const s = relPath.trim();
  if (!s || s.includes('..') || path.isAbsolute(s) || s.includes('/') || s.includes('\\')) {
    return null;
  }
  const dir = path.resolve(resolveSongsDir());
  const resolved = path.resolve(dir, s);
  if (!resolved.startsWith(dir + path.sep)) return null;
  return resolved;
}

function resolveSongsDir() {
  for (const dir of SONG_DIR_CANDIDATES) {
    try {
      if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
        return dir;
      }
    } catch (_) { /* try next */ }
  }
  return SONG_DIR_CANDIDATES[0];
}

function listSongs() {
  const dir = resolveSongsDir();
  if (!fs.existsSync(dir)) {
    return {
      ok: false,
      error: `Songs directory not found: ${dir}`,
      dir,
      songs: [],
    };
  }

  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    return {
      ok: false,
      error: String(e && e.message ? e.message : e),
      dir,
      songs: [],
    };
  }

  const songs = [];
  for (const ent of entries) {
    if (!ent.isFile()) continue;
    const ext = path.extname(ent.name).toLowerCase();
    if (!AUDIO_EXTS.has(ext)) continue;

    const base = path.basename(ent.name, ext);
    const audioPath = path.join(dir, ent.name);
    const lrcName = `${base}.lrc`;
    const lrcPath = path.join(dir, lrcName);
    const hasLyrics = fs.existsSync(lrcPath);

    songs.push({
      id: ent.name,
      name: ent.name,
      title: base,
      ext,
      path: audioPath,
      // Custom protocol (registered in app.js) — streams local files safely
      fileUrl: songFileUrl(audioPath),
      nativeFileUrl: pathToFileURL(audioPath).href,
      hasLyrics,
      lyricsPath: hasLyrics ? lrcPath : null,
    });
  }

  songs.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));

  return { ok: true, dir, songs };
}

/**
 * Parse an LRC file into { meta, lines: [{ time, text }] }.
 * Supports [mm:ss.xx] and [mm:ss.xxx], multiple timestamps per line.
 */
function parseLrc(text) {
  const meta = {};
  const lines = [];
  if (!text) return { meta, lines };

  const metaRe = /^\[(ti|ar|al|by|offset|re|ve|length):(.*)\]\s*$/i;
  // [mm:ss.xx] or [mm:ss.xxx] or [mm:ss]
  const timeRe = /\[(\d{1,3}):(\d{2})(?:\.(\d{1,3}))?\]/g;

  const rawLines = String(text).split(/\r?\n/);
  for (const raw of rawLines) {
    const line = raw.trim();
    if (!line) continue;

    // Metadata tags like [ti:Title] (no timestamps)
    const metaMatch = line.match(metaRe);
    if (metaMatch) {
      meta[metaMatch[1].toLowerCase()] = metaMatch[2].trim();
      continue;
    }

    const stamps = [];
    let m;
    let lastIndex = 0;
    timeRe.lastIndex = 0;
    while ((m = timeRe.exec(line)) !== null) {
      const min = Number(m[1]);
      const sec = Number(m[2]);
      let frac = m[3] || '0';
      // normalize fractional seconds to milliseconds
      if (frac.length === 1) frac += '00';
      else if (frac.length === 2) frac += '0';
      else if (frac.length > 3) frac = frac.slice(0, 3);
      const ms = Number(frac.padEnd(3, '0').slice(0, 3));
      const time = min * 60 + sec + ms / 1000;
      stamps.push(time);
      lastIndex = m.index + m[0].length;
    }

    if (!stamps.length) continue;
    const lyricText = line.slice(lastIndex).trim();
    for (const time of stamps) {
      lines.push({ time, text: lyricText });
    }
  }

  lines.sort((a, b) => a.time - b.time || a.text.localeCompare(b.text));

  // Apply [offset:ms] if present (positive = lyrics appear later)
  const offsetMs = Number(meta.offset || 0);
  if (offsetMs && Number.isFinite(offsetMs)) {
    const delta = offsetMs / 1000;
    for (const row of lines) row.time = Math.max(0, row.time + delta);
  }

  return { meta, lines };
}

function loadLyrics(lyricsPath) {
  if (!lyricsPath || !fs.existsSync(lyricsPath)) {
    return { ok: false, error: 'Lyrics file not found', meta: {}, lines: [] };
  }
  try {
    const text = fs.readFileSync(lyricsPath, 'utf8');
    const parsed = parseLrc(text);
    return {
      ok: true,
      path: lyricsPath,
      raw: text,
      meta: parsed.meta,
      lines: parsed.lines,
    };
  } catch (e) {
    return {
      ok: false,
      error: String(e && e.message ? e.message : e),
      meta: {},
      lines: [],
    };
  }
}

function pictureToDataUrl(pic) {
  if (!pic || !pic.data) return null;
  const format = pic.format || 'image/jpeg';
  const buf = Buffer.isBuffer(pic.data) ? pic.data : Buffer.from(pic.data);
  if (buf.length > 2.5 * 1024 * 1024) return null;
  return {
    dataUrl: `data:${format};base64,${buf.toString('base64')}`,
    format,
    bytes: buf.length,
  };
}

/**
 * Extract the first embedded cover image from an audio file.
 * @returns {{ ok: boolean, dataUrl?: string, format?: string, error?: string }}
 */
async function extractCoverArt(songPath) {
  if (!songPath || !fs.existsSync(songPath)) {
    return { ok: false, error: 'Song file not found' };
  }
  try {
    const mm = await import('music-metadata');
    const metadata = await mm.parseFile(songPath, { duration: false, skipCovers: false });
    const pictures = metadata.common.picture;
    if (!pictures || !pictures.length) {
      return { ok: false, error: 'No embedded cover art' };
    }
    const converted = pictureToDataUrl(pictures[0]);
    if (!converted) {
      return { ok: false, error: 'Cover art too large or invalid' };
    }
    return { ok: true, ...converted };
  } catch (e) {
    return {
      ok: false,
      error: String(e && e.message ? e.message : e),
    };
  }
}

/**
 * Full display payload for the selected track (tags + cover).
 * Used by the display window's song panels.
 */
async function extractSongDisplayInfo(songPath) {
  if (!songPath || !fs.existsSync(songPath)) {
    return { ok: false, error: 'Song file not found' };
  }
  const base = path.basename(songPath, path.extname(songPath));
  try {
    const mm = await import('music-metadata');
    const metadata = await mm.parseFile(songPath, { duration: false, skipCovers: false });
    const c = metadata.common || {};
    const pictures = c.picture;
    let cover = null;
    if (pictures && pictures.length) {
      cover = pictureToDataUrl(pictures[0]);
    }
    const artist = c.artist
      || (Array.isArray(c.artists) ? c.artists.filter(Boolean).join(', ') : '')
      || c.albumartist
      || '';
    const lrcPath = path.join(path.dirname(songPath), `${base}.lrc`);
    const hasLyrics = fs.existsSync(lrcPath);
    let lyricLines = [];
    if (hasLyrics) {
      const lrc = loadLyrics(lrcPath);
      if (lrc.ok && Array.isArray(lrc.lines)) {
        // Keep one entry per timed line (including blanks) so indices match playback focus.
        lyricLines = lrc.lines.map((row) => String(row.text || '').trim());
      }
    }

    return {
      ok: true,
      path: songPath,
      title: c.title || base,
      artist: artist || 'Unknown Artist',
      album: c.album || '',
      year: c.year || null,
      coverDataUrl: cover ? cover.dataUrl : null,
      hasCover: !!cover,
      hasLyrics,
      /** Lyric strings in timed order (index-aligned with lyric-focus). */
      lyricLines,
    };
  } catch (e) {
    return {
      ok: false,
      error: String(e && e.message ? e.message : e),
      title: base,
      artist: '',
      album: '',
      coverDataUrl: null,
      hasCover: false,
    };
  }
}

function loadSongBundle(songPath) {
  if (!songPath || !fs.existsSync(songPath)) {
    return { ok: false, error: 'Song file not found' };
  }
  const ext = path.extname(songPath);
  const base = path.basename(songPath, ext);
  const dir = path.dirname(songPath);
  const lrcPath = path.join(dir, `${base}.lrc`);
  const hasLyrics = fs.existsSync(lrcPath);
  const lyrics = hasLyrics ? loadLyrics(lrcPath) : { ok: false, meta: {}, lines: [] };

  return {
    ok: true,
    song: {
      name: path.basename(songPath),
      title: base,
      path: songPath,
      fileUrl: songFileUrl(songPath),
      nativeFileUrl: pathToFileURL(songPath).href,
      hasLyrics,
      lyricsPath: hasLyrics ? lrcPath : null,
    },
    lyrics: hasLyrics ? lyrics : null,
  };
}

module.exports = {
  SONG_DIR_CANDIDATES,
  resolveSongsDir,
  resolveSongRelPath,
  songFileUrl,
  listSongs,
  parseLrc,
  loadLyrics,
  loadSongBundle,
  extractCoverArt,
  extractSongDisplayInfo,
};
