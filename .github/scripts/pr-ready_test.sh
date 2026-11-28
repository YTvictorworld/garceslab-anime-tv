#!/usr/bin/env bash
# Tests for pr-ready.sh. Run: bash .github/scripts/pr-ready_test.sh
set -uo pipefail

script="$(dirname "$0")/pr-ready.sh"
failures=0
tab=$'\t'

required=$'Build\nTests'
all_green="Build${tab}completed${tab}success
Tests${tab}completed${tab}success"
one_red="Build${tab}completed${tab}success
Tests${tab}completed${tab}failure"
one_running="Build${tab}completed${tab}success
Tests${tab}in_progress${tab}"
ready_body=$'Closes #12\n\n- [x] Tests\n- [x] Docs (n/a)'

expect() { # expect <wanted exit> <description> <title> <body> <checks> [labels] [wanted text] [unwanted text]
    local want="$1" what="$2" out code
    out=$(PR_TITLE="$3" PR_BODY="$4" REQUIRED_CHECKS="$required" CHECK_RESULTS="$5" \
        PR_LABELS="${6:-}" GITHUB_OUTPUT="$gh_output" bash "$script" 2>&1)
    code=$?
    if [ "$code" -ne "$want" ]; then
        echo "FAIL: $what (exit $code, wanted $want)"
        echo "$out" | sed 's/^/    /'
        failures=$((failures + 1))
    elif [ -n "${7:-}" ] && ! grep -qF -- "$7" <<<"$out"; then
        echo "FAIL: $what (output lacks \"$7\")"
        echo "$out" | sed 's/^/    /'
        failures=$((failures + 1))
    elif [ -n "${8:-}" ] && grep -qF -- "$8" <<<"$out"; then
        echo "FAIL: $what (output has \"$8\")"
        echo "$out" | sed 's/^/    /'
        failures=$((failures + 1))
    else
        echo "ok: $what"
    fi
}
gh_output=$(mktemp)

expect 0 "ready PR passes" "feat: x" "$ready_body" "$all_green"
expect 0 "\"Fixes #N\" counts as a linked issue" "fix: x" $'Fixes #3\n- [x] a' "$all_green"
expect 0 "\"resolves #N\" in lower case counts" "fix: x" $'resolves #3\n- [x] a' "$all_green"
expect 1 "no linked issue fails" "feat: x" $'- [x] Tests' "$all_green"
expect 1 "\"#12\" alone is not a linked issue" "feat: x" $'See #12\n- [x] Tests' "$all_green"
expect 1 "an unticked box fails" "feat: x" $'Closes #1\n- [ ] Tests' "$all_green"
expect 1 "a failed check fails" "feat: x" "$ready_body" "$one_red"
expect 1 "a running check fails (no wait)" "feat: x" "$ready_body" "$one_running"
expect 1 "a missing check fails" "feat: x" "$ready_body" "Build${tab}completed${tab}success"
expect 0 "(WIP) passes with problems" "(WIP) feat: x" $'- [ ] Tests' "$one_red"
expect 0 "(WIP) passes when everything is ready" "(WIP) feat: x" "$ready_body" "$all_green"
expect 1 "WIP not at the start does not count" "feat: x (WIP)" $'- [ ] Tests' "$all_green"

