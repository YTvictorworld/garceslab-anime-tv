# Subtitles: which track starts

When an episode starts, the TV turns on one subtitle track by itself. This page explains which
one, and how to make it Spanish (or any other language). It applies to every way the TV plays
an episode: debrid direct play (subtitles read from the MKV on the TV), streams relayed through
the server, and files added during playback.

## The rule

1. The profile's **Preferred Subtitle Languages** (a comma-separated list) are tried in order.
   The first language in the list that the file has wins, **whatever track the file marks as
   default**. A file whose English track is the default but which also has Spanish starts in
   Spanish when Spanish comes first in the list.
2. Only **full** tracks count. Tracks flagged *forced* in the file, named "Forced" /
   "Forzados", or whose name has one of the **Ignored Labels** (default: `signs & songs,
   signs, songs, sign, song`) are skipped. A release with "Spanish (Signs)" and "Spanish"
   starts on "Spanish".
3. If no full track is in a preferred language, the web player shows the first full track of
   the file (mpv keeps the file's default track).
4. The choice is made when the tracks are known and again when more appear (the MKV header can
   list more tracks than the first list). It is also made again when the profile's preferences
   arrive or change while the episode plays (the profile sync can finish after playback
   started, or you save new languages in the player). Once you pick a track (or *Off*) in the
   player, the TV leaves your choice alone for the rest of the episode.

## How languages are matched

Each track's language comes from its tag (the IETF tag such as `es-419` first, else the
three-letter code such as `spa`) and from language names in its title. These all mean
Spanish:

| In the preference or the file | Examples |
|---|---|
| Codes | `es`, `spa`, `esp` |
| Regional tags | `es-419`, `es-ES`, `es-MX`, `es_419` |
| Names (whole words) | Spanish, Español, Espanol, Castellano, Latino, "Spanish (Latin America)" |

Languages are compared by code, never as text inside other words, so `es` doesn't match
"Portuguese", "Japanese" or "Chinese". A track tagged `eng` but named "Spanish" counts as Spanish
too (Matroska tags a track `eng` when the muxer wrote no language).

A regional tag in the preference asks for that region first: `es-419, es` picks Latin American
Spanish when the release has it, else any Spanish track. The region of a track comes from its
tag or its name ("Latin America", "Latino" → 419; "Spain", "España", "Castellano" → ES). A
plain `es`/`spa`/`spanish` takes the first Spanish track in the file.

## The default: Spanish first

The default **Preferred Subtitle Languages** are `es-419, spa, es, spanish, eng, en, english`:
Latin American Spanish first, then any Spanish, then English when the release has no Spanish
(Seanime Tenji's default was English only). Episodes start in Spanish without setting anything.

Player preferences follow the profile (see [profiles.md](profiles.md#what-follows-the-profile)).
A new profile takes this TV's values, so it starts with this default too.

### Profiles and TVs that had the old default

Until this change the default was `eng, en, english`, and every profile was saved with it the
first time it was used on a TV. The app can't tell that value from one typed in by hand, so a
saved value **equal to the old default** (same list, ignoring case and spaces) is treated as
never customised and moved to the new default **once**:

- **This TV's own preferences:** when the app first reads them after the update. A marker
  (`subtitleDefaultVersion: 2`, kept on the TV) makes sure it never happens again.
- **Each profile:** when the profile is entered on this TV. The new value is written back to
  the profile on the server through the normal sync (only `preferredSubtitleLanguages` is
  sent, nothing else changes), and the TV remembers that it checked that profile (per server
  and profile). If the save fails it is tried again the next time.
- Any other value (`eng, en`, `jpn`, `spa, es`...) is never touched, and the profile is
  marked checked anyway. Choosing `eng, en, english` again by hand later is kept: the profile
  was already checked.

The marker lives on the TV, so a second TV that never saw a profile before this update could
move a hand-set `eng, en, english` once more; set it again there if that happens.

## Changing the languages

1. Start any episode with the profile.
2. Open the player settings → **Audio & Subtitles** → **Default Language** (under Subtitles).
3. Set **Preferred Subtitle Languages** to, for example:
   - `eng, en, english`: English only;
   - `spa, es, spanish, eng`: the first Spanish track, then English.
4. Save. The change applies to the episode that is playing (unless you picked a track by hand)
   and is saved to the profile on the server, so every TV uses it.

The server's subtitle-aware auto-select (choosing a debrid release that has the profile's
subtitles) reads the same setting, so Spanish there also makes it prefer releases with Spanish
subtitles. The server-wide *auto-select profile* languages are a separate setting and don't
choose the TV's subtitle track.

## Code and tests

- `src/lib/player/track-matching.ts`: the matching (`findPreferredTrack`, `findFallbackTrack`),
  the choice (`chooseSubtitleTrack`) and when it runs (`createSubtitleAutoSelect`). Any new
  subtitle track the player lists, such as a translated Spanish track added later, is chosen by
  these same rules. The language table matches the server's
  (`internal/torrents/trackprobe/language.go`).
- `src/lib/player/use-mpv-player.ts`: applies it to the player.
- `src/lib/player/subtitle-defaults.ts`: the default and the old-default migration (device in
  `player-preferences.ts`, profiles in `player-prefs-sync.ts`); tests in
  `tests/subtitle-defaults.test.ts`.
- The forced flag comes from the MKV (`src/lib/player/direct-play-session.ts`, direct play) or the
  server's MKV metadata (`streamedSubtitleTracks` in `src/lib/player/direct-stream-format.ts`,
  relayed play).
- `tests/track-matching.test.ts`: the MultiSub fixture (`tests/fixtures/mkv/multisub.mkv`,
  English default, then `es-419` and `es-ES`), tags and names, forced and signs tracks,
  `es` vs Portuguese/Japanese, the fallback, and late preferences vs a manual choice.
