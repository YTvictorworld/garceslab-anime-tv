# Direct play of debrid streams

Debrid (TorBox) streams play **directly** on the TV: the server only resolves the link, and the
TV's `<video>` plays it, with the MKV's own subtitles read on the TV. Because the server never
relays the video, **up to three TVs can watch at the same time**, each with its own profile and
progress. Torrent streams, library files and online streams play as before. The server side
(viewer sessions, "Now watching", limits) is in the server's
[docs/phase2-direct-play.md](https://github.com/YTvictorworld/garceslab-anime-server/blob/main/docs/phase2-direct-play.md).

## How a stream starts

1. The app starts the debrid stream with the `externalPlayerLink` playback type. The server
   takes a **viewing slot** for this TV, resolves the TorBox link (with subtitle-aware
   auto-select) and sends it, and the stream's status, to this TV only.
2. When all slots are taken, the episode card says *"All 3 viewing slots are in use (Ana, Bob
   and Carl). Try again when someone stops watching."*
3. The link goes straight into the TV's `<video>`.
4. Progress is saved per profile (watching status, continuity every 15 s, the episode marked
   watched at 85 %). Leaving the player frees the slot.

## Subtitles, fonts and audio

- **Subtitles** are read on the TV from the MKV with HTTP Range requests (`src/lib/player/mkv/`):
  the header (Tracks, Cues) first, then only the subtitle blocks. TorBox's CDN answers 429 to
  clients that send many requests while a video streams, so reads are few and large (blocks
  merged when less than 2 MiB apart, at most 6 MiB a read), one at a time and at least 1 s
  apart. The lines near the playhead come first; the rest follows in the background. 429/503
  answers back off quietly (Retry-After, or 2 s up to 60 s).
- **ASS** is drawn with JASSUB/libass and the file's own fonts; SRT as text. Image subtitles
  (PGS) are not read in direct play.
- **CORS:** reads use `fetch`; if the CDN doesn't allow the app's origin, they go through the
  app's JS service.
- **Audio** tracks are listed from the header and switched with the `<video>`'s `audioTracks`.

## When direct play fails

If the TV can't play the link or read the file's header, it asks the server for a **fresh link**
to the same release and file and plays it directly again, **up to 3 times** (2 s, 4 s and 8 s
apart, longer while the CDN asks to back off), showing *"Retrying direct play (2/3)…"*. A retry
reuses this TV's slot. Only after the third failed retry does the same release start through
the server (*"Playing through the server instead."*). Decode errors (which a fresh link can't
fix) go to the server at once. A failure later in the episode retries the same way at its
position, then offers **Retry via server**. Subtitle reads that are rate-limited only show a
message; the video keeps playing.

If the server ends the slot (*Stop* in the web's **Now watching**, or the same profile starting
elsewhere), the player closes with a message.

## Diagnostics

**Playback stats** (Info key) show a direct-play panel for support: retry count and last
failure, reader path, codecs, CDN requests and 429/503 answers, subtitle tracks and lines read,
fonts, audio tracks and buffered ranges. The same summary goes to the debug log. It never
contains the link.

## Build options

| Variable (build time) | Effect |
|---|---|
| `EXPO_PUBLIC_DIRECT_PLAY=0` | every debrid stream goes through the server (one viewer at a time) |
| `EXPO_PUBLIC_DIRECT_PLAY_MIN_GAP_MS` | minimum gap between subtitle reads (default 1000) |
| `EXPO_PUBLIC_DIRECT_PLAY_TEST=1` (or an app id containing `directtest`) | test build with a loud failure dialog |

## Code and tests

`src/lib/player/direct-play-*.ts`, `src/lib/player/mkv/`. Tests: `tests/direct-play-*.test.ts`,
`tests/mkv-subtitles.test.ts` (fixtures from `tests/fixtures/mkv/make-fixtures.sh`),
`tests/card-start-race.test.ts`.
