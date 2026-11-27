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

# The publish order (regression: the release used to be edited before its assets were
# uploaded, so the "edited" webhook reached updaters while the old assets were still there).
# Runs the real "Publish the nightly pre-release" script against a fake gh that logs its calls.
publish_script() { # the step's run block, unindented
    awk '
        /^      - name: Publish the nightly pre-release$/ { step = 1; next }
        step && /^        run: \|$/ { body = 1; next }
        body && /^          / { print substr($0, 11); next }
        body && /^ *$/ { print ""; next }
        body { exit }
    ' "$workflow"
}
# publish_order <description> <exists|new>: runs the script, checks the order of gh calls
publish_order() {
    local what="$1" mode="$2" tmp log errs=()
    tmp=$(mktemp -d)
    mkdir -p "$tmp/bin" "$tmp/work/release"
    cat >"$tmp/bin/gh" <<'GH'
#!/usr/bin/env bash
# "release view" of an existing nightly lists its assets; a new one doesn't exist yet.
if [ "$1 $2" = "release view" ] && [[ "$*" == *"--json assets "* ]]; then
    [ "$FAKE_MODE" = exists ] || exit 1
    printf '%s\n' app.seanime.tenji_0.9.0_all.ipk build.json changes.json SHA256SUMS.txt
fi
[ "$1 $2" = "release view" ] && exit 0
printf '%s\n' "$*" >>"$FAKE_LOG"
GH
    chmod +x "$tmp/bin/gh"
    : >"$tmp/work/release/app.seanime.tenji_1.0.0_all.ipk"
    : >"$tmp/work/release/build.json"
    : >"$tmp/work/release/changes.json"
    : >"$tmp/work/release/SHA256SUMS.txt"
    : >"$tmp/work/notes.md"
    publish_script >"$tmp/publish.sh"
    log="$tmp/gh.log"
    : >"$log"
    if ! (cd "$tmp/work" && env -i PATH="$tmp/bin:$PATH" FAKE_MODE="$mode" FAKE_LOG="$log" \
        GITHUB_REPOSITORY=owner/repo COMMIT=$sha bash -e "$tmp/publish.sh" >/dev/null 2>&1); then
        errs+=("the script failed")
    fi
    # line <grep -E pattern>: number of the first matching gh call (0 if none)
    line() { local n; n=$(grep -nE -- "$1" "$log" | head -1 | cut -d: -f1); echo "${n:-0}"; }
    local ipk changes sums build edit last_upload last_delete calls
    calls=$(wc -l <"$log")
    ipk=$(line '^release upload .*app\.seanime\.tenji_1\.0\.0_all\.ipk')
    changes=$(line '^release upload .*release/changes\.json')
    sums=$(line '^release upload .*release/SHA256SUMS\.txt')
    build=$(line '^release upload .*release/build\.json')
    edit=$(line '^release edit nightly ')
    last_upload=$(grep -nE '^release upload ' "$log" | tail -1 | cut -d: -f1)
    last_delete=$(grep -nE '^release delete-asset ' "$log" | tail -1 | cut -d: -f1)
    for n in ipk changes sums build edit; do [ "${!n}" -gt 0 ] || errs+=("no gh call for $n"); done
    [ "$(grep -cE '^release edit ' "$log")" = 1 ] || errs+=("the release isn't edited exactly once")
    [ "$edit" = "$calls" ] || errs+=("the metadata edit isn't the last change to the release")
    [ "$sums" -gt "$ipk" ] && [ "$sums" -gt "$changes" ] || errs+=("SHA256SUMS.txt is uploaded before the files it lists")
    [ "$build" = "${last_upload:-0}" ] || errs+=("build.json isn't the last upload")
    [ "$edit" -gt "${last_delete:-0}" ] || errs+=("a stale asset is deleted after the edit")
    grep -E '^release edit ' "$log" | grep -q -- '--draft=false' || errs+=("the edit doesn't publish a draft")
    grep -E '^release edit ' "$log" | grep -q -- '--prerelease --latest=false' || errs+=("the edit isn't a non-latest pre-release")
    if [ "$mode" = exists ]; then
        grep -qxF 'release delete-asset nightly app.seanime.tenji_0.9.0_all.ipk --repo owner/repo --yes' "$log" ||
            errs+=("the stale .ipk isn't deleted")
        [ "$(grep -c '^release delete-asset ' "$log")" = 1 ] || errs+=("assets the new build has are deleted")
        ! grep -q '^release create ' "$log" || errs+=("an existing nightly is created again")
    else
        [ "$(line '^release create nightly .*--draft .*--prerelease --latest=false')" = 1 ] ||
            errs+=("a new nightly isn't first created as a non-latest pre-release draft")
        ! grep -E '^release create ' "$log" | grep -q 'release/' || errs+=("assets are attached before the draft exists")
    fi
    if [ ${#errs[@]} -eq 0 ]; then
        echo "ok: publish order: $what"
    else
        echo "FAIL: publish order: $what"
        printf '    %s\n' "${errs[@]}"
        sed 's/^/    gh /' "$log"
        failures=$((failures + 1))
    fi
    rm -rf "$tmp"
}
publish_order "an existing nightly is edited only after its assets are replaced" exists
publish_order "the first nightly is published only after its assets are uploaded" new

if [ "$failures" -gt 0 ]; then
    echo "$failures test(s) failed"
    exit 1
fi
echo "all tests passed"
