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

expect() { # expect <wanted exit> <description> <title> <body> <checks>
    local want="$1" what="$2" out code
    out=$(PR_TITLE="$3" PR_BODY="$4" REQUIRED_CHECKS="$required" CHECK_RESULTS="$5" bash "$script" 2>&1)
    code=$?
    if [ "$code" -ne "$want" ]; then
        echo "FAIL: $what (exit $code, wanted $want)"
        echo "$out" | sed 's/^/    /'
        failures=$((failures + 1))
    else
        echo "ok: $what"
    fi
}

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
rm -rf "$fake_bin"

if [ "$failures" -gt 0 ]; then
    echo "$failures test(s) failed"
    exit 1
fi
echo "all tests passed"
