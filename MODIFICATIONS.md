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
- **Branding:** a placeholder Garceslab Anime logo and splash (`branding/*.svg`, exported by
  `branding/export.sh`) replace Seanime Tenji's webOS icons and splash and the logo inside the
  app; the webOS title, vendor and description, and the Expo app name, say "Garceslab Anime".
  The webOS app id stays `app.seanime.tenji` for now.
- **OTA updates off** (`app.config.ts`): native builds no longer fetch Seanime Tenji's
  over-the-air updates, which would replace this app's code. The webOS build never used them.
- **Project files:** this file, `NOTICE`, a new `README.md`, issue templates, GitHub Actions
  workflows that build the webOS `.ipk` on every change (`webos.yml`) and attach it to a
  GitHub Release on version tags (`release.yml`), Dependabot, and the tracked
  `package-lock.json`.

## 2026-11 (episode tags)

- **Canon / filler / recap tags on TV episode cards** (`src/lib/episode-tags/episode-tags.ts`,
  `src/api/hooks/episode-tags.hooks.ts`, `src/components/tv/tv-episode-card.tsx`, and the
  anime page's library, Torrents and online stream lists): a CANON / FILLER / RECAP / MIX pill in
  the top-right corner of the art, from the server's `GET /api/v1/anime/episode-tags/{id}`
  (MyAnimeList data via Tenrai, jikan-edge and Jikan). Shown only when the server has data for
  the anime and at least one episode is filler or recap; otherwise, or on any error, cards are
  unchanged. While the server fetches, the app asks again every 4 s for about two minutes.
  Tests in `tests/episode-tags.test.ts`.
- **Episode tags beyond the anime page** (`src/components/tv/tv-episode-tag-pill.tsx`,
  `tv-continue-card.tsx`, `tv-hero-carousel.tsx`, `tv-player-controls.tsx`, `tv-player-dialog.tsx`,
  `app/(app)/(media)/player.tsx`): the pill on Continue watching cards, the hero's continue
  slide, the player's top bar, its Next button and the next-episode prompts. Requests go
  through `src/lib/episode-tags/request-limit.ts` (three at a time, one cache entry per anime).
- **Skip filler and recaps** (`src/lib/episode-tags/next-episode.ts`, a player setting synced
  per profile as `tv.skipFillerEpisodes`): next episode jumps over filler and recap episodes
  when tags are known. Tests in `tests/next-episode-tags.test.ts`.

## 2026-11 (profiles, phase 4: polish)

- **Player preferences per profile** (`src/lib/player/player-prefs-sync.ts`,
  `player-prefs-remote.ts`, a change listener in `player-preferences.ts`, started from
  `src/lib/profile/use-profile-switch.ts`): the synced preferences are loaded from and saved to
  the server's `GET/PATCH /api/v1/profiles/me/player-prefs` (`tv` section). Tests in
  `tests/player-prefs-sync.test.ts`.
- **Avatars:** the profile's avatar on the nav bar's Settings tab, and the avatar licence and
  CC BY credits under the "Create your profile" avatar grid.
- **Fan art removed:** `src/assets/images/luffy-01.png` is replaced by the app logo in the
  error illustration.
- **Branding:** user-facing texts say "Garceslab Anime" instead of "Seanime" (credits,
  identifiers, storage keys, the app id and upstream product names unchanged).
- **API types** regenerated from the server (`src/api/generated`).

## 2026-11 (documentation and contribution rules)

- **Docs:** a feature overview with screenshots in `README.md`; a new `docs/` folder as the home
  of all documentation (`docs/README.md` index, `profiles.md`, `home-and-schedule.md`,
  `episode-tags.md`, `direct-play.md`, `remote-and-navigation.md`, `building-webos.md`);
  `webos/README.md` stays the full webOS reference and points to it. Screenshots in
  `docs/images/` (WebP, made-up profiles).
- **Contribution rules:** `CONTRIBUTING.md` rewritten for this project (issue first, tests with
  regression tests and docs in every PR, the "(WIP)" rule), `AGENTS.md` extended (workflow,
  checks, before/after screenshots against a throwaway server), a pull request checklist, issue
  templates, and the `PR ready (WIP rule)` workflow (`.github/workflows/pr-ready.yml`,
  `.github/scripts/pr-ready.sh` with its tests). The existing workflows are unchanged.

## GPL-3.0 compliance checklist

- [x] **Prominent modification notices with dates (§5a):** this file, `NOTICE`, the README's
      "Credits & License", and the git history (every change is a dated commit).
- [x] **License files untouched:** `LICENSE` (GPL-3.0) and `LICENSES.md` (MPL-2.0 modules) are
      unchanged, and so are the copyright and license notices in the sources. No MPL-2.0 file
      has been modified; if one is, it stays MPL-2.0 and its source stays available here.
- [x] **Same license, no additional restrictions.**
- [ ] **Source for every `.ipk` we distribute (§6):** releases are built only from a version
      tag by `.github/workflows/release.yml`, and each GitHub Release links that tag's source.
      Ticked when the first release is published.
