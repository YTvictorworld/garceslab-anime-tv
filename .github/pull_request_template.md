<!--
Title: start it with "(WIP)" and keep the PR as a draft until EVERY box below is ticked and
CI is green. The "PR ready (WIP rule)" check enforces this (see CONTRIBUTING.md).
For a box that doesn't apply, write "n/a" next to it and tick it.
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

## Checklist

- [ ] Linked issue: `Closes #N` above.
- [ ] Tests added or updated in `tests/`: a regression test that fails before a bug fix and passes after it, or tests that lock a new feature's behaviour.
- [ ] `npm test` passes.
- [ ] `npx tsc --noEmit -p .` passes (only the known `app/_layout.tsx` global.css TS2882 remains).
- [ ] `npm run build:webos` builds the `.ipk`.
- [ ] UI changes: BEFORE and AFTER screenshots at 1920×1080 attached, and saved in `docs/images/` if they document a feature.
- [ ] Docs updated in `./docs` (and the index in `docs/README.md` for a new doc; `webos/README.md` if webOS behaviour changed).
- [ ] No secrets or private data (IPs, server URLs, tokens, emails, real names) in code, commits or screenshots.
- [ ] `MODIFICATIONS.md` updated if the change modifies code that comes from Seanime Tenji.
