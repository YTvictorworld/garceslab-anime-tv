# Contributing to Garceslab Anime TV

Thanks for helping! Garceslab Anime TV is the LG webOS app of a small, self-hosted project
derived from Seanime Tenji and Seanime (GPL-3.0). Contributions of any size are welcome, and
**AI-assisted contributions are welcome too**: there are no special rules about using AI tools,
the same checks apply to every change. AI coding agents: read [AGENTS.md](AGENTS.md).

The server and web interface have their own repository and guide:
[garceslab-anime-server](https://github.com/YTvictorworld/garceslab-anime-server/blob/main/CONTRIBUTING.md).

## The rules in short

1. **Every change starts with an Issue.** Describe the bug or the idea first
   ([bug report](https://github.com/YTvictorworld/garceslab-anime-tv/issues/new?template=bug_report.yml),
   [feature request](https://github.com/YTvictorworld/garceslab-anime-tv/issues/new?template=feature_request.yml)).
2. **Then open a Pull Request that references it** with `Closes #N` (or `Fixes #N`,
   `Resolves #N`) in the description.

   If your change covers only part of an issue, don't write `Part of #N` (the PR ready check
   doesn't accept it, and `Closes #N` would close the whole issue too early). Use a
   **sub-issue**: create one under the parent issue for exactly your scope (GitHub → the parent
   issue → Sub-issues → Create sub-issue, or ask a maintainer), and write `Closes #<sub-issue>`
   in the PR. The parent issue closes when all its sub-issues are done.
3. **Every PR adds or updates tests** in `tests/`, including **regression tests**:
   - a **bug fix** includes a test that **fails before the fix and passes after** it;
   - a **feature** includes tests that **lock its behaviour**.
4. **Every PR documents what it changes in [`./docs`](docs/README.md)**: a new doc or an update
   (and a line in the [docs index](docs/README.md) for a new doc). Update
   [webos/README.md](webos/README.md) too when webOS behaviour changes.
5. **A PR is "ready" only when every check below passes.** If even one is failing or missing,
   the title starts with **`(WIP)`** and the PR stays a **draft**.
6. **A PR that changes UI behaviour is tested on a real LG TV before it is merged.** No TV?
   Label it `needs-tv-test` and ask for a test ([Testing on a real TV](#testing-on-a-real-tv)).

## When a PR is ready

The [pull request template](.github/pull_request_template.md) has this checklist. Tick every
box; for one that doesn't apply (e.g. screenshots for a change without UI), write "n/a" next to
it and tick it.

- [ ] **Linked issue:** `Closes #N` in the description.
- [ ] **Tests:** added or updated, with a regression test for a bug fix and tests that lock the
      behaviour of a feature.
- [ ] `npm test` passes.
- [ ] `npx tsc --noEmit -p .` passes (the `app/_layout.tsx` global.css TS2882 error is
      pre-existing and known).
- [ ] `npm run build:webos` builds the `.ipk`.
- [ ] **UI changes:** BEFORE and AFTER screenshots at **1920×1080** attached to the PR, and
      saved under `docs/images/` when they document a feature. Screenshots contain **no
      private data** (see below).
- [ ] **UI behaviour changes:** tested on a real LG webOS TV (model/webOS version), **or** not
      tested: `needs-tv-test` label added and the maintainer asked to test
      ([Testing on a real TV](#testing-on-a-real-tv)). Tick the one that applies and write
      "n/a" on the other.
- [ ] **Docs** updated in `./docs`.
- [ ] **No secrets or private data** (IP addresses, server URLs, tokens, passwords, emails,
      real names) in code, commits or images.
- [ ] `MODIFICATIONS.md` updated if the change modifies code that comes from Seanime Tenji.

### The "(WIP)" check

The **PR ready (WIP rule)** workflow ([`.github/workflows/pr-ready.yml`](.github/workflows/pr-ready.yml))
runs on every PR and every edit of its title or description. If the title does **not** start
with `(WIP)` and any of these is true, it fails and labels the PR `wip`:

- no linked issue in the description (`Closes|Fixes|Resolves #N`);
- a checklist box is not ticked;
- a required CI job (*Tests and webOS .ipk*, *Secrets (gitleaks)*) failed or hasn't finished.

While the PR has the **`needs-tv-test`** label the check also fails, with *"Waiting for a
real-TV test: remove needs-tv-test after testing"*, so it can't be merged; that alone doesn't
need `(WIP)` or the `wip` label (the PR can be ready for review). Adding or removing a label
re-runs the check.

With a `(WIP)` title it passes and lists what is still missing. When everything is green,
remove `(WIP)` and mark the PR ready for review. The rule is in
[`.github/scripts/pr-ready.sh`](.github/scripts/pr-ready.sh), with tests in `pr-ready_test.sh`
(`bash .github/scripts/pr-ready_test.sh`).

## Testing on a real TV

Desktop Chromium is not a TV. A PR that **changes UI behaviour** (anything the TV user sees or
does: layout, focus and remote navigation, Back, the player, playback, subtitles) must be tried
on a real **LG webOS TV** before it is merged. Screenshots alone aren't enough for focus,
remote or player behaviour.

**If you have a TV,** test it (the checklist in [docs/testing-on-tv.md](docs/testing-on-tv.md))
and write the model and webOS version in the PR's "Tested on a real LG webOS TV" box.

**If you don't have a TV:**

1. Say so in the PR and add the **`needs-tv-test`** label.
2. Tick *"Not tested on a real TV"* in the template (and "n/a" on *"Tested on a real LG webOS
   TV"*).
3. Mention the maintainer, **@YTvictorworld** (currently the only one who can test on a TV),
   in the PR description and ask for a TV test, with what to check: the steps, the screens and
   the expected result. The template writes the handle in backticks so that opening a PR doesn't notify anyone; remove the backticks to send the mention.

**PRs with `needs-tv-test` are tested on the TV in the GA Test app**
(`app.garceslab.anime.test`), which CI builds as a workflow artifact (`ga-test-pr<N>-<sha7>`,
see [docs/testing-on-tv.md](docs/testing-on-tv.md#the-ga-test-app)); **never install a PR
build over the main app** (`app.seanime.tenji`).

Whoever tests on the TV comments the result on the PR (device and webOS version, what was
checked, photos or videos if useful), then **replaces `needs-tv-test` with `tv-tested`**. A PR
with `needs-tv-test` can be ready for review, but it **must not be merged**: the *PR ready
(WIP rule)* check fails until the label is gone.

AI agents without access to a TV always follow these steps for a UI behaviour change.

## Setting up

You need **Node.js** 22.13 or newer (or 24.3+) and npm.

```sh
npm ci            # if it fails with ETARGET: npm install --no-save expo@58.0.15
```

## Running the checks

```sh
npm test                # node:test unit tests in tests/ (a few seconds)
npx tsc --noEmit -p .   # typecheck
npm run build:webos     # writes dist/webos/app.seanime.tenji_<version>_all.ipk (2-3 minutes)
```

CI ([`.github/workflows/webos.yml`](.github/workflows/webos.yml)) runs the tests and the build on
every pull request. Unit tests import pure modules (no react-native imports) straight from
`src/`; put the logic you want to test in such a module.

## Trying it out

```sh
npm run dev:webos       # dev server on http://localhost:8083
npm run serve:webos     # serves the built app (dist/webos/app) on http://localhost:8090
```

Open it in Chromium at **1920×1080**; arrow keys, Enter and Escape act as the remote. Point it
at a **throwaway local server** with made-up profiles, never someone's real server. Installing
on a TV: [docs/building-webos.md](docs/building-webos.md).

The same codebase still builds the Android, iOS, Android TV and tvOS apps of Seanime Tenji
(`npx expo run:android`, `npm run dev:ios`); this project only maintains and tests the webOS
build. Don't change the other platforms' behaviour unless the issue asks for it.

## Screenshots

- Take BEFORE (base branch) and AFTER (your branch) at 1920×1080 against the same throwaway
  server and data; [AGENTS.md](AGENTS.md#before-and-after-screenshots) shows how with headless
  Chromium.
- Check every image before you commit it: no real names, IP addresses, server URLs, emails,
  tokens, time zones or file paths with user names. Anime covers and banners from AniList are
  fine; don't add fan art.
- Save them as WebP (or compressed PNG), at most about 1600 px wide, without metadata, e.g.
  `magick shot.png -strip -resize '1600x1600>' -quality 78 docs/images/shot.webp`.

## Commits and branches

- Branch from `main`: `feature/<name>`, `fix/<name>` or `docs/<name>`.
- [Conventional Commits](https://www.conventionalcommits.org/) are suggested:
  `feat(tv): …`, `fix(webos): …`, `docs: …`, `test: …`. Explain the why in the body.
- Never commit secrets, server addresses, logs (`debug-logs/`) or fixtures with real user data.
  CI runs gitleaks on the whole history.

## License and notices

Garceslab Anime TV is derived from Seanime Tenji (© AlkindiX and contributors) and Seanime
(© 5rahim and contributors) and is not our property. Keep every existing copyright and license
notice; the native modules in [LICENSES.md](LICENSES.md) stay under the MPL-2.0. Code that comes
from Seanime Tenji and is changed in a meaningful way gets an entry in
[MODIFICATIONS.md](MODIFICATIONS.md) (GPL-3.0 section 5a). By contributing you agree that your
contribution is licensed under the GPL-3.0 (MPL-2.0 for those modules), like the rest of the
project.

Please don't report Garceslab Anime issues to Seanime or Seanime Tenji.
