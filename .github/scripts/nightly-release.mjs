#!/usr/bin/env node
/**
 * The JSON files of the "nightly" pre-release (.github/workflows/nightly.yml): build.json
 * (which commit, and which nightly it replaces) and changes.json (the pull requests merged
 * into main since that previous nightly). Their format is a contract for self-hosters'
 * updaters: docs/releasing.md, "Nightly assets".
 *
 *   node .github/scripts/nightly-release.mjs build-json --app dist/webos/app/build.json \
 *       --previous <sha or ""> --out release/build.json
 *   node .github/scripts/nightly-release.mjs changes --repo owner/name \
 *       --previous <sha or ""> --commit <sha> --out release/changes.json   (GITHUB_TOKEN)
 *
 * The exported functions are pure and tested by tests/nightly-release.test.ts.
 */
import fs from "node:fs"
import { pathToFileURL } from "node:url"

/** Conventional Commit types users care about; the rest of the known ones are internal. */
const USER_TYPES = { feat: "feat", fix: "fix" }
export const INTERNAL_TYPES = ["docs", "ci", "test", "chore", "build", "refactor", "style"]
const COMMIT_RE = /^[0-9a-f]{40}$/

/**
 * Type and display title of a pull request from its Conventional Commit title:
 * "feat(tv): Seasons tabs" -> { type: "feat", title: "Seasons tabs" }. Internal types
 * (docs, ci, test, chore, build, refactor, style) become "internal", anything else
 * (perf, revert, no prefix) "other". A leftover "(WIP)" is dropped.
 */
export function classifyTitle(rawTitle) {
    const title = String(rawTitle ?? "").trim().replace(/^\(WIP\)\s*/i, "")
    const match = /^([a-z]+)(\([^)]*\))?(!)?:\s*(.+)$/i.exec(title)
    if (!match) return { type: "other", title }
    const kind = match[1].toLowerCase()
    const type = USER_TYPES[kind] ?? (INTERNAL_TYPES.includes(kind) ? "internal" : "other")
    return { type, title: match[4].trim() }
}

/**
 * changes.json: the merged pull requests whose merge commit is one of `commits` (the commits
 * between the previous nightly and this one), oldest merge first, each listed once.
 * pulls: GitHub's pull request objects (number, title, html_url, merged_at,
 * merge_commit_sha, base.ref).
 */
export function buildChanges({ pulls, commits, base = "main" }) {
    const inRange = new Set(commits)
    const seen = new Set()
    return pulls
        .filter(pr => pr?.merged_at && pr.base?.ref === base && inRange.has(pr.merge_commit_sha))
        .filter(pr => !seen.has(pr.number) && seen.add(pr.number))
        .sort((a, b) => a.merged_at.localeCompare(b.merged_at) || a.number - b.number)
        .map(pr => ({ ...classifyTitle(pr.title), pr: pr.number, url: pr.html_url }))
}

/** Counts per type, for logs and release notes: { feat, fix, other, internal }. */
export function summarizeChanges(changes) {
    const counts = { feat: 0, fix: 0, other: 0, internal: 0 }
    for (const change of changes) counts[change.type] = (counts[change.type] ?? 0) + 1
    return counts
}

/** The release asset build.json: the app's build.json plus the nightly it replaces. */
export function nightlyBuildJson(appBuild, previousCommit) {
    if (appBuild?.channel !== "nightly" || !COMMIT_RE.test(appBuild.commit ?? "")) {
        throw new Error(`The app's build.json is not a nightly build with a commit: ${JSON.stringify(appBuild)}`)
    }
    const previous = previousCommit?.trim() || null
    if (previous !== null && !COMMIT_RE.test(previous)) {
        throw new Error(`The previous nightly commit "${previous}" is not a full commit SHA`)
    }
    return {
        version: appBuild.version,
        channel: "nightly",
        commit: appBuild.commit,
        shortCommit: appBuild.commit.slice(0, 7),
        builtAt: appBuild.builtAt,
        previousCommit: previous === appBuild.commit ? null : previous,
    }
}

///////////////////////////////////////////////////////////////////////////////
// GitHub API (used by the workflow only)
///////////////////////////////////////////////////////////////////////////////

async function github(path, token) {
    const response = await fetch(`https://api.github.com${path}`, {
        headers: {
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
    })
    if (response.status === 404) return null
    if (!response.ok) throw new Error(`GitHub API ${path}: ${response.status} ${await response.text()}`)
    return response.json()
}

/** The commits after `previous` up to `commit` (GitHub's compare), oldest first. */
async function commitsBetween(repo, previous, commit, token) {
    const commits = []
    for (let page = 1; page <= 10; page++) {
        const data = await github(`/repos/${repo}/compare/${previous}...${commit}?per_page=100&page=${page}`, token)
        if (!data) return null // the previous nightly's commit is gone (e.g. a force-push)
        commits.push(...data.commits)
        if (data.commits.length < 100) break
    }
    return commits
}

/** Recently updated closed pull requests into main, newest first, back to `since`. */
async function recentPulls(repo, since, wanted, token) {
    const pulls = []
    for (let page = 1; page <= 10; page++) {
        const batch = await github(`/repos/${repo}/pulls?state=closed&base=main&sort=updated&direction=desc&per_page=100&page=${page}`, token)
        if (!batch?.length) break
        pulls.push(...batch)
        const found = pulls.filter(pr => wanted.has(pr.merge_commit_sha)).length
        // A pull request merged in the range was updated at or after its merge.
        if (found >= wanted.size || batch.length < 100 || batch.at(-1).updated_at < since) break
    }
    return pulls
}

async function changesFor(repo, previous, commit, token) {
    if (!previous || previous === commit) return []
    const commits = await commitsBetween(repo, previous, commit, token)
    if (!commits) {
        console.warn(`The previous nightly commit ${previous} is not in ${repo}; changes.json is empty.`)
        return []
    }
    if (!commits.length) return []
    const shas = commits.map(c => c.sha)
    const oldest = commits.map(c => c.commit.committer.date).sort()[0]
    const since = new Date(Date.parse(oldest) - 24 * 3600 * 1000).toISOString()
    const pulls = await recentPulls(repo, since, new Set(shas), token)
    return buildChanges({ pulls, commits: shas })
}

function options(argv) {
    const result = {}
    for (let i = 0; i < argv.length; i += 2) {
        if (!argv[i].startsWith("--")) throw new Error(`Unexpected argument ${argv[i]}`)
        result[argv[i].slice(2)] = argv[i + 1] ?? ""
    }
    return result
}

function writeJson(file, value) {
    fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n")
}

async function main([command, ...rest]) {
    const opts = options(rest)
    if (command === "build-json") {
        const build = nightlyBuildJson(JSON.parse(fs.readFileSync(opts.app, "utf8")), opts.previous)
        writeJson(opts.out, build)
        console.log(JSON.stringify(build))
    } else if (command === "changes") {
        if (!COMMIT_RE.test(opts.commit ?? "")) throw new Error(`--commit "${opts.commit}" is not a full commit SHA`)
        const changes = await changesFor(opts.repo, opts.previous?.trim() || null, opts.commit, process.env.GITHUB_TOKEN)
        writeJson(opts.out, changes)
        console.log(`${changes.length} pull request(s): ${JSON.stringify(summarizeChanges(changes))}`)
    } else {
        throw new Error("Usage: nightly-release.mjs build-json|changes --option value ...")
    }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
    main(process.argv.slice(2)).catch((error) => {
        console.error(`::error title=Nightly refused::${error.message}`)
        process.exit(1)
    })
}
