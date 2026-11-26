import assert from "node:assert/strict"
import test from "node:test"
import { buildChanges, classifyTitle, nightlyBuildJson, summarizeChanges } from "../.github/scripts/nightly-release.mjs"

// The JSON assets of the nightly pre-release (docs/releasing.md, "Nightly assets"), a
// contract for external updaters.
const A = "a".repeat(40)
const B = "b".repeat(40)
const C = "c".repeat(40)

test("PR titles are classified by their Conventional Commit type", () => {
    assert.deepEqual(classifyTitle("feat(tv): Seasons tabs on the anime page"), { type: "feat", title: "Seasons tabs on the anime page" })
    assert.deepEqual(classifyTitle("fix: Spanish subtitles selected at start"), { type: "fix", title: "Spanish subtitles selected at start" })
    assert.deepEqual(classifyTitle("feat(webos)!: new relay"), { type: "feat", title: "new relay" })
    for (const kind of ["docs", "ci", "test", "chore", "build", "refactor", "style", "CI"]) {
        assert.equal(classifyTitle(`${kind}(x): something`).type, "internal", kind)
    }
    assert.deepEqual(classifyTitle("perf(tv): faster rows"), { type: "other", title: "faster rows" })
    assert.deepEqual(classifyTitle("Update README"), { type: "other", title: "Update README" })
    assert.deepEqual(classifyTitle("(WIP) fix(player): seek"), { type: "fix", title: "seek" })
    assert.deepEqual(classifyTitle("  "), { type: "other", title: "" })
})

const pr = (number: number, title: string, merge: string | null, mergedAt: string | null, base = "main") => ({
    number, title, html_url: `https://github.com/o/r/pull/${number}`, merged_at: mergedAt, merge_commit_sha: merge, base: { ref: base },
})

test("changes.json lists the PRs merged into main in the range, oldest first, once each", () => {
    const pulls = [
        pr(12, "fix(tv): b", B, "2026-11-24T10:00:00Z"),
        pr(11, "feat(tv): a", A, "2026-11-23T10:00:00Z"),
        pr(13, "docs: c", C, "2026-11-25T10:00:00Z"),
        pr(11, "feat(tv): a", A, "2026-11-23T10:00:00Z"), // a second page repeating it
        pr(10, "feat: before the previous nightly", "d".repeat(40), "2026-11-20T10:00:00Z"),
        pr(14, "feat: closed without merging", C, null),
        pr(15, "feat: into another branch", B, "2026-11-24T11:00:00Z", "feature/x"),
    ]
    assert.deepEqual(buildChanges({ pulls, commits: [A, B, C, "e".repeat(40)] }), [
        { type: "feat", title: "a", pr: 11, url: "https://github.com/o/r/pull/11" },
        { type: "fix", title: "b", pr: 12, url: "https://github.com/o/r/pull/12" },
        { type: "internal", title: "c", pr: 13, url: "https://github.com/o/r/pull/13" },
    ])
    assert.deepEqual(buildChanges({ pulls, commits: [] }), [])
})

test("the counts per type, internal ones separate", () => {
    const changes = buildChanges({
        pulls: [pr(1, "feat: x", A, "2026-01-01T00:00:00Z"), pr(2, "fix: y", B, "2026-01-02T00:00:00Z"), pr(3, "ci: z", C, "2026-01-03T00:00:00Z")],
        commits: [A, B, C],
    })
    assert.deepEqual(summarizeChanges(changes), { feat: 1, fix: 1, other: 0, internal: 1 })
})

test("build.json of the pre-release: the app's identity plus the previous nightly", () => {
    const app = { version: "1.0.0", channel: "nightly", commit: B, shortCommit: "bbbbbbb", builtAt: "2026-11-25T12:00:00.000Z" }
    const expected = { version: "1.0.0", channel: "nightly", commit: B, shortCommit: "bbbbbbb", builtAt: "2026-11-25T12:00:00.000Z", previousCommit: A }
    assert.deepEqual(nightlyBuildJson(app, A), expected)
    // The exact key order is part of the documented format.
    assert.deepEqual(Object.keys(nightlyBuildJson(app, A)), Object.keys(expected))
    assert.equal(nightlyBuildJson(app, "").previousCommit, null)
    assert.equal(nightlyBuildJson(app, undefined).previousCommit, null)
    // A re-run on the same commit doesn't point at itself.
    assert.equal(nightlyBuildJson(app, B).previousCommit, null)
    assert.throws(() => nightlyBuildJson({ ...app, channel: "dev" }, A), /not a nightly build/)
    assert.throws(() => nightlyBuildJson({ ...app, commit: null }, A), /not a nightly build/)
    assert.throws(() => nightlyBuildJson(app, "abc1234"), /not a full commit SHA/)
})
