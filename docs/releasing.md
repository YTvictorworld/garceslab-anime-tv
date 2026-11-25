# Releasing

How Garceslab Anime TV is versioned and how a release is cut. The server's side, including the
shared rules, is in the server repository's
[docs/releasing.md](https://github.com/YTvictorworld/garceslab-anime-server/blob/main/docs/releasing.md);
both are released together.

## Versions

- Garceslab Anime has its **own version**, starting at **1.0.0**, following
  [semantic versioning](https://semver.org/): `MAJOR.MINOR.PATCH`, no pre-release suffix (webOS
  and Tizen only accept numeric versions).
- Releases are git tags **`vX.Y.Z`**. A tag is never moved or reused: a broken release is
  fixed by a new version.
- **The server and the TV app are released together, with the same version**: TV `v1.0.0`
  goes with server `v1.0.0`, even if only one of them changed.
- The source of the version is **`version` in `package.json`**. The same value must be in
  `package-lock.json` (both `version` fields at the top) and in `app.config.ts`
  (`const version`, shown in Settings as `v1.0.0`). `tests/app-version.test.ts` fails if they
  differ. `webos/build.mjs` writes it into `appinfo.json` and the file name
  (`app.seanime.tenji_1.0.0_all.ipk`); `tizen/build.mjs` writes it into `config.xml`.
- The app id stays **`app.seanime.tenji`**, and 1.0.0 is higher than Seanime Tenji's 0.4.0, so a
  release installs over an existing copy and keeps its settings.
- The in-app "App update available" check compares the app's version with the latest release
  of **this repository** (`src/lib/app-release.ts`).
- The app checks the **server's Seanime version** (`status.version`, 3.10.x), not its
  Garceslab version: it refuses servers below `MIN_SERVER_VERSION` (3.8.0). The server keeps
  reporting Seanime's version there and its own version in `garceslabVersion`.
- `CHANGELOG.md` is Seanime Tenji's changelog up to 0.4.0; Garceslab Anime TV's release notes
  are on [GitHub Releases](https://github.com/YTvictorworld/garceslab-anime-tv/releases).

## Who and when

- Only the **maintainer** cuts releases.
- Only **after the full TV test**: the `.ipk` built from `main` installed on a real LG TV
  (an LG C3, webOS 23, is the reference) against a server built from the server's `main`, with
  the features in [README.md](README.md) checked (profiles, home, playback with direct play and
  subtitles, episode tags, remote).
- Server first, then the TV app, with the same version.

## Cutting a release

1. **Bump the version** (skip for 1.0.0, which is already set): an issue and a pull request
   that change `package.json`, `package-lock.json` and `app.config.ts`
   (`npm version X.Y.Z --no-git-tag-version` updates the first two), plus the server's
   `GarceslabVersion` in its own pull request. Merge both.
2. Release the server (its doc).
3. **TV app:** GitHub → *Actions* → **Release (webOS .ipk)** → *Run workflow*:
   - *Use workflow from*: **`main`**
   - *version*: the version without `v`, e.g. **`1.0.0`**
   - *confirm*: **`publish`**

   Or from a terminal:

   ```sh
   gh workflow run release.yml -R YTvictorworld/garceslab-anime-tv --ref main \
     -f version=1.0.0 -f confirm=publish
   gh run watch -R YTvictorworld/garceslab-anime-tv
   ```
4. **Verify** (below).

Pushing a tag by hand (`git tag v1.0.0 && git push garceslab v1.0.0`) still starts the same
workflow; it fails if the tag doesn't match `package.json`. The *Run workflow* way is preferred
because it checks everything **before** a tag exists.

## What the workflow does

[`.github/workflows/release.yml`](../.github/workflows/release.yml), job by job:

1. **Check the request** (read-only): runs the tests of the release rules, then
   [`.github/scripts/release-check.sh`](../.github/scripts/release-check.sh). It **fails with
   a message** (an error annotation on the run) when *confirm* is not exactly `publish`; when it
   runs on a branch other than `main` or a tag that isn't `vX.Y.Z`; when, from `main`, *version*
   is empty, isn't `MAJOR.MINOR.PATCH` or its tag already exists; and when the version isn't the
   one in `package.json`. Nothing is built or published then.
2. **Tests and webOS .ipk** (read-only token): `npm ci`, `npm test` and `npm run build:webos`
   on the exact commit the run started on, checks that `app.seanime.tenji_X.Y.Z_all.ipk` was
   produced and writes `SHA256SUMS.txt`.
3. **Tag and GitHub Release** (`contents: write`): checks the checksums of the built files,
   creates the tag `vX.Y.Z` at that commit (when run from `main`; only now, so a failed build
   leaves no tag), and creates the GitHub Release with the `.ipk` and `SHA256SUMS.txt`. Its notes
   link the matching server release, the exact source tree and commit (GPL-3.0 §6), `NOTICE` and
   `MODIFICATIONS.md`.

Only one release runs at a time (`concurrency: release`). A tag created by the workflow doesn't
start the workflow a second time (GitHub doesn't trigger workflows from its own token's
pushes).

If a run fails after the tag was created (e.g. at the release step), run the workflow again on
the tag (*Use workflow from* = `vX.Y.Z`, *confirm* = `publish`).

## Verifying a release

```sh
gh release download v1.0.0 -R YTvictorworld/garceslab-anime-tv -D /tmp/ga-tv-1.0.0
cd /tmp/ga-tv-1.0.0 && sha256sum -c SHA256SUMS.txt     # app.seanime.tenji_1.0.0_all.ipk: OK
git ls-remote --tags https://github.com/YTvictorworld/garceslab-anime-tv v1.0.0
```

- Install the downloaded `.ipk` on the TV ([building-webos.md](building-webos.md#installing-on-the-tv)):
  Settings shows **v1.0.0**, and the app connects to the server of the same version.
- The release page lists the `.ipk`, `SHA256SUMS.txt`, the source link and the commit.

## Rolling back

Tags and releases stay; roll back by installing the previous version and fixing forward.

- **On a TV:** download the previous release's `.ipk` and install it. webOS may refuse a lower
  version over a higher one; then remove the app first
  (`ares-install --device tv --remove app.seanime.tenji`, or long-press it in the launcher) and
  install the older `.ipk`. Removing the app clears its saved server address and settings on
  the TV (the server keeps profiles and progress).
- **The broken release:** edit its notes to say "Don't use: see vX.Y.Z+1" (or mark it as a
  pre-release so it isn't "latest" and the in-app update check stops offering it), fix it in a
  pull request, bump the PATCH version in both repositories and release again.
- **A tag created by mistake with no release:** `git push --delete garceslab vX.Y.Z`, then run
  the workflow from `main` again.

## Tests

- `bash .github/scripts/release-check_test.sh`: the release rules (pass and fail cases, including
  the regression "run from main without *confirm* fails with a message"). CI runs it in the
  *Tests and webOS .ipk* job; the release workflow runs it before every release.
- `tests/app-version.test.ts` (`npm test`): the version is the same everywhere, the app id is
  unchanged, the update check uses this repository and the minimum server version is still a
  Seanime 3.x version.
- CI also checks that `npm run build:webos` produces `app.seanime.tenji_<package.json version>_all.ipk`.
