#!/usr/bin/env bash
# Tests for nightly-check.sh. Run: bash .github/scripts/nightly-check_test.sh
set -uo pipefail

dir="$(cd "$(dirname "$0")" && pwd)"
script="$dir/nightly-check.sh"
workflow="$dir/../workflows/nightly.yml"
failures=0
sha=0123456789abcdef0123456789abcdef01234567
other=fedcba9876543210fedcba9876543210fedcba98

# expect <wanted exit> <description> <wanted text or ""> VAR=value...
expect() {
    local want="$1" what="$2" text="$3" out code
    shift 3
    out=$(env -i PATH="$PATH" "$@" bash "$script" 2>&1)
    code=$?
    if [ "$code" -ne "$want" ]; then
        echo "FAIL: $what (exit $code, wanted $want)"
        echo "$out" | sed 's/^/    /'
        failures=$((failures + 1))
    elif [ -n "$text" ] && ! grep -Fq -- "$text" <<<"$out"; then
        echo "FAIL: $what (output lacks \"$text\")"
        echo "$out" | sed 's/^/    /'
        failures=$((failures + 1))
    else
        echo "ok: $what"
    fi
}

expect 0 "a push to main publishes" "Nightly 0123456: OK" EVENT_NAME=push GIT_REF=refs/heads/main COMMIT=$sha
expect 0 "the publish job passes while the commit is main's head" "OK" EVENT_NAME=push GIT_REF=refs/heads/main COMMIT=$sha MAIN_HEAD=$sha

expect 1 "a pull request is refused" '::error title=Nightly refused::The nightly is built only from pushes to main, not from a "pull_request" event' \
    EVENT_NAME=pull_request GIT_REF=refs/pull/7/merge COMMIT=$sha
expect 1 "a manual run is refused" 'not from a "workflow_dispatch" event' EVENT_NAME=workflow_dispatch GIT_REF=refs/heads/main COMMIT=$sha
expect 1 "a pushed version tag is refused" "Tags don't publish the nightly (v1.0.0)" EVENT_NAME=push GIT_REF=refs/tags/v1.0.0 COMMIT=$sha
expect 1 "the nightly tag itself is refused" "Tags don't publish the nightly (nightly)" EVENT_NAME=push GIT_REF=refs/tags/nightly COMMIT=$sha
expect 1 "another branch is refused" 'not from "refs/heads/feature/x"' EVENT_NAME=push GIT_REF=refs/heads/feature/x COMMIT=$sha
expect 1 "a branch named like main is refused" 'not from "refs/heads/main-old"' EVENT_NAME=push GIT_REF=refs/heads/main-old COMMIT=$sha
expect 1 "no event is refused" 'not from a "unknown" event' GIT_REF=refs/heads/main COMMIT=$sha
expect 1 "a short SHA is refused" "is not a full commit SHA" EVENT_NAME=push GIT_REF=refs/heads/main COMMIT=0123456
expect 1 "an old run doesn't move nightly back" "main has moved on to fedcba9" EVENT_NAME=push GIT_REF=refs/heads/main COMMIT=$sha MAIN_HEAD=$other

out_file=$(mktemp)
env -i PATH="$PATH" GITHUB_OUTPUT="$out_file" EVENT_NAME=push GIT_REF=refs/heads/main COMMIT=$sha bash "$script" >/dev/null 2>&1
if [ "$(cat "$out_file")" = "commit=$sha"$'\n'"short_commit=0123456" ]; then echo "ok: writes the outputs"; else
    echo "FAIL: writes the outputs"; sed 's/^/    /' "$out_file"; failures=$((failures + 1)); fi
rm -f "$out_file"

# The workflow itself: only push to main triggers it, the guard runs in both jobs, the
# release is a pre-release that is never "latest", and stable tags are never touched.
check() { # check <description> <grep -E pattern> [absent]
    if grep -Eq -- "$2" "$workflow"; then found=1; else found=0; fi
    if { [ "${3:-}" = absent ] && [ "$found" = 0 ]; } || { [ "${3:-}" != absent ] && [ "$found" = 1 ]; }; then
        echo "ok: nightly.yml: $1"
    else
        echo "FAIL: nightly.yml: $1"; failures=$((failures + 1))
    fi
}
check "runs on push to main" '^    branches: \[main\]$'
check "has no pull_request trigger" '^  pull_request' absent
check "has no tag trigger" '^    tags:' absent
check "has no manual trigger" '^  workflow_dispatch' absent
check "cancels older runs" 'cancel-in-progress: true'
check "runs the guard" 'bash .github/scripts/nightly-check.sh'
check "checks main's head before publishing" 'MAIN_HEAD="'
check "publishes a pre-release" '--prerelease'
check "never marks it latest" '--latest=false'
check "never uses a version tag" '^[^#]*(refs/tags/v|tags/v\$|release [a-z-]+ v)' absent
check "every release command targets the nightly release" 'gh release [a-z-]+ ([^n]|n[^i])' absent
if [ "$(grep -c 'bash .github/scripts/nightly-check.sh' "$workflow")" -ge 2 ]; then echo "ok: nightly.yml: guard in both jobs"; else
    echo "FAIL: nightly.yml: guard in both jobs"; failures=$((failures + 1)); fi

if [ "$failures" -gt 0 ]; then
    echo "$failures test(s) failed"
    exit 1
fi
echo "all tests passed"
