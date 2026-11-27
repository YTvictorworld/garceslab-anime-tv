#!/usr/bin/env bash
# Tests for ga-test-check.sh and the GA Test workflow. Run: bash .github/scripts/ga-test-check_test.sh
set -uo pipefail

dir="$(cd "$(dirname "$0")" && pwd)"
script="$dir/ga-test-check.sh"
workflow="$dir/../workflows/ga-test.yml"
failures=0
sha=0123456789abcdef0123456789abcdef01234567

pass() { echo "ok: $1"; }
fail() {
    echo "FAIL: $1"
    [ -n "${2:-}" ] && echo "$2" | sed 's/^/    /'
    failures=$((failures + 1))
}

# expect <wanted exit> <description> <wanted GITHUB_OUTPUT lines, "|" separated, or ""> VAR=value...
expect() {
    local want="$1" what="$2" lines="$3" out code tmp line
    shift 3
    tmp="$(mktemp)"
    out=$(env -i PATH="$PATH" GITHUB_OUTPUT="$tmp" "$@" bash "$script" 2>&1)
    code=$?
    if [ "$code" -ne "$want" ]; then
        fail "$what (exit $code, wanted $want)" "$out"
    else
        local missing=""
        IFS='|' read -ra wanted <<<"$lines"
        for line in "${wanted[@]}"; do
            grep -qxF -- "$line" "$tmp" || missing+="lacks \"$line\"; "
        done
        if [ -n "$missing" ]; then fail "$what ($missing)" "$(cat "$tmp")"; else pass "$what"; fi
    fi
    rm -f "$tmp"
}

pr=(EVENT_NAME=pull_request PR_NUMBER=27 HEAD_SHA=$sha)
built="build=true|app_id=app.garceslab.anime.test|title=GA Test|artifact=ga-test-pr27-0123456|commit=$sha"

expect 0 "a labelled PR opened builds GA Test" "$built" "${pr[@]}" EVENT_ACTION=opened PR_LABELS=ui,needs-tv-test
expect 0 "a push to a labelled PR builds GA Test" "$built" "${pr[@]}" EVENT_ACTION=synchronize PR_LABELS=needs-tv-test
expect 0 "a labelled PR reopened builds GA Test" "$built" "${pr[@]}" EVENT_ACTION=reopened PR_LABELS="enhancement, needs-tv-test, ui"
expect 0 "adding needs-tv-test later builds GA Test" "$built" "${pr[@]}" EVENT_ACTION=labeled EVENT_LABEL=needs-tv-test PR_LABELS=needs-tv-test
expect 0 "an upper-case SHA is named in lower case" "artifact=ga-test-pr27-0123456" \
    EVENT_NAME=pull_request PR_NUMBER=27 HEAD_SHA=0123456789ABCDEF0123456789ABCDEF01234567 EVENT_ACTION=opened PR_LABELS=needs-tv-test

expect 0 "a PR without the label doesn't" "build=false" "${pr[@]}" EVENT_ACTION=opened PR_LABELS=ui,enhancement
expect 0 "a PR without labels doesn't" "build=false" "${pr[@]}" EVENT_ACTION=synchronize PR_LABELS=
expect 0 "a label merely containing the name doesn't" "build=false" "${pr[@]}" EVENT_ACTION=opened PR_LABELS=not-needs-tv-test,needs-tv-test-later
expect 0 "tv-tested alone doesn't" "build=false" "${pr[@]}" EVENT_ACTION=opened PR_LABELS=tv-tested
expect 0 "adding another label to a labelled PR doesn't rebuild" "build=false" "${pr[@]}" EVENT_ACTION=labeled EVENT_LABEL=ui PR_LABELS=ui,needs-tv-test
expect 0 "removing a label doesn't" "build=false" "${pr[@]}" EVENT_ACTION=unlabeled EVENT_LABEL=needs-tv-test PR_LABELS=ui
expect 0 "a push to main doesn't" "build=false" EVENT_NAME=push EVENT_ACTION= PR_LABELS=needs-tv-test HEAD_SHA=$sha
expect 0 "pull_request_target doesn't" "build=false" EVENT_NAME=pull_request_target EVENT_ACTION=opened PR_LABELS=needs-tv-test PR_NUMBER=27 HEAD_SHA=$sha

expect 1 "a bad PR number is refused" "" EVENT_NAME=pull_request EVENT_ACTION=opened PR_LABELS=needs-tv-test PR_NUMBER="27; rm" HEAD_SHA=$sha
expect 1 "a short SHA is refused" "" EVENT_NAME=pull_request EVENT_ACTION=opened PR_LABELS=needs-tv-test PR_NUMBER=27 HEAD_SHA=0123456

# The workflow: triggered on labels too, never with pull_request_target, built with the
# decided identity, read-only where PR code runs.
check() { if grep -Eq -- "$2" "$workflow"; then pass "workflow: $1"; else fail "workflow: $1 (no /$2/)"; fi; }
check_not() { if grep -Eq -- "$2" "$workflow"; then fail "workflow: $1 (has /$2/)"; else pass "workflow: $1"; fi; }
check "runs on pull_request events incl. labeled" '^    types: \[opened, synchronize, reopened, labeled\]$'
check_not "never uses pull_request_target" '^ *pull_request_target:'
check_not "needs no secrets" 'secrets\.'
check "decides with ga-test-check.sh" 'run: bash \.github/scripts/ga-test-check\.sh'
check "builds with the decided app id" 'WEBOS_APP_ID: \$\{\{ steps\.plan\.outputs\.app_id \}\}'
check "builds with the decided title" 'WEBOS_APP_TITLE: \$\{\{ steps\.plan\.outputs\.title \}\}'
check "names the artifact as decided" 'name: \$\{\{ steps\.plan\.outputs\.artifact \}\}'
check "builds only when decided" "if: steps\.plan\.outputs\.build == 'true'"
check "is read-only by default" '^  contents: read$'
check "comments only on PRs from this repository" 'head\.repo\.full_name == github\.repository'

if [ "$failures" -gt 0 ]; then
    echo "$failures test(s) failed"
    exit 1
fi
echo "all tests passed"
