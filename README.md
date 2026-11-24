<p align="center">
<img src="branding/logo.svg" alt="Garceslab Anime" width="80px"/>
</p>

<h1 align="center">Garceslab Anime TV</h1>

<p align="center">
The LG webOS TV app for a self-hosted Garceslab Anime server.<br/>
Based on Seanime Tenji and Seanime (GPL-3.0).
</p>

---

> **Not original work.** Garceslab Anime TV is derived from
> [Seanime Tenji](https://github.com/AlkindiX/seanime-tv) (© AlkindiX and contributors), itself
> based on Seanime Tenji and [Seanime](https://github.com/5rahim/seanime) (© 5rahim and
> contributors). Their authors keep their copyright; this project only adds modifications, under
> the same licenses. See [Credits & License](#credits--license).

**Status: early development.** The app is tested on an LG TV with **webOS 23**. Other webOS
versions (6.0 and newer) should work but haven't been tried; see
[webos/README.md](webos/README.md) for details.

## What it is

A TV interface for browsing and playing your own Garceslab Anime library with the remote:
D-pad focus, Back, OK, media keys and the Magic Remote pointer. It is published only so that
people can **self-host a setup that works with LG webOS TVs**.

There is **no hosted service** and no content: the app connects to a server **you** run on
your own network.

> [!IMPORTANT]
> Garceslab Anime does not provide, host or distribute any media content. Users are responsible
> for obtaining media through legal means and for complying with the laws of their country.

## Which server it needs

- **[Garceslab Anime](https://github.com/YTvictorworld/garceslab-anime-server)** (recommended): it
  serves streams to the TV's native player correctly (requests without an HTTP `Range`
  header), so no proxy is needed in front of it.
- **Seanime v3.10.x** also works for now: today the app is Seanime Tenji plus TV fixes and
  talks to the same API. Debrid streams on webOS may fail to start with a stock Seanime
  server because of the `Range` issue above. Future versions (local profiles) will need the
  Garceslab Anime server for those features, and will skip them on servers that don't offer
  them.

## Install on an LG TV

Download the `.ipk` and `SHA256SUMS.txt` from the
[latest release](https://github.com/YTvictorworld/garceslab-anime-tv/releases) and check the
file (`sha256sum -c SHA256SUMS.txt`). Then install it with the TV in **Developer Mode**:

1. Install LG's *Developer Mode* app on the TV (from the LG Content Store), sign in with an LG
   developer account and turn Developer Mode on. The TV restarts. Developer Mode expires
   after some time unless you extend it in the app.
2. Install it from a computer on the same network, either way:
   - **[webOS Dev Manager](https://github.com/webosbrew/dev-manager-desktop)**: add the TV
     (Developer Mode passphrase), then *Apps › Install* and pick the `.ipk`.
   - **[webOS CLI](https://webostv.developer.lge.com/develop/tools/cli-installation)**
     (`npm install -g @webos-tools/cli`):
     ```sh
     ares-setup-device                       # add the TV once
     ares-install --device tv garceslab-anime-tv.ipk   # the downloaded file
     ares-launch --device tv app.seanime.tenji
     ```
3. Open the app and enter your server's address, for example `http://192.0.2.10:43211`, and
   the server password if you set one.

**If the upload fails.** On some TVs the Developer Mode SFTP service is broken, so
`ares-install` and Dev Manager fail while copying the file even though the TV is reachable.
SSH commands still work, so you can copy the file over SSH and ask the TV's installer to
install it, which is what `ares-install` does internally. With the key from
`ares-setup-device` (or Dev Manager), on the TV's Developer Mode SSH port (9922, user
`prisoner`):

```sh
ssh -p 9922 -i <key> prisoner@<tv-ip> 'cat > /media/developer/temp/app.ipk' < garceslab-anime-tv.ipk
ssh -p 9922 -i <key> prisoner@<tv-ip> \
  'luna-send-pub -n 1 -f luna://com.webos.appInstallService/dev/install "{\"id\":\"com.ares.defaultName\",\"ipkUrl\":\"/media/developer/temp/app.ipk\",\"subscribe\":true}"'
```

Rooted TVs can also install the `.ipk` from the
[Homebrew Channel](https://www.webosbrew.org/).

The app id is still `app.seanime.tenji` (inherited), so installing Garceslab Anime TV
**replaces** an installed Seanime Tenji instead of adding a second app. A later version will
move to its own id; the old app will then have to be uninstalled by hand.

## Build it yourself

```sh
npm ci
npm run build:webos     # writes dist/webos/app.seanime.tenji_<version>_all.ipk
```

If the TV's time zone is set wrong, the airing times can be fixed at build time with
`EXPO_PUBLIC_TV_TIME_ZONE=<IANA zone>` (a local option; release builds don't set it).

## Releases and versions

Releases are built by GitHub Actions (`.github/workflows/release.yml`) when a version tag is
pushed: the workflow builds the `.ipk`, computes its SHA-256 and attaches both to a GitHub
Release. Versions are `vMAJOR.MINOR.PATCH` and must match `version` in `package.json` (webOS
reads the version from there). They continue from Seanime Tenji 0.4.0, so the first release
is meant to be **v0.5.0**: a higher version lets the TV update an installed copy in place.

## Development

Contributions are welcome: open an issue first for anything large. CI runs the tests and
builds the `.ipk` on every pull request. Changes compared with Seanime Tenji are listed in
[MODIFICATIONS.md](MODIFICATIONS.md); the webOS details are in
[webos/README.md](webos/README.md).

## Credits & License

Garceslab Anime TV is **not originally our code**. It is derived from:

- **[Seanime Tenji](https://github.com/AlkindiX/seanime-tv)**, © AlkindiX and contributors,
  including its LG webOS port; this repository is derived from its version 0.4.0;
- **[Seanime Tenji](https://github.com/5rahim/seanime-tenji)** and
  **[Seanime](https://github.com/5rahim/seanime)**, © 5rahim and contributors.

Episode tags (CANON / FILLER / RECAP on episode cards) show [MyAnimeList](https://myanimelist.net)
episode data, which the Garceslab Anime server reads through the Jikan-compatible APIs
[Tenrai](https://tenrai.org), [jikan-edge](https://jikan.lucashdo.com) and
[Jikan](https://jikan.moe). The data belongs to MyAnimeList; this project is not affiliated with
MyAnimeList or with these APIs.

The original authors keep the copyright on their work, and this project does not claim
ownership of it. All original copyright and license notices are preserved unchanged, and the
full git history is kept, so every upstream commit keeps its author.

The modifications made by the Garceslab Anime contributors are distributed under the same
licenses: the [GNU General Public License v3.0](LICENSE) for the app, and the Mozilla Public
License 2.0 for the native modules that use it (listed in [LICENSES.md](LICENSES.md); none has
been modified so far), with no additional restrictions. The modifications and their dates are
listed in [MODIFICATIONS.md](MODIFICATIONS.md); see also [NOTICE](NOTICE).

"Seanime" and "Seanime Tenji", and their logos, belong to their respective owners and are used
only to say where this project comes from. Garceslab Anime is an independent, unofficial
project, not affiliated with or endorsed by Seanime or Seanime Tenji: please don't report
Garceslab Anime issues to them.
