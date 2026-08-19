const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const si = require('../src/main/spotify-import');

test('parseSpotifyInput accepts track urls, intl paths, and URIs', () => {
  const a = si.parseSpotifyInput('https://open.spotify.com/track/3n3Ppam7vgaVa1iaRUc9Lp?si=abc');
  assert.equal(a.ok, true);
  assert.equal(a.type, 'track');
  assert.equal(a.id, '3n3Ppam7vgaVa1iaRUc9Lp');

  const b = si.parseSpotifyInput('https://open.spotify.com/intl-de/track/3n3Ppam7vgaVa1iaRUc9Lp');
  assert.equal(b.ok, true);
  assert.equal(b.id, '3n3Ppam7vgaVa1iaRUc9Lp');

  const c = si.parseSpotifyInput('spotify:track:3n3Ppam7vgaVa1iaRUc9Lp');
  assert.equal(c.ok, true);
  assert.equal(c.id, '3n3Ppam7vgaVa1iaRUc9Lp');
  assert.equal(c.url, 'https://open.spotify.com/track/3n3Ppam7vgaVa1iaRUc9Lp');
});

test('parseSpotifyInput rejects albums/playlists and empty input', () => {
  const album = si.parseSpotifyInput('https://open.spotify.com/album/1ABC');
  assert.equal(album.ok, false);
  assert.match(album.error, /single track/i);

  const list = si.parseSpotifyInput('https://open.spotify.com/playlist/37i9dQZF');
  assert.equal(list.ok, false);

  const empty = si.parseSpotifyInput('   ');
  assert.equal(empty.ok, false);

  const junk = si.parseSpotifyInput('https://example.com/track/1');
  assert.equal(junk.ok, false);
});

test('parseSpotifyInput flags short links for later resolve', () => {
  const s = si.parseSpotifyInput('https://spotify.link/abcdef');
  assert.equal(s.ok, true);
  assert.equal(s.type, 'short');
});

test('sanitizeFilename and defaultBasename', () => {
  assert.equal(si.sanitizeFilename('A / B: C*?'), 'A B C');
  assert.equal(si.defaultBasename('The Killers', 'Mr. Brightside'), 'The Killers - Mr. Brightside');
  assert.equal(si.defaultBasename('', 'untitled'), 'untitled');
});

