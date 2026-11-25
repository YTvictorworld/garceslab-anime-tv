# Building and installing the webOS app

The webOS build is the TV interface rendered with React Native Web and packaged as a webOS web
app (`.ipk`), with a small JS service that relays the server's WebSocket. Full details of the
build (CSS/JS lowering for Chromium 79, the relay service, device info) are in
[webos/README.md](../webos/README.md).

## Requirements

- Node.js 22.13 or newer (or 24.3+) and npm.
- An LG TV with **webOS 6.0 or newer** (tested on webOS 23), on the same network as the server.
- The Garceslab Anime server reachable from the TV, listening on `0.0.0.0` with its port open.

## Build

```sh
npm ci                  # if it fails with ETARGET: npm install --no-save expo@58.0.15
npm test                # unit tests
npx tsc --noEmit -p .   # typecheck
npm run build:webos     # -> dist/webos/app.seanime.tenji_<version>_all.ipk
```

`dist/webos/app` is the unpacked app and `dist/webos/service` its JS service
(`ares-package dist/webos/app dist/webos/service` packages them too). `npm run serve:webos`
serves the built app on port 8090 for a desktop browser at 1920×1080; `npm run dev:webos` is the
dev server on port 8083 (arrow keys, Enter and Escape act as the remote).

Build-time options: `EXPO_PUBLIC_TV_TIME_ZONE`, `EXPO_PUBLIC_TV_VISUAL_OFF`,
`EXPO_PUBLIC_DIRECT_PLAY=0` (see [home-and-schedule.md](home-and-schedule.md) and
[direct-play.md](direct-play.md)).

### Side-by-side test build

To try a build without replacing the app you use every day, package it under another app id;
it installs as a second app with its own saved server, profile and relay service:

```sh
WEBOS_APP_ID=app.garceslab.anime.visualtest WEBOS_APP_TITLE="GA Visual Test" npm run build:webos
ares-install --device tv dist/webos/app.garceslab.anime.visualtest_*.ipk
ares-install --device tv --remove app.garceslab.anime.visualtest   # when done
```

## Installing on the TV

Prebuilt `.ipk` files will be on the
[GitHub Releases](https://github.com/YTvictorworld/garceslab-anime-tv/releases) page with a
`SHA256SUMS.txt` (*coming with 1.0*); check a download with `sha256sum -c SHA256SUMS.txt`.

1. Install LG's **Developer Mode** app on the TV (LG Content Store), sign in with an LG
   developer account and turn Developer Mode on. The TV restarts. Developer Mode expires after
   a while unless you extend it in the app.
2. From a computer on the same network, either:
   - **[webOS Dev Manager](https://github.com/webosbrew/dev-manager-desktop):** add the TV
     (Developer Mode passphrase), then *Apps › Install* and pick the `.ipk`; or
   - the **[webOS CLI](https://webostv.developer.lge.com/develop/tools/cli-installation)**
     (`npm install -g @webos-tools/cli`):
     ```sh
     ares-setup-device                                 # add the TV once
     ares-install --device tv garceslab-anime-tv.ipk   # or dist/webos/app.seanime.tenji_*.ipk
     ares-launch --device tv app.seanime.tenji
     ```
3. Open the app, enter your server's address (for example `http://192.0.2.10:43211`) and the
   server password.

Rooted TVs can also install the `.ipk` from the [Homebrew Channel](https://www.webosbrew.org/).

**If the upload fails.** On some TVs the Developer Mode SFTP service is broken, so
`ares-install` and Dev Manager fail while copying the file even though the TV is reachable. SSH
still works, so copy the file over SSH and ask the TV's installer to install it (what
`ares-install` does internally). With the key from `ares-setup-device`, on the Developer Mode SSH
port (9922, user `prisoner`):

```sh
ssh -p 9922 -i <key> prisoner@<tv-ip> 'cat > /media/developer/temp/app.ipk' < garceslab-anime-tv.ipk
ssh -p 9922 -i <key> prisoner@<tv-ip> \
  'luna-send-pub -n 1 -f luna://com.webos.appInstallService/dev/install "{\"id\":\"com.ares.defaultName\",\"ipkUrl\":\"/media/developer/temp/app.ipk\",\"subscribe\":true}"'
```

The app id is still `app.seanime.tenji`, so it **replaces** an installed Seanime Tenji.

## Releases and versions

Versions are `vMAJOR.MINOR.PATCH`, starting at **1.0.0** (the project's own versioning; the
server is released with the same version). The version lives in `package.json` (also in
`package-lock.json` and `app.config.ts`, kept equal by `tests/app-version.test.ts`); the build
writes it into `appinfo.json` and the file name, e.g. `app.seanime.tenji_1.0.0_all.ipk`. 1.0.0
is higher than Seanime Tenji's 0.4.0, so a release installs over an existing copy in place.

Releases are built by GitHub Actions (`.github/workflows/release.yml`), started by the
maintainer from `main` with *Run workflow* (`version` = `X.Y.Z`, `confirm` = `publish`) after
the full test on a TV: it checks the version, tests, builds the `.ipk`, creates the tag and a
GitHub Release with the `.ipk` and `SHA256SUMS.txt`, linking that tag's source (GPL-3.0 §6). A
wrong request fails with a message instead of being skipped. Pushing a `vX.Y.Z` tag by hand
still works. The full procedure, verification and rollback: [releasing.md](releasing.md).

CI (`.github/workflows/webos.yml`) runs the tests and builds the `.ipk` on every pull request.

## Debug logs

Settings › **Diagnostics** keeps logs on the TV and can stream them to a computer on the same
network (`npm run debug:logs`, port 8787). Tokens and passwords are redacted before logs leave
the TV. Details: [webos/README.md](../webos/README.md#debug-logs).
