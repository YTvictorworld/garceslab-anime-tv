<!--
Title: start it with "(WIP)" and keep the PR as a draft until EVERY box below is ticked and
CI is green. The "PR ready (WIP rule)" check enforces this (see CONTRIBUTING.md).
For a box that doesn't apply, write "n/a" next to it and tick it.
No LG TV to test a UI behaviour change on? Add the `needs-tv-test` label, tick "Not tested on a
real TV" and list below what to check (see "Testing on a real TV" in CONTRIBUTING.md).
-->

Closes #

## Summary

What does this change, and why?

## How it was tested

Commands you ran, and what you checked by hand (desktop Chromium at 1920×1080, a webOS TV, model and webOS version).

## Screenshots (UI changes, 1920×1080)

| Before | After |
|---|---|
| | |

## Real-TV test (UI behaviour changes not tested on a TV; delete this section otherwise)

<!-- To notify the maintainer, replace `@YTvictorworld` below with a real mention (same text without the backticks). -->
`@YTvictorworld`, could you test this on a real LG webOS TV? What to check (steps, screens, expected result):

1.

## Checklist

- [ ] Linked issue: `Closes #N` above.
- [ ] Tests added or updated in `tests/`: a regression test that fails before a bug fix and passes after it, or tests that lock a new feature's behaviour.
- [ ] `npm test` passes.
- [ ] `npx tsc --noEmit -p .` passes (only the known `app/_layout.tsx` global.css TS2882 remains).
- [ ] `npm run build:webos` builds the `.ipk`.
- [ ] UI changes: BEFORE and AFTER screenshots at 1920×1080 attached, and saved in `docs/images/` if they document a feature.
- [ ] Changes UI behaviour on the TV (layout, focus/remote navigation, player, playback); tick the one of the two boxes below that applies and write "n/a" on the other; if the PR doesn't change UI behaviour, write "n/a" on all three and tick them:
  - [ ] Tested on a real LG webOS TV (model/webOS version: …).
  - [ ] Not tested on a real TV: `needs-tv-test` label added and `@YTvictorworld` mentioned in "Real-TV test" above to ask for a test.
- [ ] Docs updated in `./docs` (and the index in `docs/README.md` for a new doc; `webos/README.md` if webOS behaviour changed).
- [ ] No secrets or private data (IPs, server URLs, tokens, emails, real names) in code, commits or screenshots.
- [ ] `MODIFICATIONS.md` updated if the change modifies code that comes from Seanime Tenji.
