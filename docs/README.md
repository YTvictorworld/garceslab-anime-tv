# Garceslab Anime TV documentation

All documentation of the **TV app** lives in this folder. The server and web interface have
their own docs in
[garceslab-anime-server/docs](https://github.com/YTvictorworld/garceslab-anime-server/tree/main/docs)
(including the [self-hosting guide](https://github.com/YTvictorworld/garceslab-anime-server/blob/main/docs/self-hosting-webos.md)).

Garceslab Anime TV is derived from Seanime Tenji (© AlkindiX and contributors) and Seanime
(© 5rahim and contributors), under the GPL-3.0; see [Credits & License](../README.md#credits--license).
It is published only for self-hosting with LG webOS TVs: there is no hosted service.

## Using the app

| Doc | What it covers |
|---|---|
| [profiles.md](profiles.md) | "Who's watching?", PINs, creating and editing profiles on the TV, the avatar switcher, per-profile player preferences, favourites |
| [home-and-schedule.md](home-and-schedule.md) | Home screen, Continue watching and Upcoming cards, the anime page, episode cards that start in place, the Schedule calendar, the visual refresh |
| [episode-tags.md](episode-tags.md) | CANON / FILLER / RECAP / MIX pills, Skip filler and recaps, the Up next card |
| [direct-play.md](direct-play.md) | Direct play of debrid streams, subtitles read from the MKV, retries, up to three viewers |
| [tv-updates.md](tv-updates.md) | The update banner: installing a new build only after confirming on the TV, See what's new, Settings → Updates, the server API it uses |
| [remote-and-navigation.md](remote-and-navigation.md) | Remote keys, Magic Remote, the on-screen keyboard and search suggestions |

## Building and developing

| Doc | What it covers |
|---|---|
| [building-webos.md](building-webos.md) | Building the `.ipk`, installing it on a TV, test builds, releases |
| [testing-on-tv.md](testing-on-tv.md) | The real-TV test for UI behaviour changes: the `needs-tv-test` / `tv-tested` labels, asking for a test, the GA Test app CI builds for it, what to check on the TV |
| [releasing.md](releasing.md) | Versions (1.0.0 onwards, server and TV together), the nightly and stable channels (nightly assets and their JSON formats for updaters), cutting a release with the workflow, verifying it, rolling back |
| [../webos/README.md](../webos/README.md) | The full webOS reference: playback and formats, relay service, device info, debug logs, what is not yet verified on a TV |
| [../tizen/README.md](../tizen/README.md) | Samsung Tizen build (untested on a TV) |
| [../CONTRIBUTING.md](../CONTRIBUTING.md) | Issue first, the pull request checklist and the "(WIP)" rule, squash merges and Conventional Commit PR titles, running the checks |
| [../AGENTS.md](../AGENTS.md) | Guide for AI coding agents: layout, commands, checks, screenshots, privacy |
| [../MODIFICATIONS.md](../MODIFICATIONS.md) | Every change compared with Seanime Tenji 0.4.0, with dates (GPL-3.0 §5a) |
| [../LICENSES.md](../LICENSES.md) and [../NOTICE](../NOTICE) | Licences of the app and its modules, third-party data |

Screenshots used by the docs are in [images/](images/). They come from test setups with made-up
profiles; anime titles and art are AniList's public data.

## Roadmap

- **1.0 release:** the `.ipk` and its checksum on GitHub Releases, built from a git tag
  ([how](releasing.md)).
- **Self-hosted subtitle translation (planned):** an optional service on your own Garceslab
  Anime server that translates a release's subtitles into the profile's language when no release
  has them, so nothing is sent to a third-party translation service. The TV would show the
  translated track like any other. It is not designed in detail yet and will get its own doc
  here when work starts.
- **Own app id** instead of the inherited `app.seanime.tenji`.
