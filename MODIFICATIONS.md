# Modifications

Garceslab Anime TV is a modified version of Seanime Tenji (GPL-3.0), derived from
[AlkindiX/seanime-tv](https://github.com/AlkindiX/seanime-tv) at version 0.4.0 (commit
`0df9c6d`). This file is the prominent notice of modifications required by section 5a of the
GPL-3.0. Every change is also in the git history. No MPL-2.0 module has been modified.

Maintained independently since 2026-11 by YTvictorworld.

## 2026-11 (base, phase 0)

All for the LG webOS build:

- **Focus engine:** screens marked `inert` by Expo Router count as hidden, so the D-pad no
  longer lands on a control of a hidden tab; the Magic Remote wheel scrolls the page before
  a sideways row (`src/lib/webos/spatial-navigation.ts`, `src/lib/webos/remote.ts`).
- **Continue watching:** the start screen's cards and the hero's Play/Resume play the episode
  directly (debrid/torrent streams start on the card, with status and Back to cancel);
  "Upcoming" cards for airing shows that are caught up, with an optional build-time time zone
  (`EXPO_PUBLIC_TV_TIME_ZONE`) (`src/components/tv/*`, `src/lib/player/session.ts`, torrent
  stream controller).
- **Resume rule:** on the web TV builds an episode resumes, and its card shows progress, from
  10 seconds in up to 90 % (`src/lib/player/resume-position.ts` and its callers).
- Tests for the above in `tests/`, and notes in `webos/README.md`.
- **Project files:** this file, `NOTICE`, a header at the top of `README.md`, and a
  GitHub Actions workflow that builds the webOS `.ipk` (`.github/workflows/webos.yml`).

The app id, title and icons are still Seanime Tenji's; they will change in a later version.