test('uniqueDest increments when the file exists', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mv-import-'));
  try {
    fs.writeFileSync(path.join(dir, 'Song.mp3'), 'x');
    const first = si.uniqueDest(dir, 'Song', '.mp3');
    assert.equal(path.basename(first), 'Song (2).mp3');
    fs.writeFileSync(first, 'y');
    const second = si.uniqueDest(dir, 'Song', 'mp3');
    assert.equal(path.basename(second), 'Song (3).mp3');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('buildLrc prefers synced text and stamps unsynced lines', () => {
  const synced = si.buildLrc({
    title: 'T',
    artist: 'A',
    album: 'Al',
    duration: 120,
    synced: '[00:01.00] Hello\n[00:04.00] World',
    plain: 'ignored',
  });
  assert.match(synced, /\[ti:T\]/);
  assert.match(synced, /\[ar:A\]/);
  assert.match(synced, /\[00:01.00\] Hello/);
  assert.doesNotMatch(synced, /ignored/);

  const plain = si.buildLrc({
    title: 'T',
    artist: 'A',
    duration: 10,
    plain: 'one\ntwo',
  });
  assert.match(plain, /\[by:lrclib unsynced\]/);
  assert.match(plain, /\[00:00.00\] one/);
  assert.match(plain, /\[00:05.00\] two/);
});

test('pickLrcHit prefers matching title/artist, duration, and synced lyrics', () => {
  const want = { title: 'Mr. Brightside', artist: 'The Killers', duration: 222 };
  const hits = [
    {
      trackName: 'Mr. Brightside',
      artistName: 'Someone Else',
      duration: 222,
      syncedLyrics: '[00:01.00] x',
    },
    {
      trackName: 'Mr. Brightside',
      artistName: 'The Killers',
      duration: 222,
      syncedLyrics: '[00:01.00] y',
    },
    {
      trackName: 'Mr. Brightside',
      artistName: 'The Killers',
      duration: 400,
      plainLyrics: 'z',
    },
  ];
  const pick = si.pickLrcHit(hits, want);
  assert.equal(pick.syncedLyrics, '[00:01.00] y');
});

test('parseEmbedHtml reads title, artist, duration, cover', () => {
  const html = `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
    props: {
      pageProps: {
        state: {
          data: {
            entity: {
              type: 'track',
              id: '3n3Ppam7vgaVa1iaRUc9Lp',
              name: 'Mr. Brightside',
              artists: [{ name: 'The Killers' }],
              duration: 222200,
              visualIdentity: {
                image: [{ url: 'https://img.example/cover.jpg', maxWidth: 640 }],
              },
            },
          },
        },
      },
    },
  })}</script></html>`;
  const meta = si.parseEmbedHtml(html);
  assert.equal(meta.title, 'Mr. Brightside');
  assert.equal(meta.artist, 'The Killers');
  assert.equal(meta.duration, 222.2);
  assert.equal(meta.coverUrl, 'https://img.example/cover.jpg');
});

test('fetchLyrics picks a synced LRCLIB hit via fetchImpl', async () => {
  const fetchImpl = {
    json: async () => ({
      ok: true,
      status: 200,
      json: [
        {
          trackName: 'Mr. Brightside',
          artistName: 'The Killers',
          albumName: 'Hot Fuss',
          duration: 222,
          syncedLyrics: '[00:06.54] Comin\' out of my cage',
          plainLyrics: 'Comin\' out of my cage',
        },
      ],
    }),
  };
  const lyrics = await si.fetchLyrics(
    { title: 'Mr. Brightside', artist: 'The Killers', duration: 222 },
    fetchImpl,
  );
  assert.equal(lyrics.found, true);
  assert.equal(lyrics.synced, true);
  assert.match(lyrics.text, /\[00:06.54\] Comin' out of my cage/);
});

test('parseYtdlpVersion treats 2024 Homebrew builds as stale', () => {
  assert.equal(si.parseYtdlpVersion('2024.08.06'), 20240806);
  assert.equal(si.isYtdlpCurrent('2024.08.06'), false);
  assert.equal(si.isYtdlpCurrent('2026.07.04'), true);
  assert.ok(si.ytdlpReleaseUrl('darwin').includes('yt-dlp_macos'));
});

test('isSignInError matches YouTube bot-check text', () => {
  assert.equal(si.isSignInError('ERROR: [youtube] 3tNniR6_Id8: Please sign in'), true);
  assert.equal(si.isSignInError('Sign in to confirm you\'re not a bot'), true);
  assert.equal(si.isSignInError('Video unavailable'), false);
});

test('parseSearchHits reads channel columns', () => {
  const hits = si.parseSearchHits([
    'gGdGFtwCNBE\tThe Killers - Mr. Brightside (Official Music Video)\t228\tTheKillersMusic\tTheKillersMusic',
    'bad',
    'pvIJyRkS9y0\tMr. Brightside HQ (The Killers)\t224\tDank Music Channel\tDank Music Channel',
    'gGdGFtwCNBE\tdupe\t222',
  ].join('\n'));
  assert.equal(hits.length, 2);
  assert.equal(hits[0].channel, 'TheKillersMusic');
});

test('scoreYoutubeHit rejects the same title by another artist', () => {
  const meta = { title: 'Stay', artist: 'The Kid LAROI, Justin Bieber', duration: 141 };
  const wrong = {
    title: 'Rihanna - Stay',
    channel: 'RihannaVEVO',
    duration: 141,
  };
  const right = {
    title: 'The Kid LAROI, Justin Bieber - Stay (Official Video)',
    channel: 'TheKidLAROIVEVO',
    duration: 141,
  };
  assert.ok(si.scoreYoutubeHit(right, meta) >= 10);
  assert.ok(si.scoreYoutubeHit(wrong, meta) < 0);
  assert.equal(si.isAcceptableYoutubeHit(wrong, meta), false);
  assert.equal(si.isAcceptableYoutubeHit(right, meta), true);
  assert.equal(si.primaryArtist(meta.artist), 'The Kid LAROI');
});

test('rankSearchHits prefers official artist video over a random same-name hit', () => {
  const meta = { title: 'Mr. Brightside', artist: 'The Killers', duration: 222 };
  const ranked = si.rankSearchHits([
    { id: 'other', title: 'Mr. Brightside', channel: 'Random Covers', duration: 222, url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa' },
    { id: 'off', title: 'The Killers - Mr. Brightside (Official Music Video)', channel: 'TheKillersMusic', duration: 228, url: 'https://www.youtube.com/watch?v=gGdGFtwCNBE' },
    { id: 'rih', title: 'Rihanna - Stay', channel: 'RihannaVEVO', duration: 240, url: 'https://www.youtube.com/watch?v=bbbbbbbbbbb' },
  ], meta);
  assert.equal(ranked[0].id, 'off');
  assert.ok(!ranked.some((h) => h.id === 'rih'));
});

test('cookieBrowserCandidates skips Safari', () => {
  assert.ok(!si.cookieBrowserCandidates().includes('safari'));
  assert.ok(si.cookieBrowserCandidates().includes('chrome'));
});

test('parseSongLink extracts youtube when present', () => {
  const parsed = si.parseSongLink({
    entitiesByUniqueId: {
      'SPOTIFY_SONG::abc': {
        title: 'Song',
        artistName: 'Band',
        apiProvider: 'spotify',
        thumbnailUrl: 'https://img',
      },
    },
    linksByPlatform: {
      youtube: { url: 'https://www.youtube.com/watch?v=xyz' },
    },
  });
  assert.equal(parsed.title, 'Song');
  assert.equal(parsed.artist, 'Band');
  assert.equal(parsed.youtubeUrl, 'https://www.youtube.com/watch?v=xyz');
});
