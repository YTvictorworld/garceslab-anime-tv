# Testing on a real TV

Desktop Chromium at 1920×1080 is good for layout and screenshots, but it is not a TV: D-pad
focus, the Magic Remote, Back, the player, codecs and subtitles behave differently on an LG
webOS TV, and the TV is much slower. So every pull request that **changes UI behaviour**
(anything the TV user sees or does: layout, focus and remote navigation, Back, the player,
playback, subtitles) is tested on a real **LG webOS TV** before it is merged. Screenshots alone
aren't enough for focus, remote or player behaviour.

## The labels

| Label | Meaning |
|---|---|
| `needs-tv-test` | Changes UI behaviour; must be tested on a real LG webOS TV before merging |
| `tv-tested` | Tested on a real LG webOS TV by a maintainer |

## If you have no TV

1. Say so in the PR and add the `needs-tv-test` label.
2. In the template, tick *"Not tested on a real TV"* and write "n/a" on *"Tested on a real LG
   webOS TV"*.
3. Mention the maintainer, @YTvictorworld (currently the only one who can test on a TV), in the
   PR description and ask for a TV test. Under *"Real-TV test"*, list what to check: the steps,
   the screens and the expected result, using the checklist below.

AI agents without access to a TV always do this for a UI behaviour change.

The PR can be **ready for review** with `needs-tv-test` (no `(WIP)` needed), but it **can't be
merged**: the *PR ready (WIP rule)* check fails with *"Waiting for a real-TV test: remove
needs-tv-test after testing"* until the label is gone, and adding or removing a label re-runs
it. A ticked *"Not tested on a real TV"* without the label fails the check too.

## Testing it on the TV

Install the PR's `.ipk` (`npm run build:webos`), ideally as a
[side-by-side test build](building-webos.md#side-by-side-test-build) so the everyday app stays
untouched. Then check what the PR touches:

- **Remote navigation and focus:** arrows reach every control of the changed screen, nothing is
  unreachable or skipped, focus is always visible, lists scroll to the focused card, focus lands
  in a sensible place when the screen opens and after closing a panel. Magic Remote: pointer,
  click, wheel and drag ([remote-and-navigation.md](remote-and-navigation.md)).
- **Back:** closes the open panel or keyboard first, then goes to the previous screen; on the
  first screen it shows the system's exit popup.
- **Player:** starts, pauses, seeks (arrows, ⏩/⏪, numbers), next/previous episode, the colour
  keys, leaving with Back and with Stop, coming back after Home.
- **Subtitles and audio:** the expected track is selected at start, switching tracks works, ASS
  styles and positions look right, timing is in sync.
- **Performance:** turn on **Playback stats** (Info key) and check the mode (direct play or
  transcode) and why; scrolling and focus moves stay smooth, with no stutter or dropped frames
  while playing.
- **Layout:** nothing cut off at the TV's edges, text readable from the sofa.

## Reporting the result

Whoever tests on the TV comments on the PR: the **device and webOS version** (e.g. LG C3,
webOS 23), **what was checked** and how it went, with photos or videos if useful (no private
data in them). Then they **replace `needs-tv-test` with `tv-tested`**, and the check passes once
everything else is green. If something is wrong, they leave `needs-tv-test` and describe the
problem.
