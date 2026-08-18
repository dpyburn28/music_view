# External tools

Utilities useful when preparing content for music_view. Prefer the **in-app Spotify import** in the Music dock before these sites. Third-party pages are use-at-your-own-risk — respect copyright and only keep tracks you have the right to use.

## In-app: Spotify track link

Music → Library has a **Paste Spotify track link** field. Paste `open.spotify.com/track/…` or `spotify:track:…` and click **Import**.

What it does (main process, `spotify-import.js`):

1. Resolves title / artist / cover / duration from the public Spotify embed (track links only — not albums or playlists).
2. Downloads a **matching public recording** with `yt-dlp` + `ffmpeg`. YouTube results must match the Spotify title **and** artist (and sit close to the Spotify duration). A different song that only shares the name is not used. This is not a rip of Spotify’s own stream.
3. Writes synced lyrics from [LRCLIB](https://lrclib.net) next to the audio as `Artist - Title.lrc`. Unsynced lyrics are time-stamped evenly so the stage can still show them.
4. If that basename is already in the songs folder, audio is skipped and missing lyrics are filled in.

Requires **ffmpeg** on `PATH` (`brew install ffmpeg`). Import uses a current **yt-dlp** automatically (downloads the official binary into the app data folder if Homebrew’s copy is too old — YouTube now rejects 2024-era yt-dlp with “Please sign in”). If YouTube still asks to sign in, import retries using cookies from Chrome / Brave / Edge (sign into YouTube in that browser first).

## Lyrics (manual)

| Tool | URL | Notes |
|------|-----|--------|
| Lyric File Maker | https://lrc-maker.github.io | Author `.lrc` files for local tracks |
| LRCLIB | https://lrclib.net | Community synced lyrics (same source the importer uses) |

Place finished `.lrc` files next to audio with the **same basename** (see [Getting started](../overview/getting-started.md)).

## Other audio

| Tool | URL | Notes |
|------|-----|--------|
| Soundcloud Song Downloader | https://www.musicverter.com | Third-party; verify legality for your use |

music_view itself only plays **local files** from the configured songs directory.
