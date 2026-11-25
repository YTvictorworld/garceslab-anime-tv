#!/usr/bin/env bash
# Decides whether a pull request may be "ready" (see CONTRIBUTING.md, "When a PR is ready").
#
# A PR whose title does NOT start with "(WIP)" must have:
#   1. a linked issue in its body ("Closes #N", "Fixes #N" or "Resolves #N"),
#   2. every checkbox of the PR template ticked ("- [x]"; write "n/a" next to the ones that
#      don't apply and tick them),
#   3. every required CI job finished with success.
# If one of them is missing, this script fails. A "(WIP)" title always passes, and the
# script lists what is still missing.
#
# Inputs (environment):
#   PR_TITLE, PR_BODY      the pull request's title and body
#   REQUIRED_CHECKS        required CI job names, one per line
#   CHECK_RESULTS          optional: "<name>\t<status>\t<conclusion>" lines to use instead of
#                          asking GitHub (used by the tests)
#   GITHUB_REPOSITORY, HEAD_SHA, GH_TOKEN   to read the check runs with `gh` otherwise
#   WAIT_SECONDS           how long to wait for running checks (default 0: don't wait)
#
# Exit codes: 0 ready (or WIP), 1 not ready.
set -euo pipefail

title="${PR_TITLE:-}"
body="${PR_BODY:-}"
wait_seconds="${WAIT_SECONDS:-0}"
problems=()

# 1. Linked issue.
if ! grep -Eiq '(close[sd]?|fix(e[sd])?|resolve[sd]?)[[:space:]]+#[0-9]+' <<<"$body"; then
    problems+=("no linked issue in the description (add \"Closes #N\")")
fi

# 2. Template checkboxes.
unchecked=$(grep -Ec '^[[:space:]]*[-*][[:space:]]+\[[[:space:]]\]' <<<"$body" || true)
if [ "$unchecked" -gt 0 ]; then
    problems+=("$unchecked checklist item(s) not ticked (tick them, or write \"n/a\" and tick)")
fi

# 3. Required CI jobs.
read_checks() {
    if [ -n "${CHECK_RESULTS:-}" ]; then
        printf '%s\n' "$CHECK_RESULTS"
        return
    fi
    # Latest run of every check on the head commit. Re-runs of skipped jobs are ignored, so an
    # older real result wins over a newer "skipped".
    gh api "repos/$GITHUB_REPOSITORY/commits/$HEAD_SHA/check-runs?per_page=100" --paginate \
        --jq '.check_runs[] | select(.conclusion != "skipped") | [.started_at, .name, .status, (.conclusion // "")] | @tsv' |
        sort -r | awk -F'\t' '!seen[$2]++ { print $2 "\t" $3 "\t" $4 }'
}

check_state() { # prints "missing", "pending", "success" or the failing conclusion
    local name="$1" line
    line=$(awk -F'\t' -v n="$name" '$1 == n { print; exit }' <<<"$checks")
    if [ -z "$line" ]; then echo missing; return; fi
    local status conclusion
    status=$(cut -f2 <<<"$line")
    conclusion=$(cut -f3 <<<"$line")
    if [ "$status" != "completed" ]; then echo pending; return; fi
    echo "$conclusion"
}

deadline=$(( $(date +%s) + wait_seconds ))
while :; do
    checks=$(read_checks)
    pending=0
    while IFS= read -r name; do
        [ -z "$name" ] && continue
        state=$(check_state "$name")
        if [ "$state" = pending ]; then pending=1; fi
    done <<<"${REQUIRED_CHECKS:-}"
    if [ "$pending" -eq 0 ] || [ "$(date +%s)" -ge "$deadline" ]; then break; fi
    echo "Waiting for the required checks to finish..."
    sleep 30
done

while IFS= read -r name; do
    [ -z "$name" ] && continue
    state=$(check_state "$name")
    if [ "$state" != success ]; then
        problems+=("required check \"$name\" is $state")
    fi
done <<<"${REQUIRED_CHECKS:-}"

is_wip=0
if [[ "$title" == "(WIP)"* ]]; then is_wip=1; fi

if [ "${#problems[@]}" -eq 0 ]; then
    if [ "$is_wip" -eq 1 ]; then
        echo "Everything is in place: remove \"(WIP)\" from the title and mark the PR ready for review."
    else
        echo "Ready: linked issue, checklist ticked and every required check passed."
    fi
    exit 0
fi

echo "Not ready yet:"
for p in "${problems[@]}"; do echo "  - $p"; done
if [ "$is_wip" -eq 1 ]; then
    echo "The title starts with \"(WIP)\", so this is fine for now (keep the PR as a draft)."
    exit 0
fi
echo "Fix the above, or start the title with \"(WIP)\" and keep the PR as a draft."
exit 1
