#!/usr/bin/env bash
# Decides whether the release workflow (.github/workflows/release.yml) may publish, and
# what. It never skips quietly: anything wrong stops the run with a message that says
# how to run it correctly (see docs/releasing.md).
#
# Two ways to release:
#   - from main: "Run workflow" on main with version = X.Y.Z and confirm = publish. The tag
#     vX.Y.Z must not exist yet; the workflow creates it at the commit it built.
#   - on a tag: pushing a tag vX.Y.Z (the tag is the confirmation), or "Run workflow" on an
#     existing tag with confirm = publish (version empty or equal to the tag).
# In both, the version must equal the one in the source (SOURCE_VERSION_FILE).
#
# Inputs (environment):
#   EVENT_NAME           github.event_name ("workflow_dispatch"; "push" only for a pushed tag)
#   GIT_REF              github.ref, e.g. refs/heads/main or refs/tags/v1.0.0
#   CONFIRM              the "confirm" input; must be "publish" (not needed for a pushed tag)
#   VERSION_INPUT        the "version" input, e.g. 1.0.0 (a leading "v" is accepted)
#   SOURCE_VERSION       optional: the version in the source; read from
#                        SOURCE_VERSION_FILE otherwise
#   EXISTING_TAGS        optional: the repository's tags, one per line, instead of asking
#                        the remote (used by the tests)
#   GITHUB_OUTPUT        optional: where to write version=, tag= and create_tag=
#
# Exit codes: 0 go ahead, 1 refused (with "::error::" lines for the Actions log).
set -euo pipefail

SOURCE_VERSION_FILE="${SOURCE_VERSION_FILE:-package.json}"
SEMVER_RE='^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$'

fail() {
    local line
    while IFS= read -r line; do echo "::error title=Release refused::$line"; done <<<"$1"
    echo "Nothing was published." >&2
    exit 1
}

read_source_version() {
    if [ -n "${SOURCE_VERSION:-}" ]; then
        printf '%s\n' "$SOURCE_VERSION"
        return
    fi
    # The top-level "version" of package.json (app.config.ts and package-lock.json are kept
    # equal to it by tests/app-version.test.ts).
    node -e 'process.stdout.write(String(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).version || ""))' \
        "$SOURCE_VERSION_FILE"
}

tag_exists() { # tag_exists <tag>: 0 yes, 1 no; a failing lookup stops the run
    local tag="$1" code=0
    if [ -n "${EXISTING_TAGS+set}" ]; then
        grep -Fxq -- "$tag" <<<"$EXISTING_TAGS"
        return
    fi
    git ls-remote --exit-code --tags origin "refs/tags/$tag" >/dev/null 2>&1 || code=$?
    case "$code" in
        0) return 0 ;;
        2) return 1 ;;
        *) fail "Couldn't list the repository's tags (git ls-remote exited with $code)." ;;
    esac
}

event="${EVENT_NAME:-workflow_dispatch}"
ref="${GIT_REF:-}"
confirm="${CONFIRM:-}"
input="${VERSION_INPUT:-}"
input="${input#"${input%%[![:space:]]*}"}"   # trim
input="${input%"${input##*[![:space:]]}"}"
input="${input#v}"

# 1. Explicit confirmation (a pushed tag is its own confirmation).
if [ "$event" != push ] && [ "$confirm" != publish ]; then
    fail "The confirm input is \"$confirm\", not \"publish\".
Run the workflow again from main with version = X.Y.Z (e.g. 1.0.0) and confirm = publish (see docs/releasing.md)."
fi

# 2. Where it runs: main (creates the tag) or an existing vX.Y.Z tag.
case "$ref" in
    refs/heads/main)
        if [ "$event" = push ]; then
            fail "Pushes to main don't release; only version tags vX.Y.Z do."
        fi
        if [ -z "$input" ]; then
            fail "Run from main, the workflow needs the version to release (e.g. 1.0.0).
Fill in the version input, or run it on an existing tag vX.Y.Z instead."
        fi
        version="$input"
        create_tag=true
        ;;
    refs/tags/*)
        tag_name="${ref#refs/tags/}"
        if [[ "$tag_name" != v* ]]; then
            fail "Tag \"$tag_name\" is not a version tag vX.Y.Z."
        fi
        version="${tag_name#v}"
        if [ -n "$input" ] && [ "$input" != "$version" ]; then
            fail "The version input ($input) doesn't match the tag it runs on ($tag_name)."
        fi
        create_tag=false
        ;;
    *)
        fail "The workflow ran on \"${ref:-an unknown ref}\". Run it from main (with version = X.Y.Z and confirm = publish), or on an existing tag vX.Y.Z."
        ;;
esac

# 3. The version itself.
if ! [[ "$version" =~ $SEMVER_RE ]]; then
    fail "\"$version\" is not a release version MAJOR.MINOR.PATCH (e.g. 1.0.0; no pre-release or build suffix)."
fi
tag="v$version"

source_version="$(read_source_version)"
if [ -z "$source_version" ]; then
    fail "Couldn't read the version from $SOURCE_VERSION_FILE."
fi
if [ "$source_version" != "$version" ]; then
    fail "Version $version doesn't match $SOURCE_VERSION_FILE ($source_version).
Bump the version in a pull request first, merge it, then release (see docs/releasing.md)."
fi

if [ "$create_tag" = true ] && tag_exists "$tag"; then
    fail "Tag $tag already exists. Releases are never moved: release a new version, or run the workflow on the tag $tag to finish that release."
fi

echo "Release $tag: OK (version $version, $( [ "$create_tag" = true ] && echo "tag will be created" || echo "existing tag" ))."
if [ -n "${GITHUB_OUTPUT:-}" ]; then
    {
        echo "version=$version"
        echo "tag=$tag"
        echo "create_tag=$create_tag"
    } >>"$GITHUB_OUTPUT"
fi