# The title becomes the squash commit on main: it must be a Conventional Commit.
not_cc="is not a Conventional Commit"
expect 0 "title passes: feat(profiles): add a PIN to profiles" 'feat(profiles): add a PIN to profiles' "$ready_body" "$all_green"
expect 0 "title passes: fix: keep the focus on the card" 'fix: keep the focus on the card' "$ready_body" "$all_green"
expect 0 "title passes: docs: squash merge policy" 'docs: squash merge policy' "$ready_body" "$all_green"
expect 0 "title passes: test: lock the card start" 'test: lock the card start' "$ready_body" "$all_green"
expect 0 "title passes: ci: nightly channel" 'ci: nightly channel' "$ready_body" "$all_green"
expect 0 "title passes: build: lower the JS for Chromium 79" 'build: lower the JS for Chromium 79' "$ready_body" "$all_green"
expect 0 "title passes: chore: tidy the scripts" 'chore: tidy the scripts' "$ready_body" "$all_green"
expect 0 "title passes: refactor(player): one source hook" 'refactor(player): one source hook' "$ready_body" "$all_green"
expect 0 "title passes: perf(webos): fewer re-renders" 'perf(webos): fewer re-renders' "$ready_body" "$all_green"
expect 0 "title passes: style: gofmt" 'style: gofmt' "$ready_body" "$all_green"
expect 0 "title passes: revert: feat(tv): seasons tabs" 'revert: feat(tv): seasons tabs' "$ready_body" "$all_green"
expect 0 "title passes: deps: update chromedp" 'deps: update chromedp' "$ready_body" "$all_green"
expect 0 "title passes: feat(mpv/iina): open in IINA" 'feat(mpv/iina): open in IINA' "$ready_body" "$all_green"
expect 0 "title passes: fix(video-core): seek" 'fix(video-core): seek' "$ready_body" "$all_green"
expect 0 "title passes: feat!: drop the old API" 'feat!: drop the old API' "$ready_body" "$all_green"
expect 0 "title passes: refactor(api)!: rename the routes" 'refactor(api)!: rename the routes' "$ready_body" "$all_green"
expect 0 "title passes: chore(deps): bump actions/checkout from 6 to 7" 'chore(deps): bump actions/checkout from 6 to 7' "$ready_body" "$all_green"
expect 0 "title passes: build(deps): bump ws from 7.5.14 to 8.23.0" 'build(deps): bump ws from 7.5.14 to 8.23.0' "$ready_body" "$all_green"
expect 0 "title passes: build(deps-dev): bump typescript from 6.0.3 to 7.0.2" 'build(deps-dev): bump typescript from 6.0.3 to 7.0.2' "$ready_body" "$all_green"
expect 0 "title passes: build(deps): bump react-native-safe-area-context from 5.10.1 to 5.11.1" 'build(deps): bump react-native-safe-area-context from 5.10.1 to 5.11.1' "$ready_body" "$all_green"
expect 1 "title fails: GA Test: permanent TEST ENVIRONMENT tag on every screen" 'GA Test: permanent TEST ENVIRONMENT tag on every screen' "$ready_body" "$all_green" "" "$not_cc"
expect 1 "title fails: Add profiles" 'Add profiles' "$ready_body" "$all_green" "" "$not_cc"
expect 1 "title fails: feature: x" 'feature: x' "$ready_body" "$all_green" "" "$not_cc"
expect 1 "title fails: Feat: x" 'Feat: x' "$ready_body" "$all_green" "" "$not_cc"
expect 1 "title fails: feat:x" 'feat:x' "$ready_body" "$all_green" "" "$not_cc"
expect 1 "title fails: feat: " 'feat: ' "$ready_body" "$all_green" "" "$not_cc"
expect 1 "title fails: feat" 'feat' "$ready_body" "$all_green" "" "$not_cc"
expect 1 "title fails: feat(): x" 'feat(): x' "$ready_body" "$all_green" "" "$not_cc"
expect 1 "title fails: feat (tv): x" 'feat (tv): x' "$ready_body" "$all_green" "" "$not_cc"
expect 1 "title fails: webOS: keep the focus" 'webOS: keep the focus' "$ready_body" "$all_green" "" "$not_cc"
expect 1 "title fails: wip: x" 'wip: x' "$ready_body" "$all_green" "" "$not_cc"
expect 1 "title fails: fix(tv) : x" 'fix(tv) : x' "$ready_body" "$all_green" "" "$not_cc"
expect 1 "\"(WIP)\" at the end of the title fails on its own" "feat: x (WIP)" "$ready_body" "$all_green" "" "the title has \"(WIP)\" in it"
expect 0 "(WIP) with a non-conventional title passes and says why it isn't ready" "(WIP) Add profiles" "$ready_body" "$all_green" "" "$not_cc"
expect 0 "(WIP) without a space before the type is checked without the prefix" "(WIP)feat: x" "$ready_body" "$all_green" "" "Everything is in place"

# Real-TV test: the needs-tv-test label blocks merging with its own message, without asking
# for "(WIP)"; tv-tested (or no label) passes.
waiting="Waiting for a real-TV test: remove needs-tv-test after testing"
not_tested_body=$'Closes #12\n\n- [x] Changes UI behaviour on the TV\n  - [x] Tested on a real LG webOS TV (model/webOS version: n/a)\n  - [x] Not tested on a real TV: `needs-tv-test` label added'
tested_body=$'Closes #12\n\n- [x] Changes UI behaviour on the TV\n  - [x] Tested on a real LG webOS TV (model/webOS version: LG C3, webOS 23)\n  - [x] n/a Not tested on a real TV'
expect 1 "needs-tv-test fails a ready PR" "feat: x" "$not_tested_body" "$all_green" "ui,needs-tv-test" "$waiting" "(WIP)\" and keep"
expect 1 "needs-tv-test fails even when it is the only label" "feat: x" "$ready_body" "$all_green" "needs-tv-test" "$waiting"
: >"$gh_output"
PR_TITLE="feat: x" PR_BODY="$ready_body" REQUIRED_CHECKS="$required" CHECK_RESULTS="$all_green" \
    PR_LABELS="needs-tv-test" GITHUB_OUTPUT="$gh_output" bash "$script" >/dev/null 2>&1
