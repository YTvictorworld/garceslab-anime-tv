#!/usr/bin/env bash
# Decides whether the nightly workflow (.github/workflows/nightly.yml) may build and publish
# the "nightly" pre-release. Only a push to main does; anything else stops the run with a
# message (it never skips quietly). See docs/releasing.md, "Release channels".
#
# Inputs (environment):
#   EVENT_NAME     github.event_name; must be "push"
#   GIT_REF        github.ref; must be refs/heads/main
#   COMMIT         github.sha: the commit to build (full 40-character SHA)
#   MAIN_HEAD      optional: main's current head. When given (the publish job), the commit
#                  must still be main's head, so re-running an old run never moves nightly
#                  back to an older commit.
#   GITHUB_OUTPUT  optional: where to write commit= and short_commit=
#
# Exit codes: 0 go ahead, 1 refused (with "::error::" lines for the Actions log).
set -euo pipefail

fail() {
    local line
    while IFS= read -r line; do echo "::error title=Nightly refused::$line"; done <<<"$1"
    echo "Nothing was published." >&2
    exit 1
}

event="${EVENT_NAME:-}"
ref="${GIT_REF:-}"
commit="${COMMIT:-}"
main_head="${MAIN_HEAD:-}"

if [ "$event" != push ]; then
    fail "The nightly is built only from pushes to main, not from a \"${event:-unknown}\" event.
Pull requests are built by webos.yml; stable releases are made by release.yml (docs/releasing.md)."
fi

case "$ref" in
    refs/heads/main) ;;
    refs/tags/*)
        fail "Tags don't publish the nightly (${ref#refs/tags/}); version tags vX.Y.Z are stable releases (release.yml)." ;;
    *)
        fail "The nightly is built only from main, not from \"${ref:-an unknown ref}\"." ;;
esac

if ! [[ "$commit" =~ ^[0-9a-f]{40}$ ]]; then
    fail "\"$commit\" is not a full commit SHA."
fi

if [ -n "$main_head" ] && [ "$main_head" != "$commit" ]; then
    fail "main has moved on to ${main_head:0:7}; this run built ${commit:0:7}. The newer commit's run publishes the nightly."
fi

echo "Nightly ${commit:0:7}: OK."
if [ -n "${GITHUB_OUTPUT:-}" ]; then
    {
        echo "commit=$commit"
        echo "short_commit=${commit:0:7}"
    } >>"$GITHUB_OUTPUT"
fi
