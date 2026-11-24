import assert from "node:assert/strict"
import test from "node:test"

const { checkProfileName, deleteProfileQuestion, pinActions, profilePatch, PROFILE_NAME_MAX_LENGTH } = await import("../src/lib/profile/profile-edit.ts")

test("checkProfileName trims and accepts a free name", () => {
    assert.deepEqual(checkProfileName("  Sam  ", ["Alex"]), { ok: true, name: "Sam" })
})

test("checkProfileName refuses an empty name", () => {
    assert.equal(checkProfileName("   ", []).ok, false)
})

test("checkProfileName counts characters, not UTF-16 units", () => {
    const emoji = "😀".repeat(PROFILE_NAME_MAX_LENGTH)
    assert.equal(checkProfileName(emoji, []).ok, true)
    assert.equal(checkProfileName(emoji + "a", []).ok, false)
})

test("checkProfileName refuses another profile's name, whatever the case", () => {
    const result = checkProfileName("alex", ["Alex", "Kids"])
    assert.equal(result.ok, false)
    if (!result.ok) assert.match(result.message, /already has this name/)
})

test("profilePatch sends only what changed", () => {
    const current = { name: "Sam", avatarId: "a1" }
    assert.equal(profilePatch(current, { name: " Sam " }), null)
    assert.equal(profilePatch(current, { avatarId: "a1" }), null)
    assert.deepEqual(profilePatch(current, { name: "Samuel" }), { name: "Samuel" })
    assert.deepEqual(profilePatch(current, { avatarId: "a2" }), { avatarId: "a2" })
})

test("deleteProfileQuestion names the profile and the 30 day trash", () => {
    const question = deleteProfileQuestion("Kids")
    assert.equal(question.title, "Delete Kids?")
    assert.match(question.text, /trash/)
    assert.match(question.text, /30 days/)
})

test("pinActions: add without a PIN, change or remove with one", () => {
    assert.deepEqual(pinActions(false).map(a => a.kind), ["set"])
    assert.deepEqual(pinActions(true).map(a => a.kind), ["change", "remove"])
})
