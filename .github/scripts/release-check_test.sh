#!/usr/bin/env bash
# Tests for release-check.sh. Run: bash .github/scripts/release-check_test.sh
set -uo pipefail

dir="$(cd "$(dirname "$0")" && pwd)"
script="$dir/release-check.sh"
workflow="$dir/../workflows/release.yml"
failures=0
tags=$'v0.9.0\nv1.0.0'

# expect <wanted exit> <description> <wanted text or ""> VAR=value...
expect() {
    local want="$1" what="$2" text="$3" out code
    shift 3
    out=$(env -i PATH="$PATH" EXISTING_TAGS="$tags" SOURCE_VERSION=1.1.0 "$@" bash "$script" 2>&1)
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

main=(EVENT_NAME=workflow_dispatch GIT_REF=refs/heads/main)

# Regression: the old way (Run workflow on main, confirm left empty) used to skip the job and
# show a green run. Now it fails and says why.
expect 1 "run from main without confirm fails loudly" '::error title=Release refused::The confirm input is "", not "publish"' \
    "${main[@]}"
expect 1 "run from main with a typo in confirm fails" 'not "publish"' "${main[@]}" CONFIRM=Publish VERSION_INPUT=1.1.0
expect 1 "run from main without a version fails" "needs the version to release" "${main[@]}" CONFIRM=publish

# From main: creates the tag.
expect 0 "new version from main passes" "Release v1.1.0: OK" "${main[@]}" CONFIRM=publish VERSION_INPUT=1.1.0
expect 0 "a leading v and spaces are accepted" "Release v1.1.0: OK" "${main[@]}" CONFIRM=publish VERSION_INPUT=" v1.1.0 "
expect 1 "not semver fails" "not a release version" "${main[@]}" CONFIRM=publish VERSION_INPUT=1.1 SOURCE_VERSION=1.1
expect 1 "pre-release suffix fails" "not a release version" "${main[@]}" CONFIRM=publish VERSION_INPUT=1.1.0-rc.1
expect 1 "leading zero fails" "not a release version" "${main[@]}" CONFIRM=publish VERSION_INPUT=1.01.0
expect 1 "version different from the source fails" "doesn't match" "${main[@]}" CONFIRM=publish VERSION_INPUT=1.2.0
expect 1 "existing tag fails" "Tag v1.0.0 already exists" "${main[@]}" CONFIRM=publish VERSION_INPUT=1.0.0 SOURCE_VERSION=1.0.0

# Other refs.
expect 1 "a feature branch fails" 'ran on "refs/heads/feature/x"' EVENT_NAME=workflow_dispatch GIT_REF=refs/heads/feature/x CONFIRM=publish VERSION_INPUT=1.1.0
expect 1 "a push to main never releases" "don't release" EVENT_NAME=push GIT_REF=refs/heads/main VERSION_INPUT=1.1.0

# On an existing tag.
tag=(EVENT_NAME=workflow_dispatch GIT_REF=refs/tags/v1.0.0 SOURCE_VERSION=1.0.0)
expect 0 "run on a matching tag passes (tag exists)" "existing tag" "${tag[@]}" CONFIRM=publish
expect 0 "run on a tag with the same version input passes" "Release v1.0.0: OK" "${tag[@]}" CONFIRM=publish VERSION_INPUT=1.0.0
expect 1 "run on a tag without confirm fails" 'not "publish"' "${tag[@]}"
expect 1 "run on a tag with another version input fails" "doesn't match the tag" "${tag[@]}" CONFIRM=publish VERSION_INPUT=1.0.1
expect 1 "tag not matching the source fails" "doesn't match" "${tag[@]}" CONFIRM=publish SOURCE_VERSION=0.9.0
expect 1 "a non-version tag fails" "not a version tag" EVENT_NAME=workflow_dispatch GIT_REF=refs/tags/latest CONFIRM=publish
expect 0 "a pushed version tag needs no confirm" "Release v1.0.0: OK" EVENT_NAME=push GIT_REF=refs/tags/v1.0.0 SOURCE_VERSION=1.0.0
expect 1 "a pushed tag that doesn't match the source fails" "doesn't match" EVENT_NAME=push GIT_REF=refs/tags/v1.0.1 SOURCE_VERSION=1.0.0

# Outputs for the next jobs.
out_file=$(mktemp)
env -i PATH="$PATH" EXISTING_TAGS="$tags" SOURCE_VERSION=1.1.0 GITHUB_OUTPUT="$out_file" "${main[@]}" \
    CONFIRM=publish VERSION_INPUT=1.1.0 bash "$script" >/dev/null 2>&1
if [ "$(cat "$out_file")" = $'version=1.1.0\ntag=v1.1.0\ncreate_tag=true' ]; then echo "ok: writes the outputs"; else
    echo "FAIL: writes the outputs"; sed 's/^/    /' "$out_file"; failures=$((failures + 1)); fi
rm -f "$out_file"

# The version is read from the real source file when SOURCE_VERSION isn't given.
src=$(mktemp)
printf '{\n  "name": "x",\n  "version": "2.3.4",\n  "dependencies": { "y": { "version": "9.9.9" } }\n}\n' >"$src"
expect 0 "reads the version from package.json" "Release v2.3.4: OK" "${main[@]}" CONFIRM=publish VERSION_INPUT=2.3.4 \
    SOURCE_VERSION= SOURCE_VERSION_FILE="$src"
rm -f "$src"
real=$(cd "$dir/../.." && env -i PATH="$PATH" bash -c "source <(sed -n '/^read_source_version()/,/^}/p' '$script'); SOURCE_VERSION_FILE=package.json; read_source_version")
if [[ "$real" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then echo "ok: the repository's version ($real) is readable"; else
    echo "FAIL: the repository's version is not readable (\"$real\")"; failures=$((failures + 1)); fi

# Tag lookup through git when EXISTING_TAGS isn't given (fake git: exit 2 = no such tag).
fake_bin=$(mktemp -d)
printf '#!/usr/bin/env bash\nexit "${FAKE_GIT_EXIT:-2}"\n' >"$fake_bin/git"
chmod +x "$fake_bin/git"
for case in "2 0 new tag passes" "0 1 existing tag fails" "128 1 a failing lookup fails"; do
    read -r git_exit want what <<<"$case"
    env -i PATH="$fake_bin:$PATH" FAKE_GIT_EXIT="$git_exit" SOURCE_VERSION=1.1.0 "${main[@]}" CONFIRM=publish \
        VERSION_INPUT=1.1.0 bash "$script" >/dev/null 2>&1
    code=$?
    if [ "$code" -eq "$want" ]; then echo "ok: git lookup: $what"; else
        echo "FAIL: git lookup: $what (exit $code, wanted $want)"; failures=$((failures + 1)); fi
done
rm -rf "$fake_bin"

# Regression: the workflow must not hide the checks behind a job-level "if" again (a
# skipped job shows a green run), and every job runs after the check.
if grep -Eq '^[[:space:]]+if:.*inputs\.confirm' "$workflow"; then
    echo "FAIL: release.yml skips on the confirm input instead of failing"; failures=$((failures + 1))
else
    echo "ok: release.yml has no silent confirm skip"
fi
if grep -q 'bash .github/scripts/release-check.sh' "$workflow"; then echo "ok: release.yml runs the check"; else
    echo "FAIL: release.yml doesn't run release-check.sh"; failures=$((failures + 1)); fi

if [ "$failures" -gt 0 ]; then
    echo "$failures test(s) failed"
    exit 1
fi
echo "all tests passed"
