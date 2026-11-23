import assert from "node:assert/strict"
import test from "node:test"
import { parseScopedCacheKey, profileCacheScope, scopedCacheKey, shouldPersistQuery } from "../src/lib/query-persistence-policy.ts"

const persisted = {
    keys: new Set([JSON.stringify(["status"]), JSON.stringify(["library-collection"])]),
    perIdEndpoints: new Set(["anime-entry"]),
}

test("queries read back at startup are persisted", () => {
    assert.equal(shouldPersistQuery({}, ["status"], persisted), true)
    assert.equal(shouldPersistQuery({ gcTime: 300000 }, ["library-collection"], persisted), true)
})

test("entry pages are persisted by id", () => {
    assert.equal(shouldPersistQuery({}, ["anime-entry", "21"], persisted), true)
    assert.equal(shouldPersistQuery({}, ["anime-entry"], persisted), false)
})

test("queries nothing reads back are not persisted", () => {
    assert.equal(shouldPersistQuery({}, ["search", "naruto"], persisted), false)
    assert.equal(shouldPersistQuery({}, ["status", "extra"], persisted), false)
})

test("queries opting out with gcTime 0 are never persisted", () => {
    assert.equal(shouldPersistQuery({ gcTime: 0 }, ["status"], persisted), false)
    assert.equal(shouldPersistQuery({ gcTime: 0 }, ["anime-entry", "21"], persisted), false)
})

test("profile scopes keep each profile's cache apart", () => {
    assert.equal(profileCacheScope(null), "")
    assert.equal(profileCacheScope(3), "p3")
    assert.equal(scopedCacheKey("", "[\"status\"]"), "[\"status\"]")
    assert.equal(scopedCacheKey("p3", "[\"status\"]"), "p3|[\"status\"]")
    assert.deepEqual(parseScopedCacheKey("p3|[\"status\"]"), { scope: "p3", serializedQueryKey: "[\"status\"]" })
    assert.deepEqual(parseScopedCacheKey("[\"anime-entry\",\"21\"]"), { scope: "", serializedQueryKey: "[\"anime-entry\",\"21\"]" })
    assert.notEqual(scopedCacheKey(profileCacheScope(1), "[\"status\"]"), scopedCacheKey(profileCacheScope(2), "[\"status\"]"))
})