if grep -qx "tv_test_only=true" "$gh_output"; then echo "ok: only the TV test missing is reported (no wip label)"; else
    echo "FAIL: only the TV test missing is reported (no wip label)"; failures=$((failures + 1)); fi
: >"$gh_output"
PR_TITLE="feat: x" PR_BODY=$'- [ ] a' REQUIRED_CHECKS="$required" CHECK_RESULTS="$all_green" \
    PR_LABELS="needs-tv-test" GITHUB_OUTPUT="$gh_output" bash "$script" >/dev/null 2>&1
if ! grep -q "tv_test_only" "$gh_output"; then echo "ok: other problems still get the wip label"; else
    echo "FAIL: other problems still get the wip label"; failures=$((failures + 1)); fi
expect 1 "needs-tv-test with other problems lists both" "feat: x" $'- [ ] a' "$all_green" "needs-tv-test" "$waiting"
expect 0 "(WIP) with needs-tv-test passes and mentions the TV test" "(WIP) feat: x" "$ready_body" "$all_green" "needs-tv-test" "$waiting"
expect 0 "label replaced by tv-tested passes" "feat: x" "$not_tested_body" "$all_green" "ui,tv-tested" "Ready:"
expect 0 "label removed, tested on a TV, passes" "feat: x" "$tested_body" "$all_green" "ui" "Ready:"
expect 0 "no labels at all passes" "feat: x" "$ready_body" "$all_green" "" "Ready:"
expect 1 "\"Not tested on a real TV\" without the label fails" "feat: x" "$not_tested_body" "$all_green" "ui" "add the needs-tv-test label"
expect 0 "a similar label name doesn't count" "feat: x" "$ready_body" "$all_green" "needs-tv-test-later" "Ready:"

# The shipped PR template: unticked it fails, ticked with "n/a" on the TV boxes it passes, and
# its "Not tested on a real TV" line is the one the rule looks for.
template=$(sed 's/^Closes #$/Closes #12/' "$(dirname "$0")/../pull_request_template.md")
expect 1 "the PR template as is fails" "feat: x" "$template" "$all_green"
ticked=$(sed 's/- \[ \]/- [x] n\/a/' <<<"$template")
expect 0 "the PR template ticked with n/a passes" "feat: x" "$ticked" "$all_green"
no_tv=$(sed -e 's/- \[ \]/- [x]/' -e '/Tested on a real LG webOS TV/s/- \[x\]/- [x] n\/a/' <<<"$template")
expect 1 "the template's \"Not tested on a real TV\" box needs the label" "feat: x" "$no_tv" "$all_green" "" "add the needs-tv-test label"
expect 1 "the template's \"Not tested\" box with needs-tv-test waits for the TV test" "feat: x" "$no_tv" "$all_green" "needs-tv-test" "$waiting"

# Reading the check runs from GitHub: the newest run of each job wins (a re-run that passed
# replaces an older failure). A fake `gh` prints what the real one's --jq filter would.
fake_bin=$(mktemp -d)
cat >"$fake_bin/gh" <<'GH'
#!/usr/bin/env bash
printf '%s\t%s\t%s\t%s\n' \
    2026-01-01T10:00:00Z Tests completed failure \
    2026-01-01T11:00:00Z Tests completed success \
    2026-01-01T10:30:00Z Build completed success
GH
chmod +x "$fake_bin/gh"
out=$(PATH="$fake_bin:$PATH" PR_TITLE="feat: x" PR_BODY="$ready_body" REQUIRED_CHECKS="$required" \
    GITHUB_REPOSITORY=o/r HEAD_SHA=abc bash "$script" 2>&1)
if [ $? -eq 0 ]; then echo "ok: newest check run wins"; else
    echo "FAIL: newest check run wins"; echo "$out" | sed 's/^/    /'; failures=$((failures + 1)); fi
rm -rf "$fake_bin" "$gh_output"

if [ "$failures" -gt 0 ]; then
    echo "$failures test(s) failed"
    exit 1
fi
echo "all tests passed"
