#!/usr/bin/env bash
# Decides whether the GA Test workflow (.github/workflows/ga-test.yml) builds the
# side-by-side "GA Test" .ipk for a pull request, and names its artifact. It builds only
# for a pull request labelled "needs-tv-test": when it is opened, reopened or pushed to with
# the label, or when that label is added. Other labels don't rebuild it.
# See docs/testing-on-tv.md, "The GA Test app".
#
# Inputs (environment):
#   EVENT_NAME     github.event_name; only "pull_request" builds
#   EVENT_ACTION   github.event.action (opened, synchronize, reopened, labeled, ...)
#   EVENT_LABEL    github.event.label.name: the label just added, for "labeled"
#   PR_LABELS      the PR's labels, comma-separated
#   PR_NUMBER      the PR number
#   HEAD_SHA       the PR's head commit (full 40-character SHA)
#   GITHUB_OUTPUT  optional: where to write build=, app_id=, title=, artifact=, commit=
#
# Exit codes: 0 decided (build=true or build=false), 1 bad input.
set -euo pipefail

LABEL=needs-tv-test
APP_ID=app.garceslab.anime.test
TITLE="GA Test"

out="${GITHUB_OUTPUT:-/dev/null}"

skip() {
    echo "No GA Test build: $1"
    echo "build=false" >>"$out"
    exit 0
}

event="${EVENT_NAME:-}"
action="${EVENT_ACTION:-}"
added="${EVENT_LABEL:-}"
labels="${PR_LABELS:-}"
number="${PR_NUMBER:-}"
sha="$(tr '[:upper:]' '[:lower:]' <<<"${HEAD_SHA:-}")"

[ "$event" = pull_request ] || skip "only pull requests get one, not a \"${event:-unknown}\" event."

case "$action" in
    opened | synchronize | reopened) ;;
    labeled) [ "$added" = "$LABEL" ] || skip "the label added is \"$added\", not $LABEL." ;;
    *) skip "the \"${action:-unknown}\" action doesn't change the build." ;;
esac

has_label=false
IFS=',' read -ra list <<<"$labels"
for name in "${list[@]}"; do
    name="$(sed 's/^ *//; s/ *$//' <<<"$name")"
    [ "$name" = "$LABEL" ] && has_label=true
done
[ "$has_label" = true ] || skip "the pull request isn't labelled $LABEL."

if ! [[ "$number" =~ ^[1-9][0-9]*$ ]]; then
    echo "::error title=GA Test::PR_NUMBER \"$number\" is not a pull request number"
    exit 1
fi
if ! [[ "$sha" =~ ^[0-9a-f]{40}$ ]]; then
    echo "::error title=GA Test::HEAD_SHA \"$sha\" is not a full 40-character commit SHA"
    exit 1
fi

artifact="ga-test-pr${number}-${sha:0:7}"
{
    echo "build=true"
    echo "app_id=$APP_ID"
    echo "title=$TITLE"
    echo "artifact=$artifact"
    echo "commit=$sha"
} >>"$out"
echo "GA Test build: $APP_ID \"$TITLE\", artifact $artifact"
