#!/usr/bin/env bash
# Decides whether a pull request may be "ready" (see CONTRIBUTING.md, "When a PR is ready").
#
# A PR whose title does NOT start with "(WIP)" must have:
#   1. a linked issue in its body ("Closes #N", "Fixes #N" or "Resolves #N"),
#   2. every checkbox of the PR template ticked ("- [x]"; write "n/a" next to the ones that
#      don't apply and tick them),
#   3. every required CI job finished with success,
#   4. a Conventional Commit title ("type(scope): description"): it becomes the squash
#      commit on main, the only merge method allowed.
# If one of them is missing, this script fails. A "(WIP)" title always passes, and the
# script lists what is still missing.
#
# Real-TV test (see CONTRIBUTING.md, "Testing on a real TV"): while the PR has the
# "needs-tv-test" label, the script also fails, with its own message, so the PR can't be
# merged. It does not ask for "(WIP)": such a PR can be ready for review. A ticked
# "Not tested on a real TV" box needs the "needs-tv-test" (or, after the test, "tv-tested")
# label.
#
# Inputs (environment):
#   PR_TITLE, PR_BODY      the pull request's title and body
#   PR_LABELS              the pull request's label names, separated by commas
#   REQUIRED_CHECKS        required CI job names, one per line
#   CHECK_RESULTS          optional: "<name>\t<status>\t<conclusion>" lines to use instead of
#                          asking GitHub (used by the tests)
#   GITHUB_REPOSITORY, HEAD_SHA, GH_TOKEN   to read the check runs with `gh` otherwise
#   WAIT_SECONDS           how long to wait for running checks (default 0: don't wait)
#   GITHUB_OUTPUT          optional: gets "tv_test_only=true" when the real-TV test is the
#                          only thing missing (the workflow then doesn't label the PR "wip")
#
# Exit codes: 0 ready (or WIP), 1 not ready (or waiting for a real-TV test).
set -euo pipefail

title="${PR_TITLE:-}"
body="${PR_BODY:-}"
wait_seconds="${WAIT_SECONDS:-0}"
labels=",${PR_LABELS:-},"
problems=()

has_label() { [[ "$labels" == *",$1,"* ]]; }

# 1. Linked issue.
if ! grep -Eiq '(close[sd]?|fix(e[sd])?|resolve[sd]?)[[:space:]]+#[0-9]+' <<<"$body"; then
    problems+=("no linked issue in the description (add \"Closes #N\")")
fi

# 2. Template checkboxes.
unchecked=$(grep -Ec '^[[:space:]]*[-*][[:space:]]+\[[[:space:]]\]' <<<"$body" || true)
if [ "$unchecked" -gt 0 ]; then
    problems+=("$unchecked checklist item(s) not ticked (tick them, or write \"n/a\" and tick)")
fi

# The checklist says "Not tested on a real TV" (ticked, not "n/a") but the label is missing.
not_tested=$(grep -Ei '^[[:space:]]*[-*][[:space:]]+\[[xX]\].*not tested on a real TV' <<<"$body" |
    grep -vi 'n/a' || true)
if [ -n "$not_tested" ] && ! has_label needs-tv-test && ! has_label tv-tested; then
    problems+=("the checklist says \"Not tested on a real TV\": add the needs-tv-test label")
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

# 4. The title. Only squash merge is allowed and the PR title becomes the commit on main, so
# it must be a Conventional Commit: "type(scope): description" (scope and "!" optional).
# A "(WIP)" title is checked without its prefix, so the list shows what is still missing.
title_types="feat|fix|docs|test|ci|build|chore|refactor|perf|style|revert|deps"
title_re="^(${title_types})(\([A-Za-z0-9][A-Za-z0-9._/-]*\))?!?: [^[:space:]]"
commit_title="${title#"(WIP)"}"
commit_title="${commit_title#"${commit_title%%[![:space:]]*}"}"
if [[ "$commit_title" == *"(WIP)"* ]]; then
    problems+=("the title has \"(WIP)\" in it: \"(WIP)\" only counts at the start, and the title becomes the commit on main")
elif ! [[ "$commit_title" =~ $title_re ]]; then
    problems+=("the title is not a Conventional Commit (\"type(scope): description\", type one of ${title_types//|/, }); it becomes the squash commit on main")
fi

is_wip=0
if [[ "$title" == "(WIP)"* ]]; then is_wip=1; fi
needs_tv_test=0
if has_label needs-tv-test; then needs_tv_test=1; fi
tv_test_message="Waiting for a real-TV test: remove needs-tv-test after testing (the tester comments the result and adds tv-tested)."

if [ "${#problems[@]}" -eq 0 ]; then
    if [ "$needs_tv_test" -eq 1 ]; then
        if [ "$is_wip" -eq 1 ]; then
            echo "Everything else is in place: remove \"(WIP)\" from the title and mark the PR ready for review."
            echo "$tv_test_message"
            exit 0
        fi
        echo "Ready for review: linked issue, checklist ticked and every required check passed."
        echo "$tv_test_message"
        echo "Until then this check fails, so the PR can't be merged. No \"(WIP)\" needed."
        if [ -n "${GITHUB_OUTPUT:-}" ]; then echo "tv_test_only=true" >>"$GITHUB_OUTPUT"; fi
        exit 1
    fi
    if [ "$is_wip" -eq 1 ]; then
        echo "Everything is in place: remove \"(WIP)\" from the title and mark the PR ready for review."
    else
        echo "Ready: linked issue, checklist ticked, every required check passed and a Conventional Commit title."
    fi
    exit 0
fi

echo "Not ready yet:"
for p in "${problems[@]}"; do echo "  - $p"; done
if [ "$needs_tv_test" -eq 1 ]; then echo "$tv_test_message"; fi
if [ "$is_wip" -eq 1 ]; then
    echo "The title starts with \"(WIP)\", so this is fine for now (keep the PR as a draft)."
    exit 0
fi
echo "Fix the above, or start the title with \"(WIP)\" and keep the PR as a draft."
exit 1
